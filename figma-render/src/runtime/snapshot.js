// Sandbox script for figma_execute. No imports, no exports, no top-level await.

function frUnbound(n) {
  if (n.type === 'INSTANCE') return [];
  const out = [];
  const bv = n.boundVariables || {};
  // A gradient counts as bound only when every stop is bound to a variable.
  const gradientUnbound = p => typeof p.type === 'string' && p.type.indexOf('GRADIENT_') === 0 && (p.gradientStops || []).some(s => !(s.boundVariables && s.boundVariables.color));
  const solidUnbound = paints => Array.isArray(paints) && paints.some(p => p.visible !== false && ((p.type === 'SOLID' && !(p.boundVariables && p.boundVariables.color)) || gradientUnbound(p)));
  if ('fills' in n && solidUnbound(n.fills)) out.push('fills');
  // A shadow's colour is reported like a fill.
  const shadowUnbound = Array.isArray(n.effects) && n.effects.some(e => (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && e.visible !== false && !(e.boundVariables && e.boundVariables.color));
  if (shadowUnbound) out.push('effects');
  if (n.type === 'TEXT') return out;
  if ('strokes' in n && solidUnbound(n.strokes)) out.push('strokes');
  const grid = n.layoutMode === 'GRID';
  const spacing = grid ? ['gridRowGap', 'gridColumnGap'] : ['itemSpacing'];
  for (const f of [...spacing, 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']) {
    if (typeof n[f] === 'number' && n[f] > 0 && !bv[f]) out.push(f);
  }
  const radius = typeof n.cornerRadius === 'number' ? n.cornerRadius : (n.topLeftRadius || 0);
  if ((radius > 0 || (n.topLeftRadius || 0) > 0) && !bv.topLeftRadius) out.push('radius');
  if (Array.isArray(n.strokes) && n.strokes.length && !(bv.strokeWeight || bv.strokeTopWeight)) out.push('strokeWeight');
  if (typeof n.opacity === 'number' && n.opacity < 1 && !bv.opacity) out.push('opacity');
  return out;
}

// Property references and set properties by name, without Figma's #id suffix.
function frRefs(n) {
  const r = n.componentPropertyReferences;
  if (!r) return null;
  const out = {};
  for (const [field, key] of Object.entries(r)) if (key) out[field] = key.split('#')[0];
  return Object.keys(out).length ? out : null;
}

function frSetProps(n) {
  if (n.type !== 'COMPONENT_SET') return null;
  const out = {};
  for (const [key, def] of Object.entries(n.componentPropertyDefinitions)) {
    if (def.type === 'BOOLEAN' || def.type === 'INSTANCE_SWAP') out[key.split('#')[0]] = def.type;
  }
  return out;
}

// A node's explicit modes by collection and mode name, or null. An instance
// shows its main component's modes, which its spec does not set.
function frModes(n, names, main) {
  if (!n.explicitVariableModes) return null;
  // An instance carries its main component's modes; only the ones it pins
  // itself, different from its main's, are its own.
  const own = n.type === 'INSTANCE'
    ? Object.entries(n.explicitVariableModes).filter(([id, m]) => !(main && main.explicitVariableModes && main.explicitVariableModes[id] === m))
    : Object.entries(n.explicitVariableModes);
  const out = Object.fromEntries(own.map(([id, modeId]) => {
    const c = names.get(id);
    const mode = c && c.modes.find(m => m.modeId === modeId);
    return [c ? c.name : id, mode ? mode.name : modeId];
  }));
  // A pin the runtime skipped because the main already pins that mode
  // (fix round 2): stamped, and still in force while no other mode overrides it.
  if (n.type === 'INSTANCE') {
    const noop = n.getPluginData('figmaRender.modesNoop');
    if (noop) for (const [c, m] of Object.entries(JSON.parse(noop))) if (!(c in out)) out[c] = m;
  }
  return Object.keys(out).length ? out : null;
}

// The collections the tree's explicit modes name, local or from a library.
async function frModeCollections(root) {
  const names = new Map((await figma.variables.getLocalVariableCollectionsAsync()).map(c => [c.id, c]));
  const walk = n => [...Object.keys(n.explicitVariableModes || {}), ...(n.type !== 'INSTANCE' && n.children ? n.children.flatMap(walk) : [])];
  for (const id of new Set(walk(root))) {
    if (names.has(id)) continue;
    const c = await figma.variables.getVariableCollectionByIdAsync(id);
    if (c) names.set(id, c);
  }
  return names;
}

// Live Figma reads a hidden layer that fills its parent's cross axis as
// FIXED, though it keeps layoutAlign STRETCH and fills again once shown (a
// layer a bool prop hides by default). For a hidden layer, FILL is taken from
// what Figma persists: layoutAlign on the cross axis, layoutGrow on the main.
function frSizing(n) {
  if (!('layoutSizingHorizontal' in n)) return null;
  const s = { h: n.layoutSizingHorizontal, v: n.layoutSizingVertical };
  const dir = n.parent && n.parent.layoutMode;
  if (n.visible !== false || (dir !== 'HORIZONTAL' && dir !== 'VERTICAL')) return s;
  // A hidden text that hugs reads FIXED too; textAutoResize says how
  // it sizes once shown.
  if (n.type === 'TEXT' && n.textAutoResize === 'WIDTH_AND_HEIGHT') { s.h = 'HUG'; s.v = 'HUG'; }
  if (n.type === 'TEXT' && n.textAutoResize === 'HEIGHT') s.v = 'HUG';
  const main = dir === 'HORIZONTAL' ? 'h' : 'v';
  const cross = main === 'h' ? 'v' : 'h';
  if (n.layoutGrow === 1) s[main] = 'FILL';
  if (n.layoutAlign === 'STRETCH') s[cross] = 'FILL';
  return s;
}

// Main components of the tree's instances and the variables bound to its
// opacities, read before the synchronous walk.
async function frSnapContext(root) {
  const mains = new Map();
  const opacity = new Map();
  const walk = async n => {
    if (n.type === 'INSTANCE') {
      mains.set(n.id, await n.getMainComponentAsync());
      for (const sl of frFilledSlots(n)) for (const c of sl.children) await walk(c);
      return;
    }
    const bv = n.boundVariables && n.boundVariables.opacity;
    if (bv && bv.id && !opacity.has(bv.id)) {
      const v = await figma.variables.getVariableByIdAsync(bv.id);
      if (v) {
        const value = typeof v.resolveForConsumer === 'function' ? v.resolveForConsumer(n).value : Object.values(v.valuesByMode)[0];
        opacity.set(bv.id, { name: v.name, value });
      }
    }
    if (n.children && n.getPluginData('figmaRender.kind') !== 'shape') for (const c of n.children) await walk(c);
  };
  await walk(root);
  return { mains, opacity };
}

// The snapshot payload ships alone, so it keeps its own copy of the executor's slot lookup.
function frSnapSlot(inst, name) {
  const own = n => { for (let p = n.parent; p && p !== inst; p = p.parent) if (p.type === 'INSTANCE') return false; return true; };
  const ref = n => n.componentPropertyReferences && n.componentPropertyReferences.slotContentId;
  return inst.findAll(n => n.type === 'SLOT' && ref(n) && ref(n).split('#')[0] === name && own(n))[0] || null;
}

function frFilledSlots(inst) {
  const names = inst.getPluginData('figmaRender.slots');
  return names ? names.split(',').map(name => frSnapSlot(inst, name)).filter(Boolean) : [];
}

function frSnap(n, names, ctx) {
  const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height };
  const node = {
    id: n.id, name: n.name, type: n.type,
    x: b.x, y: b.y, width: b.width, height: b.height,
    visible: n.visible !== false,
    layoutMode: 'layoutMode' in n ? n.layoutMode : null,
    layoutPositioning: 'layoutPositioning' in n ? n.layoutPositioning : null,
    sizing: frSizing(n),
    clips: 'clipsContent' in n ? n.clipsContent : null,
    textAutoResize: n.type === 'TEXT' ? n.textAutoResize : null,
    ...(n.type === 'INSTANCE' ? { exposed: Boolean(n.isExposedInstance) } : {}),
    wrap: 'layoutWrap' in n ? n.layoutWrap : null,
    grid: n.layoutMode === 'GRID' ? { rows: n.gridRowCount, columns: n.gridColumnCount } : null,
    cell: n.parent && n.parent.layoutMode === 'GRID' ? [n.gridRowAnchorIndex, n.gridColumnAnchorIndex] : null,
    effects: Array.isArray(n.effects) ? n.effects.map(e => e.type) : [],
    refs: frRefs(n),
    props: frSetProps(n),
    modes: frModes(n, names, ctx.mains.get(n.id)),
    // A negative gap stacks children on purpose; recorded only then, so older snapshots keep their shape.
    ...(typeof n.itemSpacing === 'number' && n.itemSpacing < 0 ? { gap: n.itemSpacing } : {}),
    // Recorded only below full opacity, so older snapshots keep their shape.
    ...(n.type !== 'INSTANCE' && typeof n.opacity === 'number' && n.opacity < 1 ? { opacity: Math.round(n.opacity * 100) / 100 } : {}),
    // A bound opacity's variable, by name and value (Figma reads it / 100).
    ...(n.type !== 'INSTANCE' && n.boundVariables && n.boundVariables.opacity && ctx.opacity.has(n.boundVariables.opacity.id) ? { opacityVar: ctx.opacity.get(n.boundVariables.opacity.id) } : {}),
    plugin: {
      name: n.getPluginData('figmaRender.name'),
      hash: n.getPluginData('figmaRender.hash'),
      abs: n.getPluginData('figmaRender.abs'),
      raw: n.getPluginData('figmaRender.raw'),
      kind: n.getPluginData('figmaRender.kind')
    },
    unbound: frUnbound(n),
    children: []
  };
  if ('children' in n && n.type !== 'INSTANCE' && node.plugin.kind !== 'shape') node.children = n.children.map(c => frSnap(c, names, ctx));
  // slots the spec filled (the instance is stamped with their names) are snapshotted with their content
  if (n.type === 'INSTANCE') {
    const filled = frFilledSlots(n);
    if (filled.length) node.slots = filled.map(sl => frSnap(sl, names, ctx));
  }
  return node;
}

async function snapshot(rootId) {
  const root = await figma.getNodeByIdAsync(rootId);
  if (!root) throw new Error(`figma-render: no node ${rootId}`);
  return frSnap(root, await frModeCollections(root), await frSnapContext(root));
}
