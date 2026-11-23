# Book content model, frozen layout and reader mode — design

Date: 2026-11-20
Status: draft for review

## Goal

Replace the one-off test page (which hard-codes the recipe file, cover, plate,
blank pages, back cover and page size in a script) with a data-driven book:

- **Content** in Markdown files, **structure** in `book.yaml`, **design** in
  `theme.yaml`; one generic program renders any book from them.
- Layout is computed **at build time**, checked against layout rules
  (**preflight**), and published as frozen page data, so every reader's device
  shows the same pages, identical to what was checked and what would print.
- Every page of the book also exists as a **real HTML article** at its own
  address, so browser reader mode, screen readers, search engines, copy-paste
  and recipe apps all work. Turning pages updates the address and the article.

## Decisions carried forward

These were settled earlier and constrain this design:

| Area | Decision |
|---|---|
| Content | Markdown with a YAML header per file. |
| Layout style | Mostly flowing templates; per-entry overrides; hand-placed feature pages (cover, plates, openers). |
| Images | Anchored at a point in the text. Two modes: **in-text** (`place`, `width`, optional `wrap`) and **decorative** (`decor`, free `x`/`y`/`rotate`, may overlap text and spill into margins/bleed). In-text placement is rarer; decorative is common. |
| Image adjustment | First by editing attributes with live preview and layout guides; later by drag-and-resize in an editor that writes the same attributes back. |
| Type | Cormorant Garamond (display), Crimson Pro (text), Caveat (handwritten notes). Self-hosted, OFL licences shipped. |
| Units and size | Physical units (points). Standard 8 × 10 in cookbook trim; a 4.5 × 7.5 in phone edition so portrait phones stay readable. Trim is configuration, not code. |
| Architecture | Layout produces page descriptions; separate renderers draw them (canvas now, PDF possible later). |
| Line layout | Pretext 1.0 (`rich-inline`). Verified in Chromium and Firefox: line breaks identical to the browser, widths exact, mixed styles, variable line widths, page continuation, ~0.2 ms per full recipe. |
| Text drawing | Measure at 8× size and divide; draw text at device size (never under a scaled transform); chain runs on a line from their drawn ends plus Pretext's gap; never draw a line's trailing whitespace. |
| Book order | Explicit structure file (`book.yaml`), not folder order. |
| Format | YAML for `book.yaml`, `theme.yaml` and Markdown headers. |
| Publishing | Layout frozen at build time in headless Chromium (option A). |
| Reader mode | Every entry has its own address whose page is a real article; the book opens on top of it; turning pages updates address and article live. |

## 1. Files and formats

### Book folder

One folder per book. Every path inside a book file is relative to the file
that contains it.

```
books/internet-cookbook/
  book.yaml
  theme.yaml
  intro.md
  chapters/hearth-and-home/shepherds-pie.md
  art/…
  fonts/…
```

### `book.yaml` — structure and order only

```yaml
title: Internet Cookbook
subtitle: Recipes set by hand, on the web
theme: theme.yaml
cover: { art: art/rosemary.svg }

front:                      # pages before the first chapter, in order
  - toc                     # generated table of contents
  - page: intro.md          # prose page

chapters:
  - title: Hearth & Home
    slug: hearth-and-home   # optional; defaults to a slug of the title
    opener: { art: art/hearth.svg }       # optional chapter opening page
    entries:
      - recipe: chapters/hearth-and-home/shepherds-pie.md
        plate: { art: art/shepherds-pie.svg, caption: Fresh from the oven }
      - recipe: chapters/hearth-and-home/hamburg-steak.md
        start: right        # optional: begin on a right-hand page

back:
  - colophon                # generated credits page
```

- A recipe's chapter is where it is listed; recipes never name their chapter.
- `plate` places a full-page illustration on the left page facing the recipe,
  which then starts on the right page.
- `start: right | left | any` (default `any`) constrains where an entry begins.
  Recipes with a `plate` are implicitly `start: right`.

### Recipe file

```markdown
---
title: Shepherd's Pie
serves: 6
time: { prep: 30 min, cook: 1 hr }
intro: Slow-simmered lamb and garden vegetables under a golden crown of buttered mash.
slug: shepherds-pie        # optional; defaults to the file name
---
## Ingredients
- 1 kg floury potatoes, peeled and quartered

## Method
![A dish of shepherd's pie, steam rising](../../art/shepherds-pie.svg){place=right width=42% wrap}
1. **Make the mash.** Boil the potatoes …

> Rough up the mash with a fork — the ridges crisp beautifully.

![](../../art/rosemary.svg){decor x=48% y=4pt width=36% rotate=-9}
```

