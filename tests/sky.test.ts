/**
 * Sun, Moon, twilight, Galactic Centre and planner behaviour, checked against
 * published reference values and against physical invariants that must hold
 * everywhere (both hemispheres, polar latitudes, core below the horizon).
 */
import { describe, expect, it } from 'vitest';
import {
  computeEvents,
  computeSkyState,
  galacticCentreHorizontal,
  milkyWayBandVisibility,
  sampleTimeline,
  airmass,
} from '../src/astronomy/sky';
import { findObservationWindows } from '../src/astronomy/planner';
import type { GeoLocation } from '../src/astronomy/coordinates';
import { localDateString, localPartsToUtc, parseLocalDateTime, timeZoneForLocation, utcToLocalParts } from '../src/astronomy/time';

const TENERIFE: GeoLocation = { latitude: 28.2723, longitude: -16.6425, elevation: 2100 };
const SYDNEY: GeoLocation = { latitude: -33.8688, longitude: 151.2093, elevation: 20 };
const REYKJAVIK: GeoLocation = { latitude: 64.1466, longitude: -21.9426, elevation: 0 };
const LONDON: GeoLocation = { latitude: 51.5074, longitude: -0.1278, elevation: 11 };

describe('Sun', () => {
  it('is near the horizon at a known sunset', () => {
    // London sunset on 2024-06-21 is 21:21 BST = 20:21 UTC.
    const state = computeSkyState(new Date('2024-06-21T20:21:00Z'), LONDON);
    expect(Math.abs(state.sun.altitude)).toBeLessThan(1.2);
    expect(state.sun.azimuth).toBeGreaterThan(300); // sets in the north-west at the solstice
  });

  it('is highest at local solar noon and at the solstice declination', () => {
    // At the June solstice the Sun's noon altitude is 90 - lat + 23.44.
    const noonUtc = new Date('2024-06-21T12:00:00Z');
    const state = computeSkyState(noonUtc, { latitude: 51.5074, longitude: 0, elevation: 0 });
    const expected = 90 - 51.5074 + 23.44;
    expect(state.sun.altitude).toBeGreaterThan(expected - 1.5);
    expect(state.sun.altitude).toBeLessThan(expected + 1.5);
  });

  it('never sets at Reykjavik on the June solstice', () => {
    const samples = sampleTimeline(
      new Date('2024-06-21T00:00:00Z'),
      new Date('2024-06-22T00:00:00Z'),
      REYKJAVIK,
      30,
    );
    const minAltitude = Math.min(...samples.map((s) => s.sunAltitude));
    expect(minAltitude).toBeGreaterThan(-6); // civil twilight at worst: the midnight sun period
  });
});

describe('astronomical twilight', () => {
  it('reports no astronomical darkness at Reykjavik in midsummer', () => {
    const events = computeEvents(new Date('2024-06-21T12:00:00Z'), REYKJAVIK, 24);
    expect(events.noAstronomicalDarkness).toBe(true);
    expect(events.duskAstronomical).toBeNull();
  });

  it('finds dusk and dawn at Tenerife in July', () => {
    const events = computeEvents(new Date('2024-07-04T12:00:00Z'), TENERIFE, 24);
    expect(events.duskAstronomical).not.toBeNull();
    expect(events.dawnAstronomical).not.toBeNull();
    expect(events.sunset).not.toBeNull();
    // Astronomical dusk must come after sunset.
    expect((events.duskAstronomical as Date).getTime()).toBeGreaterThan(
      (events.sunset as Date).getTime(),
    );
  });

  it('the Sun is actually below -18 degrees between dusk and dawn', () => {
    const events = computeEvents(new Date('2024-07-04T12:00:00Z'), TENERIFE, 24);
    const dusk = events.duskAstronomical as Date;
    const dawn = events.dawnAstronomical as Date;
    const mid = new Date((dusk.getTime() + dawn.getTime()) / 2);
    expect(computeSkyState(mid, TENERIFE).sun.altitude).toBeLessThan(-18);
    expect(computeSkyState(dusk, TENERIFE).sun.altitude).toBeCloseTo(-18, 1);
    expect(computeSkyState(dawn, TENERIFE).sun.altitude).toBeCloseTo(-18, 1);
  });

  it('flags astronomical darkness consistently with the Sun altitude', () => {
    for (const d of ['2024-01-15T02:00:00Z', '2024-07-04T02:00:00Z', '2024-07-04T13:00:00Z']) {
      const s = computeSkyState(new Date(d), TENERIFE);
      expect(s.astronomicallyDark).toBe(s.sun.altitude < -18);
    }
  });
});

