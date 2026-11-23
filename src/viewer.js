/**
 * The book viewer, loaded on every page of the published site. It draws the
 * frozen layout for the reader's edition with crease.js, opens at this page's
 * address, and keeps the address, title and article in sync as pages turn.
 *
 * The article in <main> is the page's real content; if anything here fails,
 * the reader still has it.
 */
import { Book } from './crease.js';
import { drawPage } from './render.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('book'));
const status = $('status');
const select = /** @type {HTMLSelectElement} */ ($('edition'));

/** "/recipes/x" → "/recipes/x/"; "/index.html" → "/" */
const normalise = (/** @type {string} */ path) => {
  const p = path.replace(/index\.html$/, '');
  return p.endsWith('/') ? p : `${p}/`;
};

let current = normalise(location.pathname);
let choice = 'auto';
const guides = new URLSearchParams(location.search).has('guides'); // margins and text area, for checking layout
/** @type {any} */
let book = null;
let lastKey = '';
/** @type {Map<string, Promise<any>>} */
const editions = new Map();
/** @type {Map<string, Promise<Document>>} */
const articles = new Map();

const portraitPhone = () => matchMedia('(orientation: portrait)').matches && innerWidth < 760;
const editionName = () => (choice === 'auto' ? (portraitPhone() ? 'phone' : 'book') : choice);

/** Layout, fonts and images for an edition, loaded once. @param {string} name */
function loadEdition(name) {
  if (!editions.has(name))
    editions.set(
      name,
      (async () => {
        const layout = await (await fetch(`/layout/${name}.json`)).json();
        await Promise.all(
          layout.fonts.map(async (/** @type {any} */ f) => {
            const face = new FontFace(f.family, `url(${f.src})`, { style: f.style, weight: f.weight });
            document.fonts.add(face);
            await face.load();
          }),
        );
        /** @type {Map<string, HTMLImageElement>} */
        const images = new Map();
        const srcs = new Set(
          layout.pages.flatMap((/** @type {any} */ p) =>
            p.items.filter((/** @type {any} */ i) => i.type === 'image').map((/** @type {any} */ i) => i.src),
          ),
        );
        await Promise.all(
          [...srcs].map(async (src) => {
            const img = new Image();
            img.src = src;
            await img.decode().catch(() => {});
            images.set(src, img);
          }),
        );
        return { layout, images };
      })(),
    );
  return /** @type {Promise<any>} */ (editions.get(name));
}

/** The article page for an address, fetched once. @param {string} address */
function articleFor(address) {
  if (!articles.has(address))
    articles.set(
      address,
      fetch(address)
        .then((r) => r.text())
        .then((html) => new DOMParser().parseFromString(html, 'text/html')),
    );
  return /** @type {Promise<Document>} */ (articles.get(address));
}

/** Address of the entry the reader is looking at: the right page of a spread, unless it's blank. */
function visibleAddress(/** @type {any} */ layout) {
  const shown = book.visiblePages.map((/** @type {number} */ n) => layout.pages[n - 1]);
  const withContent = shown.filter((/** @type {any} */ p) => p && p.items.length);
  return (withContent[withContent.length - 1] ?? shown[shown.length - 1])?.entry ?? current;
}

/** Point the address bar, title and article at the entry on show. */
async function sync() {
  const { layout } = await loadEdition(editionName());
  const shown = book.visiblePages;
  status.textContent =
    shown.length === 2
      ? `pages ${shown[0]}–${shown[1]} of ${book.pageCount}`
      : `page ${shown[0] ?? book.page} of ${book.pageCount}`;
  const address = visibleAddress(layout);
  if (address === current) return;
  current = address;
  history.replaceState(null, '', address + location.search);
  const doc = await articleFor(address);
  if (current !== address) return; // turned again while fetching
  document.title = doc.title;
  const main = doc.querySelector('main#text');
  if (main) /** @type {HTMLElement} */ (document.querySelector('main#text')).innerHTML = main.innerHTML;
  const canonical = doc.querySelector('link[rel=canonical]')?.getAttribute('href');
  if (canonical) document.querySelector('link[rel=canonical]')?.setAttribute('href', canonical);
  prefetchAround(layout);
}

/** Fetch the articles of the entries next to the current one. */
function prefetchAround(/** @type {any} */ layout) {
  const order = Object.keys(layout.entries);
  const i = order.indexOf(current);
  for (const a of [order[i - 1], order[i + 1]]) if (a) articleFor(a);
}

async function build() {
  const name = editionName();
  const { layout, images } = await loadEdition(name);
  const display = portraitPhone() ? 'single' : 'double';
  const tpl = layout.template;
  const pad = display === 'single' ? 12 : 28;
  const aspect = tpl.page.height / tpl.page.width;
  const availW = (innerWidth - 2 * pad) / (display === 'double' ? 2 : 1);
  const availH = innerHeight * 0.82 - 2 * pad - 60;
  const pageWidth = Math.floor(Math.max(160, Math.min(availW, availH / aspect, 640)));
  const key = [name, display, pageWidth].join('|');
  if (key === lastKey) return;
  lastKey = key;

  const at = layout.entries[current] ?? layout.entries['/'];
  const page = book ? book.page : display === 'double' ? at.first : at.start;
  book?.destroy();
  book = new Book(canvas, {
    pages: layout.pages.map(
      (/** @type {any} */ p) =>
        (/** @type {CanvasRenderingContext2D} */ g, /** @type {number} */ W, /** @type {number} */ H) => {
          g.scale(W / tpl.page.width, H / tpl.page.height);
          drawPage(g, p, tpl, { images, guides });
        },
    ),
    pageWidth,
    pageHeight: Math.round(pageWidth * aspect),
    display,
    padding: pad,
    hard: layout.pages.filter((/** @type {any} */ p) => p.hard).map((/** @type {any} */ p) => p.n),
    label: layout.title,
    onTurn: sync,
  });
  book.goTo(page);
  await sync();
}

async function start() {
  try {
    await build();
  } catch (e) {
    console.warn('The book view could not be opened; the text version is below.', e);
    return;
  }
  $('loading').remove();
  canvas.hidden = false;
  /** @type {HTMLElement} */ (document.querySelector('#book-view .controls')).hidden = false;
  $('prev').onclick = () => book.prev();
  $('next').onclick = () => book.next();
  select.onchange = () => {
    choice = select.value;
    lastKey = '';
    const keep = current;
    book?.destroy();
    book = null;
    current = keep;
    build();
  };
  let timer = 0;
  addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const keepPage = book?.page;
      build().then(() => keepPage && lastKey && book.goTo(keepPage));
    }, 150);
  });
  // Exposed for the browser tests and for debugging (?debug), not for readers.
  if (location.hostname === 'book.test' || new URLSearchParams(location.search).has('debug'))
    Object.assign(window, { book: () => book });
}

start();
