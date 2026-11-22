# NITS — audit backlog

Full audit of the repository, its history and the deployed site, 2026-11-20.
Every finding is listed, from blockers to polish. Each item says what is
wrong, why it matters, and the fix, followed by its outcome (**→ …**).

**Status (2026-11-21):** 52 of 60 items done or decided. One blocker remains:
a text version of the book for reader modes and screen readers, which is the
first deliverable of the design spec. The other open items are the spec's work
(book.yaml build, frozen layout, theme.yaml, preflight), visual-regression
tests, the family's own content, and a name check before printing.

Severity: **[blocker]** must fix before the book is public · **[high]** fix
soon · **[medium]** fix when touching the area · **[low]** polish.

---

## 1. Intellectual property and licensing

### Inventory — everything shipped, and its status

| Component | Origin | Licence | Obligations | Status |
|---|---|---|---|---|
| `public/crease.js`, `public/typeset.js`, `public/recipe-md.js`, `public/index.html`, tests, workflows, docs | Written for this project | **None yet** | — | ⚠ unlicensed |
| `public/vendor/pretext/` (Pretext 1.0.0) | npm `@chenglou/pretext` | MIT, plus notices for code ported from Chromium (BSD-3-Clause), WebKit (BSD-2-Clause) and Unicode/ICU data (Unicode-3.0, ICU licence) | Keep `LICENSE` with the files (done) | ✅ |
| Fonts: Cormorant Garamond, Crimson Pro, Caveat (Latin subsets, woff2) | Google Fonts | SIL OFL 1.1, no Reserved Font Names, so subsetting is allowed | Ship each `OFL-*.txt` with the fonts (done); never sell the fonts by themselves | ✅ |
| `public/art/*.svg` | Drawn in code for this project (placeholders) | **None yet** | — | ⚠ unlicensed; see AI note below |
| `public/recipes/shepherds-pie.md` | Written for this project (placeholder) | **None yet** | — | ⚠ unlicensed |
| Original `bezier.js` / `bezier.html` (history only) | The repository owner | — | — | ✅ |
| Dev tools (Playwright, Wrangler, npm deps) | npm | Apache-2.0 / MIT / others | None: not shipped to readers | ✅ |

History check: every path ever committed is listed above; no third-party
code or images remain in any branch. No references to turn.js (studied for
research only, never copied) exist in the tree or history.

### Findings

- [x] **[blocker] No licence.** Without one, the code is "all rights reserved"
  and nobody (including future contributors) may legally reuse it. Choose
  licences (see "Choosing licences" at the end of this section) and add
  `LICENSE` files. **→ done in #7 (Apache-2.0 code, CC0 content).**
- [x] **[blocker] Code and content need separate licences.** The engine
  (crease.js, typesetter, viewer, build) and the family's recipes, writing and
  art are different kinds of work with different goals. Put content under
  `books/` with its own `LICENSE`, and say in the root README which licence
  covers which paths. **→ done in #7.**
- [x] **[blocker] No copyright holder named.** Licences need a holder line.
  Decide on a person's name or a collective ("The Internet Cookbook
  authors") with an `AUTHORS` file. **→ done in #7 (Jack Champagne).**
- [x] **[high] Contributions from family need a licence grant.** Content
  added by family members is their copyright unless they agree to license it
  under the project's content licence. Add a `CONTRIBUTING.md` that states the
  terms, and require a sign-off on commits (Developer Certificate of Origin
  style `Signed-off-by:` line, enforced in CI) or a one-time written agreement. **→ done in #7 (CONTRIBUTING: inbound = outbound).**
- [x] **[high] One aggregated third-party notice file.** Add
  `THIRD_PARTY_NOTICES.md` listing Pretext (and its embedded Chromium, WebKit,
  Unicode/ICU notices) and the three fonts, linking to the licence files. Serve
  it from the site and link it from the colophon page. **→ done in #7; served at /licenses.html since #8.**
- [x] **[high] Old commits with the magazine scans are still reachable on
  GitHub by ID** (`5ada2b6d4f61d2812446230f4904d9f903ef7e3d`,
  `fb62e2e6d2b5dd8a3f097b56885f451b45e757ce`). Ask GitHub Support to remove
  cached views and garbage-collect them. **→ decided: accepted risk; the IDs aren't linked anywhere and nobody else has them (owner, 2026-11-21).**
