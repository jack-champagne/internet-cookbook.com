/**
 * crease.js — page-turning (flipbook) renderer for <canvas>.
 *
 * Model
 * -----
 * A turning page is folded along a single straight crease. The user holds a
 * point S on the page (a corner, or anywhere on the outer edge) and drags it
 * to P. The crease is the perpendicular bisector of S→P; everything on S's
 * side of it (the "flap") is reflected across the crease.
 *
 * The page is pinned along the spine. A spine end A stays on the flat side of
 * the crease exactly when |A − P| ≤ |A − S|, so "the page stays attached" is
 * the same as "P lies inside both discs centred on the spine ends, through S".
 * Dragging is constrained by projecting P onto that lens-shaped region.
 *
 * All geometry is done in a page-local frame: spine at x = 0, the page spans
 * x ∈ [0, W], y ∈ [0, H]. The renderer maps it onto either side of the spine.
 */


import {
  dist, lerp, clamp, easeInOut, easeOut, cubicBezier, circleIntersections,
  clampToLens, clipHalfPlane, polygonArea, reflectionMatrix, computeFold,
} from './crease/geometry.js';

// The geometry is part of crease.js's public API.
export {
  easeInOut, easeOut, cubicBezier, circleIntersections, clampToLens,
  clipHalfPlane, polygonArea, reflectionMatrix, computeFold,
};

// ---------------------------------------------------------------------------
// Book: layout, rendering, interaction
// ---------------------------------------------------------------------------

