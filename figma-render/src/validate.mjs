import { layerName, descendants, axisProps, gridCells } from './spec-util.mjs';

const KINDS = ['stack', 'text', 'instance', 'shape'];
const COMMON = ['w', 'h', 'abs', 'name', 'icon'];
const KEYS = {
  stack: ['stack', 'dir', 'columns', 'gap', 'pad', 'align', 'justify', 'wrap', 'fill', 'stroke', 'radius', 'clip', 'blur', 'shadow', 'innerShadow', 'modes', 'opacity', 'children', ...COMMON],
  text: ['text', 'style', 'color', 'align', 'truncate', ...COMMON],
  instance: ['instance', 'props', 'key', 'set', 'tint', 'expose', 'exposed', 'modes', 'slots', ...COMMON],
  shape: ['shape', 'kind', 'svg', 'size', 'fill', 'tint', 'stopTints', ...COMMON]
};
const SCREEN_KEYS = ['screen', 'size', 'direction', 'lang', 'fill', 'textColor', 'gap', 'pad', 'align', 'justify', 'modes', 'children'];
const COMPONENT_KEYS = ['component', 'textColor', 'direction', 'textProps', 'boolProps', 'swapProps', 'setLayout', 'variants'];
const VARIANT_KEYS = ['props', ...KEYS.stack.filter(k => k !== 'stack')];

const HEX = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;
function checkPaint(v, path, errs) {
  if (v === undefined || v === null || typeof v !== 'object') return;
  if (v.type === 'image') {
    if (typeof v.image !== 'string' || !v.image) errs.push(`${path}: image fill needs an image name`);
    if (v.scaleMode !== undefined && !['FILL', 'FIT', 'TILE'].includes(v.scaleMode)) errs.push(`${path}: scaleMode must be FILL, FIT or TILE`);
    return;
  }
  if (!['linear', 'radial'].includes(v.type)) { errs.push(`${path}: gradient type must be linear or radial`); return; }
  if (!Array.isArray(v.stops) || v.stops.length < 2) { errs.push(`${path}: gradient needs at least two stops`); return; }
  for (const s of v.stops) {
    // A stop's colour is a hex, or a colour token the stop binds (it then follows the mode).
    if (!(Array.isArray(s) && typeof s[0] === 'number' && s[0] >= 0 && s[0] <= 1 && (HEX.test(s[1]) || isToken(s[1])))) { errs.push(`${path}: gradient stop needs a position from 0 to 1 and a hex colour or a colour token`); return; }
  }
  for (const k of ['angle', 'cx', 'cy', 'r']) if (v[k] !== undefined && typeof v[k] !== 'number') errs.push(`${path}: gradient ${k} must be a number`);
}

// Size tokens are dot names (size.control.md); a bare word such as 'auto' is an error.
const isToken = v => typeof v === 'string' && /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/.test(v);
const isSize = v => v === 'fill' || v === 'hug' || (typeof v === 'number' && v > 0) || isToken(v);
const isDim = v => (Number.isInteger(v) && v > 0) || isToken(v);
const isRef = v => typeof v === 'string' || typeof v === 'number';
const isPad = v => isRef(v) || (v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).every(k => ['block', 'inline', 'top', 'bottom', 'start', 'end'].includes(k)) && Object.values(v).every(isRef));

function unknownKeys(node, allowed, path, errs) {
  for (const k of Object.keys(node)) if (!allowed.includes(k)) errs.push(`${path}: unknown key "${k}"`);
}

