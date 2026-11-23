// Local preview while writing recipes or changing the code:
//   npm run dev            → http://localhost:8000
//
// Rebuilds the site into .dev/ whenever the book, the code or the static
// files change, and reloads open pages. Preflight findings are printed here
// and shown in a panel on the page; unlike `npm run build`, errors don't stop
// the preview, so you can see what's wrong. Add ?guides to an address to see
// the margins and text area.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { parseArgs } from 'node:util';
import { build, layoutBrowser, DEFAULTS, REPO } from './build.mjs';
import { formatFindings } from '../src/preflight.js';
import { TYPES } from './lib/serve.mjs';

const { values } = parseArgs({
  options: {
    book: { type: 'string', default: DEFAULTS.book },
    port: { type: 'string', default: process.env.PORT ?? '8000' },
  },
});
const OUT = join(REPO, '.dev');
const browser = await layoutBrowser(values.book);

/** @type {{ ok: boolean, message?: string, reports?: any }} */
let state = { ok: false, message: 'Building…' };
/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();

let running = false,
  again = false;
async function rebuild() {
  if (running) return void (again = true);
  running = true;
  const started = Date.now();
  try {
    const { reports } = await build({
      book: values.book,
      out: OUT,
      site: `http://localhost:${values.port}`,
      force: true,
      browser,
    });
    state = { ok: true, reports };
    const text = Object.entries(reports)
      .map(([n, r]) => formatFindings(r, n))
      .filter(Boolean)
      .join('\n');
    console.log(
      `${new Date().toLocaleTimeString()} built in ${Date.now() - started} ms${text ? `\n${text}` : ', no findings'}`,
    );
  } catch (e) {
    state = { ok: false, message: String(/** @type {any} */ (e)?.message ?? e) };
    console.error(`${new Date().toLocaleTimeString()} ${state.message}`);
  }
  for (const c of clients) c.write('data: reload\n\n');
  running = false;
  if (again) {
    again = false;
    rebuild();
  }
}

let timer;
for (const dir of [values.book, join(REPO, 'src'), join(REPO, 'site')])
  watch(dir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 120);
  });

// The panel on every page: reloads on rebuild and lists preflight findings.
const DEV_SCRIPT = `
const panel = document.createElement('aside');
panel.style.cssText = 'position:fixed;right:10px;bottom:10px;max-width:min(560px,90vw);max-height:40vh;overflow:auto;font:12px/1.4 ui-monospace,monospace;background:#fff;border:1px solid #ccc;border-radius:8px;padding:8px 10px;box-shadow:0 2px 10px #0002;z-index:9';
fetch('/__dev/state.json').then((r) => r.json()).then((s) => {
  if (!s.ok) { panel.style.background = '#fee'; panel.textContent = s.message; return document.body.append(panel); }
  const rows = Object.entries(s.reports).flatMap(([ed, r]) => [
    ...r.errors.map((f) => ['error', ed, f]), ...r.warnings.map((f) => ['warning', ed, f])]);
  panel.innerHTML = rows.length ? '' : '✓ Preflight: no findings';
  for (const [kind, ed, f] of rows) {
    const line = document.createElement('div');
    line.style.color = kind === 'error' ? '#b00' : '#865';
    line.textContent = kind + ' [' + ed + ' p' + f.page + '] ' + f.rule + ': ' + f.message;
    panel.append(line);
  }
  document.body.append(panel);
});
new EventSource('/__dev/events').onmessage = () => location.reload();
`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/__dev/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/__dev/state.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(state));
  }
  if (url.pathname === '/__dev/panel.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    return res.end(DEV_SCRIPT);
  }
  const rel = normalize(decodeURIComponent(url.pathname))
    .replace(/^(\.\.[/\\])+/, '')
    .replace(/^\/+/, '');
  for (const file of [join(OUT, rel), join(OUT, rel, 'index.html')]) {
    if (!(await stat(file).catch(() => null))?.isFile()) continue;
    let body = await readFile(file);
    if (extname(file) === '.html')
      body = Buffer.from(
        body.toString().replace('</body>', '<script type="module" src="/__dev/panel.js"></script>\n</body>'),
      );
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    return res.end(body);
  }
  const notFound = await readFile(join(OUT, '404.html')).catch(() => Buffer.from(state.message ?? 'not found'));
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end(notFound.toString().replace('</body>', '<script type="module" src="/__dev/panel.js"></script>\n</body>'));
});

await rebuild();
server.listen(Number(values.port), '127.0.0.1', () =>
  console.log(`Previewing at http://localhost:${values.port}  (Ctrl+C to stop)`),
);
process.on('SIGINT', async () => {
  await browser.close();
  process.exit(0);
});
