/**
 * Page types. Flowing documents (recipes, prose) lay out into a Flow and may
 * span pages; fixed pages (covers, endpapers, title, plate, chapter opener,
 * colophon) are single pages composed from the template.
 *
 * Every function returns page descriptions: items in points, images by `src`.
 */
import { Flow, flowText, flowIngredients, placeImage, emptyPage } from './flow.js';
import { MEASURE, SLACK, fontOf, measureItems } from './text.js';
import { prepareRichInline, measureRichInlineStats } from '../vendor/pretext/dist/rich-inline.js';

/** @typedef {Map<string, { naturalWidth: number, naturalHeight: number }>} Images */

const ratioOf = (/** @type {Images} */ images, /** @type {string} */ src) => {
  const img = images.get(src);
  return img ? img.naturalHeight / img.naturalWidth : null;
};

/** An image item `w` wide at (x, y), or nothing if the image didn't load. */
const art = (/** @type {Images} */ images, /** @type {string|undefined} */ src, x, y, w, extra = {}) => {
  const r = src ? ratioOf(images, src) : null;
  return r == null ? [] : [{ type: 'image', src, x, y, w, h: w * r, ...extra }];
};

/**
 * Lay out a recipe or prose document starting on a fresh page of `side`.
 * Recipes get a header (chapter, title, intro, servings and times between
 * rules), ingredient lists in balanced columns, numbered steps, and notes
 * that keep with their step.
 * @param {any} tpl @param {any} doc @param {Images} images
 * @param {{ kind: 'recipe'|'prose', side: 'left'|'right', chapter?: string }} opts
 */
