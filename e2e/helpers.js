// Shared setup for browser tests: serves public/ to a headless Chromium
// through request interception, so no local web server is needed.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.md': 'text/markdown', '.txt': 'text/plain',
};

export async function openBook(contextOptions = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 960 }, deviceScaleFactor: 1, ...contextOptions });
  await context.route('http://book.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    try {
      await route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] || 'application/octet-stream' });
    } catch {
      await route.fulfill({ status: 404, body: 'not found' });
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto('http://book.test/');
  await page.waitForSelector('#loading', { state: 'detached', timeout: 30000 });
  return { browser, page, errors, close: () => browser.close() };
}
