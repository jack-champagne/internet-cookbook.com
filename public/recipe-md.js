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
 * Output is content only - no layout decisions are made here.
 */

const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?\s*$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
const NOTE = /^>\s?(.*)$/;

/** `place=right width=40% wrap` → { place: 'right', width: '40%', wrap: true } */
export function parseAttrs(src = '') {
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
 */
export function parseInline(src) {
  const runs = [];
  let bold = false, italic = false, buf = '';
  const flush = () => {
    if (buf) runs.push({ text: buf, bold, italic });
    buf = '';
  };
  const canOpen = (i, marker) => {
    const next = src[i + marker.length];
    return next !== undefined && !/\s/.test(next) && src.indexOf(marker, i + marker.length + 1) !== -1;
  };
  const canClose = (i) => i > 0 && !/\s/.test(src[i - 1]);
  for (let i = 0; i < src.length; ) {
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

export function parseRecipe(src) {
  const meta = {};
  let body = src.replace(/\r\n?/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = /^([\w-]+):\s*(.*)$/.exec(line.trim());
      if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    body = body.slice(fm[0].length);
  }

  const blocks = [];
  const lines = body.split('\n');
  const startsBlock = (l) => !l.trim() || HEADING.test(l) || IMAGE.test(l.trim()) || BULLET.test(l) || NUMBERED.test(l) || NOTE.test(l);
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const t = line.trim();
    let m;
    if (!t) { i++; continue; }
    if ((m = HEADING.exec(t))) {
      blocks.push({ type: 'heading', level: m[1].length, runs: parseInline(m[2].trim()) });
      i++;
    } else if ((m = IMAGE.exec(t))) {
      blocks.push({ type: 'image', alt: m[1], src: m[2], attrs: parseAttrs(m[3]) });
      i++;
    } else if (BULLET.test(t) || NUMBERED.test(t)) {
      const ordered = NUMBERED.test(t), re = ordered ? NUMBERED : BULLET, items = [];
      while (i < lines.length && lines[i].trim()) {
        const l = lines[i].trim();
        if ((m = re.exec(l))) items.push(m[1]);
        else if (startsBlock(lines[i]) || !items.length) break;
        else items[items.length - 1] += ' ' + l; // continuation line
        i++;
      }
      blocks.push({ type: 'list', ordered, items: items.map(parseInline) });
    } else if (NOTE.test(t)) {
      const parts = [];
      while (i < lines.length && (m = NOTE.exec(lines[i].trim()))) { parts.push(m[1]); i++; }
      blocks.push({ type: 'note', runs: parseInline(parts.join(' ').trim()) });
    } else {
      const parts = [];
      while (i < lines.length && !startsBlock(lines[i])) { parts.push(lines[i].trim()); i++; }
      blocks.push({ type: 'paragraph', runs: parseInline(parts.join(' ')) });
    }
  }
  return { meta, blocks };
}