- [x] **[high] Local leftovers outside the repo** contain third-party material:
  `../tmp/internet-cookbook-backup-202611201444.bundle` (has the scans) and
  `../tmp/turnjs-reference/` (proprietary turn.js 5). Delete both. **→ done: deleted 2026-11-21.**
- [x] **[medium] AI-assisted assets.** The placeholder art and recipe text were
  produced with an AI assistant. In some jurisdictions purely machine-made
  output may not attract copyright, so it can't be exclusively owned. Fine for
  placeholders; the family's real art and recipes will replace them. Record
  provenance for every asset going forward (who made it, when, from what) in
  `books/<book>/CREDITS.md`. **→ done in #9 (CREDITS.md).**
- [x] **[medium] Recipe and image provenance rules for contributors.** Recipes
  as lists of ingredients aren't copyrightable, but their written methods,
  stories and photos are. Contributors must only add their own writing and
  art, or material with a compatible licence, credited in `CREDITS.md`. No
  images from web searches, stock sites or scans of books and magazines. **→ done in #7 (CONTRIBUTING).**
- [ ] **[low] Name check.** Before printing or selling, check "Internet
  Cookbook" doesn't clash with an existing trademark in publishing. **→ owner, before printing or selling.**

### Choosing licences (decision needed)

Code — recommended: **Apache-2.0** (permissive like MIT, plus an explicit
patent grant and a NOTICE mechanism that suits the bundled third-party
notices). MIT is the simpler alternative. Both are compatible with everything
we ship.

Content — options: **CC BY 4.0** (anyone may reuse with credit),
**CC BY-NC 4.0** (reuse with credit, not commercially), **CC BY-NC-ND 4.0**
(share unchanged, non-commercially), or **all rights reserved** (no reuse
without permission). For a family cookbook, CC BY-NC 4.0 keeps the recipes
shareable while preventing someone selling them.

---

## 2. Correctness

- [x] **[high] Memory: every page is rasterised up front.** crease.js draws
  each page into its own canvas at construction. An 8 × 10 in page at 640 ×
  800 CSS px on a 2× screen is 8 MB; a 100-page book is ~800 MB and will crash
  phones. Rasterise lazily (visible spread ± 1) and release the rest. **→ done in #5 (pages rasterise on demand, released beyond 4 pages).**
- [x] **[high] Ingredient columns can't break across pages.** If the balanced
  ingredient list is taller than the remaining space it moves to a new page,
  but if it is taller than a whole page it overflows the margin.
  (`flowIngredients` in `public/typeset.js`.) Break columns across pages. **→ done in #6.**
- [x] **[high] Images taller than the text area overflow** instead of being
  scaled down or reported. (`placeImage`.) **→ done in #6.**
- [x] **[medium] Orphaned note page on the phone edition**: the handwritten
  tip lands alone on page 5. Needs keep-together rules (spec §3 preflight). **→ done in #9 (a note pulls its step to the next page).**
- [x] **[medium] Inline Markdown parser is naive**: an unmatched `*` toggles
  italics for the rest of the line, `2 * 3` breaks, there is no escaping (`\*`),
  and links are unsupported. (`parseInline` in `public/recipe-md.js`.) **→ done in #6.**
- [x] **[medium] Home-made front matter parser** handles only `key: value`;
  nested values are silently mangled. Replace with YAML (spec). **→ done in #9 (js-yaml).**
- [x] **[medium] Device pixel ratio is read once.** Moving the window to
  another display or zooming leaves pages blurry until reload. **→ done in #5.**
- [x] **[medium] Any resize rebuilds the whole book** (all pages re-typeset and
  re-rasterised) even when the edition and page size don't change. **→ done in #5.**
- [x] **[low] Baselines use a fixed 0.78 × size ratio** instead of the font's
  real ascent (`measureText().fontBoundingBoxAscent`). **→ done in #6.**
- [x] **[low] `loadImages` fails the whole book if one image fails**; report
  the bad image instead. **→ done in #6.**

## 3. Accessibility and reader mode

