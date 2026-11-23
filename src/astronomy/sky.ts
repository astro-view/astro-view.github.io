/**
 * Sun, Moon, twilight and Galactic Centre state for a given instant and place.
 *
 * Everything here is derived from astronomy-engine; nothing is interpolated or
 * faked. Where a quantity is undefined (a Moon that never rises on the day, the
 * Sun that never reaches -18 degrees in polar summer) the field is `null` and
 * the UI says so, rather than substituting a plausible number.
 */
import * as Astronomy from 'astronomy-engine';
import {
  GALACTIC_CENTRE,
  TWILIGHT,
  angularSeparationDeg,
  clamp,
} from './constants';
import {
  type GeoLocation,
  type HorizontalCoord,
  equatorialToEnuMatrix,
  equatorialToVector,
  horizontalFromEnu,
  multiplyMatrixVector,
  observerFor,
} from './coordinates';

export interface MoonState extends HorizontalCoord {
  /** Illuminated fraction of the disc, 0..1. */
  illumination: number;
  /**
   * Phase angle in degrees: 0 = new, 90 = first quarter, 180 = full,
   * 270 = last quarter. This is astronomy-engine's `MoonPhase` (ecliptic
   * elongation from the Sun), not the Sun-Moon-Earth angle.
   */
  phaseDeg: number;
  phaseName: string;
  /** Sun-Moon-Earth angle in degrees (0 = full moon). Used by the glare model. */
  sunMoonEarthAngleDeg: number;
}

export interface SkyState {
  date: Date;
  location: GeoLocation;
  sun: HorizontalCoord;
  moon: MoonState;
  galacticCentre: HorizontalCoord;
  /** True when the Sun is below -18 degrees. */
  astronomicallyDark: boolean;
  /** Sun altitude band label for the UI. */
  twilightPhase: 'day' | 'civil' | 'nautical' | 'astronomical' | 'night';
}

const GC_BODY = Astronomy.Body.Star1;
let gcDefined = false;

/**
 * Register the Galactic Centre as a user-defined "star" so astronomy-engine's
 * rise/set and altitude searches can be used on it. Distance is nominal: the
 * search routines only need a direction, and 26 000 ly removes any parallax.
 */
function ensureGalacticCentreBody(): Astronomy.Body {
  if (!gcDefined) {
    Astronomy.DefineStar(GC_BODY, GALACTIC_CENTRE.raDeg / 15, GALACTIC_CENTRE.decDeg, 26000);
    gcDefined = true;
  }
  return GC_BODY;
}

function moonPhaseName(phaseDeg: number): string {
  const p = ((phaseDeg % 360) + 360) % 360;
  if (p < 11.25 || p >= 348.75) return 'New Moon';
  if (p < 78.75) return 'Waxing Crescent';
  if (p < 101.25) return 'First Quarter';
  if (p < 168.75) return 'Waxing Gibbous';
  if (p < 191.25) return 'Full Moon';
  if (p < 258.75) return 'Waning Gibbous';
  if (p < 281.25) return 'Last Quarter';
  return 'Waning Crescent';
}

function twilightPhase(sunAltitude: number): SkyState['twilightPhase'] {
  if (sunAltitude > TWILIGHT.sunrise) return 'day';
  if (sunAltitude > TWILIGHT.civil) return 'civil';
  if (sunAltitude > TWILIGHT.nautical) return 'nautical';
  if (sunAltitude > TWILIGHT.astronomical) return 'astronomical';
  return 'night';
}

/**
 * Horizontal position of a solar-system body, GEOMETRIC (no refraction).
 *
 * Refraction is deliberately switched off everywhere in AstroView, for three
 * reasons that all point the same way:
 *  - the matrix path that positions the stars and the Galactic Centre is
 *    geometric, so refracting the Sun and Moon would make them inconsistent
 *    with everything else on screen;
 *  - the twilight definitions (-6 / -12 / -18 degrees) and astronomy-engine's
 *    own `SearchAltitude` are stated for the geometric centre of the Sun;
 *  - astronomy-engine's 'normal' refraction does not fall to zero below the
 *    horizon. It clamps the formula at -1 degree and tapers linearly to the
 *    nadir, which adds a non-physical +0.52 degrees at an altitude of -18.
 *
 * Refraction only matters within about half a degree of the horizon, and
 * `SearchRiseSet` applies its own atmosphere model for rise and set times.
 */
export function bodyHorizontal(
  body: Astronomy.Body,
  date: Date,
  location: GeoLocation,
): HorizontalCoord {
  const observer = observerFor(location);
  const eq = Astronomy.Equator(body, date, observer, true, true);
  const h = Astronomy.Horizon(date, observer, eq.ra, eq.dec);
  return { azimuth: h.azimuth, altitude: h.altitude };
}

