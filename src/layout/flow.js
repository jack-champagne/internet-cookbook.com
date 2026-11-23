/**
 * The flow: a cursor moving down pages, laying out rich text line by line with
 * Pretext. Lines narrow beside floated images; pages break as needed and
 * alternate sides, so inside/outside margins mirror.
 *
 * Text items record their block (`blk`), line in that block (`ln`) and the
 * block's line count (`of`), so preflight can find widows and orphans.
 */
import {
  prepareRichInline,
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  measureRichInlineStats,
} from '../vendor/pretext/dist/rich-inline.js';
import { attrLength } from '../content/units.js';
import { MEASURE, SLACK, fontOf, measureItems, baselineIn } from './text.js';

/** @typedef {{ x0: number, x1: number, top: number, bottom: number }} Box */

/** The text area of a page on `side`, from the template's inside/outside margins. */
export function pageBox(/** @type {any} */ tpl, /** @type {'left'|'right'} */ side) {
  const { width, height, margin: m } = tpl.page;
  const left = side === 'right' ? m.inside : m.outside;
  const right = side === 'right' ? m.outside : m.inside;
  return { x0: left, x1: width - right, top: m.top, bottom: height - m.bottom };
}

/** A page with nothing on it yet. */
export const emptyPage = (/** @type {any} */ tpl, /** @type {'left'|'right'} */ side) => ({
  items: /** @type {any[]} */ ([]),
  floats: /** @type {any[]} */ ([]),
  anchors: /** @type {any[]} */ ([]),
  side,
  box: pageBox(tpl, side),
});

export class Flow {
  /** @param {any} tpl @param {'left'|'right'} startSide */
  constructor(tpl, startSide = 'right') {
    this.tpl = tpl;
    this.startSide = startSide;
    /** @type {ReturnType<typeof emptyPage>[]} */
    this.pages = [];
    this.blocks = 0;
    this.newPage();
  }

  get box() {
    return this.page.box;
  }

  newPage() {
    const last = this.pages[this.pages.length - 1];
    const side = last ? (last.side === 'right' ? 'left' : 'right') : this.startSide;
    this.page = emptyPage(this.tpl, side);
    this.pages.push(this.page);
    this.y = this.box.top;
  }

  /** @param {number} h */
  fits(h) {
    return this.y + h <= this.box.bottom + 0.01;
  }

  /** Vertical space, swallowed at the top of a page. @param {number} h */
  space(h) {
    if (this.y > this.box.top + 0.01) this.y += h;
  }

  /** Horizontal span available to a line between y0 and y1, after floats. */
  span(/** @type {number} */ y0, /** @type {number} */ y1) {
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

  /** @param {any} item */
  add(item) {
    this.page.items.push(item);
  }
}

/**
 * Flow rich text line by line, each line as wide as the page allows at its
 * height (narrower beside floats), breaking pages as needed.
 *   indent: left indent for every line; hang: extra indent after the first
 *   reserve: space kept free at the right (e.g. for a page number)
 *   onFirstLine(x0, baseline): e.g. to place a step number
 * Returns the last line's baseline and page, or null for empty text.
 */
export function flowText(
  /** @type {Flow} */ flow,
  /** @type {any[]} */ runs,
  /** @type {any} */ st,
  /** @type {{ indent?: number, hang?: number, reserve?: number, fixedSpan?: { x0: number, x1: number },
   *   onFirstLine?: (x0: number, baseline: number) => void }} */ {
    indent = 0,
    hang = 0,
    reserve = 0,
    onFirstLine,
    fixedSpan,
  } = {},
) {
  const items = measureItems(runs, st);
  if (!items.length) return null;
  const drawFont = runs.filter((r) => r.text).map((r) => fontOf(st, r));
  const prepared = prepareRichInline(items);
  const blk = ++flow.blocks;
  /** @type {any[]} */
  const created = [];
  /** @type {any} */
  let cursor;
  let first = true,
    ln = 0,
    lastBaseline = 0;
  for (;;) {
    const lineFor = () => {
      const span = fixedSpan || flow.span(flow.y, flow.y + st.leading);
      const ind = indent + (first ? 0 : hang);
      const width = Math.max(20, span.x1 - span.x0 - ind - reserve - SLACK);
      return { span, ind, range: layoutNextRichInlineLineRange(prepared, width * MEASURE, cursor) };
    };
    let { span, ind, range } = lineFor();
    if (!range) break;
    if (!flow.fits(st.leading)) {
      flow.newPage();
      ({ span, ind, range } = lineFor()); // re-flow this line at the new page's width
      if (!range) break;
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
      if (text) {
        const item = {
          type: 'text',
          x,
          y: baseline,
          text,
          font: drawFont[f.itemIndex],
          color: st.color,
          letterSpacing: st.letterSpacing,
          cont,
          gap,
          blk,
          ln,
        };
        flow.add(item);
        created.push(item);
      }
      cont = true;
      x += f.occupiedWidth / MEASURE;
    });
    if (first && onFirstLine) onFirstLine(span.x0, baseline);
    first = false;
    lastBaseline = baseline;
    cursor = range.end;
    flow.y += st.leading;
    ln++;
  }
  for (const item of created) item.of = ln;
  return { lastBaseline, page: flow.page, lines: ln };
}

