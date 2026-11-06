#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateSpec, specWarnings } from '../src/validate.mjs';
import { planSpec } from '../src/plan.mjs';
import { gate, formatGate } from '../src/gate.mjs';
import { renderPayload, snapshotPayload, tokensPayload } from '../src/bundle.mjs';
import { readResolver, planTokens } from '../src/tokens.mjs';
import { withLibrary } from '../src/library.mjs';

const USAGE = `usage:
  figma-render validate <spec.json> [--manifest icons.json] [--tokens tokens.plan.json]
  figma-render render <spec.json> [--manifest icons.json] [--tokens tokens.plan.json] [--library library.json] [--file name] [--out dir]
  figma-render snapshot <nodeId> [--file name] [--out dir]
  figma-render gate <snapshot.json> <plan.json>
  figma-render tokens <resolver.json> [--theme theme] [--file name] [--prune] [--force] [--adopt] [--out dir]`;

// Flags that stand alone, with no value after them. Every other --flag takes
// the next argv entry as its value.
const BOOLEAN_FLAGS = new Set(['prune', 'adopt', 'force']);

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const name = argv[i].slice(2);
      opts[name] = BOOLEAN_FLAGS.has(name) ? true : argv[++i];
    } else {
      pos.push(argv[i]);
    }
  }
  if ('file' in opts && (!opts.file || opts.file.startsWith('--'))) {
    throw new Error('figma-render: --file needs the Figma file name, exactly as it shows in the title bar');
  }
  return { pos, opts };
}

function readJson(p) {
  const resolved = resolve(p);
  try {
    return JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (err) {
    const msg = err.message.replace(/ in JSON at position \d+.*$/, '');
    throw new Error(`figma-render: could not read ${resolved}: ${msg}`);
  }
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function main(argv) {
  const [cmd, ...rest] = argv;
  const { pos, opts } = parseArgs(rest);
  const manifest = opts.manifest ? readJson(opts.manifest) : [];
  const out = resolve(opts.out ?? '.figma-render');
  // The file's token plan (FR tokens writes it): pinned modes are checked against its collections.
  const checks = opts.tokens ? { collections: tokenCollections(readJson(opts.tokens)) } : {};

  if (cmd === 'validate' && pos[0]) {
    const spec = readJson(pos[0]);
    const errs = validateSpec(spec, manifest, checks);
    if (errs.length) { console.error(errs.join('\n')); return 1; }
    for (const w of specWarnings(spec)) console.error(`warn: ${w}`);
    console.log('spec is valid');
    return 0;
  }
  if (cmd === 'render' && pos[0]) return runRender(pos[0], manifest, out, opts, checks);
  if (cmd === 'snapshot' && pos[0]) {
    mkdirSync(out, { recursive: true });
    const file = join(out, `snapshot-${slug(pos[0])}.js`);
    writeFileSync(file, snapshotPayload(pos[0], { file: opts.file }));
    console.log(`payload ${file}`);
    return 0;
  }
  if (cmd === 'gate' && pos[1]) {
    const result = gate(readJson(pos[0]), readJson(pos[1]));
    console.log(formatGate(result));
    return result.pass ? 0 : 1;
  }
  if (cmd === 'tokens' && pos[0]) return runTokens(pos[0], out, opts);
  console.error(USAGE);
  return 2;
}

function tokenCollections(plan) {
  if (!plan || !Array.isArray(plan.collections)) throw new Error('figma-render: --tokens needs a token plan with a collections list (FR tokens writes tokens.plan.json)');
  return plan.collections.map(c => ({ name: c.name, modes: [...c.modes] }));
}

function runRender(specPath, manifest, out, opts, checks) {
  const spec = readJson(specPath);
  const errs = validateSpec(spec, manifest, checks);
  if (errs.length) { console.error(errs.join('\n')); return 1; }
  // --library: a consumer file's published design system (variable, text style and component keys by name)
  const plan = withLibrary(planSpec(spec, { manifest }), opts.library ? readJson(opts.library) : null);
  mkdirSync(out, { recursive: true });
  const base = join(out, slug(plan.name));
  writeFileSync(`${base}.plan.json`, JSON.stringify(plan, null, 2));
  const payload = renderPayload(plan, { file: opts.file });
  writeFileSync(`${base}.render.js`, payload);
  console.log(`plan    ${base}.plan.json\npayload ${base}.render.js (${payload.length} bytes, ${plan.ops.length} ops)`);
  return 0;
}

// Pruning deletes from whichever file the Bridge is attached to, so a prune
// payload must be pinned to one file with --file.
function runTokens(resolverPath, out, opts) {
  const prune = Boolean(opts.prune);
  if (prune && !opts.file) {
    console.error('figma-render: --prune needs --file <Figma file name>, so the payload cannot delete from the wrong file');
    return 2;
  }
  if (prune) console.error('figma-render: --prune removes variables and text styles from Figma; ones still in use are kept unless --force, which breaks their bindings.');
  const resolver = readResolver(resolverPath);
  const plan = opts.theme ? planTokens(resolver, { theme: opts.theme }) : planTokens(resolver);
  mkdirSync(out, { recursive: true });
  const planFile = join(out, 'tokens.plan.json');
  const payloadFile = join(out, 'tokens.import.js');
  writeFileSync(planFile, JSON.stringify(plan, null, 2));
  const payload = tokensPayload(plan, { prune, adopt: Boolean(opts.adopt), force: Boolean(opts.force), file: opts.file });
  writeFileSync(payloadFile, payload);
  console.log(formatTokens(plan, payload, planFile, payloadFile));
  return 0;
}

function formatTokens(plan, payload, planFile, payloadFile) {
  const counts = plan.collections.map(c => `${c.name} ${c.variables.length}`).join(', ');
  const modes = plan.collections.map(c => `${c.name}: ${c.modes.join(', ')}`).join(' | ');
  const skipped = plan.skipped.length ? plan.skipped.map(s => `${s.path} (${s.reason || s.type})`).join(', ') : 'none';
  return [
    `collections ${counts}`,
    `modes       ${modes}`,
    `text styles ${plan.textStyles.length}`,
    `plan        ${planFile}`,
    `payload     ${payloadFile} (${payload.length} bytes)`,
    `skipped     ${skipped}`
  ].join('\n');
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  if (err.message.startsWith('figma-render:')) {
    console.error(err.message);
    process.exitCode = 2;
  } else {
    throw err;
  }
}
