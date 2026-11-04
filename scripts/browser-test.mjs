import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Test-only browser dependency: use an existing Chromium installation; no npm packages.
if (typeof WebSocket === 'undefined') throw Error('Browser checks require Node.js 22 or newer. The app still supports Node.js 20.');
const root = fileURLToPath(new URL('../', import.meta.url));
const local = resolve(root, '.local');
const candidates = [process.env.BROWSER_PATH,
  ...(process.platform === 'win32' ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'])].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error('Set BROWSER_PATH to an installed Chrome/Chromium/Edge executable.');
await mkdir(local, { recursive: true });
const profile = await mkdtemp(resolve(local, 'browser-check-'));
const token = randomUUID();
let complete;
const result = new Promise(resolve => { complete = resolve; });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (req.method === 'POST' && pathname === `/__results/${token}`) {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) throw Error('Test report too large'); }
      const report = JSON.parse(body); res.writeHead(200).end('ok'); complete(report); return;
    }
    if (req.method !== 'GET' || pathname.includes('\\') || pathname.split('/').includes('..')
      || !(pathname === '/' || pathname === '/index.html' || ['/src/', '/public/', '/tests/browser/', '/tests/fixtures/'].some(prefix => pathname.startsWith(prefix)))) {
      res.writeHead(404).end(); return;
    }
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(resolve(root) + sep)) { res.writeHead(403).end(); return; }
    const content = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/tests/browser/index.html?report=${token}`;
let browser, stderr = '', timer;
try {
  browser = spawn(executable, ['--headless', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--user-data-dir=${profile}`, '--window-size=1280,900', url],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
  const failed = new Promise((_, reject) => {
    browser.once('error', reject);
    browser.once('exit', code => { if (code !== null) reject(Error(`Browser exited before completing checks (${code}). ${stderr}`)); });
  });
  const timed = new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Browser checks timed out. ${stderr}`)), 45000); });
  const report = await Promise.race([result, failed, timed]);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok || !Number.isInteger(report.count) || report.count < 1) process.exitCode = 1;
} finally {
  clearTimeout(timer);
  // Close only this isolated browser instance, never an existing user's browser/profile.
  try {
    const [port, endpoint] = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
    await new Promise((resolveClose, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`), timeout = setTimeout(() => { ws.close(); reject(Error('Browser close timeout')); }, 3000);
      ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })));
      ws.addEventListener('close', () => { clearTimeout(timeout); resolveClose(); });
      ws.addEventListener('error', () => { clearTimeout(timeout); reject(Error('Browser close failed')); });
    });
  } catch { if (browser?.exitCode === null) browser.kill(); }
  await new Promise(resolveClose => server.close(resolveClose));
  const target = resolve(profile);
  if (!target.startsWith(local + sep) || !target.includes('browser-check-')) throw Error('Refusing to remove a browser profile outside the test directory');
  await delay(300);
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
