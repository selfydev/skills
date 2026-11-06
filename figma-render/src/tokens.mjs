// Reads a DTCG 2025.10 resolver and plans the Figma variables and text styles
// for it. Pure: no Figma, no network. The plan is the input to the sandbox
// importer (src/runtime/tokens.js).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { toFigmaValue, toPx, toFamilies, toWeight, toLetterSpacing, figmaTypeOf, cssName, scopesFor, memberName, isIdentifier, CODE_PLATFORMS } from './token-values.mjs';

export { cssName, scopesFor, memberName };

const COLLECTION_OF_SET = { primitives: 'Primitives', semantic: 'Semantic', component: 'Semantic' };
const RESERVED_COLLECTIONS = ['Primitives', 'Semantic'];
const REQUIRED_SETS = ['primitives', 'semantic'];
const PRIMITIVE_MODE = 'Value';
const ALIAS = /^\{([^{}]+)\}$/;

// ---------- reading ----------

export function readResolver(path) {
  const file = resolve(path);
  const doc = readJson(file);
  const dir = dirname(file);
  const sets = mapValues(doc.sets ?? {}, set => ({ ...set, sources: loadSources(set.sources, dir) }));
  const modifiers = mapValues(doc.modifiers ?? {}, mod => ({
    ...mod,
    contexts: mapValues(mod.contexts ?? {}, list => loadSources(list, dir))
  }));
  return { ...doc, path: file, sets, modifiers };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`figma-render: cannot read ${file}: ${err.message}`);
  }
}

function loadSources(list = [], dir) {
  return list.map(source => (typeof source?.$ref === 'string' ? loadRef(source.$ref, dir) : source));
}

function loadRef(ref, dir) {
  const [file, pointer] = ref.split('#');
  const json = readJson(resolve(dir, file));
  if (!pointer) return json;
  const found = pointer.split('/').filter(Boolean).reduce((node, key) => node?.[key], json);
  if (found === undefined) throw new Error(`figma-render: cannot read ${ref}: pointer not found`);
  return found;
}

function mapValues(obj, fn) {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, fn(value, key)]));
}

// ---------- flattening and layering ----------

// $extensions['com.figma'] is inherited the same way $type is: a token's own
// extensions win, otherwise the nearest ancestor group's extensions apply.
function flatten(node, ctx) {
  return Object.entries(node ?? {})
    .filter(([key, child]) => !key.startsWith('$') && child && typeof child === 'object')
    .flatMap(([key, child]) => {
      const segments = [...ctx.segments, key];
      const type = child.$type ?? ctx.type;
      const figmaExt = child.$extensions?.['com.figma'] ?? ctx.figmaExt;
      if ('$value' in child) return [makeToken(segments, ctx.set, type, child, figmaExt)];
      return flatten(child, { ...ctx, segments, type, figmaExt });
    });
}

// Code syntax is a token's own name for its value, so unlike the rest of
// com.figma it is never inherited from a group.
function makeToken(segments, set, type, node, figmaExt) {
  const codeSyntax = node.$extensions?.['com.figma']?.codeSyntax;
  return { path: segments.join('.'), segments, set, type, value: node.$value, description: node.$description ?? '', figmaExt, codeSyntax };
}

function flattenTree(tree, set) {
  return flatten(tree, { segments: [], set, type: tree?.$type, figmaExt: tree?.$extensions?.['com.figma'] });
}

function layerOrder(resolver) {
  const refs = (resolver.resolutionOrder ?? []).map(entry => entry?.$ref ?? '');
  const named = kind => refs.filter(ref => ref.startsWith(`#/${kind}/`)).map(ref => ref.slice(kind.length + 3));
  const withRest = (listed, all) => [...listed, ...all.filter(name => !listed.includes(name))];
  return {
    sets: withRest(named('sets'), Object.keys(resolver.sets ?? {})),
    modifiers: withRest(named('modifiers'), Object.keys(resolver.modifiers ?? {}))
  };
}