Header fields: `title` (required), `intro`, `serves`, `time.prep`,
`time.cook`, `time.total`, `slug`. Durations are written as `30 min`, `1 hr`,
`1 hr 15 min`.

Body syntax (unchanged from the prototype): `##` headings; `-` ingredient
list; `1.` steps with `**bold**` lead-ins and `*italic*`; `>` handwritten note;
`![description](path){attributes}` images anchored where they appear.

Image attributes:

| Mode | Attributes |
|---|---|
| In-text | `place=left\|right\|center`, `width=<% of text width or length>`, `wrap` (left/right only: following lines wrap around it), `gap=<length>` |
| Decorative | `decor`, `x=<% of text width or length>`, `y=<length>` (from the anchor), `width`, `rotate=<degrees>`, `opacity`, `layer=above\|below`, `overlap` (marks an intended overlap with text, silencing the preflight warning) |

Lengths take a unit (`pt`, `in`, `mm`); a bare number in Markdown attributes
means points. An in-text image **must** have a description (`![description]`);
a decorative image has none and is treated as ornament.

### Prose page (`page:` entries)

A Markdown file with `title` (optional) and a body of paragraphs, `##`
headings, lists, notes and images with the same attributes as recipes.

### `theme.yaml` — design only

```yaml
fonts:
  display: { family: Cormorant Garamond, files: [{ src: fonts/cormorant-garamond-normal-500.woff2, weight: 500 700 }, …] }
  text:    { family: Crimson Pro, files: […] }
  hand:    { family: Caveat, files: […] }
colors: { ink: "#2b2925", muted: "#8a7f6c", rule: "#d9d1c1", paper: "#fdfcf8" }

editions:
  book:
    trim: 8 x 10 in
    margins: { top: 58pt, outside: 56pt, bottom: 64pt, inside: 56pt }
    bleed: 0.125in
  phone:
    trim: 4.5 x 7.5 in
    margins: { top: 34pt, outside: 26pt, bottom: 40pt, inside: 26pt }
    overrides:                       # deep-merged over the base theme
      styles: { title: { size: 32pt, leading: 34pt }, body: { size: 11pt, leading: 15pt } }
      recipe: { ingredients: { columns: 1 } }

styles:                              # named text styles
  kicker:  { font: text, size: 8.5pt, leading: 12pt, color: muted, caps: true, tracking: 1.8pt }
  title:   { font: display, weight: 600, size: 40pt, leading: 42pt }
  lede:    { font: text, italic: true, size: 13.5pt, leading: 18.5pt }
  body:    { font: text, size: 12pt, leading: 16.5pt }
  note:    { font: hand, weight: 500, size: 17pt, leading: 18pt, color: muted }
  meta:    { … }                      # likewise for each remaining style
  heading: { … }
  step:    { … }
  stepNumber: { … }
  folio:   { … }

recipe:
  ingredients: { columns: 2, gap: 24pt, hang: 9pt }
  steps: { numberStyle: stepNumber, indent: 22pt }
  note: { indent: 38% }
```

- Required style names: `kicker`, `title`, `lede`, `meta`, `heading`, `body`,
  `step`, `stepNumber`, `note`, `folio`. Each takes `font` (a key of `fonts`),
  `size`, `leading`, and optionally `weight`, `italic`, `color`, `caps`,
  `tracking`, `spaceBefore`, `spaceAfter`.
- Every length carries a unit. Colours may be referenced by name.
- Margins are `inside`/`outside` and mirror on facing pages.
- Editions override only what differs from the base theme.

### Page types (this version)

| Type | Source | Notes |
|---|---|---|
| cover boards (front, back) | `book.yaml` `cover`; theme cover design | Rigid leaves: outside cover + endpaper on each. |
| endpaper | theme motif | Inside of each cover board. |
| title page | `book.yaml` `title`, `subtitle` | First contents page (page 3). |
| toc | generated | Chapters and recipes with page numbers, per edition. |
| chapter opener | `chapters[].opener` | Title + optional art. |
| prose | `page:` Markdown | Introductions, essays. |
| plate | `entries[].plate` | Full-page art + caption, faces its recipe. |
| recipe | `recipe:` Markdown | The flowing template from the prototype. |
| colophon | generated | Fonts, tools, edition. |

Anything else waits until a real book needs it.

## 2. Code organisation

### Pieces

| Piece | Job | Runs in |
|---|---|---|
| `content/` | YAML + Markdown → validated book data (with file/line for errors) | Node and browser |
| `typeset/` | book data + edition → page layouts, one module per page type (uses Pretext) | Browser (headless for builds) |
| `assemble/` | page order, spread rules, blanks, page numbers, page → entry/address map | Anywhere |
| `preflight/` | rule checks over layouts → report | Anywhere |
| `html/` | book data → article HTML + schema.org Recipe JSON-LD | Node |
| `render/` | page layout → canvas (a PDF renderer may be added later) | Browser |
| `viewer/` | crease.js + frozen layouts + live address/article updates | Browser |

