/**
 * Load and validate a book: book.yaml (structure), theme.yaml (design) and the
 * Markdown pages. Runs in Node and the browser: file access goes through
 * `readText(path)`, with paths relative to the book folder.
 *
 * Everything a reader of the error needs is reported: the file, the line, and
 * what to change. Asset paths in the result are site paths ("/art/x.svg").
 */
import { load as loadYaml } from '../vendor/js-yaml/js-yaml.mjs';
import { BookError } from './errors.js';
import { parseDocument } from './markdown.js';
import { resolveTemplate } from './theme.js';

/**
 * @typedef {import('./markdown.js').Recipe} Doc
 * @typedef {{ art: string, caption?: string }} Plate
 * @typedef {object} Entry
 * @property {'toc'|'colophon'|'prose'|'recipe'} kind
 * @property {string} slug
 * @property {string} address   site path of its article, e.g. "/recipes/shepherds-pie/"
 * @property {string} [file]    source file, relative to the book folder
 * @property {Doc} [doc]
 * @property {Plate} [plate]
 * @property {'right'|'left'|'any'} start
 * @property {string} [chapter] chapter title, for recipes
 * @typedef {{ title: string, slug: string, address: string, opener?: { art?: string }, entries: Entry[] }} Chapter
 * @typedef {object} BookData
 * @property {string} title
 * @property {string} [subtitle]
 * @property {{ name: string, url?: string }} [license] licence of the recipes, writing and art
 * @property {{ art?: string }} cover
 * @property {any} theme                 parsed theme.yaml
 * @property {string[]} editions
 * @property {Entry[]} front
 * @property {Chapter[]} chapters
 * @property {Entry[]} back
 * @property {string[]} assets           every site path the book needs (art, fonts)
 */

const BOOK_KEYS = ['title', 'subtitle', 'license', 'theme', 'cover', 'front', 'chapters', 'back'];
const CHAPTER_KEYS = ['title', 'slug', 'opener', 'entries'];
const ENTRY_KEYS = ['recipe', 'plate', 'start'];
const PAGE_KEYS = ['page', 'start'];
const RECIPE_META = ['title', 'intro', 'serves', 'time', 'prep', 'cook', 'total', 'slug', 'tags'];
const PROSE_META = ['title', 'slug'];
const STARTS = ['right', 'left', 'any'];

/** @param {string} s */
export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** First line declaring `key:` in a YAML/Markdown text, for error messages. */
const lineFinder = (/** @type {string} */ text) => (/** @type {string} */ key) => {
  const lines = text.split('\n');
  // Prefer the key at the start of a line; fall back to an inline { key: … }.
  let i = lines.findIndex((l) => new RegExp(`^\\s*(-\\s*)?${key}\\s*:`).test(l));
  if (i < 0) i = lines.findIndex((l) => new RegExp(`[{,\\s]${key}\\s*:`).test(l));
  return i >= 0 ? i + 1 : undefined;
};

