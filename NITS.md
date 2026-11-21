# NITS — audit backlog

Full audit of the repository, its history and the deployed site, 2026-11-20.
Every finding is listed, from blockers to polish. Each item says what is
wrong, why it matters, and the fix. Tick items off as they land; remove the
file when it is empty.

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

- [ ] **[blocker] No licence.** Without one, the code is "all rights reserved"
  and nobody (including future contributors) may legally reuse it. Choose
  licences (see "Choosing licences" at the end of this section) and add
  `LICENSE` files.
- [ ] **[blocker] Code and content need separate licences.** The engine
  (crease.js, typesetter, viewer, build) and the family's recipes, writing and
  art are different kinds of work with different goals. Put content under
  `books/` with its own `LICENSE`, and say in the root README which licence
  covers which paths.
- [ ] **[blocker] No copyright holder named.** Licences need a holder line.
  Decide on a person's name or a collective ("The Internet Cookbook
  authors") with an `AUTHORS` file.
- [ ] **[high] Contributions from family need a licence grant.** Content
  added by family members is their copyright unless they agree to license it
  under the project's content licence. Add a `CONTRIBUTING.md` that states the
  terms, and require a sign-off on commits (Developer Certificate of Origin
  style `Signed-off-by:` line, enforced in CI) or a one-time written agreement.
- [ ] **[high] One aggregated third-party notice file.** Add
  `THIRD_PARTY_NOTICES.md` listing Pretext (and its embedded Chromium, WebKit,
  Unicode/ICU notices) and the three fonts, linking to the licence files. Serve
  it from the site and link it from the colophon page.
- [ ] **[high] Old commits with the magazine scans are still reachable on
  GitHub by ID** (`5ada2b6d4f61d2812446230f4904d9f903ef7e3d`,
  `fb62e2e6d2b5dd8a3f097b56885f451b45e757ce`). Ask GitHub Support to remove
  cached views and garbage-collect them.
- [ ] **[high] Local leftovers outside the repo** contain third-party material:
  `../tmp/internet-cookbook-backup-202611201444.bundle` (has the scans) and
  `../tmp/turnjs-reference/` (proprietary turn.js 5). Delete both.
- [ ] **[medium] AI-assisted assets.** The placeholder art and recipe text were
  produced with an AI assistant. In some jurisdictions purely machine-made
  output may not attract copyright, so it can't be exclusively owned. Fine for
  placeholders; the family's real art and recipes will replace them. Record
  provenance for every asset going forward (who made it, when, from what) in
  `books/<book>/CREDITS.md`.
- [ ] **[medium] Recipe and image provenance rules for contributors.** Recipes
  as lists of ingredients aren't copyrightable, but their written methods,
  stories and photos are. Contributors must only add their own writing and
  art, or material with a compatible licence, credited in `CREDITS.md`. No
  images from web searches, stock sites or scans of books and magazines.
- [ ] **[low] Name check.** Before printing or selling, check "Internet
  Cookbook" doesn't clash with an existing trademark in publishing.

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

- [ ] **[high] Memory: every page is rasterised up front.** crease.js draws
  each page into its own canvas at construction. An 8 × 10 in page at 640 ×
  800 CSS px on a 2× screen is 8 MB; a 100-page book is ~800 MB and will crash
  phones. Rasterise lazily (visible spread ± 1) and release the rest.
- [ ] **[high] Ingredient columns can't break across pages.** If the balanced
  ingredient list is taller than the remaining space it moves to a new page,
  but if it is taller than a whole page it overflows the margin.
  (`flowIngredients` in `public/typeset.js`.) Break columns across pages.
- [ ] **[high] Images taller than the text area overflow** instead of being
  scaled down or reported. (`placeImage`.)
- [ ] **[medium] Orphaned note page on the phone edition**: the handwritten
  tip lands alone on page 5. Needs keep-together rules (spec §3 preflight).
- [ ] **[medium] Inline Markdown parser is naive**: an unmatched `*` toggles
  italics for the rest of the line, `2 * 3` breaks, there is no escaping (`\*`),
  and links are unsupported. (`parseInline` in `public/recipe-md.js`.)
- [ ] **[medium] Home-made front matter parser** handles only `key: value`;
  nested values are silently mangled. Replace with YAML (spec).
- [ ] **[medium] Device pixel ratio is read once.** Moving the window to
  another display or zooming leaves pages blurry until reload.
- [ ] **[medium] Any resize rebuilds the whole book** (all pages re-typeset and
  re-rasterised) even when the edition and page size don't change.
- [ ] **[low] Baselines use a fixed 0.78 × size ratio** instead of the font's
  real ascent (`measureText().fontBoundingBoxAscent`).
- [ ] **[low] `loadImages` fails the whole book if one image fails**; report
  the bad image instead.

## 3. Accessibility and reader mode

- [ ] **[blocker] The book is invisible to assistive technology and reader
  modes**: canvas only, no text in the page. Fixed by the spec's article per
  address.
- [ ] **[high] No keyboard navigation**: arrow keys, Page Up/Down and Home/End
  should turn pages; the canvas needs focus handling.
- [ ] **[high] No `prefers-reduced-motion` support**: turns should cross-fade
  or jump instead of animating for readers who ask for less motion.
- [ ] **[medium] `touch-action: none` on the canvas blocks pinch-zoom** on
  phones; allow zoom gestures and only capture single-finger drags near page
  edges.
- [ ] **[medium] Canvas has no accessible name**; label it as the book view
  and point to the text version.

## 4. Architecture and code quality

