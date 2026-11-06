// Sandbox script for figma_execute: writes a TokenPlan (src/tokens.mjs) into
// the file as variable collections and text styles, updating in place on
// re-runs so node bindings survive. No imports, no exports, no top-level
// await. Helpers are prefixed fr because runtime files are concatenated.

const FR_TOKEN_STAMP = 'figmaRender.token';
const FR_VARIABLE_TYPES = ['COLOR', 'FLOAT', 'STRING'];
const FR_SKIP_REASON = 'skipped (no Figma variable type)';
const FR_SCOPES_BY_TYPE = {
  COLOR: ['ALL_SCOPES', 'ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR', 'EFFECT_COLOR'],
  FLOAT: ['ALL_SCOPES', 'TEXT_CONTENT', 'CORNER_RADIUS', 'WIDTH_HEIGHT', 'GAP', 'STROKE_FLOAT', 'OPACITY', 'EFFECT_FLOAT',
    'FONT_WEIGHT', 'FONT_SIZE', 'LINE_HEIGHT', 'LETTER_SPACING', 'PARAGRAPH_SPACING', 'PARAGRAPH_INDENT'],
  STRING: ['ALL_SCOPES', 'TEXT_CONTENT', 'FONT_FAMILY', 'FONT_STYLE'],
  BOOLEAN: ['ALL_SCOPES']
};
const FR_FILL_SCOPES = ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL'];
const FR_WEIGHT_STYLES = {
  100: ['Thin'], 200: ['ExtraLight', 'Extra Light', 'Extralight'], 300: ['Light'], 400: ['Regular', 'Book'], 500: ['Medium'],
  600: ['SemiBold', 'Semi Bold', 'Semibold'], 700: ['Bold'], 800: ['ExtraBold', 'Extra Bold', 'Extrabold'], 900: ['Black']
};

async function importTokens(plan, opts) {
  const options = frOptions(opts);
  frCheckPlan(plan);
  const file = await frReadFile();
  const owned = frClaim(plan, file, options.adopt);
  frCheckTypes(plan, file, owned);
  const collections = frUpsertCollections(plan, owned, options.adopt);
  const variables = frUpsertVariables(plan, collections, file);
  const byName = new Map(variables.map(entry => [entry.spec.name, entry.variable]));
  frSetValues(plan, collections, byName);
  const styles = await frUpsertTextStyles(plan.textStyles || [], owned, byName);
  const stale = await frStaleWithUsage(frStale(file, frKept(variables, styles, owned)));
  const pruned = options.prune ? frPrune(stale, options.force) : { removed: 0, keptInUse: [] };
  return frReport(plan, { variables, styles, stale, pruned, collections: [...collections.values()] });
}

function frOptions(opts) {
  const flag = name => Boolean(opts && opts[name]);
  return { prune: flag('prune'), adopt: flag('adopt'), force: flag('force') };
}

// ---------- checking the plan (nothing is written until it passes) ----------

function frCheckPlan(plan) {
  if (!plan || !Array.isArray(plan.collections)) throw new Error('figma-render: a token plan needs a collections list');
  const specs = plan.collections.flatMap(c => frCheckCollection(c).variables.map(v => ({ collection: c.name, spec: v })));
  const types = frPlannedTypes(specs);
  frCheckStyleNames(plan.textStyles || []);
  specs.forEach(({ collection, spec }) => frCheckValues(collection, spec, types));
  (plan.textStyles || []).forEach(style => frCheckStyle(style, types));
}

function frPlannedTypes(specs) {
  return specs.reduce((types, { collection, spec }) => {
    if (types.has(spec.name)) throw new Error(`figma-render: variable ${spec.name} is planned twice`);
    if (!FR_VARIABLE_TYPES.includes(spec.type)) throw new Error(`figma-render: variable ${collection}/${spec.name} has type ${spec.type}, which Figma variables do not support`);
    frCheckScopes(`${collection}/${spec.name}`, spec.type, spec.scopes || []);
    return new Map(types).set(spec.name, spec.type);
  }, new Map());
}

function frCheckCollection(collection) {
  if (!collection || !collection.name || !Array.isArray(collection.variables) || !Array.isArray(collection.modes) || !collection.modes.length) {
    throw new Error('figma-render: every planned collection needs a name, a variables list and at least one mode');
  }
  collection.variables.forEach(spec => {
    const unknown = Object.keys(spec.values || {}).filter(mode => !collection.modes.includes(mode));
    if (unknown.length) throw new Error(`figma-render: ${spec.name} has values for ${unknown.join(', ')}, which ${collection.name} has no mode for`);
  });
  return collection;
}

