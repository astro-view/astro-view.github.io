/**
 * Field of view and camera projection.
 *
 * The FOV figures are checked against values a lens manufacturer would quote,
 * and the projection is checked for the properties that matter photographically:
 * the frame edge is exactly at half the FOV, focal length changes the angular
 * coverage rather than scaling an image, and roll rotates the frame without
 * moving the optical axis.
 */
import { describe, expect, it } from 'vitest';
import {
  cameraBasis,
  clampRoll,
  computeFieldOfView,
  focalLengthForFov,
  fovForDimension,
  frameToDirection,
  projectToFrame,
} from '../src/camera/projection';
import { sensorById } from '../src/camera/sensors';
import { enuFromHorizontal, horizontalFromEnu } from '../src/astronomy/coordinates';
import { angularSeparationDeg } from '../src/astronomy/constants';

const FULL_FRAME = sensorById('full-frame');
const APSC = sensorById('aps-c');

describe('field of view', () => {
  it('matches published figures for full frame', () => {
    // Canonical 35 mm-format angles of view.
    const expectations: Array<[number, number, number]> = [
      // focal, horizontal, diagonal
      [14, 104.3, 114.2],
      [20, 83.97, 94.49],
      [24, 73.74, 84.06],
      [35, 54.43, 63.44],
      [50, 39.6, 46.79],
      [85, 23.91, 28.56],
      [200, 10.29, 12.35],
    ];
    for (const [focal, horizontal, diagonal] of expectations) {
      const fov = computeFieldOfView(FULL_FRAME, focal, 'landscape');
      expect(fov.horizontal).toBeCloseTo(horizontal, 1);
      expect(fov.diagonal).toBeCloseTo(diagonal, 1);
    }
  });

  it('uses the formula 2*atan(d / 2f)', () => {
    expect(fovForDimension(36, 50)).toBeCloseTo((2 * Math.atan(36 / 100) * 180) / Math.PI, 10);
    // A sensor dimension equal to twice the focal length gives exactly 90 degrees.
    expect(fovForDimension(100, 50)).toBeCloseTo(90, 10);
  });

  it('APS-C sees less than full frame at the same focal length', () => {
    const ff = computeFieldOfView(FULL_FRAME, 24, 'landscape');
    const crop = computeFieldOfView(APSC, 24, 'landscape');
    expect(crop.horizontal).toBeLessThan(ff.horizontal);
    // The equivalent full-frame focal length is the crop factor times the focal.
    const equivalent = focalLengthForFov(FULL_FRAME.width, crop.horizontal);
    expect(equivalent / 24).toBeCloseTo(FULL_FRAME.width / APSC.width, 2);
  });

  it('portrait swaps the two axes', () => {
    const landscape = computeFieldOfView(FULL_FRAME, 35, 'landscape');
    const portrait = computeFieldOfView(FULL_FRAME, 35, 'portrait');
    expect(portrait.horizontal).toBeCloseTo(landscape.vertical, 10);
    expect(portrait.vertical).toBeCloseTo(landscape.horizontal, 10);
    expect(portrait.aspect).toBeCloseTo(1 / landscape.aspect, 10);
    // The diagonal is a property of the sensor, not of how it is held.
    expect(portrait.diagonal).toBeCloseTo(landscape.diagonal, 10);
  });

  it('focal length changes the angle, monotonically', () => {
    let previous = Infinity;
    for (const f of [8, 14, 24, 35, 50, 85, 135, 200]) {
      const fov = computeFieldOfView(FULL_FRAME, f, 'landscape');
      expect(fov.horizontal).toBeLessThan(previous);
      previous = fov.horizontal;
    }
  });

  it('focalLengthForFov inverts fovForDimension', () => {
    for (const f of [8, 24, 50, 200]) {
      const fov = fovForDimension(36, f);
      expect(focalLengthForFov(36, fov)).toBeCloseTo(f, 9);
    }
  });
});

