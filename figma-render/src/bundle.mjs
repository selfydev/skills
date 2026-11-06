import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`./runtime/${file}`, import.meta.url), 'utf8');
const AsyncFunction = (async () => {}).constructor;

// The Desktop Bridge runs a payload in whichever file is attached, so a
// payload can carry the name of the file it was built for and refuse to run
// anywhere else.
export function fileGuard(file) {
  if (file === undefined || file === null) return '';
  const name = JSON.stringify(String(file));
  return `if (figma.root.name !== ${name}) throw new Error('figma-render: this payload is for the file "' + ${name} + '" but the open file is "' + figma.root.name + '"');\n`;
}

export function renderPayload(plan, { file } = {}) {
  return `${fileGuard(file)}${read('executor.js')}\nreturn await execute(${JSON.stringify(plan)});\n`;
}

export function snapshotPayload(rootId, { file } = {}) {
  return `${fileGuard(file)}${read('snapshot.js')}\nreturn await snapshot(${JSON.stringify(rootId)});\n`;
}

export function tokensPayload(plan, { prune = false, adopt = false, force = false, file } = {}) {
  return `${fileGuard(file)}${read('tokens.js')}\nreturn await importTokens(${JSON.stringify(plan)}, ${JSON.stringify({ prune, adopt, force })});\n`;
}

export function runPayload(body, figma) {
  return new AsyncFunction('figma', body)(figma);
}
