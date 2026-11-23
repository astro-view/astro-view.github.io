/**
 * The overview camera and the frame rectangle drawn inside it.
 *
 * The property that matters: a direction falls inside the drawn rectangle
 * exactly when the lens would capture it. That is checked here by projecting
 * directions through BOTH projections and comparing, which is the same thing
 * the UI does when it decides whether to dim a label.
 */
import { describe, expect, it } from 'vitest';
import { computeOverview, DEFAULT_OVERVIEW_MARGIN } from '../src/camera/overview';
import {
  cameraBasis,
  computeFieldOfView,
  frameToDirection,
  projectToFrame,
} from '../src/camera/projection';
import { FOCAL_MAX, FOCAL_MIN, sensorById } from '../src/camera/sensors';

const FULL_FRAME = sensorById('full-frame');

describe('overview geometry', () => {
  it('is wider than the lens for every real focal length', () => {
    for (const focal of [8, 14, 24, 35, 85, 200]) {
      const lens = computeFieldOfView(FULL_FRAME, focal, 'landscape');
      const o = computeOverview(lens, 1200, 800);
      expect(o.fov.horizontal).toBeGreaterThan(lens.horizontal);
      expect(o.fov.vertical).toBeGreaterThan(lens.vertical);
      expect(o.frameExceedsView).toBe(false);
    }
  });

  it('reports, rather than hides, a lens wider than the preview can show', () => {
    // Below ~4 mm on full frame the rectilinear cap bites and the frame no
    // longer fits. The flag is what stops the UI drawing a misleading
    // rectangle clipped to the canvas edge.
    const lens = computeFieldOfView(FULL_FRAME, 1, 'landscape');
    const o = computeOverview(lens, 1200, 800);
    expect(o.fov.horizontal).toBeLessThan(lens.horizontal);
    expect(o.frameExceedsView).toBe(true);
  });

  it('the flag agrees with whether the frame actually fits', () => {
    for (let focal = 1; focal <= 40; focal += 0.5) {
      const lens = computeFieldOfView(FULL_FRAME, focal, 'landscape');
      const o = computeOverview(lens, 1200, 800);
      const fits = lens.horizontal < o.fov.horizontal && lens.vertical < o.fov.vertical;
      expect(o.frameExceedsView).toBe(!fits);
    }
  });

  it('puts the frame rectangle inside the canvas', () => {
    for (const focal of [1, 8, 24, 50, 200]) {
      for (const [w, h] of [
        [1200, 800],
        [600, 900],
        [320, 240],
      ]) {
        const lens = computeFieldOfView(FULL_FRAME, focal, 'landscape');
        const o = computeOverview(lens, w, h);
        expect(o.frameWidth).toBeGreaterThan(0);
        expect(o.frameHeight).toBeGreaterThan(0);
        expect(o.frameWidth).toBeLessThanOrEqual(w);
        expect(o.frameHeight).toBeLessThanOrEqual(h);
      }
    }
  });

  it('keeps the requested margin when it is not capped', () => {
    const lens = computeFieldOfView(FULL_FRAME, 50, 'landscape');
    const w = 1200;
    const h = 800;
    const o = computeOverview(lens, w, h);
    expect(o.marginClamped).toBe(false);
    // The binding axis should be scaled by exactly the margin in tangent space.
    const tanLensV = Math.tan(((lens.vertical / 2) * Math.PI) / 180);
    const tanOverV = Math.tan(((o.fov.vertical / 2) * Math.PI) / 180);
    const tanLensH = Math.tan(((lens.horizontal / 2) * Math.PI) / 180);
    const tanOverH = Math.tan(((o.fov.horizontal / 2) * Math.PI) / 180);
    const scale = Math.min(tanOverV / tanLensV, tanOverH / tanLensH);
    expect(scale).toBeCloseTo(DEFAULT_OVERVIEW_MARGIN, 6);
  });

  it('caps the overview instead of running away near 180 degrees', () => {
    const lens = computeFieldOfView(FULL_FRAME, FOCAL_MIN, 'landscape');
    expect(lens.horizontal).toBeGreaterThan(170); // 1 mm on full frame
    const o = computeOverview(lens, 1200, 800);
    expect(o.marginClamped).toBe(true);
    expect(o.fov.vertical).toBeLessThanOrEqual(130.001);
    expect(Number.isFinite(o.frameWidth)).toBe(true);
    expect(Number.isFinite(o.frameHeight)).toBe(true);
  });

  it('the frame rectangle matches the lens projection exactly', () => {
    // Project the lens' own frame corners and edge midpoints into the overview
    // and check they land on the rectangle the UI draws.
    const lens = computeFieldOfView(FULL_FRAME, 35, 'landscape');
    const w = 1280;
    const h = 720;
    const o = computeOverview(lens, w, h);
    const basis = cameraBasis(137, 34, 0);

    const left = (w - o.frameWidth) / 2;
    const top = (h - o.frameHeight) / 2;

    for (const [fx, fy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
      [0, 1],
      [1, 0],
      [0, 0],
    ]) {
      const dir = frameToDirection(fx, fy, basis, lens);
      const p = projectToFrame(dir, basis, o.fov);
      const px = ((p.x + 1) / 2) * w;
      const py = ((1 - p.y) / 2) * h;
      // Expected pixel position on the drawn rectangle.
      const ex = left + ((fx + 1) / 2) * o.frameWidth;
      const ey = top + ((1 - fy) / 2) * o.frameHeight;
      expect(px).toBeCloseTo(ex, 6);
      expect(py).toBeCloseTo(ey, 6);
    }
  });

  it('agrees with the lens about what is in frame', () => {
    const lens = computeFieldOfView(FULL_FRAME, 50, 'landscape');
    const o = computeOverview(lens, 1000, 700);
    const basis = cameraBasis(200, 25, 17);
    const left = (1000 - o.frameWidth) / 2;
    const top = (700 - o.frameHeight) / 2;

    // Sample the overview and check the two notions of "inside" coincide.
    for (let ox = -0.95; ox <= 0.95; ox += 0.19) {
      for (let oy = -0.95; oy <= 0.95; oy += 0.19) {
        const dir = frameToDirection(ox, oy, basis, o.fov);
        const inLens = projectToFrame(dir, basis, lens).inFrame;
        const px = ((ox + 1) / 2) * 1000;
        const py = ((1 - oy) / 2) * 700;
        const inRect =
          px >= left - 1e-6 &&
          px <= left + o.frameWidth + 1e-6 &&
          py >= top - 1e-6 &&
          py <= top + o.frameHeight + 1e-6;
        expect(inRect).toBe(inLens);
      }
    }
  });

  it('adapts the frame shape to a portrait canvas', () => {
    const lens = computeFieldOfView(FULL_FRAME, 35, 'landscape');
    const wide = computeOverview(lens, 1200, 600);
    const tall = computeOverview(lens, 600, 1200);
    // The frame keeps the sensor's 3:2 aspect whatever shape the canvas is.
    expect(wide.frameWidth / wide.frameHeight).toBeCloseTo(lens.aspect, 6);
    expect(tall.frameWidth / tall.frameHeight).toBeCloseTo(lens.aspect, 6);
  });

  it('survives degenerate canvas sizes', () => {
    const lens = computeFieldOfView(FULL_FRAME, 35, 'landscape');
    for (const [w, h] of [
      [0, 0],
      [1, 1],
      [1, 2000],
    ]) {
      const o = computeOverview(lens, w, h);
      expect(Number.isFinite(o.fov.horizontal)).toBe(true);
      expect(Number.isFinite(o.fov.vertical)).toBe(true);
      expect(o.frameWidth).toBeGreaterThan(0);
      expect(o.frameHeight).toBeGreaterThan(0);
    }
  });
});

describe('focal length range', () => {
  it('reaches 1 mm, and 1 mm is an extreme rectilinear angle', () => {
    expect(FOCAL_MIN).toBe(1);
    const lens = computeFieldOfView(FULL_FRAME, 1, 'landscape');
    // 2*atan(18/1) = 173.64 deg horizontally, 2*atan(12/1) = 170.47 deg vertically.
    expect(lens.horizontal).toBeCloseTo(173.64, 1);
    expect(lens.vertical).toBeCloseTo(170.47, 1);
  });

  it('the whole range produces finite, ordered fields of view', () => {
    let previous = Infinity;
    for (let f = FOCAL_MIN; f <= FOCAL_MAX; f += 1) {
      const lens = computeFieldOfView(FULL_FRAME, f, 'landscape');
      expect(Number.isFinite(lens.horizontal)).toBe(true);
      expect(lens.horizontal).toBeLessThan(180);
      expect(lens.horizontal).toBeLessThan(previous);
      previous = lens.horizontal;
    }
  });
});
