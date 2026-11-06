// Helpers the validator and the planner share.

// The Figma layer name a spec node gets.
export function layerName(node) {
  if ('stack' in node) return node.name ?? node.stack;
  if ('text' in node) return node.name ?? String(node.text).trim().slice(0, 32);
  if ('instance' in node) return node.name ?? node.instance;
  if ('shape' in node) return node.name ?? node.shape;
  return node.name;
}

// Every node in a variant's tree, the variant itself excluded.
export function descendants(variant) {
  const out = [];
  const walk = n => { if (!n || typeof n !== 'object') return; out.push(n); (Array.isArray(n.children) ? n.children : []).forEach(walk); };
  (Array.isArray(variant.children) ? variant.children : []).forEach(walk);
  return out;
}

export const axisProps = axis => (Array.isArray(axis) ? axis : [axis]);

// Grid rows and columns of a component set: each axis is one variant prop or a
// list of them. A prop's values rank by setLayout.order when given, otherwise by
// first appearance in the spec; tuples sort prop by prop.
function axisIndex(variants, props, order) {
  const rank = {};
  for (const p of props) {
    const seen = [];
    for (const v of variants) if (!seen.includes(v.props[p])) seen.push(v.props[p]);
    rank[p] = order && Array.isArray(order[p]) ? order[p] : seen;
  }
  const tuple = v => props.map(p => rank[p].indexOf(v.props[p]));
  const keys = [];
  for (const v of variants) {
    const k = tuple(v).join(',');
    if (!keys.some(x => x.join(',') === k)) keys.push(tuple(v));
  }
  keys.sort((a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; });
  const flat = keys.map(k => k.join(','));
  return { count: keys.length, of: v => flat.indexOf(tuple(v).join(',')) };
}

export function gridCells(variants, setLayout) {
  const rows = axisIndex(variants, axisProps(setLayout.rows), setLayout.order);
  const cols = axisIndex(variants, axisProps(setLayout.columns), setLayout.order);
  return { rows: rows.count, columns: cols.count, cells: variants.map(v => [rows.of(v), cols.of(v)]) };
}
