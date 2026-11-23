/**
 * Loaders for the preprocessed static datasets in `public/data`.
 *
 * Both files are produced by `scripts/build-star-catalog.mjs` and
 * `scripts/build-milkyway-texture.mjs`; neither is hand-edited. The binary star
 * catalogue is fetched once and kept as the raw Float32Array the GPU wants, so
 * there is no per-star object allocation.
 */

export interface StarCatalog {
  /** Float32, stride 4: [raDeg, decDeg, vmag, colorIndexBV]. Sorted brightest first. */
  data: Float32Array;
  count: number;
  meta: StarCatalogMeta;
}

export interface StarCatalogMeta {
  source: string;
  sourceUrl: string;
  license: string;
  attribution: string;
  epoch: string;
  magnitudeLimit: number;
  count: number;
  brightestMag: number;
  faintestMag: number;
  format: string;
}

export interface NamedStar {
  name: string;
  raDeg: number;
  decDeg: number;
  mag: number;
  con: string;
}

export interface MilkyWayMeta {
  file: string;
  width: number;
  height: number;
  projection: string;
  frame: string;
  mapping: string;
  mappingNote: string;
  source: string;
  sourceUrl: string;
  rights: string;
  content: string;
  limitations: string;
  registration: unknown;
}

const base = import.meta.env.BASE_URL ?? '/';
const dataUrl = (file: string): string => `${base.replace(/\/$/, '')}/data/${file}`;

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(dataUrl(file));
  if (!res.ok) throw new Error(`Could not load ${file}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

let catalogPromise: Promise<StarCatalog> | null = null;

export function loadStarCatalog(): Promise<StarCatalog> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const [meta, binRes] = await Promise.all([
        fetchJson<StarCatalogMeta>('stars.meta.json'),
        fetch(dataUrl('stars.bin')),
      ]);
      if (!binRes.ok) throw new Error(`Could not load stars.bin: HTTP ${binRes.status}`);
      const buffer = await binRes.arrayBuffer();
      const data = new Float32Array(buffer);
      const count = data.length / 4;
      if (!Number.isInteger(count) || count !== meta.count) {
        throw new Error(
          `Star catalogue is corrupt: ${count} records in stars.bin but metadata claims ${meta.count}.`,
        );
      }
      return { data, count, meta };
    })();
  }
  return catalogPromise;
}

let namesPromise: Promise<NamedStar[]> | null = null;

export function loadStarNames(): Promise<NamedStar[]> {
  if (!namesPromise) {
    namesPromise = fetchJson<{ stars: NamedStar[] }>('star-names.json').then((j) => j.stars);
  }
  return namesPromise;
}

let milkyWayMetaPromise: Promise<MilkyWayMeta> | null = null;

export function loadMilkyWayMeta(): Promise<MilkyWayMeta> {
  if (!milkyWayMetaPromise) milkyWayMetaPromise = fetchJson<MilkyWayMeta>('milkyway.meta.json');
  return milkyWayMetaPromise;
}

export function milkyWayTextureUrl(): string {
  return dataUrl('milkyway.webp');
}
