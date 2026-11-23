/**
 * Sky brightness: unit conversions, the moonlight model, and the renderer
 * parameters derived from them.
 */
import { describe, expect, it } from 'vitest';
import {
  computeSkyBrightness,
  limitingMagnitude,
  moonSkyBrightnessNl,
  nanolambertToSqm,
  skyRenderParameters,
  sqmToNanolambert,
} from '../src/sky-brightness/model';
import { NATURAL_SKY_SQM } from '../src/astronomy/constants';

describe('brightness units', () => {
  it('round-trips mag/arcsec^2 through nanolamberts', () => {
    for (const sqm of [16, 18, 20, 21.6, 22]) {
      expect(nanolambertToSqm(sqmToNanolambert(sqm))).toBeCloseTo(sqm, 9);
    }
  });

  it('is monotonic: a smaller SQM number means a brighter sky', () => {
    expect(sqmToNanolambert(18)).toBeGreaterThan(sqmToNanolambert(22));
  });

  it('one magnitude is a factor of 2.512 in luminance', () => {
    expect(sqmToNanolambert(20) / sqmToNanolambert(21)).toBeCloseTo(2.512, 2);
  });
});

describe('limiting magnitude', () => {
  it('reproduces the Schaefer relation at reference brightnesses', () => {
    // NELM = 7.93 - 5*log10(1 + 10^(4.316 - SQM/5)). More conservative than the
    // figures Bortle quotes: the formula describes a typical observer.
    const pairs: Array<[number, number]> = [
      [21.99, 6.62],
      [21.6, 6.44],
      [20.5, 5.82],
      [19.5, 5.14],
      [18.5, 4.38],
      [17.5, 3.54],
    ];
    for (const [sqm, expected] of pairs) {
      expect(limitingMagnitude(sqm)).toBeCloseTo(expected, 1);
    }
  });

  it('decreases as the sky brightens', () => {
    let previous = Infinity;
    for (const sqm of [22, 21, 20, 19, 18, 17]) {
      const m = limitingMagnitude(sqm);
      expect(m).toBeLessThan(previous);
      previous = m;
    }
  });

  it('stays in a physically sensible range', () => {
    expect(limitingMagnitude(22.0)).toBeGreaterThan(6.0);
    expect(limitingMagnitude(22.0)).toBeLessThan(7.0);
    expect(limitingMagnitude(16.0)).toBeGreaterThan(1.5);
    expect(limitingMagnitude(16.0)).toBeLessThan(3.5);
  });
});

describe('moonlight (Krisciunas & Schaefer 1991)', () => {
  it('contributes nothing when the Moon is below the horizon', () => {
    expect(moonSkyBrightnessNl(-5, 45, 60, 0)).toBe(0);
  });

  it('contributes nothing when the target is below the horizon', () => {
    expect(moonSkyBrightnessNl(45, -5, 60, 0)).toBe(0);
  });

  it('a full moon high in the sky costs several magnitudes', () => {
    const base = sqmToNanolambert(NATURAL_SKY_SQM);
    const penalty = NATURAL_SKY_SQM - nanolambertToSqm(base + moonSkyBrightnessNl(60, 45, 60, 0));
    expect(penalty).toBeGreaterThan(2);
    expect(penalty).toBeLessThan(6);
  });

  it('a thin crescent costs far less than a full moon', () => {
    expect(moonSkyBrightnessNl(45, 45, 70, 140)).toBeLessThan(
      moonSkyBrightnessNl(45, 45, 70, 0) / 10,
    );
  });

  it('is brighter closer to the Moon', () => {
    expect(moonSkyBrightnessNl(50, 50, 10, 0)).toBeGreaterThan(moonSkyBrightnessNl(50, 50, 120, 0));
  });

  it('is brighter when the Moon is higher', () => {
    expect(moonSkyBrightnessNl(70, 45, 60, 0)).toBeGreaterThan(moonSkyBrightnessNl(5, 45, 60, 0));
  });
});

