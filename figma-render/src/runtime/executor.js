// Sandbox script for figma_execute. No imports, no exports, no top-level await.

function frDotName(name) {
  return name.replace(/\//g, '.');
}

// Two local variables with the same dot name make a spec's binding ambiguous,
// so a name the spec needs must belong to exactly one variable.
async function frNeededVariables(needed) {
  const all = await figma.variables.getLocalVariablesAsync();
  const vars = new Map();
  for (const v of all) if (!vars.has(frDotName(v.name))) vars.set(frDotName(v.name), v);
  for (const name of needed) {
    const matches = all.filter(v => frDotName(v.name) === name);
    if (matches.length < 2) continue;
    const collections = [];
    for (const v of matches) {
      const c = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
      collections.push(c ? c.name : v.variableCollectionId);
    }
    throw new Error(`figma-render: variable name ${name} exists in collections ${collections.join(' and ')}; specs need unique names`);
  }
  return vars;
}

// The SLOT an instance binds to a slot property of that name (not one inside a nested instance).
function frOwnSlot(inst, name) {
  const own = n => { for (let p = n.parent; p && p !== inst; p = p.parent) if (p.type === 'INSTANCE') return false; return true; };
  const ref = n => n.componentPropertyReferences && n.componentPropertyReferences.slotContentId;
  return inst.findAll(n => n.type === 'SLOT' && ref(n) && ref(n).split('#')[0] === name && own(n))[0] || null;
}

async function resolveNeeds(plan) {
  const missing = { variables: [], textStyles: [], components: [], props: [] };
  const vars = await frNeededVariables(plan.needs.variables);
  const styles = new Map();
  for (const s of await figma.getLocalTextStylesAsync()) styles.set(s.name, s);
  // A consumer file's design system tokens come in by key (plan.library, from withLibrary); a local one wins.
  const lib = plan.library || { variables: {}, textStyles: {} };
  for (const name of plan.needs.variables) {
    if (vars.has(name) || !lib.variables[name]) continue;
    try { vars.set(name, await figma.variables.importVariableByKeyAsync(lib.variables[name])); }
    catch (err) { throw new Error(`figma-render: library variable ${name} (key ${lib.variables[name]}) could not be imported: ${err.message}`); }
  }
  for (const name of plan.needs.textStyles) {
    if (styles.has(name) || !lib.textStyles[name]) continue;
    try { styles.set(name, await figma.importStyleByKeyAsync(lib.textStyles[name])); }
    catch (err) { throw new Error(`figma-render: library text style ${name} (key ${lib.textStyles[name]}) could not be imported: ${err.message}`); }
  }
  await figma.loadAllPagesAsync();
  const comps = new Map();
  for (const n of figma.root.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })) {
    if (n.type === 'COMPONENT' && n.parent && n.parent.type === 'COMPONENT_SET') continue;
    if (!comps.has(n.name)) comps.set(n.name, n);
  }
  // Library components (Apple's status bar, say) come in by key under the spec's name. The published version is
  // imported first, so a library update reaches new renders; a copy already placed in the file is only the fallback,
  // for when the library server fails or hangs (an import can hang, so it races a timeout).
  const frImport = c => {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), 15000); });
    const load = c.set ? figma.importComponentSetByKeyAsync(c.key) : figma.importComponentByKeyAsync(c.key);
    return Promise.race([load, timeout]).finally(() => clearTimeout(timer));
  };
  const failed = [];
  for (const c of plan.needs.components) {
    if (!c.key || comps.has(c.name)) continue;
    try { comps.set(c.name, await frImport(c)); }
    catch (err) { failed.push({ c, err }); }
  }
  if (failed.length) {
    for (const inst of figma.root.findAllWithCriteria({ types: ['INSTANCE'] })) {
      if (failed.every(({ c }) => comps.has(c.name))) break;
      const main = await inst.getMainComponentAsync();
      if (!main) continue;
      for (const { c } of failed) {
        if (comps.has(c.name)) continue;
        if (!c.set && main.key === c.key) comps.set(c.name, main);
        if (c.set && main.parent && main.parent.type === 'COMPONENT_SET' && main.parent.key === c.key) comps.set(c.name, main.parent);
      }
    }
    for (const { c, err } of failed) if (!comps.has(c.name)) throw new Error(`figma-render: library component ${c.name} (key ${c.key}) could not be imported: ${err.message}`);
  }
  for (const name of plan.needs.variables) if (!vars.has(name)) missing.variables.push(name);
  for (const name of plan.needs.textStyles) if (!styles.has(name)) missing.textStyles.push(name);
  for (const { name, props } of plan.needs.components) {
    const comp = comps.get(name);
    if (!comp) { missing.components.push(name); continue; }
    const defined = Object.keys(comp.componentPropertyDefinitions).map(k => k.split('#')[0]);
    for (const p of props) if (!defined.includes(p)) missing.props.push(`${name}.${p}`);
  }
  const listed = Object.fromEntries(Object.entries(missing).filter(([, list]) => list.length));
  if (Object.keys(listed).length) throw new Error('figma-render: missing ' + JSON.stringify(listed));

  const fonts = new Map();
  for (const name of plan.needs.textStyles) {
    const f = styles.get(name).fontName;
    fonts.set(`${f.family}::${f.style}`, f);
  }
  for (const { name } of plan.needs.components) {
    for (const t of comps.get(name).findAllWithCriteria({ types: ['TEXT'] })) {
      const list = t.fontName === figma.mixed ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
      for (const f of list) fonts.set(`${f.family}::${f.style}`, f);
    }
  }
  fonts.set('Inter::Regular', { family: 'Inter', style: 'Regular' });
  for (const f of fonts.values()) await figma.loadFontAsync(f);
  // a pinned mode can name the collection of an imported library variable (the design system's Icon tone)
  const imported = new Map();
  for (const name of Object.keys(lib.variables)) {
    const v = vars.get(name);
    if (!v || imported.has(v.variableCollectionId)) continue;
    const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
    if (col) imported.set(v.variableCollectionId, col);
  }
  const modes = await frNeededModes(plan.needs, [...await frLibraryCollections(plan, comps), ...imported.values()]);
  return { vars, styles, comps, modes };
}

