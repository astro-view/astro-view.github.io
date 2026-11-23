/**
 * Static dataset integrity and texture registration.
 *
 * These run against the files that actually ship in `public/data`, so a broken
 * or missing preprocessing step fails the build rather than the browser.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { skyToUV, textureU, textureV, uvToSky } from '../src/rendering/skyTexture';
import { GALACTIC_CENTRE } from '../src/astronomy/constants';

const DATA = path.resolve(__dirname, '..', 'public', 'data');

describe('star catalogue', () => {
  const metaPath = path.join(DATA, 'stars.meta.json');
  const binPath = path.join(DATA, 'stars.bin');

  it('exists - run "npm run data:stars" if this fails', () => {
    expect(existsSync(metaPath)).toBe(true);
    expect(existsSync(binPath)).toBe(true);
  });

  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const buf = readFileSync(binPath);
  const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

  it('has the record count its metadata claims', () => {
    expect(data.length % 4).toBe(0);
    expect(data.length / 4).toBe(meta.count);
  });

  it('holds a useful number of real stars', () => {
    expect(meta.count).toBeGreaterThan(8000);
    expect(meta.count).toBeLessThan(12000);
    expect(meta.magnitudeLimit).toBeCloseTo(6.5, 6);
  });

  it('carries its source and licence', () => {
    expect(meta.source).toMatch(/HYG/i);
    expect(meta.license).toMatch(/CC BY-SA/i);
    expect(meta.attribution).toBeTruthy();
    expect(meta.epoch).toMatch(/J2000/);
  });

  it('has every coordinate in range and every magnitude under the limit', () => {
    for (let i = 0; i < meta.count; i++) {
      const ra = data[i * 4];
      const dec = data[i * 4 + 1];
      const mag = data[i * 4 + 2];
      const ci = data[i * 4 + 3];
      expect(ra).toBeGreaterThanOrEqual(0);
      expect(ra).toBeLessThanOrEqual(360);
      expect(dec).toBeGreaterThanOrEqual(-90);
      expect(dec).toBeLessThanOrEqual(90);
      expect(mag).toBeLessThanOrEqual(meta.magnitudeLimit + 1e-5);
      expect(Number.isFinite(ci)).toBe(true);
    }
  });

  it('is sorted brightest first', () => {
    for (let i = 1; i < meta.count; i++) {
      expect(data[i * 4 + 2]).toBeGreaterThanOrEqual(data[(i - 1) * 4 + 2] - 1e-6);
    }
  });

  it('places the brightest stars where the sky really has them', () => {
    // Sirius, Canopus, Arcturus and Vega are the four brightest stars visible
    // from Earth after the Sun; each must appear near its catalogue position.
    const targets: Array<[string, number, number, number]> = [
      ['Sirius', 101.287, -16.716, -1.44],
      ['Canopus', 95.988, -52.696, -0.62],
      ['Arcturus', 213.915, 19.182, -0.05],
      ['Vega', 279.234, 38.784, 0.03],
    ];
    for (const [name, ra, dec, mag] of targets) {
      let found = false;
      for (let i = 0; i < 20; i++) {
        const dRa = Math.abs(((data[i * 4] - ra + 540) % 360) - 180);
        const dDec = Math.abs(data[i * 4 + 1] - dec);
        if (dRa < 0.1 && dDec < 0.1 && Math.abs(data[i * 4 + 2] - mag) < 0.1) found = true;
      }
      expect(found, `${name} should be among the 20 brightest catalogue entries`).toBe(true);
    }
  });

  it('does not contain the Sun', () => {
    expect(data[2]).toBeGreaterThan(-5); // brightest entry is Sirius, not mag -26
  });
});

describe('named stars', () => {
  const namesPath = path.join(DATA, 'star-names.json');

  it('exists and lists well-known stars', () => {
    expect(existsSync(namesPath)).toBe(true);
    const json = JSON.parse(readFileSync(namesPath, 'utf8'));
    const names: string[] = json.stars.map((s: { name: string }) => s.name);
    for (const n of ['Sirius', 'Vega', 'Betelgeuse', 'Rigel', 'Antares']) {
      expect(names).toContain(n);
    }
    expect(json.attribution).toBeTruthy();
  });
});

describe('Milky Way texture', () => {
  const metaPath = path.join(DATA, 'milkyway.meta.json');

  it('exists - run "npm run data:milkyway" if this fails', () => {
    expect(existsSync(metaPath)).toBe(true);
    expect(existsSync(path.join(DATA, 'milkyway.webp'))).toBe(true);
  });

  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

  it('documents its projection, frame and rights', () => {
    expect(meta.projection).toMatch(/equirectangular/i);
    expect(meta.frame).toMatch(/J2000|ICRS/i);
    expect(meta.rights).toMatch(/NASA/i);
    expect(meta.sourceUrl).toMatch(/svs\.gsfc\.nasa\.gov/);
  });

  it('records a measured registration, not an assumed one', () => {
    expect(meta.registration.method).toMatch(/matched filter/i);
    expect(meta.registration.peakOverChance).toBeGreaterThan(10);
    expect(meta.registration.starsUsed).toBeGreaterThan(100);
  });

  it('passed the diffuse-structure checks', () => {
    // The galactic plane must be the brightest band, and the inner Galaxy must
    // outshine the anticentre - the check that catches a 180-degree error.
    expect(meta.diffuseStructureCheck.planeOverHighLatitude).toBeGreaterThan(1.3);
    expect(meta.diffuseStructureCheck.innerGalaxyOverAnticentre).toBeGreaterThan(1.05);
  });

  it('the renderer mapping agrees with the one recorded in the metadata', () => {
    expect(meta.mapping).toContain('180 - raDeg');
    expect(meta.mapping).toContain('90 - decDeg');
  });
});

describe('texture UV mapping', () => {
  it('puts RA 0h at the horizontal centre', () => {
    expect(skyToUV(0, 0).u).toBeCloseTo(0.5, 9);
  });

  it('runs right ascension to the left', () => {
    expect(skyToUV(90, 0).u).toBeCloseTo(0.25, 9);
    expect(skyToUV(270, 0).u).toBeCloseTo(0.75, 9);
  });

  it('puts Dec +90 at the first image row and Dec -90 at the last', () => {
    expect(textureV(90)).toBeCloseTo(0, 9);
    expect(textureV(-90)).toBeCloseTo(1, 9);
    expect(textureV(0)).toBeCloseTo(0.5, 9);
  });

  it('is continuous for geometry UVs (no modulo seam)', () => {
    // textureU must decrease monotonically across the whole RA range.
    let previous = Infinity;
    for (let ra = 0; ra <= 360; ra += 10) {
      const u = textureU(ra);
      expect(u).toBeLessThan(previous);
      previous = u;
    }
    expect(textureU(0) - textureU(360)).toBeCloseTo(1, 9);
  });

  it('round-trips through uvToSky', () => {
    for (const ra of [0, 45, 180, 266.41683, 359]) {
      for (const dec of [-89, -29, 0, 45, 89]) {
        const { u, v } = skyToUV(ra, dec);
        const back = uvToSky(u, v);
        expect(back.decDeg).toBeCloseTo(dec, 9);
        expect(Math.abs(((back.raDeg - ra + 540) % 360) - 180)).toBeCloseTo(0, 7);
      }
    }
  });

  it('places the Galactic Centre in the lower right of the map', () => {
    // Measured position of the Sagittarius bulge in the source image.
    const { u, v } = skyToUV(GALACTIC_CENTRE.raDeg, GALACTIC_CENTRE.decDeg);
    expect(u).toBeCloseTo(0.76, 2);
    expect(v).toBeCloseTo(0.661, 2);
  });
});
