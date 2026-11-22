# Contributing

Thank you for adding to the cookbook! Most contributions are recipes and art,
and you can make them entirely from the GitHub website or app.

## Adding a recipe

1. Open [`public/recipes/`](public/recipes/) and choose **Add file → Create new file**.
2. Name it after the dish, in lower case with dashes: `chicken-soup.md`.
3. Start from an existing recipe such as
   [`hamburg-and-rice.md`](public/recipes/hamburg-and-rice.md): a header between
   `---` lines (title, chapter, serves, prep, cook), an intro paragraph, then
   `## Ingredients` (a `-` list) and `## Method` (a `1.` list). Use
   `**bold**` for a step's lead-in and `*italics*` sparingly.
4. Add the recipe to the book's list near the top of the script in
   [`public/index.html`](public/index.html) (`RECIPES`). This step goes away
   when `book.yaml` arrives.
5. Choose **Propose changes**, then **Create pull request**. A preview link is
   posted on the pull request within a few minutes; check how it looks there.

## Adding art

- Line art: SVG. Paintings or photos: PNG or WebP, at least 300 pixels per inch
  at the size it will print.
- Put it in [`public/art/`](public/art/) and place it in a recipe with
  `![a short description](/art/your-file.svg){place=right width=40% wrap}`.
  The description is what screen readers and reader mode use, so describe what
  the picture shows.

## Only add what you made

Add only your own writing, recipes and art, or material whose licence allows
it, credited in your pull request. No images from web searches, stock sites or
scans of books and magazines. A list of ingredients can't be owned, but the
wording of someone else's method, their stories and their photos can.

## Licensing of contributions

By submitting a contribution you agree that it is your own work (or you have
the right to submit it) and that it is licensed the same way as the rest of
the project:

- **Recipes, writing and art** (`public/recipes/`, `public/art/`): dedicated to
  the public domain under [CC0 1.0](LICENSE-CONTENT).
- **Code** (everything else): licensed under [Apache-2.0](LICENSE).

## Code changes

Code, build and CI changes are reviewed by the maintainer (see
`.github/CODEOWNERS`). Run `npm test` and `npm run test:e2e` before opening a
pull request; CI runs them in Chromium, Firefox and WebKit.
