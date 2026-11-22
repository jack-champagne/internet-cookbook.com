/**
 * typeset.js — lay a parsed recipe out onto pages, using Pretext for lines.
 *
 * Layout and drawing are separate on purpose:
 *   typesetRecipe(recipe, template) → pages: [{ items: [...], floats, anchors }]
 *     items are positioned text runs, images and rules, in points (1/72 in)
 *     on a page of template.page.width × height. Nothing is drawn here.
 *   drawPage(ctx, page) draws one page description onto a 2D context whose
 *     transform maps points to pixels. A PDF renderer could consume the same
 *     page descriptions later.
 *
 * Templates are physical: change the trim size and the content reflows.
 */
import {
  prepareRichInline,
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  measureRichInlineStats,
} from './vendor/pretext/dist/rich-inline.js';

// ---------------------------------------------------------------------------
// Templates (all measurements in points)
// ---------------------------------------------------------------------------

const ink = '#2b2925', muted = '#8a7f6c', rule = '#d9d1c1';
const CRIMSON = '"Crimson Pro"', CORMORANT = '"Cormorant Garamond"', CAVEAT = '"Caveat"';

const type = (size, leading, more = {}) => ({ family: CRIMSON, weight: 400, boldWeight: 600, size, leading, color: ink, ...more });

export const TEMPLATES = {
  /** The book: a standard 8 × 10 in cookbook trim. */
  book: {
    name: '8 × 10 in',
    page: { width: 576, height: 720, margin: { top: 58, right: 56, bottom: 64, left: 56 } },
    styles: {
      kicker: type(8.5, 12, { color: muted, caps: true, letterSpacing: 1.8 }),
      title: type(40, 42, { family: CORMORANT, weight: 600 }),
      lede: type(13.5, 18.5, { italic: true, color: '#4a453d' }),
      meta: type(8.5, 12, { color: muted, caps: true, letterSpacing: 1.2 }),
      heading: type(19, 22, { family: CORMORANT, weight: 600, spaceBefore: 16, spaceAfter: 5 }),
      body: type(12, 16.5),
      step: type(12, 16.5, { spaceAfter: 6 }),
      stepNumber: type(16, 16.5, { family: CORMORANT, weight: 600, color: muted }),
      note: type(17, 18, { family: CAVEAT, weight: 500, color: '#6b5e48' }),
      folio: type(9, 12, { color: muted }),
    },
    ingredients: { columns: 2, gap: 24, hang: 9, itemGap: 2 },
    steps: { indent: 22 },
    note: { indent: 0.38 },
  },
  /** A phone edition: same content, narrower trim so text stays readable. */
  phone: {
    name: '4.5 × 7.5 in',
    page: { width: 324, height: 540, margin: { top: 34, right: 26, bottom: 40, left: 26 } },
    styles: {
      kicker: type(7.5, 11, { color: muted, caps: true, letterSpacing: 1.4 }),
      title: type(32, 34, { family: CORMORANT, weight: 600 }),
      lede: type(12, 16, { italic: true, color: '#4a453d' }),
      meta: type(7.5, 11, { color: muted, caps: true, letterSpacing: 1 }),
      heading: type(17, 20, { family: CORMORANT, weight: 600, spaceBefore: 12, spaceAfter: 4 }),
      body: type(11, 15),
      step: type(11, 15, { spaceAfter: 5 }),
      stepNumber: type(14, 15, { family: CORMORANT, weight: 600, color: muted }),
      note: type(15, 16, { family: CAVEAT, weight: 500, color: '#6b5e48' }),
      folio: type(8, 11, { color: muted }),
    },
    ingredients: { columns: 1, gap: 0, hang: 8, itemGap: 1.5 },
    steps: { indent: 18 },
    note: { indent: 0.25 },
  },
};

// ---------------------------------------------------------------------------
// Fonts: load before laying anything out (Pretext measures with them).
// ---------------------------------------------------------------------------

