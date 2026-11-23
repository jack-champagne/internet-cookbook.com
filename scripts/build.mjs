// Build the published site into dist/:
//   - lay out every edition of the book in headless Chromium and run preflight
//     (errors stop the build; warnings are printed),
//   - freeze each layout as dist/layout/<edition>.json for the viewer,
//   - write a reader-mode HTML page at every address,
//   - copy the static files, the book's assets and the viewer's code.
//
//   usage: node scripts/build.mjs [--book books/internet-cookbook] [--site https://internet-cookbook.com] [--out dist]
import { cp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { loadBook } from '../src/content/load.js';
import { formatFindings } from '../src/preflight.js';
import { sitePages } from '../src/html.js';
import { serve, ORIGIN } from './lib/serve.mjs';

export const REPO = resolve(new URL('..', import.meta.url).pathname);
export const DEFAULTS = {
  book: join(REPO, 'books/internet-cookbook'),
  site: 'https://internet-cookbook.com',
  out: join(REPO, 'dist'),
};

/** Load and validate the book; content errors are reported as file:line. */
export async function readBook(dir = DEFAULTS.book) {
  return loadBook({ readText: (p) => readFile(join(dir, p), 'utf8'), exists: (p) => existsSync(join(dir, p)) });
}

/**
 * A headless browser page that lays out editions of the book in `dir`.
 * `layout(book)` reloads the layout code each time, so edits to src/ apply.
 */
export async function layoutBrowser(dir = DEFAULTS.book) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await serve(context, { repo: REPO, book: dir });
  const page = await context.newPage();
  return {
    async layout(/** @type {any} */ book) {
      const errors = [];
      const onError = (/** @type {Error} */ e) => errors.push(e);
      page.on('pageerror', onError);
      try {
        await page.goto(`${ORIGIN}/src/build/harness.html`);
        await page.waitForFunction(() => typeof window.layoutEdition === 'function');
        if (errors.length) throw errors[0];
        /** @type {Record<string, any>} */
        const out = {};
        for (const edition of book.editions)
          out[edition] = await page.evaluate(([b, e]) => window.layoutEdition(b, e), [book, edition]);
        return out;
      } finally {
        page.off('pageerror', onError);
      }
    },
    close: () => browser.close(),
  };
}

/** What the viewer needs to draw an edition: no typesetting bookkeeping. */
export function frozen(book, { tpl, layout }) {
  const titles = { '/': book.title };
  for (const e of [...book.front, ...book.back]) titles[e.address] = e.doc?.meta?.title ?? e.kind;
  for (const c of book.chapters) {
    titles[c.address] = c.title;
    for (const e of c.entries) titles[e.address] = e.doc.meta.title;
  }
  return {
    title: book.title,
    template: { page: tpl.page, styles: { folio: tpl.styles.folio } },
    fonts: tpl.fonts,
    pages: layout.pages.map(({ n, side, hard, folio, entry, box, items }) => ({
      n,
      side,
      hard,
      folio,
      entry,
      box,
      items: items.map(({ blk, ln, of, role, ...it }) => it),
    })),
    entries: Object.fromEntries(Object.entries(layout.entries).map(([a, e]) => [a, { ...e, title: titles[a] ?? a }])),
  };
}

/** The theme's fonts for the HTML article, so it reads in the book's type. */
export function fontCss(book, tpl) {
  const faces = tpl.fonts.map(
    (f) =>
      `@font-face { font-family: ${JSON.stringify(f.family)}; src: url(${f.src}) format('woff2'); font-style: ${f.style}; font-weight: ${f.weight}; font-display: swap; }`,
  );
  const family = (key) => book.theme.fonts?.[key]?.family;
  const vars = [
    family('text') && `--text-font: ${JSON.stringify(family('text'))};`,
    family('display') && `--display-font: ${JSON.stringify(family('display'))};`,
  ].filter(Boolean);
  return `${faces.join('\n')}\n:root { ${vars.join(' ')} }\n\n`;
}

/**
 * Build the site. Returns each edition's preflight report; when any has
 * errors, nothing is written unless `force` (the dev server shows them).
 * @param {{ book?: string, site?: string, out?: string, force?: boolean, browser?: Awaited<ReturnType<typeof layoutBrowser>> }} [o]
 */
export async function build({
  book: dir = DEFAULTS.book,
  site = DEFAULTS.site,
  out = DEFAULTS.out,
  force = false,
  browser,
} = {}) {
  const book = await readBook(dir);
  const own = browser ? null : await layoutBrowser(dir);
  let editions;
  try {
    editions = await (browser ?? own).layout(book);
  } finally {
    await own?.close();
  }
  const reports = Object.fromEntries(Object.entries(editions).map(([n, r]) => [n, r.report]));
  const failed = Object.values(reports).some((r) => r.errors.length);
  if (failed && !force) return { book, editions, reports, failed, written: false };

  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'layout'), { recursive: true });
  for (const [name, result] of Object.entries(editions))
    await writeFile(join(out, 'layout', `${name}.json`), JSON.stringify(frozen(book, result)));

  for (const { address, html } of sitePages(book, site)) {
    const file = join(out, address, 'index.html');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, html);
  }

  await cp(join(REPO, 'site/static'), out, { recursive: true });
  const css = join(out, 'viewer.css');
  await writeFile(css, fontCss(book, Object.values(editions)[0].tpl) + (await readFile(css, 'utf8')));
  // The book's art and fonts, with each font folder's licence files.
  const folders = new Set();
  for (const path of book.assets) {
    await mkdir(dirname(join(out, path)), { recursive: true });
    await cp(join(dir, path), join(out, path));
    folders.add(dirname(path));
  }
  for (const folder of folders)
    for (const f of await readdir(join(dir, folder)))
      if (/^(OFL|LICENSE).*\.txt$/i.test(f)) await cp(join(dir, folder, f), join(out, folder, f));
  // The viewer and what it imports. Pretext and js-yaml are build tools only.
  for (const f of ['viewer.js', 'render.js', 'crease.js', 'crease/geometry.js']) {
    await mkdir(dirname(join(out, f)), { recursive: true });
    await cp(join(REPO, 'src', f), join(out, f));
  }
  await mkdir(join(out, 'legal'), { recursive: true });
  for (const f of ['LICENSE', 'LICENSE-CONTENT', 'NOTICE']) await cp(join(REPO, f), join(out, 'legal', `${f}.txt`));
  return { book, editions, reports, failed, written: true };
}

async function main() {
  const { values } = parseArgs({
    options: {
      book: { type: 'string', default: DEFAULTS.book },
      site: { type: 'string', default: DEFAULTS.site },
      out: { type: 'string', default: DEFAULTS.out },
    },
  });
  const started = Date.now();
  const out = resolve(values.out);
  const { editions, reports, failed } = await build({ book: resolve(values.book), site: values.site, out });
  for (const [name, report] of Object.entries(reports)) {
    const text = formatFindings(report, name);
    if (text) console.log(text);
  }
  if (failed) {
    console.error('\nPreflight found errors; nothing was published.');
    process.exit(1);
  }
  const pages = Object.entries(editions)
    .map(([n, r]) => `${n} ${r.layout.pages.length} pages`)
    .join(', ');
  console.log(`Built ${out} (${pages}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