describe('camera basis', () => {
  it('points along the requested azimuth and elevation', () => {
    for (const az of [0, 90, 180, 270, 345.5]) {
      for (const el of [-10, 0, 30, 75, 89]) {
        const { forward } = cameraBasis(az, el, 0);
        const h = horizontalFromEnu(forward);
        expect(h.altitude).toBeCloseTo(el, 8);
        expect(angularSeparationDeg(h.azimuth, h.altitude, az, el)).toBeLessThan(1e-6);
      }
    }
  });

  it('is orthonormal and right-handed', () => {
    for (const [az, el, roll] of [
      [0, 0, 0],
      [137, 42, 0],
      [137, 42, 33],
      [0, 90, 0],
      [250, -10, -75],
    ]) {
      const { forward, right, up } = cameraBasis(az, el, roll);
      const dot = (a: readonly number[], b: readonly number[]) =>
        a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(dot(forward, forward)).toBeCloseTo(1, 9);
      expect(dot(right, right)).toBeCloseTo(1, 9);
      expect(dot(up, up)).toBeCloseTo(1, 9);
      expect(dot(forward, right)).toBeCloseTo(0, 9);
      expect(dot(forward, up)).toBeCloseTo(0, 9);
      expect(dot(right, up)).toBeCloseTo(0, 9);
      // right x up = -forward
      const cx = right[1] * up[2] - right[2] * up[1];
      const cy = right[2] * up[0] - right[0] * up[2];
      const cz = right[0] * up[1] - right[1] * up[0];
      expect(cx).toBeCloseTo(-forward[0], 9);
      expect(cy).toBeCloseTo(-forward[1], 9);
      expect(cz).toBeCloseTo(-forward[2], 9);
    }
  });

  it('with roll zero, right is horizontal and up is above the axis', () => {
    const { right, up } = cameraBasis(137, 42, 0);
    expect(right[1]).toBeCloseTo(0, 9); // no vertical component: horizon is level
    expect(up[1]).toBeGreaterThan(0);
  });

  it('facing north, right is east and up is the zenith', () => {
    const { right, up } = cameraBasis(0, 0, 0);
    expect(right[0]).toBeCloseTo(1, 9);
    expect(up[1]).toBeCloseTo(1, 9);
  });

  it('stays continuous through the zenith', () => {
    const below = cameraBasis(0, 89.99, 0);
    const at = cameraBasis(0, 90, 0);
    for (let i = 0; i < 3; i++) {
      expect(at.right[i]).toBeCloseTo(below.right[i], 3);
      expect(at.up[i]).toBeCloseTo(below.up[i], 3);
    }
  });
});

