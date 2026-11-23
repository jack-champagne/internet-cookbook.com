// Visual regression: what readers see, compared with reviewed screenshots.
//
// The book drawn here is a frozen fixture (e2e/fixtures/visual-book/), not the
// real book, so recipe and art changes never fail these tests; changes to the
// code that lays out, draws or turns pages do.
//
// Baselines live in e2e/visual/<browser>/ and are made on CI's Linux runners
// (fonts are smoothed differently on other systems). Without baselines for an
// engine, the comparisons are skipped. To make or update them, run the
// "Visual baselines" workflow, which opens a pull request with the new images
// for review; or locally, UPDATE_VISUAL=1 npm run test:visual.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../scripts/build.mjs';
import { openBook, phone, BROWSER, REPO } from './helpers.js';

const UPDATE = process.env.UPDATE_VISUAL === '1';
const BASELINES = join(REPO, 'e2e/visual', BROWSER);
const DIFFS = join(REPO, 'e2e/visual/__diffs__', BROWSER);
// A pixel differs when a channel is off by more than CHANNEL; a picture
// differs when more than SHARE of its pixels do (anti-aliasing noise).
const CHANNEL = 24;
const SHARE = 0.002;

let dir, dist;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'visual-book-'));
  await cp(join(REPO, 'e2e/fixtures/visual-book'), join(dir, 'book'), { recursive: true });
  await cp(join(REPO, 'books/internet-cookbook/fonts'), join(dir, 'book/fonts'), { recursive: true });
  dist = join(dir, 'dist');
  const { failed, reports } = await build({ book: join(dir, 'book'), out: dist });
  assert.ok(!failed, `the fixture book fails preflight: ${JSON.stringify(reports)}`);
});
after(() => rm(dir, { recursive: true, force: true }));

/** Compare a PNG with its baseline in the browser (no image library needed). */
async function compare(t, page, name, png) {
  const file = join(BASELINES, `${name}.png`);
  if (UPDATE) {
    await mkdir(BASELINES, { recursive: true });
    await writeFile(file, png);
    return;
  }
  if (!existsSync(file)) return t.skip(`no ${BROWSER} baseline for ${name}; run the Visual baselines workflow`);
  const baseline = await readFile(file);
  const r = await page.evaluate(
    async ([a, b, channel]) => {
      const decode = async (b64) => {
        // Decoded from bytes: the site's CSP blocks fetching data: URLs.
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        return { w: bmp.width, h: bmp.height, data: g.getImageData(0, 0, bmp.width, bmp.height).data };
      };
      const [x, y] = await Promise.all([decode(a), decode(b)]);
      if (x.w !== y.w || x.h !== y.h) return { size: [`${x.w}×${x.h}`, `${y.w}×${y.h}`] };
      const out = new OffscreenCanvas(x.w, x.h);
      const og = out.getContext('2d');
      const diff = og.createImageData(x.w, x.h);
      let n = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const d = Math.max(
          Math.abs(x.data[i] - y.data[i]),
          Math.abs(x.data[i + 1] - y.data[i + 1]),
          Math.abs(x.data[i + 2] - y.data[i + 2]),
          Math.abs(x.data[i + 3] - y.data[i + 3]),
        );
        const bad = d > channel;
        if (bad) n++;
        diff.data[i] = bad ? 255 : x.data[i] / 3;
        diff.data[i + 1] = bad ? 0 : x.data[i + 1] / 3;
        diff.data[i + 2] = bad ? 0 : x.data[i + 2] / 3;
        diff.data[i + 3] = 255;
      }
      og.putImageData(diff, 0, 0);
      const blob = await out.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (const v of bytes) bin += String.fromCharCode(v);
      return { share: n / (x.w * x.h), diff: btoa(bin) };
    },
    [png.toString('base64'), baseline.toString('base64'), CHANNEL],
  );
  if (r.size) assert.fail(`${name}: size changed from ${r.size[1]} to ${r.size[0]}`);
  if (r.share > SHARE) {
    await mkdir(DIFFS, { recursive: true });
    await writeFile(join(DIFFS, `${name}.png`), png);
    await writeFile(join(DIFFS, `${name}.diff.png`), Buffer.from(r.diff, 'base64'));
  }
  assert.ok(
    r.share <= SHARE,
    `${name}: ${(r.share * 100).toFixed(2)}% of pixels differ from the baseline (see e2e/visual/__diffs__/)`,
  );
}

/**
 * The book canvas as a PNG, read from the canvas itself (not the screen).
 * `shot.page` opens the book there (negative: from the end); `shot.turn` holds
 * a frame of a turn, the held corner dragged to a point given in page widths
 * and heights.
 */
const canvasPng = async (page, shot) =>
  Buffer.from(
    (
      await page.evaluate(({ at, turn }) => {
        const b = window.book();
        if (at != null) b.goTo(at < 0 ? b.pageCount + 1 + at : at);
        b.render();
        if (turn) b.debugFrame(turn.dir, { x: b.W, y: b.H }, { x: b.W * turn.x, y: b.H * turn.y });
        const url = b.canvas.toDataURL('image/png');
        if (turn) b.debugFrame();
        return url;
      }, shot)
    ).split(',')[1],
    'base64',
  );

const desktopShots = {
  'cover-closed': { at: 1 },
  'contents-spread': { at: 2 },
  'chapter-opener': { at: 6 },
  'plate-and-recipe': { at: 8 },
  'recipe-continued': { at: 10 },
  'colophon-and-back': { at: -3 },
  'turning-page': { at: 8, turn: { dir: 'forward', x: 0.25, y: 0.8 } },
  'turning-cover': { at: 1, turn: { dir: 'forward', x: 0.45, y: 1 } },
};

test('desktop: book spreads and turns', async (t) => {
  const d = await openBook({}, '/', { dist });
  try {
    assert.deepEqual(d.errors, []);
    for (const [name, setup] of Object.entries(desktopShots))
      await t.test(name, async (t) => compare(t, d.page, name, await canvasPng(d.page, setup)));
    await t.test('article', async (t) => {
      await d.page.evaluate(() => window.book().goTo(9));
      await d.page.waitForFunction(() => document.querySelector('main h1')?.textContent === "Shepherd's Pie");
      await d.page.evaluate(() => document.fonts.ready);
      await compare(t, d.page, 'article', await d.page.locator('main#text').screenshot({ animations: 'disabled' }));
    });
  } finally {
    await d.close();
  }
});

test('phone: single pages', async (t) => {
  const p = await openBook(phone(), '/recipes/hamburg-and-rice/', { dist });
  try {
    assert.deepEqual(p.errors, []);
    await t.test('phone-recipe', async (t) => compare(t, p.page, 'phone-recipe', await canvasPng(p.page, {})));
  } finally {
    await p.close();
  }
});