const FACES = [
  [CRIMSON, '/fonts/crimson-pro-normal-400.woff2', { weight: '400 600' }],
  [CRIMSON, '/fonts/crimson-pro-italic-400.woff2', { style: 'italic', weight: '400' }],
  [CORMORANT, '/fonts/cormorant-garamond-normal-500.woff2', { weight: '500 700' }],
  [CORMORANT, '/fonts/cormorant-garamond-italic-500.woff2', { style: 'italic', weight: '500' }],
  [CAVEAT, '/fonts/caveat-normal-500.woff2', { weight: '500' }],
];

let fontsReady;
/** Registers the book's fonts with document.fonts and waits until they load. */
export function loadFonts() {
  fontsReady ||= Promise.all(FACES.map(async ([family, url, desc]) => {
    // Registered before loading: Safari otherwise keeps fallback-font widths.
    const face = new FontFace(family.replace(/"/g, ''), `url(${url})`, desc);
    document.fonts.add(face);
    await face.load();
  }));
  return fontsReady;
}

const fontOf = (st, run = {}, scale = 1) => {
  const italic = st.italic || run.italic;
  const weight = run.bold ? st.boldWeight ?? 600 : st.weight;
  return `${italic ? 'italic ' : ''}${weight} ${st.size * scale}px ${st.family}`;
};

/**
 * Text is measured at MEASURE × its size and the results divided back down.
 * Canvas can round text widths to whole pixels at small sizes; at 11 px that
 * is up to a point per run, enough to swallow a word space between a bold
 * run and the next. At 8× the rounding shrinks to an eighth.
 */
const MEASURE = 8;

/**
 * Lines are laid out to fit SLACK points less than the column. Text measured
 * at one size and drawn at another can differ by a fraction of a point per
 * line where the browser hints fonts; the slack keeps a line that would end
 * right at the margin from poking past it. Invisible in ragged-right text.
 */
const SLACK = 1;
const measureItems = (runs, st) => runs.filter((r) => r.text).map((r) => ({
  text: st.caps ? r.text.toUpperCase() : r.text,
  font: fontOf(st, r, MEASURE),
  ...(st.letterSpacing ? { letterSpacing: st.letterSpacing * MEASURE } : {}),
}));

/** Where the baseline sits inside a line box of the style's leading. */
/**
 * Where the baseline sits inside a line box of the style's leading: the
 * font's real ascent and descent (measured once per font) are centred in the
 * line, as browsers do. Falls back to typical proportions if the canvas can't
 * report font metrics.
 */
const metricsCache = new Map();
function baselineIn(st) {
  const font = fontOf(st, {}, MEASURE);
  let m = metricsCache.get(font);
  if (!m) {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = font;
    const t = ctx.measureText('Hxgy');
    const ascent = t.fontBoundingBoxAscent, descent = t.fontBoundingBoxDescent;
    m = Number.isFinite(ascent) && Number.isFinite(descent) && ascent > 0
      ? { ascent: ascent / MEASURE / st.size, descent: descent / MEASURE / st.size }
      : { ascent: 0.9, descent: 0.25 };
    metricsCache.set(font, m);
  }
  return (st.leading - (m.ascent + m.descent) * st.size) / 2 + m.ascent * st.size;
}

// ---------------------------------------------------------------------------
// The flow: a cursor moving down the page, with floats that narrow lines.
// ---------------------------------------------------------------------------

class Flow {
  constructor(tpl) {
    this.tpl = tpl;
    this.pages = [];
    this.newPage();
  }

  get box() {
    const { width, height, margin: m } = this.tpl.page;
    return { x0: m.left, x1: width - m.right, top: m.top, bottom: height - m.bottom };
  }

  newPage() {
    this.page = { items: [], floats: [], anchors: [] };
    this.pages.push(this.page);
    this.y = this.box.top;
  }

  fits(h) { return this.y + h <= this.box.bottom + 0.01; }

  /** Vertical space, swallowed at the top of a page. */
  space(h) { if (this.y > this.box.top + 0.01) this.y += h; }

  /** Horizontal span available to a line between y0 and y1, after floats. */
  span(y0, y1) {
    let { x0, x1 } = this.box;
    for (const f of this.page.floats) {
      if (y0 < f.y + f.h + f.gap && y1 > f.y) {
        if (f.side === 'right') x1 = Math.min(x1, f.x - f.gap);
        else x0 = Math.max(x0, f.x + f.w + f.gap);
      }
    }
    return { x0, x1 };
  }

  /** Move below any float on the page. */
  clearFloats() {
    for (const f of this.page.floats) this.y = Math.max(this.y, f.y + f.h + f.gap);
  }

  add(item) { this.page.items.push(item); }
}

/**
 * Flow rich text line by line, each line as wide as the page allows at its
 * height (narrower beside floats), breaking pages as needed.
 *   indent: left indent for every line; hang: extra indent after the first
 *   onFirstLine(x0, baseline): e.g. to place a step number
 */
function flowText(flow, runs, st, { indent = 0, hang = 0, onFirstLine, fixedSpan } = {}) {
  const items = measureItems(runs, st);
  if (!items.length) return;
  const drawFont = runs.filter((r) => r.text).map((r) => fontOf(st, r));
  const prepared = prepareRichInline(items);
  let cursor, first = true;
  for (;;) {
    const lineFor = () => {
      const span = fixedSpan || flow.span(flow.y, flow.y + st.leading);
      const ind = indent + (first ? 0 : hang);
      const width = Math.max(20, span.x1 - span.x0 - ind - SLACK);
      return { span, ind, range: layoutNextRichInlineLineRange(prepared, width * MEASURE, cursor) };
    };
    let { span, ind, range } = lineFor();
    if (!range) break;
    if (!flow.fits(st.leading)) {
      flow.newPage();
      ({ span, ind, range } = lineFor()); // re-flow this line at the new page's width
    }
    const line = materializeRichInlineLineRange(prepared, range);
    const baseline = flow.y + baselineIn(st);
    let x = span.x0 + ind;
    let cont = false;
    line.fragments.forEach((f, i, all) => {
      const gap = f.gapBefore / MEASURE;
      x += gap;
      // Whitespace at a line's end hangs past the margin and isn't drawn.
      const text = i === all.length - 1 ? f.text.replace(/\s+$/, '') : f.text;
      // `cont`: drawn right after the previous run as actually rendered, plus
      // `gap`, so word spaces stay exact even where the device's text widths
      // differ slightly from the measured ones (font hinting varies by size).
      if (text) flow.add({ type: 'text', x, y: baseline, text, font: drawFont[f.itemIndex], color: st.color, letterSpacing: st.letterSpacing, cont, gap });
      cont = true;
      x += f.occupiedWidth / MEASURE;
    });
    if (first && onFirstLine) onFirstLine(span.x0, baseline);
    first = false;
    cursor = range.end;
    flow.y += st.leading;
  }
}

/** Ingredient list, balanced over the template's columns. */
function flowIngredients(flow, items, st, cfg) {
  const { x0, x1 } = flow.box;
  const single = () => {
    for (const runs of items) {
      flowText(flow, runs, st, { hang: cfg.hang });
      flow.y += cfg.itemGap;
    }
  };
  if (cfg.columns < 2) {
    for (const runs of items) {
      flowText(flow, runs, st, { hang: cfg.hang });
      flow.y += cfg.itemGap;
    }
    return;
  }
  flow.clearFloats();
  const colW = (x1 - x0 - cfg.gap * (cfg.columns - 1)) / cfg.columns;
  const heights = items.map((runs) => {
    const prepared = prepareRichInline(measureItems(runs, st));
    const { lineCount } = measureRichInlineStats(prepared, (colW - cfg.hang - SLACK) * MEASURE);
    return lineCount * st.leading + cfg.itemGap;
  });
  // Split where the tallest column is shortest.
  const total = heights.reduce((a, b) => a + b, 0);
  let best = { k: items.length, h: total }, acc = 0;
  heights.forEach((h, i) => {
    acc += h;
    const tallest = Math.max(acc, total - acc);
    if (tallest < best.h) best = { k: i + 1, h: tallest };
  });
  // Columns are balanced on one page; a list too long for a whole page flows
  // as a single column across pages instead of overflowing the margin.
  if (best.h > flow.box.bottom - flow.box.top) return single();
  if (!flow.fits(best.h)) flow.newPage();
  const top = flow.y;
  const columns = [items.slice(0, best.k), items.slice(best.k)];
  columns.forEach((col, c) => {
    flow.y = top;
    const cx0 = x0 + c * (colW + cfg.gap);
    for (const runs of col) {
      flowText(flow, runs, st, { hang: cfg.hang, fixedSpan: { x0: cx0, x1: cx0 + colW } });
      flow.y += cfg.itemGap;
    }
  });
  flow.y = top + best.h;
}

const pct = (v, of) => (typeof v === 'string' && v.endsWith('%') ? (parseFloat(v) / 100) * of : parseFloat(v) || 0);

/**
 * Loads every image a recipe references; resolves to Map(src → HTMLImageElement).
 * An image that fails to load is left out (with a warning) and its block is
 * skipped, rather than failing the whole book.
 */
export async function loadImages(recipe) {
  const map = new Map();
  await Promise.all(recipe.blocks.filter((b) => b.type === 'image').map(async (b) => {
    if (map.has(b.src)) return;
    const img = new Image();
    img.src = b.src;
    map.set(b.src, img);
    try {
      await img.decode();
    } catch {
      map.delete(b.src);
      console.warn(`Image could not be loaded and was left out: ${b.src}`);
    }
  }));
  return map;
}

function placeImage(flow, block, img) {
  if (!img) return; // failed to load; reported by loadImages
  const a = block.attrs, { x0, x1, top, bottom } = flow.box, cw = x1 - x0;
  const ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
  let w = pct(a.width ?? '100%', cw), h = w * ratio;
  if (!a.decor && h > bottom - top) {
    // In-text images must fit the text area: scale down, keeping proportions.
    h = bottom - top;
    w = h / ratio;
  }
  if (a.decor) {
    // Decorative: free placement relative to its anchor; doesn't move text.
    const anchor = { x: x0, y: flow.y };
    flow.page.anchors.push(anchor);
    flow.add({
      type: 'image', img, decor: true, anchor,
      x: x0 + pct(a.x ?? '0%', cw), y: flow.y + parseFloat(a.y ?? 0), w, h,
      rotate: parseFloat(a.rotate ?? 0), opacity: parseFloat(a.opacity ?? 1), layer: a.layer === 'below' ? 'below' : 'above',
    });
  } else if (a.wrap && (a.place === 'left' || a.place === 'right')) {
    // In the text: a float that following lines wrap around.
    if (!flow.fits(h)) flow.newPage();
    const x = a.place === 'right' ? x1 - w : x0;
    flow.page.floats.push({ x, y: flow.y, w, h, side: a.place, gap: parseFloat(a.gap ?? 14) });
    flow.add({ type: 'image', img, x, y: flow.y, w, h });
  } else {
    // A block of its own between paragraphs.
    flow.clearFloats();
    flow.space(6);
    if (!flow.fits(h)) flow.newPage();
    const x = a.place === 'left' ? x0 : a.place === 'right' ? x1 - w : x0 + (cw - w) / 2;
    flow.add({ type: 'image', img, x, y: flow.y, w, h });
    flow.y += h + 8;
  }
}

/**
 * Typeset a parsed recipe (see recipe-md.js) with a template.
 * Fonts must be loaded (loadFonts) and images decoded (loadImages) first.
 */
export function typesetRecipe(recipe, tpl, images) {
  const flow = new Flow(tpl);
  const S = tpl.styles, { meta } = recipe;

  // Header: chapter, title, lede, then the time/serving line between rules.
  if (meta.chapter) { flowText(flow, [{ text: meta.chapter }], S.kicker); flow.y += 4; }
  if (meta.title) { flowText(flow, [{ text: meta.title }], S.title); flow.y += 6; }
  let seenHeading = false, metaDone = false;
  const metaLine = () => {
    if (metaDone) return;
    metaDone = true;
    const parts = [['Serves', meta.serves], ['Prep', meta.prep], ['Cook', meta.cook]].filter(([, v]) => v).map(([k, v]) => `${k} ${v}`);
    if (!parts.length) return;
    const { x0, x1 } = flow.box;
    flow.y += 4;
    flow.add({ type: 'rule', x: x0, y: flow.y, w: x1 - x0, color: rule });
    flow.y += 6;
    flowText(flow, [{ text: parts.join('   ·   ') }], S.meta);
    flow.y += 5;
    flow.add({ type: 'rule', x: x0, y: flow.y, w: x1 - x0, color: rule });
    flow.y += 4;
  };

  let lastStep = null;
  const placeStep = (runs, n) => {
    const st = S.step, num = S.stepNumber;
    flowText(flow, runs, st, {
      indent: tpl.steps.indent,
      onFirstLine: (x0, baseline) => flow.add({ type: 'text', x: x0, y: baseline, text: `${n}`, font: fontOf(num), color: num.color }),
    });
    flow.y += st.spaceAfter;
  };

  for (const b of recipe.blocks) {
    if (b.type === 'paragraph') {
      if (!seenHeading) { flowText(flow, b.runs, S.lede); flow.y += 4; }
      else { flowText(flow, b.runs, S.body); flow.y += 6; }
    } else if (b.type === 'heading') {
      metaLine();
      seenHeading = true;
      const st = S.heading;
      flow.space(st.spaceBefore);
      if (!flow.fits(st.leading + S.body.leading * 2)) flow.newPage(); // keep with next
      flowText(flow, b.runs, st);
      flow.y += st.spaceAfter;
    } else if (b.type === 'list' && !b.ordered) {
      flowIngredients(flow, b.items, S.body, tpl.ingredients);
    } else if (b.type === 'list') {
      b.items.forEach((runs, i) => {
        if (!flow.fits(S.step.leading * 2)) flow.newPage(); // no lonely first lines
        // Remember where the last step began, so a following note can pull it
        // onto the next page rather than sit there alone.
        lastStep = { runs, number: i + 1, page: flow.page, items: flow.page.items.length, y: flow.y };
        placeStep(runs, i + 1);
      });
      continue; // keep lastStep for a note that directly follows
    } else if (b.type === 'note') {
      flow.clearFloats();
      const { x0, x1 } = flow.box, indent = (x1 - x0) * tpl.note.indent;
      const prepared = prepareRichInline(measureItems(b.runs, S.note));
      const lines = measureRichInlineStats(prepared, (x1 - x0 - indent - SLACK) * MEASURE).lineCount;
      const height = 10 + lines * S.note.leading;
      if (!flow.fits(height) && lastStep && lastStep.page === flow.page && lastStep.y > flow.box.top + 0.01) {
        // Keep the note with its step: set the step again at the top of the
        // next page, followed by the note.
        flow.page.items.length = lastStep.items;
        flow.y = lastStep.y;
        flow.newPage();
        placeStep(lastStep.runs, lastStep.number);
      }
      flow.space(10);
      flowText(flow, b.runs, S.note, { indent });
      flow.y += 6;
    } else if (b.type === 'image') {
      placeImage(flow, b, images.get(b.src));
    }
    lastStep = null;
  }
  metaLine();
  return flow.pages.map((p) => ({ ...p, folio: true }));
}

// ---------------------------------------------------------------------------
// Simple fixed pages for the test book
// ---------------------------------------------------------------------------

// Covers are boards printed on both sides: the outside cover, and the
// endpaper glued inside it. A book is: front board, front endpaper,
// contents (starting on a right-hand page), back endpaper, back board.
const BOARD = { cloth: '#3d4a3a', title: '#efe6cf', subtitle: '#c8bf9f', frame: '#b9a067' };
const ENDPAPER = { paper: '#cdd1bd', motif: '#8f987c' };

const sprigItem = (art, x, y, w, extra = {}) => ({ type: 'image', img: art, x, y, w, h: w * art.naturalHeight / art.naturalWidth, ...extra });

/** Outside of a cover board. side: 'front' (title) or 'back' (emblem + colophon). */
export function boardPage(tpl, { side, title, subtitle, art, lines = [] }) {
  const { width: W, height: H } = tpl.page, S = tpl.styles;
  const items = [{ type: 'fill', color: BOARD.cloth }, { type: 'frame', inset: Math.round(W * 0.05), color: BOARD.frame }];
  if (side === 'front') {
    const big = { ...S.title, size: S.title.size * 1.25 };
    items.push({ type: 'text', x: W / 2, y: H * 0.36, text: title, font: fontOf(big), color: BOARD.title, align: 'center' });
    items.push({ type: 'text', x: W / 2, y: H * 0.36 + big.size * 0.9, text: subtitle, font: fontOf(S.lede), color: BOARD.subtitle, align: 'center' });
    if (art) { const w = W * 0.42; items.push(sprigItem(art, (W - w) / 2, H * 0.56, w, { rotate: -8, tint: BOARD.title })); }
  } else {
    if (art) { const w = W * 0.22; items.push(sprigItem(art, (W - w) / 2, H * 0.44, w, { rotate: -8, tint: BOARD.subtitle })); }
    lines.forEach((text, i) => items.push({ type: 'text', x: W / 2, y: H * 0.56 + i * S.folio.leading * 1.3, text, font: fontOf(S.folio), color: BOARD.subtitle, align: 'center' }));
  }
  return { items, floats: [], anchors: [] };
}

/** Endpaper: the inside of a cover board, a quiet repeating motif. */
export function endpaperPage(tpl, { art }) {
  const { width: W, height: H } = tpl.page;
  const items = [{ type: 'fill', color: ENDPAPER.paper }];
  if (art) {
    const w = W / 5.5, stepX = W / 3.2, stepY = H / 6;
    for (let row = -1, y = -stepY / 3; y < H; row++, y += stepY) {
      for (let x = (row % 2 ? stepX / 2 : 0) - w / 2; x < W; x += stepX) {
        items.push(sprigItem(art, x, y, w, { rotate: row % 2 ? 24 : -18, tint: ENDPAPER.motif, opacity: 0.55 }));
      }
    }
  }
  return { items, floats: [], anchors: [] };
}

/** Title page: the first page of the contents, on the right. */
export function titlePage(tpl, { title, subtitle }) {
  const { width: W, height: H } = tpl.page, S = tpl.styles;
  return {
    items: [
      { type: 'text', x: W / 2, y: H * 0.42, text: title, font: fontOf(S.title), color: ink, align: 'center' },
      { type: 'rule', x: W * 0.42, y: H * 0.42 + S.title.size * 0.55, w: W * 0.16, color: rule },
      { type: 'text', x: W / 2, y: H * 0.42 + S.title.size * 0.55 + S.lede.leading * 1.4, text: subtitle, font: fontOf(S.lede), color: muted, align: 'center' },
    ],
    floats: [], anchors: [],
  };
}

export const blankPage = () => ({ items: [], floats: [], anchors: [] });

export function platePage(tpl, { art, caption }) {
  const { width: W, height: H } = tpl.page, S = tpl.styles;
  const w = W * 0.78, h = w * art.naturalHeight / art.naturalWidth;
  const y = (H - h) / 2 - S.lede.size;
  return {
    items: [
      { type: 'image', img: art, x: (W - w) / 2, y, w, h },
      { type: 'text', x: W / 2, y: y + h + S.lede.leading * 1.6, text: caption, font: fontOf(S.lede), color: muted, align: 'center' },
    ],
    floats: [], anchors: [],
  };
}

// ---------------------------------------------------------------------------
// Rendering a page description
// ---------------------------------------------------------------------------

/** Line art recoloured to `color` (e.g. cream on a dark board), at device size. */
const tintCache = new Map();
function tinted(img, color, w, h) {
  const cw = Math.max(1, Math.round(w)), ch = Math.max(1, Math.round(h));
  const key = `${img.src}|${color}|${cw}x${ch}`;
  let c = tintCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, cw, ch);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, cw, ch);
    tintCache.set(key, c);
    if (tintCache.size > 64) tintCache.delete(tintCache.keys().next().value); // oldest first
  }
  return c;
}

