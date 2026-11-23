// Browser tests for the layout engine (src/layout): book structure and
// spread rules, contents page numbers, mirrored margins, and typesetting
// quality on every document in every edition.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as playwright from 'playwright';
import { loadBook } from '../src/content/load.js';
import { parseDocument } from '../src/content/markdown.js';
import { serve, ORIGIN } from '../scripts/lib/serve.mjs';
import { BROWSER } from './helpers.js';

const REPO = new URL('../', import.meta.url).pathname;
const BOOK = new URL('../books/internet-cookbook/', import.meta.url).pathname;

let browser, page, book;
before(async () => {
  book = await loadBook({ readText: (p) => readFile(BOOK + p, 'utf8'), exists: (p) => existsSync(BOOK + p) });
  browser = await playwright[BROWSER].launch();
  const context = await browser.newContext();
  await serve(context, { repo: REPO, book: BOOK });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}/src/build/harness.html`);
  await page.waitForFunction(() => typeof window.layoutEdition === 'function');
  assert.deepEqual(errors, []);
});
after(() => browser?.close());

const layout = (b, edition) => page.evaluate(([b, e]) => window.layoutEdition(b, e).then((r) => r), [b, edition]);

for (const edition of ['book', 'phone']) {
  test(`${edition}: book structure and spread rules`, async () => {
    const { layout: L } = await layout(book, edition);
    const n = L.pages.length;
    assert.equal(n % 2, 0, 'even page count');
    assert.deepEqual(
      L.pages.filter((p) => p.hard).map((p) => p.n),
      [1, 2, n - 1, n],
      'only the two cover boards are rigid',
    );
    for (const p of L.pages) assert.equal(p.side, p.n % 2 ? 'right' : 'left', `page ${p.n} side`);
    assert.ok(
      L.pages[2].items.some((i) => i.text === book.title),
      'title page is page 3',
    );
    const pie = L.entries['/recipes/shepherds-pie/'];
    assert.equal(pie.start % 2, 1, 'recipe with a plate starts on a right page');
    assert.equal(pie.first, pie.start - 1, 'its pages include the facing plate');
    const plate = L.pages[pie.start - 2];
    assert.ok(
      plate.items.some((i) => i.type === 'image' && i.src === '/art/shepherds-pie.svg'),
      'plate faces it',
    );
    assert.equal(L.entries['/chapters/hearth-and-home/'].start % 2, 1, 'chapter opener on a right page');
    for (const [address, e] of Object.entries(L.entries)) assert.ok(e.first <= e.start && e.start <= e.last, address);
  });

  test(`${edition}: contents page numbers match where entries start`, async () => {
    const { layout: L } = await layout(book, edition);
    const toc = L.pages.filter((p) => p.entry === '/' && p.items.some((i) => i.text === 'Contents'));
    assert.ok(toc.length >= 1, 'a contents page exists');
    const items = toc.flatMap((p) => p.items.filter((i) => i.type === 'text'));
    const numberAfter = (title) => {
      const i = items.findIndex((it) => it.text === title);
      return Number(items.slice(i + 1).find((it) => /^\d+$/.test(it.text))?.text);
    };
    assert.equal(numberAfter("Shepherd's Pie"), L.entries['/recipes/shepherds-pie/'].start);
    assert.equal(numberAfter('Hamburg and Rice'), L.entries['/recipes/hamburg-and-rice/'].start);
    assert.equal(numberAfter('Hearth & Home'), L.entries['/chapters/hearth-and-home/'].start);
  });

  test(`${edition}: typesetting quality on every document`, async () => {
    const r = await page.evaluate(
      async ([b, e]) => {
        const { layout: L } = await window.layoutEdition(b, e);
        const c = document.createElement('canvas').getContext('2d');
        const width = (it) => {
          c.font = it.font.replace(/([\d.]+)px/, (_, n) => `${n * 3}px`);
          return c.measureText(it.text).width / 3;
        };
        const out = { pastMargin: [], intoImage: 0, badSpaces: 0, loneNotes: 0 };
        for (const pg of L.pages) {
          if (pg.hard || !pg.box) continue;
          const texts = pg.items.filter((i) => i.type === 'text' && !i.align);
          let prevEnd = 0;
          for (const it of texts) {
            if (it.cont) {
              if (it.gap !== 0 && (it.gap < 1 || it.gap > 4)) out.badSpaces++;
              it.x = prevEnd + it.gap;
            }
            const end = it.x + width(it);
            prevEnd = end;
            if (end > pg.box.x1 + 0.5) out.pastMargin.push(`p${pg.n}: ${it.text}`);
            for (const f of pg.floats)
              if (it.y > f.y && it.y - 8 < f.y + f.h && end > f.x - 1 && it.x < f.x + f.w) out.intoImage++;
          }
          const t = pg.items.filter((i) => i.type === 'text');
          if (t.length && t.every((i) => i.font.includes('Caveat'))) out.loneNotes++;
        }
        return out;
      },
      [book, edition],
    );
    assert.deepEqual(r.pastMargin, [], 'text past the margin');
    assert.equal(r.intoImage, 0, 'text running into a wrapped image');
    assert.equal(r.badSpaces, 0, 'word spaces out of range');
    assert.equal(r.loneNotes, 0, 'a note alone on a page');
  });
}

for (const edition of ['book', 'phone']) {
  test(`${edition}: preflight finds no errors in the real book`, async () => {
    const { report } = await layout(book, edition);
    assert.deepEqual(report.errors, []);
  });
}

test('preflight catches a character the fonts lack, in a real layout', async () => {
  const b = structuredClone(book);
  b.chapters[0].entries[0].doc.blocks.push({
    type: 'paragraph',
    runs: [{ text: 'Mix with ψ.', bold: false, italic: false }],
    line: 99,
  });
  const { report } = await layout(b, 'book');
  assert.ok(report.errors.some((f) => f.rule === 'missing-character' && /U\+03C8/.test(f.message)));
});

test('margins mirror: inside on the left of right pages, on the right of left pages', async () => {
  const theme = structuredClone(book.theme);
  theme.editions.book.margins = { top: '58pt', bottom: '64pt', inside: '90pt', outside: '40pt' };
  const { layout: L } = await layout({ ...book, theme }, 'book');
  const docPages = L.pages.filter((p) => p.folio && p.items.some((i) => i.type === 'text' && !i.align));
  const lefts = docPages.filter((p) => p.side === 'left'),
    rights = docPages.filter((p) => p.side === 'right');
  assert.ok(lefts.length && rights.length, 'text on both sides');
  const minX = (p) => Math.min(...p.items.filter((i) => i.type === 'text' && !i.cont && !i.align).map((i) => i.x));
  for (const p of rights) assert.ok(minX(p) >= 90 - 0.01, `right page ${p.n} starts at the inside margin`);
  for (const p of lefts)
    assert.ok(minX(p) >= 40 - 0.01 && minX(p) < 90, `left page ${p.n} starts at the outside margin`);
  for (const p of lefts) assert.equal(p.box.x1, 576 - 90, 'left page text area ends at the inside margin');
});

test('edge cases: a long ingredient list, a tall image and a missing image', async () => {
  const ingredients = Array.from(
    { length: 90 },
    (_, i) => `- ${i + 1} ingredient with a fairly long description to wrap`,
  ).join('\n');
  const doc = parseDocument(
    `---\ntitle: Fixture\n---\n\n## Ingredients\n\n${ingredients}\n\n## Method\n\n![A tall picture](/__fixtures/tall.svg){width=100%}\n\n![Gone](/missing.svg){width=50%}\n\n1. Step.\n`,
  );
  const b = structuredClone(book);
  b.chapters[0].entries[1].doc = doc;
  b.assets.push('/__fixtures/tall.svg', '/missing.svg');
  for (const edition of ['book', 'phone']) {
    const { tpl, layout: L } = await layout(b, edition);
    const at = L.entries['/recipes/hamburg-and-rice/'];
    const pages = L.pages.slice(at.start - 1, at.last);
    const bottom = tpl.page.height - tpl.page.margin.bottom,
      area = bottom - tpl.page.margin.top;
    const texts = pages.flatMap((p) => p.items.filter((i) => i.type === 'text'));
    const imgs = pages.flatMap((p) => p.items.filter((i) => i.type === 'image'));
    assert.equal(texts.filter((t) => t.y > bottom + 0.5).length, 0, `${edition}: text below the bottom margin`);
    assert.ok(texts.filter((t) => /ingredient with/.test(t.text)).length >= 90, `${edition}: every ingredient is set`);
    assert.equal(imgs.length, 1, `${edition}: the missing image is skipped, the tall one placed`);
    assert.ok(imgs[0].h <= area + 0.01 && imgs[0].y + imgs[0].h <= bottom + 0.5, `${edition}: tall image fits`);
  }
});