/** Altitude/azimuth of the Galactic Centre at an instant. */
export function galacticCentreHorizontal(date: Date, location: GeoLocation): HorizontalCoord {
  const m = equatorialToEnuMatrix(date, location);
  const v = equatorialToVector(GALACTIC_CENTRE.raDeg, GALACTIC_CENTRE.decDeg);
  return horizontalFromEnu(multiplyMatrixVector(m, v));
}

export function computeSkyState(date: Date, location: GeoLocation): SkyState {
  const observer = observerFor(location);

  const sunEq = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);
  const sunH = Astronomy.Horizon(date, observer, sunEq.ra, sunEq.dec);

  const moonEq = Astronomy.Equator(Astronomy.Body.Moon, date, observer, true, true);
  const moonH = Astronomy.Horizon(date, observer, moonEq.ra, moonEq.dec);
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
  const phaseDeg = Astronomy.MoonPhase(date);

  return {
    date,
    location,
    sun: { azimuth: sunH.azimuth, altitude: sunH.altitude },
    moon: {
      azimuth: moonH.azimuth,
      altitude: moonH.altitude,
      illumination: illum.phase_fraction,
      phaseDeg,
      phaseName: moonPhaseName(phaseDeg),
      sunMoonEarthAngleDeg: illum.phase_angle,
    },
    galacticCentre: galacticCentreHorizontal(date, location),
    astronomicallyDark: sunH.altitude < TWILIGHT.astronomical,
    twilightPhase: twilightPhase(sunH.altitude),
  };
}

/* --------------------------------------------------------------------------
 * Rise / set / twilight events
 * -------------------------------------------------------------------------- */

export interface EventTimes {
  sunset: Date | null;
  sunrise: Date | null;
  duskAstronomical: Date | null;
  dawnAstronomical: Date | null;
  moonrise: Date | null;
  moonset: Date | null;
  /** True when the Sun never gets below -18 degrees in the search window. */
  noAstronomicalDarkness: boolean;
  /** True when the Sun stays below -18 degrees for the whole window. */
  darkAllNight: boolean;
}

function search(
  body: Astronomy.Body,
  observer: Astronomy.Observer,
  direction: number,
  start: Date,
  limitDays: number,
): Date | null {
  const t = Astronomy.SearchRiseSet(body, observer, direction, start, limitDays);
  return t ? t.date : null;
}

function searchAltitude(
  body: Astronomy.Body,
  observer: Astronomy.Observer,
  direction: number,
  start: Date,
  limitDays: number,
  altitude: number,
): Date | null {
  const t = Astronomy.SearchAltitude(body, observer, direction, start, limitDays, altitude);
  return t ? t.date : null;
}

/**
 * Events for the night that begins on the civil day of `windowStart`.
 * `windowStart` should be local noon so that a whole night is inside the window.
 */
export function computeEvents(
  windowStart: Date,
  location: GeoLocation,
  windowHours = 24,
): EventTimes {
  const observer = observerFor(location);
  const days = windowHours / 24;

  const sunset = search(Astronomy.Body.Sun, observer, -1, windowStart, days);
  const sunrise = search(Astronomy.Body.Sun, observer, +1, windowStart, days);
  const duskAstronomical = searchAltitude(
    Astronomy.Body.Sun,
    observer,
    -1,
    windowStart,
    days,
    TWILIGHT.astronomical,
  );
  const dawnAstronomical = searchAltitude(
    Astronomy.Body.Sun,
    observer,
    +1,
    windowStart,
    days,
    TWILIGHT.astronomical,
  );

  const midWindow = new Date(windowStart.getTime() + (windowHours / 2) * 3600000);
  const sunAtMid = bodyHorizontal(Astronomy.Body.Sun, midWindow, location).altitude;

  return {
    sunset,
    sunrise,
    duskAstronomical,
    dawnAstronomical,
    moonrise: search(Astronomy.Body.Moon, observer, +1, windowStart, days),
    moonset: search(Astronomy.Body.Moon, observer, -1, windowStart, days),
    noAstronomicalDarkness:
      duskAstronomical === null && dawnAstronomical === null && sunAtMid > TWILIGHT.astronomical,
    darkAllNight:
      duskAstronomical === null && dawnAstronomical === null && sunAtMid < TWILIGHT.astronomical,
  };
}

