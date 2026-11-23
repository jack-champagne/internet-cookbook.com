/**
 * Runs in the browser (headless during builds and tests): lay out one edition
 * of a book loaded by Node and passed in as plain data.
 */
import { resolveTemplate } from '../content/theme.js';
import { loadFonts, loadImages } from '../layout/text.js';
import { layoutBook, bookImages } from '../layout/book.js';

/**
 * @param {import('../content/load.js').BookData} book
 * @param {string} edition
 */
export async function layoutEdition(book, edition) {
  const tpl = resolveTemplate(book.theme, edition);
  await loadFonts(tpl);
  const images = await loadImages(bookImages(book));
  const layout = layoutBook(book, tpl, images);
  return { tpl, layout };
}

Object.assign(window, { layoutEdition });
