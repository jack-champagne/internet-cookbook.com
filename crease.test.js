import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampToLens, computeFold, polygonArea, cubicBezier, reflectionMatrix } from './public/crease.js';

const W = 400, H = 520;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const top = { x: 0, y: 0 }, bottom = { x: 0, y: H };

// Deterministic PRNG so failures are reproducible.
function rng(seed = 1) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function* cases(n = 4000) {
  const r = rng(42);
  for (let i = 0; i < n; i++) {
    const start = { x: W, y: r() < 0.3 ? (r() < 0.5 ? 0 : H) : r() * H };
    const target = { x: -2 * W + r() * 4 * W, y: -H + r() * 3 * H };
    yield { start, target };
  }
}

test('clampToLens: result satisfies both constraints and leaves legal points alone', () => {
  for (const { start, target } of cases()) {
    const ra = dist(top, start), rb = dist(bottom, start);
    const p = clampToLens(target, top, ra, bottom, rb);
    assert.ok(dist(p, top) <= ra + 1e-6 && dist(p, bottom) <= rb + 1e-6);
    if (dist(target, top) <= ra && dist(target, bottom) <= rb) assert.deepEqual(p, target);
  }
});

test('clampToLens: returns the nearest legal point (vs. brute-force sampling)', () => {
  const r = rng(7);
  for (let i = 0; i < 150; i++) {
    const start = { x: W, y: r() * H };
    const target = { x: -2 * W + r() * 4 * W, y: -H + r() * 3 * H };
    const ra = dist(top, start), rb = dist(bottom, start);
    const p = clampToLens(target, top, ra, bottom, rb);
    for (let k = 0; k < 2000; k++) {
      const q = { x: -ra + r() * 2 * ra, y: -ra + r() * (2 * ra + H) };
      if (dist(q, top) <= ra && dist(q, bottom) <= rb) assert.ok(dist(q, target) >= dist(p, target) - 1e-6);
    }
  }
});

test('computeFold: flat + flap partition the page, spine stays on the flat side', () => {
  for (const { start, target } of cases()) {
    const g = computeFold(W, H, start, target);
    assert.ok(Math.abs(polygonArea(g.flat) + polygonArea(g.flap) - W * H) < 1e-3);
    if (!g.flap.length) continue;
    const side = (q) => (q.x - g.mid.x) * g.normal.x + (q.y - g.mid.y) * g.normal.y;
    assert.ok(side(top) <= 1e-6 && side(bottom) <= 1e-6, 'spine end lifted off');
    for (const q of g.flapFolded) assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y));
  }
});

test('computeFold: the held point lands exactly on the dragged point', () => {
  for (const { start, target } of cases(500)) {
    const g = computeFold(W, H, start, target);
    if (!g.flap.length) continue;
    const s = 2 * ((start.x - g.mid.x) * g.normal.x + (start.y - g.mid.y) * g.normal.y);
    const landed = { x: start.x - s * g.normal.x, y: start.y - s * g.normal.y };
    assert.ok(dist(landed, g.point) < 1e-6);
  }
});

test('computeFold: fully turned = whole page mirrored through the spine', () => {
  for (const y of [0, H / 3, H]) {
    const g = computeFold(W, H, { x: W, y }, { x: -W, y });
    assert.equal(g.flat.length, 0);
    assert.ok(Math.abs(polygonArea(g.flap) - W * H) < 1e-6);
    assert.ok(Math.abs(g.progress - 1) < 1e-9);
    for (const q of g.flapFolded) assert.ok(q.x <= 1e-9 && q.x >= -W - 1e-9);
  }
  const flat = computeFold(W, H, { x: W, y: H }, { x: W, y: H });
  assert.equal(flat.flap.length, 0);
  assert.equal(flat.progress, 0);
});

test('flap transform at full turn is identity (back page lands upright, unmirrored)', () => {
  const compose = (m1, m2) => [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
  const spine = reflectionMatrix({ x: 0, y: 0 }, { x: 1, y: 0 });
  const g = computeFold(W, H, { x: W, y: 100 }, { x: -W, y: 100 });
  const m = compose(reflectionMatrix(g.mid, g.normal), spine);
  [1, 0, 0, 1, 0, 0].forEach((v, i) => assert.ok(Math.abs(m[i] - v) < 1e-9));
  // Mid-turn the composite is a rotation (det +1), never a mirror.
  const mid = computeFold(W, H, { x: W, y: H }, { x: 50, y: 300 });
  const r = compose(reflectionMatrix(mid.mid, mid.normal), spine);
  assert.ok(Math.abs(r[0] * r[3] - r[1] * r[2] - 1) < 1e-9);
});

test('cubicBezier hits its endpoints', () => {
  const p = [{ x: 0, y: 0 }, { x: 1, y: 5 }, { x: 4, y: 5 }, { x: 9, y: 2 }];
  assert.deepEqual(cubicBezier(...p, 0), p[0]);
  assert.deepEqual(cubicBezier(...p, 1), p[3]);
});
