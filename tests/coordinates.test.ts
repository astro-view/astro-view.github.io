/**
 * Coordinate-transform tests.
 *
 * The important property is agreement with an independent path through
 * astronomy-engine: our fast matrix route (used for ~9000 stars per frame) must
 * produce the same altitude/azimuth as `Astronomy.Horizon`, which is the
 * library's own reduction. If the HOR axis convention or the matrix storage
 * order were wrong, these would disagree by tens of degrees.
 */
import { describe, expect, it } from 'vitest';
import * as Astronomy from 'astronomy-engine';
import {
  type GeoLocation,
  enuFromHorizontal,
  equatorialToEnuMatrix,
  equatorialToGalactic,
  equatorialToHorizontal,
  equatorialToVector,
  galacticToEquatorial,
  horizontalFromEnu,
  hourAngleDeg,
  localSiderealTimeDeg,
  multiplyMatrixVector,
  observerFor,
  vectorToEquatorial,
} from '../src/astronomy/coordinates';
import { GALACTIC_CENTRE, angularSeparationDeg } from '../src/astronomy/constants';

const GREENWICH: GeoLocation = { latitude: 51.4779, longitude: 0, elevation: 0 };
const TENERIFE: GeoLocation = { latitude: 28.2723, longitude: -16.6425, elevation: 2100 };
const SYDNEY: GeoLocation = { latitude: -33.8688, longitude: 151.2093, elevation: 20 };
const TROMSO: GeoLocation = { latitude: 69.6496, longitude: 18.956, elevation: 10 };

/** Independent reduction straight through astronomy-engine. */
function referenceHorizontal(raDeg: number, decDeg: number, date: Date, loc: GeoLocation) {
  const observer = observerFor(loc);
  // Our matrix is EQJ -> HOR, so compare against the J2000 coordinates rotated
  // to of-date by astronomy-engine itself.
  const v = equatorialToVector(raDeg, decDeg);
  const vec = new Astronomy.Vector(v[0], v[1], v[2], new Astronomy.AstroTime(date));
  const rot = Astronomy.Rotation_EQJ_EQD(date);
  const ofDate = Astronomy.RotateVector(rot, vec);
  const eq = Astronomy.EquatorFromVector(ofDate);
  const h = Astronomy.Horizon(date, observer, eq.ra, eq.dec);
  return { azimuth: h.azimuth, altitude: h.altitude };
}

describe('equatorial to horizontal', () => {
  const cases: Array<[string, GeoLocation, Date]> = [
    ['Greenwich, northern winter', GREENWICH, new Date('2024-01-15T22:00:00Z')],
    ['Tenerife, northern summer', TENERIFE, new Date('2024-07-04T01:30:00Z')],
    ['Sydney, southern hemisphere', SYDNEY, new Date('2024-08-20T13:00:00Z')],
    ['Tromso, high latitude', TROMSO, new Date('2024-02-10T20:00:00Z')],
    ['Equator, meridian crossing', { latitude: 0, longitude: 0, elevation: 0 }, new Date('2025-03-20T12:00:00Z')],
  ];

  const targets: Array<[string, number, number]> = [
    ['Galactic Centre', GALACTIC_CENTRE.raDeg, GALACTIC_CENTRE.decDeg],
    ['Vega', 279.2347, 38.7837],
    ['Sirius', 101.2872, -16.7161],
    ['Polaris', 37.9545, 89.2641],
    ['Acrux', 186.6496, -63.0991],
    ['RA 0 Dec 0', 0, 0],
  ];

  for (const [placeName, loc, date] of cases) {
    for (const [targetName, ra, dec] of targets) {
      it(`${targetName} at ${placeName} matches astronomy-engine`, () => {
        const ours = equatorialToHorizontal({ raDeg: ra, decDeg: dec }, date, loc);
        const theirs = referenceHorizontal(ra, dec, date, loc);
        // Compare as a great-circle separation so the azimuth wrap, and the
        // meaningless azimuth of a near-zenith object, cannot produce a false fail.
        const sep = angularSeparationDeg(
          ours.azimuth,
          ours.altitude,
          theirs.azimuth,
          theirs.altitude,
        );
        expect(sep).toBeLessThan(0.02);
        expect(Math.abs(ours.altitude - theirs.altitude)).toBeLessThan(0.02);
      });
    }
  }
});

