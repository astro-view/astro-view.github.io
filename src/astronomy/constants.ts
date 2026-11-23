/**
 * Astronomical constants and conventions used throughout AstroView.
 *
 * CONVENTIONS (applied everywhere; do not mix):
 *  - Angles are in DEGREES in every public API. Radians appear only inside a
 *    function body, never in a parameter, return value or stored field.
 *  - Azimuth is measured from NORTH = 0 degrees, increasing EASTWARD
 *    (E = 90, S = 180, W = 270). This is the convention used by
 *    astronomy-engine's `Horizon()` and by every rise/set table.
 *  - Altitude (elevation) is degrees above the geometric horizon; negative
 *    below. "Altitude" and "elevation" mean the same thing here.
 *  - Right ascension is in DEGREES (0..360), not hours, in every internal API.
 *    The HYG catalogue's hours are converted once, at build time.
 *  - All instants are JavaScript `Date` objects, i.e. UTC internally. Local
 *    civil time exists only at the UI boundary (see `time.ts`).
 */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/**
 * Sagittarius A*, the dynamical centre of the Galaxy, in ICRS/J2000.
 * Reid & Brunthaler (2004); the position is conventionally quoted as
 * RA 17h45m40.04s, Dec -29deg00'28.1".
 */
export const GALACTIC_CENTRE = {
  raDeg: 266.41683,
  decDeg: -29.00781,
  name: 'Galactic Centre (Sgr A*)',
} as const;

/** North galactic pole and the galactic longitude of the north celestial pole (J2000). */
export const NGP_RA_DEG = 192.85948;
export const NGP_DEC_DEG = 27.12825;
export const L_NCP_DEG = 122.93192;

/** Sun altitude thresholds that bound the twilight phases, in degrees. */
export const TWILIGHT = {
  /** Upper limb at the horizon; refraction-corrected value used by rise/set searches. */
  sunrise: -0.833,
  civil: -6,
  nautical: -12,
  /** Below this the sky is "astronomically dark" - the usable window for deep-sky work. */
  astronomical: -18,
} as const;

/**
 * Zenith sky brightness of a pristine natural night sky, in mag/arcsec^2 (V band).
 * The natural background (airglow, zodiacal light, unresolved stars) sets a floor
 * around 22.0; darker readings are usually measurement artefacts.
 */
export const NATURAL_SKY_SQM = 22.0;

/** V-band atmospheric extinction coefficient, mag/airmass, typical clear site. */
export const EXTINCTION_K = 0.172;

/** Degrees of sky the renderer draws below the horizon (foreground/ground band). */
export const HORIZON_MARGIN_DEG = 20;

export const CARDINALS: ReadonlyArray<{ label: string; azimuth: number; major: boolean }> = [
  { label: 'N', azimuth: 0, major: true },
  { label: 'NE', azimuth: 45, major: false },
  { label: 'E', azimuth: 90, major: true },
  { label: 'SE', azimuth: 135, major: false },
  { label: 'S', azimuth: 180, major: true },
  { label: 'SW', azimuth: 225, major: false },
  { label: 'W', azimuth: 270, major: true },
  { label: 'NW', azimuth: 315, major: false },
];

/** Normalise an angle to [0, 360). */
export function normalizeDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Normalise an angle to (-180, 180]. */
export function signedDeg(deg: number): number {
  const d = normalizeDeg(deg);
  return d > 180 ? d - 360 : d;
}

/** Clamp a number to a range. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Great-circle angular separation between two (azimuth, altitude) or
 * (RA, Dec) pairs, in degrees. The formula is frame-agnostic: both arguments
 * must be in the same frame.
 */
export function angularSeparationDeg(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const p1 = lat1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const dl = (lon2 - lon1) * DEG2RAD;
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.acos(clamp(c, -1, 1)) * RAD2DEG;
}