Each piece has one job and a data interface: `content` produces plain book
data; `typeset` and `assemble` produce plain layout data; `render`, `html` and
`preflight` consume them. No piece reaches into another's internals.

As built: `src/content/` (content), `src/layout/` (typeset in `text.js`,
`flow.js`, `pages.js`; assemble in `book.js`), `src/preflight.js`,
`src/html.js`, `src/render.js` and `src/viewer.js`; `src/build/` runs layout
and preflight in the headless browser for `scripts/build.mjs`.

### Build (`npm run build`)

1. **Load and validate** (`content/`, Node). Errors: unreadable or invalid
   YAML, missing files, unknown page type or field, invalid unit, duplicate
   slug, in-text image without a description.
2. **Lay out** every edition in headless Chromium (Playwright), using the
   same `typeset/` code the browser uses.
3. **Assemble**: apply spread rules, number pages, map pages to entries.
   Book structure follows a physical book:
   - Each cover is a rigid board printed on both sides: page 1 is the outside
     front cover and page 2 its endpaper; the last two pages are the back
     endpaper and the outside back cover. Only these four pages are rigid.
   - Contents start on page 3, a right-hand page; the page count is even.
   - Plates go on the left facing their recipe; `start` constraints are met by
     inserting blank pages *inside* the contents, never by moving a cover.
   - Front and back covers share one cover design (board colour, frame);
     endpapers carry a quiet repeating motif from the theme.
4. **Preflight** (below). Errors stop the build; warnings are printed.
5. **Write the site** to `dist/`: one HTML article page per address, one
   frozen layout file per edition, assets (fonts, art, viewer code).
6. **Deploy** (`npm run deploy`): `wrangler deploy` of `dist/`, only after a
   passing build.

### Frozen layout files

`dist/layout/<edition>.json`:

```jsonc
{
  "title": "Internet Cookbook",
  "template": { "page": { "width": 576, "height": 720, "bleed": 9, "margin": { … } },  // points
                "styles": { "folio": { … } } },
  "fonts": [ { "family": "Crimson Pro", "src": "/fonts/…", "style": "normal", "weight": "400 600" } ],
  // first: first page of the entry (its plate, if any); start: its own first page
  "entries": { "/recipes/shepherds-pie/": { "first": 8, "start": 9, "last": 10, "title": "Shepherd's Pie" } },
  "pages": [
    { "n": 9, "side": "right", "entry": "/recipes/shepherds-pie/", "hard": false, "folio": 9,
      "box": { "x0": 56, "x1": 520, "top": 58, "bottom": 656 },
      "items": [
        { "type": "text", "x": 56, "y": 112.3, "text": "Shepherd's Pie", "font": "600 40px \"Cormorant Garamond\"", "color": "#2b2925" },
        { "type": "text", "text": "Boil the", "cont": true, "gap": 2.25, "…": "…" },
        { "type": "image", "src": "/art/shepherds-pie.svg", "x": 320, "y": 400, "w": 196, "h": 140, "alt": "A dish of shepherd's pie, steam rising" }
      ] }
  ]
}
```

Readers' browsers only draw this; they do no text layout. Text runs on a line
are chained from their drawn ends (see "Text drawing"), so tiny per-device
width differences never change spacing between runs; line breaks and page
breaks are fixed by the build.

### Reading (browser)

- Each address is a static HTML page containing the real article: `/` (cover
  and contents), `/<slug>/` for prose pages (slug from the file name, e.g.
  `/intro/`), `/chapters/<slug>/` for chapter openers, `/recipes/<slug>/` for
  recipes. Slugs must be unique within their kind; validation enforces it. Without JavaScript it is a
  complete, readable page.
- The viewer script picks an edition (phone for portrait screens narrower than
  760 px, book otherwise; the reader can override), loads that edition's frozen
  layout and fonts, and opens the book at the address's first page (its plate,
  in two-page view) or its own first page (one-page view). The canvas
  is labelled for assistive technology as the book view, with the text version
  in the article.
- **The article stays in the page, visible below the book** (not hidden):
  reader modes and screen readers ignore hidden content, so the text version is
  real, visible content.
- **On every page turn**: if the visible spread belongs to a different entry
  (in a two-page spread, the right-hand page decides, or the left-hand page
  when the right is blank), update the address with
  `history.replaceState` (Back leaves the book rather than stepping through
  pages), update the title, and swap the article for that entry's article
  (fetched from its address, cached, and prefetched for the next entry).

