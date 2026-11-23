import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseLength, parseTrim, parsePercent, attrLength, parseUnicodeRange, inRanges } from '../src/content/units.js';
import { loadBook, allEntries, slugify } from '../src/content/load.js';
import { resolveTemplate } from '../src/content/theme.js';

const REAL = new URL('../books/internet-cookbook/', import.meta.url);
const realIO = {
  readText: (p) => readFile(new URL(p, REAL), 'utf8'),
  exists: (p) => existsSync(new URL(p, REAL)),
};

test('units: lengths, trims, percentages, attributes, Unicode ranges', () => {
  assert.equal(parseLength('58pt'), 58);
  assert.equal(parseLength('0.125in'), 9);
  assert.ok(Math.abs(parseLength('25.4mm') - 72) < 1e-9);
  assert.throws(() => parseLength(12), /needs a unit/);
  assert.throws(() => parseLength('12px'), /not a length/);
  assert.deepEqual(parseTrim('8 x 10 in'), { width: 576, height: 720 });
  assert.deepEqual(parseTrim('4.5×7.5in'), { width: 324, height: 540 });
  assert.equal(parsePercent('38%'), 0.38);
  assert.equal(attrLength('50%', 200), 100);
  assert.equal(attrLength('-12', 200), -12);
  assert.equal(attrLength('1in', 200), 72);
  const r = parseUnicodeRange('U+0000-00FF, U+2013');
  assert.deepEqual(r, [
    [0, 255],
    [0x2013, 0x2013],
  ]);
  assert.ok(inRanges('½'.codePointAt(0), r));
  assert.ok(!inRanges('ñ'.codePointAt(0) + 0x1000, r));
});

test('slugs', () => {
  assert.equal(slugify("Shepherd's Pie"), 'shepherds-pie');
  assert.equal(slugify('Hearth & Home'), 'hearth-and-home');
});

