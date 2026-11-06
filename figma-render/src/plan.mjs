import { specHash } from './hash.mjs';
import { layerName, gridCells } from './spec-util.mjs';
import { dropsGap } from './validate.mjs';

// Splits instance props into plain values and swaps { prop, component, props,
// swaps? }; a swap's own props split the same way, and `swaps` is only there
// when a swap holds one, so specs without nested swaps plan as before.
export function splitProps(all) {
  const plain = {};
  const swaps = [];
  for (const [k, v] of Object.entries(all)) {
    if (v && typeof v === 'object') {
      const inner = splitProps(v.props || {});
      const entry = inner.swaps.length ? { prop: k, component: v.instance, props: inner.plain, swaps: inner.swaps } : { prop: k, component: v.instance, props: inner.plain };
      if (v.exposed) entry.exposed = splitExposed(v.exposed);
      swaps.push(entry);
    } else plain[k] = v;
  }
  return { plain, swaps };
}

// exposed { layer: props } as the runtime takes it: [{ layer, props, swaps? }].
export function splitExposed(exposed) {
  return Object.entries(exposed).map(([layer, p]) => {
    const split = splitProps(p);
    return split.swaps.length ? { layer, props: split.plain, swaps: split.swaps } : { layer, props: split.plain };
  });
}

export function toRef(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'number') return { raw: Math.round(v) };
  if (typeof v === 'string' && v.startsWith('#')) return { raw: v };
  // A gradient with a token stop binds that stop; an all-hex gradient stays raw, as before.
  if (typeof v === 'object' && v.stops && v.stops.some(([, c]) => typeof c === 'string' && !c.startsWith('#'))) {
    return { gradient: { ...v, stops: v.stops.map(([at, c]) => [at, c.startsWith('#') ? { raw: c } : { var: c }]) } };
  }
  if (typeof v === 'object' && (v.stops || v.type === 'image')) return { raw: v };
  return { var: v };
}

const SIZE = v => (v === 'fill' ? 'FILL' : v === 'hug' ? 'HUG' : 'FIXED');
const JUSTIFY = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN' };
const ALIGN = { start: 'MIN', center: 'CENTER', end: 'MAX', baseline: 'BASELINE' };
const flip = a => (a === 'MIN' ? 'MAX' : a === 'MAX' ? 'MIN' : a);
const isRaw = r => r && ((r.raw !== undefined && r.raw !== 0) || Boolean(r.gradient && r.gradient.stops.some(([, c]) => c.raw !== undefined)));
const isSizeToken = v => typeof v === 'string' && v !== 'fill' && v !== 'hug';

// A fixed width or height is a number (resized) or a size token (bound).
function fixedOp(id, w, h, track) {
  const op = { op: 'fixedSize', id };
  if (typeof w === 'number') op.w = Math.round(w);
  if (typeof h === 'number') op.h = Math.round(h);
  if (isSizeToken(w)) op.wVar = track(w);
  if (isSizeToken(h)) op.hVar = track(h);
  return op;
}
const isFixed = v => typeof v === 'number' || isSizeToken(v);

export function textAlign(align = 'start', rtl = false) {
  if (align === 'center') return 'CENTER';
  const start = rtl ? 'RIGHT' : 'LEFT';
  const end = rtl ? 'LEFT' : 'RIGHT';
  return align === 'end' ? end : start;
}

function resolvePad(pad, rtl) {
  const zero = { raw: 0 };
  if (pad === undefined) return { top: zero, right: zero, bottom: zero, left: zero };
  if (typeof pad !== 'object') {
    const r = toRef(pad);
    return { top: r, right: r, bottom: r, left: r };
  }
  const r = v => (v === undefined ? zero : toRef(v));
  const top = pad.top ?? pad.block;
  const bottom = pad.bottom ?? pad.block;
  const start = pad.start ?? pad.inline;
  const end = pad.end ?? pad.inline;
  const [left, right] = rtl ? [end, start] : [start, end];
  return { top: r(top), right: r(right), bottom: r(bottom), left: r(left) };
}

export class Planner {
  constructor(spec, manifest = []) {
    this.spec = spec;
    this.rtl = spec.direction === 'rtl';
    this.manifest = manifest;
    this.textColor = spec.textColor;
    this.ops = [];
    this.count = 0;
    this.vars = new Set();
    this.styles = new Set();
    this.comps = new Map();
    this.libs = new Map();
    this.textBinds = null;
    this.layerBinds = null;
    this.tints = [];
    this.exposes = [];
    this.nodeModes = new Map();
  }

