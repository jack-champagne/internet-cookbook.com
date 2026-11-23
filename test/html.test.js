import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadBook } from '../src/content/load.js';
import { escape, isoDuration, renderArticle, recipeData, sitePages } from '../src/html.js';

const REAL = new URL('../books/internet-cookbook/', import.meta.url);
const SITE = 'https://internet-cookbook.com';
let book, pie, hamburg;
before(async () => {
  book = await loadBook({ readText: (p) => readFile(new URL(p, REAL), 'utf8') });
  [pie, hamburg] = book.chapters[0].entries;
});

test('escaping and durations', () => {
  assert.equal(escape('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  assert.equal(isoDuration('30 min'), 'PT30M');
  assert.equal(isoDuration('1 hr'), 'PT1H');
  assert.equal(isoDuration('1 hr 15 min'), 'PT1H15M');
  assert.equal(isoDuration('2 hours'), 'PT2H');
  assert.equal(isoDuration('90 minutes'), 'PT1H30M');
  assert.equal(isoDuration('a while'), null);
});

test('a recipe article: header, facts, sections, lists, note, described images', () => {
  const html = renderArticle({ kind: 'recipe', entry: pie }, book);
  assert.match(html, /<article class="recipe">/);
  assert.match(html, /<h1>Shepherd&#39;s Pie<\/h1>|<h1>Shepherd's Pie<\/h1>/);
  assert.match(html, /<p class="kicker"><a href="\/chapters\/hearth-and-home\/">Hearth &amp; Home<\/a><\/p>/);
  assert.match(html, /<p class="intro">Slow-simmered lamb/);
  assert.match(html, /<li>Serves 6<\/li><li>Prep 30 min<\/li><li>Cook 1 hr<\/li>/);
  assert.match(html, /<h2>Ingredients<\/h2>\n<ul>\n {2}<li>1 kg floury potatoes/);
  assert.match(html, /<h2>Method<\/h2>[\s\S]*<ol>\n {2}<li><strong>Make the mash\.<\/strong> Boil/);
  assert.match(html, /<aside class="note"><p>Rough up the mash/);
  assert.match(
    html,
    /<img src="\/art\/shepherds-pie\.svg" alt="A dish of shepherd&#39;s pie|<img src="\/art\/shepherds-pie\.svg" alt="A dish of shepherd's pie/,
  );
  assert.ok(!html.includes('rosemary.svg'), 'decorative images are left out');
  assert.equal((html.match(/shepherds-pie\.svg/g) ?? []).length, 1, 'the plate image appears once');
  assert.equal((html.match(/Slow-simmered/g) ?? []).length, 1, 'the lede appears once');
});

test('recipe data for search engines and recipe apps', () => {
  const d = recipeData(pie, book, SITE);
  assert.equal(d['@type'], 'Recipe');
  assert.equal(d.name, "Shepherd's Pie");
  assert.equal(d.recipeYield, '6');
  assert.equal(d.prepTime, 'PT30M');
  assert.equal(d.cookTime, 'PT1H');
  assert.equal(d.recipeIngredient[0], '1 kg floury potatoes, peeled and quartered');
  assert.equal(d.recipeInstructions.length, 6);
  assert.match(d.recipeInstructions[0].text, /^Make the mash\. Boil/);
  assert.deepEqual(d.image, [`${SITE}/art/shepherds-pie.svg`]);
  assert.equal(d.url, `${SITE}/recipes/shepherds-pie/`);
  assert.equal(d.license, 'https://creativecommons.org/licenses/by-nc/4.0/');
  assert.equal(recipeData(hamburg, book, SITE).totalTime, undefined, 'absent values are left out');
});

test('the colophon states the content licence from book.yaml', () => {
  const html = renderArticle({ kind: 'colophon' }, book);
  assert.match(html, /<a href="https:\/\/creativecommons\.org\/licenses\/by-nc\/4\.0\/">CC BY-NC 4\.0<\/a>/);
  assert.ok(!html.includes('CC0'));
});

test('every address gets a complete page', () => {
  const pages = sitePages(book, SITE);
  assert.deepEqual(
    pages.map((p) => p.address),
    [
      '/',
      '/intro/',
      '/colophon/',
      '/chapters/hearth-and-home/',
      '/recipes/shepherds-pie/',
      '/recipes/hamburg-and-rice/',
    ],
  );
  const recipe = pages.find((p) => p.address === '/recipes/shepherds-pie/').html;
  assert.match(recipe, /<title>Shepherd's Pie · Internet Cookbook<\/title>/);
  assert.match(recipe, /<link rel="canonical" href="https:\/\/internet-cookbook\.com\/recipes\/shepherds-pie\/">/);
  assert.match(recipe, /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org"/);
  assert.match(recipe, /<main id="text">\n<article class="recipe">/);
  assert.match(recipe, /<script type="module" src="\/viewer\.js"><\/script>/);
  const home = pages.find((p) => p.address === '/').html;
  assert.match(home, /<title>Internet Cookbook<\/title>/);
  assert.match(home, /<a href="\/recipes\/hamburg-and-rice\/">Hamburg and Rice<\/a>/);
  assert.ok(!home.includes('application/ld+json'), 'only recipes carry recipe data');
});
