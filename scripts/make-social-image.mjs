// Renders site/static/social.png (1200×630), the link-preview image, from the
// book's own cover design. Run after changing the cover or the theme:
//   node scripts/make-social-image.mjs
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { readBook } from './build.mjs';
import { serve, ORIGIN } from './lib/serve.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const BOOK = new URL('../books/internet-cookbook/', import.meta.url).pathname;

const book = await readBook(BOOK);
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  await serve(context, { repo: REPO, book: BOOK });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/src/build/harness.html`);
  const dataUrl = await page.evaluate(async (b) => {
    const { resolveTemplate } = await import('/src/content/theme.js');
    const { loadFonts, loadImages } = await import('/src/layout/text.js');
    const { boardPage } = await import('/src/layout/pages.js');
    const { drawPage } = await import('/src/render.js');
    const base = resolveTemplate(b.theme, 'book');
    await loadFonts(base);
    const images = await loadImages(b.cover.art ? [b.cover.art] : []);
    const tpl = {
      ...base,
      page: { ...base.page, width: 1200, height: 630 },
      styles: {
        ...base.styles,
        title: { ...base.styles.title, size: 72 },
        lede: { ...base.styles.lede, size: 26, leading: 32 },
      },
    };
    const desc = boardPage(tpl, images, { which: 'front', title: b.title, subtitle: b.subtitle, art: b.cover.art });
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 630;
    drawPage(/** @type {CanvasRenderingContext2D} */ (c.getContext('2d')), desc, tpl, { images });
    return c.toDataURL('image/png');
  }, book);
  await writeFile(new URL('../site/static/social.png', import.meta.url), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote site/static/social.png');
} finally {
  await browser.close();
}
