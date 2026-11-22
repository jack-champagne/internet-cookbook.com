// Browser tests for the cookbook page: it loads cleanly, typesets correctly,
// turns pages, and page turns never "snap" at their start or end.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { openBook, phone as phoneContext } from './helpers.js';

let desktop;
before(async () => { desktop = await openBook(); });
after(async () => { await desktop?.close(); });

test('desktop: loads without errors as a two-page book', async () => {
  assert.deepEqual(desktop.errors, []);
  const info = await desktop.page.evaluate(() => ({ pages: window.book().pageCount, display: window.book().opts.display }));
  assert.equal(info.display, 'double');
  assert.ok(info.pages >= 4 && info.pages % 2 === 0, `even page count, got ${info.pages}`);
});

test('book structure: two-sided cover boards, contents start on a right page', async () => {
  const s = await desktop.page.evaluate(() => {
    const b = window.book(), n = b.pageCount;
    b.goTo(1);
    const closedFront = b.visiblePages;
    b.goTo(n);
    const closedBack = b.visiblePages;
    b.goTo(2);
    const opening = b.visiblePages;
    return { n, hard: b.opts.hard, closedFront, closedBack, opening, status: document.getElementById('status').textContent };
  });
  assert.equal(s.n % 2, 0, 'even page count');
  assert.deepEqual(s.hard, [1, 2, s.n - 1, s.n], 'only the cover boards (both sides) are rigid');
  assert.deepEqual(s.closedFront, [1], 'closed book shows only the front cover');
  assert.deepEqual(s.closedBack, [s.n], 'closed from the back shows only the back cover');
  assert.deepEqual(s.opening, [2, 3], 'front endpaper faces the first contents page');
});

test('the counter names every visible page', async () => {
  const { page } = desktop;
  await page.evaluate(() => window.book().goTo(1));
  await page.click('#next');
  await page.waitForFunction(() => window.book().visiblePages.length === 2, null, { timeout: 5000 });
  await page.waitForFunction(() => /^pages 2–3 of \d+$/.test(document.getElementById('status').textContent), null, { timeout: 5000 });
});

test('next() turns the page', async () => {
  const { page } = desktop;
  await page.evaluate(() => window.book().goTo(1));
  await page.evaluate(() => window.book().next());
  await page.waitForFunction(() => window.book().page === 2, null, { timeout: 5000 });
});

test('typeset text: exact word spaces, nothing past the margins or into images', async () => {
  const result = await desktop.page.evaluate(async () => {
    const T = await import('/typeset.js'), { parseRecipe } = await import('/recipe-md.js');
    const c = document.createElement('canvas').getContext('2d');
    const out = {};
    // Every recipe the test book contains (interim list until book.yaml).
    for (const file of ['shepherds-pie', 'hamburg-and-rice']) {
    const recipe = parseRecipe(await (await fetch(`/recipes/${file}.md`)).text());
    const images = await T.loadImages(recipe);
    for (const edition of Object.keys(T.TEMPLATES)) {
      const name = `${file} / ${edition}`;
      const tpl = T.TEMPLATES[edition], pages = T.typesetRecipe(recipe, tpl, images);
      const right = tpl.page.width - tpl.page.margin.right;
      const width = (it) => { c.font = it.font.replace(/([\d.]+)px/, (_, n) => `${n * 3}px`); return c.measureText(it.text).width / 3; };
      let pastMargin = 0, intoImage = 0, badSpaces = 0;
      for (const pg of pages) {
        let prevEnd = 0;
        for (const it of pg.items.filter((i) => i.type === 'text')) {
          if (it.cont) {
            const x = prevEnd + it.gap;
            if (it.gap !== 0 && (it.gap < 1 || it.gap > 4)) badSpaces++;
            it.x = x;
          }
          const end = it.x + width(it);
          prevEnd = end;
          if (end > right + 0.5) pastMargin++;
          for (const f of pg.floats) if (it.y > f.y && it.y - 8 < f.y + f.h && end > f.x - 1 && it.x < f.x + f.w) intoImage++;
        }
      }
      out[name] = { pages: pages.length, pastMargin, intoImage, badSpaces };
    }
    }
    return out;
  });
  for (const [name, r] of Object.entries(result)) {
    assert.ok(r.pages >= 1, `${name}: has pages`);
    assert.equal(r.pastMargin, 0, `${name}: text past the margin`);
    assert.equal(r.intoImage, 0, `${name}: text running into a wrapped image`);
    assert.equal(r.badSpaces, 0, `${name}: word spaces out of range`);
  }
});