function checkStackProps(node, path, errs) {
  if (!['row', 'col', 'grid'].includes(node.dir)) errs.push(`${path}: stack needs dir "row", "col" or "grid"`);
  // grid: equal columns, rows that hug their tallest child; each child fills its cell
  if (node.dir === 'grid') {
    if (!(Number.isInteger(node.columns) && node.columns >= 1)) errs.push(`${path}: grid needs columns, a whole number of at least 1`);
    if (node.align !== undefined || node.justify !== undefined || node.wrap !== undefined) errs.push(`${path}: a grid takes no align, justify or wrap`);
    (node.children || []).forEach((c, i) => { if (!c.abs && (c.w !== 'fill' || c.h !== 'fill')) errs.push(`${path}: grid child ${i} needs w and h "fill" (it fills its cell)`); });
  } else if (node.columns !== undefined) errs.push(`${path}: columns is only for dir "grid"`);
  if (node.gap !== undefined && !isRef(node.gap)) errs.push(`${path}: gap must be a token name or a number`);
  if (node.pad !== undefined && !isPad(node.pad)) errs.push(`${path}: pad must be a token, a number, or an object of block, inline, top, bottom, start, end`);
  if (node.align !== undefined && !['start', 'center', 'end', 'baseline'].includes(node.align)) errs.push(`${path}: align must be start, center, end or baseline`);
  if (node.justify !== undefined && !['start', 'center', 'end', 'between'].includes(node.justify)) errs.push(`${path}: justify must be start, center, end or between`);
  if (node.wrap !== undefined && (node.wrap !== true || node.dir !== 'row')) errs.push(`${path}: wrap is only true, and only on a row`);
  const strokeColor = c => isRef(c) || (c && typeof c === 'object' && Array.isArray(c.stops));
  if (node.radius !== undefined && !(isRef(node.radius) || (Array.isArray(node.radius) && node.radius.length === 4 && node.radius.every(isRef)))) errs.push(`${path}: radius must be a token, a number, or four corners [top-left, top-right, bottom-right, bottom-left]`);
  if (node.stroke !== undefined && !(node.stroke && strokeColor(node.stroke.color) && isRef(node.stroke.width))) errs.push(`${path}: stroke needs color and width`);
  if (node.stroke && typeof node.stroke.color === 'object') checkPaint(node.stroke.color, path, errs);
  if (node.stroke && node.stroke.align !== undefined && !['inside', 'center', 'outside'].includes(node.stroke.align)) errs.push(`${path}: stroke align must be inside, center or outside`);
  if (node.stroke && node.stroke.dash !== undefined && !(Array.isArray(node.stroke.dash) && node.stroke.dash.length === 2 && node.stroke.dash.every(n => typeof n === 'number' && n > 0))) errs.push(`${path}: stroke dash must be [dash, gap], two positive numbers`);
  if (node.blur !== undefined && !(typeof node.blur === 'number' && node.blur > 0)) errs.push(`${path}: blur must be a positive number`);
  if (node.opacity !== undefined && !(isToken(node.opacity) || (typeof node.opacity === 'number' && node.opacity >= 0 && node.opacity <= 1))) errs.push(`${path}: opacity must be an opacity token or a number from 0 to 1`);
  for (const key of ['shadow', 'innerShadow']) if (node[key] !== undefined) checkShadows(node[key], `${path}: ${key}`, errs);
  if (node.modes !== undefined && !(isModes(node.modes) && Object.keys(node.modes).length)) errs.push(`${path}: modes must map collection names to mode names`);
  if (!Array.isArray(node.children)) errs.push(`${path}: stack needs children`);
}

const isModes = m => Boolean(m) && typeof m === 'object' && !Array.isArray(m) && Object.values(m).every(v => typeof v === 'string' && v);

// With the file's token plan, every collection and mode a node pins must be
// one it plans. A collection it lacks is allowed only when the spec instances
// a library component, which brings its own collections.
function checkModeNames(modes, path, ctx, errs) {
  if (!ctx.collections || !isModes(modes)) return;
  for (const [name, mode] of Object.entries(modes)) {
    const c = ctx.collections.find(x => x.name === name);
    if (!c) {
      if (!ctx.library) errs.push(`${path}: no collection "${name}" in the token plan; it has ${ctx.collections.map(x => x.name).join(', ')}`);
    } else if (!c.modes.includes(mode)) errs.push(`${path}: collection ${name} has no mode "${mode}"; it has ${c.modes.join(', ')}`);
  }
}

function usesLibrary(node) {
  if (!node || typeof node !== 'object') return false;
  if ('instance' in node && node.key) return true;
  return [...(Array.isArray(node.children) ? node.children : []), ...(Array.isArray(node.variants) ? node.variants : [])].some(usesLibrary);
}