const frModeKey = (collection, mode) => `${collection}\u0000${mode}`;

// A screen pinned to a theme, and any stack or variant pinned to a mode, names
// the collection and the mode; each must exist before anything is built.
async function frNeededModes(needs, library = []) {
  const out = new Map();
  const nested = Object.entries(needs.nodeModes || {}).flatMap(([c, list]) => list.map(m => [c, m]));
  const wanted = [...Object.entries(needs.modes || {}), ...nested];
  if (!wanted.length) return out;
  const collections = [...await figma.variables.getLocalVariableCollectionsAsync(), ...library];
  for (const [collectionName, modeName] of wanted) {
    const collection = collections.find(c => c.name === collectionName);
    if (!collection) throw new Error(`figma-render: missing variable collection ${collectionName}`);
    const mode = collection.modes.find(m => m.name === modeName);
    if (!mode) throw new Error(`figma-render: collection ${collectionName} has no mode ${modeName}`);
    out.set(frModeKey(collectionName, modeName), { collection, modeId: mode.modeId });
  }
  return out;
}

// A library component binds its own collections (Apple's kit has "Colors" with
// Light and Dark); a screen can pin those modes by name too.
async function frLibraryCollections(plan, comps) {
  const ids = new Set();
  const walk = n => {
    for (const v of Object.values(n.boundVariables || {})) for (const a of [].concat(v)) if (a && a.id) ids.add(a.id);
    if (n.children) n.children.forEach(walk);
  };
  for (const c of plan.needs.components) if (c.key && comps.has(c.name)) walk(comps.get(c.name));
  const out = new Map();
  for (const id of ids) {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (!v || out.has(v.variableCollectionId)) continue;
    const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
    if (col) out.set(v.variableCollectionId, col);
  }
  return [...out.values()];
}

