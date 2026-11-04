import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
async function files(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) result.push(...await files(path)); else if (/\.(mjs|js)$/.test(path)) result.push(path);
  }
  return result;
}
const all = (await Promise.all(['src', 'scripts', 'tests'].map(folder => files(resolve(root, folder))))).flat();
for (const path of all) {
  const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', windowsHide: true });
  if (check.error || check.status !== 0) { console.error(check.error?.message ?? check.stderr); process.exit(1); }
}
// Keep numerical primitives independent of DOM/editor orchestration.
for (const name of ['math', 'curve', 'ppc', 'ruler', 'movement', 'viewport', 'snap-policy', 'snap-context', 'curve-contacts']) {
  const code = await readFile(resolve(root, `src/graph/${name}.js`), 'utf8');
  if (/from\s+['"][^'"]*(?:canvas|editing-handles|interactions|\/ui\/|models\/objects)/.test(code)
    || /\b(?:document|window)\s*\./.test(code)) throw Error(`Numerical module crossed the editor boundary: ${name}`);
}
console.log(`Syntax checked ${all.length} modules; numerical/editor boundaries passed.`);