test('page turns match the static book exactly at both ends (no shadow snap)', async () => {
  const rows = await desktop.page.evaluate(() => {
    const b = window.book();
    const n = b.pageCount;
    const grab = () => b.ctx.getImageData(0, 0, b.canvas.width, b.canvas.height).data;
    const maxDiff = (a, c) => {
      let max = 0;
      for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - c[i]));
      return max;
    };
    const frame = (dir, start, point) => {
      b.debugFrame(dir, start, point);
      const img = grab();
      b.debugFrame();
      return img;
    };
    const out = [];
    for (const [label, pageNo, dir, y, hard] of [
      ['soft forward', 2, 'forward', b.H], ['soft backward', 4, 'backward', b.H], ['soft edge grab', 2, 'forward', b.H / 2],
      ['hard forward', 1, 'forward', b.H], ['hard backward', n, 'backward', b.H],
      ['soft cover', 1, 'forward', b.H, []], ['soft last page', n, 'backward', b.H, []],
    ]) {
      b.set({ hard: hard ?? [1, n] });
      b.goTo(pageNo); b.render(); const before = grab();
      const spec = b.turnFor(dir), S = { x: b.W, y };
      const atStart = frame(dir, S, S), atEnd = frame(dir, S, { x: -b.W, y });
      b.goTo(spec.next); const after = grab();
      out.push({ label, start: maxDiff(before, atStart), end: maxDiff(atEnd, after) });
    }
    b.set({ hard: [1, n] });
    return out;
  });
  for (const r of rows) {
    assert.equal(r.start, 0, `${r.label}: snaps at the start of the turn`);
    assert.equal(r.end, 0, `${r.label}: snaps at the end of the turn`);
  }
});

test('keyboard: arrows, Home and End turn pages', async () => {
  const { page } = desktop;
  await page.evaluate(() => window.book().goTo(1));
  await page.focus('#book');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.book().visiblePages.join() === '2,3', null, { timeout: 5000 });
  await page.keyboard.press('End');
  await page.waitForFunction(() => { const b = window.book(); return b.visiblePages.join() === String(b.pageCount); }, null, { timeout: 5000 });
  await page.keyboard.press('Home');
  await page.waitForFunction(() => window.book().visiblePages.join() === '1', null, { timeout: 5000 });
});

test('accessible name says which pages are showing', async () => {
  const { page } = desktop;
  await page.evaluate(() => window.book().goTo(4));
  const label = await page.getAttribute('#book', 'aria-label');
  assert.match(label, /^Book, pages 4–5 of \d+$/);
  assert.equal(await page.getAttribute('#book', 'tabindex'), '0');
});

test('memory: only pages near the reader stay rasterised', async () => {
  const result = await desktop.page.evaluate(() => {
    const b = window.book(), keep = b.opts.keepPages;
    let max = 0;
    for (let n = 1; n <= b.pageCount; n++) { b.goTo(n); max = Math.max(max, b.rasterisedPages); }
    return { max, limit: 2 * keep + 1 };
  });
  assert.ok(result.max <= result.limit, `${result.max} rasterised pages, limit ${result.limit}`);
});

test('reduced motion: turns complete without animating', async () => {
  const reduced = await openBook({ reducedMotion: 'reduce' });
  try {
    const took = await reduced.page.evaluate(async () => {
      const b = window.book();
      b.goTo(1);
      const t0 = performance.now();
      b.next();
      while (b.visiblePages.join() !== '2,3') await new Promise(requestAnimationFrame);
      return performance.now() - t0;
    });
    assert.ok(took < 200, `turn took ${took.toFixed(0)} ms`);
  } finally {
    await reduced.close();
  }
});

test('portrait phone: single pages on the phone trim, no errors', async () => {
  const phone = await openBook(phoneContext());
  try {
    assert.deepEqual(phone.errors, []);
    const info = await phone.page.evaluate(() => ({ display: window.book().opts.display, w: window.book().W, h: window.book().H }));
    assert.equal(info.display, 'single');
    assert.ok(Math.abs(info.h / info.w - 7.5 / 4.5) < 0.02, 'phone trim proportions');
  } finally {
    await phone.close();
  }
});
