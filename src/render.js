/**
 * Draw a page description onto a 2D canvas context. Used by the viewer (from
 * frozen layouts), the dev server and the build (from live layouts).
 *
 * Page descriptions are in points; `ctx` must map points to pixels. Images are
 * looked up by `src` in `images`.
 */

/** Line art recoloured to `color` (e.g. cream on a dark board), at device size. */
const tintCache = new Map();
function tinted(
  /** @type {HTMLImageElement} */ img,
  /** @type {string} */ color,
  /** @type {number} */ w,
  /** @type {number} */ h,
) {
  const cw = Math.max(1, Math.round(w)),
    ch = Math.max(1, Math.round(h));
  const key = `${img.src}|${color}|${cw}x${ch}`;
  let c = tintCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    g.drawImage(img, 0, 0, cw, ch);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, cw, ch);
    tintCache.set(key, c);
    if (tintCache.size > 64) tintCache.delete(tintCache.keys().next().value); // oldest first
  }
  return c;
}

/** `400 12px "Crimson Pro"` at scale 2 → `400 24px "Crimson Pro"` */
const scaleFont = (/** @type {string} */ font, /** @type {number} */ s) =>
  font.replace(/([\d.]+)px/, (_, n) => `${+n * s}px`);

const fontOf = (/** @type {any} */ st) => `${st.italic ? 'italic ' : ''}${st.weight} ${st.size}px ${st.family}`;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} page  page description (items, folio, box, floats, anchors)
 * @param {any} tpl   template (page size, folio style)
 * @param {{ images: Map<string, HTMLImageElement>, guides?: boolean }} opts
 */
export function drawPage(ctx, page, tpl, { images, guides = false }) {
  const { width: W, height: H } = tpl.page;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  const layer = (/** @type {any} */ it) => (it.layer === 'below' ? 0 : it.decor ? 2 : 1);
  const ordered = page.items
    .map((/** @type {any} */ it, /** @type {number} */ i) => [it, i])
    .sort((/** @type {any} */ a, /** @type {any} */ b) => layer(a[0]) - layer(b[0]) || a[1] - b[1])
    .map((/** @type {any} */ [it]) => it);
  // Text is drawn at its real device size, not at layout size under a scaled
  // transform: canvas positions glyphs at the font's own size, so scaling up
  // small text magnifies its rounding into uneven letter and word spacing.
  const m = ctx.getTransform(),
    s = m.a;
  let lineEnd = 0; // where the previous run on this line really ended, in device px
  const text = (/** @type {any} */ it) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, m.e, m.f);
    ctx.font = scaleFont(it.font, s);
    ctx.fillStyle = it.color;
    const x = it.cont ? lineEnd + it.gap * s : it.x * s,
      y = it.y * s;
    const ls = (it.letterSpacing ?? 0) * s;
    const width = ls
      ? [...it.text].reduce((w, ch) => w + ctx.measureText(ch).width + ls, -ls)
      : ctx.measureText(it.text).width;
    const x0 = it.align === 'center' ? x - width / 2 : it.align === 'right' ? x - width : x;
    if (ls) {
      let cx = x0;
      for (const ch of it.text) {
        ctx.fillText(ch, cx, y);
        cx += ctx.measureText(ch).width + ls;
      }
    } else ctx.fillText(it.text, x0, y);
    lineEnd = x0 + width;
    ctx.restore();
  };
  for (const it of ordered) {
    if (it.type === 'text') text(it);
    else if (it.type === 'image') {
      const img = images.get(it.src);
      if (!img) continue;
      ctx.save();
      ctx.globalAlpha = it.opacity ?? 1;
      ctx.translate(it.x + it.w / 2, it.y + it.h / 2);
      if (it.rotate) ctx.rotate((it.rotate * Math.PI) / 180);
      ctx.drawImage(it.tint ? tinted(img, it.tint, it.w * s, it.h * s) : img, -it.w / 2, -it.h / 2, it.w, it.h);
      ctx.restore();
    } else if (it.type === 'fill') {
      ctx.fillStyle = it.color;
      ctx.fillRect(0, 0, W, H);
    } else if (it.type === 'rule') {
      ctx.fillStyle = it.color;
      ctx.fillRect(it.x, it.y, it.w, 0.6);
    } else if (it.type === 'frame') {
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(it.inset, it.inset, W - 2 * it.inset, H - 2 * it.inset);
      ctx.strokeRect(it.inset + 4, it.inset + 4, W - 2 * it.inset - 8, H - 2 * it.inset - 8);
    }
  }
  if (page.folio) {
    const st = tpl.styles.folio;
    text({
      x: W / 2,
      y: H - tpl.page.margin.bottom / 2 + st.size / 3,
      text: String(page.folio),
      font: fontOf(st),
      color: st.color,
      align: 'center',
    });
  }
  if (guides) drawGuides(ctx, page);
  ctx.restore();
}

/** Layout-mode overlay: text area (red), floats and their wrap gap (blue), decorative art and its anchor (green). */
function drawGuides(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {any} */ page) {
  ctx.save();
  ctx.lineWidth = 0.6;
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(214, 64, 64, .7)';
  const b = page.box;
  if (b) ctx.strokeRect(b.x0, b.top, b.x1 - b.x0, b.bottom - b.top);
  ctx.strokeStyle = 'rgba(40, 110, 220, .8)';
  for (const f of page.floats ?? []) {
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    ctx.setLineDash([1, 2]);
    ctx.strokeRect(f.side === 'right' ? f.x - f.gap : f.x, f.y, f.w + f.gap, f.h + f.gap);
    ctx.setLineDash([3, 3]);
  }
  ctx.setLineDash([]);
  for (const it of page.items) {
    if (it.type !== 'image' || !it.decor) continue;
    ctx.strokeStyle = 'rgba(30, 150, 90, .85)';
    ctx.strokeRect(it.x, it.y, it.w, it.h);
    const a = it.anchor;
    ctx.beginPath();
    ctx.moveTo(a.x - 5, a.y);
    ctx.lineTo(a.x + 5, a.y);
    ctx.moveTo(a.x, a.y - 5);
    ctx.lineTo(a.x, a.y + 5);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(it.x, it.y);
    ctx.stroke();
  }
  ctx.restore();
}
