/**
 * theme.yaml → a resolved Template for one edition, in points.
 *
 * The Template is what the layout code consumes: page size and margins,
 * text styles with CSS font families, recipe settings, colours, and the font
 * files to load. Editions override only what differs from the base theme.
 */
import { BookError } from './errors.js';
import { parseLength, parsePercent, parseTrim, parseUnicodeRange } from './units.js';

/**
 * @typedef {object} TextStyle
 * @property {string} role        the style's name (e.g. 'heading'), recorded on text it sets
 * @property {string} family      CSS font family, quoted
 * @property {number} weight
 * @property {number} boldWeight
 * @property {number} size        points
 * @property {number} leading     points
 * @property {string} color
 * @property {boolean} [italic]
 * @property {boolean} [caps]
 * @property {number} [letterSpacing]  points
 * @property {number} [spaceBefore]
 * @property {number} [spaceAfter]
 */
/**
 * @typedef {object} Template
 * @property {string} name
 * @property {string} edition
 * @property {{ width: number, height: number, bleed: number,
 *   margin: { top: number, bottom: number, inside: number, outside: number, left: number, right: number } }} page
 * @property {Record<string, TextStyle>} styles
 * @property {{ columns: number, gap: number, hang: number, itemGap: number }} ingredients
 * @property {{ indent: number }} steps
 * @property {{ indent: number }} note       fraction of the text width
 * @property {Record<string, string>} colors
 * @property {Record<string, string>} cover
 * @property {Record<string, string>} endpaper
 * @property {{ family: string, src: string, style: string, weight: string }[]} fonts
 * @property {[number, number][]} unicodeRanges
 */

export const STYLE_NAMES = [
  'kicker',
  'title',
  'lede',
  'meta',
  'heading',
  'body',
  'step',
  'stepNumber',
  'note',
  'folio',
];
const STYLE_KEYS = [
  'font',
  'weight',
  'size',
  'leading',
  'color',
  'italic',
  'caps',
  'tracking',
  'spaceBefore',
  'spaceAfter',
];
const TOP_KEYS = ['fonts', 'colors', 'cover', 'endpaper', 'editions', 'styles', 'recipe'];

/** @param {any} a @param {any} b @returns {any} */
function merge(a, b) {
  if (b == null) return a;
  if (typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
  return out;
}

/**
 * @param {any} theme        parsed theme.yaml
 * @param {string} edition   e.g. 'book'
 * @param {{ file?: string, siteBase?: string, lineOf?: (key: string) => number | undefined }} [where]
 * @returns {Template}
 */
export function resolveTemplate(theme, edition, where = {}) {
  const file = where.file ?? 'theme.yaml';
  const siteBase = where.siteBase ?? '/';
  /** @param {string} message @param {string} [key] */
  const fail = (message, key) => {
    throw new BookError(message, { file, line: key ? where.lineOf?.(key) : undefined });
  };
  /** @param {() => any} fn @param {string} what @param {string} key */
  const attempt = (fn, what, key) => {
    try {
      return fn();
    } catch (e) {
      return fail(`${what}: ${/** @type {Error} */ (e).message}`, key);
    }
  };

  if (!theme || typeof theme !== 'object') fail('the theme must be a set of "key: value" settings');
  for (const k of Object.keys(theme)) if (!TOP_KEYS.includes(k)) fail(`unknown setting "${k}"`, k);
  const ed = theme.editions?.[edition];
  if (!ed) fail(`no edition named "${edition}" under editions`, 'editions');
  const t = merge(theme, ed.overrides ?? {});

  /** @type {Record<string, string>} */
  const families = {};
  const fonts = [];
  for (const [key, f] of Object.entries(theme.fonts ?? {})) {
    if (key === 'unicodeRange') continue;
    if (!f?.family || !Array.isArray(f.files)) fail(`font "${key}" needs a family and files`, key);
    families[key] = `"${f.family}"`;
    for (const file of f.files) {
      fonts.push({
        family: f.family,
        src: siteBase + file.src,
        style: file.style ?? 'normal',
        weight: String(file.weight ?? '400'),
      });
    }
  }
  const unicodeRanges = theme.fonts?.unicodeRange
    ? attempt(() => parseUnicodeRange(theme.fonts.unicodeRange), 'fonts.unicodeRange', 'unicodeRange')
    : [[0, 0x10ffff]];

  const colors = t.colors ?? {};
  /** @param {string} c */
  const color = (c) => colors[c] ?? c;

  /** @type {Record<string, TextStyle>} */
  const styles = {};
  for (const name of STYLE_NAMES) {
    const s = t.styles?.[name];
    if (!s) fail(`missing text style "${name}"`, 'styles');
    for (const k of Object.keys(s)) if (!STYLE_KEYS.includes(k)) fail(`style "${name}": unknown setting "${k}"`, name);
    if (!families[s.font]) fail(`style "${name}": font "${s.font}" isn't defined under fonts`, name);
    /** @param {string} k */
    const len = (k) => (s[k] == null ? undefined : attempt(() => parseLength(s[k]), `style "${name}" ${k}`, name));
    styles[name] = {
      role: name,
      family: families[s.font],
      weight: Number(s.weight ?? 400),
      boldWeight: 600,
      size: /** @type {number} */ (len('size')),
      leading: /** @type {number} */ (len('leading')),
      color: color(s.color ?? 'ink'),
      ...(s.italic ? { italic: true } : {}),
      ...(s.caps ? { caps: true } : {}),
      ...(s.tracking != null ? { letterSpacing: len('tracking') } : {}),
      ...(s.spaceBefore != null ? { spaceBefore: len('spaceBefore') } : {}),
      ...(s.spaceAfter != null ? { spaceAfter: len('spaceAfter') } : {}),
    };
    if (!styles[name].size || !styles[name].leading) fail(`style "${name}" needs a size and a leading`, name);
  }

  const trim = attempt(() => parseTrim(ed.trim), `edition "${edition}" trim`, 'trim');
  const m = ed.margins ?? {};
  /** @param {string} k */
  const margin = (k) => attempt(() => parseLength(m[k]), `edition "${edition}" margins.${k}`, 'margins');
  const inside = margin('inside'),
    outside = margin('outside');
  const r = t.recipe ?? {};
  /** @param {any} v @param {string} what */
  const L = (v, what) => attempt(() => parseLength(v), what, 'recipe');

  return {
    name: ed.name ?? edition,
    edition,
    page: {
      ...trim,
      bleed: ed.bleed != null ? attempt(() => parseLength(ed.bleed), `edition "${edition}" bleed`, 'bleed') : 9,
      // left/right are for a right-hand page; layout mirrors them on left pages.
      margin: { top: margin('top'), bottom: margin('bottom'), inside, outside, left: inside, right: outside },
    },
    styles,
    ingredients: {
      columns: Number(r.ingredients?.columns ?? 2),
      gap: L(r.ingredients?.gap ?? '24pt', 'recipe.ingredients.gap'),
      hang: L(r.ingredients?.hang ?? '9pt', 'recipe.ingredients.hang'),
      itemGap: L(r.ingredients?.itemGap ?? '2pt', 'recipe.ingredients.itemGap'),
    },
    steps: { indent: L(r.steps?.indent ?? '22pt', 'recipe.steps.indent') },
    note: { indent: attempt(() => parsePercent(r.note?.indent ?? '38%'), 'recipe.note.indent', 'recipe') },
    colors: Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, String(v)])),
    cover: { ...(t.cover ?? {}) },
    endpaper: { ...(t.endpaper ?? {}) },
    fonts,
    unicodeRanges,
  };
}