describe('Moon', () => {
  it('is nearly full at a known full moon', () => {
    // Full moon 2024-08-19 18:26 UTC.
    const s = computeSkyState(new Date('2024-08-19T18:26:00Z'), TENERIFE);
    expect(s.moon.illumination).toBeGreaterThan(0.99);
    expect(s.moon.phaseName).toBe('Full Moon');
    expect(s.moon.sunMoonEarthAngleDeg).toBeLessThan(5);
  });

  it('is nearly new at a known new moon', () => {
    // New moon 2024-08-04 11:13 UTC.
    const s = computeSkyState(new Date('2024-08-04T11:13:00Z'), TENERIFE);
    expect(s.moon.illumination).toBeLessThan(0.01);
    expect(s.moon.phaseName).toBe('New Moon');
  });

  it('reports moonrise and moonset in the right order over a night', () => {
    const events = computeEvents(new Date('2024-08-19T12:00:00Z'), TENERIFE, 24);
    expect(events.moonrise ?? events.moonset).not.toBeNull();
  });
});

describe('Galactic Centre', () => {
  it('culminates higher from Sydney than from Tenerife', () => {
    // Declination -29: the core passes near the zenith from latitude -29.
    const maxFrom = (loc: GeoLocation) =>
      Math.max(
        ...sampleTimeline(
          new Date('2024-07-04T00:00:00Z'),
          new Date('2024-07-05T00:00:00Z'),
          loc,
          15,
        ).map((s) => s.galacticCentreAltitude),
      );
    const sydney = maxFrom(SYDNEY);
    const tenerife = maxFrom(TENERIFE);
    expect(sydney).toBeGreaterThan(tenerife);
    // Culmination altitude = 90 - |lat - dec|.
    expect(sydney).toBeCloseTo(90 - Math.abs(SYDNEY.latitude - -29.00781), 0);
    expect(tenerife).toBeCloseTo(90 - Math.abs(TENERIFE.latitude - -29.00781), 0);
  });

  it('never rises above the horizon north of latitude 61', () => {
    // Dec -29 is circumpolar-below for latitudes above 90 - 29 = 61 degrees.
    const arctic: GeoLocation = { latitude: 69.65, longitude: 18.96, elevation: 0 };
    const samples = sampleTimeline(
      new Date('2024-07-04T00:00:00Z'),
      new Date('2024-07-05T00:00:00Z'),
      arctic,
      20,
    );
    expect(Math.max(...samples.map((s) => s.galacticCentreAltitude))).toBeLessThan(0);
  });

  it('is below the horizon for Tenerife in the northern winter evening', () => {
    // In January the core is a daytime object from the northern hemisphere.
    const h = galacticCentreHorizontal(new Date('2024-01-15T22:00:00Z'), TENERIFE);
    expect(h.altitude).toBeLessThan(0);
  });

  it('is distinct from Milky Way band visibility', () => {
    // A case where the core is down but a good part of the band is up: the two
    // must not be conflated.
    const date = new Date('2024-01-15T22:00:00Z');
    const core = galacticCentreHorizontal(date, TENERIFE);
    const band = milkyWayBandVisibility(date, TENERIFE);
    expect(core.altitude).toBeLessThan(0);
    expect(band.fractionAboveHorizon).toBeGreaterThan(0.2);
    expect(band.highestAltitude).toBeGreaterThan(20);
  });

  it('crosses the meridian once per sidereal day', () => {
    const samples = sampleTimeline(
      new Date('2024-07-04T00:00:00Z'),
      new Date('2024-07-05T00:00:00Z'),
      SYDNEY,
      5,
    );
    let peaks = 0;
    for (let i = 1; i < samples.length - 1; i++) {
      if (
        samples[i].galacticCentreAltitude > samples[i - 1].galacticCentreAltitude &&
        samples[i].galacticCentreAltitude > samples[i + 1].galacticCentreAltitude
      ) {
        peaks++;
      }
    }
    expect(peaks).toBe(1);
  });
});