/** `400 12px "Crimson Pro"` at scale 2 → `400 24px "Crimson Pro"` */
const scaleFont = (font, s) => font.replace(/([\d.]+)px/, (_, n) => `${+n * s}px`);

function drawSpaced(ctx, text, x, y, spacing) {
  for (const ch of text) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + spacing;
  }
}

/**
 * Draw a page description. ctx must already map points to pixels.
 *   pageNumber: drawn as the folio when the page has one
 *   guides: draw the layout-mode overlay (margins, floats, anchors)
 */
export function drawPage(ctx, page, tpl, { pageNumber, guides = false } = {}) {
  const { width: W, height: H } = tpl.page;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  const layer = (it) => (it.layer === 'below' ? 0 : it.decor ? 2 : 1);
  const ordered = page.items.map((it, i) => [it, i]).sort((a, b) => layer(a[0]) - layer(b[0]) || a[1] - b[1]).map(([it]) => it);
  // Text is drawn at its real device size, not at layout size under a scaled
  // transform: canvas positions glyphs at the font's own size, so scaling up
  // small text magnifies its rounding into uneven letter and word spacing.
  const m = ctx.getTransform(), s = m.a;
  let lineEnd = 0; // where the previous run on this line really ended, in device px
  const text = (it) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, m.e, m.f);
    ctx.font = scaleFont(it.font, s);
    ctx.fillStyle = it.color;
    const x = it.cont ? lineEnd + it.gap * s : it.x * s, y = it.y * s;
    if (it.letterSpacing) {
      const ls = it.letterSpacing * s;
      const width = [...it.text].reduce((w, ch) => w + ctx.measureText(ch).width + ls, -ls);
      const x0 = it.align === 'center' ? x - width / 2 : x;
      drawSpaced(ctx, it.text, x0, y, ls);
      lineEnd = x0 + width;
    } else {
      ctx.textAlign = it.align === 'center' ? 'center' : 'left';
      ctx.fillText(it.text, x, y);
      lineEnd = x + ctx.measureText(it.text).width;
    }
    ctx.restore();
  };
  for (const it of ordered) {
    if (it.type === 'text') {
      text(it);
    } else if (it.type === 'image') {
      ctx.save();
      ctx.globalAlpha = it.opacity ?? 1;
      ctx.translate(it.x + it.w / 2, it.y + it.h / 2);
      if (it.rotate) ctx.rotate((it.rotate * Math.PI) / 180);
      const src = it.tint ? tinted(it.img, it.tint, it.w * s, it.h * s) : it.img;
      ctx.drawImage(src, -it.w / 2, -it.h / 2, it.w, it.h);
      ctx.restore();
    } else if (it.type === 'fill') {
      ctx.fillStyle = it.color;
      ctx.fillRect(0, 0, W, H);
    } else if (it.type === 'rule') {
      ctx.fillStyle = it.color;
      ctx.fillRect(it.x, it.y, it.w, 0.6);
    } else if (it.type === 'frame') {
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(it.inset, it.inset, W - 2 * it.inset, H - 2 * it.inset);
      ctx.strokeRect(it.inset + 4, it.inset + 4, W - 2 * it.inset - 8, H - 2 * it.inset - 8);
    }
  }
  if (page.folio && pageNumber) {
    const st = tpl.styles.folio;
    text({ x: W / 2, y: H - tpl.page.margin.bottom / 2 + st.size / 3, text: String(pageNumber), font: fontOf(st), color: st.color, align: 'center' });
  }
  if (guides) drawGuides(ctx, page, tpl);
  ctx.restore();
}

