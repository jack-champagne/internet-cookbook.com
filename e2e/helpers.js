// Shared setup for browser tests: serves public/ to a headless browser (Chromium,
// Firefox or WebKit; see BROWSER) through request interception, no web server.
import * as playwright from 'playwright';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = new URL('../public/', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.md': 'text/markdown', '.txt': 'text/plain',
  '.css': 'text/css', '.png': 'image/png', '': 'text/plain',
};

/**
 * Headers from public/_headers, as Cloudflare would apply them (path rules with
 * a trailing * match any path under them). Tests serve them so a Content-
 * Security-Policy violation shows up as a console error.
 */
const HEADER_RULES = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
  .split('\n')
  .reduce((rules, line) => {
    if (!line.trim() || line.trim().startsWith('#')) return rules;
    if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: {} });
    else {
      const i = line.indexOf(':');
      rules[rules.length - 1].headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return rules;
  }, []);
const headersFor = (path) => Object.assign({}, ...HEADER_RULES
  .filter((r) => (r.path.endsWith('*') ? path.startsWith(r.path.slice(0, -1)) : path === r.path))
  .map((r) => r.headers));

/** Browser engine under test: chromium (default), firefox or webkit (Safari's engine). */
export const BROWSER = process.env.BROWSER || 'chromium';

/** A phone-sized context. Firefox has no mobile emulation, so it gets only the screen. */
export function phone() {
  const iphone = playwright.devices['iPhone 13'];
  if (BROWSER !== 'firefox') return iphone;
  const { viewport, deviceScaleFactor, userAgent } = iphone;
  return { viewport, deviceScaleFactor, userAgent };
}

export async function openBook(contextOptions = {}, path = '/') {
  const browser = await playwright[BROWSER].launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 960 }, deviceScaleFactor: 1, ...contextOptions });
  await context.route('https://book.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    // /__fixtures/* serves test-only files from e2e/fixtures/.
    const file = path.startsWith('/__fixtures/') ? join(FIXTURES, path.slice(12)) : join(ROOT, path === '/' ? 'index.html' : path);
    try {
      await route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] || 'application/octet-stream', headers: headersFor(path) });
    } catch {
      await route.fulfill({ status: 404, body: 'not found' });
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', () => {});
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP blocked ${e.blockedURI || e.violatedDirective}`)));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`https://book.test${path}`);
  if (path === '/') await page.waitForSelector('#loading', { state: 'detached', timeout: 30000 });
  return { browser, page, errors, close: () => browser.close() };
}