  // Every collection and mode a node pins, each once, so the runtime can find
  // them all before it builds anything.
  noteModes(modes) {
    for (const [collection, mode] of Object.entries(modes)) {
      const list = this.nodeModes.get(collection) || [];
      if (!list.includes(mode)) this.nodeModes.set(collection, [...list, mode]);
    }
  }

  // A component the spec instances or prefers, with the props it sets.
  needComponent(name, props) {
    const known = this.comps.get(name) || [];
    for (const k of props) if (!known.includes(k)) known.push(k);
    this.comps.set(name, known);
  }

  // Every component a list of swaps (and the swaps nested in them) brings in.
  needSwaps(swaps) {
    for (const x of swaps) {
      this.needComponent(x.component, [...Object.keys(x.props), ...(x.swaps || []).map(n => n.prop)]);
      if (x.swaps) this.needSwaps(x.swaps);
      for (const e of x.exposed || []) if (e.swaps) this.needSwaps(e.swaps);
    }
  }

  // Remember a layer a bool or swap prop binds, with its expected node for parity.
  bindLayer(name, id, expected) {
    if (this.layerBinds && this.layerBinds.has(name)) this.layerBinds.get(name).push({ id, expected });
    return expected;
  }

  shadow(type, s) {
    const ref = v => this.track(toRef(v ?? 0));
    return { type, x: ref(s.x), y: ref(s.y), blur: ref(s.blur), spread: ref(s.spread), color: this.track(toRef(s.color)) };
  }

  id() { return `n${this.count++}`; }
  emit(op) { this.ops.push(op); }
  track(ref) {
    if (ref && ref.var) this.vars.add(ref.var);
    if (ref && ref.gradient) ref.gradient.stops.forEach(([, c]) => { if (c.var) this.vars.add(c.var); });
    return ref;
  }

  stackProps(id, node, { root = false } = {}) {
    const raw = [];
    const mode = node.dir === 'grid' ? 'GRID' : node.dir === 'row' ? 'HORIZONTAL' : 'VERTICAL';
    this.emit(node.wrap ? { op: 'layout', id, mode, wrap: true } : { op: 'layout', id, mode });
    const gap = this.track(toRef(node.gap ?? 0));
    const pad = resolvePad(node.pad, this.rtl);
    Object.values(pad).forEach(r => this.track(r));
    if (isRaw(gap)) raw.push('itemSpacing');
    for (const [side, field] of [['top', 'paddingTop'], ['right', 'paddingRight'], ['bottom', 'paddingBottom'], ['left', 'paddingLeft']]) {
      if (isRaw(pad[side])) raw.push(field);
    }
    this.emit({ op: 'spacing', id, gap, pad });
    let primary = JUSTIFY[node.justify ?? 'start'];
    let counter = ALIGN[node.align ?? 'start'];
    if (this.rtl) {
      if (mode === 'HORIZONTAL') primary = flip(primary);
      else counter = flip(counter);
    }
    if (mode !== 'GRID') this.emit({ op: 'align', id, primary, counter });
    const w = node.w ?? 'hug';
    const h = node.h ?? 'hug';
    if (isFixed(w) || isFixed(h)) this.emit(fixedOp(id, w, h, v => { this.vars.add(v); return v; }));
    this.emit({ op: 'sizing', id, h: SIZE(w), v: SIZE(h) });
    this.emit({ op: 'flags', id, clip: root ? true : node.clip === true });
    if (node.fill !== undefined || node.stroke !== undefined || node.radius !== undefined) {
      const paint = { op: 'paint', id };
      if (node.fill !== undefined) { paint.fill = this.track(toRef(node.fill)); if (isRaw(paint.fill)) raw.push('fills'); }
      if (node.stroke !== undefined) {
        paint.stroke = { color: this.track(toRef(node.stroke.color)), width: this.track(toRef(node.stroke.width)) };
        if (node.stroke.align) paint.stroke.align = node.stroke.align.toUpperCase();
        if (node.stroke.dash) paint.stroke.dash = node.stroke.dash.map(n => Math.round(n * 100) / 100);
        if (isRaw(paint.stroke.color)) raw.push('strokes');
        if (isRaw(paint.stroke.width)) raw.push('strokeWeight');
      }
      if (Array.isArray(node.radius)) {
        paint.radius = node.radius.map(r => this.track(toRef(r)));
        if (paint.radius.some(r => r.raw !== undefined)) raw.push('radius');
      } else if (node.radius !== undefined) { paint.radius = this.track(toRef(node.radius)); if (isRaw(paint.radius)) raw.push('radius'); }
      this.emit(paint);
    }
    const shadows = [...(node.shadow || []).map(x => this.shadow('DROP_SHADOW', x)), ...(node.innerShadow || []).map(x => this.shadow('INNER_SHADOW', x))];
    if (shadows.length) {
      const op = { op: 'effects', id };
      if (node.blur !== undefined) op.blur = Math.round(node.blur);
      op.shadows = shadows;
      this.emit(op);
      if (node.blur !== undefined || shadows.some(x => isRaw(x.color))) raw.push('effects');
    } else if (node.blur !== undefined) { this.emit({ op: 'effects', id, blur: Math.round(node.blur) }); raw.push('effects'); }
    if (node.modes) { this.emit({ op: 'modes', id, modes: node.modes }); this.noteModes(node.modes); }
    if (node.opacity !== undefined) {
      const value = opacityRef(node.opacity);
      this.track(value);
      this.emit({ op: 'opacity', id, value });
      if (value.raw !== undefined && value.raw !== 1) raw.push('opacity');
    }
    if (raw.length) this.emit({ op: 'stamp', id, key: 'figmaRender.raw', value: raw.join(',') });
    return { h: SIZE(w), v: SIZE(h) };
  }

