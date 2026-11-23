/**
 * Lay out a whole book for one edition, in reading order, applying the
 * physical-book rules:
 *   - page 1 is the outside front cover and page 2 its endpaper; the last two
 *     pages are the back endpaper and outside back cover; only these four are
 *     rigid
 *   - contents start on page 3 (a right-hand page) with the title page
 *   - chapter openers start on a right-hand page
 *   - a plate sits on a left-hand page facing its recipe on the right
 *   - entries' `start` constraints are met with blank pages inside the book
 *   - the page count is even
 * The contents page needs everyone's page numbers, so the book is laid out
 * with the contents' length guessed, then again if the guess was wrong.
 */
import {
  documentPages,
  boardPage,
  endpaperPage,
  titlePage,
  platePage,
  openerPage,
  colophonPage,
  tocPages,
  blankPage,
} from './pages.js';

/** @typedef {ReturnType<import('./flow.js').emptyPage> & { n: number, entry: string, hard: boolean, folio: number | null }} Page */

const sideOf = (/** @type {number} */ n) => (n % 2 ? 'right' : 'left');
const NUMBER_WORDS = [
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
];

/**
 * @param {import('../content/load.js').BookData} book
 * @param {any} tpl  resolved template for the edition
 * @param {Map<string, { naturalWidth: number, naturalHeight: number }>} images
 * @returns {{ pages: Page[], entries: Record<string, { first: number, last: number, start: number }> }}
 *   For each address: `first`..`last` are all its pages (including a facing
 *   plate and any blank page before it), `start` is where its own content
 *   begins: the page the contents lists.
 */
export function layoutBook(book, tpl, images) {
  let tocCount = 1;
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = pass(book, tpl, images, tocCount);
    if (result.tocCount === tocCount) return result.layout;
    tocCount = result.tocCount;
  }
  throw new Error('the contents page count did not settle');
}

function pass(
  /** @type {any} */ book,
  /** @type {any} */ tpl,
  /** @type {any} */ images,
  /** @type {number} */ tocCount,
) {
  /** @type {Page[]} */
  const pages = [];
  /** @type {Record<string, { first: number, last: number, start: number }>} */
  const entries = {};
  /**
   * @param {any} p @param {string} entry
   * @param {{ folio?: boolean, own?: boolean }} [o]  own: the entry's own content (not a blank or facing plate)
   */
  const push = (p, entry, { folio = false, own = true } = {}) => {
    const n = pages.length + 1;
    if (p.side !== sideOf(n)) throw new Error(`internal: page ${n} laid out for the ${p.side} side`);
    pages.push({ ...p, n, entry, hard: false, folio: folio ? n : null });
    const e = (entries[entry] ??= { first: n, last: n, start: 0 });
    e.last = n;
    if (own && !e.start) e.start = n;
  };
  const nextSide = () => sideOf(pages.length + 1);
  /** Blank pages until the next page is on `side`. @param {'left'|'right'|'any'} side @param {string} entry */
  const padTo = (side, entry) => {
    if (side !== 'any' && nextSide() !== side) push(blankPage(tpl, nextSide()), entry, { own: false });
  };
  const art = book.cover.art;

  // Covers and title page.
  push(boardPage(tpl, images, { which: 'front', title: book.title, subtitle: book.subtitle, art }), '/');
  push(endpaperPage(tpl, images, { side: 'left', art }), '/');
  push(titlePage(tpl, { title: book.title, subtitle: book.subtitle }), '/');

  /** @type {{ address: string, text: string, level: 0|1 }[]} */
  const tocWanted = [];
  let tocAt = 0;

  /** @param {any} e @param {string} [chapter] */
  const placeEntry = (e, chapter) => {
    if (e.kind === 'toc') {
      padTo(e.start, e.address);
      tocAt = pages.length;
      for (let i = 0; i < tocCount; i++) push(blankPage(tpl, nextSide()), e.address, { folio: true }); // filled in below
      return;
    }
    if (e.kind === 'colophon') {
      padTo(e.start, e.address);
      push(
        colophonPage(tpl, {
          side: nextSide(),
          title: book.title,
          lines: [
            `This edition: ${tpl.name}`,
            `Set in ${[...new Set(tpl.fonts.map((/** @type {any} */ f) => f.family))].join(', ')}`,
            [book.license && `Recipes and art: ${book.license.name}`, 'Code: Apache-2.0'].filter(Boolean).join(' · '),
          ],
        }),
        e.address,
      );
      return;
    }
    if (e.plate) {
      padTo('left', e.address);
      push(platePage(tpl, images, { ...e.plate, side: 'left' }), e.address, { own: false });
    } else padTo(e.start, e.address);
    tocWanted.push({
      address: e.address,
      text: String(e.doc.meta.title ?? e.slug),
      level: e.kind === 'recipe' ? 1 : 0,
    });
    for (const p of documentPages(tpl, e.doc, images, { kind: e.kind, side: nextSide(), chapter }))
      push(p, e.address, { folio: true });
  };

  for (const e of book.front) placeEntry(e);
  book.chapters.forEach((/** @type {any} */ ch, /** @type {number} */ i) => {
    padTo('right', ch.address);
    tocWanted.push({ address: ch.address, text: ch.title, level: 0 });
    push(
      openerPage(tpl, images, {
        number: NUMBER_WORDS[i] ?? String(i + 1),
        title: ch.title,
        art: ch.opener?.art,
        side: 'right',
      }),
      ch.address,
    );
    for (const e of ch.entries) placeEntry(e, ch.title);
  });
  for (const e of book.back) placeEntry(e);

  // Back covers: contents end on a left page so the back endpaper is on the right.
  if (pages.length % 2) push(blankPage(tpl, nextSide()), pages[pages.length - 1].entry, { own: false });
  push(endpaperPage(tpl, images, { side: 'right', art }), '/');
  push(boardPage(tpl, images, { which: 'back', art, lines: [book.title] }), '/');
  for (const n of [1, 2, pages.length - 1, pages.length]) pages[n - 1].hard = true;

  // Contents: lay it out with the real page numbers into its reserved pages.
  const laid = tocAt
    ? tocPages(
        tpl,
        tocWanted.map((t) => ({ text: t.text, level: t.level, page: entries[t.address].start })),
        sideOf(tocAt + 1),
      )
    : [];
  if (tocAt) {
    if (laid.length !== tocCount) return { tocCount: laid.length, layout: /** @type {any} */ (null) };
    laid.forEach((p, i) => {
      const n = tocAt + i + 1;
      pages[n - 1] = { ...p, n, entry: pages[n - 1].entry, hard: false, folio: n };
    });
  }
  return { tocCount, layout: { pages, entries } };
}

/** Every image a book's layout may use (for loading before layout). */
export const bookImages = (/** @type {any} */ book) =>
  book.assets.filter((/** @type {string} */ a) => !a.startsWith('/fonts/') && !/\.woff2?$/.test(a));
