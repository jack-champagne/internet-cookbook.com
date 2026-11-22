# Internet Cookbook

A family cookbook you can page through on the web: recipes written in
Markdown, typeset like a printed book with [Pretext](https://github.com/chenglou/pretext),
and turned like real paper with **crease.js**, a canvas page-turning engine.

Live at **[internet-cookbook.com](https://internet-cookbook.com)**.

## Repository layout

| Path | What it is |
|---|---|
| `public/crease.js` | Page-turning engine (geometry, shading, input) |
| `public/typeset.js`, `public/recipe-md.js` | Recipe parser and typesetter |
| `public/index.html` | The book viewer |
| `public/recipes/` | Recipes (Markdown) — **content** |
| `public/art/` | Illustrations — **content** |
| `public/fonts/`, `public/vendor/` | Third-party fonts and libraries |
| `e2e/`, `*.test.js` | Browser and unit tests |
| `docs/` | Design documents |
| `NITS.md` | Audit backlog |

## Licensing

| What | Licence |
|---|---|
| Code (everything not listed below) | [Apache-2.0](LICENSE), © 2026 Jack Champagne |
| Content: `public/recipes/`, `public/art/` | [CC0 1.0](LICENSE-CONTENT) — public domain dedication |
| Third-party: `public/vendor/`, `public/fonts/` | Their own licences; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) |

## Running locally

Serve `public/` with any static server (ES modules don't load from `file://`):

```sh
npx wrangler dev        # or: python3 -m http.server -d public
```

## Tests

```sh
npm ci
npx playwright install chromium   # once
npm test                          # unit tests (Node)
npm run test:e2e                  # browser tests (BROWSER=firefox|webkit to switch)
```

## Previews and releases

- Every pull request gets a preview at `pr-<number>-internet-cookbook.<account>.workers.dev`,
  linked in a PR comment.
- Every merge to `main` updates the latest draft at `draft-internet-cookbook.<account>.workers.dev`.
- A version tag publishes the live site: bump `version` in `package.json` on
  `main`, then create a release (or push the tag) named `v<version>`.

Previews are not indexed by search engines and never change the live site.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