  children(node, parent) {
    const kids = node.children || [];
    let ordered = kids;
    if (this.rtl && node.dir === 'row') {
      const flow = kids.filter(c => !c.abs);
      const abs = kids.filter(c => c.abs);
      ordered = [...flow].reverse().concat(abs);
    }
    return ordered.map(c => this.node(c, parent));
  }

  abs(id, node) {
    if (!node.abs) return;
    const a = node.abs;
    const r = v => (v === undefined ? undefined : Math.round(v));
    // both start and end stretch it between them; bottom pins it to the bottom edge (a scroll fade)
    const left = this.rtl ? r(a.end) : r(a.start);
    const right = this.rtl ? r(a.start) : r(a.end);
    const op = left !== undefined && right !== undefined ? { op: 'abs', id, side: 'stretch', left, right }
      : { op: 'abs', id, side: left !== undefined ? 'left' : 'right', inset: left !== undefined ? left : right };
    if (a.bottom !== undefined) op.bottom = r(a.bottom);
    if (a.top !== undefined || a.bottom === undefined) op.top = r(a.top); // both: a full cover, stretched on both axes
    this.emit(op);
    this.emit({ op: 'stamp', id, key: 'figmaRender.abs', value: '1' });
  }

  iconProps(node) {
    if (!node.icon || !this.rtl) return {};
    const entry = this.manifest.find(m => m.name === node.icon);
    if (!entry || entry.policy === 'keep') return {};
    return entry.policy === 'mirror' ? { Direction: 'RTL' } : { Locale: 'Arabic' };
  }

