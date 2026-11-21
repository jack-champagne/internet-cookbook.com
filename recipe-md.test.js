import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRecipe, parseInline, parseAttrs } from './public/recipe-md.js';

test('parseAttrs: flags, values and quoted values', () => {
  assert.deepEqual(parseAttrs('place=right width=40% wrap'), { place: 'right', width: '40%', wrap: true });
  assert.deepEqual(parseAttrs('decor x=-5% y=-20 rotate=-12 caption="a b"'), { decor: true, x: '-5%', y: '-20', rotate: '-12', caption: 'a b' });
  assert.deepEqual(parseAttrs(''), {});
});

test('parseInline: bold, italic and plain runs', () => {
  assert.deepEqual(parseInline('**Make the mash.** Boil until *tender*.'), [
    { text: 'Make the mash.', bold: true, italic: false },
    { text: ' Boil until ', bold: false, italic: false },
    { text: 'tender', bold: false, italic: true },
    { text: '.', bold: false, italic: false },
  ]);
});

test('parseRecipe: front matter, block types and list continuation lines', () => {
  const r = parseRecipe(`---
title: "Test Pie"
serves: 4
---

An intro
over two lines.

## Ingredients

- 1 egg
- 2 potatoes,
  peeled

## Method

![dish](/art/dish.svg){place=right width=40% wrap}

1. **Boil.** Water.
2. Mash.

> a note

![](/art/sprig.svg){decor x=60%}
`);
  assert.deepEqual(r.meta, { title: 'Test Pie', serves: '4' });
  assert.deepEqual(r.blocks.map((b) => b.type), ['paragraph', 'heading', 'list', 'heading', 'image', 'list', 'note', 'image']);
  assert.equal(r.blocks[0].runs[0].text, 'An intro over two lines.');
  assert.equal(r.blocks[2].ordered, false);
  assert.equal(r.blocks[2].items[1][0].text, '2 potatoes, peeled');
  assert.deepEqual(r.blocks[4].attrs, { place: 'right', width: '40%', wrap: true });
  assert.equal(r.blocks[5].ordered, true);
  assert.equal(r.blocks[5].items.length, 2);
  assert.equal(r.blocks[7].attrs.decor, true);
});

test('the shipped shepherd\'s pie recipe parses', () => {
  const r = parseRecipe(readFileSync(new URL('./public/recipes/shepherds-pie.md', import.meta.url), 'utf8'));
  assert.equal(r.meta.title, "Shepherd's Pie");
  const lists = r.blocks.filter((b) => b.type === 'list');
  assert.equal(lists.length, 2);
  assert.ok(lists[0].items.length >= 10);
  assert.ok(lists[1].ordered && lists[1].items.length >= 5);
  assert.ok(r.blocks.some((b) => b.type === 'image' && b.attrs.wrap));
});
