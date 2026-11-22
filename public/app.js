// The book viewer: loads the recipes, typesets them and opens the book.
import { Book } from './crease.js';
import { parseRecipe } from './recipe-md.js';
import {
  TEMPLATES,
  loadFonts,
  loadImages,
  typesetRecipe,
  drawPage,
  boardPage,
  endpaperPage,
  titlePage,
  platePage,
  blankPage,
} from './typeset.js';

const canvas = document.getElementById('book');
const status = document.getElementById('status');
const state = { trim: 'auto', guides: false, page: 1 };
let book, lastKey;

// The book's recipes, in order. A `plate` is a full-page illustration on
// the left facing the recipe, so that recipe starts on a right-hand page.
// (Interim list until book.yaml replaces this page; see the design spec.)
const RECIPES = [
  {
    src: '/recipes/shepherds-pie.md',
    plate: { art: '/art/shepherds-pie.svg', caption: 'Shepherd’s pie, fresh from the oven' },
  },
  { src: '/recipes/hamburg-and-rice.md' },
];
const decoded = async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
};
const [recipes, sprig] = await Promise.all([
  Promise.all(RECIPES.map(async (r) => ({ ...r, recipe: parseRecipe(await (await fetch(r.src)).text()) }))),
  decoded('/art/rosemary.svg'),
  loadFonts(),
]);
const images = new Map();
for (const r of recipes) {
  for (const [src, img] of await loadImages(r.recipe)) images.set(src, img);
  if (r.plate && !images.has(r.plate.art)) images.set(r.plate.art, await decoded(r.plate.art));
}

// Portrait phones read one page at a time, on the phone trim.
const portraitPhone = () => matchMedia('(orientation: portrait)').matches && innerWidth < 760;

function build() {
  const phone = portraitPhone();
  const tplName = state.trim === 'auto' ? (phone ? 'phone' : 'book') : state.trim;
  const display = phone ? 'single' : 'double';
  const tpl = TEMPLATES[tplName];
  // Page size on screen: as large as fits, keeping the trim's proportions.
  const pad = phone ? 12 : 28;
  const aspect = tpl.page.height / tpl.page.width;
  const availW = (innerWidth - 2 * pad) / (display === 'double' ? 2 : 1);
  const availH = innerHeight - 2 * pad - 90;
  const pageWidth = Math.floor(Math.max(160, Math.min(availW, availH / aspect, 640)));
  // Rebuild (re-typeset and re-rasterise) only when something visible changes.
  const key = [tplName, display, state.guides, pageWidth].join('|');
  if (key === lastKey) return;
  lastKey = key;
  if (book) state.page = book.page;

  // A real book: each cover is a board printed on both sides (outside +
  // endpaper). Contents start on page 3, a right-hand page, with the
  // title page; each plate sits on a left page facing its recipe.
  const title = 'Internet Cookbook',
    subtitle = 'Recipes set by hand, on the web';
  const contents = [titlePage(tpl, { title, subtitle })];
  const nextPageIsLeft = () => (2 + contents.length + 1) % 2 === 0;
  for (const r of recipes) {
    if (r.plate) {
      if (!nextPageIsLeft()) contents.push(blankPage());
      contents.push(platePage(tpl, { art: images.get(r.plate.art), caption: r.plate.caption }));
    }
    contents.push(...typesetRecipe(r.recipe, tpl, images));
  }
  // Pad inside the book so the back board's inside lands on a right-hand page.
  if (contents.length % 2) contents.push(blankPage());
  const pages = [
    boardPage(tpl, { side: 'front', title, subtitle, art: sprig }),
    endpaperPage(tpl, { art: sprig }),
    ...contents,
    endpaperPage(tpl, { art: sprig }),
    boardPage(tpl, { side: 'back', art: sprig, lines: [title, `Typeset with Pretext · ${tpl.name}`] }),
  ];

  book?.destroy();
  book = new Book(canvas, {
    pages: pages.map((p, i) => (g, W, H) => {
      g.scale(W / tpl.page.width, H / tpl.page.height);
      drawPage(g, p, tpl, { pageNumber: i + 1, guides: state.guides });
    }),
    pageWidth,
    pageHeight: Math.round(pageWidth * aspect),
    display,
    padding: pad,
    hard: [1, 2, pages.length - 1, pages.length], // both sides of each cover board
    onTurn: update,
  });
  book.goTo(state.page);
  update();
}

function update() {
  const shown = book.visiblePages;
  status.textContent =
    shown.length === 2
      ? `pages ${shown[0]}–${shown[1]} of ${book.pageCount}`
      : `page ${shown[0] ?? book.page} of ${book.pageCount}`;
}

build();
document.getElementById('loading').remove();
canvas.hidden = false;

document.getElementById('prev').onclick = () => book.prev();
document.getElementById('next').onclick = () => book.next();
document.getElementById('trim').onchange = (e) => {
  state.trim = e.target.value;
  build();
};
document.getElementById('guides').onchange = (e) => {
  state.guides = e.target.checked;
  build();
};
let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(build, 150);
});
// Exposed for the browser tests and for debugging (?debug), not for readers.
if (location.hostname === 'book.test' || new URLSearchParams(location.search).has('debug')) window.book = () => book;
