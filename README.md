# Internet Cookbook

A family cookbook you can page through on the web: recipes written in
Markdown, typeset like a printed book with [Pretext](https://github.com/chenglou/pretext),
and turned like real paper with **crease.js**, a canvas page-turning engine.

Live at **[internet-cookbook.com](https://internet-cookbook.com)**.

## Repository layout

| Path | What it is |
|---|---|
| `books/internet-cookbook/` | The book — **content**: `book.yaml` (what's in it, in order), `theme.yaml` (its design), recipes and pages in Markdown, `art/`, `fonts/` |
| `src/crease.js`, `src/crease/` | Page-turning engine (`crease/geometry.js`: the fold geometry) |
| `src/content/` | Reads and validates the book: YAML, Markdown, units, theme |
| `src/layout/`, `src/render.js` | Typesetter (with Pretext) and page drawing |
| `src/preflight.js` | Layout checks run before publishing |
| `src/html.js` | The reader-mode article and recipe data at every address |
| `src/viewer.js` | The book viewer readers load |
| `src/vendor/` | Third-party libraries (Pretext, js-yaml), used only when building |
| `site/static/` | Static site files: headers, licences page, 404, styles |
| `scripts/` | `build.mjs`, `dev.mjs` and release helpers |
| `test/`, `e2e/` | Unit tests (Node) and browser tests |
| `docs/design/` | Design documents |
| `NITS.md` | Audit backlog |

## Licensing

| What | Licence |
|---|---|
| Code (everything not listed below) | [Apache-2.0](LICENSE), © 2026 Jack Champagne |
| Content: `books/*/` (recipes, pages, `art/`) | [CC BY-NC 4.0](LICENSE-CONTENT), © their contributors (see [CREDITS.md](CREDITS.md)); before 2026-11-22, CC0 1.0 |
| Third-party: `src/vendor/`, `books/*/fonts/` | Their own licences; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) |

## How it works

`npm run build` reads the book, typesets every edition (an 8 × 10 in book and a
4.5 × 7.5 in phone edition) in headless Chromium, checks the result against the
book's layout rules (preflight), and writes the site to `dist/`:

- `layout/<edition>.json` — every page, frozen: where each line and picture goes.
- An HTML page at every address (`/recipes/shepherds-pie/`, `/chapters/…/`), with
  the recipe as a plain article that reader mode, search engines and screen
  readers use, and schema.org Recipe data.
- The viewer, which draws the frozen pages with crease.js and keeps the address
  and article in step as pages turn.

Preflight errors (text past a margin, a recipe starting on the wrong side, a
character the fonts can't draw, a picture with no description…) stop the build;
warnings are printed.

## Writing and previewing

```sh
npm ci
npx playwright install chromium   # once
npm run dev                       # http://localhost:8000, rebuilds as you edit
```

`npm run dev` reloads the page on every change and shows preflight findings in a
panel. Add `?guides` to an address to see the margins and text area.
`npm run build` makes the site exactly as it will be published.

## Tests

```sh
npm test                          # unit tests (Node)
npm run build && npm run test:e2e # browser tests against dist/ (BROWSER=firefox|webkit to switch)
```

## Code quality

```sh
npm run lint            # ESLint, Prettier check and TypeScript (JSDoc) type check
npm run format          # apply Prettier formatting
npm run test:coverage   # unit tests with a coverage report
```

The modules listed in `tsconfig.json`'s `files` are type-checked in strict mode
from their JSDoc; extend the list as more modules gain types.

### Note on npm install scripts

npm blocks the install scripts of `esbuild` and `workerd` (dependencies of
Wrangler). Static-asset deploys don't need them, and deploys and CI work with
them blocked. Leave them blocked rather than allowing them.

## Previews and releases

- Every pull request gets a preview at `pr-<number>-internet-cookbook.<account>.workers.dev`,
  linked in a PR comment.
- Every merge to `main` updates the latest draft at `draft-internet-cookbook.<account>.workers.dev`.
- A version tag publishes the live site: bump `version` in `package.json` on
  `main`, then create a release (or push the tag) named `v<version>`.

Previews are not indexed by search engines and never change the live site.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
