/**
 * Text measurement shared by layout: font strings, Pretext items, baselines,
 * and loading the theme's fonts.
 */

/**
 * Text is measured at MEASURE × its size and the results divided back down.
 * Canvas can round text widths to whole pixels at small sizes; at 11 px that
 * is up to a point per run, enough to swallow a word space between a bold run
 * and the next. At 8× the rounding shrinks to an eighth.
 */
export const MEASURE = 8;

/**
 * Lines are laid out to fit SLACK points less than the column. Text measured
 * at one size and drawn at another can differ by a fraction of a point per
 * line where the browser hints fonts; the slack keeps a line that would end
 * right at the margin from poking past it. Invisible in ragged-right text.
 */
export const SLACK = 1;

/** @param {any} st @param {{ bold?: boolean, italic?: boolean }} [run] @param {number} [scale] */
export const fontOf = (st, run = {}, scale = 1) => {
  const italic = st.italic || run.italic;
  const weight = run.bold ? (st.boldWeight ?? 600) : st.weight;
  return `${italic ? 'italic ' : ''}${weight} ${st.size * scale}px ${st.family}`;
};

/** Pretext rich-inline items for runs in a style, at MEASURE scale. */
export const measureItems = (/** @type {any[]} */ runs, /** @type {any} */ st) =>
  runs
    .filter((r) => r.text)
    .map((r) => ({
      text: st.caps ? r.text.toUpperCase() : r.text,
      font: fontOf(st, r, MEASURE),
      ...(st.letterSpacing ? { letterSpacing: st.letterSpacing * MEASURE } : {}),
    }));

/**
 * Where the baseline sits inside a line box of the style's leading: the
 * font's real ascent and descent (measured once per font) are centred in the
 * line, as browsers do; typical proportions if the canvas can't report them.
 */
const metricsCache = new Map();
/** @param {any} st */
export function baselineIn(st) {
  const font = fontOf(st, {}, MEASURE);
  let m = metricsCache.get(font);
  if (!m) {
    const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
    ctx.font = font;
    const t = ctx.measureText('Hxgy');
    const ascent = t.fontBoundingBoxAscent,
      descent = t.fontBoundingBoxDescent;
    m =
      Number.isFinite(ascent) && Number.isFinite(descent) && ascent > 0
        ? { ascent: ascent / MEASURE / st.size, descent: descent / MEASURE / st.size }
        : { ascent: 0.9, descent: 0.25 };
    metricsCache.set(font, m);
  }
  return (st.leading - (m.ascent + m.descent) * st.size) / 2 + m.ascent * st.size;
}

/**
 * Register and load a template's fonts. Registered before loading: Safari
 * otherwise keeps fallback-font widths, and Pretext would measure wrongly.
 * @param {{ fonts: { family: string, src: string, style: string, weight: string }[] }} tpl
 */
export function loadFonts(tpl) {
  return Promise.all(
    tpl.fonts.map(async (f) => {
      const face = new FontFace(f.family, `url(${f.src})`, { style: f.style, weight: f.weight });
      document.fonts.add(face);
      await face.load();
    }),
  );
}

/**
 * Natural sizes of every image a book uses, keyed by site path. An image that
 * fails to load is left out with a warning; its blocks are skipped.
 * @param {string[]} srcs @returns {Promise<Map<string, HTMLImageElement>>}
 */
export async function loadImages(srcs) {
  const map = new Map();
  await Promise.all(
    [...new Set(srcs)].map(async (src) => {
      const img = new Image();
      img.src = src;
      try {
        await img.decode();
        map.set(src, img);
      } catch {
        console.warn(`Image could not be loaded and was left out: ${src}`);
      }
    }),
  );
  return map;
}
