export const CHECKS = ['auto-layout', 'positioning', 'overlap', 'overflow', 'clipped-text', 'half-pixels', 'default-names', 'unbound-values', 'spec-parity'];
const DEFAULT_NAME = /^(Frame|Rectangle|Ellipse|Group|Text|Vector|Component|Instance|Line|Polygon|Star|Section)\s\d+$/;
const CONTAINERS = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
const TOL = 0.5;

export function gate(snap, plan) {
  const res = Object.fromEntries(CHECKS.map(c => [c, { check: c, status: 'pass', nodes: [] }]));
  const fail = (c, n, detail) => { res[c].status = 'fail'; res[c].nodes.push({ id: n.id, name: n.name, detail }); };
  const warn = (c, n, detail) => { if (res[c].status === 'pass') res[c].status = 'warn'; res[c].nodes.push({ id: n.id, name: n.name, detail: `warn: ${detail}` }); };
  const isShape = n => n.plugin.kind === 'shape';
  const isAbs = n => n.layoutPositioning === 'ABSOLUTE' || n.plugin.abs === '1';

  // A layer a bool prop hides is not laid out, so its stale geometry is not
  // checked; its names, bindings and parity still are. Only a bool-bound layer
  // counts: any other invisible layer can never be shown, so it stays checked.
  const off = new Set();
  const hidden = n => (n.visible === false && Boolean(n.refs && n.refs.visible)) || off.has(n);
  const walk = (n, parent) => {
    if (hidden(n)) n.children.forEach(c => off.add(c));
    if (CONTAINERS.includes(n.type) && !isShape(n) && (!n.layoutMode || n.layoutMode === 'NONE')) fail('auto-layout', n, 'no auto-layout');
    if (parent && n.layoutPositioning === 'ABSOLUTE' && n.plugin.abs !== '1') fail('positioning', n, 'absolute but not marked abs in the spec');
    if (n.type === 'TEXT' && !['HEIGHT', 'WIDTH_AND_HEIGHT'].includes(n.textAutoResize)) fail('clipped-text', n, `textAutoResize is ${n.textAutoResize}`);
    for (const k of hidden(n) ? [] : ['x', 'y', 'width', 'height']) {
      if (Math.abs(n[k] - Math.round(n[k])) > 0.01) {
        const sizing = n.sizing;
        const fixed = k === 'width' ? (sizing ? sizing.h === 'FIXED' : true)
          : k === 'height' ? (sizing ? sizing.v === 'FIXED' : true)
          : false;
        if (fixed) fail('half-pixels', n, `${k} is ${n[k]}`);
        else warn('half-pixels', n, `${k} is ${n[k]} (measured, not fixed)`);
        break;
      }
    }
    if (DEFAULT_NAME.test(n.name)) fail('default-names', n, 'default layer name');
    const raw = n.plugin.raw ? n.plugin.raw.split(',') : [];
    for (const f of n.unbound) {
      if (raw.includes(f)) warn('unbound-values', n, `${f} is a deliberate raw value`);
      else fail('unbound-values', n, `${f} is not bound to a variable`);
    }
    if (parent && !hidden(n)) {
      const outside = n.x < parent.x - TOL || n.y < parent.y - TOL ||
        n.x + n.width > parent.x + parent.width + TOL || n.y + n.height > parent.y + parent.height + TOL;
      if (outside) {
        if (isAbs(n)) warn('overflow', n, 'absolute node extends past its parent');
        else if (parent.clips) warn('overflow', n, `clipped by ${parent.name}`);
        else fail('overflow', n, `extends past ${parent.name}`);
      }
    }
    const flow = n.children.filter(c => !isAbs(c) && !hidden(c));
    for (let i = 0; i < flow.length; i++) {
      for (let j = i + 1; j < flow.length; j++) {
        const a = flow[i];
        const b = flow[j];
        const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (ix > TOL && iy > TOL) {
          if (n.gap < 0) warn('overlap', a, `overlaps ${b.name}: stacked by a negative gap (${n.gap})`);
          else fail('overlap', a, `overlaps ${b.name}`);
        }
      }
    }
    n.children.forEach(c => walk(c, n));
    (n.slots || []).forEach(c => walk(c, n));
  };
  walk(snap, null);

  if (snap.plugin.hash !== plan.hash) fail('spec-parity', snap, `rendered from spec ${snap.plugin.hash || 'unknown'}, plan is ${plan.hash}`);
  const compare = (e, s, path) => {
    if (e.name !== s.name) fail('spec-parity', s, `${path}: expected name "${e.name}", found "${s.name}"`);
    // a frame linked as a slot becomes a SLOT node once Figma converts it; it is still the planned frame
    const typeOk = e.type === 'SHAPE' ? isShape(s) : e.type === s.type || (e.type === 'FRAME' && s.type === 'SLOT');
    if (!typeOk) fail('spec-parity', s, `${path}: expected ${e.type}, found ${s.type}`);
    if (e.sizing && s.sizing) {
      for (const axis of ['h', 'v']) {
        if (e.sizing[axis] && e.sizing[axis] !== s.sizing[axis]) fail('spec-parity', s, `${path}: expected ${axis} ${e.sizing[axis]}, found ${s.sizing[axis]}`);
      }
    }
    compareExtras(e, s, path);
    for (const es of e.slots || []) {
      const ss = (s.slots || []).find(x => x.name === es.name);
      if (!ss) fail('spec-parity', s, `${path}: expected slot ${es.name} filled, found it not filled`);
      else compare(es, ss, `${path}/${es.name}`);
    }
    if (e.type === 'INSTANCE' || e.type === 'SHAPE') return;
    if (e.children.length !== s.children.length) {
      fail('spec-parity', s, `${path}: expected ${e.children.length} children, found ${s.children.length}`);
      return;
    }
    e.children.forEach((c, i) => compare(c, s.children[i], `${path}/${c.name}`));
  };
  // Set layout, grid cells, bool and swap bindings, and effects exist in a
  // plan only when the spec asked for them, so older plans skip these checks.
  const compareExtras = (e, s, path) => {
    const f = detail => fail('spec-parity', s, `${path}: ${detail}`);
    if (e.layout) {
      if (s.layoutMode !== e.layout.mode) f(`expected set layout ${e.layout.mode}, found ${s.layoutMode}`);
      else if (e.layout.mode === 'GRID') {
        const g = s.grid || {};
        if (g.rows !== e.layout.rows || g.columns !== e.layout.columns) f(`expected a grid of ${e.layout.rows} rows and ${e.layout.columns} columns, found ${g.rows} and ${g.columns}`);
      } else {
        if (s.wrap !== 'WRAP') f(`expected the set to wrap, found ${s.wrap}`);
        if (!s.sizing || s.sizing.h !== 'FIXED' || Math.abs(s.width - e.layout.width) > TOL) f(`expected set width ${e.layout.width}, found ${s.width}`);
      }
    }
    if (e.cell) {
      const c = s.cell;
      if (!c || c[0] !== e.cell[0] || c[1] !== e.cell[1]) f(`expected cell ${e.cell.join(',')}, found ${c ? c.join(',') : 'none'}`);
    }
    for (const [name, type] of Object.entries(e.props || {})) {
      const found = (s.props || {})[name];
      if (found !== type) f(`expected property "${name}" (${type}), found ${found || 'none'}`);
    }
    for (const [field, prop] of Object.entries(e.refs || {})) {
      const found = (s.refs || {})[field];
      if (found !== prop) f(`expected ${field} bound to "${prop}", found ${found ? `"${found}"` : 'none'}`);
    }
    // A screen's root modes live in the plan's needs; any other node's in its
    // expected entry. A snapshot taken before modes were recorded has none.
    if ('modes' in s) {
      const want = e === plan.expected && plan.kind === 'screen' ? (plan.needs && plan.needs.modes) : e.modes;
      if (modeLabel(want) !== modeLabel(s.modes)) f(`expected modes ${modeLabel(want)}, found ${modeLabel(s.modes)}`);
    }
    // A snapshot taken before exposure was recorded has no exposed field.
    if ('exposed' in s && Boolean(e.exposed) !== s.exposed) f(e.exposed ? 'expected an exposed instance, found it not exposed' : 'expected an instance that is not exposed, found it exposed');
    // Opacity is checked where the plan expects it, or where the snapshot
    // finds a node dimmed that the plan leaves at full.
    if (e.opacity || 'opacity' in s) {
      const found = 'opacity' in s ? s.opacity : 1;
      if (e.opacity && e.opacity.raw !== undefined && Math.abs(found - e.opacity.raw) > 0.005) f(`expected opacity ${e.opacity.raw}, found ${found}`);
      if (e.opacity && e.opacity.var) {
        const v = s.opacityVar;
        if (found === 1 || !v) f(`expected opacity bound to ${e.opacity.var}, found ${found}${v ? '' : ' unbound'}`);
        else if (v.name.replace(/\//g, '.') !== e.opacity.var) f(`expected opacity bound to ${e.opacity.var}, found ${v.name}`);
        // Figma reads a variable bound to layer opacity as a percentage.
        else if (typeof v.value === 'number' && v.value <= 1) f(`${v.name} is ${v.value}; Figma reads opacity variables as percentages, so it dims to ${v.value}%`);
        else if (typeof v.value === 'number' && Math.abs(found - v.value / 100) > 0.005) f(`expected opacity ${v.value / 100} from ${v.name} (${v.value}), found ${found}`);
      }
      if (!e.opacity && e.type !== 'INSTANCE') f(`expected opacity 1, found ${found}`);
    }
    if (e.dropsGap !== undefined) warn('auto-layout', s, `justify between on a hugging axis: Figma drops the ${e.dropsGap} gap, so the children touch`);
    if (e.effects) {
      const found = s.effects || [];
      if (found.join(',') !== e.effects.join(',')) f(`expected effects ${e.effects.join(', ')}, found ${found.length ? found.join(', ') : 'none'}`);
    }
  };
  compare(plan.expected, snap, plan.expected.name);

  const checks = CHECKS.map(c => res[c]);
  return { pass: checks.every(c => c.status !== 'fail'), checks };
}

const modeLabel = m => (m && Object.keys(m).length ? Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([c, v]) => `${c}: ${v}`).join(', ') : 'none');

export function formatGate(result) {
  const lines = [];
  for (const c of result.checks) {
    lines.push(`${c.check.padEnd(16)}${c.status}`);
    for (const n of c.nodes) lines.push(`  ${n.name} (${n.id}): ${n.detail}`);
  }
  lines.push(`${'result'.padEnd(16)}${result.pass ? 'pass' : 'fail'}`);
  return lines.join('\n');
}
