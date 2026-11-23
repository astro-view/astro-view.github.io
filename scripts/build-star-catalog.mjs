/**
 * Build a compact static star catalog from the HYG Database.
 *
 * Source: https://github.com/astronexus/HYG-Database  (hyg/CURRENT/hygdata_v41.csv)
 * License: CC BY-SA 4.0 (David Nash / astronexus). Attribution is reproduced in
 * public/data/stars.meta.json, src/components/AttributionPanel.tsx and README.md.
 *
 * Output:
 *   public/data/stars.bin        Float32 little-endian, 4 values per star:
 *                                [raDeg(J2000), decDeg(J2000), vmag, colorIndex(B-V)]
 *   public/data/stars.meta.json  counts, magnitude limit, attribution
 *   public/data/star-names.json  proper names for the brightest stars (labels)
 *
 * Usage: node scripts/build-star-catalog.mjs [--mag 6.5]
 */
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'data');

const SOURCE_URL =
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';
const SOURCE_NAME = 'HYG Database v4.1 (hygdata_v41.csv)';

const magArgIndex = process.argv.indexOf('--mag');
const MAG_LIMIT = magArgIndex > -1 ? Number(process.argv[magArgIndex + 1]) : 6.5;
/** Stars brighter than this get a label in the UI when they have a proper name. */
const NAME_MAG_LIMIT = 3.0;

async function download(url, dest) {
  try {
    const s = await stat(dest);
    if (s.size > 1_000_000) {
      console.log(`[stars] using cached ${path.relative(ROOT, dest)} (${(s.size / 1e6).toFixed(1)} MB)`);
      return;
    }
  } catch {
    /* not cached */
  }
  console.log(`[stars] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const s = await stat(dest);
  console.log(`[stars] downloaded ${(s.size / 1e6).toFixed(1)} MB`);
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function main() {
  const csvPath = path.join(CACHE, 'hygdata_v41.csv');
  await download(SOURCE_URL, csvPath);

  const text = await readFile(csvPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const header = splitCsvLine(lines[0]);
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const required of ['ra', 'dec', 'mag', 'ci', 'proper', 'id']) {
    if (col[required] === undefined) throw new Error(`HYG column "${required}" not found`);
  }

  const stars = [];
  const named = [];
  let skippedSol = 0;
  let rejected = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = splitCsvLine(line);
    if (f.length < header.length - 2) continue;

    const id = f[col.id];
    const proper = (f[col.proper] ?? '').trim();
    // HYG row id 0 is the Sun; it is not part of the night sky.
    if (id === '0' || proper === 'Sol') {
      skippedSol++;
      continue;
    }

    const mag = Number(f[col.mag]);
    if (!Number.isFinite(mag) || mag > MAG_LIMIT) continue;

    // HYG stores ra in HOURS and dec in DEGREES, both J2000 (ICRS).
    const raHours = Number(f[col.ra]);
    const decDeg = Number(f[col.dec]);
    if (!Number.isFinite(raHours) || !Number.isFinite(decDeg)) {
      rejected++;
      continue;
    }
    if (raHours < 0 || raHours > 24 || decDeg < -90 || decDeg > 90) {
      rejected++;
      continue;
    }
    const ciRaw = Number(f[col.ci]);
    const ci = Number.isFinite(ciRaw) ? ciRaw : 0.0; // treat unknown colour as solar-ish

    const raDeg = raHours * 15;
    stars.push([raDeg, decDeg, mag, ci]);

    if (proper && mag <= NAME_MAG_LIMIT) {
      named.push({ name: proper, raDeg, decDeg, mag, con: (f[col.con] ?? '').trim() });
    }
  }

  if (stars.length < 5000) {
    throw new Error(`Only ${stars.length} stars parsed - the HYG format probably changed. Aborting rather than shipping a partial catalog.`);
  }

  // Brightest first: lets the renderer draw the important stars even if it budgets points.
  stars.sort((a, b) => a[2] - b[2]);
  named.sort((a, b) => a.mag - b.mag);

  const buf = new Float32Array(stars.length * 4);
  for (let i = 0; i < stars.length; i++) {
    buf[i * 4 + 0] = stars[i][0];
    buf[i * 4 + 1] = stars[i][1];
    buf[i * 4 + 2] = stars[i][2];
    buf[i * 4 + 3] = stars[i][3];
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, 'stars.bin'), Buffer.from(buf.buffer));
  const meta = {
    source: SOURCE_NAME,
    sourceUrl: 'https://github.com/astronexus/HYG-Database',
    license: 'CC BY-SA 4.0',
    attribution: 'HYG Database, David Nash (astronexus), CC BY-SA 4.0. Compiled from Hipparcos, Yale Bright Star Catalog and Gliese.',
    epoch: 'J2000 (ICRS)',
    magnitudeLimit: MAG_LIMIT,
    count: stars.length,
    brightestMag: stars[0][2],
    faintestMag: stars[stars.length - 1][2],
    format: 'Float32Array, little-endian, stride 4: [raDeg, decDeg, vmag, colorIndexBV]',
    generatedBy: 'scripts/build-star-catalog.mjs',
  };
  await writeFile(path.join(OUT, 'stars.meta.json'), JSON.stringify(meta, null, 2));
  await writeFile(
    path.join(OUT, 'star-names.json'),
    JSON.stringify({ attribution: meta.attribution, stars: named }, null, 0),
  );

  console.log(`[stars] wrote ${stars.length} stars (mag <= ${MAG_LIMIT}), ${named.length} named`);
  console.log(`[stars] stars.bin = ${(buf.byteLength / 1024).toFixed(0)} KB, skipped Sol x${skippedSol}, rejected ${rejected}`);
}

main().catch((err) => {
  console.error('[stars] FAILED:', err.message);
  process.exit(1);
});