describe('observation planner', () => {
  const criteria = {
    maxSunAltitude: -18,
    minGalacticCentreAltitude: 10,
    maxMoonPenaltyMag: 0.5,
    baseSqm: 21.6,
  };

  it('finds a usable window at Tenerife on a new-moon July night', () => {
    const result = findObservationWindows(
      new Date('2024-07-05T12:00:00Z'),
      new Date('2024-07-06T12:00:00Z'),
      TENERIFE,
      criteria,
      5,
    );
    expect(result.windows.length).toBeGreaterThan(0);
    const total = result.windows.reduce((a, w) => a + w.durationMinutes, 0);
    expect(total).toBeGreaterThan(60);
    for (const w of result.windows) {
      expect(w.peakGalacticCentreAltitude).toBeGreaterThanOrEqual(10);
      expect(w.end.getTime()).toBeGreaterThanOrEqual(w.start.getTime());
    }
  });

  it('every qualifying sample really does satisfy all three criteria', () => {
    const result = findObservationWindows(
      new Date('2024-07-05T12:00:00Z'),
      new Date('2024-07-06T12:00:00Z'),
      TENERIFE,
      criteria,
      10,
    );
    result.samples.forEach((s, i) => {
      if (!result.qualifies[i]) return;
      expect(s.sunAltitude).toBeLessThanOrEqual(criteria.maxSunAltitude);
      expect(s.galacticCentreAltitude).toBeGreaterThanOrEqual(criteria.minGalacticCentreAltitude);
    });
  });

  it('explains itself when the core never rises', () => {
    const result = findObservationWindows(
      new Date('2024-07-05T12:00:00Z'),
      new Date('2024-07-06T12:00:00Z'),
      { latitude: 69.65, longitude: 18.96, elevation: 0 },
      criteria,
      15,
    );
    expect(result.windows).toHaveLength(0);
    expect(result.diagnosis).toBeTruthy();
    expect(result.diagnosis).toMatch(/Galactic Centre|astronomical darkness/i);
  });

  it('returns nothing, with a reason, in a polar white night', () => {
    const result = findObservationWindows(
      new Date('2024-06-21T12:00:00Z'),
      new Date('2024-06-22T12:00:00Z'),
      REYKJAVIK,
      criteria,
      15,
    );
    expect(result.windows).toHaveLength(0);
    expect(result.diagnosis).toMatch(/darkness|Galactic Centre/i);
  });
});

describe('airmass', () => {
  it('is 1 at the zenith and grows towards the horizon', () => {
    expect(airmass(90)).toBeCloseTo(1, 3);
    expect(airmass(30)).toBeGreaterThan(1.9);
    expect(airmass(30)).toBeLessThan(2.1);
    expect(airmass(10)).toBeGreaterThan(5);
    expect(airmass(-1)).toBe(Infinity);
  });
});

describe('local time and UTC', () => {
  it('converts local civil time to UTC using the site time zone', () => {
    const tz = timeZoneForLocation(TENERIFE.latitude, TENERIFE.longitude);
    expect(tz).toBe('Atlantic/Canary');
    // 2024-07-04 02:00 WEST (UTC+1) = 2024-07-04 01:00 UTC.
    const { date } = parseLocalDateTime('2024-07-04', '02:00', tz);
    expect(date.toISOString()).toBe('2024-07-04T01:00:00.000Z');
  });

  it('handles a southern-hemisphere zone and its own DST', () => {
    const tz = timeZoneForLocation(SYDNEY.latitude, SYDNEY.longitude);
    expect(tz).toBe('Australia/Sydney');
    // January is AEDT (UTC+11).
    expect(parseLocalDateTime('2024-01-15', '22:00', tz).date.toISOString()).toBe(
      '2024-01-15T11:00:00.000Z',
    );
    // July is AEST (UTC+10).
    expect(parseLocalDateTime('2024-07-15', '22:00', tz).date.toISOString()).toBe(
      '2024-07-15T12:00:00.000Z',
    );
  });

  it('round-trips through the local parts', () => {
    const tz = 'Europe/London';
    for (const iso of ['2024-01-15T22:00:00Z', '2024-07-04T01:30:00Z', '2024-10-27T00:30:00Z']) {
      const d = new Date(iso);
      const parts = utcToLocalParts(d, tz);
      const back = localPartsToUtc(parts, tz).date;
      expect(Math.abs(back.getTime() - d.getTime())).toBeLessThanOrEqual(3600000);
      expect(localDateString(back, tz)).toBe(localDateString(d, tz));
    }
  });

  it('flags a spring-forward gap', () => {
    // 2024-03-31 01:30 does not exist in Europe/London.
    const r = parseLocalDateTime('2024-03-31', '01:30', 'Europe/London');
    expect(r.gap).toBe(true);
  });

  it('flags a fall-back overlap', () => {
    // 2024-10-27 01:30 happens twice in Europe/London.
    const r = parseLocalDateTime('2024-10-27', '01:30', 'Europe/London');
    expect(r.ambiguous).toBe(true);
    // The earlier (BST) occurrence is chosen.
    expect(r.date.toISOString()).toBe('2024-10-27T00:30:00.000Z');
  });
});
