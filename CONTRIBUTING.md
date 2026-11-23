# Contributing

Thank you for adding to the cookbook! Most contributions are recipes and art,
and you can make them entirely from the GitHub website or app.

## Adding a recipe

The book lives in [`books/internet-cookbook/`](books/internet-cookbook/). A recipe
is one Markdown file plus one line in `book.yaml`.

1. Open the chapter's folder, e.g.
   [`chapters/hearth-and-home/`](books/internet-cookbook/chapters/hearth-and-home/),
   and choose **Add file → Create new file**.
2. Name it after the dish, in lower case with dashes: `chicken-soup.md`. The
   name becomes its address: `internet-cookbook.com/recipes/chicken-soup/`.
3. Start from an existing recipe such as
   [`hamburg-and-rice.md`](books/internet-cookbook/chapters/hearth-and-home/hamburg-and-rice.md):
   a header between `---` lines (`title`, and any of `serves`, `prep`, `cook`,
   `total`, `intro`), an intro paragraph, then `## Ingredients` (a `-` list) and
   `## Method` (a `1.` list). Use `**bold**` for a step's lead-in and
   `*italics*` sparingly. A paragraph starting `> ` is a handwritten note.
4. Add it to [`book.yaml`](books/internet-cookbook/book.yaml) under its chapter,
   where it should appear in the book:

   ```yaml
       entries:
         - recipe: chapters/hearth-and-home/chicken-soup.md
   ```

   To give it a full-page picture facing it, add a plate:
   `{ recipe: …, plate: { art: art/chicken-soup.png, caption: … } }`.
5. Choose **Propose changes**, then **Create pull request**. Within a few
   minutes a preview link is posted on the pull request. If the book breaks a
   layout rule (text past a margin, a recipe starting on the wrong page…), the
   check on the pull request fails and its log says which file and line to fix.

A new chapter is a `- title: …` entry under `chapters:` with its own
`entries:`; its recipes can live in a new folder under `chapters/`.

## Adding art

- Line art: SVG. Paintings or photos: PNG or WebP, at least 300 pixels per inch
  at the size it will print, in the sRGB colour space (conversion for printing
  happens at print time).
- Put it in [`art/`](books/internet-cookbook/art/) and place it in a recipe with
  `![a short description](../../art/your-file.svg){place=right width=40% wrap}`
  (the path is relative to the recipe). The description is what screen readers
  and reader mode use, so describe what the picture shows. A purely decorative
  sprig or flourish is `![](../../art/sprig.svg){decor x=48% y=10 width=36%}`.
- Add a line for it to [`CREDITS.md`](CREDITS.md).

## Only add what you made

Add only your own writing, recipes and art, or material whose licence allows
it, credited in your pull request. No images from web searches, stock sites or
scans of books and magazines. A list of ingredients can't be owned, but the
wording of someone else's method, their stories and their photos can.

## Licensing of contributions

By submitting a contribution you agree that it is your own work (or you have
the right to submit it) and that it is licensed the same way as the rest of
the project:

- **Recipes, writing and art** (`books/`, apart from `fonts/`): you keep the
  copyright, and license it to everyone under
  [CC BY-NC 4.0](LICENSE-CONTENT): anyone may share and adapt it with credit,
  but not commercially. You also give the project's maintainer (Jack
  Champagne) permission to use it commercially as part of the book, for
  example to print and sell copies, and to relicense it for that purpose.
- **Code** (everything else): licensed under [Apache-2.0](LICENSE).

## Code changes

Code, build and CI changes are reviewed by the maintainer (see
`.github/CODEOWNERS`). Run `npm run lint`, `npm test`, `npm run build` and
`npm run test:e2e` before opening a pull request; CI runs the browser tests in
Chromium, Firefox and WebKit.
