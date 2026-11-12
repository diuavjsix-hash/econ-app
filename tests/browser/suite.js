import { rangeField, numberField, RangeControl, NumberControl } from '/src/ui/controls.js';
import { createViewport, toScreen } from '/src/graph/viewport.js';
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
  const result = JSON.parse(doc.getElementById('json-output').value); doc.getElementById('close-json').click();
  // Most checks read one graph: spread the active diagram's fields over the document.
  return { ...result, ...result.diagrams.find(diagram => diagram.id === result.activeDiagramId) };
}
async function appSmoke(width, height) {
  const el = await frame('/', width, height), doc = el.contentDocument, win = el.contentWindow, size = `${width}x${height}`;
  win.addEventListener('error', e => errors.push(`${size}: ${e.message}`));
  await wait(() => doc.querySelector('#quadrant-dialog[open]'), 'app startup');
  check(win.innerWidth===width,`${size}: real iframe viewport matches the responsive test size`);
  doc.querySelector('[data-quadrants="edgeworth"]').click(); doc.getElementById('apply-workspace').click();
  check(doc.querySelector('[aria-label="B 좌표축"]'), `${size}: Edgeworth format starts with both origins`);
  // The line tool: choose the kind first, then two clicks or one drag.
  const lineSvg = doc.querySelector('.graph-svg');
  lineSvg.setPointerCapture = () => {}; lineSvg.hasPointerCapture = () => false; lineSvg.releasePointerCapture = () => {};
  const linePointer = (p, type, flags = {}) => { const r = lineSvg.getBoundingClientRect(), v = createViewport(r.width, r.height, 'edgeworth', { boxSize: { width: 10, height: 8 } }), s = toScreen(p, v);
    lineSvg.dispatchEvent(new win.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 93, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + s.x, clientY: r.top + s.y, ...flags })); };
  const lineTap = (p, flags) => { linePointer(p, 'pointerdown', flags); linePointer(p, 'pointerup', flags); };
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.05;
  doc.getElementById('line-tool').click();
  check(!doc.getElementById('line-options').hidden && doc.getElementById('line-tool').getAttribute('aria-pressed') === 'true', `${size}: the line button opens the line tool and its kind/style options`);
  doc.querySelector('#line-options [data-line-kind="segment"]').click();
  check(doc.querySelector('#line-options [data-line-kind="segment"]').getAttribute('aria-pressed') === 'true', `${size}: the chosen kind is shown before drawing`);
  lineTap({ x: 2, y: 2 }, { altKey: true });
  check(exported(doc).lines.length === 0 && doc.querySelector('.line-draft-start'), `${size}: the first click marks the start and waits`);
  lineTap({ x: 6, y: 5 }, { altKey: true });
  let drawn = exported(doc).lines;
  check(drawn.length === 1 && drawn[0].segment && near(drawn[0].segment.start, { x: 2, y: 2 }) && near(drawn[0].segment.end, { x: 6, y: 5 }), `${size}: the second click finishes a segment between the two points`);
  check(doc.getElementById('hand-tool').getAttribute('aria-pressed') === 'true' && !doc.getElementById('line-settings').hidden
    && doc.querySelector('#line-shape-selected [data-line-kind="segment"]').getAttribute('aria-pressed') === 'true', `${size}: drawing returns to selection with the new segment selected`);
  doc.getElementById('line-tool').click();
  check(doc.querySelector('#line-options [data-line-kind="segment"]').getAttribute('aria-pressed') === 'true', `${size}: the tool remembers the last kind`);
  doc.querySelector('#line-options [data-line-kind="line"]').click(); doc.querySelector('#line-options [data-line-style="dashed"]').click();
  linePointer({ x: 1, y: 7 }, 'pointerdown', { altKey: true }); linePointer({ x: 5, y: 7.3 }, 'pointermove', { altKey: true, shiftKey: true }); linePointer({ x: 5, y: 7.3 }, 'pointerup', { altKey: true, shiftKey: true });
  drawn = exported(doc).lines;
  check(drawn.length === 2 && drawn[1].slope === 0 && !drawn[1].extent && drawn[1].style === 'dashed', `${size}: one drag draws a full dashed line; Shift keeps it horizontal`);
  doc.getElementById('undo-action').click(); check(exported(doc).lines.length === 1, `${size}: each drawn line is one undo step`);
  doc.getElementById('line-tool').click(); doc.querySelector('#line-options [data-line-style="solid"]').click();
  doc.getElementById('finish-tool').click();
  check(!doc.getElementById('dashed-tool'), `${size}: the separate dashed tool button is gone`);
  doc.querySelector('.graph-line .line-hit').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  check(!doc.getElementById('line-settings').hidden && doc.querySelector('#line-shape-selected [data-line-kind="segment"]').getAttribute('aria-pressed') === 'true', `${size}: the selected line shows its kind with the same buttons`);
  doc.querySelector('#line-shape-selected [data-line-kind="ray"]').click();
  drawn = exported(doc).lines; check(drawn[0].extent[0] !== null && drawn[0].extent[1] === null, `${size}: a segment becomes a ray from its first point`);
  doc.querySelector('#line-shape-selected [data-line-kind="line"]').click(); check(!exported(doc).lines[0].extent, `${size}: and extends to a full line`);
  doc.querySelector('#line-shape-selected [data-line-kind="segment"]').click(); check(exported(doc).lines[0].segment, `${size}: a full line becomes a visible segment`);
  input(doc, 'slope-input', -1);
  const line = exported(doc).lines[0]; check(line.slope === -1, `${size}: line numeric edit uses its existing schema`);
  input(doc, 'slope-input', ''); check(exported(doc).lines[0].slope === -1, `${size}: shared numeric validation rejects an empty slope without changing geometry`);
  input(doc, 'slope-input', 0); check(exported(doc).lines[0].slope === 0, `${size}: shared numeric validation accepts a zero slope`);
  doc.querySelector('#line-shape-selected [data-line-style="dashed"]').click();
  check(exported(doc).lines[0].style === 'dashed' && doc.querySelector('.graph-line.is-dashed'), `${size}: the line inspector switches the same line to dashed`);
  doc.querySelector('#line-shape-selected [data-line-style="solid"]').click(); check(exported(doc).lines[0].style === 'solid' && !doc.querySelector('.graph-line.is-dashed'), `${size}: and back to solid`);
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
  doc.getElementById('sketch-tool').click();
  const svg=doc.querySelector('.graph-svg'),r=svg.getBoundingClientRect(),v=createViewport(r.width,r.height,'edgeworth',{boxSize:{width:10,height:8}});
  svg.setPointerCapture=()=>{};svg.hasPointerCapture=()=>false;svg.releasePointerCapture=()=>{};
  for(const p of [{x:1,y:6},{x:7,y:6},{x:4,y:2}]) {
    const s=toScreen(p,v);
    for(const type of ['pointerdown','pointerup'])svg.dispatchEvent(new win.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:94,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,clientX:r.left+s.x,clientY:r.top+s.y,altKey:true}));
  }
  doc.getElementById('finish-tool').click();
  const minimum=doc.getElementById('sketch-minimum');check(minimum.type==='checkbox'&&!minimum.checked,`${size}: minimum has only a display toggle`);
  minimum.click();const shown=exported(doc);
  check(shown.sketches.length===1&&shown.sketches[0].showMinimum&&shown.points.length===0&&doc.querySelectorAll('[data-minimum-for]').length===1,`${size}: minimum toggle stores display without generating point/line objects`);
  check(doc.getElementById('point-settings').hidden&&doc.getElementById('binding-settings').hidden,`${size}: minimum display exposes no point-following or binding actions`);
  minimum.click();check(!doc.querySelector('[data-minimum-for]'),`${size}: checkbox turns the display off`);
  // A cap touching the cup's bottom at (4,2): the real button starts the line on the shared tangent.
  // The inspector can resize the graph on narrow screens: map taps with the current box.
  const pointer=(p,flags={},type='pointerdown')=>{const r=svg.getBoundingClientRect(),v=createViewport(r.width,r.height,'edgeworth',{boxSize:{width:10,height:8}}),s=toScreen(p,v);svg.dispatchEvent(new win.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:94,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,clientX:r.left+s.x,clientY:r.top+s.y,...flags}));};
  const tap=(p,flags)=>{pointer(p,flags,'pointerdown');pointer(p,flags,'pointerup');};
  doc.getElementById('sketch-tool').click();const mode=doc.getElementById('sketch-mode');mode.value='horizontal';mode.dispatchEvent(new win.Event('change',{bubbles:true}));
  for(const p of [{x:1,y:0.5},{x:7,y:0.5},{x:4,y:2}]) tap(p,{altKey:true});
  doc.getElementById('finish-tool').click();doc.getElementById('mouse-tool').click();tap({x:4.08,y:2.06});
  // Taps round to pixels, so the contact is the shared anchor of both drawn curves.
  const touching=exported(doc),contactPoint=touching.points.at(-1),[cup,cap]=touching.sketches.map(k=>k.anchor);
  const at=(p,q)=>p&&q&&Math.hypot(p.x-q.x,p.y-q.y)<1e-6;
  check(touching.sketches.length===2&&at(cup,cap)&&Math.hypot(cup.x-4,cup.y-2)<0.01&&at(contactPoint?.anchor,cup),`${size}: point snaps to the cup/cap contact`);
  check(!doc.getElementById('point-settings').hidden,`${size}: the contact point shows its through-line action`);
  doc.getElementById('point-through-line').click();const through=exported(doc).lines.at(-1);
  check(through&&Math.abs(through.slope)<1e-6&&at(through.anchor,cup),`${size}: through-line button starts on the common tangent`);
  doc.getElementById('undo-action').click();check(exported(doc).lines.length===touching.lines.length,`${size}: one undo removes the tangent line`);
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
  const segments = await frame('./segment-curve-contact.html', 1000, 900);
  await wait(() => segments.contentDocument.querySelector('#run'), 'segment curve fixture'); segments.contentDocument.querySelector('#run').click();
  const segmentResult = await wait(() => { try { return JSON.parse(segments.contentDocument.querySelector('#result').textContent); } catch { return null; } }, 'segment curve report');
  check(segmentResult.ok,`segment curve fixture: ${segmentResult.error ?? 'completed'}`);
  for (const name of segmentResult.passed) passed.push(`segment curve: ${name}`);
  segments.remove();
  const edgeworth = await frame('./edgeworth-minimum.html', 1000, 900);
  await wait(() => edgeworth.contentDocument.querySelector('#run'), 'edgeworth minimum fixture'); edgeworth.contentDocument.querySelector('#run').click();
  const edgeworthResult = await wait(() => { try { return JSON.parse(edgeworth.contentDocument.querySelector('#result').textContent); } catch { return null; } }, 'edgeworth minimum report');
  check(edgeworthResult.ok,`edgeworth minimum fixture: ${edgeworthResult.error ?? 'completed'}`);
  for (const name of edgeworthResult.passed) passed.push(`edgeworth minimum: ${name}`);
  edgeworth.remove();
  const extentFrame = await frame('./line-extent.html', 1000, 900);
  await wait(() => extentFrame.contentDocument.querySelector('#run'), 'line extent fixture'); extentFrame.contentDocument.querySelector('#run').click();
  const extentResult = await wait(() => { try { return JSON.parse(extentFrame.contentDocument.querySelector('#result').textContent); } catch { return null; } }, 'line extent report');
  check(extentResult.ok,`line extent fixture: ${extentResult.error ?? 'completed'}`);
  for (const name of extentResult.passed) passed.push(`line extent: ${name}`);
  extentFrame.remove();
  const tangentLine = await frame('./contact-tangent-line.html', 1000, 900);
  await wait(() => tangentLine.contentDocument.querySelector('#run'), 'contact tangent line fixture'); tangentLine.contentDocument.querySelector('#run').click();
  const tangentResult = await wait(() => { try { return JSON.parse(tangentLine.contentDocument.querySelector('#result').textContent); } catch { return null; } }, 'contact tangent line report');
  check(tangentResult.ok,`contact tangent line fixture: ${tangentResult.error ?? 'completed'}`);
  for (const name of tangentResult.passed) passed.push(`contact tangent line: ${name}`);
  tangentLine.remove();
  await appSmoke(1280, 800); await appSmoke(390, 844);
  check(errors.length === 0, `no browser runtime errors: ${errors.join('; ')}`);
} catch (error) { errors.push(error.stack ?? String(error)); }
const report = { ok: errors.length === 0, count: passed.length, passed, errors };
document.getElementById('browser-result').textContent = JSON.stringify(report, null, 2);
const token = new URLSearchParams(location.search).get('report');
if (token) await fetch(`/__results/${encodeURIComponent(token)}`, { method: 'POST', body: JSON.stringify(report) });
