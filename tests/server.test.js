import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const project = fileURLToPath(new URL('../', import.meta.url));
const windows = process.platform === 'win32';

async function fixture(t) {
  const local = join(project, '.local');
  await mkdir(local, { recursive: true });
  const root = await mkdtemp(join(local, 'server-test-'));
  assert.equal(dirname(root), local);
  await mkdir(join(root, 'scripts'));
  for (const name of ['server.ps1', 'dev-server.mjs']) {
    await copyFile(join(project, 'scripts', name), join(root, 'scripts', name));
  }
  await writeFile(join(root, 'index.html'), '<title>Server test</title>');
  const control = async (action, port = 5173) => execute('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(root, 'scripts', 'server.ps1'), '-Action', action, '-Port', String(port), '-NoBrowser',
  ], { env: { ...process.env, ECON_NODE: process.execPath }, windowsHide: true, timeout: 25000 });
  t.after(async () => {
    try { await control('stop'); }
    finally {
      assert.equal(dirname(root), local);
      await rm(root, { recursive: true, force: true });
    }
  });
  return {
    root, control,
    record: () => readFile(join(root, '.local', 'server.json'), 'utf8').then((s) => JSON.parse(s.replace(/^\uFEFF/, ''))),
    writeRecord: async (record) => {
      await mkdir(join(root, '.local'), { recursive: true });
      await writeFile(join(root, '.local', 'server.json'), JSON.stringify(record));
    },
  };
}

async function reservePort(t) {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => socket.close(resolve)));
  return { socket, port: socket.address().port };
}

test('Windows server launcher serializes starts, serves the app and stops idempotently', { skip: !windows }, async (t) => {
  const { control, record } = await fixture(t);
  const { socket, port } = await reservePort(t);
  await new Promise((resolve) => socket.close(resolve));
  assert.match((await control('status')).stdout, /Stopped/);
  const results = await Promise.all([control('start', port), control('start', port)]);
  assert.equal(results.filter((r) => /Server started/.test(r.stdout)).length, 1);
  assert.equal(results.filter((r) => /Already running/.test(r.stdout)).length, 1);
  const first = await record();
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Server test/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/.local/server.json`)).status, 404);
  assert.match((await control('start', port)).stdout, /Already running/);
  assert.deepEqual(await record(), first);
  assert.match((await control('status')).stdout, new RegExp(`PID ${first.pid}`));
  assert.match((await control('stop')).stdout, /Server stopped/);
  assert.match((await control('stop')).stdout, /Already stopped/);
  assert.match((await control('status')).stdout, /Stopped/);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }));
});

test('Windows launcher reports an occupied port and leaves the existing listener alone', { skip: !windows }, async (t) => {
  const { control, record } = await fixture(t);
  const { socket, port } = await reservePort(t);
  await assert.rejects(control('start', port), (error) => {
    assert.match(error.stdout, /Port .* is occupied/);
    return true;
  });
  assert.ok(socket.listening);
  await assert.rejects(record(), { code: 'ENOENT' });
  assert.match((await control('status')).stdout, /Stopped/);
});

test('Windows launcher rejects stale records and does not stop an unrelated Node process', { skip: !windows }, async (t) => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  t.after(() => unrelated.kill());
  await new Promise((resolve, reject) => { unrelated.once('spawn', resolve); unrelated.once('error', reject); });
  const { root, control, writeRecord } = await fixture(t);
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `(Get-Process -Id ${unrelated.pid}).StartTime.ToUniversalTime().Ticks.ToString()`], { windowsHide: true });
  const state = { pid: unrelated.pid, startedAt: stdout.trim(), port: 5173, script: join(root, 'scripts', 'dev-server.mjs') };
  await writeRecord(state);
  assert.match((await control('stop')).stdout, /Already stopped/);
  assert.equal(unrelated.exitCode, null);
  process.kill(unrelated.pid, 0);
  await writeRecord({ ...state, startedAt: '0' });
  assert.match((await control('status')).stdout, /Stopped/);
  assert.equal(unrelated.exitCode, null);
});
