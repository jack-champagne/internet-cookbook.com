import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from '../src/preflight.js';

// A tiny well-formed book layout: 6 pages, a recipe on 5 with its plate on 4.
const TPL = {
  page: { width: 400, height: 500, bleed: 9 },
  unicodeRanges: [
    [0, 0xff],
    [0x2000, 0x206f],
  ],
};
const BOX = { x0: 40, x1: 360, top: 40, bottom: 460 };
const BOOK = {
  title: 'Book',
  front: [],
  back: [],
  chapters: [
    {
      title: 'Ch',
      address: '/chapters/ch/',
      entries: [{ address: '/recipes/r/', start: 'right', plate: { art: '/art/p.svg' } }],
    },
  ],
};
const text = (x, y, s, extra = {}) => ({ type: 'text', x, y, text: s, font: '400 10px "Serif"', ...extra });
const page = (n, extra = {}) => ({
  n,
  side: n % 2 ? 'right' : 'left',
  hard: false,
  folio: null,
  entry: '/',
  box: BOX,
  items: [],
  floats: [],
  anchors: [],
  ...extra,
});
// Pages: 1–2 front cover board, 3 title, 4 plate facing 5 (the recipe),
// 6 blank, 7–8 back cover board. Each test changes one thing.
const layout = () => ({
  pages: [
    page(1, { hard: true }),
    page(2, { hard: true }),
    page(3, { items: [text(200, 200, 'Book', { align: 'center' })] }),
    page(4, {
      entry: '/recipes/r/',
      items: [{ type: 'image', src: '/art/p.svg', x: 50, y: 50, w: 300, h: 200, alt: 'p' }],
    }),
    page(5, {
      entry: '/recipes/r/',
      folio: 5,
      items: [
        text(40, 60, 'Title', { blk: 1, ln: 0, of: 1, role: 'title' }),
        text(40, 80, 'Body text', { blk: 2, ln: 0, of: 2, role: 'body' }),
        text(40, 96, 'more', { blk: 2, ln: 1, of: 2, role: 'body' }),
        text(40, 112, 'last', { blk: 3, ln: 0, of: 1, role: 'body' }),
      ],
    }),
    page(6),
    page(7, { hard: true }),
    page(8, { hard: true }),
  ],
  entries: {
    '/': { first: 1, last: 3, start: 1 },
    '/chapters/ch/': { first: 3, last: 3, start: 3 },
    '/recipes/r/': { first: 4, last: 5, start: 5 },
  },
});
const ctx = { tpl: TPL, book: BOOK, measure: (s) => s.length * 5 };
const well = (mutate) => {
  const L = layout();
  mutate?.(L);
  return preflight(L, ctx);
};
const rules = (findings) => findings.map((f) => f.rule);

test('a well-formed layout passes', () => {
  assert.deepEqual(well(), { errors: [], warnings: [] });
});

test('structure: odd page count, wrong rigid pages, wrong side, missing title page', () => {
  assert.ok(rules(well((L) => L.pages.pop()).errors).includes('structure'));
  assert.ok(
    well((L) => (L.pages[3].hard = true)).errors.some((f) => f.rule === 'structure' && /rigid/.test(f.message)),
  );
  assert.ok(well((L) => (L.pages[4].side = 'left')).errors.some((f) => /wrong side/.test(f.message)));
  assert.ok(well((L) => (L.pages[2].items = [])).errors.some((f) => /title page/.test(f.message)));
});

test('spread rules: plate facing, start side, chapter opener side', () => {
  assert.ok(rules(well((L) => (L.pages[3].items = [])).errors).includes('plate'));
  assert.ok(rules(well((L) => (L.entries['/recipes/r/'].start = 4)).errors).includes('start'));
  assert.ok(well((L) => (L.entries['/chapters/ch/'].start = 4)).errors.some((f) => /chapter "Ch"/.test(f.message)));
});

test('characters outside the fonts', () => {
  const r = well((L) => L.pages[4].items.push(text(40, 140, 'Ωmega', { blk: 9, ln: 0, of: 1 })));
  assert.deepEqual(rules(r.errors), ['missing-character']);
  assert.match(r.errors[0].message, /U\+03A9/);
});

test('margins: text past the right edge or below the bottom', () => {
  assert.ok(rules(well((L) => L.pages[4].items.push(text(300, 150, 'far too long a line'))).errors).includes('margin'));
  assert.ok(rules(well((L) => L.pages[4].items.push(text(40, 470, 'low'))).errors).includes('margin'));
  // Chained runs are placed after the previous run, as drawn.
  const chained = well((L) =>
    L.pages[4].items.push(text(300, 150, 'abcdefghij'), text(0, 150, 'more', { cont: true, gap: 2 })),
  );
  assert.ok(rules(chained.errors).includes('margin'));
});

test('a heading as the last line of a page is an error', () => {
  const r = well((L) => L.pages[4].items.push(text(40, 300, 'Method', { blk: 8, ln: 0, of: 1, role: 'heading' })));
  assert.ok(rules(r.errors).includes('heading'));
});

test('images: description, bleed, scaled, decorative overlap', () => {
  assert.ok(
    rules(
      well((L) => L.pages[4].items.push({ type: 'image', src: '/a.svg', x: 40, y: 200, w: 50, h: 50 })).errors,
    ).includes('description'),
  );
  assert.ok(
    rules(
      well((L) => L.pages[4].items.push({ type: 'image', src: '/a.svg', alt: 'a', x: 380, y: 200, w: 50, h: 50 }))
        .errors,
    ).includes('bleed'),
  );
  assert.ok(
    rules(
      well((L) =>
        L.pages[4].items.push({ type: 'image', src: '/a.svg', alt: 'a', x: 40, y: 200, w: 50, h: 50, scaled: true }),
      ).warnings,
    ).includes('scaled-image'),
  );
  const decor = { type: 'image', src: '/d.svg', decor: true, x: 40, y: 70, w: 60, h: 20 };
  assert.ok(rules(well((L) => L.pages[4].items.push({ ...decor })).warnings).includes('overlap'));
  assert.ok(!rules(well((L) => L.pages[4].items.push({ ...decor, overlap: true })).warnings).includes('overlap'));
  assert.ok(!rules(well((L) => L.pages[4].items.push({ ...decor, layer: 'below' })).warnings).includes('overlap'));
});

test('widows, orphans and an entry ending on a near-empty page', () => {
  const split = well((L) => {
    // Block 7: one line at the bottom of page 5, two on page 6.
    L.pages[4].items.push(text(40, 440, 'first', { blk: 7, ln: 0, of: 3 }));
    L.pages[5] = page(6, {
      entry: '/recipes/r/',
      folio: 6,
      items: [text(40, 60, 'second', { blk: 7, ln: 1, of: 3 }), text(40, 76, 'third', { blk: 7, ln: 2, of: 3 })],
    });
    L.entries['/recipes/r/'].last = 6;
  });
  assert.ok(rules(split.warnings).includes('orphan'));
  assert.ok(rules(split.warnings).includes('short-page'));
  const widow = well((L) => {
    L.pages[4].items.push(text(40, 420, 'a', { blk: 7, ln: 0, of: 3 }), text(40, 436, 'b', { blk: 7, ln: 1, of: 3 }));
    L.pages[5] = page(6, { entry: '/recipes/r/', folio: 6, items: [text(40, 60, 'c', { blk: 7, ln: 2, of: 3 })] });
    L.entries['/recipes/r/'].last = 6;
  });
  assert.ok(rules(widow.warnings).includes('widow'));
});