  node(node, parent) {
    const id = this.id();
    if ('stack' in node) {
      const name = layerName(node);
      this.emit({ op: 'frame', id, parent, name });
      const sizing = this.stackProps(id, node);
      const children = this.children(node, id);
      if (node.dir === 'grid') this.grid(id, node);
      this.abs(id, node);
      // an overlay stretched between start and end takes its width from them: Figma reports it FIXED
      if (node.abs && node.abs.start !== undefined && node.abs.end !== undefined) sizing.h = 'FIXED';
      if (node.abs && node.abs.top !== undefined && node.abs.bottom !== undefined) sizing.v = 'FIXED';
      return this.bindLayer(name, id, withGapDrop(withOpacity(withModes(withEffects({ name, type: 'FRAME', sizing, children }, node), node), node), node));
    }
    if ('text' in node) {
      const name = layerName(node);
      const color = this.track(toRef(node.color ?? this.textColor));
      this.styles.add(node.style);
      this.emit({ op: 'text', id, parent, name, chars: node.text, style: node.style, align: textAlign(node.align, this.rtl), color });
      const w = node.w ?? 'hug';
      const sizingOp = { op: 'textSizing', id, h: SIZE(w) };
      if (typeof w === 'number') sizingOp.width = Math.round(w);
      if (node.truncate) sizingOp.truncate = true;
      this.emit(sizingOp);
      if (isRaw(color)) this.emit({ op: 'stamp', id, key: 'figmaRender.raw', value: 'fills' });
      if (this.textBinds && this.textBinds.has(name)) this.textBinds.get(name).push({ id, chars: node.text });
      this.abs(id, node);
      return this.bindLayer(name, id, { name, type: 'TEXT', sizing: { h: SIZE(w), v: 'HUG' }, children: [] });
    }
    if ('instance' in node) {
      const name = layerName(node);
      // A swap value { instance, props } sets an INSTANCE_SWAP property; the rest set as they are.
      const { plain, swaps } = splitProps(node.props || {});
      const props = { ...plain, ...this.iconProps(node) };
      this.needComponent(node.instance, [...Object.keys(props), ...swaps.map(x => x.prop)]);
      this.needSwaps(swaps);
      if (node.key) this.libs.set(node.instance, { key: node.key, set: node.set === true });
      const op = { op: 'instance', id, parent, name, component: node.instance, props };
      if (swaps.length) op.swaps = swaps;
      if (node.exposed) {
        op.exposed = splitExposed(node.exposed);
        op.exposed.forEach(e => { if (e.swaps) this.needSwaps(e.swaps); });
      }
      this.emit(op);
      // An instance's own mode overrides the one its main component pins.
      if (node.modes) { this.emit({ op: 'modes', id, modes: node.modes }); this.noteModes(node.modes); }
      // Exposing runs once the set's bool and swap props have bound its layers.
      if (node.expose === true) this.exposes.push({ op: 'expose', id });
      // Recolouring an instance's vectors is an override, so it runs last,
      // after bool and swap props have bound (and reset) the layers.
      if (node.tint !== undefined) this.tints.push({ op: 'tint', id, color: this.track(toRef(node.tint)) });
      const sizing = {};
      if (node.w !== undefined) sizing.h = SIZE(node.w);
      if (node.h !== undefined) sizing.v = SIZE(node.h);
      if (isFixed(node.w) || isFixed(node.h)) this.emit(fixedOp(id, node.w, node.h, v => { this.vars.add(v); return v; }));
      if (Object.keys(sizing).length) this.emit({ op: 'sizing', id, ...sizing });
      this.abs(id, node);
      // a stretched overlay ends up FIXED on the stretched axis (the runtime resizes it)
      if (node.abs && node.abs.start !== undefined && node.abs.end !== undefined) sizing.h = 'FIXED';
      if (node.abs && node.abs.top !== undefined && node.abs.bottom !== undefined) sizing.v = 'FIXED';
      const expected = Object.keys(sizing).length ? { name, type: 'INSTANCE', sizing, children: [] } : { name, type: 'INSTANCE', children: [] };
      if (node.expose === true) expected.exposed = true;
      if (node.slots) expected.slots = this.slots(id, node.slots);
      return this.bindLayer(name, id, withModes(expected, node));
    }
    const fill = this.track(toRef(node.fill));
    const shapeName = layerName(node);
    const shapeOp = { op: 'shape', id, parent, name: shapeName, kind: node.kind, size: node.size.map(v => (typeof v === 'number' ? Math.round(v) : 1)) };
    if (node.size.some(isSizeToken)) shapeOp.sizeVars = node.size.map(v => (isSizeToken(v) ? (this.vars.add(v), v) : null));
    if (node.svg !== undefined) shapeOp.svg = node.svg;
    if (node.tint !== undefined) shapeOp.tint = this.track(toRef(node.tint));
    if (node.stopTints !== undefined) shapeOp.stopTints = node.stopTints.map(t => { this.vars.add(t); return t; });
    if (fill !== undefined) shapeOp.fill = fill;
    this.emit(shapeOp);
    this.emit({ op: 'stamp', id, key: 'figmaRender.kind', value: 'shape' });
    const sizing = {};
    if (node.w !== undefined) sizing.h = SIZE(node.w);
    if (node.h !== undefined) sizing.v = SIZE(node.h);
    if (Object.keys(sizing).length) this.emit({ op: 'sizing', id, ...sizing });
    this.abs(id, node);
    return this.bindLayer(shapeName, id, Object.keys(sizing).length ? { name: shapeName, type: 'SHAPE', sizing, children: [] } : { name: shapeName, type: 'SHAPE', children: [] });
  }