### Article HTML

```html
<article class="recipe">
  <header>
    <p class="kicker">Hearth &amp; Home</p>
    <h1>Shepherd's Pie</h1>
    <p class="intro">Slow-simmered lamb …</p>
    <ul class="meta"><li>Serves 6</li><li>Prep 30 min</li><li>Cook 1 hr</li></ul>
  </header>
  <figure><img src="/art/shepherds-pie.svg" alt="A dish of shepherd's pie, steam rising"></figure>
  <section><h2>Ingredients</h2><ul>…</ul></section>
  <section><h2>Method</h2><ol>…</ol></section>
  <aside class="note">Rough up the mash …</aside>
</article>
<script type="application/ld+json">{ "@type": "Recipe", "name": "Shepherd's Pie",
  "recipeYield": "6", "prepTime": "PT30M", "cookTime": "PT1H",
  "recipeIngredient": […], "recipeInstructions": [{ "@type": "HowToStep", "text": "…" }], "image": […] }</script>
```

Decorative images are omitted from articles. Durations are converted to
ISO 8601 for the structured data.

### Editing (`npm run dev`)

A local server that rebuilds the site on every save to the book, the code or
the static files (keeping one headless browser open, so a rebuild takes a
fraction of a second), reloads open pages, and shows the preflight report in a
panel on the page. Unlike `npm run build`, preflight errors don't stop it.
`?guides` on any address shows the margins and text area. The drag-and-resize
editor builds on this later.

## 3. Preflight rules

Run per edition over the assembled layouts. Overflow tolerance is 0.5 pt.

| Rule | Severity |
|---|---|
| Text beyond the text area (outside the margins) | error |
| Image larger than the text area (it is scaled down to fit) | warning |
| Image beyond the bleed | error |
| Font lacks a character used (would fall back to another font) | error |
| Plate not on the left facing its recipe; `start` constraint not met | error |
| Cover structure broken (covers not two-sided boards at both ends, contents not starting on page 3, odd page count) | error |
| Heading as the last line of a page (not kept with what follows) | error |
| Widow/orphan: a single line of a paragraph or step alone at a page top or bottom | warning |
| Entry ends with a page holding only a note or under three lines | warning |
| Decorative image overlapping text (unless `layer=below` or `overlap` is set) | warning |
| In-text image without a description | error (also caught in validation) |

The typesetter avoids widows and orphans itself: it moves one more line over
to join a lone last line, or moves a short paragraph whole, and keeps a note
with its step. Preflight reports any it couldn't avoid. Tightening spacing
within limits is future work.

## 4. Testing

- **Node unit tests**: `content` (parsing, units, validation errors with
  locations), `html` (article structure, JSON-LD, durations), `assemble`
  (spread rules, blanks, numbering, address map), each `preflight` rule.
- **Browser tests** (Playwright): `typeset` output per page type and edition;
  frozen layout round trip (render from JSON equals render from live layout);
  viewer — page turns update the address, title and article; the existing
  page-turn continuity and shadow checks; **reader-mode extraction** of each
  article checked with Mozilla Readability (dev dependency).
- The build itself is a test: a passing preflight is required to deploy.

## 5. Dependencies

| Dependency | Use | Licence | Ships to readers |
|---|---|---|---|
| Pretext 1.0 (vendored) | line layout | MIT | No (build and dev only) |
| js-yaml | YAML parsing | MIT | No (build and dev only) |
| Playwright | headless layout in builds, browser tests | Apache-2.0 | No |
| @mozilla/readability | reader-mode test | Apache-2.0 | No |
| crease.js | page turning | (project) | Yes |

Readers download only the viewer, crease.js, the frozen layout for their
edition, fonts and art.

## 6. Migration from the prototype (done in 0.3.0)

- `public/recipe-md.js` becomes `content/` (header parsing switches to YAML;
  body parsing kept).
- `public/typeset.js` splits into `typeset/` (templates move to `theme.yaml`;
  one module per page type), `assemble/` (cover/plate/blank/back sequencing
  now in the test script), and `render/` (`drawPage`).
- `public/index.html`'s assembly script is replaced by the viewer.
- The shepherd's pie moves to `books/internet-cookbook/chapters/hearth-and-home/`.
- The site is built to `dist/`; `wrangler.jsonc` points its assets at `dist/`.
- Static files (`_headers`, licences page, 404, icons) live in `site/static/`;
  `public/` is gone.

## Out of scope

The drag-and-resize editor, a PDF renderer, automatic widow fixing, real
artwork, and page types beyond the table above.
