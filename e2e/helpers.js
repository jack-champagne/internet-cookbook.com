// Shared setup for browser tests of the published site: serves dist/ (run
// `npm run build` first) to a headless browser (Chromium, Firefox or WebKit;
// see BROWSER) through request interception, with dist/_headers applied as
// Cloudflare would, so a Content-Security-Policy violation is a test failure.
import * as playwright from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, ORIGIN } from '../scripts/lib/serve.mjs';

export const REPO = new URL('../', import.meta.url).pathname;
export const DIST = new URL('../dist/', import.meta.url).pathname;

/** Header rules from the site's _headers (a trailing * matches any path under it). */
const HEADER_RULES = readFileSync(new URL('../site/static/_headers', import.meta.url), 'utf8')
  .split('\n')
  .reduce((/** @type {{ path: string, headers: Record<string, string> }[]} */ rules, line) => {
    if (!line.trim() || line.trim().startsWith('#')) return rules;
    if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: {} });
    else {
      const i = line.indexOf(':');
      rules[rules.length - 1].headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return rules;
  }, []);
export const headersFor = (/** @type {string} */ path) =>
  Object.assign(
    {},
    ...HEADER_RULES.filter((r) => (r.path.endsWith('*') ? path.startsWith(r.path.slice(0, -1)) : path === r.path)).map(
      (r) => r.headers,
    ),
  );

/** Browser engine under test: chromium (default), firefox or webkit (Safari's engine). */
export const BROWSER = process.env.BROWSER || 'chromium';

/** A phone-sized context. Firefox has no mobile emulation, so it gets only the screen. */
export function phone() {
  const iphone = playwright.devices['iPhone 13'];
  if (BROWSER !== 'firefox') return iphone;
  const { viewport, deviceScaleFactor, userAgent } = iphone;
  return { viewport, deviceScaleFactor, userAgent };
}

/**
 * Open a page of the built site. For pages with a book view, waits until the
 * book is open. `errors` collects page errors, console errors (including CSP
 * violations) and failed requests; `requests` lists every URL fetched.
 */
export async function openBook(contextOptions = {}, path = '/', { dist = DIST } = {}) {
  if (!existsSync(join(dist, 'index.html')))
    throw new Error(`${dist} is missing: run \`npm run build\` before the browser tests`);
  const browser = await playwright[BROWSER].launch();
  const context = await browser.newContext({
    viewport: { width: 1400, height: 960 },
    deviceScaleFactor: 1,
    ...contextOptions,
  });
  await serve(context, { repo: REPO, dist, headers: headersFor });
  const page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const requests = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => requests.push(r.url()));
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error(`CSP blocked ${e.blockedURI || e.violatedDirective}`),
    ),
  );
  // A missing page the test navigates to is expected (the 404 test); a missing resource isn't.
  page.on(
    'response',
    (r) => r.status() >= 400 && !r.request().isNavigationRequest() && errors.push(`${r.status()} ${r.url()}`),
  );
  await page.goto(`${ORIGIN}${path}`);
  if (await page.$('#book-view')) await page.waitForSelector('#loading', { state: 'detached', timeout: 30000 });
  return { browser, context, page, errors, requests, close: () => browser.close() };
}