function checkSets(resolver, marks) {
  const has = Object.keys(resolver.sets ?? {});
  const missing = REQUIRED_SETS.filter(name => !has.includes(name));
  if (missing.length) {
    throw new Error(`figma-render: the resolver needs sets named ${REQUIRED_SETS.join(' and ')} (component is optional); it has: ${has.join(', ') || 'none'}`);
  }
  const unknown = has.filter(name => !(name in COLLECTION_OF_SET) && !marks.setCollection.has(name));
  if (unknown.length) throw new Error(`figma-render: set ${unknown.join(', ')} has no Figma collection; use primitives, semantic or component, or mark it with $extensions["com.figma"].collection`);
}

// ---------- collections made by a modifier ----------

// A modifier marked $extensions['com.figma'].collection becomes a collection
// of its own: each context is a mode, named as written. The set marked with
// the same collection holds its tokens, and only that modifier may override
// them, so a variable there can alias Semantic ones and the Semantic mode
// still decides the final value. The theme stays the Semantic modes.
const collectionMark = def => def?.$extensions?.['com.figma']?.collection;

function modeCollections(resolver, theme) {
  const marked = kind => Object.entries(resolver[kind] ?? {}).filter(([, def]) => collectionMark(def) !== undefined);
  const sets = marked('sets');
  const mods = marked('modifiers');
  if (mods.some(([name]) => name === theme)) throw new Error(`figma-render: the theme modifier ${theme} cannot be a collection; its contexts are the Semantic modes`);
  [...sets, ...mods].forEach(([, def]) => {
    const name = collectionMark(def);
    if (typeof name !== 'string' || !name.trim()) throw new Error(`figma-render: $extensions["com.figma"].collection must be a collection name, not ${JSON.stringify(name)}`);
    if (RESERVED_COLLECTIONS.includes(name)) throw new Error(`figma-render: collection ${name} is reserved for the sets and the theme; name the marked collection something else`);
  });
  sets.forEach(([setName, def]) => {
    if (!mods.some(([, mod]) => collectionMark(mod) === collectionMark(def))) throw new Error(`figma-render: set ${setName} goes in collection ${collectionMark(def)}, but no modifier is marked with it to give its modes`);
  });
  const collections = mods.map(([modName, def]) => {
    const name = collectionMark(def);
    const owners = sets.filter(([, set]) => collectionMark(set) === name).map(([setName]) => setName);
    if (!owners.length) throw new Error(`figma-render: modifier ${modName} makes collection ${name}, but no set is marked with it to hold its tokens`);
    if (mods.filter(([, mod]) => collectionMark(mod) === name).length > 1) throw new Error(`figma-render: more than one modifier makes collection ${name}`);
    return { name, modifier: modName };
  });
  return {
    collections,
    setCollection: new Map(sets.map(([setName, def]) => [setName, collectionMark(def)])),
    modCollection: new Map(collections.map(c => [c.modifier, c.name]))
  };
}

const collectionOf = (token, marks) => marks.setCollection.get(token.set) ?? COLLECTION_OF_SET[token.set];

function baseTokens(resolver, setNames) {
  const tokens = setNames.flatMap(set => resolver.sets[set].sources.flatMap(tree => flattenTree(tree, set)));
  return new Map(tokens.map(token => [token.path, token]));
}

// A theme context becomes a mode of the Semantic collection, and Primitives
// has one mode, so a theme context may only override semantic and component
// tokens. A marked modifier's contexts override only its own collection's
// tokens, which no other modifier may touch. Other modifiers resolve to one
// context and may override anything else.
function applyOverrides(base, trees, { where, themeContext, own, marks }) {
  const overrides = trees.flatMap(tree => flattenTree(tree, null));
  return overrides.reduce((map, override) => {
    const current = map.get(override.path);
    if (!current) throw new Error(`figma-render: modifier ${where} overrides ${override.path}, which no set defines`);
    if (themeContext && current.set === 'primitives') {
      throw new Error(`figma-render: theme context ${themeContext} overrides primitive ${override.path}; Primitives has one mode, so override the semantic token that uses it`);
    }
    const lives = marks.setCollection.get(current.set);
    if (own && lives !== own) throw new Error(`figma-render: modifier ${where} overrides ${override.path}, which is not in its collection ${own}`);
    if (!own && lives) throw new Error(`figma-render: modifier ${where} overrides ${override.path}, which lives in collection ${lives}; only the modifier marked with that collection may override it`);
    return new Map(map).set(override.path, { ...current, value: override.value });
  }, base);
}