function drawGuides(ctx, page, tpl) {
  const { width: W, height: H, margin: m } = tpl.page;
  ctx.save();
  ctx.lineWidth = 0.6;
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(214, 64, 64, .7)';
  ctx.strokeRect(m.left, m.top, W - m.left - m.right, H - m.top - m.bottom);
  ctx.strokeStyle = 'rgba(40, 110, 220, .8)';
  for (const f of page.floats) {
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    ctx.setLineDash([1, 2]);
    ctx.strokeRect(f.side === 'right' ? f.x - f.gap : f.x, f.y, f.w + f.gap, f.h + f.gap);
    ctx.setLineDash([3, 3]);
  }
  ctx.setLineDash([]);
  for (const it of page.items) {
    if (it.type !== 'image' || !it.decor) continue;
    ctx.strokeStyle = 'rgba(30, 150, 90, .85)';
    ctx.strokeRect(it.x, it.y, it.w, it.h);
    const a = it.anchor;
    ctx.beginPath();
    ctx.moveTo(a.x - 5, a.y); ctx.lineTo(a.x + 5, a.y);
    ctx.moveTo(a.x, a.y - 5); ctx.lineTo(a.x, a.y + 5);
    ctx.moveTo(a.x, a.y); ctx.lineTo(it.x, it.y);
    ctx.stroke();
  }
  ctx.restore();
}