const DEFAULTS = {
  pages: [],            // image URL | CanvasImageSource | (ctx, width, height) => void
  pageWidth: 400,
  pageHeight: 520,
  display: 'double',    // 'double' | 'single'
  direction: 'ltr',     // 'ltr' | 'rtl'
  hard: [],             // page numbers that are rigid boards, or (n) => boolean
  padding: 32,          // canvas margin around the book (room for flaps/shadows)
  grabZone: 48,         // px from the outer edge that starts a drag
  cornerSize: 72,       // px from top/bottom that counts as a corner (hover peel)
  peelSize: 40,         // how far a hovered corner lifts
  duration: 700,        // ms for a full programmatic turn
  paperColor: '#fdfcf8',
  shading: true,
  debug: false,
  onTurn: null,         // (page) => void, after a turn completes
  label: 'Book',        // accessible name prefix, e.g. "Book, pages 4–5 of 8"
  keepPages: 4,         // rasterised pages kept within this distance of the current page
  // Shadow and shading strengths (0-1 opacity); pass a partial object to tune.
  shadows: {
    resting: 0.22,      // the book's drop shadow on the table
    crease: 0.25,       // shadow the lifted flap casts by the crease, on page and table
    flap: 0.18,         // drop shadow under the folded flap
    curl: 0.22,         // dark band in the flap's crease
    highlight: 0.16,    // light band where the flap curls toward the light
    far: 0.05,          // slight darkening at the flap's far edge
    gutter: 0.16,       // paper darkening into the binding
    board: 0.35,        // drop shadow under a lifting hard cover
    boardShade: 0.32,   // a hard cover darkening as it turns away from the light
  },
};

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Book {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = { ...DEFAULTS, ...options, shadows: { ...DEFAULTS.shadows, ...options.shadows } };
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.current = 1;   // page number the reader is on (spread = floor(current / 2) when double)
    this.turn = null;   // active turn, see _turnSpec()
    this.start = null;  // held point, page-local
    this.point = null;  // dragged point, page-local (already constrained)
    this.mode = 'idle'; // idle | peel | drag | anim
    this._raf = 0;
    this.pages = this.opts.pages.map((src) => this._loadPage(src));
    this._layout();
    this._bind();
    this._watchPixelRatio();
    this._ready = true;
    this.render();
  }

  // ----- public API -------------------------------------------------------

  get page() {
    const v = this._visible();
    return v.left ?? v.right ?? this.current;
  }

  get pageCount() {
    return this.pages.length;
  }

  /** Page numbers currently showing, left to right (one or two). */
  get visiblePages() {
    const v = this._visible();
    return [v.left, v.right].filter((n) => n != null);
  }

  next() { return this._auto('forward'); }
  prev() { return this._auto('backward'); }

  goTo(n) {
    this._cancel();
    this.current = clamp(Math.round(n), 1, Math.max(1, this.pages.length));
    this.render();
  }

  /** Number of pages currently held as rasterised canvases (for tests and diagnostics). */
  get rasterisedPages() {
    return this.pages.filter((p) => p.canvas).length;
  }

  /**
   * Testing hook: render a single frame of a turn without animating.
   * `dir` is 'forward' or 'backward'; `start` and `point` are page-local
   * ({x, y} with the spine at x = 0). Call debugFrame() with no arguments to
   * return to the static book.
   */
  debugFrame(dir, start, point) {
    this._cancel();
    if (dir) {
      const t = this._turnSpec(dir);
      if (!t) return false;
      this.turn = t;
      this.start = { ...start };
      this._setPoint(point);
    }
    this.render();
    return true;
  }

  /** The turn that `next()`/`prev()` would perform, or null (read-only). */
  turnFor(dir) {
    return this._turnSpec(dir);
  }

  /** Change display, direction, hard, shading, debug, padding, ... at runtime. */
  set(options) {
    const page = this.page;
    this._cancel();
    Object.assign(this.opts, options, { shadows: { ...this.opts.shadows, ...options.shadows } });
    this.current = page;
    this._layout();
    this.render();
  }

  destroy() {
    this._cancel();
    for (const [type, fn] of this._listeners) this.canvas.removeEventListener(type, fn);
    this._pixelRatioQuery?.removeEventListener('change', this._onPixelRatio);
    for (const p of this.pages) p.canvas = p.flipped = null;
  }

  // ----- pages ------------------------------------------------------------

  /**
   * Pages are rasterised on demand (_source) and released when the reader is
   * far away (_releaseDistant), so memory stays flat however long the book:
   * an 8 × 10 page on a 2× screen is ~8 MB as a canvas.
   */
  _loadPage(src) {
    const page = { draw: null, canvas: null, flipped: null };
    const fit = (img) => (g, W, H) => {
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const s = Math.min(W / iw, H / ih);
      g.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
    };
    const ready = (draw) => {
      page.draw = draw;
      page.canvas = page.flipped = null;
      if (this._ready) this.render();
    };
    if (typeof src === 'function') page.draw = src;
    else if (typeof src === 'string') {
      const img = new Image();
      img.onload = () => ready(fit(img));
      img.src = src;
    } else if (src instanceof HTMLImageElement && !src.complete) {
      src.addEventListener('load', () => ready(fit(src)), { once: true });
    } else if (src) page.draw = fit(src);
    return page;
  }

  _raster(page) {
    const W = this.opts.pageWidth, H = this.opts.pageHeight, pr = this.dpr;
    const c = document.createElement('canvas');
    c.width = Math.round(W * pr);
    c.height = Math.round(H * pr);
    const g = c.getContext('2d');
    g.scale(pr, pr);
    g.fillStyle = this.opts.paperColor;
    g.fillRect(0, 0, W, H);
    page.draw(g, W, H);
    return c;
  }

  /** Drop the rasters of pages far from the current one; they redraw when needed. */
  _releaseDistant() {
    const keep = this.opts.keepPages;
    this.pages.forEach((p, i) => {
      if (p.canvas && Math.abs(i + 1 - this.current) > keep) p.canvas = p.flipped = null;
    });
  }

  /** Redraw at the new pixel ratio when the window moves to another display or zooms. */
  _watchPixelRatio() {
    if (typeof matchMedia !== 'function') return;
    this._onPixelRatio = () => {
      this._pixelRatioQuery?.removeEventListener('change', this._onPixelRatio);
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const p of this.pages) p.canvas = p.flipped = null;
      this._layout();
      this.render();
      this._watchPixelRatio();
    };
    this._pixelRatioQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this._pixelRatioQuery.addEventListener('change', this._onPixelRatio);
  }

  _has(n) { return n != null && n >= 1 && n <= this.pages.length; }

  _isHard(n) {
    if (!this._has(n)) return false;
    const h = this.opts.hard;
    return typeof h === 'function' ? !!h(n) : h.includes(n);
  }

  /** Rasterised page, mirrored horizontally when `flip` (for RTL / left-hinged strips). */
  _source(n, flip) {
    const page = this._has(n) ? this.pages[n - 1] : null;
    if (!page?.draw) return null;
    page.canvas ||= this._raster(page);
    if (!flip) return page.canvas;
    if (!page.flipped) {
      const c = document.createElement('canvas');
      c.width = page.canvas.width;
      c.height = page.canvas.height;
      const g = c.getContext('2d');
      g.translate(c.width, 0);
      g.scale(-1, 1);
      g.drawImage(page.canvas, 0, 0);
      page.flipped = c;
    }
    return page.flipped;
  }

  // ----- layout & state ---------------------------------------------------

  get double() { return this.opts.display === 'double'; }
  get rtl() { return this.opts.direction === 'rtl'; }

  _layout() {
    const { pageWidth: W, pageHeight: H, padding: pad } = this.opts;
    this.W = W;
    this.H = H;
    this.top = pad;
    this.spineX = this.double ? pad + W : pad;
    // Logical frame: forward is always to the right; RTL mirrors at draw time.
    this.rects = {
      [1]: { x: this.spineX, y: pad, w: W, h: H },
      [-1]: { x: this.spineX - W, y: pad, w: W, h: H },
    };
    this.width = 2 * pad + (this.double ? 2 : 1) * W;
    this.height = 2 * pad + H;
    const c = this.canvas;
    c.width = Math.round(this.width * this.dpr);
    c.height = Math.round(this.height * this.dpr);
    c.style.width = `${this.width}px`;
    c.style.maxWidth = '100%';
    c.style.height = 'auto';
    // Single-finger drags turn pages; two-finger pinch-zoom stays available.
    c.style.touchAction = 'pinch-zoom';
    c.tabIndex = 0;
    c.setAttribute('role', 'application');
    c.setAttribute('aria-roledescription', 'book');
    if (!this.double) this.current = Math.max(1, this.current);
  }

  _visible() {
    if (!this.double) return { left: null, right: this._has(this.current) ? this.current : null };
    const s = Math.floor(this.current / 2);
    return { left: this._has(2 * s) ? 2 * s : null, right: this._has(2 * s + 1) ? 2 * s + 1 : null };
  }

  /**
   * Describe a turn in `dir`, or null if impossible.
   *   side      – which side of the spine the leaf lies flat on (+1 right, −1 left)
   *   front     – page on the leaf's visible face; back – its reverse (null = blank)
   *   under     – page revealed beneath the leaf; opposite – page across the spine
   *   commit    – 'turned' if completing means flipping over, 'flat' if laying down
   *   holdsFold – the pointer holds the crease rather than the corner
   */
  _turnSpec(dir) {
    const has = (n) => this._has(n);
    let t = null;
    if (this.double) {
      const s = Math.floor(this.current / 2);
      if (dir === 'forward' && has(2 * s + 1) && has(2 * s + 2)) {
        t = { side: 1, front: 2 * s + 1, back: 2 * s + 2, under: 2 * s + 3, opposite: 2 * s, next: 2 * s + 2 };
      } else if (dir === 'backward' && has(2 * s)) {
        t = { side: -1, front: 2 * s, back: 2 * s - 1, under: 2 * s - 2, opposite: 2 * s + 1, next: 2 * s - 2 };
      }
      if (t) t.commit = 'turned';
    } else {
      const k = this.current;
      if (dir === 'forward' && has(k) && has(k + 1)) {
        t = { side: 1, front: k, back: null, under: k + 1, opposite: null, commit: 'turned', next: k + 1 };
      } else if (dir === 'backward' && has(k - 1)) {
        // The previous page comes back in from beyond the spine and lays down.
        t = { side: 1, front: k - 1, back: null, under: k, opposite: null, commit: 'flat', next: k - 1, holdsFold: true };
      }
    }
    if (t) {
      t.dir = dir;
      t.hard = this._isHard(t.front) || this._isHard(t.back);
    }
    return t;
  }

  _setPoint(target) {
    this.point = this.turn.hard
      ? { x: clamp(target.x, -this.W, this.W), y: target.y }
      : computeFold(this.W, this.H, this.start, target).point;
  }

  _progress() {
    return clamp((this.start.x - this.point.x) / (2 * this.start.x), 0, 1);
  }

  _cancel() {
    this._stopAnim();
    this.turn = null;
    this.mode = 'idle';
  }

  // ----- animation --------------------------------------------------------

  _animate(duration, step, done) {
    this._stopAnim();
    const t0 = performance.now();
    const tick = (now) => {
      const k = duration <= 0 ? 1 : clamp((now - t0) / duration, 0, 1);
      step(k);
      if (k < 1) this._raf = requestAnimationFrame(tick);
      else {
        this._raf = 0;
        done?.();
      }
    };
    this._raf = requestAnimationFrame(tick);
  }

  _stopAnim() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  /** Animate the held point to fully turned (goTurned) or back to flat. */
  _finish(goTurned, commit, ease = easeOut) {
    const t = this.turn, S = this.start;
    const from = { ...this.point };
    const to = goTurned ? { x: -S.x, y: S.y } : { x: S.x, y: S.y };
    const span = dist(from, to) / (2 * this.W);
    // Arc the corner toward the middle of the page so it travels like paper, not a slider.
    const lift = (this.H / 2 - S.y) * 0.35 * Math.min(1, span);
    const c1 = lerp(from, to, 1 / 3), c2 = lerp(from, to, 2 / 3);
    c1.y += lift;
    c2.y += lift;
    this.mode = 'anim';
    const duration = reducedMotion() ? 0 : this.opts.duration * clamp(span, 0.25, 1);
    this._animate(duration, (k) => {
      this._setPoint(cubicBezier(from, c1, c2, to, ease(k)));
      this.render();
    }, () => {
      if (commit) this.current = t.next;
      this.turn = null;
      this.mode = 'idle';
      this.render();
      if (commit) this.opts.onTurn?.(this.page);
    });
  }

  _auto(dir) {
    if (this.mode === 'drag' || this.mode === 'anim') return false;
    const t = this._turnSpec(dir);
    if (!t) return false;
    this._stopAnim();
    this.turn = t;
    this.start = { x: this.W, y: this.H };
    const fromTurned = t.commit === 'flat';
    this._setPoint(fromTurned ? { x: -this.W, y: this.H } : this.start);
    this._finish(!fromTurned, true, easeInOut);
    return true;
  }

  _peelPoint(k) {
    const S = this.start, d = this.opts.peelSize;
    const dy = S.y === 0 ? 1 : -1;
    const end = { x: S.x - d, y: S.y + dy * d };
    return cubicBezier(S, { x: S.x, y: S.y + dy * d * 0.6 }, { x: S.x - d * 0.6, y: end.y }, end, k);
  }

  _peel(to) {
    const from = this._peelK ?? 0;
    this._peelTarget = to;
    this._animate(240 * Math.abs(to - from), (k) => {
      this._peelK = from + (to - from) * easeOut(k);
      this._setPoint(this._peelPoint(this._peelK));
      this.render();
    }, () => {
      if (to === 0) this._cancel(), this.render();
    });
  }

  // ----- input ------------------------------------------------------------

  _bind() {
    this._listeners = [
      ['pointerdown', (e) => this._onDown(e)],
      ['pointermove', (e) => this._onMove(e)],
      ['pointerup', (e) => this._onUp(e)],
      ['pointercancel', (e) => this._onUp(e)],
      ['pointerleave', () => this._onLeave()],
      ['keydown', (e) => this._onKey(e)],
    ];
    for (const [type, fn] of this._listeners) this.canvas.addEventListener(type, fn);
  }

  _onKey(e) {
    const forward = this.rtl ? 'ArrowLeft' : 'ArrowRight', back = this.rtl ? 'ArrowRight' : 'ArrowLeft';
    const actions = {
      [forward]: () => this.next(), PageDown: () => this.next(), ' ': () => this.next(),
      [back]: () => this.prev(), PageUp: () => this.prev(),
      Home: () => this.goTo(1), End: () => this.goTo(this.pages.length),
    };
    const act = actions[e.key];
    if (!act || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    act();
  }

  _toLogical(e) {
    const r = this.canvas.getBoundingClientRect();
    let x = ((e.clientX - r.left) * this.width) / r.width;
    const y = ((e.clientY - r.top) * this.height) / r.height;
    if (this.rtl) x = this.width - x;
    return { x, y };
  }

  _toLocal(p, side) {
    return { x: side * (p.x - this.spineX), y: p.y - this.top };
  }

  _toWorld(q, side) {
    return { x: this.spineX + side * q.x, y: this.top + q.y };
  }

  /** What would a press at logical point p grab? */
  _hit(p) {
    const { grabZone: g, cornerSize: cs } = this.opts;
    const W = this.W, H = this.H;
    for (const dir of ['forward', 'backward']) {
      const t = this._turnSpec(dir);
      if (!t) continue;
      const q = this._toLocal(p, t.side);
      if (q.y < -g / 2 || q.y > H + g / 2) continue;
      if (t.holdsFold) {
        if (q.x >= 0 && q.x <= g) return { spec: t, start: { x: W, y: clamp(q.y, 0, H) }, corner: false };
      } else if (q.x >= W - g && q.x <= W + g / 2) {
        const corner = q.y < cs ? 0 : q.y > H - cs ? H : null;
        return { spec: t, start: { x: W, y: corner ?? clamp(q.y, 0, H) }, corner: corner !== null };
      }
    }
    return null;
  }

  _dragTarget(q) {
    // Holding the crease: it sits halfway between the held point (x = W) and the corner.
    return this.turn.holdsFold ? { x: 2 * q.x - this.W, y: q.y } : q;
  }

  _onDown(e) {
    if (this.mode === 'drag' || this.mode === 'anim') return;
    const p = this._toLogical(e);
    const hit = this._hit(p);
    if (!hit) return;
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    this._stopAnim();
    this.turn = hit.spec;
    this.start = hit.start;
    this.mode = 'drag';
    this.canvas.style.cursor = 'grabbing';
    this._pointerId = e.pointerId;
    this._downAt = { ...p, t: performance.now() };
    this._samples = [];
    this._drag(p);
  }

  _drag(p) {
    this._setPoint(this._dragTarget(this._toLocal(p, this.turn.side)));
    const now = performance.now();
    this._samples.push({ t: now, x: this.point.x });
    while (this._samples.length > 2 && now - this._samples[0].t > 100) this._samples.shift();
    this._renderSoon();
  }

  /**
   * Render on the next animation frame, once. Touch input on phones arrives
   * faster than the display refreshes (~120 Hz), and drawing per event threw
   * away half the work.
   */
  _renderSoon() {
    if (this._pending) return;
    this._pending = requestAnimationFrame(() => {
      this._pending = 0;
      this.render();
    });
  }

  _onMove(e) {
    const p = this._toLogical(e);
    if (this.mode === 'drag') {
      if (e.pointerId === this._pointerId) this._drag(p);
      return;
    }
    if (e.pointerType === 'touch' || this.mode === 'anim' || reducedMotion()) return;
    const hit = this._hit(p);
    this.canvas.style.cursor = hit ? 'grab' : '';
    const peel = hit?.corner ? hit : null;
    if (peel) {
      const same = this.mode === 'peel' && this.turn.dir === peel.spec.dir && this.start.y === peel.start.y;
      if (same) {
        if (this._peelTarget !== 1) this._peel(1);
        return;
      }
      this._stopAnim();
      this.turn = peel.spec;
      this.start = peel.start;
      this.mode = 'peel';
      this._peelK = 0;
      this._peel(1);
    } else if (this.mode === 'peel' && this._peelTarget !== 0) {
      this._peel(0);
    }
  }

  _onUp(e) {
    if (this.mode !== 'drag' || e.pointerId !== this._pointerId) return;
    this.canvas.style.cursor = '';
    const t = this.turn;
    const p = this._toLogical(e);
    const tapped = dist(p, this._downAt) < 6 && performance.now() - this._downAt.t < 350;
    let commit;
    if (e.type === 'pointercancel') commit = false;
    else if (tapped) commit = true;
    else {
      const s = this._samples, a = s[0], b = s[s.length - 1];
      const vx = b && b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0; // px/ms, negative = toward turned
      const towardTurned = vx < -0.5 ? true : vx > 0.5 ? false : this._progress() > 0.5;
      commit = towardTurned === (t.commit === 'turned');
    }
    this._finish(commit === (t.commit === 'turned'), commit);
  }

  _onLeave() {
    if (this.mode === 'peel' && this._peelTarget !== 0) this._peel(0);
    if (this.mode !== 'drag') this.canvas.style.cursor = '';
  }

  // ----- rendering --------------------------------------------------------

  _path(poly) {
    const ctx = this.ctx;
    ctx.beginPath();
    poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
  }

  _rectPoly(r) {
    return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  }

  /**
   * Paper-coloured shapes with one soft drop shadow. All shapes go into a
   * single path so their shadows merge instead of darkening each other, and
   * the book's resting shadow is drawn before any page so it never spills
   * onto a neighbouring page.
   */
  _paper(polys, alpha = this.opts.shadows.resting, blur = 18) {
    if (!polys.length || alpha <= 0.001) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${alpha})`;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = this.opts.paperColor;
    ctx.beginPath();
    for (const poly of polys) {
      poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  /**
   * The book's resting drop shadow, cached: it only changes when what lies
   * flat changes, but a blurred shadow is among the most expensive things
   * to draw. Cached at device resolution over its own bounding box.
   */
  _restingShadow(polys) {
    if (!polys.length) return;
    const ctx = this.ctx, m = ctx.getTransform();
    const key = [m.a, m.b, m.c, m.d, m.e, m.f, this.opts.paperColor,
      ...polys.flat().map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`)].join('|');
    let cache = this._restCache;
    if (!cache || cache.key !== key) {
      // Device-space bounds of the shapes plus room for the blur and offset.
      const margin = 48 * this.dpr;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of polys.flat()) {
        const dx = m.a * q.x + m.c * q.y + m.e, dy = m.b * q.x + m.d * q.y + m.f;
        x0 = Math.min(x0, dx); x1 = Math.max(x1, dx); y0 = Math.min(y0, dy); y1 = Math.max(y1, dy);
      }
      x0 = Math.max(0, Math.floor(x0 - margin)); y0 = Math.max(0, Math.floor(y0 - margin));
      x1 = Math.min(this.canvas.width, Math.ceil(x1 + margin)); y1 = Math.min(this.canvas.height, Math.ceil(y1 + margin));
      const c = (cache && cache.canvas) || document.createElement('canvas');
      c.width = Math.max(1, x1 - x0);
      c.height = Math.max(1, y1 - y0);
      const g = c.getContext('2d');
      g.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
      const main = this.ctx;
      this.ctx = g; // draw with the shared helper into the cache
      try { this._paper(polys); } finally { this.ctx = main; }
      cache = this._restCache = { key, canvas: c, x: x0, y: y0 };
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cache.canvas, cache.x, cache.y);
    ctx.restore();
  }

  /** Gutter shading: paper darkens as it curves into the binding. `span` is the page width as drawn. */
  _gutter(x0, dir, y, h, span = this.W) {
    const ctx = this.ctx, gw = span * 0.07;
    if (gw < 0.5) return;
    const g = ctx.createLinearGradient(x0, 0, x0 + dir * gw, 0);
    g.addColorStop(0, `rgba(0,0,0,${this.opts.shadows.gutter})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(dir > 0 ? x0 : x0 - gw, y, gw, h);
  }

  /** Draw page n filling rect (paper if not loaded / blank), plus the gutter shadow by the spine. */
  _drawPage(n, rect, blankAsPaper = false) {
    const ctx = this.ctx;
    const src = this._source(n, this.rtl);
    if (src) ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h);
    else if (blankAsPaper || this._has(n)) {
      ctx.fillStyle = this.opts.paperColor;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    } else return;
    if (Math.abs(rect.x - this.spineX) < 0.5) this._gutter(rect.x, 1, rect.y, rect.h);
    else if (Math.abs(rect.x + rect.w - this.spineX) < 0.5) this._gutter(rect.x + rect.w, -1, rect.y, rect.h);
  }

  render() {
    if (!this._ready) return;
    if (this._pending) cancelAnimationFrame(this._pending), (this._pending = 0);
    this._draw();
    if (!this.turn) this._releaseDistant();
    const shown = this.visiblePages;
    const label = `${this.opts.label}, ${shown.length === 2 ? `pages ${shown[0]}–${shown[1]}` : `page ${shown[0] ?? this.current}`} of ${this.pages.length}`;
    if (this.canvas.getAttribute('aria-label') !== label) this.canvas.setAttribute('aria-label', label);
  }

  _draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.rtl) {
      ctx.translate(this.width, 0);
      ctx.scale(-1, 1);
    }
    const t = this.turn;
    if (!t) {
      const v = this._visible();
      const resting = [[v.left, -1], [v.right, 1]].filter(([n]) => n != null);
      this._restingShadow(resting.map(([, side]) => this._rectPoly(this.rects[side])));
      for (const [n, side] of resting) this._drawPage(n, this.rects[side]);
      return;
    }
    const leafRect = this.rects[t.side], otherRect = this.rects[-t.side];
    const fold = t.hard ? null : computeFold(this.W, this.H, this.start, this.point);
    // Resting shadow: whatever lies flat on the table this frame. With nothing
    // under the leaf, its own flat part is what lies there.
    // Resting shadow: whatever lies flat on the table this frame. Where a side
    // has no page underneath, the leaf itself (or the part of it over that
    // side) is what lies there, so it must cast the resting shadow - otherwise
    // the shadow pops in when the turn ends and the static view takes over.
    const resting = [];
    const toW = (poly, side) => poly.map((q) => this._toWorld(q, side));
    if (this._has(t.opposite)) resting.push(this._rectPoly(otherRect));
    if (this._has(t.under)) resting.push(this._rectPoly(leafRect));
    if (fold) {
      if (!this._has(t.under) && fold.flat.length) resting.push(toW(fold.flat, t.side));
      if (!this._has(t.opposite) && fold.flapFolded.length) resting.push(toW(fold.flapFolded, t.side));
    } else {
      const board = this._boardPoly(t);
      if (!this._has(board.over === t.side ? t.under : t.opposite)) resting.push(board.poly);
    }
    this._restingShadow(resting);
    if (this._has(t.opposite)) this._drawPage(t.opposite, otherRect);
    if (this._has(t.under)) this._drawPage(t.under, leafRect);
    if (t.hard) this._renderHard(t);
    else this._renderSoft(t, fold);
  }

  _renderSoft(t, g) {
    const ctx = this.ctx, s = t.side, W = this.W, H = this.H;
    const toW = (q) => this._toWorld(q, s);
    const flat = g.flat.map(toW), flap = g.flap.map(toW), folded = g.flapFolded.map(toW);
    const mid = toW(g.mid), n = { x: s * g.normal.x, y: g.normal.y };
    // Must reach 0 at progress 0 and 1, where the frame has to match the
    // static book exactly; the gain keeps a small hover peel visibly shaded.
    const shade = this.opts.shading ? Math.min(1, 2.5 * Math.sin(Math.PI * g.progress)) : 0;
    const leafRect = this.rects[s], otherRect = this.rects[-s];

    // Shadow the lifted flap casts on the uncovered page *and* the table just
    // beyond it. Clipping to the page alone stopped the shadow dead at the
    // page edge, so the edge looked lighter than the shaded paper beside it.
    if (shade && flap.length) {
      // Fade over a minimum distance: tying it to the flap's depth alone made
      // a small fold's whole uncovered corner sit at full darkness.
      const L = clamp(g.depth, W * 0.15, W * 0.3);
      const gr = ctx.createLinearGradient(mid.x, mid.y, mid.x + n.x * L, mid.y + n.y * L);
      gr.addColorStop(0, `rgba(0,0,0,${this.opts.shadows.crease * shade})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      // On the page: crisp, starting exactly at the crease.
      ctx.save();
      this._path(flap);
      ctx.clip();
      ctx.fillStyle = gr;
      ctx.fillRect(leafRect.x, leafRect.y, W, H);
      ctx.restore();
      this._tableShadow(g, s, mid, n, L, this.opts.shadows.crease * shade);
    }

    // The part of the leaf that stays flat.
    if (flat.length) {
      ctx.save();
      this._path(flat);
      ctx.clip();
      this._drawPage(t.front, leafRect);
      ctx.restore();
    }

    if (!folded.length) return this._debugSoft(g, s);

    // The flap: drop shadow, then the back of the page. The back is laid out
    // as it will rest on the other side of the spine; mirroring through the
    // spine and then through the crease carries it onto the folded flap.
    this._paper([folded], this.opts.shadows.flap * shade, 24);
    ctx.save();
    this._path(folded);
    ctx.clip();
    ctx.transform(...reflectionMatrix(mid, n));
    ctx.transform(...reflectionMatrix({ x: this.spineX, y: 0 }, { x: 1, y: 0 }));
    this._drawPage(t.back, otherRect, true);
    ctx.restore();

    // Curvature hint on the flap: dark in the crease, a soft highlight, then flat.
    if (shade) {
      const L = Math.max(g.depth, 1);
      const gr = ctx.createLinearGradient(mid.x, mid.y, mid.x - n.x * L, mid.y - n.y * L);
      const sh = this.opts.shadows;
      gr.addColorStop(0, `rgba(0,0,0,${sh.curl * shade})`);
      gr.addColorStop(0.15, `rgba(255,255,255,${sh.highlight * shade})`);
      gr.addColorStop(0.55, 'rgba(255,255,255,0)');
      gr.addColorStop(1, `rgba(0,0,0,${sh.far * shade})`);
      ctx.save();
      this._path(folded);
      ctx.clip();
      ctx.fillStyle = gr;
      ctx.fillRect(this.spineX - 2 * W, this.top - H, 4 * W, 3 * H);
      ctx.restore();
    }
    this._debugSoft(g, s);
  }

  /** Pose of a rigid board: cosine of its opening angle, which side it's over, its outline. */
  _boardPoly(t) {
    const W = this.W, H = this.H;
    const c = clamp(this.point.x / W, -1, 1);
    const sinA = Math.sqrt(1 - c * c);
    const over = c >= 0 ? t.side : -t.side;
    const grow = 0.08 * sinA; // outer edge looks taller as it lifts toward the viewer
    const x1 = this.spineX + over * W * Math.abs(c);
    const poly = [
      { x: this.spineX, y: this.top },
      { x: x1, y: this.top - (H * grow) / 2 },
      { x: x1, y: this.top + H + (H * grow) / 2 },
      { x: this.spineX, y: this.top + H },
    ];
    return { c, sinA, over, grow, poly };
  }

  /**
   * Table area (page-local polygons) that the lifted flap shades: the bands
   * outside the page edges whose nearest page point is uncovered. Below the
   * bottom edge that's only right of where the crease meets it - not the
   * table beside the part of the page that still lies flat. Each band is cut
   * by the crease evaluated *on the edge*, which is affine within the band.
   * `tilt` leans that cut about the crease point by tilt × distance from the
   * page (negative narrows the shadow near the crease point), used to taper
   * the shadow into a wedge. The corner patches use the same tilted cut,
   * matching both neighbouring bands along their shared sides, so there are
   * no hard seams at corners.
   */
  _tableReach(g, tilt, F) {
    const W = this.W, H = this.H;
    const nx = Math.abs(g.normal.x), ny = Math.abs(g.normal.y);
    const side = (x, y) => (x - g.mid.x) * g.normal.x + (y - g.mid.y) * g.normal.y;
    const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    return [
      clipHalfPlane(box(0, -F, W, 0), (q) => side(q.x, 0) + tilt * -q.y * nx),        // above the top edge
      clipHalfPlane(box(0, H, W, H + F), (q) => side(q.x, H) + tilt * (q.y - H) * nx), // below the bottom edge
      clipHalfPlane(box(W, 0, W + F, H), (q) => side(W, q.y) + tilt * (q.x - W) * ny), // beyond the outer edge
      clipHalfPlane(box(W, -F, W + F, 0), (q) => side(W, 0) + tilt * ((q.x - W) * ny - q.y * nx)),     // outer-top corner
      clipHalfPlane(box(W, H, W + F, H + F), (q) => side(W, H) + tilt * ((q.x - W) * ny + (q.y - H) * nx)), // outer-bottom corner
    ].filter((p) => p.length);
  }

  /** Offscreen canvas the size of the main one, reused across frames. */
  /**
   * Offscreen canvas of at least w × h device pixels, reused across frames.
   * It only grows (resizing a canvas reallocates and clears it), and callers
   * use its top-left w × h region.
   */
  _scratch(key, w, h) {
    let c = this[key];
    if (!c) c = this[key] = document.createElement('canvas');
    if (c.width < w || c.height < h) {
      c.width = Math.max(c.width, Math.ceil(w));
      c.height = Math.max(c.height, Math.ceil(h));
    }
    return c;
  }


  /**
   * Shadow the lifted flap casts on the table just beyond the uncovered page
   * edges (the page itself is shaded separately, crisply from the crease).
   *  - Taper: zero reach where the crease meets an edge (the flap touches
   *    down there), growing along the edge as the flap rises - a wedge from
   *    that point. Averaged over layers whose cut is tilted about it.
   *  - Falloff with true distance from the page - perpendicular along edges,
   *    radial round corners - applied as a mask, so the shadow never ends in a
   *    hard line at the canvas border or a box at a corner.
   * Masking needs destination-in, hence the offscreen buffers.
   */
  _tableShadow(g, side, from, dir, L, alpha) {
    const ctx = this.ctx, W = this.W, H = this.H;
    const F = Math.min(14, this.opts.padding * 0.5); // fade distance from the page edge
    if (alpha <= 0.001 || F < 1) return;
    const m = ctx.getTransform();
    const toW = (q) => this._toWorld(q, side);
    // Device-space box around the strips (the untilted cut covers every layer):
    // all offscreen work is confined to it instead of two full-canvas passes.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of this._tableReach(g, 0, F).flat().map(toW)) {
      const dx = m.a * q.x + m.c * q.y + m.e, dy = m.b * q.x + m.d * q.y + m.f;
      x0 = Math.min(x0, dx); x1 = Math.max(x1, dx); y0 = Math.min(y0, dy); y1 = Math.max(y1, dy);
    }
    if (x0 === Infinity) return;
    x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2);
    x1 = Math.min(this.canvas.width, Math.ceil(x1) + 2); y1 = Math.min(this.canvas.height, Math.ceil(y1) + 2);
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return;
    const begin = (key) => {
      const c = this._scratch(key, bw, bh), x = c.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalCompositeOperation = 'source-over';
      x.globalAlpha = 1;
      x.clearRect(0, 0, bw, bh);
      x.save(); // restored after compositing: clips must not accumulate across frames
      x.beginPath();
      x.rect(0, 0, bw, bh);
      x.clip();
      x.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0); // the buffer's origin is the box's corner
      return [c, x];
    };
    const fillPoly = (x, poly) => {
      x.beginPath();
      poly.map(toW).forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)));
      x.closePath();
      x.fill();
    };

    // 1. Penumbra cone, shaded by distance from the crease like the page.
    const [buf, b] = begin('_shadowBuf');
    const gr = b.createLinearGradient(from.x, from.y, from.x + dir.x * L, from.y + dir.y * L);
    gr.addColorStop(0, `rgba(0,0,0,${alpha})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = gr;
    // Taper: a layer with tilt -t covers the band only where the shadow's reach
    // out from the page, u, is at most d / t, with d the distance along the
    // edge from the crease point. So the shadow is a wedge growing out of the
    // crease point - the flap touches down there and rises with d - reaching
    // the full fade width F at d = taper × F. Tilts are bunched near -taper so
    // the wedge's outer boundary stays fairly sharp; d < 0 (beside the flat
    // part of the page) is never covered, so the shadow never looks bigger.
    const layers = 12, taper = 5;
    b.globalAlpha = 1 / layers;
    for (let i = 0; i < layers; i++) {
      const tilt = -taper * (0.6 + 0.4 * (i + 0.5) / layers);
      b.beginPath();
      for (const poly of this._tableReach(g, tilt, F)) {
        poly.map(toW).forEach((q, j) => (j ? b.lineTo(q.x, q.y) : b.moveTo(q.x, q.y)));
        b.closePath();
      }
      b.fill();
    }

    // 2. Distance-from-page mask: 1 at the edge, 0 at F.
    const [mask, k] = begin('_shadowMask');
    const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    const falloff = (gg) => {
      gg.addColorStop(0, '#000');
      gg.addColorStop(0.35, 'rgba(0,0,0,0.45)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
    };
    const ramp = (a, z, poly) => {
      const A = toW(a), Z = toW(z), gg = k.createLinearGradient(A.x, A.y, Z.x, Z.y);
      falloff(gg);
      k.fillStyle = gg;
      fillPoly(k, poly);
    };
    const round = (corner, poly) => {
      const C = toW(corner), gg = k.createRadialGradient(C.x, C.y, 0, C.x, C.y, F);
      falloff(gg);
      k.fillStyle = gg;
      fillPoly(k, poly);
    };
    ramp({ x: 0, y: 0 }, { x: 0, y: -F }, box(0, -F, W, 0));
    ramp({ x: 0, y: H }, { x: 0, y: H + F }, box(0, H, W, H + F));
    ramp({ x: W, y: 0 }, { x: W + F, y: 0 }, box(W, 0, W + F, H));
    round({ x: W, y: 0 }, box(W, -F, W + F, 0));
    round({ x: W, y: H }, box(W, H, W + F, H + F));

    // 3. Apply the mask and composite onto the book (clipped to the box).
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalAlpha = 1;
    b.globalCompositeOperation = 'destination-in';
    b.drawImage(mask, 0, 0, bw, bh, 0, 0, bw, bh);
    b.globalCompositeOperation = 'source-over';
    b.restore();
    k.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(buf, 0, 0, bw, bh, x0, y0, bw, bh);
    ctx.restore();
  }

  /** Rigid board: rotates about the spine, drawn foreshortened with fake perspective. */
  _renderHard(t) {
    const ctx = this.ctx, H = this.H;
    const { c, sinA, over: side, grow, poly } = this._boardPoly(t);
    const n = c >= 0 ? t.front : t.back;
    const w = this.W * Math.abs(c);
    // Extra shadow while lifted; zero when flat (the resting pass covers that).
    this._paper([poly], this.opts.shadows.board * sinA, 12 + 20 * sinA);

    const src = this._source(n, (side === -1) !== this.rtl);
    const strips = 32;
    ctx.save();
    ctx.translate(this.spineX, 0);
    ctx.scale(side, 1);
    for (let i = 0; i < strips; i++) {
      const u0 = i / strips, u1 = (i + 1) / strips;
      const h = H * (1 + grow * (u0 + u1) / 2);
      const y = this.top + (H - h) / 2;
      const dx = u0 * w, dw = (u1 - u0) * w + (i < strips - 1 ? 0.6 : 0); // overlap hides seams
      if (src) {
        // Draw the whole page scaled to this strip's height, clipped to the
        // strip. Sampling a source sub-rectangle instead would resample edges
        // differently from a single draw, so the board would shimmer and not
        // match the flat page when it lands.
        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, y, dw, h);
        ctx.clip();
        ctx.drawImage(src, 0, y, w, h);
        ctx.restore();
      } else {
        ctx.fillStyle = this.opts.paperColor;
        ctx.fillRect(dx, y, dw, h);
      }
    }
    this._gutter(0, 1, this.top, H, w); // same binding shade a resting page has
    ctx.restore();
    // Turning away from the light: darker toward the outer edge. One fill over
    // the whole board - per-strip fills double up where strips overlap.
    const k = this.opts.shading ? (1 - Math.abs(c)) * this.opts.shadows.boardShade : 0;
    if (k > 0.001 && w > 0.5) {
      const gr = ctx.createLinearGradient(this.spineX, 0, poly[1].x, 0);
      gr.addColorStop(0, `rgba(0,0,0,${0.4 * k})`);
      gr.addColorStop(1, `rgba(0,0,0,${k})`);
      ctx.fillStyle = gr;
      this._path(poly);
      ctx.fill();
    }
  }

  _debugSoft(g, side) {
    if (!this.opts.debug) return;
    const ctx = this.ctx, S = this.start;
    const topEnd = { x: this.spineX, y: this.top }, botEnd = { x: this.spineX, y: this.top + this.H };
    const sW = this._toWorld(S, side), pW = this._toWorld(g.point, side);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#888';
    for (const c of [topEnd, botEnd]) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, dist(c, sW), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (g.flap.length) {
      const m = this._toWorld(g.mid, side), d = { x: -g.normal.y * side, y: g.normal.x };
      ctx.strokeStyle = 'crimson';
      ctx.beginPath();
      ctx.moveTo(m.x - d.x * 2000, m.y - d.y * 2000);
      ctx.lineTo(m.x + d.x * 2000, m.y + d.y * 2000);
      ctx.stroke();
    }
    for (const [q, col] of [[sW, '#3a3'], [pW, '#d33']]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
