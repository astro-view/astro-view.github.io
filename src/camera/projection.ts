/**
 * Camera field of view and rectilinear projection onto the image plane.
 *
 * The field of view follows directly from the sensor size and focal length:
 *
 *     FOV = 2 * atan( sensor_dimension / (2 * focal_length) )
 *
 * which is the thin-lens, infinity-focus, distortion-free (rectilinear) model
 * that every lens manufacturer quotes. Changing the focal length therefore
 * changes the ANGULAR extent of the frame; it never scales a fixed image.
 *
 * CAMERA FRAME
 *  The camera is described by azimuth, elevation and roll, all in degrees.
 *   - azimuth   0..360, from north increasing eastward (0 N, 90 E, 180 S, 270 W)
 *   - elevation -10..90, degrees above the horizon of the optical axis
 *   - roll      -180..180, rotation about the optical axis; positive rolls the
 *               horizon clockwise in the resulting image (camera rotated
 *               counter-clockwise), matching how a tripod head reads.
 *
 *  Basis vectors in the renderer's ENU world frame (x east, y up, z south):
 *   forward  the optical axis
 *   right    towards the right edge of the image
 *   up       towards the top edge of the image
 */
import { DEG2RAD, RAD2DEG, clamp, normalizeDeg } from '../astronomy/constants';
import { type Vec3, enuFromHorizontal } from '../astronomy/coordinates';
import type { SensorFormat } from './sensors';

export type FrameOrientation = 'landscape' | 'portrait';

export interface CameraSettings {
  sensor: SensorFormat;
  /** Millimetres. */
  focalLength: number;
  orientation: FrameOrientation;
  azimuth: number;
  elevation: number;
  roll: number;
}

export interface FieldOfView {
  /** Degrees across the frame's horizontal (long in landscape) axis. */
  horizontal: number;
  /** Degrees across the frame's vertical axis. */
  vertical: number;
  /** Degrees across the frame diagonal. */
  diagonal: number;
  /** width / height of the frame as displayed. */
  aspect: number;
  /** Sensor dimensions as displayed, in mm. */
  frameWidthMm: number;
  frameHeightMm: number;
}

/** Angular field of view of one sensor dimension at a focal length. */
export function fovForDimension(dimensionMm: number, focalLengthMm: number): number {
  if (focalLengthMm <= 0) return 0;
  return 2 * Math.atan(dimensionMm / (2 * focalLengthMm)) * RAD2DEG;
}

export function computeFieldOfView(
  sensor: SensorFormat,
  focalLength: number,
  orientation: FrameOrientation,
): FieldOfView {
  const frameWidthMm = orientation === 'landscape' ? sensor.width : sensor.height;
  const frameHeightMm = orientation === 'landscape' ? sensor.height : sensor.width;
  const diagonalMm = Math.hypot(sensor.width, sensor.height);
  return {
    horizontal: fovForDimension(frameWidthMm, focalLength),
    vertical: fovForDimension(frameHeightMm, focalLength),
    diagonal: fovForDimension(diagonalMm, focalLength),
    aspect: frameWidthMm / frameHeightMm,
    frameWidthMm,
    frameHeightMm,
  };
}

/** Focal length that yields a given horizontal field of view - the inverse. */
export function focalLengthForFov(dimensionMm: number, fovDeg: number): number {
  const half = (fovDeg / 2) * DEG2RAD;
  return dimensionMm / (2 * Math.tan(half));
}

export interface CameraBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function normalize(a: Vec3): Vec3 {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}

/**
 * Orthonormal camera basis in ENU world coordinates.
 *
 * With roll = 0 the frame's up axis lies in the vertical plane containing the
 * optical axis, i.e. the horizon is level. Looking straight up (elevation 90)
 * is degenerate for that rule, so the azimuth direction is used as the
 * reference there - the frame then keeps pointing "towards the azimuth".
 */
