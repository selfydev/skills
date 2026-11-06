// A consumer file binds a published design system: tokens and components that are not local come in by key.
// The manifest is { variables: { 'space/gap/md': key }, textStyles: { 'body/md': key }, components: { Button: { key, set } } }.
// withLibrary keeps only the keys this plan needs, so the payload stays small; a local token or component always wins
// at runtime, and one that is neither local nor in the manifest still stops the render.
const dot = name => name.replace(/\//g, '.');

export function withLibrary(plan, manifest) {
  if (!manifest) return plan;
  const vars = Object.fromEntries(Object.entries(manifest.variables || {}).filter(([, k]) => k).map(([n, k]) => [dot(n), k]));
  const styles = manifest.textStyles || {};
  const comps = manifest.components || {};
  const pick = (names, from) => Object.fromEntries(names.filter(n => from[n]).map(n => [n, from[n]]));
  const components = plan.needs.components.map(c => (c.key || !comps[c.name] ? c : { ...c, key: comps[c.name].key, set: comps[c.name].set === true }));
  return {
    ...plan,
    needs: { ...plan.needs, components },
    library: { variables: pick(plan.needs.variables, vars), textStyles: pick(plan.needs.textStyles, styles) },
  };
}