- [ ] **[blocker] The book is invisible to assistive technology and reader
  modes**: canvas only, no text in the page. Fixed by the spec's article per
  address. **→ keyboard, accessible name and reduced motion done in #5; the full text version is the spec's reader-mode articles.**
- [x] **[high] No keyboard navigation**: arrow keys, Page Up/Down and Home/End
  should turn pages; the canvas needs focus handling. **→ done in #5.**
- [x] **[high] No `prefers-reduced-motion` support**: turns should cross-fade
  or jump instead of animating for readers who ask for less motion. **→ done in #5.**
- [x] **[medium] `touch-action: none` on the canvas blocks pinch-zoom** on
  phones; allow zoom gestures and only capture single-finger drags near page
  edges. **→ done in #5.**
- [x] **[medium] Canvas has no accessible name**; label it as the book view
  and point to the text version. **→ done in #5.**

## 4. Architecture and code quality

- [ ] **[high] The test page assembles the book in a one-off script**
  (`public/index.html`). Replaced by `book.yaml` + build (spec). **→ planned: replaced by book.yaml and the build (design spec).**
- [x] **[medium] `public/crease.js` is ~1,000 lines mixing geometry, input,
  animation and rendering.** Split into modules (geometry, input, renderer,
  shadows) behind the same public API. **→ done in #10: geometry extracted to crease/geometry.js; input and rendering stay in one class for now.**
- [x] **[medium] Private members used from outside**: tests call
  `_turnSpec` / `_setPoint`. Add a small documented testing hook
  (e.g. `book.debugFrame(dir, start, point)`). **→ done in #5 (debugFrame, turnFor).**
- [ ] **[medium] Design values are hard-coded in JavaScript**: templates,
  colours and board/endpaper design in `typeset.js`; shading constants in
  `crease.js`. Move design into `theme.yaml` (spec) and name the shading
  constants as options. **→ shading strengths are a `shadows` option since #10; templates and colours move to theme.yaml with the design spec.**
- [x] **[medium] No type checking.** Add JSDoc types and `tsc --checkJs
  --noEmit` in CI; the geometry and layout data structures benefit most. **→ done in #11: strict JSDoc checking of crease/geometry.js and recipe-md.js (extend tsconfig.json as modules gain types).**
- [x] **[medium] No lint or formatting.** Add ESLint (flat config) and
  Prettier, run in CI. **→ done in #11 (ESLint + Prettier, `npm run lint`, CI job).**
- [x] **[low] Module-level state**: `fontsReady` and an unbounded `tintCache`
  in `typeset.js`. Scope them to a book instance; bound the cache. **→ tintCache bounded in #6; fonts load once per page by design.**
- [x] **[low] `window.book` is a global** exposed for tests; gate it behind a
  debug flag. **→ done in #5 (tests and ?debug only).**
- [x] **[low] `drawSpaced` measures every character every frame**; cache
  per-character advances for letter-spaced text. **→ decided: not needed; pages now rasterise once (#5), so this no longer runs per frame.**

## 5. Testing

- [x] **[high] Browser tests run only in Chromium.** CI runs on Ubuntu, where
  Playwright's WebKit (Safari's engine) and Firefox both work: add them so
  Safari regressions are caught before readers see them. **→ done in #4 (Firefox and WebKit in CI).**
- [x] **[high] Browser tests depend on the demo content** (shepherd's pie). A
  content edit by family could fail a code test. Use a fixture book under
  `e2e/fixtures/`; check real content with content rules (preflight) instead. **→ done in #6 and #8: edge cases use fixtures (e2e/fixtures); the all-recipes check stays as a content rule.**
- [ ] **[medium] No visual regression tests.** Add screenshot comparisons of
  key spreads and turn frames with a small tolerance. **→ planned: baselines must be generated on the CI runner's OS per engine; a reference-frame pixel comparison is used ad hoc.**
- [x] **[low] No coverage reporting** for the Node unit tests
  (`node --test --experimental-test-coverage`). **→ done in #11 (`npm run test:coverage`).**

## 6. CI/CD and repository

- [x] **[blocker] Deploy secrets missing**: `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`. The owner must add them. **→ done: owner added both secrets (2026-11-21).**
- [x] **[high] Publishing model**: preview URL per pull request, a "latest
  draft" preview for `main`, tagged versions to the canonical URL (in
  progress). **→ done in #1.**
