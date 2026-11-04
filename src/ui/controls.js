const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const attrs = values => Object.entries(values).filter(([, value]) => value !== undefined && value !== false)
  .map(([key, value]) => value === true ? escape(key) : `${escape(key)}="${escape(value)}"`).join(' ');

export function rangeField({ id, label, labelId, min, max, step, value, outputId, output = '', ariaLabel }) {
  return `<div class="slope-heading"><label ${attrs({ id: labelId, for: id })}>${escape(label)}</label>${outputId ? `<output ${attrs({ id: outputId, for: id })}>${escape(output)}</output>` : ''}</div>`
    + `<input ${attrs({ id, class: 'ui-range', type: 'range', min, max, step, value, 'aria-label': ariaLabel })} />`;
}
export function numberField({ id, label, min, max, step, value, required = false }) {
  return `<label class="setting-row" for="${escape(id)}">${escape(label)}<input ${attrs({ id, class: 'ui-number', type: 'number', min, max, step, value, required })} /></label>`;
}
/** Icon HTML comes from the app's static icon library, never from document data. */
export function toolButton({ id, label, icon, title, ariaLabel, pressed, controls, command = false, suffix = '' }) {
  return `<button ${attrs({ id, class: command ? 'export-button toolbar-command' : 'tool-button', title, 'aria-label': ariaLabel,
    'aria-pressed': pressed === undefined ? undefined : String(pressed), 'aria-expanded': controls ? 'false' : undefined, 'aria-controls': controls })}><span class="tool-icon">${icon}</span><strong>${escape(label)}</strong>${suffix}</button>`;
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
