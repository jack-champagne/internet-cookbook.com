/**
 * HTML output: a real article for every address in the book (for reader
 * modes, screen readers, search engines and readers without JavaScript),
 * schema.org Recipe data for recipes, and the page shell the viewer runs in.
 * Pure: runs in Node during the build.
 */

/** @param {unknown} s */
export const escape = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Inline runs → HTML with <strong>/<em>. @param {{ text: string, bold?: boolean, italic?: boolean }[]} runs */
export const inline = (runs) =>
  runs
    .map((r) => {
      let h = escape(r.text);
      if (r.italic) h = `<em>${h}</em>`;
      if (r.bold) h = `<strong>${h}</strong>`;
      return h;
    })
    .join('');

/** Plain text of runs. @param {{ text: string }[]} runs */
export const plain = (runs) => runs.map((r) => r.text).join('');

/**
 * "1 hr 15 min" → "PT1H15M"; null when it can't be read.
 * @param {unknown} value @returns {string | null}
 */
export function isoDuration(value) {
  if (value == null) return null;
  const s = String(value).toLowerCase();
  let h = 0,
    m = 0,
    found = false;
  for (const [, n, unit] of s.matchAll(/(\d+(?:\.\d+)?)\s*(h(?:ou)?rs?|hr|h|min(?:ute)?s?|m)\b/g)) {
    found = true;
    if (unit.startsWith('h')) h += Number(n);
    else m += Number(n);
  }
  if (!found) return null;
  const totalMin = Math.round(h * 60 + m);
  const H = Math.floor(totalMin / 60),
    M = totalMin % 60;
  return `PT${H ? `${H}H` : ''}${M || !H ? `${M}M` : ''}`;
}

/** @param {any} doc Blocks of a document rendered as HTML, without its header. */
function body(doc, { skipLede = false, skipImages = /** @type {string[]} */ ([]) } = {}) {
  /** @type {string[]} */
  const out = [];
  let seenHeading = false;
  /** @type {string[]} */
  let section = [];
  const flush = () => {
    if (section.length) out.push(section.join('\n'));
    section = [];
  };
  for (const b of doc.blocks) {
    if (b.type === 'heading') {
      flush();
      seenHeading = true;
      const level = Math.min(6, b.level === 1 ? 2 : b.level);
      section.push(`<h${level}>${inline(b.runs)}</h${level}>`);
    } else if (b.type === 'paragraph') {
      if (skipLede && !seenHeading) continue;
      section.push(`<p>${inline(b.runs)}</p>`);
    } else if (b.type === 'list') {
      const tag = b.ordered ? 'ol' : 'ul';
      section.push(
        `<${tag}>\n${b.items.map((/** @type {any} */ i) => `  <li>${inline(i)}</li>`).join('\n')}\n</${tag}>`,
      );
    } else if (b.type === 'note') {
      section.push(`<aside class="note"><p>${inline(b.runs)}</p></aside>`);
    } else if (b.type === 'image' && !b.attrs.decor && !skipImages.includes(b.src)) {
      section.push(`<figure><img src="${escape(b.src)}" alt="${escape(b.alt)}" loading="lazy"></figure>`);
    }
  }
  flush();
  return out.length ? `<section>\n${out.join('\n</section>\n<section>\n')}\n</section>` : '';
}

/** Lede: the header's intro, or the paragraphs before the first heading. @param {any} doc */
export function ledeOf(doc) {
  if (doc.meta.intro) return String(doc.meta.intro);
  const out = [];
  for (const b of doc.blocks) {
    if (b.type === 'heading') break;
    if (b.type === 'paragraph') out.push(plain(b.runs));
  }
  return out.join(' ');
}

/**
 * The article for an address.
 * @param {{ kind: string, entry?: any, chapter?: any }} target
 * @param {any} book
 */