/** Resolve `rel` against the folder of `from`; reject anything outside the book. */
function resolvePath(
  /** @type {string} */ from,
  /** @type {string} */ rel,
  /** @type {{ file: string, line?: number }} */ where,
) {
  if (/^[a-z]+:|^\//i.test(rel)) throw new BookError(`"${rel}" must be a path relative to the file, not a URL`, where);
  const parts = from.split('/').slice(0, -1);
  for (const p of rel.split('/')) {
    if (p === '..') {
      if (!parts.length) throw new BookError(`"${rel}" points outside the book folder`, where);
      parts.pop();
    } else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
}

/**
 * @param {{ readText: (path: string) => Promise<string>, exists?: (path: string) => Promise<boolean> | boolean,
 *   bookFile?: string }} io
 * @returns {Promise<BookData>}
 */
export async function loadBook({ readText, exists, bookFile = 'book.yaml' }) {
  /** @param {string} file */
  const read = async (file, /** @type {{ file: string, line?: number }} */ from) => {
    try {
      return await readText(file);
    } catch {
      throw new BookError(`can't read "${file}" (is the path right?)`, from);
    }
  };
  /** @param {string} text @param {string} file */
  const yaml = (text, file) => {
    try {
      return loadYaml(text);
    } catch (e) {
      const mark = /** @type {any} */ (e).mark;
      throw new BookError(`not valid YAML: ${/** @type {any} */ (e).reason ?? /** @type {Error} */ (e).message}`, {
        file,
        line: mark ? mark.line + 1 : undefined,
      });
    }
  };

  const bookText = await read(bookFile, { file: bookFile });
  const book = yaml(bookText, bookFile);
  const lineOf = lineFinder(bookText);
  /** @param {string} message @param {string} [key] */
  const fail = (message, key) => {
    throw new BookError(message, { file: bookFile, line: key ? lineOf(key) : undefined });
  };
  if (!book || typeof book !== 'object') fail('must be a set of "key: value" settings');
  for (const k of Object.keys(book)) if (!BOOK_KEYS.includes(k)) fail(`unknown setting "${k}"`, k);
  if (!book.title) fail('needs a title', 'title');
  if (book.license != null) {
    if (typeof book.license !== 'object')
      fail('license needs a name (and url), e.g. license: { name: CC BY 4.0, url: … }', 'license');
    for (const k of Object.keys(book.license))
      if (!['name', 'url'].includes(k)) fail(`unknown license setting "${k}"`, k);
    if (!book.license.name) fail('license needs a name', 'license');
  }
  if (!book.theme) fail('needs a theme (e.g. theme: theme.yaml)', 'theme');
  if (!Array.isArray(book.chapters) || !book.chapters.length) fail('needs at least one chapter', 'chapters');

  /** @type {Set<string>} */
  const assets = new Set();
  /** @param {string} rel @param {string} from @param {number} [line] */
  const asset = (rel, from, line) => {
    const path = resolvePath(from, rel, { file: from, line });
    assets.add('/' + path);
    return '/' + path;
  };

  // Theme: validate every edition now, so errors show before any layout.
  const themeFile = resolvePath(bookFile, book.theme, { file: bookFile, line: lineOf('theme') });
  const themeText = await read(themeFile, { file: bookFile, line: lineOf('theme') });
  const theme = yaml(themeText, themeFile);
  const editions = Object.keys(theme?.editions ?? {});
  if (!editions.length) throw new BookError('needs at least one edition under editions', { file: themeFile });
  const themeDir = themeFile.split('/').slice(0, -1).join('/');
  const themeBase = '/' + (themeDir ? themeDir + '/' : '');
  for (const ed of editions)
    resolveTemplate(theme, ed, { file: themeFile, siteBase: themeBase, lineOf: lineFinder(themeText) });
  for (const f of Object.values(theme.fonts ?? {})) {
    if (f && typeof f === 'object') for (const file of f.files ?? []) asset(file.src, themeFile);
  }

  /** @type {Record<string, Set<string>>} */
  const slugs = { recipe: new Set(), prose: new Set(), chapter: new Set() };
  /** @param {'recipe'|'prose'|'chapter'} kind @param {string} slug @param {{ file: string, line?: number }} where */
  const claim = (kind, slug, where) => {
    if (!slug) throw new BookError(`can't make an address from an empty ${kind} title`, where);
    if (slugs[kind].has(slug))
      throw new BookError(`two ${kind}s share the address "${slug}"; give one a different slug`, where);
    slugs[kind].add(slug);
  };

  /** @param {string} file @param {'recipe'|'prose'} kind @param {{ file: string, line?: number }} from */
  const loadDoc = async (file, kind, from) => {
    const text = await read(file, from);
    /** @type {Doc} */
    let doc;
    try {
      doc = parseDocument(text);
    } catch (e) {
      throw new BookError(/** @type {Error} */ (e).message.replace(/^Recipe header/, 'header'), { file, line: 2 });
    }
    const docLine = lineFinder(text);
    const allowed = kind === 'recipe' ? RECIPE_META : PROSE_META;
    for (const k of Object.keys(doc.meta))
      if (!allowed.includes(k))
        throw new BookError(`unknown header "${k}" (allowed: ${allowed.join(', ')})`, { file, line: docLine(k) });
    if (kind === 'recipe' && !doc.meta.title)
      throw new BookError('a recipe needs a title in its header', { file, line: 1 });
    for (const b of doc.blocks) {
      if (b.type !== 'image') continue;
      if (!b.attrs.decor && !b.alt.trim())
        throw new BookError(
          `image "${b.src}" needs a description: ![what the picture shows](${b.src}) (or mark it decor)`,
          { file, line: b.line },
        );
      b.src = asset(b.src, file, b.line);
    }
    return doc;
  };

  /** @param {any} item @param {'front'|'back'} where @returns {Promise<Entry>} */
  const frontBack = async (item, where) => {
    if (item === 'toc') return { kind: 'toc', slug: 'contents', address: '/', start: 'any' };
    if (item === 'colophon') return { kind: 'colophon', slug: 'colophon', address: '/colophon/', start: 'any' };
    if (item && typeof item === 'object' && item.page) {
      for (const k of Object.keys(item)) if (!PAGE_KEYS.includes(k)) fail(`${where}: unknown setting "${k}"`, k);
      if (item.start && !STARTS.includes(item.start)) fail(`start must be one of ${STARTS.join(', ')}`, 'start');
      const file = resolvePath(bookFile, item.page, { file: bookFile, line: lineOf('page') });
      const doc = await loadDoc(file, 'prose', { file: bookFile, line: lineOf('page') });
      const slug = doc.meta.slug ? slugify(doc.meta.slug) : slugify(file.split('/').pop()?.replace(/\.md$/, '') ?? '');
      claim('prose', slug, { file });
      return { kind: 'prose', slug, address: `/${slug}/`, file, doc, start: item.start ?? 'any' };
    }
    return fail(`${where}: each item is toc, colophon or "page: file.md"`, where);
  };

  const front = [];
  for (const item of book.front ?? []) front.push(await frontBack(item, 'front'));
  const back = [];
  for (const item of book.back ?? []) back.push(await frontBack(item, 'back'));

  /** @type {Chapter[]} */
  const chapters = [];
  for (const ch of book.chapters) {
    if (!ch || typeof ch !== 'object') fail('each chapter needs a title and entries', 'chapters');
    for (const k of Object.keys(ch)) if (!CHAPTER_KEYS.includes(k)) fail(`chapter: unknown setting "${k}"`, k);
    if (!ch.title) fail('each chapter needs a title', 'chapters');
    const slug = slugify(ch.slug ?? ch.title);
    claim('chapter', slug, { file: bookFile, line: lineOf('title') });
    const opener = ch.opener
      ? { art: ch.opener.art ? asset(ch.opener.art, bookFile, lineOf('opener')) : undefined }
      : undefined;
    const entries = [];
    for (const e of ch.entries ?? []) {
      if (!e?.recipe) fail(`chapter "${ch.title}": each entry is "recipe: file.md"`, 'entries');
      for (const k of Object.keys(e)) if (!ENTRY_KEYS.includes(k)) fail(`entry: unknown setting "${k}"`, k);
      if (e.start && !STARTS.includes(e.start)) fail(`start must be one of ${STARTS.join(', ')}`, 'start');
      const file = resolvePath(bookFile, e.recipe, { file: bookFile, line: lineOf('recipe') });
      const doc = await loadDoc(file, 'recipe', { file: bookFile, line: lineOf('recipe') });
      const rslug = slugify(doc.meta.slug ?? file.split('/').pop()?.replace(/\.md$/, '') ?? '');
      claim('recipe', rslug, { file });
      const plate = e.plate
        ? {
            art: asset(e.plate.art, bookFile, lineOf('plate')),
            ...(e.plate.caption ? { caption: String(e.plate.caption) } : {}),
          }
        : undefined;
      entries.push({
        kind: /** @type {const} */ ('recipe'),
        slug: rslug,
        address: `/recipes/${rslug}/`,
        file,
        doc,
        ...(plate ? { plate } : {}),
        start: plate ? 'right' : (e.start ?? 'any'),
        chapter: String(ch.title),
      });
    }
    if (!entries.length) fail(`chapter "${ch.title}" has no entries`, 'entries');
    chapters.push({
      title: String(ch.title),
      slug,
      address: `/chapters/${slug}/`,
      ...(opener ? { opener } : {}),
      entries,
    });
  }

  const cover = { ...(book.cover?.art ? { art: asset(book.cover.art, bookFile, lineOf('art')) } : {}) };

  if (exists) {
    for (const path of assets)
      if (!(await exists(path.slice(1)))) throw new BookError(`missing file "${path.slice(1)}"`, { file: bookFile });
  }

  return {
    title: String(book.title),
    ...(book.subtitle ? { subtitle: String(book.subtitle) } : {}),
    ...(book.license
      ? {
          license: {
            name: String(book.license.name),
            ...(book.license.url ? { url: String(book.license.url) } : {}),
          },
        }
      : {}),
    cover,
    theme,
    editions,
    front,
    chapters,
    back,
    assets: [...assets].sort(),
  };
}

/** All entries in reading order (front, chapters' recipes, back). @param {BookData} book */
export const allEntries = (book) => [...book.front, ...book.chapters.flatMap((c) => c.entries), ...book.back];
