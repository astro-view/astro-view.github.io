/**
 * Sky brightness, from the natural night sky plus moonlight.
 *
 * Artificial light pollution is deliberately out of scope: the sky is treated
 * as a pristine natural one, and the only thing that brightens it here is the
 * Moon. That keeps every number on screen something this app can actually
 * derive, rather than something the user would have to supply.
 *
 * Computed from published relations, not invented:
 *   - moonlight: Krisciunas, K. & Schaefer, B. E. 1991, PASP 103, 1033
 *   - limiting magnitude from sky brightness: Schaefer's visual-detection
 *     relation, in the form used alongside Unihedron SQM readings
 *   - brightnesses are added in LINEAR units before converting back to
 *     magnitudes, which is the only correct way to combine them
 *
 * The mapping from brightness onto renderer parameters is a presentation
 * choice, documented at `skyRenderParameters`.
 */
import { EXTINCTION_K, NATURAL_SKY_SQM, clamp } from '../astronomy/constants';
import { airmass } from '../astronomy/sky';

/**
 * mag/arcsec^2 -> nanolamberts. The standard photometric conversion used by
 * Garstang and by Krisciunas & Schaefer (1991), eq. 27.
 */
export function sqmToNanolambert(sqm: number): number {
  return 34.08 * Math.exp(20.7233 - 0.92104 * sqm);
}

/** nanolamberts -> mag/arcsec^2. Inverse of {@link sqmToNanolambert}. */
export function nanolambertToSqm(nl: number): number {
  if (nl <= 0) return 30;
  return (20.7233 - Math.log(nl / 34.08)) / 0.92104;
}

/**
 * Naked-eye limiting magnitude for a given sky brightness.
 *
 * Schaefer's relation in the compact form used for SQM readings. More
 * conservative than the figures Bortle quotes: the formula describes a typical
 * observer, Bortle described exceptional ones.
 */
export function limitingMagnitude(sqm: number): number {
  return 7.93 - 5 * Math.log10(1 + Math.pow(10, 4.316 - sqm / 5));
}

/**
 * Sky brightness added by the Moon at a point in the sky, in nanolamberts.
 * Zero when the Moon or the target is below the horizon.
 *
 * Krisciunas & Schaefer (1991), "A model of the brightness of moonlight".
 *
 * @param moonAltitudeDeg      Moon altitude above the horizon.
 * @param targetAltitudeDeg    Altitude of the patch of sky being observed.
 * @param separationDeg        Angular distance from the Moon to that patch.
 * @param sunMoonEarthAngleDeg Phase angle (0 = full moon, 180 = new moon).
 */
export function moonSkyBrightnessNl(
  moonAltitudeDeg: number,
  targetAltitudeDeg: number,
  separationDeg: number,
  sunMoonEarthAngleDeg: number,
): number {
  if (moonAltitudeDeg <= 0 || targetAltitudeDeg <= 0) return 0;

  const alpha = clamp(Math.abs(sunMoonEarthAngleDeg), 0, 180);
  // Illuminance of the Moon outside the atmosphere (K&S eq. 20).
  const iStar = Math.pow(10, -0.4 * (3.84 + 0.026 * alpha + 4e-9 * Math.pow(alpha, 4)));

  // Scattering function: Rayleigh plus aerosol.
  const rho = clamp(separationDeg, 0.5, 180);
  const cosRho = Math.cos((rho * Math.PI) / 180);
  const fRho = Math.pow(10, 5.36) * (1.06 + cosRho * cosRho) + Math.pow(10, 6.15 - rho / 40);

  const xMoon = airmass(moonAltitudeDeg);
  const xTarget = airmass(targetAltitudeDeg);
  if (!Number.isFinite(xMoon) || !Number.isFinite(xTarget)) return 0;

  return Math.max(
    0,
    fRho *
      iStar *
      Math.pow(10, -0.4 * EXTINCTION_K * xMoon) *
      (1 - Math.pow(10, -0.4 * EXTINCTION_K * xTarget)),
  );
}

