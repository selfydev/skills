// DTCG value conversion, Figma scopes and CSS names for the token importer.
// Pure helpers used by src/tokens.mjs.

const REM_PX = 16;
const MS_PER_S = 1000;

const FIGMA_TYPES = {
  color: 'COLOR',
  dimension: 'FLOAT',
  number: 'FLOAT',
  fontWeight: 'FLOAT',
  duration: 'FLOAT',
  fontFamily: 'STRING',
  string: 'STRING'
};

// DTCG 2025.10 font weight names.
const WEIGHT_NAMES = {
  thin: 100, hairline: 100,
  extralight: 200, ultralight: 200,
  light: 300,
  normal: 400, regular: 400, book: 400,
  medium: 500,
  semibold: 600, demibold: 600,
  bold: 700,
  extrabold: 800, ultrabold: 800,
  black: 900, heavy: 900,
  extrablack: 950, ultrablack: 950
};

const tidy = n => Number(n.toFixed(6));

function invalid(path, type, value) {
  return new Error(`figma-render: ${path} has an invalid ${type} value ${JSON.stringify(value)}`);
}

export const figmaTypeOf = dtcgType => FIGMA_TYPES[dtcgType] ?? null;

function parseHex(hex, path) {
  const digits = String(hex).replace(/^#/, '');
  const full = digits.length <= 4 ? [...digits].map(d => d + d).join('') : digits;
  if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(full)) throw invalid(path, 'color', hex);
  const channel = i => parseInt(full.slice(i, i + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4), a: full.length === 8 ? channel(6) : 1 };
}

export function toColor(value, path) {
  if (typeof value === 'string') return parseHex(value, path);
  if (!value || typeof value !== 'object') throw invalid(path, 'color', value);
  const { components, colorSpace = 'srgb', alpha, hex } = value;
  const usable = colorSpace === 'srgb' && Array.isArray(components) && components.length === 3 && components.every(Number.isFinite);
  if (usable) return { r: components[0], g: components[1], b: components[2], a: alpha ?? 1 };
  if (hex) return { ...parseHex(hex, path), ...(alpha === undefined ? {} : { a: alpha }) };
  throw invalid(path, 'color', value);
}

function unitValue(value) {
  if (value && typeof value === 'object') return { amount: value.value, unit: value.unit };
  const match = typeof value === 'string' ? value.trim().match(/^(-?[\d.]+)([a-z]*)$/i) : null;
  return match ? { amount: Number(match[1]), unit: match[2] } : { amount: value, unit: '' };
}

export function toPx(value, path) {
  const { amount, unit } = unitValue(value);
  if (!Number.isFinite(amount)) throw invalid(path, 'dimension', value);
  if (unit === 'px' || unit === '') return amount;
  if (unit === 'rem') return tidy(amount * REM_PX);
  throw invalid(path, 'dimension', value);
}

export function toLetterSpacing(value, path) {
  const { amount, unit } = unitValue(value);
  if (!Number.isFinite(amount)) throw invalid(path, 'letterSpacing', value);
  if (unit === 'em') return { unit: 'PERCENT', value: tidy(amount * 100) };
  if (unit === 'px' || unit === '') return { unit: 'PIXELS', value: amount };
  throw invalid(path, 'letterSpacing', value);
}

export function toMs(value, path) {
  const { amount, unit } = unitValue(value);
  if (!Number.isFinite(amount)) throw invalid(path, 'duration', value);
  if (unit === 'ms') return amount;
  if (unit === 's') return tidy(amount * MS_PER_S);
  throw invalid(path, 'duration', value);
}

export function toWeight(value, path) {
  if (Number.isFinite(value)) return value;
  const named = WEIGHT_NAMES[String(value).toLowerCase().replace(/[-_\s]/g, '')];
  if (named === undefined) throw invalid(path, 'fontWeight', value);
  return named;
}

export function toFamilies(value, path) {
  const list = Array.isArray(value) ? value : [value];
  if (!list.length || !list.every(f => typeof f === 'string' && f)) throw invalid(path, 'fontFamily', value);
  return list;
}

function toNumber(value, path) {
  if (!Number.isFinite(value)) throw invalid(path, 'number', value);
  return value;
}

function toString(value, path) {
  if (typeof value !== 'string') throw invalid(path, 'string', value);
  return value;
}

const CONVERT = {
  color: toColor,
  dimension: toPx,
  number: toNumber,
  fontWeight: toWeight,
  duration: toMs,
  fontFamily: (value, path) => toFamilies(value, path)[0],
  string: toString
};

export function toFigmaValue(dtcgType, value, path) {
  const convert = CONVERT[dtcgType];
  if (!convert) throw new Error(`figma-render: ${path} has type ${dtcgType}, which has no Figma variable type`);
  return convert(value, path);
}

// ---------- scopes ----------

