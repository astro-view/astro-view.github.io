/**
 * Build the all-sky Milky Way texture used by the celestial sphere renderer.
 *
 * Source: NASA/Goddard Space Flight Center Scientific Visualization Studio,
 *         "Deep Star Maps" (SVS ID 3895), starmap_8k.jpg.
 *         https://svs.gsfc.nasa.gov/3895/
 * Rights: NASA SVS imagery is not copyrighted. Credit: NASA/GSFC SVS.
 * Content: plotted from the Bright Star, Tycho-2 and UCAC3 catalogs (~100 million
 *         stars), so the Milky Way band is real integrated starlight rather than
 *         an artistic rendering.
 *
 * ---------------------------------------------------------------------------
 * REGISTRATION
 *
 * The SVS page says the map is a plate carree projection in celestial (J2000
 * RA/Dec) coordinates, but it does not state the axis orientation or where RA
 * zero sits. Guessing is not acceptable: an all-sky texture whose registration
 * is wrong produces a sky that looks plausible and is wrong everywhere.
 *
 * So this script measures the registration instead. It high-pass filters the
 * image to leave only point sources, then runs a matched filter: for every
 * combination of axis flip and horizontal/vertical offset, it sums image
 * brightness at the pixels where the HYG catalogue says the bright stars should
 * be. The true alignment stands out as a single sharp peak tens of times above
 * chance. The measured alignment is then asserted against the expected one, so
 * a future change of source image fails the build rather than shipping a
 * silently misregistered sky.
 *
 * Measured result for starmap_8k.jpg (57x chance, no competing peak):
 *
 *     u = ((180 - raDeg) / 360) mod 1        v = (90 - decDeg) / 180
 *
 * i.e. north up, RA increasing to the LEFT, RA 0h at the horizontal centre -
 * the conventional "view from inside the celestial sphere" star-chart layout.
 *
 * Output:
 *   public/data/milkyway.webp        4096 x 2048 equirectangular
 *   public/data/milkyway.meta.json   projection, mapping, measurement report
 *
 * Usage: node scripts/build-milkyway-texture.mjs   (run build-star-catalog first)
 */
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'data');

const SOURCE_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a003800/a003895/starmap_8k.jpg';
const OUT_WIDTH = 4096;
const OUT_HEIGHT = 2048;

/** The alignment the measurement must reproduce. */
const EXPECTED = { uFlip: true, vFlip: false, shiftXDeg: 180, shiftYDeg: 0 };
/** Peak must beat the mean alignment score by at least this factor. */
const MIN_PEAK_RATIO = 10;

const DEG = Math.PI / 180;

/* ---------- J2000 equatorial -> galactic (IAU 1958 pole, J2000 values) ---------- */
const NGP_RA = 192.85948 * DEG;
const NGP_DEC = 27.12825 * DEG;
const L_NCP = 122.93192 * DEG;

function equatorialToGalactic(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const sinb =
    Math.sin(dec) * Math.sin(NGP_DEC) + Math.cos(dec) * Math.cos(NGP_DEC) * Math.cos(ra - NGP_RA);
  const b = Math.asin(Math.max(-1, Math.min(1, sinb)));
  const y = Math.cos(dec) * Math.sin(ra - NGP_RA);
  const x =
    Math.sin(dec) * Math.cos(NGP_DEC) - Math.cos(dec) * Math.sin(NGP_DEC) * Math.cos(ra - NGP_RA);
  let l = L_NCP - Math.atan2(y, x);
  l = (((l / DEG) % 360) + 360) % 360;
  return { l, b: b / DEG };
}

/** The mapping the renderer uses. Keep in sync with src/rendering/skyTexture.ts. */
export function skyToUV(raDeg, decDeg) {
  const u = ((((180 - raDeg) / 360) % 1) + 1) % 1;
  const v = (90 - decDeg) / 180;
  return { u, v };
}

