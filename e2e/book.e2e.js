// Browser tests for the published site (dist/): the book view loads cleanly
// under the site's CSP, turns pages without snapping, opens at the page's
// address and keeps the address, title and article in step as pages turn;
// the article underneath reads well in reader mode.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openBook, phone as phoneContext, REPO } from './helpers.js';

let desktop;
before(async () => {
  desktop = await openBook();
});
after(async () => {
  await desktop?.close();
});

test('desktop: loads without errors as a two-page book', async () => {
  assert.deepEqual(desktop.errors, []);
  const info = await desktop.page.evaluate(() => ({
    pages: window.book().pageCount,
    display: window.book().opts.display,
  }));
  assert.equal(info.display, 'double');
  assert.ok(info.pages >= 4 && info.pages % 2 === 0, `even page count, got ${info.pages}`);
});

test('book structure: two-sided cover boards, contents start on a right page', async () => {
  const s = await desktop.page.evaluate(() => {
    const b = window.book(),
      n = b.pageCount;
    b.goTo(1);
    const closedFront = b.visiblePages;
    b.goTo(n);
    const closedBack = b.visiblePages;
    b.goTo(2);
    const opening = b.visiblePages;
    return {
      n,
      hard: b.opts.hard,
      closedFront,
      closedBack,
      opening,
      status: document.getElementById('status').textContent,
    };
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
  await page.waitForFunction(() => /^pages 2–3 of \d+$/.test(document.getElementById('status').textContent), null, {
    timeout: 5000,
  });
});

test('licences and 404 pages load cleanly under the site CSP', async () => {
  for (const path of ['/licenses/', '/no-such-page/']) {
    const plain = await openBook({}, path);
    try {
      // The browser logs the missing page's own 404; anything else is a fault.
      const errors = plain.errors.filter((e) => !(path === '/no-such-page/' && /status of 404/.test(e)));
      assert.deepEqual(errors, [], `${path}: ${errors.join('; ')}`);
      assert.ok((await plain.page.textContent('h1')).length > 3);
    } finally {
      await plain.close();
    }
  }
});

test('shadows option: a partial override keeps the other strengths', async () => {
  const r = await desktop.page.evaluate(() => {
    const b = window.book(),
      before = { ...b.opts.shadows };
    b.set({ shadows: { flap: 0.1 } });
    const after = { ...b.opts.shadows };
    b.set({ shadows: before });
    return { before, after };
  });
  assert.equal(r.after.flap, 0.1);
  for (const k of Object.keys(r.before)) if (k !== 'flap') assert.equal(r.after[k], r.before[k], k);
});

test('next() turns the page', async () => {
  const { page } = desktop;
  await page.evaluate(() => window.book().goTo(1));
  await page.evaluate(() => window.book().next());
  await page.waitForFunction(() => window.book().page === 2, null, { timeout: 5000 });
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
      ['soft forward', 2, 'forward', b.H],
      ['soft backward', 4, 'backward', b.H],
      ['soft edge grab', 2, 'forward', b.H / 2],
      ['hard forward', 1, 'forward', b.H],
      ['hard backward', n, 'backward', b.H],
      ['soft cover', 1, 'forward', b.H, []],
      ['soft last page', n, 'backward', b.H, []],
    ]) {
      b.set({ hard: hard ?? [1, n] });
      b.goTo(pageNo);
      b.render();
      const before = grab();
      const spec = b.turnFor(dir),
        S = { x: b.W, y };
      const atStart = frame(dir, S, S),
        atEnd = frame(dir, S, { x: -b.W, y });
      b.goTo(spec.next);
      const after = grab();
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

test('a turning board lines up with the page at rest at any size (no seams)', async () => {
  // Dark boards over light pages show any gap between the board's strips, and
  // odd sizes put strip edges and page edges between pixels.
  for (const deviceScaleFactor of [1, 2]) {
    const ctx = await openBook({ deviceScaleFactor });
    try {
      const rows = await ctx.page.evaluate(async () => {
        const { Book } = await import('/crease.js');
        const out = [];
        for (const W of [520, 533.3, 536, 547.5]) {
          const c = document.createElement('canvas');
          document.body.append(c);
          const pages = Array.from({ length: 8 }, (_, i) => (g, w, h) => {
            g.fillStyle = i === 0 || i === 7 ? '#3d4a3a' : '#fdfcf8';
            g.fillRect(0, 0, w, h);
            g.fillStyle = '#c00';
            g.font = '30px serif';
            g.fillText(`Board ${i}`, 40, 80);
          });
          const b = new Book(c, { pages, pageWidth: W, pageHeight: W * 1.25, padding: 28.3, hard: [1, 2, 7, 8] });
          const grab = () => b.ctx.getImageData(0, 0, c.width, c.height).data;
          for (const [dir, from] of [
            ['forward', 1],
            ['backward', 8],
          ]) {
            b.goTo(from);
            b.render();
            const rest = grab();
            const S = { x: b.W, y: b.H };
            b.debugFrame(dir, S, S);
            const lifted = grab();
            b.debugFrame();
            let max = 0;
            for (let i = 0; i < rest.length; i++) max = Math.max(max, Math.abs(rest[i] - lifted[i]));
            out.push({ W, dir, max });
          }
          b.destroy();
          c.remove();
        }
        return out;
      });
      for (const r of rows) assert.equal(r.max, 0, `${deviceScaleFactor}x, width ${r.W}, ${r.dir}`);
    } finally {
      await ctx.close();
    }
  }
});

test('keyboard: arrows, Home and End turn pages', async () => {
  const { page } = desktop;
  await page.evaluate(() => window.book().goTo(1));
  await page.focus('#book');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.book().visiblePages.join() === '2,3', null, { timeout: 5000 });
  await page.keyboard.press('End');
  await page.waitForFunction(
    () => {
      const b = window.book();
      return b.visiblePages.join() === String(b.pageCount);
    },
    null,
    { timeout: 5000 },
  );
  await page.keyboard.press('Home');
  await page.waitForFunction(() => window.book().visiblePages.join() === '1', null, { timeout: 5000 });
});

test('accessible name says which pages are showing', async () => {
  const { page } = desktop;
  await page.evaluate(() => window.book().goTo(4));
  const label = await page.getAttribute('#book', 'aria-label');
  assert.match(label, /^Internet Cookbook, pages 4–5 of \d+$/);
  assert.equal(await page.getAttribute('#book', 'tabindex'), '0');
});

test('memory: only pages near the reader stay rasterised', async () => {
  const result = await desktop.page.evaluate(() => {
    const b = window.book(),
      keep = b.opts.keepPages;
    let max = 0;
    for (let n = 1; n <= b.pageCount; n++) {
      b.goTo(n);
      max = Math.max(max, b.rasterisedPages);
    }
    return { max, limit: 2 * keep + 1 };
  });
  assert.ok(result.max <= result.limit, `${result.max} rasterised pages, limit ${result.limit}`);
});

test('reduced motion: turns complete without animating', async () => {
  const reduced = await openBook({ reducedMotion: 'reduce' });
  try {
    // Count animation frames, not milliseconds: a jump completes on the next
    // frame however slowly the engine draws; an animated turn takes dozens.
    const frames = await reduced.page.evaluate(async () => {
      const b = window.book();
      b.goTo(1);
      b.next();
      let n = 0;
      while (b.visiblePages.join() !== '2,3' && n < 100) {
        await new Promise(requestAnimationFrame);
        n++;
      }
      return n;
    });
    assert.ok(frames <= 3, `turn took ${frames} animation frames`);
  } finally {
    await reduced.close();
  }
});

test('portrait phone: single pages on the phone trim, no errors', async () => {
  const phone = await openBook(phoneContext());
  try {
    assert.deepEqual(phone.errors, []);
    const info = await phone.page.evaluate(() => ({
      display: window.book().opts.display,
      w: window.book().W,
      h: window.book().H,
    }));
    assert.equal(info.display, 'single');
    assert.ok(Math.abs(info.h / info.w - 7.5 / 4.5) < 0.02, 'phone trim proportions');
  } finally {
    await phone.close();
  }
});

test('a recipe address opens the book at that recipe', async () => {
  const deep = await openBook({}, '/recipes/hamburg-and-rice/');
  try {
    assert.deepEqual(deep.errors, []);
    const s = await deep.page.evaluate(async () => {
      const layout = await (await fetch('/layout/book.json')).json();
      const at = layout.entries['/recipes/hamburg-and-rice/'];
      return { shown: window.book().visiblePages, start: at.start };
    });
    assert.ok(s.shown.includes(s.start), `recipe start page ${s.start} is showing (${s.shown})`);
    assert.equal(new URL(deep.page.url()).pathname, '/recipes/hamburg-and-rice/');
  } finally {
    await deep.close();
  }
});

test('turning pages updates the address, title and article', async () => {
  const { page } = desktop;
  const { entries } = await page.evaluate(async () => (await fetch('/layout/book.json')).json());
  const recipe = entries['/recipes/shepherds-pie/'];
  await page.evaluate((n) => window.book().goTo(n), recipe.start);
  await page.waitForFunction(() => location.pathname === '/recipes/shepherds-pie/', null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === "Shepherd's Pie", null, {
    timeout: 5000,
  });
  assert.equal(await page.title(), "Shepherd's Pie · Internet Cookbook");
  assert.equal(
    await page.getAttribute('link[rel=canonical]', 'href'),
    'https://internet-cookbook.com/recipes/shepherds-pie/',
  );
  await page.evaluate(() => window.book().goTo(1));
  await page.waitForFunction(() => location.pathname === '/', null, { timeout: 5000 });
  assert.equal(await page.title(), 'Internet Cookbook');
  assert.deepEqual(desktop.errors, []);
});

test('readers never download the build tools (Pretext, js-yaml) or the book source', async () => {
  const bad = desktop.requests.filter((u) => /pretext|js-yaml|\/src\/|\.md$|\.yaml$/.test(u));
  assert.deepEqual(bad, []);
});

test('reader mode: Readability extracts each recipe whole', async () => {
  // A separate context that ignores the CSP, so the test can inject Readability.
  const reader = await openBook({ bypassCSP: true, javaScriptEnabled: true }, '/recipes/shepherds-pie/');
  try {
    const script = await readFile(`${REPO}node_modules/@mozilla/readability/Readability.js`, 'utf8');
    for (const path of ['/recipes/shepherds-pie/', '/recipes/hamburg-and-rice/']) {
      await reader.page.goto(`https://book.test${path}`);
      await reader.page.addScriptTag({ content: script });
      const article = await reader.page.evaluate(() => {
        // eslint-disable-next-line no-undef
        const r = new Readability(document.cloneNode(true)).parse();
        return r && { title: r.title, text: r.textContent };
      });
      assert.ok(article, `${path}: Readability found an article`);
      assert.match(article.title, /Shepherd's Pie|Hamburg and Rice/);
      assert.match(article.text, /Ingredients/);
      assert.match(article.text, /Method/);
      assert.doesNotMatch(article.text, /Opening the book|Page: auto/, `${path}: the book controls are left out`);
    }
  } finally {
    await reader.close();
  }
});