- [ ] **[high] The test page assembles the book in a one-off script**
  (`public/index.html`). Replaced by `book.yaml` + build (spec).
- [ ] **[medium] `public/crease.js` is ~1,000 lines mixing geometry, input,
  animation and rendering.** Split into modules (geometry, input, renderer,
  shadows) behind the same public API.
- [ ] **[medium] Private members used from outside**: tests call
  `_turnSpec` / `_setPoint`. Add a small documented testing hook
  (e.g. `book.debugFrame(dir, start, point)`).
- [ ] **[medium] Design values are hard-coded in JavaScript**: templates,
  colours and board/endpaper design in `typeset.js`; shading constants in
  `crease.js`. Move design into `theme.yaml` (spec) and name the shading
  constants as options.
- [ ] **[medium] No type checking.** Add JSDoc types and `tsc --checkJs
  --noEmit` in CI; the geometry and layout data structures benefit most.
- [ ] **[medium] No lint or formatting.** Add ESLint (flat config) and
  Prettier, run in CI.
- [ ] **[low] Module-level state**: `fontsReady` and an unbounded `tintCache`
  in `typeset.js`. Scope them to a book instance; bound the cache.
- [ ] **[low] `window.book` is a global** exposed for tests; gate it behind a
  debug flag.
- [ ] **[low] `drawSpaced` measures every character every frame**; cache
  per-character advances for letter-spaced text.

## 5. Testing

- [ ] **[high] Browser tests run only in Chromium.** CI runs on Ubuntu, where
  Playwright's WebKit (Safari's engine) and Firefox both work: add them so
  Safari regressions are caught before readers see them.
- [ ] **[high] Browser tests depend on the demo content** (shepherd's pie). A
  content edit by family could fail a code test. Use a fixture book under
  `e2e/fixtures/`; check real content with content rules (preflight) instead.
- [ ] **[medium] No visual regression tests.** Add screenshot comparisons of
  key spreads and turn frames with a small tolerance.
- [ ] **[low] No coverage reporting** for the Node unit tests
  (`node --test --experimental-test-coverage`).

## 6. CI/CD and repository

- [ ] **[blocker] Deploy secrets missing**: `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`. The owner must add them.
- [ ] **[high] Publishing model**: preview URL per pull request, a "latest
  draft" preview for `main`, tagged versions to the canonical URL (in
  progress).
- [ ] **[high] `main` is unprotected.** Add a ruleset: pull requests required,
  CI must pass, no force pushes, no deletion.
- [ ] **[high] Actions are pinned by tag, not commit.** Pin
  `actions/checkout` and `actions/setup-node` to full commit SHAs (with the
  version in a comment).
- [ ] **[medium] No Dependabot** for npm and GitHub Actions updates.
- [ ] **[medium] Workflows aren't linted.** A one-line `run:` containing
  ` #` is silently cut short by YAML (caught by hand in review). Run
  `actionlint` in CI.
- [ ] **[medium] No `CODEOWNERS`**: code paths should require the
  maintainer's review; content paths shouldn't.
- [ ] **[medium] Naming**: the working branch is `crease` and `package.json`
  says `crease`, but the repo is the Internet Cookbook site. Rename the package
  to `internet-cookbook`, move crease.js to `lib/crease/` (publishable on its
  own later), delete the `crease` branch.
- [ ] **[medium] No README or CONTRIBUTING.** The README should cover what
  the project is, how to run, test, preview and release, and the licence split.
  CONTRIBUTING should be a step-by-step guide for family members adding a
  recipe or art through GitHub's website.
- [ ] **[low] `docs/superpowers/specs/`** is named after a tool; move design
  docs to `docs/design/`.
- [ ] **[low] npm install scripts are blocked for `esbuild` and `workerd`**
  (Wrangler dependencies); deploys work without them. Document this so nobody
  "fixes" it by allowing them.

## 7. Site and Cloudflare

- [ ] **[high] No `_headers` file**: add security headers
  (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy`) and long-lived caching for fonts and
  art (with content-hashed file names so updates still reach readers).
- [ ] **[medium] Preview URLs will be public** to anyone who has the link.
  If drafts must be private, put them behind Cloudflare Access.
- [ ] **[medium] Previews and the workers.dev address must not be indexed**
  by search engines; serve `X-Robots-Tag: noindex` on them.
- [ ] **[medium] No 404 page, favicon, page description or social preview
  image.**
- [ ] **[low] `www.internet-cookbook.com` doesn't resolve**; add it as a
  custom domain redirecting to the bare domain.

## 8. Performance

- [ ] **[medium] The flap's drop shadow uses `shadowBlur` every frame**, the
  most expensive remaining per-frame cost on phones; pre-render or approximate
  with gradients.
- [ ] **[medium] The table-shadow buffers are full-canvas offscreen canvases**
  (two × canvas size of memory); size them to the shadow's box.
- [ ] **[low] Readers download Pretext** (~45 KB compressed) and do layout on
  load; frozen layout (spec) removes both.

## 9. Content and assets

- [ ] **[high] Placeholder art and recipe** must be replaced by the family's
  own before publishing.
- [ ] **[medium] Asset guidelines for contributors**: preferred formats (SVG
  for line art; PNG/WebP at ≥ 300 ppi of print size for raster), colour
  (sRGB for screen, CMYK conversion at print time), file naming, and alt-text
  conventions.
- [ ] **[low] Fonts are Latin-only subsets**: characters outside Latin (é is
  fine; Greek, Cyrillic, CJK are not) fall back to another font. The preflight
  "missing character" rule (spec §3) must catch this.
