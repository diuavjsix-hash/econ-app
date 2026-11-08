// Contract for the shared design system (docs/design-system.md): one token file,
// one drawing palette, one component vocabulary. New UI must extend these instead
// of adding literal colors or one-off control styles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INK, FILL_PALETTE, ROLE_COLORS, STROKE_CYCLE } from '../src/models/palette.js';
import { appShell } from '../src/ui/shell.js';
import { icon, ICON_NAMES, objectGlyph } from '../src/ui/icons.js';
import { CURVE_FAMILIES } from '../src/models/curve-families.js';
import { CURVE_PRESETS } from '../src/graph/curve.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(join(root, path), 'utf8');
async function files(dir, extension) {
  const found = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await files(path, extension));
    else if (entry.name.endsWith(extension)) found.push(path.replaceAll('\\', '/'));
  }
  return found;
}
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = 'src/ui/tokens.css';
// Custom properties that tools set at runtime from document data.
const RUNTIME_VARIABLES = new Set(['--progress', '--selected-color', '--line-color', '--point-color', '--ruler-color', '--fill-color', '--object-color', '--swatch', '--columns', '--rows']);

test('only tokens.css writes raw colors; other stylesheets use variables', async () => {
  for (const path of await files('src', '.css')) {
    if (path === TOKENS) continue;
    const css = stripComments(await read(path));
    const literal = css.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab)\(|(?<![-\w])(?:white|black)(?![-\w])/);
    assert.equal(literal, null, `${path} contains a color literal (${literal?.[0]}); add a token to ${TOKENS}`);
  }
});

test('every CSS variable read by a stylesheet is defined by tokens, a stylesheet, or a runtime setter', async () => {
  const sheets = await Promise.all((await files('src', '.css')).map(async path => [path, stripComments(await read(path))]));
  const defined = new Set(RUNTIME_VARIABLES);
  for (const [, css] of sheets) for (const [, name] of css.matchAll(/(--[\w-]+)\s*:/g)) defined.add(name);
  for (const [path, css] of sheets) for (const [, name] of css.matchAll(/var\((--[\w-]+)/g)) {
    assert.ok(defined.has(name), `${path} reads undefined ${name}`);
  }
});

test('drawing colors come from the palette module only', async () => {
  for (const path of await files('src', '.js')) {
    if (path === 'src/models/palette.js') continue;
    const source = await read(path);
    const literal = source.match(/['"`]#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?['"`]|#[0-9a-fA-F]{6}\b/);
    assert.equal(literal, null, `${relative(root, join(root, path))} hardcodes ${literal?.[0]}; use src/models/palette.js`);
  }
  const hex = /^#[0-9a-f]{6}$/;
  for (const color of [...Object.values(INK), ...STROKE_CYCLE, ...FILL_PALETTE.map(([value]) => value), ...Object.values(ROLE_COLORS)]) assert.match(color, hex);
  for (const { metadata } of Object.values(CURVE_FAMILIES)) assert.ok(Object.values(ROLE_COLORS).includes(metadata.color), `${metadata.label} uses a palette role`);
  for (const preset of Object.values(CURVE_PRESETS)) assert.ok(Object.values(ROLE_COLORS).includes(preset.color));
  assert.equal(new Set(FILL_PALETTE.map(([, name]) => name)).size, FILL_PALETTE.length, 'swatch names stay distinct');
});

test('chrome tokens mirror the palette inks they preview', async () => {
  const tokens = await read(TOKENS);
  for (const [token, value] of [['--ink-blue', INK.blue], ['--ink-red', INK.red]]) {
    assert.match(tokens, new RegExp(`${token}:\\s*${value};`), `${token} must equal palette ${value}`);
  }
});

test('stylesheets load in cascade order: tokens, components, snap feedback, app', async () => {
  const html = await read('index.html');
  const order = [...html.matchAll(/<link rel="stylesheet" href="\.\/([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(order, ['src/ui/tokens.css', 'src/ui/components.css', 'src/graph/snap-feedback.css', 'src/styles.css']);
});

test('the shell builds every button from the shared component vocabulary', () => {
  const html = appShell();
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  const allowed = new Set(['btn', 'icon-btn', 'tool', 'segment', 'choice', 'library-item', 'swatch']);
  for (const [, attributes] of html.matchAll(/<button([^>]*)>/g)) {
    const [, classes = ''] = attributes.match(/class="([^"]*)"/) ?? [];
    assert.ok(classes.split(/\s+/).some(name => allowed.has(name)), `button without a shared component class: <button${attributes}>`);
    assert.match(attributes, /type="button"/, 'buttons never submit implicitly');
  }
  for (const legacy of ['export-button', 'tool-button', 'point-snap-setting', 'copy-children', 'setting-row', 'mouse-hint', 'primary-button']) {
    assert.ok(!html.includes(legacy), `legacy class ${legacy} is replaced by a shared component`);
  }
  assert.ok(!/style="[^"]*#[0-9a-f]/i.test(html.replace(/--swatch:#[0-9a-f]{6}/gi, '')), 'inline styles never carry literal colors');
});

test('icons share one grid and fail loudly when missing', () => {
  for (const name of ICON_NAMES) assert.match(icon(name), /viewBox="0 0 24 24"[^>]*stroke-width="1\.75"/);
  assert.throws(() => icon('nope'), /Unknown icon/);
  for (const type of ['line', 'curve', 'sketch', 'sum', 'point', 'fill', 'ruler', 'group']) assert.match(objectGlyph(type), /viewBox="0 0 16 16"/);
});