test('the real book loads, with every asset present', async () => {
  const book = await loadBook(realIO);
  assert.equal(book.title, 'Internet Cookbook');
  assert.deepEqual(book.license, { name: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/' });
  assert.deepEqual(book.editions, ['book', 'phone']);
  const entries = allEntries(book);
  assert.deepEqual(
    entries.map((e) => e.address),
    ['/', '/intro/', '/recipes/shepherds-pie/', '/recipes/hamburg-and-rice/', '/colophon/'],
  );
  const pie = entries.find((e) => e.slug === 'shepherds-pie');
  assert.equal(pie.start, 'right', 'a recipe with a plate starts on the right');
  assert.equal(pie.chapter, 'Hearth & Home');
  assert.equal(pie.plate.art, '/art/shepherds-pie.svg');
  assert.ok(book.assets.includes('/fonts/crimson-pro-normal-400.woff2'));
  assert.ok(book.assets.includes('/art/rosemary.svg'));
  assert.equal(book.chapters[0].address, '/chapters/hearth-and-home/');
});

test('the real theme resolves both editions in points', async () => {
  const book = await loadBook(realIO);
  const t = resolveTemplate(book.theme, 'book');
  assert.equal(t.page.width, 576);
  assert.equal(t.page.height, 720);
  assert.equal(t.page.margin.inside, 56);
  assert.equal(t.page.bleed, 9);
  assert.equal(t.styles.body.family, '"Crimson Pro"');
  assert.equal(t.styles.kicker.letterSpacing, 1.8);
  assert.equal(t.styles.lede.color, '#4a453d');
  assert.equal(t.note.indent, 0.38);
  const p = resolveTemplate(book.theme, 'phone');
  assert.equal(p.page.width, 324);
  assert.equal(p.styles.title.size, 32, 'edition override');
  assert.equal(p.styles.title.weight, 600, 'base value kept under override');
  assert.equal(p.ingredients.columns, 1);
  assert.ok(t.unicodeRanges.length > 5);
});

// A minimal in-memory book; each test changes one file.
const THEME = `fonts:
  text: { family: Serif, files: [{ src: f.woff2 }] }
editions:
  book: { trim: 6 x 9 in, margins: { top: 1in, bottom: 1in, inside: 1in, outside: 1in } }
styles:
${['kicker', 'title', 'lede', 'meta', 'heading', 'body', 'step', 'stepNumber', 'note', 'folio']
  .map((s) => `  ${s}: { font: text, size: 10pt, leading: 12pt }`)
  .join('\n')}
`;
const BASE = {
  'book.yaml': 'title: T\ntheme: theme.yaml\nchapters:\n  - title: C\n    entries:\n      - recipe: a.md\n',
  'theme.yaml': THEME,
  'a.md': '---\ntitle: A\n---\n\n## Method\n\n1. Do it.\n',
  'f.woff2': 'x',
};
const io = (changes = {}) => {
  const files = { ...BASE, ...changes };
  return {
    readText: async (p) => {
      if (!(p in files)) throw new Error('missing');
      return files[p];
    },
    exists: (p) => p in files,
  };
};
const fails = (changes, pattern) => assert.rejects(loadBook(io(changes)), pattern);

test('a minimal book loads', async () => {
  const b = await loadBook(io());
  assert.equal(b.chapters[0].entries[0].address, '/recipes/a/');
});

test('validation: book.yaml', async () => {
  await fails({ 'book.yaml': BASE['book.yaml'] + 'colour: red\n' }, /book\.yaml:7: unknown setting "colour"/);
  await fails({ 'book.yaml': BASE['book.yaml'] + 'license:\n  url: https://example.com/\n' }, /license needs a name/);
  await fails(
    { 'book.yaml': BASE['book.yaml'] + 'license:\n  name: X\n  kind: y\n' },
    /unknown license setting "kind"/,
  );
  await fails({ 'book.yaml': 'theme: theme.yaml\nchapters: []\n' }, /needs a title/);
  await fails({ 'book.yaml': 'title: T\ntheme: theme.yaml\nchapters: [\n' }, /book\.yaml:\d+: not valid YAML/);
  await fails({ 'book.yaml': BASE['book.yaml'].replace('a.md', 'missing.md') }, /can't read "missing\.md"/);
  await fails({ 'book.yaml': BASE['book.yaml'].replace('a.md', '../a.md') }, /outside the book folder/);
  await fails(
    { 'book.yaml': BASE['book.yaml'] + '      - recipe: b.md\n', 'b.md': '---\ntitle: B\nslug: a\n---\n' },
    /share the address "a"/,
  );
  await fails(
    { 'book.yaml': BASE['book.yaml'].replace('- recipe: a.md', '- recipe: a.md\n        start: middle') },
    /start must be/,
  );
});

test('validation: recipes', async () => {
  await fails({ 'a.md': '---\ntitle: A\nchapter: X\n---\n' }, /a\.md:3: unknown header "chapter"/);
  await fails({ 'a.md': '---\nserves: 2\n---\n' }, /needs a title/);
  await fails(
    { 'a.md': '---\ntitle: A\n---\n\n![](pic.svg){place=right}\n', 'pic.svg': '<svg/>' },
    /a\.md:5: image "pic\.svg" needs a description/,
  );
  await fails({ 'a.md': '---\ntitle: A\n---\n\n![a dish](gone.svg)\n' }, /missing file "gone\.svg"/);
  const ok = await loadBook(
    io({ 'a.md': '---\ntitle: A\n---\n\n![](sprig.svg){decor x=10%}\n', 'sprig.svg': '<svg/>' }),
  );
  assert.equal(ok.chapters[0].entries[0].doc.blocks[0].src, '/sprig.svg', 'decorative images need no description');
});

test('validation: theme', async () => {
  await fails({ 'theme.yaml': THEME.replace('6 x 9 in', '6 by 9') }, /theme\.yaml:\d+: edition "book" trim/);
  await fails({ 'theme.yaml': THEME.replace('top: 1in', 'top: 72') }, /margins\.top: "72" needs a unit/);
  await fails(
    { 'theme.yaml': THEME.replace('  body: { font: text', '  body: { font: fancy') },
    /font "fancy" isn't defined/,
  );
  await fails({ 'theme.yaml': THEME.replace(/\n {2}folio:.*/, '') }, /missing text style "folio"/);
  await fails({ 'theme.yaml': THEME + 'sparkle: true\n' }, /unknown setting "sparkle"/);
});