async function download(url, dest) {
  try {
    const s = await stat(dest);
    if (s.size > 1000000) {
      console.log(
        `[milkyway] using cached ${path.relative(ROOT, dest)} (${(s.size / 1e6).toFixed(1)} MB)`,
      );
      return;
    }
  } catch {
    /* not cached */
  }
  console.log(`[milkyway] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`[milkyway] downloaded ${((await stat(dest)).size / 1e6).toFixed(1)} MB`);
}

async function loadBrightStars(magLimit) {
  const file = path.join(OUT, 'stars.bin');
  let buf;
  try {
    buf = await readFile(file);
  } catch {
    throw new Error(
      'public/data/stars.bin is missing. Run "npm run data:stars" first - the registration ' +
        'measurement needs the star catalogue.',
    );
  }
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const stars = [];
  for (let i = 0; i < f.length / 4; i++) {
    if (f[i * 4 + 2] < magLimit) stars.push([f[i * 4], f[i * 4 + 1]]);
  }
  return stars;
}

/**
 * Matched filter: find the axis flips and pixel offsets that put the catalogue's
 * bright stars on the image's point sources.
 */
async function measureRegistration(srcPath, stars) {
  const W = 1440;
  const H = 720;
  const base = sharp(srcPath).resize(W, H, { fit: 'fill', kernel: 'cubic' }).greyscale();
  const full = new Float32Array(await base.clone().raw().toBuffer());
  const blurred = new Float32Array(await base.clone().blur(6).raw().toBuffer());
  // High-pass: keep point sources, remove the diffuse Milky Way glow. Without this
  // every alignment that merely lands on the galactic plane scores well.
  const hp = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) hp[i] = Math.max(0, full[i] - blurred[i]);

  const results = [];
  for (const uFlip of [false, true]) {
    for (const vFlip of [false, true]) {
      const px = new Int32Array(stars.length);
      const py = new Int32Array(stars.length);
      for (let i = 0; i < stars.length; i++) {
        const [ra, dec] = stars[i];
        const u = uFlip ? 1 - ra / 360 : ra / 360;
        const v = vFlip ? (dec + 90) / 180 : (90 - dec) / 180;
        px[i] = Math.round(u * W - 0.5);
        py[i] = Math.round(v * H - 0.5);
      }
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = 0; dx < W; dx++) {
          let s = 0;
          for (let i = 0; i < stars.length; i++) {
            const y = py[i] + dy;
            if (y < 0 || y >= H) continue;
            s += hp[y * W + (((px[i] + dx) % W) + W) % W];
          }
          results.push({
            uFlip,
            vFlip,
            shiftXDeg: +((dx / W) * 360).toFixed(2),
            shiftYDeg: +((dy / H) * 180).toFixed(2),
            score: +(s / stars.length).toFixed(3),
          });
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  const meanScore = results.reduce((a, r) => a + r.score, 0) / results.length;
  const best = results[0];
  const peakRatio = best.score / meanScore;

  console.log(`[milkyway] matched filter over ${results.length} alignments, ${stars.length} stars`);
  for (const r of results.slice(0, 5)) {
    console.log(
      `    uFlip=${String(r.uFlip).padEnd(5)} vFlip=${String(r.vFlip).padEnd(5)} ` +
        `shiftX=${String(r.shiftXDeg).padStart(6)}deg shiftY=${String(r.shiftYDeg).padStart(5)}deg  score=${r.score}`,
    );
  }
  console.log(`[milkyway] peak is ${peakRatio.toFixed(1)}x the mean alignment score`);

  if (peakRatio < MIN_PEAK_RATIO) {
    throw new Error(
      `No clear alignment found (peak only ${peakRatio.toFixed(1)}x chance). The source image is ` +
        'not a registered equirectangular celestial map; refusing to ship an unregistered texture.',
    );
  }
  if (
    best.uFlip !== EXPECTED.uFlip ||
    best.vFlip !== EXPECTED.vFlip ||
    Math.abs(best.shiftXDeg - EXPECTED.shiftXDeg) > 0.5 ||
    Math.abs(best.shiftYDeg - EXPECTED.shiftYDeg) > 0.5
  ) {
    throw new Error(
      `Measured registration (uFlip=${best.uFlip}, vFlip=${best.vFlip}, ` +
        `shiftX=${best.shiftXDeg}deg, shiftY=${best.shiftYDeg}deg) differs from the expected ` +
        `mapping u=(180-ra)/360, v=(90-dec)/180. Update EXPECTED here and the renderer together.`,
    );
  }
  return { best, peakRatio: +peakRatio.toFixed(1), top: results.slice(0, 5) };
}

/**
 * Independent cross-check on the diffuse light: with the measured mapping, the
 * galactic plane must be the brightest band AND the inner Galaxy (l near 0) must
 * outshine the anticentre (l near 180). This catches a 180-degree error that a
 * symmetric great-circle test cannot see.
 */
async function checkDiffuseStructure(srcPath) {
  const W = 720;
  const H = 360;
  const data = await sharp(srcPath)
    .resize(W, H, { fit: 'fill', kernel: 'cubic' })
    .greyscale()
    .raw()
    .toBuffer();

  let planeSum = 0, planeN = 0, highSum = 0, highN = 0;
  let innerSum = 0, innerN = 0, outerSum = 0, outerN = 0;
  for (let y = 0; y < H; y++) {
    const dec = 90 - ((y + 0.5) / H) * 180;
    if (Math.abs(dec) > 70) continue; // polar smearing in an equirectangular star map
    for (let x = 0; x < W; x++) {
      // invert the mapping: u = ((180 - ra)/360) mod 1
      const u = (x + 0.5) / W;
      const ra = (((180 - u * 360) % 360) + 360) % 360;
      const { l, b } = equatorialToGalactic(ra, dec);
      const val = data[y * W + x];
      if (Math.abs(b) < 8) {
        planeSum += val;
        planeN++;
        const dl = Math.abs(((l + 180) % 360) - 180);
        if (dl < 40) { innerSum += val; innerN++; }
        else if (dl > 140) { outerSum += val; outerN++; }
      } else if (Math.abs(b) > 45) {
        highSum += val;
        highN++;
      }
    }
  }
  const plane = planeSum / planeN;
  const high = highSum / highN;
  const inner = innerSum / innerN;
  const outer = outerSum / outerN;
  console.log(
    `[milkyway] diffuse check: plane/highLat=${(plane / high).toFixed(2)}  ` +
      `inner(l<40)/anticentre(l>140)=${(inner / outer).toFixed(2)}`,
  );
  if (plane / high < 1.3) {
    throw new Error(`Galactic plane is not the brightest band (ratio ${(plane / high).toFixed(2)}).`);
  }
  if (inner / outer < 1.05) {
    throw new Error(
      `The inner Galaxy is not brighter than the anticentre (ratio ${(inner / outer).toFixed(2)}); ` +
        'the texture looks rotated by 180 degrees in galactic longitude.',
    );
  }
  return {
    planeOverHighLatitude: +(plane / high).toFixed(3),
    innerGalaxyOverAnticentre: +(inner / outer).toFixed(3),
  };
}

async function main() {
  const srcPath = path.join(CACHE, 'starmap_8k.jpg');
  await download(SOURCE_URL, srcPath);

  const meta = await sharp(srcPath).metadata();
  console.log(`[milkyway] source ${meta.width}x${meta.height}`);
  if (Math.abs(meta.width / meta.height - 2) > 0.01) {
    throw new Error(
      `Source aspect ratio ${(meta.width / meta.height).toFixed(3)} is not 2:1 - not equirectangular.`,
    );
  }

  const stars = await loadBrightStars(4.0);
  const registration = await measureRegistration(srcPath, stars);
  const diffuse = await checkDiffuseStructure(srcPath);

  await mkdir(OUT, { recursive: true });
  const outPath = path.join(OUT, 'milkyway.webp');
  await sharp(srcPath)
    .resize(OUT_WIDTH, OUT_HEIGHT, { fit: 'fill', kernel: 'lanczos3' })
    .webp({ quality: 82, effort: 6 })
    .toFile(outPath);
  const size = (await stat(outPath)).size;

  await writeFile(
    path.join(OUT, 'milkyway.meta.json'),
    JSON.stringify(
      {
        file: 'milkyway.webp',
        width: OUT_WIDTH,
        height: OUT_HEIGHT,
        projection: 'equirectangular (plate carree)',
        frame: 'equatorial J2000 (ICRS), geocentric',
        mapping: 'u = ((180 - raDeg) / 360) mod 1 ; v = (90 - decDeg) / 180',
        mappingNote:
          'North up, RA increasing to the left, RA 0h at the horizontal centre. Measured, not assumed - see registration below.',
        source:
          'NASA/Goddard Space Flight Center Scientific Visualization Studio - Deep Star Maps (SVS 3895), starmap_8k.jpg',
        sourceUrl: 'https://svs.gsfc.nasa.gov/3895/',
        rights:
          'NASA SVS imagery is not copyrighted. Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio.',
        content:
          'Plotted from the Bright Star, Tycho-2 and UCAC3 catalogs (~100 million stars). The Milky Way band is real integrated starlight, not an artistic rendering.',
        limitations:
          'Stars within about 20 degrees of the celestial poles are smeared horizontally by the projection, an artefact of the source map.',
        registration: {
          method:
            'High-pass filtered image, matched filter against HYG stars brighter than magnitude 4 over all axis flips and pixel offsets.',
          starsUsed: stars.length,
          peakOverChance: registration.peakRatio,
          best: registration.best,
          runnerUps: registration.top.slice(1),
        },
        diffuseStructureCheck: diffuse,
        generatedBy: 'scripts/build-milkyway-texture.mjs',
      },
      null,
      2,
    ),
  );

  console.log(
    `[milkyway] wrote milkyway.webp ${(size / 1e6).toFixed(2)} MB (${OUT_WIDTH}x${OUT_HEIGHT})`,
  );
}

main().catch((err) => {
  console.error('[milkyway] FAILED:', err.message);
  process.exit(1);
});