/** Ingredient list, balanced over the template's columns. */
export function flowIngredients(
  /** @type {Flow} */ flow,
  /** @type {any[][]} */ items,
  /** @type {any} */ st,
  /** @type {any} */ cfg,
) {
  const single = () => {
    for (const runs of items) {
      flowText(flow, runs, st, { hang: cfg.hang });
      flow.y += cfg.itemGap;
    }
  };
  if (cfg.columns < 2) return single();
  flow.clearFloats();
  const { x0, x1 } = flow.box;
  const colW = (x1 - x0 - cfg.gap * (cfg.columns - 1)) / cfg.columns;
  const heights = items.map((runs) => {
    const prepared = prepareRichInline(measureItems(runs, st));
    const { lineCount } = measureRichInlineStats(prepared, (colW - cfg.hang - SLACK) * MEASURE);
    return lineCount * st.leading + cfg.itemGap;
  });
  // Split where the tallest column is shortest.
  const total = heights.reduce((a, b) => a + b, 0);
  let best = { k: items.length, h: total },
    acc = 0;
  heights.forEach((h, i) => {
    acc += h;
    const tallest = Math.max(acc, total - acc);
    if (tallest < best.h) best = { k: i + 1, h: tallest };
  });
  // Columns are balanced on one page; a list too long for a whole page flows
  // as a single column across pages instead of overflowing the margin.
  if (best.h > flow.box.bottom - flow.box.top) return single();
  if (!flow.fits(best.h)) flow.newPage();
  const top = flow.y,
    cx = flow.box.x0;
  [items.slice(0, best.k), items.slice(best.k)].forEach((col, c) => {
    flow.y = top;
    const cx0 = cx + c * (colW + cfg.gap);
    for (const runs of col) {
      flowText(flow, runs, st, { hang: cfg.hang, fixedSpan: { x0: cx0, x1: cx0 + colW } });
      flow.y += cfg.itemGap;
    }
  });
  flow.y = top + best.h;
}

/**
 * Place an image block. Decorative images are positioned freely relative to
 * their anchor; in-text images float (text wraps) or stand as a block, and are
 * scaled down to fit the text area if needed (recorded as `scaled`).
 * @param {Flow} flow @param {any} block @param {Map<string, { naturalWidth: number, naturalHeight: number }>} images
 */
export function placeImage(flow, block, images) {
  const img = images.get(block.src);
  if (!img) return; // failed to load; reported by loadImages
  const a = block.attrs,
    { x0, x1, top, bottom } = flow.box,
    cw = x1 - x0;
  const ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
  let w = attrLength(a.width ?? '100%', cw),
    h = w * ratio,
    scaled = false;
  if (!a.decor && h > bottom - top) {
    h = bottom - top;
    w = h / ratio;
    scaled = true;
  }
  const base = { type: 'image', src: block.src, alt: block.alt, w, h, ...(scaled ? { scaled: true } : {}) };
  if (a.decor) {
    const anchor = { x: x0, y: flow.y };
    flow.page.anchors.push(anchor);
    flow.add({
      ...base,
      decor: true,
      anchor,
      x: x0 + attrLength(a.x ?? '0%', cw),
      y: flow.y + attrLength(a.y ?? 0, cw),
      rotate: Number(a.rotate ?? 0),
      opacity: Number(a.opacity ?? 1),
      layer: a.layer === 'below' ? 'below' : 'above',
      ...(a.overlap ? { overlap: true } : {}),
    });
  } else if (a.wrap && (a.place === 'left' || a.place === 'right')) {
    if (!flow.fits(h)) flow.newPage();
    const fx = a.place === 'right' ? flow.box.x1 - w : flow.box.x0;
    flow.page.floats.push({ x: fx, y: flow.y, w, h, side: a.place, gap: attrLength(a.gap ?? 14, cw) });
    flow.add({ ...base, x: fx, y: flow.y });
  } else {
    flow.clearFloats();
    flow.space(6);
    if (!flow.fits(h)) flow.newPage();
    const b = flow.box;
    const x = a.place === 'left' ? b.x0 : a.place === 'right' ? b.x1 - w : b.x0 + (b.x1 - b.x0 - w) / 2;
    flow.add({ ...base, x, y: flow.y });
    flow.y += h + 8;
  }
}
