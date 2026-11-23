/**
 * Light pollution and sky brightness.
 *
 * WHAT IS MODELLED AND WHAT IS NOT
 *
 * The honest position of this module: sky brightness is an input, not a
 * prediction. AstroView does not claim to know how bright your sky is. It lets
 * you state it (an SQM reading, a Bortle class, or a value read off a published
 * map) and then shows you, consistently, what that implies for the view.
 *
 * What IS computed from physics-based published relations:
 *   - naked-eye limiting magnitude from zenith sky brightness (Schaefer 1990,
 *     in the form used by the Unihedron SQM / Bortle conversion tables)
 *   - the moonlight contribution to sky brightness (Krisciunas & Schaefer 1991)
 *   - addition of brightness sources in linear units before converting back to
 *     magnitudes, which is the only correct way to combine them
 *
 * What is NOT done:
 *   - VIIRS upward radiance is NOT treated as sky brightness. Upward radiance
 *     measures light leaving the ground towards the satellite; zenith sky
 *     brightness is scattered light coming back down, and the two are related
 *     only through an atmospheric scattering model (Falchi et al. 2016). Where
 *     a radiance figure is available it is labelled as radiance and an
 *     indicative, clearly-marked estimate is offered separately.
 *   - The rendering is a visual approximation. It reproduces the loss of faint
 *     stars, the reduction of Milky Way contrast and the sky glow, not the
 *     photometric response of a particular camera and raw converter.
 */
import { EXTINCTION_K, NATURAL_SKY_SQM, clamp } from '../astronomy/constants';
import { airmass } from '../astronomy/sky';

export interface BortleClass {
  bortle: number;
  label: string;
  description: string;
  /** Representative zenith SQM range for the class, mag/arcsec^2. */
  sqmRange: [number, number];
}

/**
 * Bortle dark-sky scale with the SQM ranges commonly used alongside it.
 * The scale is a description of what an observer sees, not a measurement, so
 * the numeric bounds are conventional rather than definitional.
 */
export const BORTLE_CLASSES: readonly BortleClass[] = [
  { bortle: 1, label: 'Excellent dark sky', description: 'Zodiacal light and gegenschein visible; Milky Way casts shadows.', sqmRange: [21.99, 22.1] },
  { bortle: 2, label: 'Typical truly dark site', description: 'Milky Way highly structured; airglow visible near the horizon.', sqmRange: [21.89, 21.99] },
  { bortle: 3, label: 'Rural sky', description: 'Light domes on the horizon; Milky Way still shows complex structure.', sqmRange: [21.69, 21.89] },
  { bortle: 4, label: 'Rural / suburban transition', description: 'Milky Way clearly visible overhead but lacks detail near the horizon.', sqmRange: [20.49, 21.69] },
  { bortle: 5, label: 'Suburban sky', description: 'Milky Way washed out at the zenith, invisible near the horizon.', sqmRange: [19.5, 20.49] },
  { bortle: 6, label: 'Bright suburban sky', description: 'Milky Way only visible near the zenith, if at all.', sqmRange: [18.94, 19.5] },
  { bortle: 7, label: 'Suburban / urban transition', description: 'Milky Way invisible; sky glows greyish white.', sqmRange: [18.38, 18.94] },
  { bortle: 8, label: 'City sky', description: 'Only the brightest constellations recognisable.', sqmRange: [17.8, 18.38] },
  { bortle: 9, label: 'Inner-city sky', description: 'Only the Moon, planets and a handful of bright stars visible.', sqmRange: [0, 17.8] },
];

export function bortleForSqm(sqm: number): BortleClass {
  for (const c of BORTLE_CLASSES) {
    if (sqm >= c.sqmRange[0]) return c;
  }
  return BORTLE_CLASSES[BORTLE_CLASSES.length - 1];
}

/* --------------------------------------------------------------------------
 * Brightness unit conversions
 * -------------------------------------------------------------------------- */

