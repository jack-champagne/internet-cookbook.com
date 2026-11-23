/**
 * Runs in the browser (headless during builds and tests): lay out one edition
 * of a book loaded by Node and passed in as plain data.
 */
import { resolveTemplate } from '../content/theme.js';
import { loadFonts, loadImages } from '../layout/text.js';
import { layoutBook, bookImages } from '../layout/book.js';
import { preflight } from '../preflight.js';

/** Text width in points as the browser draws it (measured at 3x to avoid pixel rounding). */
const measurer = () => {
  const c = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
  return (/** @type {string} */ text, /** @type {string} */ font, /** @type {number} */ letterSpacing = 0) => {
    c.font = font.replace(/([\d.]+)px/, (_, n) => `${Number(n) * 3}px`);
    const w = c.measureText(text).width / 3;
    return w + (letterSpacing ? letterSpacing * Math.max(0, [...text].length - 1) : 0);
  };
};

/**
 * @param {import('../content/load.js').BookData} book
 * @param {string} edition
 */
export async function layoutEdition(book, edition) {
  const tpl = resolveTemplate(book.theme, edition);
  await loadFonts(tpl);
  const images = await loadImages(bookImages(book));
  const layout = layoutBook(book, tpl, images);
  const report = preflight(layout, { tpl, book, measure: measurer() });
  return { tpl, layout, report };
}

Object.assign(window, { layoutEdition });
