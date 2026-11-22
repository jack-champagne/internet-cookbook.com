import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the site serves exact copies of the root licence files', () => {
  assert.equal(read('./public/legal/LICENSE.txt'), read('./LICENSE'));
  assert.equal(read('./public/legal/LICENSE-CONTENT.txt'), read('./LICENSE-CONTENT'));
  assert.equal(read('./public/legal/NOTICE.txt'), read('./NOTICE'));
});

test('every page references only files that exist', () => {
  for (const page of ['index.html', 'licenses.html', '404.html']) {
    const html = read(`./public/${page}`);
    for (const [, ref] of html.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)) {
      const file = ref === '/' ? '/index.html' : ref;
      assert.doesNotThrow(() => readFileSync(new URL(`./public${file}`, import.meta.url)), `${page} → ${ref}`);
    }
  }
});
