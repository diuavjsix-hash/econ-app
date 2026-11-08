import { FILL_PALETTE } from '../models/palette.js';
export const FILL_COLORS = FILL_PALETTE;

export function alphabetLabel(index) {
  let label = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + (value - 1) % 26) + label;
  return label;
}

export function nextFillLabel(fills) {
  let highest = 0;
  for (const { label } of fills) {
    if (!/^[A-Z]{1,8}$/.test(label ?? '')) continue;
    const value = [...label].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
    highest = Math.max(highest, value);
  }
  return alphabetLabel(highest);
}

function generatedColor(index) {
  const hue = (index * 137.507764) % 360 / 60, chroma = 0.58, low = 0.23;
  const secondary = chroma * (1 - Math.abs(hue % 2 - 1));
  const rgb = [[chroma,secondary,0],[secondary,chroma,0],[0,chroma,secondary],[0,secondary,chroma],[secondary,0,chroma],[chroma,0,secondary]][Math.floor(hue)];
  return '#' + rgb.map(value => Math.round((value + low) * 255).toString(16).padStart(2, '0')).join('');
}

/** Avoid every color currently used in this graph, including manual overrides. */
export function nextFillColor(fills) {
  const used = new Set(fills.map(fill => fill.color.toLowerCase()));
  for (const [color] of FILL_COLORS) if (!used.has(color)) return color;
  for (let index = 0; ; index++) {
    const color = generatedColor(index);
    if (!used.has(color)) return color;
  }
}