- [x] **[high] `main` is unprotected.** Add a ruleset: pull requests required,
  CI must pass, no force pushes, no deletion. **→ done: "Protect main" ruleset (PRs, required checks, code-owner review, no force push or deletion).**
- [x] **[high] Actions are pinned by tag, not commit.** Pin
  `actions/checkout` and `actions/setup-node` to full commit SHAs (with the
  version in a comment). **→ done in #4.**
- [x] **[medium] No Dependabot** for npm and GitHub Actions updates. **→ done in #4.**
- [x] **[medium] Workflows aren't linted.** A one-line `run:` containing
  ` #` is silently cut short by YAML (caught by hand in review). Run
  `actionlint` in CI. **→ done in #4 (actionlint).**
- [x] **[medium] No `CODEOWNERS`**: code paths should require the
  maintainer's review; content paths shouldn't. **→ done in #4.**
- [x] **[medium] Naming**: the working branch is `crease` and `package.json`
  says `crease`, but the repo is the Internet Cookbook site. Rename the package
  to `internet-cookbook`, move crease.js to `lib/crease/` (publishable on its
  own later), delete the `crease` branch. **→ done: branches cleaned up; package renamed in #11; crease.js modules live under public/crease/.**
- [x] **[medium] No README or CONTRIBUTING.** The README should cover what
  the project is, how to run, test, preview and release, and the licence split.
  CONTRIBUTING should be a step-by-step guide for family members adding a
  recipe or art through GitHub's website. **→ done in #7.**
- [x] **[low] `docs/superpowers/specs/`** is named after a tool; move design
  docs to `docs/design/`. **→ done in #11 (docs/design/).**
- [x] **[low] npm install scripts are blocked for `esbuild` and `workerd`**
  (Wrangler dependencies); deploys work without them. Document this so nobody
  "fixes" it by allowing them. **→ done in #11 (README note).**

## 7. Site and Cloudflare

- [x] **[high] No `_headers` file**: add security headers
  (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy`) and long-lived caching for fonts and
  art (with content-hashed file names so updates still reach readers). **→ done in #8.**
- [x] **[medium] Preview URLs will be public** to anyone who has the link.
  If drafts must be private, put them behind Cloudflare Access. **→ decided: acceptable for this demo site (owner); add Cloudflare Access if drafts become private.**
- [x] **[medium] Previews and the workers.dev address must not be indexed**
  by search engines; serve `X-Robots-Tag: noindex` on them. **→ previews noindex since #1; pages declare the canonical domain since #8.**
- [x] **[medium] No 404 page, favicon, page description or social preview
  image.** **→ done in #8.**
- [x] **[low] `www.internet-cookbook.com` doesn't resolve**; add it as a
  custom domain redirecting to the bare domain. **→ done in #8; takes effect on the next release.**

## 8. Performance

- [x] **[medium] The flap's drop shadow uses `shadowBlur` every frame**, the
  most expensive remaining per-frame cost on phones; pre-render or approximate
  with gradients. **→ investigated in #10: no measurable gain once the resting shadow is cached; kept as is.**
- [x] **[medium] The table-shadow buffers are full-canvas offscreen canvases**
  (two × canvas size of memory); size them to the shadow's box. **→ done in #10.**
- [ ] **[low] Readers download Pretext** (~45 KB compressed) and do layout on
  load; frozen layout (spec) removes both. **→ planned: frozen layout (design spec) removes Pretext from readers.**

## 9. Content and assets

- [ ] **[high] Placeholder art and recipe** must be replaced by the family's
  own before publishing. **→ family: replace the placeholders listed in CREDITS.md.**
- [x] **[medium] Asset guidelines for contributors**: preferred formats (SVG
  for line art; PNG/WebP at ≥ 300 ppi of print size for raster), colour
  (sRGB for screen, CMYK conversion at print time), file naming, and alt-text
  conventions. **→ done in #7, colour profile added in #11 (CONTRIBUTING).**
- [ ] **[low] Fonts are Latin-only subsets**: characters outside Latin (é is
  fine; Greek, Cyrillic, CJK are not) fall back to another font. The preflight
  "missing character" rule (spec §3) must catch this. **→ planned: the preflight "missing character" rule (design spec).**