function frCheckScopes(label, type, scopes) {
  const fail = why => { throw new Error(`figma-render: variable ${label} has scopes ${JSON.stringify(scopes)}: ${why}`); };
  const wrong = scopes.filter(scope => !FR_SCOPES_BY_TYPE[type].includes(scope));
  if (wrong.length) fail(`${wrong.join(', ')} is not a scope a ${type} variable can have`);
  if (scopes.includes('ALL_SCOPES') && scopes.length > 1) fail('ALL_SCOPES cannot be combined with another scope');
  if (scopes.includes('ALL_FILLS') && scopes.some(scope => FR_FILL_SCOPES.includes(scope))) {
    fail('ALL_FILLS already covers FRAME_FILL, SHAPE_FILL and TEXT_FILL, so it cannot be combined with them');
  }
}

function frCheckStyleNames(styles) {
  styles.reduce((seen, style) => {
    if (seen.has(style.name)) throw new Error(`figma-render: text style ${style.name} is planned twice`);
    return new Set(seen).add(style.name);
  }, new Set());
}

const frIsAlias = value => Boolean(value) && typeof value === 'object' && 'alias' in value;

// Every mode's value is checked against the variable's own type: an alias
// must point at a planned variable of that type, a literal must be one.
function frCheckValues(collection, spec, types) {
  Object.entries(spec.values).forEach(([mode, value]) => {
    if (frIsAlias(value)) {
      frCheckAlias(spec.name, value, types, spec.type, ` in mode ${mode}`);
      return;
    }
    if (!frLiteralMatches(spec.type, value)) {
      throw new Error(`figma-render: variable ${collection}/${spec.name} has a value in mode ${mode} that is not a ${spec.type}: ${JSON.stringify(value)}`);
    }
  });
}

function frLiteralMatches(type, value) {
  const unit = n => typeof n === 'number' && n >= 0 && n <= 1;
  if (type === 'COLOR') return Boolean(value) && typeof value === 'object' && ['r', 'g', 'b', 'a'].every(k => unit(value[k]));
  if (type === 'FLOAT') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'string';
}

function frCheckStyle(style, types) {
  const fail = (what, value) => { throw new Error(`figma-render: text style ${style.name} has a ${what} that is not a number: ${JSON.stringify(value)}`); };
  if (frIsAlias(style.fontSize)) frCheckAlias(style.name, style.fontSize, types, 'FLOAT', '');
  else if (!Number.isFinite(style.fontSize)) fail('font size', style.fontSize);
  if (!Number.isFinite(style.lineHeightPercent)) fail('line height', style.lineHeightPercent);
  if (style.letterSpacing !== undefined) frCheckLetterSpacing(style);
}

const FR_LETTER_SPACING_UNITS = ['PERCENT', 'PIXELS'];

function frCheckLetterSpacing(style) {
  const ls = style.letterSpacing;
  const valid = ls && typeof ls === 'object' && FR_LETTER_SPACING_UNITS.includes(ls.unit) && Number.isFinite(ls.value);
  if (!valid) {
    throw new Error(`figma-render: text style ${style.name} has a letterSpacing that is not { unit: PERCENT | PIXELS, value: number }: ${JSON.stringify(ls)}`);
  }
}

function frCheckAlias(from, value, types, wanted, where) {
  if (!types.has(value.alias)) throw new Error(`figma-render: ${from} aliases ${value.alias}${where}, which the token plan does not contain`);
  if (types.get(value.alias) !== wanted) throw new Error(`figma-render: ${from} aliases ${value.alias}${where}, which is ${types.get(value.alias)}, not ${wanted}`);
}

// ---------- reading the file ----------

async function frReadFile() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const styles = await figma.getLocalTextStylesAsync();
  const nameOf = new Map(collections.map(c => [c.id, c.name]));
  return { collections, variables, styles, collectionNameOf: id => nameOf.get(id) || '' };
}