describe('rectilinear projection', () => {
  const fov = computeFieldOfView(FULL_FRAME, 35, 'landscape');
  const basis = cameraBasis(180, 30, 0);

  it('puts the optical axis at the centre of the frame', () => {
    const p = projectToFrame(enuFromHorizontal(180, 30), basis, fov);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.inFrame).toBe(true);
    expect(p.offAxisDeg).toBeCloseTo(0, 6);
  });

  it('puts half the vertical FOV exactly at the top edge', () => {
    const edge = enuFromHorizontal(180, 30 + fov.vertical / 2);
    const p = projectToFrame(edge, basis, fov);
    expect(p.y).toBeCloseTo(1, 6);
    expect(Math.abs(p.x)).toBeLessThan(1e-6);
  });

  it('puts half the horizontal FOV at the side edge', () => {
    // On the optical axis' horizontal great circle, measured as a true angle.
    const half = fov.horizontal / 2;
    const dir = frameToDirection(1, 0, basis, fov);
    const p = projectToFrame(dir, basis, fov);
    expect(p.x).toBeCloseTo(1, 9);
    expect(p.offAxisDeg).toBeCloseTo(half, 6);
  });

  it('rejects directions behind the camera', () => {
    const p = projectToFrame(enuFromHorizontal(0, -30), basis, fov);
    expect(p.inFrame).toBe(false);
  });

  it('round-trips frameToDirection and projectToFrame', () => {
    for (const x of [-1, -0.37, 0, 0.62, 1]) {
      for (const y of [-1, -0.2, 0, 0.8, 1]) {
        const p = projectToFrame(frameToDirection(x, y, basis, fov), basis, fov);
        expect(p.x).toBeCloseTo(x, 9);
        expect(p.y).toBeCloseTo(y, 9);
      }
    }
  });

  it('a longer lens pushes the same star further from the centre', () => {
    const star = enuFromHorizontal(186, 33);
    const wide = computeFieldOfView(FULL_FRAME, 14, 'landscape');
    const tele = computeFieldOfView(FULL_FRAME, 85, 'landscape');
    const pWide = projectToFrame(star, basis, wide);
    const pTele = projectToFrame(star, basis, tele);
    expect(Math.hypot(pTele.x, pTele.y)).toBeGreaterThan(Math.hypot(pWide.x, pWide.y));
    // The physical direction has not moved: only the framing changed.
    expect(pWide.offAxisDeg).toBeCloseTo(pTele.offAxisDeg, 9);
  });

  it('something inside a wide frame can fall outside a narrow one', () => {
    const star = enuFromHorizontal(205, 30);
    const wide = computeFieldOfView(FULL_FRAME, 14, 'landscape');
    const tele = computeFieldOfView(FULL_FRAME, 85, 'landscape');
    expect(projectToFrame(star, basis, wide).inFrame).toBe(true);
    expect(projectToFrame(star, basis, tele).inFrame).toBe(false);
  });

  it('is rectilinear: straight lines on the sky stay straight in the frame', () => {
    // Sample a great circle through the optical axis; its image must be a
    // straight line, which a fisheye projection would curve.
    const wide = computeFieldOfView(FULL_FRAME, 14, 'landscape');
    const b = cameraBasis(90, 0, 0);
    const points: Array<{ x: number; y: number }> = [];
    for (let alt = -30; alt <= 30; alt += 5) {
      const p = projectToFrame(enuFromHorizontal(90, alt), b, wide);
      if (p.inFrame) points.push(p);
    }
    expect(points.length).toBeGreaterThan(4);
    for (const p of points) expect(Math.abs(p.x)).toBeLessThan(1e-9);
  });

  it('roll rotates the frame but not the optical axis', () => {
    const star = enuFromHorizontal(186, 33);
    const noRoll = cameraBasis(180, 30, 0);
    const rolled = cameraBasis(180, 30, 90);
    const a = projectToFrame(star, noRoll, fov);
    const bb = projectToFrame(star, rolled, fov);
    expect(a.offAxisDeg).toBeCloseTo(bb.offAxisDeg, 9);
    // 90 degrees of roll turns frame coordinates by 90 degrees, in tangent space.
    const halfW = Math.tan(((fov.horizontal / 2) * Math.PI) / 180);
    const halfH = Math.tan(((fov.vertical / 2) * Math.PI) / 180);
    const a1 = { x: a.x * halfW, y: a.y * halfH };
    const b1 = { x: bb.x * halfW, y: bb.y * halfH };
    expect(Math.hypot(b1.x, b1.y)).toBeCloseTo(Math.hypot(a1.x, a1.y), 9);
    expect(b1.x).toBeCloseTo(a1.y, 9);
    expect(b1.y).toBeCloseTo(-a1.x, 9);
  });
});

describe('roll clamping', () => {
  it('wraps into (-180, 180]', () => {
    expect(clampRoll(0)).toBe(0);
    expect(clampRoll(190)).toBeCloseTo(-170, 9);
    expect(clampRoll(-190)).toBeCloseTo(170, 9);
    expect(clampRoll(360)).toBeCloseTo(0, 9);
    expect(clampRoll(180)).toBeCloseTo(180, 9);
  });
});
