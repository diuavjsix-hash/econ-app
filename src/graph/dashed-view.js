import { clipSegment } from './ruler.js';
import { toScreen } from './viewport.js';

export function drawDashedLine(segment, viewport, { selected = false, editable = true, preview = false, clipId } = {}) {
  const node = (tag, attrs) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  };
  const group = node('g', { class: `graph-dashed${preview ? ' dashed-preview' : ''}`, 'data-dashed-id': segment.id ?? '', style: `--dashed-color:${segment.color ?? '#7b879c'}` });
  const visible = clipSegment(segment.anchor, segment.end, viewport.bounds);
  if (!visible) return group;
  const [a, b] = visible.map(point => toScreen(point, viewport));
  const coordinates = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  group.append(node('line', { ...coordinates, class: `dashed-segment${selected ? ' is-selected' : ''}` }));
  if (preview) return group;
  group.append(node('line', { ...coordinates, class: 'line-hit dashed-hit', 'clip-path': `url(#${clipId})`, 'data-id': segment.id, 'data-action': 'move', tabindex: 0, role: 'button', 'aria-label': `${segment.name} 이동`, 'aria-pressed': selected }));
  if (selected && editable) for (const [action, point] of [['start', segment.anchor], ['end', segment.end]]) {
    const screen = toScreen(point, viewport), { plot } = viewport;
    if (screen.x < plot.left || screen.x > plot.right || screen.y < plot.top || screen.y > plot.bottom) continue;
    group.append(node('circle', { cx: screen.x, cy: screen.y, r: 6, class: 'dashed-endpoint', 'data-id': segment.id, 'data-action': action, tabindex: 0, role: 'button', 'aria-label': `${segment.name} ${action === 'start' ? '시작점' : '끝점'} 이동` }));
  }
  return group;
}