  // A library container's Figma slots (Modal Body, App chrome Content): each is cleared and the children are built
  // inside it, so they are laid out, snapshotted and gated like any stack. A value is a list of children (the slot
  // stacks them top to bottom) or { dir, children } for a slot that runs in a row.
  slots(instanceId, slots) {
    const out = [];
    for (const [slotName, value] of Object.entries(slots)) {
      const id = this.id();
      const kids = Array.isArray(value) ? value : value.children;
      this.emit({ op: 'slot', id, instance: instanceId, name: slotName });
      // h fill: the slot fills its instance's height (a Card stretched by its grid row), so content can reach the bottom
      const fill = !Array.isArray(value) && value.h === 'fill';
      if (fill) this.emit({ op: 'sizing', id, v: 'FILL' });
      const children = this.children({ dir: Array.isArray(value) ? 'col' : value.dir || 'col', children: kids }, id);
      out.push(fill ? { name: slotName, type: 'SLOT', sizing: { v: 'FILL' }, children } : { name: slotName, type: 'SLOT', children });
    }
    this.emit({ op: 'stamp', id: instanceId, key: 'figmaRender.slots', value: Object.keys(slots).join(',') });
    return out;
  }

  // A grid stack places its children in reading order, columns wide, and its rows hug their tallest child.
  grid(id, node) {
    const kids = this.ops.filter(o => o.parent === id && ['frame', 'text', 'instance', 'shape'].includes(o.op)).map(o => o.id);
    const rows = Math.max(1, Math.ceil(kids.length / node.columns));
    this.emit({ op: 'grid', id, rows, columns: node.columns, rowSizes: 'HUG', cells: kids.map((k, i) => [k, Math.floor(i / node.columns), i % node.columns]) });
  }

  needs() {
    const out = {
      variables: [...this.vars],
      textStyles: [...this.styles],
      components: [...this.comps].map(([name, props]) => (this.libs.has(name) ? { name, props, ...this.libs.get(name) } : { name, props }))
    };
    if (this.nodeModes.size) out.nodeModes = Object.fromEntries(this.nodeModes);
    return out;
  }
}

// The effect types a stack expects, in the order the runtime draws them; only
// a stack with a shadow lists them, so older plans keep their expected tree.
function effectTypes(node) {
  if (!node.shadow && !node.innerShadow) return null;
  return [...(node.shadow || []).map(() => 'DROP_SHADOW'), ...(node.innerShadow || []).map(() => 'INNER_SHADOW'), ...(node.blur !== undefined ? ['BACKGROUND_BLUR'] : [])];
}
const withEffects = (expected, node) => (effectTypes(node) ? { ...expected, effects: effectTypes(node) } : expected);
// Only a node that pins a mode expects one, so older plans are unchanged.
const withModes = (expected, node) => (node.modes ? { ...expected, modes: { ...node.modes } } : expected);
// A stack whose gap Figma will drop (justify between, hugging): the gate warns.
const withGapDrop = (expected, node) => (dropsGap(node) ? { ...expected, dropsGap: node.gap } : expected);
// A raw opacity keeps two decimals (toRef rounds numbers to whole pixels).
const opacityRef = v => (typeof v === 'number' ? { raw: Math.round(v * 100) / 100 } : { var: v });
// Only a stack that sets opacity expects one, so older plans are unchanged.
const withOpacity = (expected, node) => (node.opacity !== undefined ? { ...expected, opacity: opacityRef(node.opacity) } : expected);

const RAW_PAD = [['top', 'paddingTop'], ['right', 'paddingRight'], ['bottom', 'paddingBottom'], ['left', 'paddingLeft']];

