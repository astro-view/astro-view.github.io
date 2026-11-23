/**
 * Mapping between celestial coordinates and the all-sky texture's UV space.
 *
 * This MUST stay in sync with `scripts/build-milkyway-texture.mjs`, which
 * measures the registration of the source image and refuses to build if it
 * changes. The measured mapping for NASA SVS "Deep Star Maps" starmap_8k.jpg is
 *
 *     u = ((180 - raDeg) / 360) mod 1
 *     v = (90 - decDeg) / 180        (v = 0 is the FIRST ROW of the image)
 *
 * i.e. north up, right ascension increasing to the left, RA 0h at the
 * horizontal centre. Because v counts down from the top, the texture is
 * uploaded with `flipY = false` so UV (0,0) is the image's top-left corner.
 *
 * The u expression is deliberately NOT wrapped when used for geometry UVs:
 * letting u run continuously past 0 and 1 with a repeating wrap mode removes
 * the seam that a modulo would create.
 */

/** Continuous u for sphere geometry: runs 0.5 down to -0.5 as RA goes 0 -> 360. */
export function textureU(raDeg: number): number {
  return (180 - raDeg) / 360;
}

/** v for sphere geometry, 0 at Dec +90 (first image row) to 1 at Dec -90. */
export function textureV(decDeg: number): number {
  return (90 - decDeg) / 180;
}

/** Wrapped UV, for sampling or testing a single direction. */
export function skyToUV(raDeg: number, decDeg: number): { u: number; v: number } {
  return { u: ((textureU(raDeg) % 1) + 1) % 1, v: textureV(decDeg) };
}

/** Inverse of {@link skyToUV}. */
export function uvToSky(u: number, v: number): { raDeg: number; decDeg: number } {
  const ra = ((((180 - u * 360) % 360) + 360) % 360);
  return { raDeg: ra, decDeg: 90 - v * 180 };
}
