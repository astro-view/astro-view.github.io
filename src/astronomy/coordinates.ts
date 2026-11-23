/**
 * Celestial coordinate transformations.
 *
 * The single source of truth for the equatorial -> horizontal transform is
 * astronomy-engine's `Rotation_EQJ_HOR`, which accounts for precession,
 * nutation, Earth rotation and the observer's position. We expose it as a plain
 * 3x3 matrix so the renderer can transform ~9000 catalogue stars with one matrix
 * instead of ~9000 trigonometric reductions per frame.
 *
 * FRAMES
 *  EQJ  equatorial, mean equator and equinox of J2000 (ICRS, what a catalogue gives)
 *         x -> RA 0h on the equator, z -> north celestial pole
 *  HOR  horizontal, astronomy-engine's convention
 *         x -> north, y -> west, z -> zenith
 *  ENU  the renderer's world frame (right-handed, three.js up = +Y)
 *         x -> EAST, y -> UP (zenith), z -> SOUTH
 *
 * `horizontalFromEnu` / `enuFromHorizontal` are the only places where the two
 * horizontal conventions meet. Everything downstream of the renderer is ENU.
 */
import * as Astronomy from 'astronomy-engine';
import { DEG2RAD, RAD2DEG, clamp, normalizeDeg } from './constants';

export interface GeoLocation {
  /** Degrees north of the equator, -90..90. */
  latitude: number;
  /** Degrees east of Greenwich, -180..180. */
  longitude: number;
  /** Metres above sea level. */
  elevation: number;
}

export interface EquatorialCoord {
  raDeg: number;
  decDeg: number;
}

export interface HorizontalCoord {
  /** Degrees from north, increasing eastward. */
  azimuth: number;
  /** Degrees above the geometric horizon. */
  altitude: number;
}

/** A 3x3 row-major rotation matrix. */
export type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

export type Vec3 = readonly [number, number, number];

export function observerFor(location: GeoLocation): Astronomy.Observer {
  return new Astronomy.Observer(location.latitude, location.longitude, location.elevation);
}