// A collection or text style is ours when it carries the stamp. A stamped one
// wins over an unstamped one with the same name; an unstamped one alone is
// taken over only with adopt, and otherwise stops the run before any write.
function frClaim(plan, file, adopt) {
  const pick = (items, name, kind) => {
    const named = items.filter(item => item.name === name);
    const stamped = named.find(item => item.getPluginData(FR_TOKEN_STAMP));
    if (stamped || !named.length) return stamped || null;
    if (adopt) return named[0];
    throw new Error(`figma-render: a ${kind} named ${name} already exists and was not made by figma-render; rename it, or pass { adopt: true } to take it over`);
  };
  return {
    collections: new Map(plan.collections.map(c => [c.name, pick(file.collections, c.name, 'collection')])),
    styles: new Map((plan.textStyles || []).map(s => [s.name, pick(file.styles, s.name, 'text style')]))
  };
}

function frExistingVariable(file, collection, name) {
  if (!collection) return null;
  return file.variables.find(v => v.variableCollectionId === collection.id && v.name === name) || null;
}

function frCheckTypes(plan, file, owned) {
  plan.collections.forEach(c => {
    const collection = owned.collections.get(c.name);
    c.variables.forEach(spec => {
      const existing = frExistingVariable(file, collection, spec.name);
      if (existing && existing.resolvedType !== spec.type) {
        throw new Error(`figma-render: variable ${c.name}/${spec.name} is ${existing.resolvedType} in Figma but the token plan makes it ${spec.type}; Figma cannot change a variable's type, so rename or delete it first`);
      }
    });
  });
}

// ---------- collections and modes ----------

function frUpsertCollections(plan, owned, adopt) {
  return new Map(plan.collections.map(c => {
    const existing = owned.collections.get(c.name);
    const collection = existing || figma.variables.createVariableCollection(c.name);
    collection.setPluginData(FR_TOKEN_STAMP, c.name);
    collection.hiddenFromPublishing = Boolean(c.hidden);
    const { modeIds, renamed } = frEnsureModes(collection, c.modes, !existing || adopt);
    const extraModes = collection.modes.filter(m => !c.modes.includes(m.name)).map(m => ({ collection: c.name, mode: m.name }));
    const renamedModes = renamed.map(r => ({ collection: c.name, from: r.from, to: r.to }));
    return [c.name, { collection, modeIds, extraModes, renamedModes }];
  }));
}

// Each planned mode is found by name. Failing that, and only on a collection
// made this run or adopted, the mode in the same position is renamed if its
// name is not one the plan uses (a new collection's "Mode 1"). Otherwise the
// mode is added and the unused one stays, reported as an extra mode.
function frEnsureModes(collection, names, mayRename) {
  return names.reduce((acc, name, index) => {
    const modes = collection.modes;
    const found = modes.find(m => m.name === name);
    if (found) return { ...acc, modeIds: new Map(acc.modeIds).set(name, found.modeId) };
    const atIndex = modes[index];
    const claimed = [...acc.modeIds.values()];
    if (mayRename && atIndex && !names.includes(atIndex.name) && !claimed.includes(atIndex.modeId)) {
      collection.renameMode(atIndex.modeId, name);
      return { modeIds: new Map(acc.modeIds).set(name, atIndex.modeId), renamed: [...acc.renamed, { from: atIndex.name, to: name }] };
    }
    return { ...acc, modeIds: new Map(acc.modeIds).set(name, collection.addMode(name)) };
  }, { modeIds: new Map(), renamed: [] });
}

// ---------- variables: pass one creates or finds, pass two sets values ----------

function frUpsertVariables(plan, collections, file) {
  return plan.collections.flatMap(c => {
    const { collection } = collections.get(c.name);
    return c.variables.map(spec => {
      const existing = frExistingVariable(file, collection, spec.name);
      const variable = existing || figma.variables.createVariable(spec.name, collection, spec.type);
      frWriteVariableFields(variable, spec);
      return { spec, variable, created: !existing };
    });
  });
}

function frWriteVariableFields(variable, spec) {
  variable.scopes = [...(spec.scopes || [])];
  variable.hiddenFromPublishing = Boolean(spec.hidden);
  Object.entries(spec.codeSyntax || {}).forEach(([platform, syntax]) => variable.setVariableCodeSyntax(platform, syntax));
  variable.description = spec.description || '';
  variable.setPluginData(FR_TOKEN_STAMP, spec.path);
}