// `*` matches any run of characters, slashes included.
const glob = pattern => new RegExp('^' + pattern.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');

const rule = (types, patterns, scopes) => ({ types, patterns: patterns.map(glob), scopes });

const FILLS = ['FRAME_FILL', 'SHAPE_FILL'];

// First match wins. Colour rules go by what a role paints: a fill, text, a
// stroke, an icon (shapes and strokes) or a dot (shapes). A colour role named
// none of these keeps fills and strokes. Stroke weights (rings, borders) are
// checked before the WIDTH_HEIGHT rule, whose `*/width` would take them, and
// that rule is checked before `space/*`, whose GAP rule would shadow
// `space/row/*`. Suffix patterns such as `*Width` and `*Radius` match
// camelCase names (buttonWidth, innerRadius).
const SCOPE_RULES = [
  rule(['COLOR'], ['shadow/*', '*/shadow/*', '*Shadow'], ['EFFECT_COLOR']),
  rule(['COLOR'], ['color/surface/*', 'color/fill/*', 'color/background/*', '*/background*', '*Background', '*Bg', '*/bg'], FILLS),
  rule(['COLOR'], ['color/text/*', '*/text*', '*Fg', '*/fg', '*/foreground*', '*Foreground'], ['TEXT_FILL']),
  rule(['COLOR'], ['color/border/*', '*/border*', '*Border', 'ring/*', '*/ring/*', '*/divider*', '*Divider', '*/outline*'], ['STROKE_COLOR']),
  rule(['COLOR'], ['color/icon/*', '*/icon', '*Icon', '*/glyph*', '*Glyph'], ['SHAPE_FILL', 'STROKE_COLOR']),
  rule(['COLOR'], ['*/dot/*', '*/dot', '*Dot'], ['SHAPE_FILL']),
  rule(['COLOR'], ['*'], ['ALL_FILLS', 'STROKE_COLOR']),
  rule(['FLOAT'], ['shadow/*', '*/shadow/*'], ['EFFECT_FLOAT']),
  rule(['FLOAT'], ['stroke/*', 'ring/*/width', '*/ring/width', '*/borderWidth', '*BorderWidth', '*/strokeWidth'], ['STROKE_FLOAT']),
  rule(['FLOAT'], ['space/row/*', 'size/*', '*/height', '*/minHeight', '*/maxHeight', '*/size', 'component/*/dot', '*/width', '*Width'], ['WIDTH_HEIGHT']),
  rule(['FLOAT'], ['space/*', '*/gap', '*Gap', '*/padding*', '*Padding*', '*/inset'], ['GAP']),
  rule(['FLOAT'], ['radius/*', '*/radius', '*Radius'], ['CORNER_RADIUS']),
  rule(['FLOAT'], ['font/size/*'], ['FONT_SIZE']),
  rule(['FLOAT'], ['font/weight/*'], ['FONT_WEIGHT']),
  rule(['STRING'], ['font/family/*'], ['FONT_FAMILY']),
  rule(['FLOAT'], ['font/lineHeight/*'], ['LINE_HEIGHT']),
  rule(['FLOAT'], ['*Opacity', 'opacity/*'], ['OPACITY'])
];

export function scopesFor(name, figmaType) {
  const match = SCOPE_RULES.find(r => r.types.includes(figmaType) && r.patterns.some(re => re.test(name)));
  return match ? [...match.scopes] : ['ALL_SCOPES'];
}

// ---------- code syntax ----------

const kebab = segment => segment.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export function cssName(dtcgPath) {
  return '--' + dtcgPath.split('.').map(kebab).join('-');
}

// Figma's code syntax platforms.
export const CODE_PLATFORMS = ['WEB', 'ANDROID', 'iOS'];

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const words = segment => segment.split(/[^A-Za-z0-9]+/).filter(Boolean);
const upperFirst = word => word.charAt(0).toUpperCase() + word.slice(1);
const lowerFirst = word => word.charAt(0).toLowerCase() + word.slice(1);

// `2xl` -> `xl2`: an identifier cannot start with a digit.
const digitsLast = word => word.replace(/^(\d+)(.+)$/, '$2$1');

// A member path such as Acme.Color.textPrimary: the namespace, the first
// segment as a type name (or its entry in categories), then the other
// segments as one lowerCamelCase member. Throws when no valid name comes out.
export function memberName(segments, { namespace, categories = {} }) {
  const fail = () => {
    throw new Error(`figma-render: cannot make a code name for ${segments.join('.')}; give the token its own $extensions["com.figma"].codeSyntax`);
  };
  const [head, ...rest] = segments;
  const category = categories[head] ?? words(head).map(upperFirst).join('');
  const parts = rest.flatMap(words);
  if (!parts.length) fail();
  const member = [lowerFirst(digitsLast(parts[0])), ...parts.slice(1).map(upperFirst)].join('');
  if (!IDENTIFIER.test(category) || !/^[A-Za-z_]/.test(member)) fail();
  return `${namespace}.${category}.${member}`;
}

export const isIdentifier = name => typeof name === 'string' && IDENTIFIER.test(name);
