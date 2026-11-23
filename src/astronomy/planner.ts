/**
 * Observation planner: find the intervals of a night that are actually worth
 * shooting the Milky Way in.
 *
 * An interval qualifies when, simultaneously:
 *   1. the Sun is below the astronomical twilight limit (-18 deg by default),
 *   2. the Galactic Centre is above a user-chosen minimum altitude,
 *   3. moonlight is acceptable - either the Moon is below the horizon, or its
 *      contribution to sky brightness stays under a chosen number of magnitudes.
 *
 * The algorithm is a straight time sweep with linear interpolation of the
 * boundaries: simple, predictable, and accurate to well under the sampling
 * step. No weather input of any kind is involved.
 */
import type { GeoLocation } from './coordinates';
import { type TimelineSample, sampleTimeline } from './sky';
import { angularSeparationDeg } from './constants';
import { moonSkyBrightnessNl, nanolambertToSqm, sqmToNanolambert } from '../sky-brightness/model';
import { NATURAL_SKY_SQM } from './constants';

export interface PlannerCriteria {
  /** Sun must be below this altitude, degrees. */
  maxSunAltitude: number;
  /** Galactic Centre must be above this altitude, degrees. */
  minGalacticCentreAltitude: number;
  /** Maximum acceptable sky brightening from the Moon, magnitudes. */
  maxMoonPenaltyMag: number;
}

export const DEFAULT_CRITERIA: PlannerCriteria = {
  maxSunAltitude: -18,
  minGalacticCentreAltitude: 10,
  maxMoonPenaltyMag: 0.5,
};

export interface PlannerWindow {
  start: Date;
  end: Date;
  durationMinutes: number;
  /** Highest Galactic Centre altitude reached inside the window. */
  peakGalacticCentreAltitude: number;
  /** Time of that peak. */
  peakAt: Date;
  /** Worst (largest) moon penalty inside the window, magnitudes. */
  worstMoonPenaltyMag: number;
  /** Mean effective sky brightness across the window, mag/arcsec^2. */
  meanEffectiveSqm: number;
}

export interface PlannerResult {
  windows: PlannerWindow[];
  samples: TimelineSample[];
  /** Per-sample flags, aligned with `samples`. */
  qualifies: boolean[];
  /** Why no window was found, when there is none. */
  diagnosis: string | null;
}

interface Evaluated {
  sample: TimelineSample;
  sunOk: boolean;
  gcOk: boolean;
  moonOk: boolean;
  moonPenaltyMag: number;
  effectiveSqm: number;
}

function evaluate(sample: TimelineSample, criteria: PlannerCriteria): Evaluated {
  // Moonlight is judged where it matters: at the Galactic Centre itself.
  const moonGcSeparation = angularSeparationDeg(
    sample.moonAzimuth,
    sample.moonAltitude,
    sample.galacticCentreAzimuth,
    sample.galacticCentreAltitude,
  );

  const baseNl = sqmToNanolambert(NATURAL_SKY_SQM);
  const moonNl =
    sample.moonAltitude > 0 && sample.moonIllumination > 0 && sample.galacticCentreAltitude > 0
      ? moonSkyBrightnessNl(
          sample.moonAltitude,
          sample.galacticCentreAltitude,
          moonGcSeparation,
          sample.moonPhaseAngle,
        )
      : 0;
  const effectiveSqm = nanolambertToSqm(baseNl + moonNl);
  const moonPenaltyMag = NATURAL_SKY_SQM - effectiveSqm;

  return {
    sample,
    sunOk: sample.sunAltitude <= criteria.maxSunAltitude,
    gcOk: sample.galacticCentreAltitude >= criteria.minGalacticCentreAltitude,
    moonOk: moonPenaltyMag <= criteria.maxMoonPenaltyMag,
    moonPenaltyMag,
    effectiveSqm,
  };
}

export function findObservationWindows(
  start: Date,
  end: Date,
  location: GeoLocation,
  criteria: PlannerCriteria = DEFAULT_CRITERIA,
  stepMinutes = 5,
): PlannerResult {
  const samples = sampleTimeline(start, end, location, stepMinutes);
  const evaluated = samples.map((s) => evaluate(s, criteria));
  const qualifies = evaluated.map((e) => e.sunOk && e.gcOk && e.moonOk);

  const windows: PlannerWindow[] = [];
  let runStart = -1;
  for (let i = 0; i <= qualifies.length; i++) {
    const ok = i < qualifies.length && qualifies[i];
    if (ok && runStart === -1) runStart = i;
    if (!ok && runStart !== -1) {
      const slice = evaluated.slice(runStart, i);
      const first = slice[0].sample.date;
      const last = slice[slice.length - 1].sample.date;
      let peak = slice[0];
      for (const e of slice) {
        if (e.sample.galacticCentreAltitude > peak.sample.galacticCentreAltitude) peak = e;
      }
      windows.push({
        start: first,
        end: last,
        durationMinutes: Math.round((last.getTime() - first.getTime()) / 60000),
        peakGalacticCentreAltitude: peak.sample.galacticCentreAltitude,
        peakAt: peak.sample.date,
        worstMoonPenaltyMag: Math.max(...slice.map((e) => e.moonPenaltyMag)),
        meanEffectiveSqm:
          slice.reduce((a, e) => a + e.effectiveSqm, 0) / Math.max(1, slice.length),
      });
      runStart = -1;
    }
  }

  let diagnosis: string | null = null;
  if (windows.length === 0) {
    const anyDark = evaluated.some((e) => e.sunOk);
    const anyGc = evaluated.some((e) => e.gcOk);
    const anyDarkAndGc = evaluated.some((e) => e.sunOk && e.gcOk);
    if (!anyDark) {
      diagnosis =
        'The Sun never drops below the astronomical twilight limit during this window - there is no astronomical darkness at this latitude on this date.';
    } else if (!anyGc) {
      const maxAlt = Math.max(...samples.map((s) => s.galacticCentreAltitude));
      diagnosis =
        maxAlt < 0
          ? 'The Galactic Centre stays below the horizon throughout this window. Other parts of the Milky Way may still be visible.'
          : `The Galactic Centre peaks at only ${maxAlt.toFixed(1)} deg, below the minimum altitude you set.`;
    } else if (!anyDarkAndGc) {
      diagnosis =
        'The Galactic Centre is up, and the sky gets dark, but never at the same time on this date.';
    } else {
      diagnosis = 'Moonlight exceeds the limit you set for every otherwise-suitable minute.';
    }
  }

  return { windows, samples, qualifies, diagnosis };
}
