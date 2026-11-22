/**
 * crease/geometry.js — the pure, DOM-free geometry behind a page fold:
 * the constraint lens, half-plane clipping, reflections and the fold itself.
 * See the model description at the top of crease.js; tested in crease.test.js.
 */

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** Point on the cubic Bezier p0..p3 at parameter t ∈ [0, 1]. */
export function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function projectToCircle(p, c, r) {
  const d = dist(p, c);
  if (d < 1e-12) return { x: c.x + r, y: c.y };
  return { x: c.x + ((p.x - c.x) * r) / d, y: c.y + ((p.y - c.y) * r) / d };
}

/** Intersection points of two circles (0 or 2 points). */
export function circleIntersections(a, ra, b, rb) {
  const d = dist(a, b);
  if (d < 1e-12 || d > ra + rb || d < Math.abs(ra - rb)) return [];
  const along = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - along * along));
  const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
  const mx = a.x + ux * along, my = a.y + uy * along;
  return [
    { x: mx - uy * h, y: my + ux * h },
    { x: mx + uy * h, y: my - ux * h },
  ];
}

/**
 * Nearest point to p inside disc(a, ra) ∩ disc(b, rb).
 * The nearest point of a lens is either p itself, p projected onto one arc
 * (if that lands inside the other disc), or one of the lens's two tips.
 */
export function clampToLens(p, a, ra, b, rb, tol = 1e-6) {
  const inside = (q) => dist(q, a) <= ra + tol && dist(q, b) <= rb + tol;
  if (inside(p)) return { x: p.x, y: p.y };
  const candidates = [
    projectToCircle(p, a, ra),
    projectToCircle(p, b, rb),
    ...circleIntersections(a, ra, b, rb),
  ].filter(inside);
  if (!candidates.length) return projectToCircle(p, a, ra); // discs don't overlap; can't happen when S is in both
  let best = candidates[0];
  for (const q of candidates) if (dist(q, p) < dist(best, p)) best = q;
  return best;
}

/**
 * Sutherland–Hodgman clip of a convex polygon against one half-plane:
 * keeps the part where f(q) ≥ 0 (f must be affine). Near-duplicate vertices
 * are merged; returns [] when less than a triangle remains.
 */
export function clipHalfPlane(poly, f, eps = 1e-6) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
    const fc = f(cur), fp = f(prev);
    if ((fc >= 0) !== (fp >= 0)) out.push(lerp(prev, cur, fp / (fp - fc)));
    if (fc >= 0) out.push(cur);
  }
  const merged = out.filter((q, i) => dist(q, out[(i + 1) % out.length]) > eps);
  return merged.length >= 3 ? merged : [];
}

export function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Canvas transform [a, b, c, d, e, f] reflecting across the line through m with unit normal n. */
export function reflectionMatrix(m, n) {
  const k = 2 * (m.x * n.x + m.y * n.y);
  return [1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.y, 1 - 2 * n.y * n.y, k * n.x, k * n.y];
}

/**
 * Fold a W×H page (spine at x = 0) so the held point `start` moves toward
 * `target`. Returns:
 *   point      – target constrained so the spine stays attached
 *   progress   – 0 when flat, 1 when fully turned over the spine
 *   flat       – polygon of the part that stays put
 *   flap       – polygon of the part that lifts (original position)
 *   flapFolded – the flap reflected across the crease (where it is drawn)
 *   mid/normal – crease line: through `mid`, unit `normal` pointing to the flap
 *   depth      – how far the flap reaches from the crease
 */
export function computeFold(W, H, start, target) {
  const top = { x: 0, y: 0 }, bottom = { x: 0, y: H };
  const point = clampToLens(target, top, dist(top, start), bottom, dist(bottom, start));
  const rect = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const progress = start.x > 0 ? clamp((start.x - point.x) / (2 * start.x), 0, 1) : 0;
  const dx = start.x - point.x, dy = start.y - point.y, len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    return { point, progress: 0, flat: rect, flap: [], flapFolded: [], mid: point, normal: { x: 1, y: 0 }, depth: 0 };
  }
  const normal = { x: dx / len, y: dy / len };
  const mid = lerp(start, point, 0.5);
  const side = (q) => (q.x - mid.x) * normal.x + (q.y - mid.y) * normal.y;
  const flat = clipHalfPlane(rect, (q) => -side(q));
  const flap = clipHalfPlane(rect, side);
  const reflect = (q) => {
    const s = 2 * side(q);
    return { x: q.x - s * normal.x, y: q.y - s * normal.y };
  };
  const depth = flap.reduce((m, q) => Math.max(m, side(q)), 0);
  return { point, progress, flat, flap, flapFolded: flap.map(reflect), mid, normal, depth };
}