describe('combined sky brightness', () => {
  const base = {
    moonAltitudeDeg: -30,
    moonIllumination: 0,
    sunMoonEarthAngleDeg: 180,
    targetAltitudeDeg: 40,
    moonSeparationDeg: 90,
    sunAltitudeDeg: -30,
  };

  it('is the natural sky with no Moon', () => {
    const r = computeSkyBrightness(base);
    expect(r.effectiveSqm).toBeCloseTo(NATURAL_SKY_SQM, 6);
    expect(r.moonPenaltyMag).toBeCloseTo(0, 6);
    expect(r.twilightDominated).toBe(false);
  });

  it('never makes the sky darker than the natural value', () => {
    for (const alt of [-10, 5, 30, 70]) {
      for (const illum of [0, 0.2, 0.6, 1]) {
        const r = computeSkyBrightness({
          ...base,
          moonAltitudeDeg: alt,
          moonIllumination: illum,
          sunMoonEarthAngleDeg: (1 - illum) * 180,
        });
        expect(r.effectiveSqm).toBeLessThanOrEqual(NATURAL_SKY_SQM + 1e-9);
        expect(r.moonPenaltyMag).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('includeMoon false removes the Moon entirely', () => {
    const withMoon = computeSkyBrightness({
      ...base,
      moonAltitudeDeg: 60,
      moonIllumination: 1,
      sunMoonEarthAngleDeg: 0,
    });
    const without = computeSkyBrightness({
      ...base,
      moonAltitudeDeg: 60,
      moonIllumination: 1,
      sunMoonEarthAngleDeg: 0,
      includeMoon: false,
    });
    expect(withMoon.moonPenaltyMag).toBeGreaterThan(1);
    expect(without.moonPenaltyMag).toBeCloseTo(0, 6);
    expect(without.effectiveSqm).toBeCloseTo(NATURAL_SKY_SQM, 6);
  });

  it('flags twilight rather than pretending the figure applies', () => {
    expect(computeSkyBrightness({ ...base, sunAltitudeDeg: -10 }).twilightDominated).toBe(true);
  });
});

describe('render parameters', () => {
  it('a moonless sky renders at full contrast', () => {
    const p = skyRenderParameters(NATURAL_SKY_SQM);
    expect(p.milkyWayContrast).toBeCloseTo(1, 6);
    expect(p.backgroundLevel).toBeLessThan(0.01);
  });

  it('a moonlit sky loses contrast, gains background and shows fewer stars', () => {
    const dark = skyRenderParameters(NATURAL_SKY_SQM);
    const moonlit = skyRenderParameters(18.5);
    expect(moonlit.milkyWayContrast).toBeLessThan(dark.milkyWayContrast);
    expect(moonlit.backgroundLevel).toBeGreaterThan(dark.backgroundLevel);
    expect(moonlit.limitingMagnitude).toBeLessThan(dark.limitingMagnitude);
  });

  it('keeps every parameter inside its documented range', () => {
    for (let sqm = 15; sqm <= 22; sqm += 0.25) {
      const p = skyRenderParameters(sqm);
      expect(p.backgroundLevel).toBeGreaterThan(0);
      expect(p.backgroundLevel).toBeLessThanOrEqual(0.42);
      expect(p.milkyWayContrast).toBeGreaterThan(0);
      expect(p.milkyWayContrast).toBeLessThanOrEqual(1);
      expect(p.limitingMagnitude).toBeGreaterThanOrEqual(2);
      expect(p.limitingMagnitude).toBeLessThanOrEqual(6.5);
      for (const c of p.glowColor) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never brightens the background above the natural sky', () => {
    // A brightness darker than natural cannot occur, and must not be rendered
    // as if it were brighter.
    expect(skyRenderParameters(23).backgroundLevel).toBeCloseTo(
      skyRenderParameters(NATURAL_SKY_SQM).backgroundLevel,
      9,
    );
  });
});