export function documentPages(tpl, doc, images, { kind, side, chapter }) {
  const flow = new Flow(tpl, side);
  const S = tpl.styles,
    C = tpl.colors,
    { meta } = doc;

  if (kind === 'recipe' && chapter) {
    flowText(flow, [{ text: chapter }], S.kicker);
    flow.y += 4;
  }
  if (meta.title) {
    flowText(flow, [{ text: String(meta.title) }], S.title);
    flow.y += 6;
  }
  if (kind === 'recipe' && meta.intro) {
    flowText(flow, [{ text: String(meta.intro) }], S.lede);
    flow.y += 4;
  }
  let seenHeading = false,
    metaDone = kind !== 'recipe';
  const metaLine = () => {
    if (metaDone) return;
    metaDone = true;
    const parts = [
      ['Serves', meta.serves],
      ['Prep', meta.prep],
      ['Cook', meta.cook],
      ['Total', meta.total],
    ]
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k} ${v}`);
    if (!parts.length) return;
    const { x0, x1 } = flow.box;
    flow.y += 4;
    flow.add({ type: 'rule', x: x0, y: flow.y, w: x1 - x0, color: C.rule });
    flow.y += 6;
    flowText(flow, [{ text: parts.join('   ·   ') }], S.meta);
    flow.y += 5;
    flow.add({ type: 'rule', x: x0, y: flow.y, w: x1 - x0, color: C.rule });
    flow.y += 4;
  };

  /** @type {any} */
  let lastStep = null;
  const placeStep = (/** @type {any[]} */ runs, /** @type {number} */ n) => {
    const st = S.step,
      num = S.stepNumber;
    flowText(flow, runs, st, {
      indent: tpl.steps.indent,
      onFirstLine: (x0, baseline) =>
        flow.add({ type: 'text', x: x0, y: baseline, text: `${n}`, font: fontOf(num), color: num.color, number: true }),
    });
    flow.y += st.spaceAfter ?? 0;
  };

  for (const b of doc.blocks) {
    if (b.type === 'paragraph') {
      if (kind === 'recipe' && !seenHeading && !meta.intro) {
        flowText(flow, b.runs, S.lede);
        flow.y += 4;
      } else {
        flowText(flow, b.runs, S.body);
        flow.y += 6;
      }
    } else if (b.type === 'heading') {
      metaLine();
      seenHeading = true;
      const st = S.heading;
      flow.space(st.spaceBefore ?? 0);
      if (!flow.fits(st.leading + S.body.leading * 2)) flow.newPage(); // keep with next
      flowText(flow, b.runs, st);
      flow.y += st.spaceAfter ?? 0;
    } else if (b.type === 'list' && !b.ordered) {
      flowIngredients(flow, b.items, S.body, tpl.ingredients);
    } else if (b.type === 'list') {
      b.items.forEach((/** @type {any[]} */ runs, /** @type {number} */ i) => {
        if (!flow.fits(S.step.leading * 2)) flow.newPage(); // no lonely first lines
        // Remember where the last step began, so a following note can pull it
        // onto the next page rather than sit there alone.
        lastStep = { runs, number: i + 1, page: flow.page, items: flow.page.items.length, y: flow.y };
        placeStep(runs, i + 1);
      });
      continue; // keep lastStep for a note that directly follows
    } else if (b.type === 'note') {
      flow.clearFloats();
      const { x0, x1 } = flow.box,
        indent = (x1 - x0) * tpl.note.indent;
      const prepared = prepareRichInline(measureItems(b.runs, S.note));
      const lines = measureRichInlineStats(prepared, (x1 - x0 - indent - SLACK) * MEASURE).lineCount;
      const height = 10 + lines * S.note.leading;
      if (!flow.fits(height) && lastStep && lastStep.page === flow.page && lastStep.y > flow.box.top + 0.01) {
        // Keep the note with its step: set the step again on the next page.
        flow.page.items.length = lastStep.items;
        flow.y = lastStep.y;
        flow.newPage();
        placeStep(lastStep.runs, lastStep.number);
      }
      flow.space(10);
      flowText(flow, b.runs, S.note, { indent });
      flow.y += 6;
    } else if (b.type === 'image') {
      placeImage(flow, b, images);
    }
    lastStep = null;
  }
  metaLine();
  return flow.pages;
}

/** Outside of a cover board. side 'front' carries the title; 'back' an emblem and colophon lines. */
export function boardPage(
  /** @type {any} */ tpl,
  /** @type {Images} */ images,
  { which, title, subtitle, art: src, lines = [] },
) {
  const { width: W, height: H } = tpl.page,
    S = tpl.styles,
    B = tpl.cover;
  const page = emptyPage(tpl, which === 'front' ? 'right' : 'left');
  page.items.push({ type: 'fill', color: B.cloth }, { type: 'frame', inset: Math.round(W * 0.05), color: B.frame });
  if (which === 'front') {
    const big = { ...S.title, size: S.title.size * 1.25 };
    page.items.push(
      { type: 'text', x: W / 2, y: H * 0.36, text: title, font: fontOf(big), color: B.title, align: 'center' },
      {
        type: 'text',
        x: W / 2,
        y: H * 0.36 + big.size * 0.9,
        text: subtitle ?? '',
        font: fontOf(S.lede),
        color: B.subtitle,
        align: 'center',
      },
      ...art(images, src, W * 0.29, H * 0.56, W * 0.42, { rotate: -8, tint: B.title }),
    );
  } else {
    page.items.push(...art(images, src, W * 0.39, H * 0.44, W * 0.22, { rotate: -8, tint: B.subtitle }));
    lines.forEach((/** @type {string} */ text, /** @type {number} */ i) =>
      page.items.push({
        type: 'text',
        x: W / 2,
        y: H * 0.56 + i * S.folio.leading * 1.3,
        text,
        font: fontOf(S.folio),
        color: B.subtitle,
        align: 'center',
      }),
    );
  }
  return page;
}

/** Endpaper: the inside of a cover board, a quiet repeating motif. */
export function endpaperPage(/** @type {any} */ tpl, /** @type {Images} */ images, { side, art: src }) {
  const { width: W, height: H } = tpl.page,
    E = tpl.endpaper;
  const page = emptyPage(tpl, side);
  page.items.push({ type: 'fill', color: E.paper });
  const w = W / 5.5,
    stepX = W / 3.2,
    stepY = H / 6;
  for (let row = -1, y = -stepY / 3; y < H; row++, y += stepY) {
    for (let x = (row % 2 ? stepX / 2 : 0) - w / 2; x < W; x += stepX) {
      page.items.push(...art(images, src, x, y, w, { rotate: row % 2 ? 24 : -18, tint: E.motif, opacity: 0.55 }));
    }
  }
  return page;
}

/** Title page: the first page of the contents, on the right. */
export function titlePage(/** @type {any} */ tpl, { title, subtitle }) {
  const { width: W, height: H } = tpl.page,
    S = tpl.styles,
    C = tpl.colors;
  const page = emptyPage(tpl, 'right');
  const y = H * 0.42;
  page.items.push(
    { type: 'text', x: W / 2, y, text: title, font: fontOf(S.title), color: C.ink, align: 'center' },
    { type: 'rule', x: W * 0.42, y: y + S.title.size * 0.55, w: W * 0.16, color: C.rule },
  );
  if (subtitle)
    page.items.push({
      type: 'text',
      x: W / 2,
      y: y + S.title.size * 0.55 + S.lede.leading * 1.4,
      text: subtitle,
      font: fontOf(S.lede),
      color: C.muted,
      align: 'center',
    });
  return page;
}

/** A full-page illustration with a caption, on a left page facing its recipe. */
export function platePage(/** @type {any} */ tpl, /** @type {Images} */ images, { art: src, caption, side }) {
  const { width: W, height: H } = tpl.page,
    S = tpl.styles,
    C = tpl.colors;
  const page = emptyPage(tpl, side);
  const w = W * 0.78,
    r = ratioOf(images, src) ?? 0.7,
    h = w * r;
  const y = (H - h) / 2 - S.lede.size;
  page.items.push(...art(images, src, (W - w) / 2, y, w, { alt: caption ?? '' }));
  if (caption)
    page.items.push({
      type: 'text',
      x: W / 2,
      y: y + h + S.lede.leading * 1.6,
      text: caption,
      font: fontOf(S.lede),
      color: C.muted,
      align: 'center',
    });
  return page;
}

/** Chapter opener: the chapter's number and title, with optional art. */
export function openerPage(/** @type {any} */ tpl, /** @type {Images} */ images, { number, title, art: src, side }) {
  const { width: W, height: H } = tpl.page,
    S = tpl.styles,
    C = tpl.colors;
  const page = emptyPage(tpl, side);
  const big = { ...S.title, size: S.title.size * 1.15 };
  page.items.push(
    {
      type: 'text',
      x: W / 2,
      y: H * 0.36,
      text: `CHAPTER ${String(number).toUpperCase()}`,
      font: fontOf(S.kicker),
      color: S.kicker.color,
      letterSpacing: S.kicker.letterSpacing,
      align: 'center',
    },
    {
      type: 'text',
      x: W / 2,
      y: H * 0.36 + big.size * 1.1,
      text: title,
      font: fontOf(big),
      color: C.ink,
      align: 'center',
    },
    ...art(images, src, W * 0.36, H * 0.52, W * 0.28, { rotate: -8, tint: C.muted }),
  );
  return page;
}

/** Colophon: how the book was made. */
export function colophonPage(/** @type {any} */ tpl, { side, title, lines }) {
  const { width: W, height: H } = tpl.page,
    S = tpl.styles,
    C = tpl.colors;
  const page = emptyPage(tpl, side);
  const all = [title, '', ...lines];
  const top = H / 2 - (all.length * S.body.leading) / 2;
  all.forEach((text, i) => {
    if (text)
      page.items.push({
        type: 'text',
        x: W / 2,
        y: top + i * S.body.leading,
        text,
        font: fontOf(i === 0 ? S.heading : S.folio),
        color: i === 0 ? C.ink : C.muted,
        align: 'center',
      });
  });
  return page;
}

/**
 * Table of contents: one line per entry with its page number at the right.
 * @param {any} tpl @param {{ text: string, level: 0|1, page: number }[]} lines @param {'left'|'right'} side
 */
export function tocPages(tpl, lines, side) {
  const flow = new Flow(tpl, side);
  const S = tpl.styles,
    C = tpl.colors;
  flowText(flow, [{ text: 'Contents' }], S.title);
  flow.y += 14;
  for (const l of lines) {
    const st = l.level === 0 ? S.heading : S.body;
    if (l.level === 0) flow.space(8);
    const res = flowText(flow, [{ text: l.text }], st, { indent: l.level ? 14 : 0, reserve: 40 });
    if (res)
      res.page.items.push({
        type: 'text',
        x: res.page.box.x1,
        y: res.lastBaseline,
        text: String(l.page),
        font: fontOf(S.body),
        color: C.muted,
        align: 'right',
      });
    flow.y += l.level === 0 ? 2 : 1;
  }
  return flow.pages;
}

/** A blank page. */
export const blankPage = (/** @type {any} */ tpl, /** @type {'left'|'right'} */ side) => emptyPage(tpl, side);