const SHADOW_KEYS = ['x', 'y', 'blur', 'spread', 'color'];
function checkShadows(list, path, errs) {
  if (!Array.isArray(list)) { errs.push(`${path} must be a list of shadows`); return; }
  list.forEach((s, i) => {
    const at = `${path}[${i}]`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) { errs.push(`${at}: must be an object`); return; }
    unknownKeys(s, SHADOW_KEYS, at, errs);
    if (typeof s.color !== 'string' || !s.color) errs.push(`${at}: needs a color token or hex`);
    for (const k of ['x', 'y', 'spread']) if (s[k] !== undefined && !(isToken(s[k]) || typeof s[k] === 'number')) errs.push(`${at}: ${k} must be a token or a number`);
    if (s.blur !== undefined && !(isToken(s.blur) || (typeof s.blur === 'number' && s.blur >= 0))) errs.push(`${at}: blur must be a token or a number of 0 or more`);
  });
}

// An instance prop is a variant or text value, a boolean, or a swap
// { instance: component name, props: { … } } for an INSTANCE_SWAP property.
// A swap's own props follow the same rule, so a swap can hold a swap (a
// Button swapped into a slot, with its Icon swapped too).
const isSwapPropValue = x => typeof x === 'string' || typeof x === 'boolean' || (x !== null && typeof x === 'object' && !Array.isArray(x));
function checkInstanceProps(props, path, errs) {
  for (const [k, v] of Object.entries(props)) {
    if (v === null || Array.isArray(v)) { errs.push(`${path}: props "${k}" must be a string, a boolean or a swap`); continue; }
    if (typeof v !== 'object') continue;
    if (typeof v.instance !== 'string' || !v.instance) errs.push(`${path}: props "${k}" swaps need an instance name`);
    unknownKeys(v, ['instance', 'props', 'exposed'], `${path}: props "${k}"`, errs);
    // The swapped-in component's own exposed instances (a Card's Content
    // swapped for a List group whose rows are exposed).
    if (v.exposed !== undefined) checkExposed(v.exposed, `${path}: props "${k}"`, errs);
    if (v.props === undefined) continue;
    if (!(v.props && typeof v.props === 'object' && !Array.isArray(v.props) && Object.values(v.props).every(isSwapPropValue))) {
      errs.push(`${path}: props "${k}" swap props must map names to strings, booleans or swaps`);
      continue;
    }
    checkInstanceProps(v.props, `${path}: props "${k}"`, errs);
  }
}

// exposed: { layer name: { prop: value } } sets the props of a nested instance
// the component exposes (expose: true on that instance in its own spec).
function checkExposed(exposed, path, errs) {
  if (!exposed || typeof exposed !== 'object' || Array.isArray(exposed)) { errs.push(`${path}: exposed must map layer names to props`); return; }
  // Values are strings or booleans, or swaps checked as instance props are.
  const ok = v => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => typeof x === 'string' || typeof x === 'boolean' || (x !== null && typeof x === 'object' && !Array.isArray(x)));
  for (const [layer, props] of Object.entries(exposed)) {
    if (!ok(props)) errs.push(`${path}: exposed "${layer}" must map prop names to strings or booleans`);
    else checkInstanceProps(props, `${path}: exposed "${layer}"`, errs);
  }
}