const FR_TINTABLE = ['VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'RECTANGLE', 'POLYGON', 'STAR', 'LINE'];

// Binds every painted fill and stroke of each node to one colour variable.
// Figma takes a bound paint's opacity from the variable, so a paint's own
// opacity moves to its layer.
function frTint(list, ref, ctx) {
  for (const v of list) {
    const paints = [...(Array.isArray(v.fills) ? v.fills : []), ...(Array.isArray(v.strokes) ? v.strokes : [])];
    if (!paints.length) continue;
    const alpha = Math.min(...paints.map(p => (p.opacity === undefined ? 1 : p.opacity)));
    if (Array.isArray(v.fills) && v.fills.length) v.fills = v.fills.map(() => frPaint(ref, ctx));
    if (Array.isArray(v.strokes) && v.strokes.length) v.strokes = v.strokes.map(() => frPaint(ref, ctx));
    if (alpha < 1) v.opacity = (v.opacity === undefined ? 1 : v.opacity) * alpha;
  }
}

function frHexPaint(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.slice(0, 6), 16);
  const paint = { type: 'SOLID', color: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 } };
  if (h.length === 8) paint.opacity = parseInt(h.slice(6, 8), 16) / 255;
  return paint;
}

function frHexColor(hex) {
  const p = frHexPaint(hex);
  return { ...p.color, a: p.opacity === undefined ? 1 : p.opacity };
}

// Linear: angle in degrees, 0 runs left to right, 90 top to bottom.
// Radial: centre cx, cy and radius r as fractions of the node.
// gradientTransform maps node space onto the unit gradient square.
// A stop is a hex, or (a gradient with token stops) { raw } or { var }: a var
// stop binds its variable through an alias, and Figma takes its alpha from it.
function frStop(position, c, ctx) {
  if (typeof c === 'string') return { position, color: frHexColor(c) };
  if (c.raw !== undefined) return { position, color: frHexColor(c.raw) };
  return { position, color: { r: 0, g: 0, b: 0, a: 1 }, boundVariables: { color: figma.variables.createVariableAlias(ctx.vars.get(c.var)) } };
}

// Binds the stops of every gradient paint inside an svg, stop i to token i,
// keeping each stop's position and the gradient's geometry.
function frStopTints(svg, tokens, name, ctx) {
  const grad = p => typeof p.type === 'string' && p.type.indexOf('GRADIENT_') === 0;
  const bind = paints => paints.map(p => {
    if (!grad(p)) return p;
    if (p.gradientStops.length !== tokens.length) throw new Error(`figma-render: stopTints has ${tokens.length} tokens but a gradient in ${name} has ${p.gradientStops.length} stops`);
    const gradientStops = p.gradientStops.map((s, i) => ({ position: s.position, color: s.color, boundVariables: { color: figma.variables.createVariableAlias(ctx.vars.get(tokens[i])) } }));
    return { ...p, gradientStops };
  });
  for (const v of svg.findAll(x => 'fills' in x)) {
    if (Array.isArray(v.fills) && v.fills.some(grad)) v.fills = bind(v.fills);
    if (Array.isArray(v.strokes) && v.strokes.some(grad)) v.strokes = bind(v.strokes);
  }
}