export interface SkyBrightnessInput {
  moonAltitudeDeg: number;
  moonIllumination: number;
  sunMoonEarthAngleDeg: number;
  /** Where in the sky the figure applies - normally the centre of the frame. */
  targetAltitudeDeg: number;
  /** Angular distance from the Moon to that point. */
  moonSeparationDeg: number;
  /** Sun altitude, so twilight can be reported honestly. */
  sunAltitudeDeg: number;
  /** Set false to ignore the Moon entirely, for a moonless comparison. */
  includeMoon?: boolean;
}

export interface SkyBrightnessResult {
  /** The natural moonless sky, mag/arcsec^2. */
  naturalSqm: number;
  /** Brightness including moonlight at the target direction, mag/arcsec^2. */
  effectiveSqm: number;
  /** Magnitudes of sky brightening caused by the Moon. */
  moonPenaltyMag: number;
  limitingMagnitude: number;
  /** True while the Sun still dominates the background. */
  twilightDominated: boolean;
}

export function computeSkyBrightness(input: SkyBrightnessInput): SkyBrightnessResult {
  const naturalNl = sqmToNanolambert(NATURAL_SKY_SQM);
  const moonNl =
    input.includeMoon === false || input.moonIllumination <= 0
      ? 0
      : moonSkyBrightnessNl(
          input.moonAltitudeDeg,
          input.targetAltitudeDeg,
          input.moonSeparationDeg,
          input.sunMoonEarthAngleDeg,
        );
  const effectiveSqm = nanolambertToSqm(naturalNl + moonNl);
  return {
    naturalSqm: NATURAL_SKY_SQM,
    effectiveSqm,
    moonPenaltyMag: NATURAL_SKY_SQM - effectiveSqm,
    limitingMagnitude: limitingMagnitude(effectiveSqm),
    twilightDominated: input.sunAltitudeDeg > -18,
  };
}

export interface SkyRenderParameters {
  /** Linear background luminance added to the sky, in render units. */
  backgroundLevel: number;
  /** RGB tint of the moonlit sky glow. */
  glowColor: [number, number, number];
  /** Stars fainter than this are not drawn. */
  limitingMagnitude: number;
  /** Multiplier on the Milky Way's contrast, 0..1. */
  milkyWayContrast: number;
  /** Gain on the Milky Way after its tone curve. */
  milkyWayExposure: number;
  /** Gain on star brightness. */
  starGain: number;
}

/**
 * Map a sky brightness onto renderer parameters.
 *
 * A presentation choice, stated here so it can be argued with: the background
 * rises with luminance relative to the natural sky, Milky Way contrast falls
 * with the same ratio, and the star cut-off is the computed naked-eye limiting
 * magnitude plus one, because a camera on a tripod reaches deeper than the eye.
 * Moonlit sky glow is tinted cool, the way a long exposure records it.
 */
export function skyRenderParameters(effectiveSqm: number): SkyRenderParameters {
  const nl = sqmToNanolambert(effectiveSqm);
  const naturalNl = sqmToNanolambert(NATURAL_SKY_SQM);
  const excess = Math.max(1, nl / naturalNl);

  const backgroundLevel = clamp(0.004 + 0.1 * Math.pow(excess - 1, 0.45), 0.004, 0.42);
  const contrast = clamp(Math.pow(1 / excess, 0.55), 0.06, 1);

  return {
    backgroundLevel,
    glowColor: [0.34, 0.45, 0.68],
    limitingMagnitude: clamp(limitingMagnitude(effectiveSqm) + 1.0, 2.0, 6.5),
    milkyWayContrast: contrast,
    milkyWayExposure: clamp(1.05 + 0.45 * contrast, 1.05, 1.5),
    starGain: clamp(0.55 + 0.45 * contrast, 0.5, 1.0),
  };
}
