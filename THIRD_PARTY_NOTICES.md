# Third-party notices

The Internet Cookbook includes the following third-party works. Each keeps its
own licence, whose full text ships alongside it.

Pretext and js-yaml are build tools: they typeset the book and read its files
when the site is built, and are not part of the published site. The fonts are
published with the site, each with its licence.

## Pretext 1.0.0 — text measurement and line layout

- Location: `src/vendor/pretext/`
- Licence: MIT, © 2026 Pretext contributors
- Full text: [`src/vendor/pretext/LICENSE`](src/vendor/pretext/LICENSE)

Pretext includes code and data ported from other projects, whose notices are
reproduced in the same `LICENSE` file:

- **Chromium** (line break tables, Han kerning, script classes): BSD-3-Clause,
  © The Chromium Authors.
- **Chromium / WebKit shared files**: BSD-3-Clause, © Google Inc., BlackBerry
  Limited, Apple Inc.
- **WebKit** (line break pair table, break opportunity scan): BSD-2-Clause,
  © Apple Inc., Google Inc.
- **Unicode / ICU / ICU4X data**: Unicode License V3 and the ICU License,
  © Unicode, Inc. and others; © International Business Machines Corporation
  and others.

## js-yaml 5.5.0 — YAML parsing for recipe headers

- Location: `src/vendor/js-yaml/`
- Licence: MIT, © 2011-2015 Vitaly Puzrin
- Full text: [`src/vendor/js-yaml/LICENSE`](src/vendor/js-yaml/LICENSE)

## Fonts

Served as Latin subsets in WOFF2. All are licensed under the SIL Open Font
License 1.1 with no Reserved Font Names; each licence ships next to the font.

| Font | Copyright | Licence file |
|---|---|---|
| Cormorant Garamond | © 2015 the Cormorant Project Authors | [`books/internet-cookbook/fonts/OFL-cormorantgaramond.txt`](books/internet-cookbook/fonts/OFL-cormorantgaramond.txt) |
| Crimson Pro | © 2018 The Crimson Pro Project Authors | [`books/internet-cookbook/fonts/OFL-crimsonpro.txt`](books/internet-cookbook/fonts/OFL-crimsonpro.txt) |
| Caveat | © 2014 The Caveat Project Authors | [`books/internet-cookbook/fonts/OFL-caveat.txt`](books/internet-cookbook/fonts/OFL-caveat.txt) |

The fonts may be used, bundled and redistributed with this project; they may
not be sold on their own.

## Development tools

Playwright (Apache-2.0), Wrangler (MIT OR Apache-2.0) and their dependencies
are used only to build, test and deploy. They are not shipped to readers.
