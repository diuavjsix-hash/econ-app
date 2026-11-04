import { toScreen } from './viewport.js';

/** Shared SVG creation; document lookup is deferred so geometry stays usable in Node. */
export class SvgRenderer {
  element(tag, attributes = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  pathData(pieces, viewport, { quadratic = false, connect = true } = {}) {
    let previous = null;
    return pieces.map(points => {
      const projected = points.map(point => toScreen(point, viewport));
      const start = projected[0], end = projected.at(-1), control = projected[1];
      const connected = connect && previous && Math.hypot(start.x - previous.x, start.y - previous.y) < 1e-6;
      previous = end;
      return `${connected ? '' : `M${start.x} ${start.y}`}${quadratic ? `Q${control.x} ${control.y} ${end.x} ${end.y}` : `L${end.x} ${end.y}`}`;
    }).join(' ');
  }
}

/** Lines, curves, free curves and sums share paint, hit area and accessibility. */
export class StrokeRenderer extends SvgRenderer {
  append(group, object, d, { selected = false, clipId, action = 'move', title, interactive = true } = {}) {
    if (!d) return group;
    group.append(this.element('path', { d, fill: 'none', class: `plotted-line${selected ? ' is-selected' : ''}`, 'aria-hidden': 'true' }));
    if (interactive) {
      const hit = this.element('path', { d, fill: 'none', class: 'line-hit', 'clip-path': `url(#${clipId})`, 'data-id': object.id,
        'data-action': action, tabindex: 0, role: 'button', 'aria-label': `${object.name} ${action === 'select' ? '선택' : '이동'}`, 'aria-pressed': selected });
      if (title !== undefined) hit.append(this.element('title', {}, title));
      group.append(hit);
    }
    return group;
  }
  render(object, pieces, viewport, { groupClass, ...options } = {}) {
    const group = this.element('g', { class: groupClass, style: `--line-color:${object.color}` });
    return this.append(group, object, this.pathData(pieces, viewport, options), options);
  }
}

export const SVG_RENDERER = Object.freeze(new SvgRenderer());
export const STROKE_RENDERER = Object.freeze(new StrokeRenderer());