function checkNode(node, path, ctx, errs) {
  if (!node || typeof node !== 'object') { errs.push(`${path}: node must be an object`); return; }
  const kinds = KINDS.filter(k => k in node);
  if (kinds.length !== 1) { errs.push(`${path}: exactly one of stack, text, instance, shape`); return; }
  const kind = kinds[0];
  unknownKeys(node, KEYS[kind], path, errs);
  checkPaint(node.fill, path, errs);
  for (const axis of ['w', 'h']) if (node[axis] !== undefined && !isSize(node[axis])) errs.push(`${path}: ${axis} must be "fill", "hug", a positive number or a size token`);
  if (node.abs !== undefined) {
    const a = node.abs;
    const num = k => a && typeof a[k] === 'number';
    if (a && num('top') && num('bottom')) { if (!num('start') || !num('end')) errs.push(`${path}: abs top and bottom together need start and end (a full cover)`); }
    else if (!a || num('top') === num('bottom')) errs.push(`${path}: abs needs exactly one of top or bottom`);
    else if (!num('start') && !num('end')) errs.push(`${path}: abs needs start, end or both (both stretches it between them)`);
  }
  if (node.icon !== undefined && ctx.rtl && !ctx.manifest.some(m => m.name === node.icon)) {
    errs.push(`${path}: icon "${node.icon}" is not in the mirroring manifest`);
  }
  if (kind === 'stack') {
    if (typeof node.stack !== 'string' || !node.stack) errs.push(`${path}: stack needs a name`);
    checkStackProps(node, path, errs);
    checkModeNames(node.modes, path, ctx, errs);
    (node.children || []).forEach((c, i) => checkNode(c, `${path}.children[${i}]`, ctx, errs));
  }
  if (kind === 'text') {
    if (typeof node.text !== 'string') errs.push(`${path}: text must be a string`);
    if (typeof node.style !== 'string' || !node.style) errs.push(`${path}: text needs style`);
    if (node.color === undefined && !ctx.textColor) errs.push(`${path}: text needs color or screen textColor`);
    if (node.h !== undefined && node.h !== 'hug') errs.push(`${path}: text height is always hug`);
    if (isToken(node.w)) errs.push(`${path}: text width is fill, hug or a number`);
    if (node.align !== undefined && !['start', 'center', 'end'].includes(node.align)) errs.push(`${path}: text align must be start, center or end`);
    if (node.truncate !== undefined && node.truncate !== true) errs.push(`${path}: truncate is only true`);
    if (node.truncate === true && !(node.w === 'fill' || typeof node.w === 'number')) errs.push(`${path}: truncate needs a fill or fixed width`);
  }
  if (kind === 'instance') {
    if (typeof node.instance !== 'string' || !node.instance) errs.push(`${path}: instance needs a component name`);
    // An instance may pin a mode over the one its main component pins.
    if (node.modes !== undefined && !(isModes(node.modes) && Object.keys(node.modes).length)) errs.push(`${path}: modes must map collection names to mode names`);
    checkModeNames(node.modes, path, ctx, errs);
    if (node.expose !== undefined && node.expose !== true) errs.push(`${path}: expose is only true`);
    if (node.expose === true && ctx.screen) errs.push(`${path}: expose only works inside a component`);
    if (node.exposed !== undefined) checkExposed(node.exposed, path, errs);
    if (node.props !== undefined && (typeof node.props !== 'object' || Array.isArray(node.props) || node.props === null)) errs.push(`${path}: props must be an object`);
    else if (node.props !== undefined) checkInstanceProps(node.props, path, errs);
    if (node.key !== undefined && (typeof node.key !== 'string' || !node.key)) errs.push(`${path}: key must be a component key string`);
    if (node.set !== undefined && node.set !== true) errs.push(`${path}: set is only true, for a component set key`);
    if (node.tint !== undefined && (typeof node.tint !== 'string' || !node.tint)) errs.push(`${path}: tint must be a colour token name`);
    if (node.slots !== undefined) {
      if (!node.slots || typeof node.slots !== 'object' || Array.isArray(node.slots)) errs.push(`${path}: slots must map slot names to children`);
      else for (const [name, value] of Object.entries(node.slots)) {
        const kids = Array.isArray(value) ? value : value && value.children;
        if (!Array.isArray(kids)) { errs.push(`${path}: slot "${name}" needs a list of children or { dir, children }`); continue; }
        if (!Array.isArray(value) && value.dir !== undefined && !['row', 'col'].includes(value.dir)) errs.push(`${path}: slot "${name}" dir must be row or col`);
        if (!Array.isArray(value) && value.h !== undefined && value.h !== 'fill') errs.push(`${path}: slot "${name}" h is only fill (the slot fills its instance's height)`);
        kids.forEach((c, i) => checkNode(c, `${path}.slots.${name}[${i}]`, ctx, errs));
        // Figma links an instance placed inside its own component's slot to the outer one (a rename renames both)
        const walk = n => (n && typeof n === 'object' ? [n, ...(n.children || []).flatMap(walk), ...Object.values(n.slots || {}).flatMap(x => (Array.isArray(x) ? x : x.children || [])).flatMap(walk)] : []);
        if (kids.flatMap(walk).some(n => n.instance === node.instance)) errs.push(`${path}: ${node.instance} inside its own slot "${name}": Figma links the two instances, so use another component or a stack inside`);
      }
    }
  }
  if (kind === 'shape') {
    if (typeof node.shape !== 'string' || !node.shape) errs.push(`${path}: shape needs a name`);
    if (!['rect', 'ellipse', 'svg'].includes(node.kind)) errs.push(`${path}: shape kind must be rect, ellipse or svg`);
    if (!(Array.isArray(node.size) && node.size.length === 2 && node.size.every(isDim))) errs.push(`${path}: shape needs size [width, height] of positive integers or size tokens`);
    if (node.kind === 'svg' && typeof node.svg !== 'string') errs.push(`${path}: svg shape needs svg markup`);
    if (node.tint !== undefined && node.kind !== 'svg') errs.push(`${path}: tint is only for svg shapes`);
    if (node.tint !== undefined && typeof node.tint !== 'string') errs.push(`${path}: tint must be a colour token name`);
    if (node.stopTints !== undefined && node.kind !== 'svg') errs.push(`${path}: stopTints is only for svg shapes`);
    else if (node.stopTints !== undefined && !(Array.isArray(node.stopTints) && node.stopTints.length >= 2 && node.stopTints.every(isToken))) errs.push(`${path}: stopTints must be a list of two or more colour tokens`);
  }
}