// pins names the context of each modifier that is not at its default.
function contextOf(resolver, modName, pins) {
  if (modName in pins) return pins[modName];
  const mod = resolver.modifiers[modName];
  return mod.default ?? Object.keys(mod.contexts)[0];
}

function tokensFor(resolver, order, { theme, pins, marks }) {
  return order.modifiers.reduce((map, modName) => {
    const ctx = contextOf(resolver, modName, pins);
    const trees = resolver.modifiers[modName].contexts[ctx];
    if (!trees) throw new Error(`figma-render: modifier ${modName} has no context ${ctx}`);
    const own = marks.modCollection.get(modName) ?? null;
    return applyOverrides(map, trees, { where: `${modName}/${ctx}`, themeContext: modName === theme ? ctx : null, own, marks });
  }, baseTokens(resolver, order.sets));
}

// ---------- aliases ----------

const aliasOf = value => (typeof value === 'string' ? value.match(ALIAS)?.[1] ?? null : null);

function lookup(map, ref, from) {
  const target = map.get(ref);
  if (!target) throw new Error(`figma-render: ${from} aliases {${ref}}, which no token defines`);
  return target;
}

function resolveDeep(value, map, from, seen = [from]) {
  const ref = aliasOf(value);
  if (ref === null) return value;
  if (seen.includes(ref)) throw new Error(`figma-render: circular alias ${[...seen, ref].join(' -> ')}`);
  return resolveDeep(lookup(map, ref, from).value, map, ref, [...seen, ref]);
}

function stringLeaves(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringLeaves);
  return [];
}

function checkAliases(map) {
  for (const token of map.values()) {
    for (const leaf of stringLeaves(token.value)) {
      const ref = aliasOf(leaf);
      if (ref !== null) lookup(map, ref, token.path);
    }
    resolveDeep(token.value, map, token.path);
  }
}

function inferTypes(map) {
  const typeOf = (token, seen) => {
    if (token.type) return token.type;
    const ref = aliasOf(token.value);
    if (ref === null || seen.includes(ref)) throw new Error(`figma-render: ${token.path} has no $type`);
    return typeOf(lookup(map, ref, token.path), [...seen, ref]);
  };
  return new Map([...map].map(([path, token]) => [path, { ...token, type: typeOf(token, [path]) }]));
}

// ---------- planning ----------

export const figmaName = token =>
  (token.set === 'component' ? ['component', ...token.segments] : token.segments).join('/');

export function modeName(context) {
  return context.split(/[-_\s]+/).filter(Boolean).map(capitalise).join(' ');
}

const capitalise = word => word.charAt(0).toUpperCase() + word.slice(1);

function themeContexts(resolver, theme) {
  const mod = resolver.modifiers?.[theme];
  if (!mod) {
    const has = Object.keys(resolver.modifiers ?? {});
    throw new Error(`figma-render: no theme modifier named ${theme}; modifiers: ${has.join(', ') || 'none'}`);
  }
  return contextsOf(mod);
}

// A modifier's contexts, its default first.
function contextsOf(mod) {
  const all = Object.keys(mod.contexts ?? {});
  const first = mod.default ?? all[0];
  return [first, ...all.filter(ctx => ctx !== first)];
}

function valueIn(token, map, isVariable, mode, seen = [token.path]) {
  const ref = aliasOf(token.value);
  if (ref === null) return toFigmaValue(token.type, token.value, token.path);
  const target = lookup(map, ref, token.path);
  if (isVariable(target)) {
    checkAliasType(token, target, mode);
    return { alias: figmaName(target) };
  }
  if (seen.includes(ref)) throw new Error(`figma-render: circular alias ${[...seen, ref].join(' -> ')}`);
  return valueIn({ ...target, type: token.type, path: token.path }, map, isVariable, mode, [...seen, ref]);
}

// DTCG types that share a Figma type (dimension and number are both FLOAT)
// may alias each other; any other mix would make a Figma alias of the wrong type.
function checkAliasType(token, target, mode) {
  const want = figmaTypeOf(token.type);
  const got = figmaTypeOf(target.type);
  if (want === got) return;
  throw new Error(`figma-render: ${token.path} is ${token.type} (${want}) but its value in mode ${mode} is ${target.path}, which is ${target.type} (${got})`);
}