/** Unit vector in the EQJ frame for catalogue (RA, Dec) in degrees. */
export function equatorialToVector(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

/** Inverse of {@link equatorialToVector}. */
export function vectorToEquatorial(v: Vec3): EquatorialCoord {
  const r = Math.hypot(v[0], v[1], v[2]) || 1;
  return {
    raDeg: normalizeDeg(Math.atan2(v[1], v[0]) * RAD2DEG),
    decDeg: Math.asin(clamp(v[2] / r, -1, 1)) * RAD2DEG,
  };
}

export function multiplyMatrixVector(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/**
 * Rotation taking an EQJ unit vector to the renderer's ENU world frame
 * (x east, y up, z south) for a given instant and observer.
 *
 * astronomy-engine returns EQJ -> HOR with HOR axes (north, west, zenith):
 *   east  = -west        -> ENU x = -HOR y
 *   up    =  zenith      -> ENU y =  HOR z
 *   south = -north       -> ENU z = -HOR x
 */
export function equatorialToEnuMatrix(date: Date, location: GeoLocation): Mat3 {
  const r = Astronomy.Rotation_EQJ_HOR(date, observerFor(location)).rot;
  // astronomy-engine stores `rot[column][row]`; rot[j][i] multiplies source axis j
  // into target axis i. Pull out the three target-axis rows explicitly.
  const north: Vec3 = [r[0][0], r[1][0], r[2][0]];
  const west: Vec3 = [r[0][1], r[1][1], r[2][1]];
  const zenith: Vec3 = [r[0][2], r[1][2], r[2][2]];
  return [
    [-west[0], -west[1], -west[2]],
    [zenith[0], zenith[1], zenith[2]],
    [-north[0], -north[1], -north[2]],
  ];
}

/** (azimuth, altitude) of an ENU unit vector. */
export function horizontalFromEnu(v: Vec3): HorizontalCoord {
  const [east, up, south] = v;
  const north = -south;
  const horiz = Math.hypot(east, north);
  return {
    azimuth: normalizeDeg(Math.atan2(east, north) * RAD2DEG),
    altitude: Math.atan2(up, horiz) * RAD2DEG,
  };
}

/** ENU unit vector for an (azimuth, altitude) pair. */
export function enuFromHorizontal(azimuth: number, altitude: number): Vec3 {
  const az = azimuth * DEG2RAD;
  const alt = altitude * DEG2RAD;
  const ca = Math.cos(alt);
  // north = cos(alt)cos(az); ENU z is south, hence the sign.
  return [ca * Math.sin(az), Math.sin(alt), -ca * Math.cos(az)];
}

/**
 * Horizontal coordinates of a fixed J2000 position, as seen from `location` at
 * `date`. Geometric (unrefracted) altitude - refraction is a rendering choice,
 * not an astrometric one, and matters only within ~1 degree of the horizon.
 */
export function equatorialToHorizontal(
  coord: EquatorialCoord,
  date: Date,
  location: GeoLocation,
): HorizontalCoord {
  const m = equatorialToEnuMatrix(date, location);
  return horizontalFromEnu(multiplyMatrixVector(m, equatorialToVector(coord.raDeg, coord.decDeg)));
}

/** Local apparent sidereal time in degrees (0..360) at the observer's longitude. */
export function localSiderealTimeDeg(date: Date, longitude: number): number {
  // Astronomy.SiderealTime returns Greenwich apparent sidereal time in hours.
  return normalizeDeg(Astronomy.SiderealTime(date) * 15 + longitude);
}

/** Hour angle in degrees, -180..180 (negative = east of the meridian, rising). */
export function hourAngleDeg(raDeg: number, date: Date, longitude: number): number {
  const h = normalizeDeg(localSiderealTimeDeg(date, longitude) - raDeg);
  return h > 180 ? h - 360 : h;
}

/* --------------------------------------------------------------------------
 * Galactic coordinates (IAU 1958 system, J2000 pole values)
 * -------------------------------------------------------------------------- */

import { NGP_RA_DEG, NGP_DEC_DEG, L_NCP_DEG } from './constants';

export interface GalacticCoord {
  /** Galactic longitude, 0..360. 0 is the direction of the Galactic Centre. */
  l: number;
  /** Galactic latitude, -90..90. 0 is the galactic plane. */
  b: number;
}

export function equatorialToGalactic(raDeg: number, decDeg: number): GalacticCoord {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const a = NGP_RA_DEG * DEG2RAD;
  const d = NGP_DEC_DEG * DEG2RAD;
  const sinb = Math.sin(dec) * Math.sin(d) + Math.cos(dec) * Math.cos(d) * Math.cos(ra - a);
  const b = Math.asin(clamp(sinb, -1, 1));
  const y = Math.cos(dec) * Math.sin(ra - a);
  const x = Math.sin(dec) * Math.cos(d) - Math.cos(dec) * Math.sin(d) * Math.cos(ra - a);
  return { l: normalizeDeg(L_NCP_DEG - Math.atan2(y, x) * RAD2DEG), b: b * RAD2DEG };
}

export function galacticToEquatorial(l: number, b: number): EquatorialCoord {
  const lr = l * DEG2RAD;
  const br = b * DEG2RAD;
  const d = NGP_DEC_DEG * DEG2RAD;
  const lncp = L_NCP_DEG * DEG2RAD;
  const sinDec = Math.sin(br) * Math.sin(d) + Math.cos(br) * Math.cos(d) * Math.cos(lncp - lr);
  const dec = Math.asin(clamp(sinDec, -1, 1));
  const y = Math.cos(br) * Math.sin(lncp - lr);
  const x = Math.sin(br) * Math.cos(d) - Math.cos(br) * Math.sin(d) * Math.cos(lncp - lr);
  return { raDeg: normalizeDeg(Math.atan2(y, x) * RAD2DEG + NGP_RA_DEG), decDeg: dec * RAD2DEG };
}