// The set frame's own layout. Without setLayout it is one wrapping row that
// hugs (the old behaviour); setLayout makes it a grid or a fixed-width wrap.
function planSetLayout(p, setId, spec, variantIds) {
  const l = spec.setLayout;
  if (!l) {
    p.emit({ op: 'layout', id: setId, mode: 'HORIZONTAL', wrap: true });
    p.emit({ op: 'spacing', id: setId, gap: { raw: 24 }, pad: { top: { raw: 24 }, right: { raw: 24 }, bottom: { raw: 24 }, left: { raw: 24 } } });
    p.emit({ op: 'align', id: setId, primary: 'MIN', counter: 'MIN' });
    p.emit({ op: 'sizing', id: setId, h: 'HUG', v: 'HUG' });
    p.emit({ op: 'flags', id: setId, clip: false });
    return { raw: ['itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'], layout: null, cells: null };
  }
  const gap = p.track(toRef(l.gap ?? 24));
  const pad = resolvePad(l.pad ?? 24, p.rtl);
  Object.values(pad).forEach(r => p.track(r));
  const rawPad = RAW_PAD.filter(([side]) => isRaw(pad[side])).map(([, field]) => field);
  // An optional backdrop (setLayout.fill), painted on the set frame after its layout.
  const fill = l.fill === undefined ? undefined : p.track(toRef(l.fill));
  const paintSet = () => { if (fill !== undefined) p.emit({ op: 'paint', id: setId, fill }); };
  const rawFill = fill !== undefined && isRaw(fill) ? ['fills'] : [];
  if (l.wrap) {
    p.emit({ op: 'layout', id: setId, mode: 'HORIZONTAL', wrap: true });
    p.emit({ op: 'spacing', id: setId, gap, pad });
    p.emit({ op: 'align', id: setId, primary: 'MIN', counter: 'MIN' });
    p.emit({ op: 'fixedSize', id: setId, w: Math.round(l.width) });
    p.emit({ op: 'sizing', id: setId, h: 'FIXED', v: 'HUG' });
    p.emit({ op: 'flags', id: setId, clip: false });
    paintSet();
    return { raw: [...(isRaw(gap) ? ['itemSpacing'] : []), ...rawPad, ...rawFill], layout: { mode: 'HORIZONTAL', wrap: true, width: Math.round(l.width) }, cells: null };
  }
  const grid = gridCells(spec.variants, l);
  p.emit({ op: 'layout', id: setId, mode: 'GRID' });
  p.emit({ op: 'grid', id: setId, rows: grid.rows, columns: grid.columns, cells: variantIds.map((v, i) => [v, ...grid.cells[i]]) });
  p.emit({ op: 'spacing', id: setId, gap, pad });
  p.emit({ op: 'sizing', id: setId, h: 'HUG', v: 'HUG' });
  p.emit({ op: 'flags', id: setId, clip: false });
  paintSet();
  return { raw: [...(isRaw(gap) ? ['gridRowGap', 'gridColumnGap'] : []), ...rawPad, ...rawFill], layout: { mode: 'GRID', rows: grid.rows, columns: grid.columns }, cells: grid.cells };
}

// BOOLEAN props bind a layer's visibility, INSTANCE_SWAP props an instance's
// main component; both are set on the set after it is combined.
function planLayerProps(p, setId, spec) {
  const props = {};
  const bound = (key, name, def) => {
    const list = p.layerBinds.get(def.layer) || [];
    if (list.length === 0) throw new Error(`figma-render: ${key} "${name}" names layer "${def.layer}", which no variant has`);
    return list;
  };
  for (const [name, def] of Object.entries(spec.boolProps || {})) {
    const list = bound('bool prop', name, def);
    p.emit({ op: 'boolProp', set: setId, name, defaultValue: def.default ?? true, bind: list.map(b => b.id) });
    list.forEach(b => { b.expected.refs = { ...(b.expected.refs || {}), visible: name }; });
    props[name] = 'BOOLEAN';
  }
  for (const [name, def] of Object.entries(spec.swapProps || {})) {
    const list = bound('swap prop', name, def);
    const preferred = def.preferred || [];
    preferred.forEach(c => p.needComponent(c, []));
    p.emit({ op: 'swapProp', set: setId, name, preferred, bind: list.map(b => b.id) });
    list.forEach(b => { b.expected.refs = { ...(b.expected.refs || {}), mainComponent: name }; });
    props[name] = 'INSTANCE_SWAP';
  }
  return Object.keys(props).length ? props : null;
}