export function cameraBasis(azimuth: number, elevation: number, roll: number): CameraBasis {
  const el = clamp(elevation, -90, 90);
  const forward = normalize(enuFromHorizontal(azimuth, el));
  const worldUp: Vec3 = [0, 1, 0];

  let right: Vec3;
  if (Math.abs(dot(forward, worldUp)) > 0.999999) {
    // Looking at the zenith or nadir: the horizontal reference is degenerate,
    // so use the azimuth direction on the horizon. This matches the limit the
    // general branch approaches, keeping the frame continuous through 90 deg.
    const azDir = enuFromHorizontal(azimuth, 0);
    right = normalize(cross(azDir, forward));
  } else {
    right = normalize(cross(forward, worldUp));
  }
  // (right, up, -forward) is right-handed, as in a conventional camera frame.
  let up = normalize(cross(right, forward));

  if (roll !== 0) {
    // Rotating the basis counter-clockwise rotates the scene clockwise in the
    // resulting image, which is how a levelling base reads.
    const r = roll * DEG2RAD;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const rolledRight = normalize(add(scale(right, c), scale(up, s)));
    const rolledUp = normalize(add(scale(right, -s), scale(up, c)));
    right = rolledRight;
    up = rolledUp;
  }
  return { forward, right, up };
}

export interface FramePoint {
  /** -1 (left edge) .. +1 (right edge). */
  x: number;
  /** -1 (bottom edge) .. +1 (top edge). */
  y: number;
  /** False when the direction is behind the camera or outside the frame. */
  inFrame: boolean;
  /** Angular distance from the optical axis, degrees. */
  offAxisDeg: number;
}

/**
 * Project a world direction onto the normalised image plane using the same
 * rectilinear model as the field of view. A direction at exactly the frame edge
 * maps to +/-1 on that axis.
 */
export function projectToFrame(
  direction: Vec3,
  basis: CameraBasis,
  fov: FieldOfView,
): FramePoint {
  const d = normalize(direction);
  const z = dot(d, basis.forward);
  const offAxisDeg = Math.acos(clamp(z, -1, 1)) * RAD2DEG;
  if (z <= 1e-6) return { x: 0, y: 0, inFrame: false, offAxisDeg };

  const xTan = dot(d, basis.right) / z;
  const yTan = dot(d, basis.up) / z;
  const halfW = Math.tan((fov.horizontal / 2) * DEG2RAD);
  const halfH = Math.tan((fov.vertical / 2) * DEG2RAD);
  const x = xTan / halfW;
  const y = yTan / halfH;
  return { x, y, inFrame: Math.abs(x) <= 1 && Math.abs(y) <= 1, offAxisDeg };
}

/**
 * Inverse projection: the world direction a normalised frame position looks at.
 */
export function frameToDirection(x: number, y: number, basis: CameraBasis, fov: FieldOfView): Vec3 {
  const halfW = Math.tan((fov.horizontal / 2) * DEG2RAD);
  const halfH = Math.tan((fov.vertical / 2) * DEG2RAD);
  return normalize(
    add(
      add(scale(basis.right, x * halfW), scale(basis.up, y * halfH)),
      basis.forward,
    ),
  );
}

/**
 * Change in azimuth and elevation for a drag across the preview, in degrees.
 * The scaling uses the current field of view so a drag moves the sky by the
 * same amount of frame no matter the focal length. Azimuth is divided by
 * cos(elevation) so the apparent motion under the cursor stays roughly
 * one-to-one when the camera is pitched up.
 */
export function dragToOrientationDelta(
  dxFraction: number,
  dyFraction: number,
  fov: FieldOfView,
  elevation: number,
): { dAzimuth: number; dElevation: number } {
  const cosEl = Math.max(0.12, Math.cos(elevation * DEG2RAD));
  return {
    dAzimuth: (-dxFraction * fov.horizontal) / cosEl,
    dElevation: dyFraction * fov.vertical,
  };
}

export function clampElevation(elevation: number): number {
  return clamp(elevation, -10, 90);
}

export function wrapAzimuth(azimuth: number): number {
  return normalizeDeg(azimuth);
}

export function clampRoll(roll: number): number {
  let r = ((roll + 180) % 360 + 360) % 360 - 180;
  if (r === -180) r = 180;
  return r;
}
