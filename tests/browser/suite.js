import { rangeField, numberField, RangeControl, NumberControl } from '/src/ui/controls.js';
const passed = [], errors = [];
const check = (condition, name) => { if (!condition) throw Error(name); passed.push(name); };
window.addEventListener('error', e => errors.push(e.message));
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
const wait = async (fn, name) => {
  const end = performance.now() + 10000;
  while (performance.now() < end) { const value = fn(); if (value) return value; await new Promise(r => setTimeout(r, 30)); }
  throw Error(`Timed out: ${name}`);
};
async function frame(src, width, height) {
  const el = document.createElement('iframe'); el.style.width = `${width}px`; el.style.height = `${height}px`;
  const loaded = new Promise((resolve, reject) => { el.onload = resolve; el.onerror = reject; });
  el.src = src; document.body.append(el); await loaded; return el;
}
function input(doc, id, value) {
  const field = doc.getElementById(id); field.focus(); field.value = String(value);
  field.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })); field.blur();
}
function exported(doc) {
  doc.getElementById('export-json').click();
  const result = JSON.parse(doc.getElementById('json-output').value); doc.getElementById('close-json').click(); return result;
}
async function appSmoke(width, height) {
  const el = await frame('/', width, height), doc = el.contentDocument, win = el.contentWindow, size = `${width}x${height}`;
  win.addEventListener('error', e => errors.push(`${size}: ${e.message}`));
  await wait(() => doc.querySelector('#quadrant-dialog[open]'), 'app startup');
  check(win.innerWidth===width,`${size}: real iframe viewport matches the responsive test size`);
  doc.querySelector('[data-quadrants="edgeworth"]').click(); doc.getElementById('apply-workspace').click();
  check(doc.querySelector('[aria-label="B 좌표축"]'), `${size}: Edgeworth format starts with both origins`);
  doc.getElementById('line-tool').click();
  input(doc, 'slope-input', -1);
  const line = exported(doc).lines[0]; check(line.slope === -1, `${size}: line numeric edit uses its existing schema`);
  input(doc, 'slope-input', ''); check(exported(doc).lines[0].slope === -1, `${size}: shared numeric validation rejects an empty slope without changing geometry`);
  input(doc, 'slope-input', 0); check(exported(doc).lines[0].slope === 0, `${size}: shared numeric validation accepts a zero slope`);
  doc.getElementById('sketch-tool').click(); doc.querySelector('[data-add-indifference="ppc"]').click();
  check(doc.querySelector('#ppc-radii:not([hidden])'), `${size}: PPC inspector renders shared fields`);
  input(doc, 'object-name', '공통 편집'); input(doc, 'ppc-radius-x', 6);
  let json = exported(doc); check(Math.abs(json.curves[0].geometry.radii.x - 6) < 1e-8 && json.curves[0].name === '공통 편집', `${size}: shared numeric/name controls preserve edits`);
  const shape = doc.getElementById('indifference-shape'); input(doc, 'indifference-shape', Number(shape.value) + 1);
  json = exported(doc); check(json.curves[0].geometry.radii.y / json.curves[0].geometry.radii.x > 0, `${size}: shared range updates analytic geometry`);
  const handle = doc.querySelector('[data-action="ppc-x"]');
  handle.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  const edited = exported(doc); check(edited.curves[0].anchor.x > json.curves[0].anchor.x, `${size}: registered endpoint keyboard controller edits only the selected radius`);
  doc.getElementById('duplicate-tool').click(); doc.getElementById('duplicate-action').click(); doc.getElementById('finish-tool').click();
  check(exported(doc).curves.length === 2, `${size}: duplicate uses shared model behavior`);
  doc.getElementById('undo-action').click(); check(exported(doc).curves.length === 1, `${size}: duplicate undo stays one history step`);
  doc.getElementById('redo-action').click(); check(exported(doc).curves.length === 2, `${size}: redo restores independent geometry`);
  check(doc.querySelectorAll('.graph-curve .line-hit').length === 2 && doc.querySelectorAll('.graph-line .line-hit').length === 1, `${size}: shared renderer exposes matching hit areas`);
  check(['creation-inspector','operation-inspector','selection-inspector','multi-selection-inspector'].filter(id=>!doc.getElementById(id).hidden).length===1,`${size}: only one task inspector is active`);
  check(doc.documentElement.scrollWidth <= doc.documentElement.clientWidth + 1, `${size}: document has no horizontal overflow`);
  const ids = [...doc.querySelectorAll('[id]')].map(n => n.id); check(new Set(ids).size === ids.length, `${size}: shared components generate unique IDs`);
  for (const id of ['ppc-radius-x', 'ppc-radius-y', 'indifference-shape', 'bend-slider', 'sketch-left', 'sketch-right']) {
    check(doc.querySelector(`label[for="${id}"]`), `${size}: ${id} has an associated label`);
  }
  el.remove();
}
try {
  const controls = document.createElement('section');
  controls.innerHTML = numberField({id:'check-number',label:'수량 <검사>',min:1,max:10,step:0.5,value:2})
    + rangeField({id:'check-range',label:'크기',min:-90,max:90,step:0.1,value:0});
  document.body.append(controls);
  const numeric = new NumberControl(controls,'check-number'), range = new RangeControl(controls,'check-range');
  const changes = []; numeric.bind(value=>changes.push(value));
  input(document,'check-number',-1); input(document,'check-number',''); input(document,'check-number',5);
  check(changes.length===1 && changes[0]===5,'components: numeric callbacks reject empty/out-of-range values');
  check(controls.querySelector('label').textContent.includes('<검사>') && !controls.querySelector('검사'),'components: generated labels escape HTML');
  numeric.dispose(); input(document,'check-number',6); check(changes.length===1,'components: disposed controls remove their input listeners');
  range.setValue(45,'양의 기울기');
  check(range.input.style.getPropertyValue('--progress')==='75%' && range.input.getAttribute('aria-valuetext')==='양의 기울기','components: range progress and accessible value share one update');
  range.dispose(); controls.remove();
  const snap = await frame('./snap-feedback.html', 1000, 900);
  await wait(() => snap.contentDocument.querySelector('#run'), 'snap fixture'); snap.contentDocument.querySelector('#run').click();
  const snapResult = await wait(() => {
    try { return JSON.parse(snap.contentDocument.querySelector('#result').textContent); } catch { return null; }
  }, 'snap regression report');
  check(snapResult.ok, `snap fixture: ${snapResult.error ?? 'completed'}`);
  for (const name of snapResult.passed) passed.push(`canvas: ${name}`);
  snap.remove();
  const curves = await frame('./curve-curve.html', 1000, 900);
  await wait(() => curves.contentDocument.querySelector('#run'), 'curve contact fixture'); curves.contentDocument.querySelector('#run').click();
  const curveResult = await wait(() => { try { return JSON.parse(curves.contentDocument.querySelector('#result').textContent); } catch { return null; } }, 'curve contact report');
  check(curveResult.ok,`curve contact fixture: ${curveResult.error ?? 'completed'}`);
  for (const name of curveResult.passed) passed.push(`curve contact: ${name}`);
  curves.remove();
  const contract = await frame('./contact-contract.html', 1000, 900);
  await wait(() => contract.contentDocument.querySelector('#run'), 'contact contract fixture'); contract.contentDocument.querySelector('#run').click();
  const contractResult = await wait(() => { try { return JSON.parse(contract.contentDocument.querySelector('#result').textContent); } catch { return null; } }, 'contact contract report');
  check(contractResult.ok,`contact contract fixture: ${contractResult.error ?? 'completed'}`);
  for (const name of contractResult.passed) passed.push(`contact contract: ${name}`);
  contract.remove();
  await appSmoke(1280, 800); await appSmoke(390, 844);
  check(errors.length === 0, `no browser runtime errors: ${errors.join('; ')}`);
} catch (error) { errors.push(error.stack ?? String(error)); }
const report = { ok: errors.length === 0, count: passed.length, passed, errors };
document.getElementById('browser-result').textContent = JSON.stringify(report, null, 2);
const token = new URLSearchParams(location.search).get('report');
if (token) await fetch(`/__results/${encodeURIComponent(token)}`, { method: 'POST', body: JSON.stringify(report) });
