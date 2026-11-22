// Renders public/social.png (1200×630), the link-preview image, from the
// book's own cover design. Run after changing the cover: node scripts/make-social-image.mjs
import { writeFile } from 'node:fs/promises';
import { openBook } from '../e2e/helpers.js';

const { page, errors, close } = await openBook();
try {
  const dataUrl = await page.evaluate(async () => {
    const T = await import('/typeset.js');
    await T.loadFonts();
    const art = new Image();
    art.src = '/art/rosemary.svg';
    await art.decode();
    const base = T.TEMPLATES.book;
    const tpl = { ...base, page: { ...base.page, width: 1200, height: 630 },
      styles: { ...base.styles, title: { ...base.styles.title, size: 72 }, lede: { ...base.styles.lede, size: 26, leading: 32 } } };
    const desc = T.boardPage(tpl, { side: 'front', title: 'Internet Cookbook', subtitle: 'Recipes set by hand, on the web', art });
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 630;
    T.drawPage(c.getContext('2d'), desc, tpl);
    return c.toDataURL('image/png');
  });
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(new URL('../public/social.png', import.meta.url), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote public/social.png');
} finally {
  await close();
}
