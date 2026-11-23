// Serves the repo and a book to a Playwright browser context through request
// interception (no web server). Book files take the paths they have on the
// published site (/art/…, /fonts/…); engine files are under /src/…; a dist
// folder, when given, is served at the root.
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

export const ORIGIN = 'https://book.test';
export const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.yaml': 'text/plain',
};
const isFile = async (p) => (await stat(p).catch(() => null))?.isFile() ?? false;

/**
 * @param {import('playwright').BrowserContext} context
 * @param {{ repo: string, book?: string, dist?: string, headers?: (path: string) => Record<string, string> }} roots
 */
export async function serve(context, { repo, book, dist, headers }) {
  await context.route(`${ORIGIN}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const rel = normalize(path).replace(/^\/+/, '');
    const candidates = [];
    if (dist) candidates.push(join(dist, rel), join(dist, rel, 'index.html'));
    if (!dist || rel.startsWith('src/') || rel.startsWith('__fixtures/')) {
      if (book) candidates.push(join(book, rel));
      candidates.push(join(repo, rel.replace(/^__fixtures\//, 'e2e/fixtures/')));
    }
    for (const file of candidates) {
      if (await isFile(file)) {
        return route.fulfill({
          body: await readFile(file),
          contentType: TYPES[extname(file)] ?? 'application/octet-stream',
          headers: headers?.(path) ?? {},
        });
      }
    }
    const notFound = dist && (await isFile(join(dist, '404.html')));
    return route.fulfill({
      status: 404,
      body: notFound ? await readFile(join(dist, '404.html')) : 'not found',
      contentType: 'text/html',
    });
  });
}