function frGradient(g, ctx) {
  const gradientStops = g.stops.map(([position, c]) => frStop(position, c, ctx));
  if (g.type === 'radial') {
    const cx = g.cx ?? 0.5, cy = g.cy ?? 0.5, k = 1 / (2 * (g.r ?? 0.5));
    return { type: 'GRADIENT_RADIAL', gradientStops, gradientTransform: [[k, 0, 0.5 - k * cx], [0, k, 0.5 - k * cy]] };
  }
  const t = ((g.angle ?? 90) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return { type: 'GRADIENT_LINEAR', gradientStops, gradientTransform: [[c, s, 0.5 - 0.5 * c - 0.5 * s], [-s, c, 0.5 + 0.5 * s - 0.5 * c]] };
}

function frPaint(ref, ctx) {
  if (ref === null || ref === undefined) return null;
  if (ref.raw && ref.raw.type === 'image') {
    // Images are uploaded once and named: the file keeps figmaRender.image.<name> = hash.
    const hash = figma.root.getPluginData('figmaRender.image.' + ref.raw.image);
    if (!hash) throw new Error(`figma-render: image ${ref.raw.image} has no stored hash on this file`);
    return { type: 'IMAGE', imageHash: hash, scaleMode: ref.raw.scaleMode || 'FILL' };
  }
  if (ref.raw && typeof ref.raw === 'object') return frGradient(ref.raw, ctx);
  if (ref.gradient) return frGradient(ref.gradient, ctx);
  if (ref.var) return figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', ctx.vars.get(ref.var));
  if (typeof ref.raw === 'string') return frHexPaint(ref.raw);
  throw new Error('figma-render: a colour needs a token or a hex value');
}

function frNumber(node, field, ref, ctx) {
  if (ref.var) node.setBoundVariable(field, ctx.vars.get(ref.var));
  else node[field] = ref.raw;
}

// A shadow's numbers and colour are raw or bound; a bound field starts at 0 or
// black and Figma resolves it from the variable. A drop shadow never shows
// through the node, as a CSS box-shadow never does.
const FR_EFFECT_FIELDS = [['x', 'offsetX'], ['y', 'offsetY'], ['blur', 'radius'], ['spread', 'spread'], ['color', 'color']];
function frShadow(x, ctx) {
  const num = r => (r.var ? 0 : r.raw);
  let e = {
    type: x.type,
    color: x.color.var ? { r: 0, g: 0, b: 0, a: 1 } : frHexColor(x.color.raw),
    offset: { x: num(x.x), y: num(x.y) },
    radius: num(x.blur),
    spread: num(x.spread),
    visible: true,
    blendMode: 'NORMAL'
  };
  if (x.type === 'DROP_SHADOW') e.showShadowBehindNode = false;
  for (const [key, field] of FR_EFFECT_FIELDS) if (x[key].var) e = figma.variables.setBoundVariableForEffect(e, field, ctx.vars.get(x[key].var));
  // Figma hands the effect back with spread reset to 0 after any bind, so a raw spread goes back on last.
  if (!x.spread.var) e = { ...e, spread: x.spread.raw };
  return e;
}

// Figma ignores some property values without an error (a swap to a variant
// of the instance's own set), so every value is read back.
function frCheckApplied(inst, props, component) {
  for (const [key, value] of Object.entries(props)) {
    const now = inst.componentProperties[key];
    if (!now || now.value !== value) throw new Error(`figma-render: Figma did not apply ${key.split('#')[0]} = ${String(value)} on ${component}`);
  }
}

// Sets the props of a nested instance the component exposes, found by its
// layer name, and reads every value back; then its nested swaps, if any.
async function frSetExposed(inst, x, component, ctx) {
  const nested = (inst.exposedInstances || []).find(e => e.name === x.layer);
  if (!nested) throw new Error(`figma-render: ${component} has no exposed instance "${x.layer}"; mark it expose: true in the ${component} spec`);
  const keys = Object.keys(nested.componentProperties);
  const props = {};
  for (const [k, v] of Object.entries(x.props)) props[frPropKey(keys, k, `${component} ${x.layer}`)] = v;
  if (Object.keys(props).length) {
    nested.setProperties(props);
    frCheckApplied(nested, props, `${component} ${x.layer}`);
  }
  for (const sw of x.swaps || []) await frSwap(nested, Object.keys(nested.componentProperties), sw, `${component} ${x.layer}`, ctx);
}

function frPropKey(keys, name, component) {
  const key = keys.find(d => d === name || d.startsWith(name + '#'));
  if (!key) throw new Error(`figma-render: component ${component} has no property ${name}`);
  return key;
}

// The variant of a set (or the lone component) that matches a swap's variant
// props; the default variant fills in props the swap leaves out.
function frPickVariant(target, props, name) {
  if (target.type !== 'COMPONENT_SET') return { comp: target, rest: props };
  const defs = target.componentPropertyDefinitions;
  const variantProps = {};
  const rest = {};
  for (const [k, v] of Object.entries(props)) (defs[k] && defs[k].type === 'VARIANT' ? variantProps : rest)[k] = v;
  const parse = c => Object.fromEntries(c.name.split(', ').map(part => part.split('=')));
  const wanted = { ...parse(target.defaultVariant), ...variantProps };
  const comp = target.children.find(c => Object.entries(wanted).every(([k, v]) => parse(c)[k] === v));
  if (!comp) throw new Error(`figma-render: ${name} has no variant ${Object.entries(variantProps).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  return { comp, rest };
}

async function frSwap(inst, keys, sw, component, ctx) {
  const key = frPropKey(keys, sw.prop, component);
  const { comp, rest } = frPickVariant(ctx.comps.get(sw.component), sw.props, sw.component);
  inst.setProperties({ [key]: comp.id });
  const label = `${sw.component}${Object.keys(sw.props).length ? ' (' + Object.entries(sw.props).map(([k, v]) => `${k}=${v}`).join(', ') + ')' : ''}`;
  if (inst.componentProperties[key].value !== comp.id) throw new Error(`figma-render: Figma did not apply ${sw.prop} = ${label} on ${component}; an instance cannot swap in its own component or a variant of its own set`);
  if (!Object.keys(rest).length && !(sw.swaps && sw.swaps.length) && !(sw.exposed && sw.exposed.length)) return;
  // The swapped-in layer: the one bound to this property, else the first showing the component.
  let nested = inst.findAll(x => x.type === 'INSTANCE' && x.componentPropertyReferences && x.componentPropertyReferences.mainComponent === key)[0] || null;
  if (!nested) {
    for (const n of inst.findAll(x => x.type === 'INSTANCE')) {
      const main = await n.getMainComponentAsync();
      if (main && main.id === comp.id) { nested = n; break; }
    }
  }
  if (!nested) throw new Error(`figma-render: ${component} has no layer showing ${sw.component} after the swap`);
  const nestedKeys = Object.keys(nested.componentProperties);
  const props = {};
  for (const [k, v] of Object.entries(rest)) props[frPropKey(nestedKeys, k, sw.component)] = v;
  if (Object.keys(props).length) {
    nested.setProperties(props);
    frCheckApplied(nested, props, sw.component);
  }
  for (const inner of sw.swaps || []) await frSwap(nested, Object.keys(nested.componentProperties), inner, sw.component, ctx);
  // The swapped-in component's own exposed instances, once its props are set.
  for (const x of sw.exposed || []) await frSetExposed(nested, x, sw.component, ctx);
}

// An INSTANCE_SWAP property holds one component for the whole set: binding a
// layer swaps it to the default, and swapping any bound layer moves the default
// and every bound layer with it. The validator makes every bound layer show the
// same component, so the default is that component; each layer's own text and
// boolean overrides are put back after binding.
async function frSwapProp(set, op, get, ctx) {
  const layers = op.bind.map(get);
  const main = await layers[0].getMainComponentAsync();
  const preferredValues = op.preferred.map(name => {
    const c = ctx.comps.get(name);
    return { type: c.type === 'COMPONENT_SET' ? 'COMPONENT_SET' : 'COMPONENT', key: c.key };
  });
  const key = set.addComponentProperty(op.name, 'INSTANCE_SWAP', main.id, preferredValues.length ? { preferredValues } : undefined);
  for (const l of layers) {
    const own = Object.entries(l.componentProperties).filter(([, p]) => p.type === 'TEXT' || p.type === 'BOOLEAN');
    l.componentPropertyReferences = { ...(l.componentPropertyReferences || {}), mainComponent: key };
    const now = await l.getMainComponentAsync();
    if (!now || now.id !== main.id) throw new Error(`figma-render: swap prop ${op.name} left layer ${l.name} on ${now ? now.name : 'nothing'}, not ${main.name}`);
    const back = {};
    for (const [k, p] of own) if (l.componentProperties[k] && l.componentProperties[k].value !== p.value) back[k] = p.value;
    if (Object.keys(back).length) l.setProperties(back);
  }
}

const FR_RADII = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'];

async function frApply(op, s) {
  const { ctx, nodes, page } = s;
  const get = id => {
    const n = nodes.get(id);
    if (!n) throw new Error(`figma-render: op ${op.op} refers to unknown node ${id}`);
    return n;
  };
  switch (op.op) {
    case 'root': {
      // The last render may have been moved into a section to organise the page.
      const mine = n => n.getPluginData('figmaRender.name') === op.name;
      const old = page.findChild(mine) || page.children.filter(n => n.type === 'SECTION').map(sec => sec.findChild(mine)).find(Boolean) || null;
      if (old) s.old = old;
      if (op.kind === 'frame') {
        const f = figma.createFrame();
        f.fills = [];
        f.name = op.name;
        page.appendChild(f);
        nodes.set(op.id, f);
        s.pageChildren.push(f);
      }
      return;
    }
    case 'frame': {
      const f = op.component ? figma.createComponent() : figma.createFrame();
      f.fills = [];
      f.name = op.name;
      (op.parent === null ? page : get(op.parent)).appendChild(f);
      nodes.set(op.id, f);
      if (op.parent === null) s.pageChildren.push(f);
      return;
    }
    case 'layout': {
      const n = get(op.id);
      n.layoutMode = op.mode;
      if (op.wrap) n.layoutWrap = 'WRAP';
      return;
    }
    case 'grid': {
      // A child of a GRID frame starts unplaced, so every variant gets its cell;
      // cells left empty stay holes.
      const n = get(op.id);
      // A frame's children were auto-placed as they were appended, and a shrinking track count cannot drop an
      // occupied row or column: park every child in its own spare row in column 0, set the real counts, place them.
      // Rows are made first in every case: unplaced children (a component set's variants) need room before they are placed.
      const placed = op.cells.filter(([id]) => get(id).gridRowAnchorIndex >= 0);
      const spare = Math.max(n.gridRowCount, op.rows);
      n.gridRowCount = spare + placed.length;
      placed.forEach(([id], i) => get(id).setGridChildPosition(spare + i, 0));
      n.gridColumnCount = op.columns;
      for (const [id, row, col] of op.cells) get(id).setGridChildPosition(row, col);
      n.gridRowCount = op.rows;
      // a screen grid's rows hug their tallest child, so tiles in a row share its height
      if (op.rowSizes === 'HUG') n.gridRowSizes = Array.from({ length: op.rows }, () => ({ type: 'HUG' }));
      return;
    }
    case 'spacing': {
      const n = get(op.id);
      if (n.layoutMode === 'GRID') {
        frNumber(n, 'gridRowGap', op.gap, ctx);
        frNumber(n, 'gridColumnGap', op.gap, ctx);
        frNumber(n, 'paddingTop', op.pad.top, ctx);
        frNumber(n, 'paddingRight', op.pad.right, ctx);
        frNumber(n, 'paddingBottom', op.pad.bottom, ctx);
        frNumber(n, 'paddingLeft', op.pad.left, ctx);
        return;
      }
      frNumber(n, 'itemSpacing', op.gap, ctx);
      if (n.layoutWrap === 'WRAP') frNumber(n, 'counterAxisSpacing', op.gap, ctx);
      frNumber(n, 'paddingTop', op.pad.top, ctx);
      frNumber(n, 'paddingRight', op.pad.right, ctx);
      frNumber(n, 'paddingBottom', op.pad.bottom, ctx);
      frNumber(n, 'paddingLeft', op.pad.left, ctx);
      return;
    }
    case 'align': {
      const n = get(op.id);
      n.primaryAxisAlignItems = op.primary;
      n.counterAxisAlignItems = op.counter;
      return;
    }
    case 'fixedSize': {
      const n = get(op.id);
      if (op.w !== undefined || op.h !== undefined) n.resize(op.w ?? n.width, op.h ?? n.height);
      if (op.wVar) n.setBoundVariable('width', ctx.vars.get(op.wVar));
      if (op.hVar) n.setBoundVariable('height', ctx.vars.get(op.hVar));
      return;
    }
    case 'sizing': {
      const n = get(op.id);
      if (op.h) n.layoutSizingHorizontal = op.h;
      if (op.v) n.layoutSizingVertical = op.v;
      return;
    }
    case 'flags': {
      const n = get(op.id);
      n.clipsContent = op.clip;
      n.strokesIncludedInLayout = false;
      return;
    }
    case 'paint': {
      const n = get(op.id);
      if ('fill' in op) { const p = frPaint(op.fill, ctx); n.fills = p ? [p] : []; }
      if (op.stroke) {
        n.strokes = [frPaint(op.stroke.color, ctx)];
        n.strokeAlign = op.stroke.align || 'INSIDE';
        if (op.stroke.dash) n.dashPattern = op.stroke.dash;
        frNumber(n, 'strokeWeight', op.stroke.width, ctx);
      }
      if (Array.isArray(op.radius)) {
        ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].forEach((f, i) => frNumber(n, f, op.radius[i], ctx));
      } else if (op.radius) {
        if (op.radius.var) for (const f of FR_RADII) n.setBoundVariable(f, ctx.vars.get(op.radius.var));
        else n.cornerRadius = op.radius.raw;
      }
      return;
    }
    case 'effects': {
      const list = (op.shadows || []).map(x => frShadow(x, ctx));
      if (op.blur !== undefined) list.push({ type: 'BACKGROUND_BLUR', radius: op.blur, visible: true });
      get(op.id).effects = list;
      return;
    }
    case 'opacity': {
      // Figma reads a variable bound to layer opacity as a percentage (0–100);
      // the token importer writes opacity tokens that way.
      frNumber(get(op.id), 'opacity', op.value, ctx);
      return;
    }
    case 'modes': {
      const n = get(op.id);
      // An instance pin equal to its main's own pin is a no-op Figma cannot
      // tell from the inherited mode: skip it and stamp it for the snapshot.
      const main = n.type === 'INSTANCE' ? await n.getMainComponentAsync() : null;
      const noop = {};
      for (const [c, m] of Object.entries(op.modes)) {
        const { collection, modeId } = ctx.modes.get(frModeKey(c, m));
        if (main && main.explicitVariableModes && main.explicitVariableModes[collection.id] === modeId) { noop[c] = m; continue; }
        n.setExplicitVariableModeForCollection(collection, modeId);
      }
      if (Object.keys(noop).length) n.setPluginData('figmaRender.modesNoop', JSON.stringify(noop));
      return;
    }
    case 'text': {
      const t = figma.createText();
      t.autoRename = false;
      t.name = op.name;
      get(op.parent).appendChild(t);
      await t.setTextStyleIdAsync(ctx.styles.get(op.style).id);
      t.characters = op.chars;
      t.textAlignHorizontal = op.align;
      const p = frPaint(op.color, ctx);
      t.fills = p ? [p] : [];
      nodes.set(op.id, t);
      return;
    }
    case 'textSizing': {
      const t = get(op.id);
      if (op.h === 'FIXED') { t.resize(op.width, t.height); t.layoutSizingHorizontal = 'FIXED'; }
      else t.layoutSizingHorizontal = op.h;
      t.textAutoResize = op.h === 'HUG' ? 'WIDTH_AND_HEIGHT' : 'HEIGHT';
      // One line that ends in an ellipsis instead of wrapping.
      if (op.truncate) { t.textTruncation = 'ENDING'; t.maxLines = 1; }
      return;
    }
    case 'instance': {
      const main = ctx.comps.get(op.component);
      const base = main.type === 'COMPONENT_SET' ? main.defaultVariant : main;
      const inst = base.createInstance();
      get(op.parent).appendChild(inst);
      inst.name = op.name;
      const keys = Object.keys(inst.componentProperties);
      const props = {};
      for (const [k, v] of Object.entries(op.props)) props[frPropKey(keys, k, op.component)] = v;
      if (Object.keys(props).length) {
        inst.setProperties(props);
        frCheckApplied(inst, props, op.component);
      }
      for (const sw of op.swaps || []) await frSwap(inst, keys, sw, op.component, ctx);
      for (const x of op.exposed || []) await frSetExposed(inst, x, op.component, ctx);
      nodes.set(op.id, inst);
      return;
    }
    case 'slot': {
      // a library container's slot: the instance's own SLOT bound to that slot property, cleared of its default content
      const inst = get(op.instance);
      const slot = frOwnSlot(inst, op.name);
      if (!slot) throw new Error(`figma-render: ${inst.name} has no slot ${op.name}`);
      for (const c of [...slot.children]) c.remove();
      nodes.set(op.id, slot);
      return;
    }
    case 'expose': {
      const inst = get(op.id);
      inst.isExposedInstance = true;
      if (!inst.isExposedInstance) throw new Error(`figma-render: Figma did not expose ${inst.name}`);
      return;
    }
    case 'shape': {
      let n;
      if (op.kind === 'rect') n = figma.createRectangle();
      else if (op.kind === 'ellipse') n = figma.createEllipse();
      else n = figma.createNodeFromSvg(op.svg);
      n.name = op.name;
      get(op.parent).appendChild(n);
      n.resize(op.size[0], op.size[1]);
      if (op.sizeVars) ['width', 'height'].forEach((f, i) => { if (op.sizeVars[i]) n.setBoundVariable(f, ctx.vars.get(op.sizeVars[i])); });
      if (op.kind !== 'svg') { const p = frPaint(op.fill, ctx); n.fills = p ? [p] : []; }
      // A tinted svg keeps its shapes but binds every painted fill and stroke to one
      // colour variable, so icons follow the theme. Figma takes a bound paint's
      // opacity from the variable, so a paint's own opacity moves to its layer.
      if (op.tint) frTint(n.findAll(x => 'fills' in x), op.tint, ctx);
      if (op.stopTints) frStopTints(n, op.stopTints, op.name, ctx);
      nodes.set(op.id, n);
      return;
    }
    // An instance's vectors take one colour variable, as an override on the
    // instance (frames and text inside it keep their own paints).
    case 'tint': {
      frTint(get(op.id).findAll(x => FR_TINTABLE.includes(x.type)), op.color, ctx);
      return;
    }
    case 'abs': {
      const n = get(op.id);
      n.layoutPositioning = 'ABSOLUTE';
      const parent = n.parent;
      if (op.side === 'stretch') { n.resize(Math.max(1, parent.width - op.left - op.right), n.height); n.x = op.left; }
      else if (op.side === 'left') n.x = op.inset;
      else n.x = Math.round(parent.width - n.width - op.inset);
      const cover = op.top !== undefined && op.bottom !== undefined; // a full cover: stretched on both axes
      if (cover) { n.resize(n.width, Math.max(1, parent.height - op.top - op.bottom)); n.y = op.top; }
      else n.y = op.bottom !== undefined ? Math.round(parent.height - n.height - op.bottom) : op.top;
      // constraints keep it in place when the frame resizes later (more children, a fill height resolving)
      n.constraints = { horizontal: op.side === 'stretch' ? 'STRETCH' : op.side === 'left' ? 'MIN' : 'MAX', vertical: cover ? 'STRETCH' : op.bottom !== undefined ? 'MAX' : 'MIN' };
      return;
    }
    case 'stamp': {
      get(op.id).setPluginData(op.key, op.value);
      return;
    }
    case 'combine': {
      const set = figma.combineAsVariants(op.children.map(get), page);
      set.name = op.name;
      set.fills = [];
      set.strokes = [];
      set.cornerRadius = 0;
      nodes.set(op.id, set);
      return;
    }
    case 'boolProp': {
      const set = get(op.set);
      const key = set.addComponentProperty(op.name, 'BOOLEAN', op.defaultValue);
      for (const id of op.bind) { const n = get(id); n.componentPropertyReferences = { ...(n.componentPropertyReferences || {}), visible: key }; }
      return;
    }
    case 'swapProp': {
      await frSwapProp(get(op.set), op, get, ctx);
      return;
    }
    case 'textProp': {
      const set = get(op.set);
      const key = set.addComponentProperty(op.name, 'TEXT', op.defaultValue);
      for (const id of op.bind) get(id).componentPropertyReferences = { characters: key };
      return;
    }
    default:
      throw new Error(`figma-render: unknown op ${op.op}`);
  }
}

async function execute(plan) {
  const ctx = await resolveNeeds(plan);
  const s = { ctx, nodes: new Map(), page: figma.currentPage, old: null, pageChildren: [] };
  for (const op of plan.ops) {
    try {
      await frApply(op, s);
    } catch (err) {
      const partial = s.nodes.get(plan.ops[0].id);
      if (partial) partial.remove();
      for (const n of s.pageChildren) {
        if (n !== partial && n.parent === s.page) n.remove();
      }
      const prefix = 'figma-render: ';
      const inner = err.message.startsWith(prefix) ? err.message.slice(prefix.length) : err.message;
      throw new Error(`figma-render: op ${op.op} on ${op.id ?? op.set} failed: ${inner}`);
    }
  }
  const root = s.nodes.get(plan.ops[0].id);
  if (s.old) {
    const home = s.old.parent;
    if (home !== s.page) home.insertChild(home.children.indexOf(s.old), root);
    root.x = s.old.x;
    root.y = s.old.y;
    s.old.remove();
  } else {
    const others = s.page.children.filter(c => c !== root);
    root.x = others.length ? Math.round(Math.max(...others.map(c => c.x + c.width)) + 200) : 0;
    root.y = 0;
  }
  figma.viewport.scrollAndZoomIntoView([root]);
  return { rootId: root.id, name: plan.name, hash: plan.hash, nodes: s.nodes.size };
}