function planScreen(spec, manifest) {
  const p = new Planner(spec, manifest);
  const id = p.id();
  p.emit({ op: 'root', id, kind: 'frame', name: spec.screen });
  p.stackProps(id, { dir: 'col', gap: spec.gap, pad: spec.pad, align: spec.align, justify: spec.justify, fill: spec.fill, w: spec.size[0], h: spec.size[1] }, { root: true });
  if (spec.modes) p.emit({ op: 'modes', id, modes: spec.modes });
  p.emit({ op: 'stamp', id, key: 'figmaRender.name', value: spec.screen });
  p.emit({ op: 'stamp', id, key: 'figmaRender.hash', value: specHash(spec) });
  const children = p.children({ dir: 'col', children: spec.children }, id);
  p.tints.forEach(t => p.emit(t));
  return {
    name: spec.screen,
    hash: specHash(spec),
    kind: 'screen',
    needs: spec.modes ? { ...p.needs(), modes: spec.modes } : p.needs(),
    ops: p.ops,
    expected: { name: spec.screen, type: 'FRAME', sizing: { h: 'FIXED', v: spec.size[1] === 'hug' ? 'HUG' : 'FIXED' }, children }
  };
}

function planComponent(spec, manifest) {
  const p = new Planner(spec, manifest);
  const setId = p.id();
  p.emit({ op: 'root', id: setId, kind: 'component-set', name: spec.component });
  const textProps = spec.textProps || {};
  p.textBinds = new Map(Object.values(textProps).map(layer => [layer, []]));
  const layerProps = [...Object.values(spec.boolProps || {}), ...Object.values(spec.swapProps || {})];
  p.layerBinds = new Map(layerProps.map(def => [def.layer, []]));
  const variantIds = [];
  const expectedChildren = [];
  for (const variant of spec.variants) {
    const id = p.id();
    const name = Object.entries(variant.props).map(([k, v]) => `${k}=${v}`).join(', ');
    variantIds.push(id);
    p.emit({ op: 'frame', id, parent: null, name, component: true });
    const sizing = p.stackProps(id, variant);
    const children = p.children(variant, id);
    expectedChildren.push(withGapDrop(withOpacity(withModes(withEffects({ name, type: 'COMPONENT', sizing, children }, variant), variant), variant), variant));
  }
  p.emit({ op: 'combine', id: setId, children: variantIds, name: spec.component });
  const set = planSetLayout(p, setId, spec, variantIds);
  p.emit({ op: 'stamp', id: setId, key: 'figmaRender.name', value: spec.component });
  p.emit({ op: 'stamp', id: setId, key: 'figmaRender.hash', value: specHash(spec) });
  if (set.raw.length) p.emit({ op: 'stamp', id: setId, key: 'figmaRender.raw', value: set.raw.join(',') });
  for (const [propName, layer] of Object.entries(textProps)) {
    const bound = p.textBinds.get(layer);
    if (!bound || bound.length === 0) throw new Error(`figma-render: text prop "${propName}" names layer "${layer}", which no variant has`);
    const distinctTexts = [...new Set(bound.map(b => b.chars))];
    if (distinctTexts.length > 1) {
      const list = distinctTexts.map(t => `"${t}"`).join(', ');
      throw new Error(`figma-render: text prop "${propName}" binds layers with different text (${list}); a text property has one default, so use the same text in every variant`);
    }
    p.emit({ op: 'textProp', set: setId, name: propName, defaultValue: bound[0].chars, bind: bound.map(b => b.id) });
  }
  const props = planLayerProps(p, setId, spec);
  p.exposes.forEach(x => p.emit(x));
  p.tints.forEach(t => p.emit(t));
  const children = set.cells ? expectedChildren.map((c, i) => ({ ...c, cell: set.cells[i] })) : expectedChildren;
  const expected = { name: spec.component, type: 'COMPONENT_SET', children };
  if (set.layout) expected.layout = set.layout;
  if (props) expected.props = props;
  return {
    name: spec.component,
    hash: specHash(spec),
    kind: 'component',
    needs: p.needs(),
    ops: p.ops,
    expected
  };
}

export function planSpec(spec, { manifest = [] } = {}) {
  if ('screen' in spec) return planScreen(spec, manifest);
  if ('component' in spec) return planComponent(spec, manifest);
  throw new Error('figma-render: spec needs screen or component');
}