describe('ENU frame conventions', () => {
  it('azimuth 0 is north, 90 is east', () => {
    // ENU is [east, up, south].
    expect(enuFromHorizontal(0, 0)).toEqual([0, 0, -1]);
    const east = enuFromHorizontal(90, 0);
    expect(east[0]).toBeCloseTo(1, 10);
    expect(east[2]).toBeCloseTo(0, 10);
    const south = enuFromHorizontal(180, 0);
    expect(south[2]).toBeCloseTo(1, 10);
    const west = enuFromHorizontal(270, 0);
    expect(west[0]).toBeCloseTo(-1, 10);
  });

  it('altitude 90 is the zenith regardless of azimuth', () => {
    for (const az of [0, 37, 180, 300]) {
      const v = enuFromHorizontal(az, 90);
      expect(v[1]).toBeCloseTo(1, 10);
    }
  });

  it('round-trips through horizontalFromEnu', () => {
    for (const az of [0, 45, 123.4, 270, 359.9]) {
      for (const alt of [-10, 0, 17.5, 62, 89]) {
        const back = horizontalFromEnu(enuFromHorizontal(az, alt));
        expect(back.altitude).toBeCloseTo(alt, 8);
        expect(Math.abs(((back.azimuth - az + 540) % 360) - 180)).toBeCloseTo(0, 6);
      }
    }
  });

  it('the celestial pole sits at altitude = latitude', () => {
    const date = new Date('2024-06-01T00:00:00Z');
    for (const loc of [GREENWICH, TENERIFE, SYDNEY, TROMSO]) {
      const m = equatorialToEnuMatrix(date, loc);
      // North celestial pole is +z in EQJ.
      const pole = horizontalFromEnu(multiplyMatrixVector(m, [0, 0, 1]));
      expect(pole.altitude).toBeCloseTo(loc.latitude, 0);
    }
  });
});

describe('equatorial vectors', () => {
  it('round-trip RA/Dec through a unit vector', () => {
    for (const ra of [0, 45.5, 180, 266.41683, 359.9]) {
      for (const dec of [-89, -29.00781, 0, 38.78, 89]) {
        const back = vectorToEquatorial(equatorialToVector(ra, dec));
        expect(back.decDeg).toBeCloseTo(dec, 9);
        expect(Math.abs(((back.raDeg - ra + 540) % 360) - 180)).toBeCloseTo(0, 7);
      }
    }
  });
});

describe('sidereal time and hour angle', () => {
  it('local sidereal time tracks longitude', () => {
    const date = new Date('2024-05-01T03:00:00Z');
    const atZero = localSiderealTimeDeg(date, 0);
    const atFifteen = localSiderealTimeDeg(date, 15);
    expect(((atFifteen - atZero + 360) % 360)).toBeCloseTo(15, 6);
  });

  it('hour angle is zero when the object is on the meridian', () => {
    const date = new Date('2024-05-01T03:00:00Z');
    const lst = localSiderealTimeDeg(date, -16.6425);
    const ha = hourAngleDeg(lst, date, -16.6425);
    expect(Math.abs(ha)).toBeLessThan(1e-6);
  });

  it('sidereal time advances about 361 degrees per solar day', () => {
    const t0 = new Date('2024-05-01T00:00:00Z');
    const t1 = new Date('2024-05-02T00:00:00Z');
    const d = (localSiderealTimeDeg(t1, 0) - localSiderealTimeDeg(t0, 0) + 360) % 360;
    expect(d).toBeGreaterThan(0.8);
    expect(d).toBeLessThan(1.1);
  });
});

describe('galactic coordinates', () => {
  it('Sgr A* lies on the galactic equator at longitude 0', () => {
    const g = equatorialToGalactic(GALACTIC_CENTRE.raDeg, GALACTIC_CENTRE.decDeg);
    expect(Math.abs(g.b)).toBeLessThan(0.1);
    expect(Math.min(g.l, 360 - g.l)).toBeLessThan(0.1);
  });

  it('the north galactic pole maps to b = +90', () => {
    const g = equatorialToGalactic(192.85948, 27.12825);
    expect(g.b).toBeCloseTo(90, 4);
  });

  it('the galactic anticentre is at l = 180, b = 0', () => {
    const eq = galacticToEquatorial(180, 0);
    const g = equatorialToGalactic(eq.raDeg, eq.decDeg);
    expect(g.l).toBeCloseTo(180, 4);
    expect(Math.abs(g.b)).toBeLessThan(1e-4);
  });

  it('round-trips equatorial -> galactic -> equatorial', () => {
    for (const ra of [12.3, 100, 266.41683, 310]) {
      for (const dec of [-70, -29, 5, 45, 80]) {
        const g = equatorialToGalactic(ra, dec);
        const back = galacticToEquatorial(g.l, g.b);
        expect(angularSeparationDeg(ra, dec, back.raDeg, back.decDeg)).toBeLessThan(1e-6);
      }
    }
  });
});
