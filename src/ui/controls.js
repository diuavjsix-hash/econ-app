// Markup builders for every shared control. The class names here are the component
// vocabulary styled in src/ui/components.css; panels compose these builders instead
// of hand-writing control markup, so a new tool inherits the same look and behavior.
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const attrs = values => Object.entries(values).filter(([, value]) => value !== undefined && value !== false && value !== null)
  .map(([key, value]) => value === true ? escape(key) : `${escape(key)}="${escape(value)}"`).join(' ');
const dataAttrs = data => Object.fromEntries(Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value]));
const classes = (...names) => names.filter(Boolean).join(' ');

export function rangeField({ id, label, labelId, min, max, step, value, outputId, output = '', ariaLabel }) {
  return `<div class="range-field"><div class="range-head"><label ${attrs({ id: labelId, for: id })}>${escape(label)}</label>${outputId ? `<output ${attrs({ id: outputId, for: id, class: 'value-chip' })}>${escape(output)}</output>` : ''}</div>`
    + `<input ${attrs({ id, class: 'ui-range range', type: 'range', min, max, step, value, 'aria-label': ariaLabel })} /></div>`;
}
export function numberField({ id, label, min, max, step, value, required = false }) {
  return `<label class="field" for="${escape(id)}"><span class="field-label">${escape(label)}</span><input ${attrs({ id, class: 'ui-number input input-number', type: 'number', min, max, step, value, required })} /></label>`;
}
export function textField({ id, label, value, placeholder, maxlength = 80, stacked = false }) {
  return `<label class="${classes('field', stacked && 'field-stacked')}" for="${escape(id)}"><span class="field-label">${escape(label)}</span><input ${attrs({ id, class: 'input', type: 'text', value, placeholder, maxlength, autocomplete: 'off' })} /></label>`;
}
export function selectField({ id, label, options, rowId, hidden = false }) {
  const items = options.map(([value, text]) => `<option value="${escape(value)}">${escape(text)}</option>`).join('');
  return `<label ${attrs({ id: rowId, class: 'field', for: id, hidden })}><span class="field-label">${escape(label)}</span><select ${attrs({ id, class: 'select' })}>${items}</select></label>`;
}
export function switchField({ id, label, checked = false, describedBy, controls }) {
  return `<label class="switch" for="${escape(id)}"><span class="switch-label">${escape(label)}</span><input ${attrs({ id, class: 'switch-input', type: 'checkbox', role: 'switch', checked, 'aria-describedby': describedBy, 'aria-controls': controls })} /><span class="switch-track" aria-hidden="true"></span></label>`;
}
export function checkField({ id, label, checked = false, rowId, hidden = false }) {
  return `<label ${attrs({ id: rowId, class: 'check', for: id, hidden })}><input ${attrs({ id, class: 'check-input', type: 'checkbox', checked })} /><span>${escape(label)}</span></label>`;
}
export function hint(text, { id, live = false } = {}) {
  return `<p ${attrs({ id, class: 'hint', role: live ? 'status' : undefined, 'aria-live': live ? 'polite' : undefined })}>${escape(text)}</p>`;
}

/** Buttons: `secondary` (default), `primary`, `ghost`, `danger`. Icon HTML comes from ui/icons.js. */
export function button({ id, label, icon = '', variant = 'secondary', size, block = false, ariaLabel, title, disabled = false, hidden = false, labelId, data, className, popup }) {
  return `<button ${attrs({ type: 'button', id, class: classes('btn', `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className), 'aria-label': ariaLabel, title, disabled, hidden, 'aria-haspopup': popup, ...dataAttrs(data) })}>${icon}${label ? `<span ${attrs({ id: labelId })}>${escape(label)}</span>` : ''}</button>`;
}
export function iconButton({ id, icon, label, title = label, pressed, disabled = false, hidden = false, className, controls }) {
  return `<button ${attrs({ type: 'button', id, class: classes('icon-btn', className), 'aria-label': label, title, 'aria-pressed': pressed === undefined ? undefined : String(pressed), 'aria-controls': controls, disabled, hidden })}>${icon}</button>`;
}
/** Toolbar entries: a drawing tool, or a `command` that opens an operation panel. */
export function toolButton({ id, label, icon, title, ariaLabel, pressed, controls, command = false, suffix = '' }) {
  return `<button ${attrs({ type: 'button', id, class: classes('tool', command && 'tool-command'), title, 'aria-label': ariaLabel,
    'aria-pressed': pressed === undefined ? undefined : String(pressed), 'aria-expanded': controls ? 'false' : undefined, 'aria-controls': controls })}><span class="tool-icon">${icon}</span><span class="tool-label">${escape(label)}</span>${suffix}</button>`;
}
/**
 * A row of mutually exclusive choices. Each item names its data attribute so the
 * tool keeps reading `[data-…]`; `glyph` is static SVG/text from the app, `meta` a small caption.
 */
export function segmented({ label, items, columns, id, className }) {
  const style = columns ? `--segments:${columns}` : undefined;
  return `<div ${attrs({ id, class: classes('segmented', className), role: 'group', 'aria-label': label, style })}>${items.map(item =>
    `<button ${attrs({ type: 'button', class: 'segment', 'aria-pressed': String(Boolean(item.pressed)), 'aria-label': item.ariaLabel, title: item.title, ...dataAttrs(item.data) })}>${item.glyph ? `<span class="segment-glyph" aria-hidden="true">${item.glyph}</span>` : ''}${item.label ? `<span class="segment-label">${escape(item.label)}</span>` : ''}${item.meta ? `<span class="segment-meta">${escape(item.meta)}</span>` : ''}</button>`).join('')}</div>`;
}

export class InputControl {
  constructor(root, id) {
    if (new.target === InputControl) throw new TypeError('InputControl is abstract');
    this.input = root.querySelector(`#${id}`);
    if (!this.input) throw new TypeError(`Missing UI control: ${id}`);
    this.listeners = [];
  }
  bind(callback) {
    const listener = () => { const value = this.read(); if (value !== null) callback(value); };
    this.input.addEventListener('input', listener); this.listeners.push(listener); return this;
  }
  read() { throw new TypeError('A control must implement read()'); }
  dispose() { for (const listener of this.listeners) this.input.removeEventListener('input', listener); this.listeners.length = 0; }
}
export class NumberControl extends InputControl {
  constructor(root, id) {
    super(root, id);
    if (!['number','range'].includes(this.input.type)) throw new TypeError(`${id} must be a numeric input`);
  }
  read() {
    const n = this.input.valueAsNumber;
    if (!Number.isFinite(n) || this.input.value === '') return null;
    if (this.input.min !== '' && n < Number(this.input.min) || this.input.max !== '' && n > Number(this.input.max)) return null;
    return n;
  }
  setValue(value, digits = null) {
    if (this.input !== this.input.ownerDocument.activeElement || Math.abs(this.input.valueAsNumber - value) > 1e-8) {
      this.input.value = String(digits === null ? value : Number(value.toFixed(digits)));
    }
  }
}
export class RangeControl extends NumberControl {
  constructor(root, id) {
    super(root, id);
    if (this.input.type !== 'range') throw new TypeError(`${id} must be a range input`);
  }
  setValue(value, ariaText) {
    this.input.value = String(value);
    const min = Number(this.input.min || 0), max = Number(this.input.max || 100), progress = max > min ? (Number(this.input.value) - min) / (max - min) * 100 : 0;
    this.input.style.setProperty('--progress', `${Math.max(0, Math.min(100, progress))}%`);
    if (ariaText !== undefined) this.input.setAttribute('aria-valuetext', String(ariaText));
  }
}
