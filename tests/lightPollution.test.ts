/**
 * Light pollution model: unit conversions, the moonlight model and the derived
 * rendering parameters.
 */
import { describe, expect, it } from 'vitest';
import {
  BORTLE_CLASSES,
  bortleForSqm,
  computeSkyBrightness,
  indicativeSqmFromViirsRadiance,
  limitingMagnitude,
  moonSkyBrightnessNl,
  nanolambertToSqm,
  skyRenderParameters,
  sqmToNanolambert,
} from '../src/light-pollution/model';
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
    // Values of NELM = 7.93 - 5*log10(1 + 10^(4.316 - SQM/5)), the form used
    // alongside Unihedron SQM readings.
    //
    // Note these are deliberately more conservative than the naked-eye limits
    // Bortle himself quotes for each class (he gives 7.6-8.0 for class 1). The
    // formula describes a typical observer; Bortle described exceptional ones.
    const pairs: Array<[number, number]> = [
      [21.99, 6.62],
      [21.9, 6.58],
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

  it('stays in a physically sensible range', () => {
    // A perfect sky does not let the unaided eye past about magnitude 7, and
    // even an inner-city sky still shows the brightest stars.
    expect(limitingMagnitude(22.0)).toBeLessThan(7.0);
    expect(limitingMagnitude(22.0)).toBeGreaterThan(6.0);
    expect(limitingMagnitude(16.0)).toBeGreaterThan(1.5);
    expect(limitingMagnitude(16.0)).toBeLessThan(3.5);
  });

  it('decreases as the sky brightens', () => {
    let previous = Infinity;
    for (const sqm of [22, 21, 20, 19, 18, 17]) {
      const m = limitingMagnitude(sqm);
      expect(m).toBeLessThan(previous);
      previous = m;
    }
  });
});

describe('Bortle classification', () => {
  it('maps representative values to the expected class', () => {
    expect(bortleForSqm(22.0).bortle).toBe(1);
    expect(bortleForSqm(21.92).bortle).toBe(2);
    expect(bortleForSqm(21.75).bortle).toBe(3);
    expect(bortleForSqm(21.0).bortle).toBe(4);
    expect(bortleForSqm(20.0).bortle).toBe(5);
    expect(bortleForSqm(19.2).bortle).toBe(6);
    expect(bortleForSqm(18.6).bortle).toBe(7);
    expect(bortleForSqm(18.0).bortle).toBe(8);
    expect(bortleForSqm(17.0).bortle).toBe(9);
  });

  it('covers the whole range without a gap', () => {
    for (let sqm = 15; sqm <= 22.1; sqm += 0.05) {
      expect(BORTLE_CLASSES).toContain(bortleForSqm(sqm));
    }
  });
});

describe('moonlight (Krisciunas & Schaefer 1991)', () => {
  it('contributes nothing when the Moon is below the horizon', () => {
    expect(moonSkyBrightnessNl(-5, 45, 60, 0)).toBe(0);
  });

  it('a full moon high in the sky brightens the sky by several magnitudes', () => {
    const base = sqmToNanolambert(21.9);
    const moon = moonSkyBrightnessNl(60, 45, 60, 0);
    const penalty = 21.9 - nanolambertToSqm(base + moon);
    expect(penalty).toBeGreaterThan(2);
    expect(penalty).toBeLessThan(6);
  });

  it('a thin crescent costs far less than a full moon', () => {
    const full = moonSkyBrightnessNl(45, 45, 70, 0);
    const crescent = moonSkyBrightnessNl(45, 45, 70, 140);
    expect(crescent).toBeLessThan(full / 10);
  });

  it('is brighter closer to the Moon', () => {
    const near = moonSkyBrightnessNl(50, 50, 10, 0);
    const far = moonSkyBrightnessNl(50, 50, 120, 0);
    expect(near).toBeGreaterThan(far);
  });

  it('is brighter when the Moon is higher', () => {
    const high = moonSkyBrightnessNl(70, 45, 60, 0);
    const low = moonSkyBrightnessNl(5, 45, 60, 0);
    expect(high).toBeGreaterThan(low);
  });
});

describe('combined sky brightness', () => {
  const baseInput = {
    baseSqm: 21.6,
    moonAltitudeDeg: -30,
    moonIllumination: 0,
    sunMoonEarthAngleDeg: 180,
    targetAltitudeDeg: 40,
    moonSeparationDeg: 90,
    sunAltitudeDeg: -30,
  };

  it('leaves the brightness untouched with no Moon', () => {
    const r = computeSkyBrightness(baseInput);
    expect(r.effectiveSqm).toBeCloseTo(21.6, 6);
    expect(r.moonPenaltyMag).toBeCloseTo(0, 6);
    expect(r.twilightDominated).toBe(false);
  });

  it('never makes the sky darker than the moonless value', () => {
    for (const alt of [-10, 5, 30, 70]) {
      for (const illum of [0, 0.2, 0.6, 1]) {
        const r = computeSkyBrightness({
          ...baseInput,
          moonAltitudeDeg: alt,
          moonIllumination: illum,
          sunMoonEarthAngleDeg: (1 - illum) * 180,
        });
        expect(r.effectiveSqm).toBeLessThanOrEqual(21.6 + 1e-9);
        expect(r.moonPenaltyMag).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('flags twilight rather than pretending the SQM figure applies', () => {
    const r = computeSkyBrightness({ ...baseInput, sunAltitudeDeg: -10 });
    expect(r.twilightDominated).toBe(true);
  });
});

describe('VIIRS radiance', () => {
  it('is never presented as a direct conversion', () => {
    const r = indicativeSqmFromViirsRadiance(5);
    expect(r.caveat).toMatch(/indicative/i);
    expect(r.caveat).toMatch(/upward radiance/i);
  });

  it('gives darker skies for lower radiance, bounded by the natural sky', () => {
    expect(indicativeSqmFromViirsRadiance(0).sqm).toBeLessThanOrEqual(NATURAL_SKY_SQM);
    expect(indicativeSqmFromViirsRadiance(0.05).sqm).toBeGreaterThan(
      indicativeSqmFromViirsRadiance(50).sqm,
    );
  });
});

describe('render parameters', () => {
  it('ideal mode ignores the measured brightness entirely', () => {
    const a = skyRenderParameters(17.0, { idealSky: true });
    const b = skyRenderParameters(21.9, { idealSky: true });
    expect(a).toEqual(b);
    expect(a.milkyWayContrast).toBeCloseTo(1, 6);
  });

  it('a polluted sky loses contrast, gains background and shows fewer stars', () => {
    const dark = skyRenderParameters(21.9);
    const city = skyRenderParameters(18.0);
    expect(city.milkyWayContrast).toBeLessThan(dark.milkyWayContrast);
    expect(city.backgroundLevel).toBeGreaterThan(dark.backgroundLevel);
    expect(city.limitingMagnitude).toBeLessThan(dark.limitingMagnitude);
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
});
