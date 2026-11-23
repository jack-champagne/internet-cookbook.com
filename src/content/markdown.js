/**
 * recipe-md.js — parse a recipe written in a small Markdown dialect.
 *
 *   ---                      front matter: `key: value` lines
 *   title: Shepherd's Pie
 *   serves: 6
 *   ---
 *   Intro paragraph.          paragraphs before the first heading = the lede
 *   ## Ingredients            headings (#, ##, ###)
 *   - 1 kg potatoes           bullet list
 *   1. **Make the mash.** …   numbered list (steps); *italic*, **bold**
 *   > A margin note.          note (set in the handwritten face)
 *   ![alt](src){attrs}        image anchored at this point in the flow
 *
 * Image attributes: `place=left|right|center width=40% wrap` for images in
 * the text, `decor x=60% y=-20 width=30% rotate=-10 layer=below` for
 * decorative art positioned freely relative to its anchor.
 *
 * The front matter is YAML, so nested values work:
 *   time: { prep: 30 min, cook: 1 hr }
 *
 * Output is content only - no layout decisions are made here.
 */
import { load as loadYaml } from '../vendor/js-yaml/js-yaml.mjs';

/** @typedef {{ text: string, bold: boolean, italic: boolean }} Run  A span of inline text. */
/** @typedef {Record<string, string | true>} Attrs  Image attributes, e.g. { place: 'right', wrap: true }. */
/**
 * @typedef {({ type: 'heading', level: number, runs: Run[] }
 *   | { type: 'image', alt: string, src: string, attrs: Attrs }
 *   | { type: 'list', ordered: boolean, items: Run[][] }
 *   | { type: 'note', runs: Run[] }
 *   | { type: 'paragraph', runs: Run[] }) & { line: number }} Block
 *   `line` is the block's 1-based line in the file, for error messages.
 */
/** @typedef {{ meta: Record<string, any>, blocks: Block[], bodyLine: number }} Recipe */

const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?\s*$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
const NOTE = /^>\s?(.*)$/;

/**
 * `place=right width=40% wrap` → { place: 'right', width: '40%', wrap: true }
 * @param {string} [src]
 * @returns {Attrs}
 */
export function parseAttrs(src = '') {
  /** @type {Attrs} */
  const attrs = {};
  for (const m of src.matchAll(/([\w-]+)(?:=("[^"]*"|\S+))?/g)) {
    attrs[m[1]] = m[2] === undefined ? true : m[2].replace(/^"|"$/g, '');
  }
  return attrs;
}

/**
 * Inline emphasis: `**bold**` and `*italic*` → [{ text, bold, italic }].
 * A marker opens only when followed by a non-space and closed by a matching
 * marker later on (so `2 * 3` and a stray `*` stay literal), and closes only
 * after a non-space. `\*` (and `\\`, `\_`) is a literal character.
 * @param {string} src
 * @returns {Run[]}
 */
export function parseInline(src) {
  /** @type {Run[]} */
  const runs = [];
  let bold = false,
    italic = false,
    buf = '';
  const flush = () => {
    if (buf) runs.push({ text: buf, bold, italic });
    buf = '';
  };
  const canOpen = (/** @type {number} */ i, /** @type {string} */ marker) => {
    const next = src[i + marker.length];
    return next !== undefined && !/\s/.test(next) && src.indexOf(marker, i + marker.length + 1) !== -1;
  };
  const canClose = (/** @type {number} */ i) => i > 0 && !/\s/.test(src[i - 1]);
  for (let i = 0; i < src.length;) {
    const ch = src[i];
    if (ch === '\\' && /[\\*_]/.test(src[i + 1] ?? '')) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (src.startsWith('**', i) && (bold ? canClose(i) : canOpen(i, '**'))) {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    if (ch === '*' && !src.startsWith('**', i) && (italic ? canClose(i) : canOpen(i, '*'))) {
      flush();
      italic = !italic;
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return runs;
}

/**
 * Parse a recipe file into its header (meta) and content blocks.
 * @param {string} src
 * @returns {Recipe}
 */
export function parseRecipe(src) {
  /** @type {Record<string, any>} */
  const meta = {};
  let body = src.replace(/\r\n?/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (fm) {
    let parsed;
    try {
      parsed = loadYaml(fm[1]);
    } catch (e) {
      throw new Error(`Recipe header is not valid YAML: ${/** @type {Error} */ (e).message}`, { cause: e });
    }
    if (parsed != null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new Error('Recipe header must be a set of "key: value" lines');
    }
    Object.assign(meta, parsed);
    // Times may be flat (prep: 30 min) or grouped (time: { prep, cook, total }).
    for (const k of ['prep', 'cook', 'total']) if (meta[k] == null && meta.time?.[k] != null) meta[k] = meta.time[k];
    body = body.slice(fm[0].length);
  }
  const bodyLine = fm ? fm[0].split('\n').length - (fm[0].endsWith('\n') ? 1 : 0) + 1 : 1;

  /** @type {Block[]} */
  const blocks = [];
  const lines = body.split('\n');
  const startsBlock = (/** @type {string} */ l) =>
    !l.trim() || HEADING.test(l) || IMAGE.test(l.trim()) || BULLET.test(l) || NUMBERED.test(l) || NOTE.test(l);
  for (let i = 0; i < lines.length;) {
    const t = lines[i].trim();
    let m;
    if (!t) {
      i++;
      continue;
    }
    const line = bodyLine + i;
    if ((m = HEADING.exec(t))) {
      blocks.push({ type: 'heading', level: m[1].length, runs: parseInline(m[2].trim()), line });
      i++;
    } else if ((m = IMAGE.exec(t))) {
      blocks.push({ type: 'image', alt: m[1], src: m[2], attrs: parseAttrs(m[3]), line });
      i++;
    } else if (BULLET.test(t) || NUMBERED.test(t)) {
      const ordered = NUMBERED.test(t),
        re = ordered ? NUMBERED : BULLET,
        items = [];
      while (i < lines.length && lines[i].trim()) {
        const l = lines[i].trim();
        if ((m = re.exec(l))) items.push(m[1]);
        else if (startsBlock(lines[i]) || !items.length) break;
        else items[items.length - 1] += ' ' + l; // continuation line
        i++;
      }
      blocks.push({ type: 'list', ordered, items: items.map(parseInline), line });
    } else if (NOTE.test(t)) {
      const parts = [];
      while (i < lines.length && (m = NOTE.exec(lines[i].trim()))) {
        parts.push(m[1]);
        i++;
      }
      blocks.push({ type: 'note', runs: parseInline(parts.join(' ').trim()), line });
    } else {
      const parts = [];
      while (i < lines.length && !startsBlock(lines[i])) {
        parts.push(lines[i].trim());
        i++;
      }
      blocks.push({ type: 'paragraph', runs: parseInline(parts.join(' ')), line });
    }
  }
  return { meta, blocks, bodyLine };
}

/** A recipe or prose page: front matter + blocks (same format). */
export const parseDocument = parseRecipe;
