# Book build — implementation plan

> Implements `docs/design/2026-11-20-book-content-model.md` (the spec), plus the
> remaining non-content items in `NITS.md`. Executed task by task; each task
> lands as one pull request with its tests, behind green CI.

**Goal:** a data-driven book (`books/<book>/book.yaml`, `theme.yaml`, Markdown)
built ahead of time into a static site: frozen page layouts per edition,
checked by preflight, plus a real HTML article at every address so reader
modes, screen readers and search engines get the text.

**Architecture:** content (pure, Node + browser) → layout (browser: Pretext;
headless Chromium during builds) → assembly and preflight (pure) → output
(frozen layout JSON, HTML articles) → viewer (draws frozen layouts with
crease.js; no text layout on readers' devices).

**Tech stack:** plain ES modules, Pretext 1.0, js-yaml 5, crease.js, Playwright
(build + tests), Node 22 test runner, Cloudflare Workers static assets.

## Global constraints

- Lengths in theme files carry a unit (`pt`, `in`, `mm`); bare numbers in
  Markdown image attributes are points. 1 in = 72 pt, 1 mm = 72/25.4 pt.
- Page structure: page 1 outside front cover, page 2 its endpaper; last two
  pages back endpaper and outside back cover; only those four are rigid;
  contents start on page 3 (a right-hand page); page count even.
- Plates sit on a left page facing their recipe, which starts on the right.
- Margins are `inside`/`outside`; right-hand (odd) pages have inside on the
  left.
- Readers' browsers never run Pretext or js-yaml; they load only the viewer,
  crease.js, the renderer, fonts, art and one edition's layout JSON.
- Every address serves a complete, readable HTML article without JavaScript.
- Text is measured at 8x and drawn at device size with run chaining and 1 pt
  line slack (existing typesetter rules).
- Site security: the existing Content-Security-Policy (`'self'` only) must
  keep passing; JSON-LD data blocks are allowed.
- All tests run in CI; browser tests in Chromium, Firefox and WebKit.

## File structure

```
books/internet-cookbook/          content (CC0) — the family edits only this
  book.yaml  theme.yaml  intro.md
  chapters/hearth-and-home/*.md
  art/*.svg   fonts/*.woff2 + OFL licences
src/                              engine (Apache-2.0)
  content/units.js                parse lengths/trims → points
  content/markdown.js             recipe/prose body parser (from recipe-md.js)
  content/load.js                 book.yaml + theme.yaml + Markdown → BookData
  content/theme.js                theme + edition → resolved Template
  layout/flow.js                  Flow + flowText + images (from typeset.js)
  layout/pages.js                 page types: recipe, prose, plate, opener,
                                  title, toc, colophon, board, endpaper, blank
  layout/book.js                  layoutBook(): sequencing + spread rules
  layout/fonts.js                 loadFonts(theme)
  preflight.js                    rules → { errors, warnings }
  html.js                         articles, JSON-LD, page shells
  render.js                       drawPage() (from typeset.js)
  viewer/viewer.js                frozen-layout viewer + address/article sync
  crease.js, crease/geometry.js   (moved from public/)
  vendor/pretext, vendor/js-yaml  (moved from public/vendor)
site/static/                      _headers, 404.html, favicon, social.png,
                                  licenses/index.html, legal/*, viewer.css
scripts/build.mjs                 content → layout (Chromium) → preflight → dist/
scripts/dev.mjs                   local live-layout server with reload
scripts/layout-page.html          page the build and dev load to run layout
dist/                             build output (git-ignored), deployed
test/                             unit tests (Node) + fixtures/book
e2e/                              browser tests (+ visual regression)
```

## Interfaces

- `parseLength(str | number, { percentOf? }) → number` (points);
  `parseTrim('8 x 10 in') → { width, height }`.
- `loadBook({ root, readText }) → Promise<BookData>`; `readText(path)` returns
  file text (fs in Node, fetch in the browser). Throws `BookError` with
  `file` and `line` when invalid.
  - `BookData = { title, subtitle, cover: { art }, theme: Theme, front: Entry[],
    chapters: Chapter[], back: Entry[], images: string[] }`
  - `Entry = { kind: 'toc'|'colophon'|'prose'|'recipe', slug, path?, doc?,
    plate?: { art, caption }, start: 'right'|'left'|'any', address }`
  - `Chapter = { title, slug, opener?: { art }, entries: Entry[], address }`
  - `doc` = `{ meta, blocks }` from `parseDocument(text)` (markdown.js).
  - Asset paths are site paths (`/art/x.svg`, `/fonts/x.woff2`).
- `resolveTemplate(theme, edition) → Template` (the existing typesetter
  template shape plus `page.margin.inside/outside`, `page.bleed`).
- `layoutBook(book, template, images) → { pages: Page[], entries: { [address]:
  { first, last } }, notes: Note[] }`; `Page = { items, floats, anchors,
  entry, side: 'left'|'right', folio, hard, box }`.
- `preflight(layout, { template, book, measure }) → { errors: Finding[],
  warnings: Finding[] }`; `Finding = { rule, page, message }`.
- `renderArticle(entry, book) → string` (HTML), `jsonLd(entry, book) → object`,
  `renderPage({ entry, book, edition, ... }) → string` (full HTML document).
- Frozen layout JSON per edition: `{ edition, trim, fonts, pages, entries }`,
  with images as `src` strings.
- `drawPage(ctx, page, template, { images, guides })` — images resolved by
  `src` from a `Map`.

## Tasks

1. **Content model** — `books/` folder (move recipes, art, fonts), `book.yaml`,
   `theme.yaml`, `intro.md`; `units.js`, `markdown.js` (YAML front matter;
   time grouping), `load.js` with validation (missing files, unknown keys,
   bad units, duplicate slugs, in-text image without description, assets
   outside the book), `theme.js`. Tests: units, loading the real book and a
   fixture book, each validation error with file and line.
2. **Layout engine** — split `typeset.js` into `layout/*` and `render.js`;
   templates come from `theme.js`; inside/outside margins by page side; new
   page types (toc, prose, opener, colophon); `layoutBook()` with spread rules
   and a two-pass TOC; text items record `blk`/`ln`/`of` for widow checks.
   Tests (browser harness page): structure rules, margins mirror, toc page
   numbers, existing typesetting checks on every entry and edition.
3. **Preflight** — the spec's rules with `measure` injected, plus the
   missing-character rule from the fonts' `unicodeRange`. Tests: each rule on
   synthetic layouts (Node), the real book has no errors (browser).
4. **Output and viewer** — `html.js` (articles, JSON-LD with ISO 8601
   durations, page shells with canonical/OG), `scripts/build.mjs` writing
   `dist/`, `viewer.js` (edition choice, frozen layouts, address/title/article
   sync on turns with `replaceState`, prefetch), `site/static/`, wrangler
   assets → `dist/`, workflows build before tests/deploy/previews,
   `scripts/dev.mjs`. Licences page at `/licenses/`. Tests: html unit tests;
   e2e against `dist/` (loads cleanly under CSP, deep link opens the right
   page, turning updates address and article, Readability extracts each
   recipe, no Pretext/js-yaml requested by readers).
5. **Visual regression** — screenshot comparisons of key frames per engine
   with committed baselines generated on CI's OS; a manual workflow that
   regenerates baselines as a pull request.
6. **Wrap-up** — name check findings, NITS/spec/README updates, release.

## Acceptance

- `npm run build` produces `dist/` with zero preflight errors for the real
  book; warnings are printed.
- The published site's pages are readable without JavaScript and in reader
  mode; the book opens at the address's page and keeps the address in sync.
- All NITS items except the family's content are closed.