/** Next rise and set of the Galactic Centre, or null where it is circumpolar. */
export function galacticCentreRiseSet(
  windowStart: Date,
  location: GeoLocation,
  windowHours = 24,
): { rise: Date | null; set: Date | null } {
  const body = ensureGalacticCentreBody();
  const observer = observerFor(location);
  const days = windowHours / 24;
  return {
    rise: search(body, observer, +1, windowStart, days),
    set: search(body, observer, -1, windowStart, days),
  };
}

/* --------------------------------------------------------------------------
 * Sampled curves for the timeline
 * -------------------------------------------------------------------------- */

export interface TimelineSample {
  date: Date;
  sunAltitude: number;
  moonAltitude: number;
  moonAzimuth: number;
  moonIllumination: number;
  /** Sun-Moon-Earth phase angle in degrees (0 = full moon). */
  moonPhaseAngle: number;
  galacticCentreAltitude: number;
  galacticCentreAzimuth: number;
}

/**
 * Sample the night at a fixed cadence. One matrix per sample is reused for the
 * Galactic Centre; Sun and Moon go through astronomy-engine directly because
 * their positions change within the frame.
 */
export function sampleTimeline(
  start: Date,
  end: Date,
  location: GeoLocation,
  stepMinutes = 5,
): TimelineSample[] {
  const observer = observerFor(location);
  const out: TimelineSample[] = [];
  const stepMs = stepMinutes * 60000;
  const gcVector = equatorialToVector(GALACTIC_CENTRE.raDeg, GALACTIC_CENTRE.decDeg);

  for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
    const date = new Date(t);
    const sunEq = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);
    const sunH = Astronomy.Horizon(date, observer, sunEq.ra, sunEq.dec);
    const moonEq = Astronomy.Equator(Astronomy.Body.Moon, date, observer, true, true);
    const moonH = Astronomy.Horizon(date, observer, moonEq.ra, moonEq.dec);
    const gcH = horizontalFromEnu(
      multiplyMatrixVector(equatorialToEnuMatrix(date, location), gcVector),
    );
    const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
    out.push({
      date,
      sunAltitude: sunH.altitude,
      moonAltitude: moonH.altitude,
      moonAzimuth: moonH.azimuth,
      moonIllumination: illum.phase_fraction,
      moonPhaseAngle: illum.phase_angle,
      galacticCentreAltitude: gcH.altitude,
      galacticCentreAzimuth: gcH.azimuth,
    });
  }
  return out;
}

/**
 * Angular distance from the Moon to the Galactic Centre - how badly moonlight
 * will wash out a shot aimed at the core.
 */
export function moonToGalacticCentreSeparation(state: SkyState): number {
  return angularSeparationDeg(
    state.moon.azimuth,
    state.moon.altitude,
    state.galacticCentre.azimuth,
    state.galacticCentre.altitude,
  );
}

/**
 * Fraction of the Milky Way band that is above the horizon, sampled along the
 * galactic equator. The Galactic Centre can be below the horizon while a good
 * part of the band is still up, so this is reported separately from the
 * Galactic Centre altitude.
 */
export function milkyWayBandVisibility(
  date: Date,
  location: GeoLocation,
): { fractionAboveHorizon: number; highestAltitude: number; highestLongitude: number } {
  const m = equatorialToEnuMatrix(date, location);
  let above = 0;
  let n = 0;
  let highestAltitude = -90;
  let highestLongitude = 0;
  for (let l = 0; l < 360; l += 2) {
    const eq = galacticEquatorPoint(l);
    const h = horizontalFromEnu(multiplyMatrixVector(m, equatorialToVector(eq.raDeg, eq.decDeg)));
    if (h.altitude > 0) above++;
    if (h.altitude > highestAltitude) {
      highestAltitude = h.altitude;
      highestLongitude = l;
    }
    n++;
  }
  return { fractionAboveHorizon: above / n, highestAltitude, highestLongitude };
}

import { galacticToEquatorial } from './coordinates';

const galacticEquatorCache = new Map<number, { raDeg: number; decDeg: number }>();
function galacticEquatorPoint(l: number) {
  let p = galacticEquatorCache.get(l);
  if (!p) {
    p = galacticToEquatorial(l, 0);
    galacticEquatorCache.set(l, p);
  }
  return p;
}

/** Airmass at a given altitude (Pickering 2002); Infinity below the horizon. */
export function airmass(altitudeDeg: number): number {
  if (altitudeDeg <= 0) return Infinity;
  const h = clamp(altitudeDeg, 0.1, 90);
  return 1 / Math.sin((h + 244 / (165 + 47 * Math.pow(h, 1.1))) * (Math.PI / 180));
}