// A token or its nearest ancestor group's $extensions['com.figma'] overrides
// the rule-derived scopes and the collection's default hiddenFromPublishing.
function scopesForToken(token, name, type) {
  const override = token.figmaExt?.scopes;
  if (override) return [...override];
  return token.set === 'primitives' ? [] : scopesFor(name, type);
}

function hiddenForToken(token) {
  const override = token.figmaExt?.hiddenFromPublishing;
  return override === undefined ? token.set === 'primitives' : override;
}

// ---------- code syntax ----------

const platformList = CODE_PLATFORMS.join(', ').replace(/, (\w+)$/, ' or $1');

// The resolver's $extensions['com.figma'].codeSyntax maps a platform to a
// rule { namespace, categories } that derives a member name from each
// Semantic variable's Figma name (see memberName). Primitives get none: code
// should name the semantic role, never the raw value.
function codeSyntaxRules(resolver) {
  const rules = resolver.$extensions?.['com.figma']?.codeSyntax ?? {};
  Object.entries(rules).forEach(([platform, rule]) => {
    if (!CODE_PLATFORMS.includes(platform)) throw new Error(`figma-render: the resolver has a code syntax rule for ${platform}; use ${platformList}`);
    if (!isIdentifier(rule?.namespace)) throw new Error(`figma-render: the resolver's ${platform} code syntax rule needs a namespace that is a valid identifier, not ${JSON.stringify(rule?.namespace)}`);
  });
  return rules;
}

function ownCodeSyntax(token) {
  const own = token.codeSyntax ?? {};
  Object.entries(own).forEach(([platform, syntax]) => {
    if (!CODE_PLATFORMS.includes(platform)) throw new Error(`figma-render: ${token.path} has code syntax for ${platform}; use ${platformList}`);
    if (typeof syntax !== 'string' || !syntax) throw new Error(`figma-render: ${token.path} has ${platform} code syntax that is not a string: ${JSON.stringify(syntax)}`);
  });
  return own;
}

// WEB defaults to the CSS custom property; a derived rule adds or replaces a
// platform; the token's own code syntax wins over both.
function codeSyntaxFor(token, name, rules) {
  const own = ownCodeSyntax(token);
  const derived = token.set === 'primitives' ? {} : Object.fromEntries(Object.entries(rules)
    .filter(([platform]) => !(platform in own))
    .map(([platform, rule]) => [platform, memberName(name.split('/'), rule)]));
  return { WEB: `var(${cssName(token.path)})`, ...derived, ...own };
}

// Figma reads a number bound to layer opacity as a percentage (0–100; checked
// live), while a DTCG opacity is a fraction. A number whose only scope is
// OPACITY is written as a percentage; an alias keeps pointing at its target.
const isOpacity = (token, scopes) => token.type === 'number' && scopes.length === 1 && scopes[0] === 'OPACITY';
function opacityPercent(value, path) {
  if (typeof value !== 'number') return value;
  if (value < 0 || value > 1) throw new Error(`figma-render: ${path} is an opacity from 0 to 1, not ${value}`);
  return Math.round(value * 10000) / 100;
}

function planVariable(token, modes, isVariable, rules) {
  const name = figmaName(token);
  const type = figmaTypeOf(token.type);
  const scopes = scopesForToken(token, name, type);
  const value = mode => valueIn(mode.map.get(token.path), mode.map, isVariable, mode.mode);
  return {
    name,
    path: token.path,
    type,
    scopes,
    hidden: hiddenForToken(token),
    codeSyntax: codeSyntaxFor(token, name, rules),
    description: token.description,
    values: Object.fromEntries(modes.map(m => [m.mode, isOpacity(token, scopes) ? opacityPercent(value(m), token.path) : value(m)]))
  };
}

// A collection is hidden from publishing only when every variable in it is,
// so one variable a token publishes on purpose is never hidden with it.
function planCollection(name, tokens, modes, isVariable, rules, marks) {
  const variables = tokens
    .filter(token => collectionOf(token, marks) === name && isVariable(token))
    .map(token => planVariable(token, modes, isVariable, rules));
  const hidden = variables.length > 0 && variables.every(v => v.hidden);
  return { name, modes: modes.map(({ mode }) => mode), hidden, variables };
}