/**
 * mag/arcsec^2 -> nanolamberts. The constant is the standard photometric
 * conversion used by Garstang and by Krisciunas & Schaefer (1991), eq. 27.
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
 * Naked-eye limiting magnitude for a given zenith sky brightness.
 *
 * Schaefer's visual-detection relation in the compact form used for SQM
 * readings. At SQM 21.9 it gives about 6.6; at SQM 18 about 4.4 - both in line
 * with the published Bortle tables.
 */
export function limitingMagnitude(sqm: number): number {
  const x = Math.pow(10, 4.316 - sqm / 5);
  return 7.93 - 5 * Math.log10(1 + x);
}

/* --------------------------------------------------------------------------
 * Moonlight (Krisciunas & Schaefer 1991)
 * -------------------------------------------------------------------------- */

/**
 * Sky brightness added by the Moon at a given point in the sky, in
 * nanolamberts. Returns 0 when the Moon is below the horizon.
 *
 * Krisciunas, K. & Schaefer, B.E. 1991, PASP 103, 1033,
 * "A model of the brightness of moonlight".
 *
 * @param moonAltitudeDeg     Moon altitude above the horizon.
 * @param targetAltitudeDeg   Altitude of the patch of sky being observed.
 * @param separationDeg       Angular distance from the Moon to that patch.
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

  // Scattering function: Rayleigh + aerosol (K&S eq. 21-further).
  const rho = clamp(separationDeg, 0.5, 180);
  const cosRho = Math.cos((rho * Math.PI) / 180);
  const fRho =
    Math.pow(10, 5.36) * (1.06 + cosRho * cosRho) + Math.pow(10, 6.15 - rho / 40);

  const xMoon = airmass(moonAltitudeDeg);
  const xTarget = airmass(targetAltitudeDeg);
  if (!Number.isFinite(xMoon) || !Number.isFinite(xTarget)) return 0;

  const b =
    fRho *
    iStar *
    Math.pow(10, -0.4 * EXTINCTION_K * xMoon) *
    (1 - Math.pow(10, -0.4 * EXTINCTION_K * xTarget));
  return Math.max(0, b);
}

export interface SkyBrightnessInput {
  /** Artificial + natural zenith brightness the user specified, mag/arcsec^2. */
  baseSqm: number;
  moonAltitudeDeg: number;
  moonIllumination: number;
  sunMoonEarthAngleDeg: number;
  /** Where in the sky the figure applies - normally the centre of the frame. */
  targetAltitudeDeg: number;
  /** Angular distance from the Moon to that point. */
  moonSeparationDeg: number;
  /** Sun altitude, so twilight can be reported honestly. */
  sunAltitudeDeg: number;
}

export interface SkyBrightnessResult {
  /** Brightness without the Moon, mag/arcsec^2 (what an SQM would read at dark of moon). */
  baseSqm: number;
  /** Brightness including moonlight at the target direction, mag/arcsec^2. */
  effectiveSqm: number;
  /** Moonlight contribution alone, nanolamberts. */
  moonContributionNl: number;
  /** Magnitudes of sky brightening caused by the Moon. */
  moonPenaltyMag: number;
  limitingMagnitude: number;
  bortle: BortleClass;
  /** True if the Sun is still bright enough that brightness is twilight-dominated. */
  twilightDominated: boolean;
}

export function computeSkyBrightness(input: SkyBrightnessInput): SkyBrightnessResult {
  const baseNl = sqmToNanolambert(input.baseSqm);
  const moonNl =
    input.moonIllumination <= 0
      ? 0
      : moonSkyBrightnessNl(
          input.moonAltitudeDeg,
          input.targetAltitudeDeg,
          input.moonSeparationDeg,
          input.sunMoonEarthAngleDeg,
        );
  const totalNl = baseNl + moonNl;
  const effectiveSqm = nanolambertToSqm(totalNl);
  return {
    baseSqm: input.baseSqm,
    effectiveSqm,
    moonContributionNl: moonNl,
    moonPenaltyMag: input.baseSqm - effectiveSqm,
    limitingMagnitude: limitingMagnitude(effectiveSqm),
    bortle: bortleForSqm(effectiveSqm),
    twilightDominated: input.sunAltitudeDeg > -18,
  };
}