function frSetValues(plan, collections, byName) {
  plan.collections.forEach(c => {
    const { modeIds } = collections.get(c.name);
    c.variables.forEach(spec => {
      const variable = byName.get(spec.name);
      Object.entries(spec.values).forEach(([mode, value]) => {
        variable.setValueForMode(modeIds.get(mode), frFigmaValue(value, byName));
      });
    });
  });
}

function frFigmaValue(value, byName) {
  if (value && typeof value === 'object' && 'alias' in value) return figma.variables.createVariableAlias(byName.get(value.alias));
  if (value && typeof value === 'object') return { ...value };
  return value;
}

// ---------- text styles ----------

async function frUpsertTextStyles(specs, owned, byName) {
  const results = [];
  for (const spec of specs) results.push(await frUpsertTextStyle(spec, owned.styles.get(spec.name), byName));
  return results;
}

async function frUpsertTextStyle(spec, existing, byName) {
  const fontName = await frLoadFirstFont(spec);
  if (!fontName) return { spec, missing: frMissingFont(spec) };
  const style = existing || figma.createTextStyle();
  style.name = spec.name;
  // Figma may want the current font loaded before the font changes. One that
  // is not installed does not matter: the new font replaces it.
  await frTryLoadFont(style.fontName);
  style.fontName = fontName;
  frWriteFontSize(style, spec.fontSize, byName);
  style.lineHeight = { unit: 'PERCENT', value: spec.lineHeightPercent };
  style.letterSpacing = spec.letterSpacing || { unit: 'PERCENT', value: 0 };
  // Only a planned description is written, so one typed by hand in Figma survives.
  if (spec.description) style.description = spec.description;
  style.setPluginData(FR_TOKEN_STAMP, spec.path);
  return { spec, style, created: !existing };
}

// A weight with no Figma style names (950, say) cannot load in any family, so
// it is reported as such rather than as an empty list of styles tried.
function frMissingFont(spec) {
  const styles = frStyleNames(spec.weight);
  const base = { name: spec.name, path: spec.path, families: [...spec.families] };
  return styles.length ? { ...base, styles } : { ...base, unsupportedWeight: spec.weight };
}

function frStyleNames(weight) {
  return [...(FR_WEIGHT_STYLES[weight] || [])];
}

// The first family the machine has in the weight's style wins. A font that
// fails to load is expected here (it is not installed), so the next is tried;
// when none loads the caller reports the style under fontsMissing.
async function frLoadFirstFont(spec) {
  const candidates = spec.families.flatMap(family => frStyleNames(spec.weight).map(style => ({ family, style })));
  for (const font of candidates) {
    if (await frTryLoadFont(font)) return font;
  }
  return null;
}

async function frTryLoadFont(font) {
  try {
    await figma.loadFontAsync(font);
    return true;
  } catch (err) {
    return false;
  }
}

function frWriteFontSize(style, fontSize, byName) {
  if (fontSize && typeof fontSize === 'object') {
    style.setBoundVariable('fontSize', byName.get(fontSize.alias));
    return;
  }
  if (style.boundVariables && style.boundVariables.fontSize) style.setBoundVariable('fontSize', null);
  style.fontSize = fontSize;
}

// ---------- stale, prune, report ----------

// What this run matched in the file. Anything else carrying the stamp is stale.
function frKept(variables, styles, owned) {
  const claimed = [...owned.styles.values()].filter(Boolean);
  const written = styles.filter(entry => entry.style).map(entry => entry.style);
  return {
    variables: new Set(variables.map(entry => entry.variable.id)),
    styles: new Set([...claimed, ...written].map(style => style.id))
  };
}

function frStale(file, kept) {
  const variables = file.variables
    .filter(v => v.getPluginData(FR_TOKEN_STAMP) && !kept.variables.has(v.id))
    .map(v => ({
      node: v,
      report: { kind: 'variable', collection: file.collectionNameOf(v.variableCollectionId), name: v.name, path: v.getPluginData(FR_TOKEN_STAMP) }
    }));
  const styles = file.styles
    .filter(s => s.getPluginData(FR_TOKEN_STAMP) && !kept.styles.has(s.id))
    .map(s => ({ node: s, report: { kind: 'textStyle', name: s.name, path: s.getPluginData(FR_TOKEN_STAMP) } }));
  return [...variables, ...styles];
}

// ---------- what still uses a stale item ----------

