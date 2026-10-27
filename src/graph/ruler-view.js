import { clipSegment, rulerMetrics } from './ruler.js';
import { toScreen } from './viewport.js';

const NS = 'http://www.w3.org/2000/svg';
export function drawRuler(ruler, viewport, { selected = false, preview = false, clipId } = {}) {
  const node = (tag, attrs, text) => {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const group = node('g', { class: `graph-ruler${preview ? ' ruler-preview' : ''}`, 'data-ruler-id': ruler.id ?? '', style: `--ruler-color:${ruler.color ?? '#7b879c'}` });
  const visible = clipSegment(ruler.anchor, ruler.end, viewport.bounds);
  if (!visible) return group;
  const [a, b] = visible.map(p => toScreen(p, viewport));
  const coordinates = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  group.append(node('line', { ...coordinates, class: `ruler-segment ${ruler.style ?? 'solid'}${selected ? ' is-selected' : ''}` }));
  if (!preview) group.append(node('line', { ...coordinates, class: 'line-hit ruler-hit', 'clip-path': `url(#${clipId})`, 'data-id': ruler.id, 'data-action': 'move', tabindex: 0, role: 'button', 'aria-label': `${ruler.name} 이동`, 'aria-pressed': selected }));
  const rawA = toScreen(ruler.anchor, viewport), rawB = toScreen(ruler.end, viewport);
  const length = Math.hypot(rawB.x - rawA.x, rawB.y - rawA.y);
  const dx = length ? (rawB.x - rawA.x) / length : 1, dy = length ? (rawB.y - rawA.y) / length : 0;
  for (const [action, point] of [['start', rawA], ['end', rawB]]) {
    const { plot } = viewport;
    if (point.x < plot.left || point.x > plot.right || point.y < plot.top || point.y > plot.bottom) continue;
    group.append(node('line', { x1: point.x - dy * 6, y1: point.y + dx * 6, x2: point.x + dy * 6, y2: point.y - dx * 6, class: 'ruler-tick' }));
    if (selected && !preview) group.append(node('circle', { cx: point.x, cy: point.y, r: 6, class: 'ruler-endpoint', 'data-id': ruler.id, 'data-action': action, tabindex: 0, role: 'button', 'aria-label': `${ruler.name} ${action === 'start' ? '시작점' : '끝점'} 이동` }));
  }
  if (ruler.showMeasurement !== false) {
    const label = node('text', { x: Math.max(24, Math.min(viewport.width - 40, (a.x + b.x) / 2)), y: Math.max(18, Math.min(viewport.height - 10, (a.y + b.y) / 2 - 12)), class: 'ruler-label', 'text-anchor': 'middle' }, String(Number(rulerMetrics(ruler).length.toFixed(2))));
    group.append(label);
  }
  return group;
}