export function renderArticle(target, book) {
  const { kind, entry, chapter } = target;
  if (kind === 'recipe') {
    const { meta } = entry.doc;
    const facts = [
      ['Serves', meta.serves],
      ['Prep', meta.prep],
      ['Cook', meta.cook],
      ['Total', meta.total],
    ].filter(([, v]) => v != null && v !== '');
    const lede = ledeOf(entry.doc);
    return [
      '<article class="recipe">',
      '<header>',
      `<p class="kicker"><a href="${escape(chapterOf(book, entry)?.address ?? '/')}">${escape(entry.chapter ?? '')}</a></p>`,
      `<h1>${escape(meta.title)}</h1>`,
      lede ? `<p class="intro">${escape(lede)}</p>` : '',
      facts.length
        ? `<ul class="facts">${facts.map(([k, v]) => `<li>${escape(k)} ${escape(v)}</li>`).join('')}</ul>`
        : '',
      '</header>',
      entry.plate
        ? `<figure><img src="${escape(entry.plate.art)}" alt="${escape(plateAlt(entry))}">${entry.plate.caption ? `<figcaption>${escape(entry.plate.caption)}</figcaption>` : ''}</figure>`
        : '',
      body(entry.doc, { skipLede: !meta.intro, skipImages: entry.plate ? [entry.plate.art] : [] }),
      '</article>',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (kind === 'prose') {
    return [
      '<article class="prose">',
      `<h1>${escape(entry.doc.meta.title ?? '')}</h1>`,
      body(entry.doc),
      '</article>',
    ].join('\n');
  }
  if (kind === 'chapter') {
    return [
      '<article class="chapter">',
      `<h1>${escape(chapter.title)}</h1>`,
      '<ul class="contents">',
      ...chapter.entries.map(
        (/** @type {any} */ e) => `  <li><a href="${escape(e.address)}">${escape(e.doc.meta.title)}</a></li>`,
      ),
      '</ul>',
      '</article>',
    ].join('\n');
  }
  if (kind === 'colophon') {
    return [
      '<article class="colophon">',
      '<h1>Colophon</h1>',
      `<p>${escape(book.title)} is typeset with Pretext and its pages are turned by crease.js.</p>`,
      '<p>Recipes, writing and art are dedicated to the public domain (CC0 1.0). The code is licensed under Apache-2.0. See <a href="/licenses/">licences</a>.</p>',
      '</article>',
    ].join('\n');
  }
  // Home: the book's title page and contents.
  return [
    '<article class="home">',
    `<h1>${escape(book.title)}</h1>`,
    book.subtitle ? `<p class="intro">${escape(book.subtitle)}</p>` : '',
    '<nav aria-label="Contents"><ul class="contents">',
    ...book.front
      .filter((/** @type {any} */ e) => e.kind === 'prose')
      .map(
        (/** @type {any} */ e) => `  <li><a href="${escape(e.address)}">${escape(e.doc.meta.title ?? e.slug)}</a></li>`,
      ),
    ...book.chapters.map(
      (/** @type {any} */ c) =>
        `  <li><a href="${escape(c.address)}">${escape(c.title)}</a>\n    <ul>\n${c.entries
          .map(
            (/** @type {any} */ e) => `      <li><a href="${escape(e.address)}">${escape(e.doc.meta.title)}</a></li>`,
          )
          .join('\n')}\n    </ul>\n  </li>`,
    ),
    '</ul></nav>',
    '</article>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** A plate's description: the in-text image's description of the same art, else its caption. @param {any} entry */
const plateAlt = (entry) =>
  entry.doc.blocks.find((/** @type {any} */ b) => b.type === 'image' && b.src === entry.plate.art && b.alt)?.alt ??
  entry.plate.caption ??
  entry.doc.meta.title;

const chapterOf = (/** @type {any} */ book, /** @type {any} */ entry) =>
  book.chapters.find((/** @type {any} */ c) => c.entries.includes(entry));

/**
 * schema.org Recipe data for a recipe.
 * @param {any} entry @param {any} book @param {string} site  e.g. "https://internet-cookbook.com"
 */
export function recipeData(entry, book, site) {
  const { meta } = entry.doc;
  const lists = entry.doc.blocks.filter((/** @type {any} */ b) => b.type === 'list');
  const ingredients = lists
    .filter((/** @type {any} */ l) => !l.ordered)
    .flatMap((/** @type {any} */ l) => l.items.map(plain));
  const steps = lists.filter((/** @type {any} */ l) => l.ordered).flatMap((/** @type {any} */ l) => l.items.map(plain));
  const images = [
    entry.plate?.art,
    ...entry.doc.blocks
      .filter((/** @type {any} */ b) => b.type === 'image' && !b.attrs.decor)
      .map((/** @type {any} */ b) => b.src),
  ]
    .filter((src, i, all) => src && all.indexOf(src) === i)
    .map((src) => site + src);
  /** @type {Record<string, unknown>} */
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: String(meta.title),
    url: site + entry.address,
    description: ledeOf(entry.doc) || undefined,
    recipeCategory: entry.chapter,
    recipeYield: meta.serves != null ? String(meta.serves) : undefined,
    prepTime: isoDuration(meta.prep) ?? undefined,
    cookTime: isoDuration(meta.cook) ?? undefined,
    totalTime: isoDuration(meta.total) ?? undefined,
    recipeIngredient: ingredients,
    recipeInstructions: steps.map((/** @type {string} */ text) => ({ '@type': 'HowToStep', text })),
    image: images.length ? images : undefined,
    isPartOf: { '@type': 'Book', name: book.title },
  };
  return JSON.parse(JSON.stringify(data));
}

/**
 * A complete HTML document: the viewer's book (enhanced by /viewer.js) above
 * the article, which is the page's real content.
 * @param {{ address: string, title: string, description: string, article: string, data?: object,
 *   book: any, site: string }} p
 */
export function renderPage({ address, title, description, article, data, book, site }) {
  const full = address === '/' ? book.title : `${title} · ${book.title}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escape(full)}</title>
<meta name="description" content="${escape(description)}">
<meta name="theme-color" content="#3d4a3a">
<link rel="canonical" href="${escape(site + address)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="${data ? 'article' : 'website'}">
<meta property="og:title" content="${escape(full)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(site + address)}">
<meta property="og:image" content="${escape(site)}/social.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="book:address" content="${escape(address)}">
<link rel="stylesheet" href="/viewer.css">
${data ? `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>\n` : ''}</head>
<body>
<div id="book-view" aria-label="Book view">
  <p id="loading">Opening the book…</p>
  <canvas id="book" hidden></canvas>
  <div class="controls" hidden>
    <button id="prev" type="button">◀ Prev</button>
    <span id="status"></span>
    <button id="next" type="button">Next ▶</button>
    <select id="edition" title="Page size">
      <option value="auto">Page: auto</option>
${book.editions.map((/** @type {string} */ e) => `      <option value="${escape(e)}">${escape(e === 'book' ? 'Book' : e[0].toUpperCase() + e.slice(1))} pages</option>`).join('\n')}
    </select>
  </div>
</div>
<main id="text">
${article}
</main>
<footer><a href="/">${escape(book.title)}</a> · <a href="/licenses/">Licences</a></footer>
<script type="module" src="/viewer.js"></script>
</body>
</html>
`;
}

/**
 * Every page of the site: one per address.
 * @param {any} book @param {string} site
 * @returns {{ address: string, title: string, html: string }[]}
 */
export function sitePages(book, site) {
  const out = [];
  const home = renderArticle({ kind: 'home' }, book);
  out.push({ address: '/', title: book.title, description: book.subtitle ?? book.title, article: home });
  for (const e of [...book.front, ...book.back]) {
    if (e.kind === 'prose')
      out.push({
        address: e.address,
        title: e.doc.meta.title ?? e.slug,
        description: ledeOf(e.doc) || book.title,
        article: renderArticle({ kind: 'prose', entry: e }, book),
      });
    if (e.kind === 'colophon')
      out.push({
        address: e.address,
        title: 'Colophon',
        description: `How ${book.title} was made.`,
        article: renderArticle({ kind: 'colophon' }, book),
      });
  }
  for (const c of book.chapters) {
    out.push({
      address: c.address,
      title: c.title,
      description: `${c.title}: recipes from ${book.title}.`,
      article: renderArticle({ kind: 'chapter', chapter: c }, book),
    });
    for (const e of c.entries)
      out.push({
        address: e.address,
        title: e.doc.meta.title,
        description: ledeOf(e.doc) || `${e.doc.meta.title}, from ${book.title}.`,
        article: renderArticle({ kind: 'recipe', entry: e }, book),
        data: recipeData(e, book, site),
      });
  }
  return out.map((p) => ({ address: p.address, title: p.title, html: renderPage({ ...p, book, site }) }));
}