// Counts, per stale item: other variables aliasing it in any mode, text
// styles binding it, and nodes on every page binding it (node fields, paint
// colours in fills, strokes and effects) or, for a text style, using it.
async function frStaleWithUsage(stale) {
  if (!stale.length) return [];
  const variableRefs = (await figma.variables.getLocalVariablesAsync()).map(v => frWithout(frVariableRefs(v), v.id));
  const styleRefs = (await figma.getLocalTextStylesAsync()).map(st => frWithout(frAliasIds(st.boundVariables), st.id));
  await figma.loadAllPagesAsync();
  const nodeRefs = figma.root.findAll().map(frNodeRefs);
  const count = (lists, id) => lists.filter(list => list.includes(id)).length;
  return stale.map(entry => {
    const id = entry.node.id;
    const usedBy = { variables: count(variableRefs, id), textStyles: count(styleRefs, id), nodes: count(nodeRefs, id) };
    return { ...entry, usedBy, report: { ...entry.report, usedBy } };
  });
}

const frUnique = list => [...new Set(list)];
const frWithout = (list, id) => list.filter(item => item !== id);

function frAliasIds(value) {
  if (!value || typeof value !== 'object') return [];
  if (value.type === 'VARIABLE_ALIAS' && value.id) return [value.id];
  const children = Array.isArray(value) ? value : Object.values(value);
  return frUnique(children.flatMap(frAliasIds));
}

function frVariableRefs(variable) {
  return frUnique(Object.values(variable.valuesByMode || {}).flatMap(frAliasIds));
}

function frPaintRefs(paints) {
  return Array.isArray(paints) ? paints.flatMap(paint => frAliasIds(paint && paint.boundVariables)) : [];
}

function frNodeRefs(node) {
  const bound = frAliasIds(node.boundVariables);
  const paints = [...frPaintRefs(node.fills), ...frPaintRefs(node.strokes), ...frPaintRefs(node.effects)];
  return frUnique([...bound, ...paints, ...frTextStyleIds(node)]);
}

function frTextStyleIds(node) {
  if (typeof node.textStyleId === 'string') return node.textStyleId ? [node.textStyleId] : [];
  if (node.type !== 'TEXT' || typeof node.getStyledTextSegments !== 'function') return [];
  return node.getStyledTextSegments(['textStyleId']).map(segment => segment.textStyleId).filter(Boolean);
}

// ---------- prune and report ----------

// An item still in use is kept unless force, because removing it would
// silently unbind whatever uses it.
function frPrune(stale, force) {
  const inUse = entry => entry.usedBy.variables + entry.usedBy.textStyles + entry.usedBy.nodes > 0;
  const doomed = force ? stale : stale.filter(entry => !inUse(entry));
  doomed.forEach(entry => entry.node.remove());
  return { removed: doomed.length, keptInUse: stale.filter(entry => !doomed.includes(entry)).map(entry => entry.report) };
}

// A stale variable whose stamped DTCG path is planned under another name or
// collection has moved. It is reported, never migrated, so its bindings can
// be moved by hand before a prune.
function frMoved(plan, stale) {
  const plannedAt = new Map(plan.collections.flatMap(c => c.variables.map(v => [v.path, `${c.name}/${v.name}`])));
  return stale
    .filter(entry => entry.report.kind === 'variable' && plannedAt.has(entry.report.path))
    .map(({ report }) => ({ path: report.path, from: `${report.collection}/${report.name}`, to: plannedAt.get(report.path) }));
}

function frReport(plan, { variables, styles, stale, pruned, collections }) {
  const written = [...variables, ...styles.filter(s => s.style)];
  return {
    collections: Object.fromEntries(plan.collections.map(c => [c.name, c.variables.length])),
    modes: plan.collections.map(c => ({ collection: c.name, modes: [...c.modes] })),
    extraModes: collections.flatMap(entry => entry.extraModes),
    renamedModes: collections.flatMap(entry => entry.renamedModes),
    textStyles: styles.filter(s => s.style).length,
    created: written.filter(entry => entry.created).length,
    updated: written.filter(entry => !entry.created).length,
    skipped: (plan.skipped || []).map(s => ({ path: s.path, type: s.type, reason: s.reason || FR_SKIP_REASON })),
    stale: stale.map(entry => entry.report),
    moved: frMoved(plan, stale),
    removed: pruned.removed,
    keptInUse: pruned.keptInUse,
    fontsMissing: styles.filter(s => s.missing).map(s => s.missing)
  };
}