// Walks the alias chain behind a typography token's fontFamily, looking for
// a com.figma family name on the token it eventually points at.
function figmaFamilyOf(value, map, from, seen = [from]) {
  const ref = aliasOf(value);
  if (ref === null || seen.includes(ref)) return null;
  const target = lookup(map, ref, from);
  if (target.figmaExt?.family) return target.figmaExt.family;
  return figmaFamilyOf(target.value, map, ref, [...seen, ref]);
}

function withFigmaFamily(cssFamilies, figmaFamily) {
  if (!figmaFamily) return cssFamilies;
  return [figmaFamily, ...cssFamilies.filter(family => family !== figmaFamily)];
}

function planTextStyle(token, map, isVariable) {
  const value = resolveDeep(token.value, map, token.path);
  const part = key => resolveDeep(value?.[key], map, token.path);
  const sizeRef = aliasOf(value?.fontSize);
  const sizeTarget = sizeRef === null ? null : lookup(map, sizeRef, token.path);
  const figmaFamily = figmaFamilyOf(value?.fontFamily, map, token.path);
  const lineHeight = part('lineHeight');
  if (!Number.isFinite(lineHeight)) {
    throw new Error(`figma-render: ${token.path} has a lineHeight that is not a number: ${JSON.stringify(lineHeight)}; use a unitless multiplier such as 1.5`);
  }
  const letterSpacing = part('letterSpacing');
  return {
    name: token.segments.slice(1).map(capitalise).join('/') || capitalise(token.segments[0]),
    path: token.path,
    description: token.description,
    families: withFigmaFamily(toFamilies(part('fontFamily'), token.path), figmaFamily),
    weight: toWeight(part('fontWeight'), token.path),
    fontSize: sizeTarget && isVariable(sizeTarget) ? { alias: figmaName(sizeTarget) } : toPx(part('fontSize'), token.path),
    lineHeightPercent: Number((lineHeight * 100).toFixed(4)),
    ...(letterSpacing === undefined ? {} : { letterSpacing: toLetterSpacing(letterSpacing, token.path) })
  };
}

function checkFigmaNames(tokens) {
  tokens.reduce((seen, token) => {
    const name = figmaName(token);
    if (seen.has(name)) throw new Error(`figma-render: ${seen.get(name)} and ${token.path} both become the Figma variable ${name}; rename one`);
    return new Map(seen).set(name, token.path);
  }, new Map());
}

function skippedList(tokens, isVariable) {
  return tokens.filter(t => t.type !== 'typography' && !isVariable(t)).map(t => ({ path: t.path, type: t.type }));
}

export function planTokens(resolver, { theme = 'theme' } = {}) {
  const marks = modeCollections(resolver, theme);
  checkSets(resolver, marks);
  const order = layerOrder(resolver);
  const contexts = themeContexts(resolver, theme);
  const mapFor = pins => inferTypes(tokensFor(resolver, order, { theme, pins, marks }));
  const maps = contexts.map(ctx => mapFor({ [theme]: ctx }));
  maps.forEach(checkAliases);
  const base = maps[0];
  const tokens = [...base.values()];
  const isVariable = token => figmaTypeOf(base.get(token.path)?.type ?? token.type) !== null;
  const semanticModes = contexts.map((ctx, i) => ({ mode: modeName(ctx), map: maps[i] }));
  checkFigmaNames(tokens.filter(isVariable));
  const rules = codeSyntaxRules(resolver);
  // A marked collection's modes pin its modifier; the theme stays at its default.
  const marked = marks.collections.map(({ name, modifier }) => {
    const modes = contextsOf(resolver.modifiers[modifier]).map(ctx => ({ mode: ctx, map: mapFor({ [theme]: contexts[0], [modifier]: ctx }) }));
    modes.forEach(({ map }) => checkAliases(map));
    return planCollection(name, tokens, modes, isVariable, rules, marks);
  });
  return {
    collections: [
      planCollection('Primitives', tokens, [{ mode: PRIMITIVE_MODE, map: base }], isVariable, rules, marks),
      planCollection('Semantic', tokens, semanticModes, isVariable, rules, marks),
      ...marked
    ],
    textStyles: tokens.filter(t => t.type === 'typography').map(t => planTextStyle(t, base, isVariable)),
    skipped: skippedList(tokens, isVariable)
  };
}
