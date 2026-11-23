/**
 * Preflight: check a laid-out edition against the book's layout rules before
 * it is published. Errors stop the build; warnings are reported.
 *
 * Pure: text widths come from `measure(text, font, letterSpacing)` (points),
 * which the browser provides during builds and tests provide as a stub.
 */
import { inRanges } from './content/units.js';

/** @typedef {{ rule: string, page: number, message: string }} Finding */

const TOLERANCE = 0.5; // points

/**
 * @param {{ pages: any[], entries: Record<string, { first: number, last: number, start: number }> }} layout
 * @param {{ tpl: any, book: any, measure: (text: string, font: string, letterSpacing?: number) => number }} ctx
 * @returns {{ errors: Finding[], warnings: Finding[] }}
 */
export function preflight(layout, { tpl, book, measure }) {
  /** @type {Finding[]} */
  const errors = [];
  /** @type {Finding[]} */
  const warnings = [];
  const error = (/** @type {string} */ rule, /** @type {number} */ page, /** @type {string} */ message) =>
    errors.push({ rule, page, message });
  const warn = (/** @type {string} */ rule, /** @type {number} */ page, /** @type {string} */ message) =>
    warnings.push({ rule, page, message });
  const { pages, entries } = layout;
  const N = pages.length;
  const { width: W, height: H, bleed } = tpl.page;

  // --- Book structure -------------------------------------------------------
  if (N % 2) error('structure', N, `the book has an odd number of pages (${N})`);
  const hard = pages.filter((p) => p.hard).map((p) => p.n);
  if (hard.join() !== [1, 2, N - 1, N].join())
    error('structure', 1, `rigid pages should be the two cover boards (1, 2, ${N - 1}, ${N}), not ${hard.join(', ')}`);
  pages.forEach((p) => {
    if (p.side !== (p.n % 2 ? 'right' : 'left')) error('structure', p.n, `page ${p.n} was laid out for the wrong side`);
  });
  if (!pages[2]?.items.some((/** @type {any} */ i) => i.text === book.title))
    error('structure', 3, 'contents should start with the title page on page 3');

  // --- Spread rules ---------------------------------------------------------
  const recipes = [...book.front, ...book.chapters.flatMap((/** @type {any} */ c) => c.entries), ...book.back];
  for (const e of recipes) {
    const at = entries[e.address];
    if (!at) {
      error('missing-entry', 1, `"${e.address}" isn't in the layout`);
      continue;
    }
    if (e.start === 'right' && at.start % 2 === 0)
      error('start', at.start, `${e.address} must start on a right-hand page`);
    if (e.start === 'left' && at.start % 2 === 1)
      error('start', at.start, `${e.address} must start on a left-hand page`);
    if (e.plate) {
      const plate = pages[at.start - 2];
      const faces =
        plate &&
        plate.side === 'left' &&
        plate.items.some((/** @type {any} */ i) => i.type === 'image' && i.src === e.plate.art);
      if (!faces) error('plate', at.start, `the plate for ${e.address} should be on the left page facing it`);
    }
  }
  for (const ch of book.chapters) {
    const at = entries[ch.address];
    if (at && at.start % 2 === 0) error('start', at.start, `chapter "${ch.title}" should open on a right-hand page`);
  }

  // --- Characters the fonts can't draw --------------------------------------
  /** @type {Map<string, number>} */
  const missing = new Map();
  for (const p of pages)
    for (const it of p.items) {
      if (it.type !== 'text') continue;
      for (const ch of it.text)
        if (
          !/\s/.test(ch) &&
          !inRanges(/** @type {number} */ (ch.codePointAt(0)), tpl.unicodeRanges) &&
          !missing.has(ch)
        )
          missing.set(ch, p.n);
    }
  for (const [ch, n] of missing)
    error(
      'missing-character',
      n,
      `"${ch}" (U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}) isn't in the book's fonts; it would be drawn in another font`,
    );

  // --- Per page ---------------------------------------------------------------
  /** @type {Map<string, { page: number, ln: number, of: number }[]>} */
  const blocks = new Map();
  for (const p of pages) {
    if (p.hard || !p.box) continue;
    const texts = p.items.filter((/** @type {any} */ i) => i.type === 'text');
    let prevEnd = 0;
    /** @type {{ x0: number, x1: number, y0: number, y1: number }[]} */
    const textBoxes = [];
    for (const it of texts) {
      const w = measure(it.text, it.font, it.letterSpacing);
      let x0 = it.cont ? prevEnd + it.gap : it.x;
      if (it.align === 'center') x0 -= w / 2;
      if (it.align === 'right') x0 -= w;
      const x1 = x0 + w;
      prevEnd = x1;
      const size = Number(/([\d.]+)px/.exec(it.font)?.[1] ?? 12);
      textBoxes.push({ x0, x1, y0: it.y - size * 0.8, y1: it.y + size * 0.25 });
      if (!it.align && (x1 > p.box.x1 + TOLERANCE || x0 < p.box.x0 - TOLERANCE))
        error('margin', p.n, `"${it.text.slice(0, 40)}" runs outside the text area`);
      if (it.y > p.box.bottom + TOLERANCE)
        error('margin', p.n, `"${it.text.slice(0, 40)}" runs below the bottom margin`);
      if (it.blk != null && it.of > 1) {
        const key = `${p.entry}:${it.blk}`;
        const lines = blocks.get(key) ?? [];
        if (!lines.some((l) => l.ln === it.ln)) lines.push({ page: p.n, ln: it.ln, of: it.of });
        blocks.set(key, lines);
      }
    }

    // A heading must not be the last thing on a page.
    const last = [...texts].filter((i) => i.blk != null).sort((a, b) => b.y - a.y)[0];
    if (last?.role === 'heading' && p.folio)
      error('heading', p.n, `heading "${last.text}" is the last line on the page`);

    for (const it of p.items) {
      if (it.type !== 'image') continue;
      if (it.scaled) warn('scaled-image', p.n, `${it.src} was scaled down to fit the text area`);
      if (!it.decor && !it.alt && p.folio) error('description', p.n, `${it.src} has no description`);
      const r = ((it.rotate ?? 0) * Math.PI) / 180;
      const hw = (Math.abs(Math.cos(r)) * it.w + Math.abs(Math.sin(r)) * it.h) / 2;
      const hh = (Math.abs(Math.sin(r)) * it.w + Math.abs(Math.cos(r)) * it.h) / 2;
      const cx = it.x + it.w / 2,
        cy = it.y + it.h / 2;
      if (
        cx - hw < -bleed - TOLERANCE ||
        cx + hw > W + bleed + TOLERANCE ||
        cy - hh < -bleed - TOLERANCE ||
        cy + hh > H + bleed + TOLERANCE
      )
        error('bleed', p.n, `${it.src} extends past the page's bleed`);
      if (it.decor && it.layer !== 'below' && !it.overlap) {
        const hit = textBoxes.some((t) => t.x0 < cx + hw && t.x1 > cx - hw && t.y0 < cy + hh && t.y1 > cy - hh);
        if (hit) warn('overlap', p.n, `decorative ${it.src} overlaps text (add overlap or layer=below if intended)`);
      }
    }
  }

  // --- Widows and orphans: a single line of a block alone on a page --------
  for (const [key, lines] of blocks) {
    const byPage = new Map();
    for (const l of lines) byPage.set(l.page, (byPage.get(l.page) ?? 0) + 1);
    if (byPage.size < 2) continue;
    const pagesOf = [...byPage.keys()].sort((a, b) => a - b);
    if (byPage.get(pagesOf[0]) === 1)
      warn('orphan', pagesOf[0], `a paragraph's first line is alone at the bottom of the page (${key})`);
    if (byPage.get(pagesOf[pagesOf.length - 1]) === 1)
      warn('widow', pagesOf[pagesOf.length - 1], `a paragraph's last line is alone at the top of the page (${key})`);
  }

  // --- An entry ending on a near-empty page -------------------------------
  for (const [address, at] of Object.entries(entries)) {
    if (at.last <= at.start) continue;
    const p = pages[at.last - 1];
    if (!p?.folio) continue;
    const lines = new Set(
      p.items
        .filter((/** @type {any} */ i) => i.type === 'text' && i.blk != null)
        .map((/** @type {any} */ i) => Math.round(i.y)),
    );
    const onlyNotes = p.items
      .filter((/** @type {any} */ i) => i.type === 'text')
      .every((/** @type {any} */ i) => i.role === 'note');
    if (onlyNotes || lines.size < 3)
      warn(
        'short-page',
        p.n,
        `${address} ends with a page holding ${onlyNotes ? 'only a note' : `${lines.size} line(s)`}`,
      );
  }

  return { errors, warnings };
}

/** One line per finding, for the console. @param {{ errors: Finding[], warnings: Finding[] }} r @param {string} edition */
export const formatFindings = (r, edition) =>
  [
    ...r.errors.map((f) => `  error   [${edition} p${f.page}] ${f.rule}: ${f.message}`),
    ...r.warnings.map((f) => `  warning [${edition} p${f.page}] ${f.rule}: ${f.message}`),
  ].join('\n');
