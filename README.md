# Internet Cookbook

A family cookbook you can page through on the web: recipes written in
Markdown, typeset like a printed book with [Pretext](https://github.com/chenglou/pretext),
and turned like real paper with **crease.js**, a canvas page-turning engine.

Live at **[internet-cookbook.com](https://internet-cookbook.com)**.

## Repository layout

| Path | What it is |
|---|---|
| `public/crease.js`, `public/crease/` | Page-turning engine (`crease/geometry.js`: the fold geometry) |
| `public/typeset.js`, `public/recipe-md.js` | Recipe parser and typesetter |
| `public/index.html` | The book viewer |
| `public/recipes/` | Recipes (Markdown) — **content** |
| `public/art/` | Illustrations — **content** |
| `public/fonts/`, `public/vendor/` | Third-party fonts and libraries |
| `e2e/`, `*.test.js` | Browser and unit tests |
| `docs/design/` | Design documents |
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

## Code quality

```sh
npm run lint            # ESLint, Prettier check and TypeScript (JSDoc) type check
npm run format          # apply Prettier formatting
npm run test:coverage   # unit tests with a coverage report
```

`public/crease/geometry.js` and `public/recipe-md.js` are type-checked in
strict mode from their JSDoc; extend `tsconfig.json`'s `files` as more modules
gain types.

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