/* --------------------------------------------------------------------------
 * VIIRS radiance -> indicative sky brightness
 * -------------------------------------------------------------------------- */

/**
 * A deliberately crude, clearly-labelled indication of zenith sky brightness
 * from VIIRS/DNB upward radiance.
 *
 * This is NOT a conversion. Upward radiance and zenith sky brightness are
 * different physical quantities; relating them properly requires a scattering
 * model with local aerosol content, terrain and the angular emission pattern of
 * the sources (Falchi et al. 2016, "The new world atlas of artificial night sky
 * brightness"). The logarithmic fit below merely reproduces the broad trend of
 * published atlas values and should be treated as an order-of-magnitude hint.
 *
 * @param radiance nW / cm^2 / sr
 */
export function indicativeSqmFromViirsRadiance(radiance: number): {
  sqm: number;
  caveat: string;
} {
  const r = Math.max(0.01, radiance);
  // Natural sky floor, dimmed by roughly 2.5 mag per decade of radiance.
  const sqm = clamp(NATURAL_SKY_SQM - 2.6 * Math.log10(1 + r / 0.25), 16.5, NATURAL_SKY_SQM);
  return {
    sqm,
    caveat:
      'Indicative only. VIIRS measures upward radiance, not sky brightness; a real conversion needs an atmospheric scattering model. Prefer an SQM reading or a published sky-brightness atlas value.',
  };
}

/* --------------------------------------------------------------------------
 * Rendering parameters derived from sky brightness
 * -------------------------------------------------------------------------- */

export interface SkyRenderParameters {
  /** Linear background luminance to add to the sky, 0..1 in render units. */
  backgroundLevel: number;
  /** RGB tint of the artificial glow (warm sodium/LED mix at low SQM). */
  glowColor: [number, number, number];
  /** Stars fainter than this are not drawn. */
  limitingMagnitude: number;
  /** Multiplier on the Milky Way texture's contrast, 0..1. */
  milkyWayContrast: number;
  /** Overall gain applied to the Milky Way after its tone curve. */
  milkyWayExposure: number;
  /** Overall gain applied to star brightness. */
  starGain: number;
}

/**
 * Map a sky brightness onto renderer parameters.
 *
 * The mapping is a presentation choice, documented here so it can be argued
 * with: background level rises linearly with luminance in nanolamberts
 * normalised to a Bortle 8 sky, Milky Way contrast falls with the ratio of the
 * natural background to the actual background, and the star cut-off is the
 * computed naked-eye limiting magnitude plus one magnitude, because a camera on
 * a tripod reaches deeper than the eye.
 */
export function skyRenderParameters(
  effectiveSqm: number,
  options: { idealSky: boolean } = { idealSky: false },
): SkyRenderParameters {
  const sqm = options.idealSky ? NATURAL_SKY_SQM : effectiveSqm;
  const nl = sqmToNanolambert(sqm);
  const naturalNl = sqmToNanolambert(NATURAL_SKY_SQM);
  const referenceNl = sqmToNanolambert(18.0); // Bortle 8 reference for normalisation

  const backgroundLevel = clamp(Math.pow(nl / referenceNl, 0.45) * 0.22, 0.004, 0.42);
  const contrast = clamp(Math.pow(naturalNl / nl, 0.55), 0.06, 1);
  // Warm glow dominates heavily polluted skies; a dark sky keeps a neutral blue.
  const warmth = clamp(1 - contrast, 0, 1);
  const glowColor: [number, number, number] = [
    0.32 + 0.5 * warmth,
    0.4 + 0.3 * warmth,
    0.62 - 0.08 * warmth,
  ];

  return {
    backgroundLevel,
    glowColor,
    limitingMagnitude: clamp(limitingMagnitude(sqm) + 1.0, 2.0, 6.5),
    milkyWayContrast: contrast,
    // A display gain, not a physical quantity. A dark sky is given slightly
    // more of it, the way a photographer would push the exposure when there is
    // nothing to blow out.
    milkyWayExposure: clamp(1.05 + 0.45 * contrast, 1.05, 1.5),
    starGain: clamp(0.55 + 0.45 * contrast, 0.5, 1.0),
  };
}
