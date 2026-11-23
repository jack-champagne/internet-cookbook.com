/**
 * Physical units. Everything is converted to points (1/72 in), the unit the
 * layout works in. Theme lengths must carry a unit so nothing is ambiguous.
 */

const PER_UNIT = { pt: 1, in: 72, mm: 72 / 25.4 };
const NUMBER = '(-?\\d+(?:\\.\\d+)?)';

/**
 * `'58pt'` → 58, `'0.125in'` → 9, `'3mm'` → 8.50…
 * @param {unknown} value @returns {number}
 */
export function parseLength(value) {
  if (typeof value === 'number') throw new Error(`"${value}" needs a unit (pt, in or mm), e.g. ${value}pt`);
  const m = new RegExp(`^\\s*${NUMBER}\\s*(pt|in|mm)\\s*$`).exec(String(value));
  if (!m) throw new Error(`"${value}" is not a length; use pt, in or mm, e.g. 12pt`);
  return Number(m[1]) * PER_UNIT[/** @type {'pt'|'in'|'mm'} */ (m[2])];
}

/**
 * `'8 x 10 in'` → { width: 576, height: 720 }
 * @param {unknown} value @returns {{ width: number, height: number }}
 */
export function parseTrim(value) {
  const m = new RegExp(`^\\s*${NUMBER}\\s*[x×]\\s*${NUMBER}\\s*(pt|in|mm)\\s*$`).exec(String(value));
  if (!m) throw new Error(`"${value}" is not a page size; use e.g. "8 x 10 in"`);
  const k = PER_UNIT[/** @type {'pt'|'in'|'mm'} */ (m[3])];
  return { width: Number(m[1]) * k, height: Number(m[2]) * k };
}

/** `'38%'` → 0.38 @param {unknown} value @returns {number} */
export function parsePercent(value) {
  const m = new RegExp(`^\\s*${NUMBER}\\s*%\\s*$`).exec(String(value));
  if (!m) throw new Error(`"${value}" is not a percentage, e.g. 40%`);
  return Number(m[1]) / 100;
}

/**
 * A length in a Markdown image attribute: a percentage of `of`, a length with
 * a unit, or a bare number of points.
 * @param {unknown} value @param {number} of @returns {number}
 */
export function attrLength(value, of) {
  const s = String(value).trim();
  if (s.endsWith('%')) return parsePercent(s) * of;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return parseLength(s);
}

/**
 * `'U+0000-00FF, U+2013'` → [[0, 255], [8211, 8211]]
 * @param {string} value @returns {[number, number][]}
 */
export function parseUnicodeRange(value) {
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i.exec(part);
      if (!m) throw new Error(`"${part}" is not a Unicode range, e.g. U+0000-00FF`);
      const lo = parseInt(m[1], 16);
      return /** @type {[number, number]} */ ([lo, m[2] ? parseInt(m[2], 16) : lo]);
    });
}

/** @param {number} codePoint @param {[number, number][]} ranges */
export const inRanges = (codePoint, ranges) => ranges.some(([lo, hi]) => codePoint >= lo && codePoint <= hi);
