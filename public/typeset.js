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
const measureItems = (runs, st) => runs.filter((r) => r.text).map((r) => ({
  text: st.caps ? r.text.toUpperCase() : r.text,
  font: fontOf(st, r, MEASURE),
  ...(st.letterSpacing ? { letterSpacing: st.letterSpacing * MEASURE } : {}),
}));

/** Where the baseline sits inside a line box of the style's leading. */
const baselineIn = (st) => (st.leading - st.size) / 2 + st.size * 0.78;

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
      const width = Math.max(20, span.x1 - span.x0 - ind);
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
    const { lineCount } = measureRichInlineStats(prepared, (colW - cfg.hang) * MEASURE);
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

/** Loads every image a recipe references; resolves to Map(src → HTMLImageElement). */
export async function loadImages(recipe) {
  const map = new Map();
  await Promise.all(recipe.blocks.filter((b) => b.type === 'image').map(async (b) => {
    if (map.has(b.src)) return;
    const img = new Image();
    img.src = b.src;
    map.set(b.src, img);
    await img.decode();
  }));
  return map;
}

function placeImage(flow, block, img) {
  const a = block.attrs, { x0, x1 } = flow.box, cw = x1 - x0;
  const ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
  const w = pct(a.width ?? '100%', cw), h = w * ratio;
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
      const st = S.step, num = S.stepNumber;
      b.items.forEach((runs, i) => {
        if (!flow.fits(st.leading * 2)) flow.newPage(); // no lonely first lines
        flowText(flow, runs, st, {
          indent: tpl.steps.indent,
          onFirstLine: (x0, baseline) => flow.add({ type: 'text', x: x0, y: baseline, text: `${i + 1}`, font: fontOf(num), color: num.color }),
        });
        flow.y += st.spaceAfter;
      });
    } else if (b.type === 'note') {
      flow.clearFloats();
      flow.space(10);
      const { x0, x1 } = flow.box;
      flowText(flow, b.runs, S.note, { indent: (x1 - x0) * tpl.note.indent });
      flow.y += 6;
    } else if (b.type === 'image') {
      placeImage(flow, b, images.get(b.src));
    }
  }
  metaLine();
  return flow.pages.map((p) => ({ ...p, folio: true }));
}

// ---------------------------------------------------------------------------
// Simple fixed pages for the test book
// ---------------------------------------------------------------------------

export function coverPage(tpl, { title, subtitle, art }) {
  const { width: W, height: H } = tpl.page, S = tpl.styles, items = [];
  const big = { ...S.title, size: S.title.size * 1.25 };
  items.push({ type: 'frame', inset: Math.round(W * 0.05), color: '#b9ab8f' });
  items.push({ type: 'text', x: W / 2, y: H * 0.36, text: title, font: fontOf(big), color: ink, align: 'center' });
  items.push({ type: 'text', x: W / 2, y: H * 0.36 + big.size * 0.9, text: subtitle, font: fontOf({ ...S.lede }), color: muted, align: 'center' });
  if (art) {
    const w = W * 0.42, h = w * art.naturalHeight / art.naturalWidth;
    items.push({ type: 'image', img: art, x: (W - w) / 2, y: H * 0.56, w, h, rotate: -8 });
  }
  return { items, floats: [], anchors: [] };
}

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

export function textPage(tpl, lines) {
  const { width: W, height: H } = tpl.page, S = tpl.styles;
  return {
    items: lines.map((text, i) => ({ type: 'text', x: W / 2, y: H / 2 + (i - (lines.length - 1) / 2) * S.body.leading, text, font: fontOf(S.body), color: muted, align: 'center' })),
    floats: [], anchors: [],
  };
}

// ---------------------------------------------------------------------------
// Rendering a page description
// ---------------------------------------------------------------------------

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
      ctx.drawImage(it.img, -it.w / 2, -it.h / 2, it.w, it.h);
      ctx.restore();
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