// opts.collections is the file's token plan collections ([{ name, modes }]);
// given, the modes a spec pins are checked against it.
export function validateSpec(spec, manifest = [], opts = {}) {
  const errs = [];
  if (!spec || typeof spec !== 'object') return ['root: spec must be an object'];
  const planned = { collections: opts.collections || null, library: usesLibrary(spec) };
  if ('screen' in spec) {
    unknownKeys(spec, SCREEN_KEYS, 'root', errs);
    // The height may hug, for notes and annotation frames; the width is always set.
    if (!(Array.isArray(spec.size) && spec.size.length === 2 && isDim(spec.size[0]) && (isDim(spec.size[1]) || spec.size[1] === 'hug'))) errs.push('root: screen needs size [width, height] of positive integers or size tokens (the height may be hug)');
    if (spec.direction !== undefined && !['ltr', 'rtl'].includes(spec.direction)) errs.push('root: direction must be ltr or rtl');
    const m = spec.modes;
    if (m !== undefined && !(m && typeof m === 'object' && !Array.isArray(m) && Object.values(m).every(v => typeof v === 'string' && v))) errs.push('root: modes must map collection names to mode names');
    checkModeNames(spec.modes, 'root', planned, errs);
    checkPaint(spec.fill, 'root', errs);
    if (!Array.isArray(spec.children)) { errs.push('root: screen needs children'); return errs; }
    const ctx = { rtl: spec.direction === 'rtl', manifest, textColor: spec.textColor, screen: true, ...planned };
    spec.children.forEach((c, i) => checkNode(c, `children[${i}]`, ctx, errs));
    return errs;
  }
  if ('component' in spec) {
    unknownKeys(spec, COMPONENT_KEYS, 'root', errs);
    if (!Array.isArray(spec.variants) || spec.variants.length === 0) { errs.push('root: component needs variants'); return errs; }
    const ctx = { rtl: spec.direction === 'rtl', manifest, textColor: spec.textColor, ...planned };
    spec.variants.forEach((v, i) => {
      const path = `variants[${i}]`;
      unknownKeys(v, VARIANT_KEYS, path, errs);
      if (!v.props || typeof v.props !== 'object' || Object.keys(v.props).length === 0) errs.push(`${path}: variant needs at least one prop`);
      checkStackProps(v, path, errs);
      checkModeNames(v.modes, path, ctx, errs);
      (v.children || []).forEach((c, j) => checkNode(c, `${path}.children[${j}]`, ctx, errs));
    });
    if (errs.length === 0) checkComponentProps(spec, errs);
    if (spec.setLayout !== undefined && errs.length === 0) checkSetLayout(spec, errs);
    return errs;
  }
  return ['root: spec needs screen or component'];
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const instanceLabel = n => {
  const props = Object.entries(n.props || {}).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}=${v}`);
  return props.length ? `${n.instance} (${props.join(', ')})` : n.instance;
};

// Bool and swap props name a layer that every variant must have, unless the
// prop is marked partial (then at least one variant has it); a swap layer must
// be an instance. Property names are unique across every kind.
function checkComponentProps(spec, errs) {
  const variantProps = new Set(spec.variants.flatMap(v => Object.keys(v.props)));
  const taken = new Set(Object.keys(spec.textProps || {}));
  for (const key of ['boolProps', 'swapProps']) {
    const group = spec[key];
    if (group === undefined) continue;
    if (!isObj(group)) { errs.push(`root: ${key} must map property names to { layer, ... }`); continue; }
    for (const [name, def] of Object.entries(group)) {
      const at = `root: ${key} "${name}"`;
      if (variantProps.has(name)) errs.push(`${at}: the name is already a variant prop`);
      else if (taken.has(name)) errs.push(`${at}: the name is already a property`);
      taken.add(name);
      if (!isObj(def)) { errs.push(`${at}: must be an object`); continue; }
      unknownKeys(def, key === 'boolProps' ? ['layer', 'default', 'partial'] : ['layer', 'preferred', 'partial'], at, errs);
      if (typeof def.layer !== 'string' || !def.layer) { errs.push(`${at}: needs a layer name`); continue; }
      if (key === 'boolProps' && def.default !== undefined && typeof def.default !== 'boolean') errs.push(`${at}: default must be true or false`);
      if (def.partial !== undefined && typeof def.partial !== 'boolean') errs.push(`${at}: partial must be true or false`);
      if (key === 'swapProps' && def.preferred !== undefined && !(Array.isArray(def.preferred) && def.preferred.every(p => typeof p === 'string' && p))) errs.push(`${at}: preferred must be a list of component names`);
      const shows = [];
      let found = 0;
      spec.variants.forEach((v, i) => {
        const layers = descendants(v).filter(n => layerName(n) === def.layer);
        if (layers.length) found++;
        if (layers.length === 0) { if (def.partial !== true) errs.push(`${at}: variants[${i}] has no layer "${def.layer}"`); }
        else if (key === 'swapProps' && layers.some(n => !('instance' in n))) errs.push(`${at}: layer "${def.layer}" in variants[${i}] is not an instance`);
        else if (key === 'swapProps') layers.forEach(n => shows.push([i, instanceLabel(n)]));
      });
      if (def.partial === true && found === 0) errs.push(`${at}: no variant has a layer "${def.layer}"`);
      // Figma keeps one component per INSTANCE_SWAP property across the whole set.
      const odd = shows.find(([, label]) => label !== (shows[0] || [])[1]);
      if (odd) errs.push(`${at}: layer "${def.layer}" shows ${shows[0][1]} in variants[${shows[0][0]}] but ${odd[1]} in variants[${odd[0]}]; an instance swap property holds one component for the whole set, so every bound layer must show the same one`);
    }
  }
}

const SET_LAYOUT_KEYS = ['wrap', 'width', 'rows', 'columns', 'order', 'gap', 'pad', 'fill'];
const isAxis = a => (typeof a === 'string' && a) || (Array.isArray(a) && a.length > 0 && a.every(p => typeof p === 'string' && p));

// A set is laid out either as a wrapping row of a fixed width, or as a grid
// whose rows and columns are variant props.
function checkSetLayout(spec, errs) {
  const l = spec.setLayout;
  if (!isObj(l)) { errs.push('root: setLayout must be an object'); return; }
  const before = errs.length;
  unknownKeys(l, SET_LAYOUT_KEYS, 'root: setLayout', errs);
  if (l.gap !== undefined && !isRef(l.gap)) errs.push('root: setLayout: gap must be a token name or a number');
  if (l.pad !== undefined && !isPad(l.pad)) errs.push('root: setLayout: pad must be a token, a number, or an object of block, inline, top, bottom, start, end');
  // A backdrop for the set frame, as a stack fill: a colour token, a hex or a gradient.
  if (l.fill !== undefined) {
    if (typeof l.fill === 'object' && l.fill !== null) checkPaint(l.fill, 'root: setLayout', errs);
    else if (typeof l.fill !== 'string' || !l.fill) errs.push('root: setLayout: fill must be a colour token, a hex or a gradient');
  }
  const wrapForm = l.wrap !== undefined || l.width !== undefined;
  const gridForm = l.rows !== undefined || l.columns !== undefined || l.order !== undefined;
  if (wrapForm && gridForm) { errs.push('root: setLayout: use wrap and width, or rows and columns, not both'); return; }
  if (!wrapForm && !gridForm) { errs.push('root: setLayout: needs wrap and width, or rows and columns'); return; }
  if (wrapForm) {
    if (l.wrap !== true) errs.push('root: setLayout: wrap is only true');
    if (l.width === undefined) errs.push('root: setLayout: wrap needs a width');
    else if (!(Number.isInteger(l.width) && l.width > 0)) errs.push('root: setLayout: width must be a positive integer');
    return;
  }
  if (!isAxis(l.rows) || !isAxis(l.columns)) { errs.push('root: setLayout: a grid needs rows and columns, each a variant prop name or a list of them'); return; }
  const props = [...axisProps(l.rows), ...axisProps(l.columns)];
  spec.variants.forEach((v, i) => { for (const p of props) if (!(p in v.props)) errs.push(`root: setLayout: variants[${i}] has no prop "${p}"`); });
  if (l.order !== undefined) {
    if (!isObj(l.order) || !Object.values(l.order).every(a => Array.isArray(a) && a.every(x => typeof x === 'string'))) errs.push('root: setLayout: order must map prop names to lists of values');
    else for (const [p, values] of Object.entries(l.order)) {
      if (!props.includes(p)) { errs.push(`root: setLayout: order names "${p}", which is not a row or column prop`); continue; }
      for (const v of spec.variants) if (p in v.props && !values.includes(v.props[p])) { errs.push(`root: setLayout: order for "${p}" leaves out "${v.props[p]}"`); break; }
    }
  }
  if (errs.length > before) return;
  const { cells } = gridCells(spec.variants, l);
  const label = (v, axis) => axisProps(axis).map(p => v.props[p]).join(' / ');
  cells.forEach((c, i) => {
    const j = cells.findIndex(d => d[0] === c[0] && d[1] === c[1]);
    if (j < i) errs.push(`root: setLayout: variants[${j}] and variants[${i}] both sit in row "${label(spec.variants[i], l.rows)}", column "${label(spec.variants[i], l.columns)}"`);
  });
}

// Figma ignores itemSpacing under space-between, so a stack that hugs its main
// axis with justify between and a gap packs its children with no gap at all.
// Not an error (the spec renders), but never what the gap says.
export const dropsGap = n => n && n.justify === 'between' && n.gap !== undefined && n.gap !== 0 &&
  ((n.dir === 'col' && (n.h === undefined || n.h === 'hug')) || (n.dir === 'row' && (n.w === undefined || n.w === 'hug')));
const GAP_WARNING = 'justify between with a gap on a hugging axis; Figma drops the gap, so the children touch';

export function specWarnings(spec) {
  const out = [];
  const walk = (n, path) => {
    if (!n || typeof n !== 'object') return;
    if (('stack' in n || path.startsWith('variants')) && dropsGap(n)) out.push(`${path}: ${GAP_WARNING}`);
    (Array.isArray(n.children) ? n.children : []).forEach((c, i) => walk(c, `${path}.children[${i}]`));
  };
  if (spec && Array.isArray(spec.children)) spec.children.forEach((c, i) => walk(c, `children[${i}]`));
  if (spec && Array.isArray(spec.variants)) spec.variants.forEach((v, i) => walk(v, `variants[${i}]`));
  return out;
}
