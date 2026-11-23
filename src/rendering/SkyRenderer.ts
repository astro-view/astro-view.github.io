/**
 * WebGL renderer for the camera's view of the sky.
 *
 * Structure
 *   celestialGroup   everything fixed to the celestial sphere. Its object
 *                    matrix is the EQJ -> ENU rotation for the current instant
 *                    and observer, so one matrix update rotates the entire sky.
 *                    Children live in EQJ coordinates and never move.
 *   world frame      horizon dome, horizon haze and the alt/az grid, which are
 *                    fixed to the observer rather than to the stars.
 *
 * The camera is a plain `PerspectiveCamera` whose vertical FOV and aspect come
 * straight from the sensor and focal length, which is exactly the rectilinear
 * projection a real lens produces. Changing the focal length therefore changes
 * the angular coverage rather than scaling an image.
 *
 * Nothing astronomical is recomputed per frame: `setOrientation` and
 * `setSky` write uniforms and matrices, and `render` only draws.
 */
import * as THREE from 'three';
import type { Mat3 } from '../astronomy/coordinates';
import { equatorialToVector } from '../astronomy/coordinates';
import type { StarCatalog } from '../data/catalog';
import { textureU, textureV } from './skyTexture';
import { GALACTIC_CENTRE, clamp } from '../astronomy/constants';
import { galacticToEquatorial } from '../astronomy/coordinates';

const SKY_RADIUS = 100;
const STAR_RADIUS = 99;

export interface SkyAppearance {
  /** 0..1 additive background from light pollution / twilight. */
  backgroundLevel: number;
  glowColor: [number, number, number];
  /** 0..1 multiplier on Milky Way contrast. */
  milkyWayContrast: number;
  limitingMagnitude: number;
  starGain: number;
  /** Overall gain on the Milky Way, after its tone curve. */
  milkyWayExposure: number;
  showEquatorialGrid: boolean;
  showHorizonGrid: boolean;
  showGalacticEquator: boolean;
  showMilkyWay: boolean;
}

export interface OrientationState {
  azimuth: number;
  elevation: number;
  roll: number;
  /**
   * Vertical field of view in degrees, spanning `safeHeight` pixels - NOT the
   * whole canvas. The sky is drawn edge to edge, but the optical axis sits at
   * the centre of the area the panels leave free, so the camera frame is never
   * hidden behind a dock.
   */
  fovVertical: number;
  /** Canvas pixel position of the optical axis. */
  axisX: number;
  axisY: number;
  /** The free area the field of view is measured across, in canvas pixels. */
  safeWidth: number;
  safeHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

/** B-V colour index to a linear RGB tint. Rough but monotonic and stable. */
function bvToRgb(bv: number): [number, number, number] {
  const t = clamp(bv, -0.4, 2.0);
  // Blue-white (-0.3) through yellow (0.6) to deep orange (1.8).
  const r = clamp(0.62 + 0.42 * t - 0.03 * t * t, 0, 1);
  const g = clamp(0.78 + 0.12 * t - 0.13 * t * t, 0, 1);
  const b = clamp(1.0 - 0.42 * t + 0.03 * t * t, 0, 1);
  return [r, g, b];
}

const STAR_VERTEX = /* glsl */ `
  attribute float aMag;
  attribute vec3 aColor;
  uniform float uLimitMag;
  uniform float uGain;
  uniform float uSizeScale;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    // Fade a star out over the last magnitude before the limit rather than
    // popping it off, which is what happens visually as the sky brightens.
    float vis = clamp((uLimitMag - aMag) / 1.1, 0.0, 1.0);

    // Apparent size grows slowly towards the bright end; this is the eye's /
    // sensor's response to a point source, not a physical angular diameter.
    float size = uSizeScale * (0.55 + 0.52 * max(0.0, 6.8 - aMag));
    gl_PointSize = max(1.0, size);

    vAlpha = vis * clamp(0.22 + 0.135 * (6.8 - aMag), 0.0, 1.0) * uGain;
    vColor = aColor;
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float core = exp(-r * r * 4.2);
    float halo = exp(-r * 2.2) * 0.22;
    float a = clamp((core + halo) * vAlpha, 0.0, 1.0);
    gl_FragColor = vec4(vColor * (0.6 + 0.4 * core), a);
  }
`;

const SKY_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform float uContrast;
  uniform float uBackground;
  uniform vec3 uGlow;
  uniform float uExposure;
  uniform float uBlackLevel;
  uniform float uToneGamma;
  uniform float uSaturation;
  uniform float uShowMilkyWay;
  varying vec2 vUv;

  // Cheap ordered-ish hash, used to dither away banding. The faint parts of the
  // Milky Way live in the bottom few percent of the range, where 8-bit WebP
  // steps are visible as contours once the tone curve lifts them.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec3 tex = texture2D(uMap, vUv).rgb;

    // 1. Remove the map's background pedestal. Without this the whole sky sits
    //    on a grey floor and the band has almost no contrast against it.
    vec3 t = max(vec3(0.0), tex - uBlackLevel);

    // 2. Lift the faint diffuse structure. The interesting surface brightness
    //    spans a tiny linear range, so a power curve below 1 is what makes the
    //    dust lanes and the outer band readable at all.
    vec3 milkyWay = pow(t, vec3(uToneGamma)) * uExposure;

    // 3. Saturation: integrated starlight is genuinely coloured, and the
    //    tone curve desaturates it.
    float lum = dot(milkyWay, vec3(0.2126, 0.7152, 0.0722));
    milkyWay = mix(vec3(lum), milkyWay, uSaturation);

    // 4. Light pollution reduces CONTRAST against a raised background rather
    //    than dimming the Milky Way, which is what washes it out in practice.
    milkyWay *= uContrast * uShowMilkyWay;

    vec3 glow = uGlow * uBackground;
    float dither = (hash(gl_FragCoord.xy) - 0.5) * 0.004;
    gl_FragColor = vec4(milkyWay + glow + dither, 1.0);
  }
`;

const GROUND_VERTEX = /* glsl */ `
  varying float vHeight;
  void main() {
    vHeight = normalize(position).y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GROUND_FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3 uGroundColor;
  uniform vec3 uHazeColor;
  uniform float uHaze;
  varying float vHeight;

  void main() {
    // vHeight runs 0 at the horizon to -1 at the nadir.
    float t = clamp(-vHeight, 0.0, 1.0);
    float haze = exp(-t * 26.0) * uHaze;
    vec3 col = mix(uGroundColor, uGroundColor * 0.45, smoothstep(0.0, 0.5, t)) + uHazeColor * haze;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Equirectangular sphere whose UVs follow the measured texture registration. */
function buildSkySphere(widthSegments: number, heightSegments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= heightSegments; iy++) {
    const dec = 90 - (iy / heightSegments) * 180;
    for (let ix = 0; ix <= widthSegments; ix++) {
      const ra = (ix / widthSegments) * 360;
      const v = equatorialToVector(ra, dec);
      positions.push(v[0] * SKY_RADIUS, v[1] * SKY_RADIUS, v[2] * SKY_RADIUS);
      // textureU is intentionally unwrapped so the seam stays continuous.
      uvs.push(textureU(ra), textureV(dec));
    }
  }
  const row = widthSegments + 1;
  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = iy * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

function greatCircleSegments(
  points: Array<[number, number]>,
  radius: number,
  toVector: (a: number, b: number) => readonly [number, number, number],
): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p = toVector(points[i][0], points[i][1]);
    const q = toVector(points[i + 1][0], points[i + 1][1]);
    out.push(p[0] * radius, p[1] * radius, p[2] * radius);
    out.push(q[0] * radius, q[1] * radius, q[2] * radius);
  }
  return out;
}

function enuVector(azimuth: number, altitude: number): readonly [number, number, number] {
  const az = (azimuth * Math.PI) / 180;
  const alt = (altitude * Math.PI) / 180;
  const ca = Math.cos(alt);
  return [ca * Math.sin(az), Math.sin(alt), -ca * Math.cos(az)];
}

export class SkyRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 400);
  private readonly celestialGroup = new THREE.Group();

  private skyMesh: THREE.Mesh | null = null;
  private skyMaterial: THREE.ShaderMaterial | null = null;
  private stars: THREE.Points | null = null;
  private starMaterial: THREE.ShaderMaterial | null = null;
  private equatorialGrid: THREE.LineSegments | null = null;
  private horizonGrid: THREE.LineSegments | null = null;
  private galacticEquator: THREE.LineSegments | null = null;
  private ground: THREE.Mesh | null = null;
  private groundMaterial: THREE.ShaderMaterial | null = null;
  private texture: THREE.Texture | null = null;

  private canvasWidth = 1;
  private canvasHeight = 1;
  private pixelRatio = 1;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x05070d, 1);
    this.renderer.autoClear = false;

    this.celestialGroup.matrixAutoUpdate = false;
    this.scene.add(this.celestialGroup);

    this.buildGround();
    this.buildGrids();
  }

  /* ---------------------------------------------------------------- build */

  private buildGround(): void {
    // Inside the star sphere (radius 99) so below-horizon stars are hidden by the
    // ground rather than z-fighting with it.
    const geometry = new THREE.SphereGeometry(96, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    this.groundMaterial = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERTEX,
      fragmentShader: GROUND_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: true,
      uniforms: {
        uGroundColor: { value: new THREE.Color(0x060910) },
        uHazeColor: { value: new THREE.Color(0x1d2f4d) },
        uHaze: { value: 0.5 },
      },
    });
    this.ground = new THREE.Mesh(geometry, this.groundMaterial);
    this.ground.renderOrder = 3;
    this.scene.add(this.ground);
  }

  private buildGrids(): void {
    // Equatorial grid, in EQJ coordinates (rides with the sky).
    const eqPoints: number[] = [];
    for (let dec = -75; dec <= 75; dec += 15) {
      const ring: Array<[number, number]> = [];
      for (let ra = 0; ra <= 360; ra += 3) ring.push([ra, dec]);
      eqPoints.push(...greatCircleSegments(ring, STAR_RADIUS - 1, equatorialToVector));
    }
    for (let ra = 0; ra < 360; ra += 15) {
      const line: Array<[number, number]> = [];
      for (let dec = -88; dec <= 88; dec += 3) line.push([ra, dec]);
      eqPoints.push(...greatCircleSegments(line, STAR_RADIUS - 1, equatorialToVector));
    }
    this.equatorialGrid = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(eqPoints, 3),
      ),
      new THREE.LineBasicMaterial({ color: 0x2b5c8f, transparent: true, opacity: 0.38 }),
    );
    this.equatorialGrid.visible = false;
    this.celestialGroup.add(this.equatorialGrid);

    // Galactic equator, also in EQJ.
    const galPoints: Array<[number, number]> = [];
    for (let l = 0; l <= 360; l += 2) {
      const eq = galacticToEquatorial(l, 0);
      galPoints.push([eq.raDeg, eq.decDeg]);
    }
    const galSegments: number[] = [];
    for (let i = 0; i < galPoints.length - 1; i++) {
      const a = equatorialToVector(galPoints[i][0], galPoints[i][1]);
      const b = equatorialToVector(galPoints[i + 1][0], galPoints[i + 1][1]);
      // Skip the wrap-around jump at l = 360 -> 0.
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.2) continue;
      galSegments.push(a[0] * (STAR_RADIUS - 2), a[1] * (STAR_RADIUS - 2), a[2] * (STAR_RADIUS - 2));
      galSegments.push(b[0] * (STAR_RADIUS - 2), b[1] * (STAR_RADIUS - 2), b[2] * (STAR_RADIUS - 2));
    }
    this.galacticEquator = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(galSegments, 3),
      ),
      new THREE.LineBasicMaterial({ color: 0x9a6bff, transparent: true, opacity: 0.45 }),
    );
    this.galacticEquator.visible = false;
    this.celestialGroup.add(this.galacticEquator);

    // Alt/az grid, in the world frame (fixed to the observer).
    const horPoints: number[] = [];
    for (let alt = 0; alt <= 75; alt += 15) {
      const ring: Array<[number, number]> = [];
      for (let az = 0; az <= 360; az += 3) ring.push([az, alt]);
      horPoints.push(...greatCircleSegments(ring, STAR_RADIUS - 3, enuVector));
    }
    for (let az = 0; az < 360; az += 15) {
      const line: Array<[number, number]> = [];
      for (let alt = 0; alt <= 88; alt += 3) line.push([az, alt]);
      horPoints.push(...greatCircleSegments(line, STAR_RADIUS - 3, enuVector));
    }
    this.horizonGrid = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(horPoints, 3),
      ),
      new THREE.LineBasicMaterial({ color: 0x3f8a6e, transparent: true, opacity: 0.3 }),
    );
    this.horizonGrid.visible = false;
    this.scene.add(this.horizonGrid);

    // Horizon line itself, always on.
    const horizon: Array<[number, number]> = [];
    for (let az = 0; az <= 360; az += 1) horizon.push([az, 0]);
    const horizonLine = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(greatCircleSegments(horizon, STAR_RADIUS - 2, enuVector), 3),
      ),
      new THREE.LineBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.55 }),
    );
    horizonLine.renderOrder = 4;
    this.scene.add(horizonLine);
  }

  /* --------------------------------------------------------------- inputs */

  setStarCatalog(catalog: StarCatalog): void {
    if (this.disposed) return;
    this.disposeStars();

    const n = catalog.count;
    const positions = new Float32Array(n * 3);
    const mags = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const ra = catalog.data[i * 4];
      const dec = catalog.data[i * 4 + 1];
      const mag = catalog.data[i * 4 + 2];
      const ci = catalog.data[i * 4 + 3];
      const v = equatorialToVector(ra, dec);
      positions[i * 3] = v[0] * STAR_RADIUS;
      positions[i * 3 + 1] = v[1] * STAR_RADIUS;
      positions[i * 3 + 2] = v[2] * STAR_RADIUS;
      mags[i] = mag;
      const [r, g, b] = bvToRgb(ci);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    this.starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uLimitMag: { value: 6.5 },
        uGain: { value: 1 },
        uSizeScale: { value: 1 },
      },
    });
    this.stars = new THREE.Points(geometry, this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 2;
    this.celestialGroup.add(this.stars);
  }

  setMilkyWayTexture(texture: THREE.Texture): void {
    if (this.disposed) return;
    texture.flipY = false; // our v counts down from the first image row
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    this.texture = texture;

    if (!this.skyMesh) {
      this.skyMaterial = new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uMap: { value: texture },
          uContrast: { value: 1 },
          uBackground: { value: 0.01 },
          uGlow: { value: new THREE.Color(0.32, 0.4, 0.62) },
          // Tuned against the NASA map's own statistics: its median background
          // is about 8/255 in sRGB, which is ~0.0022 once three.js decodes the
          // texture to linear. See scripts/build-milkyway-texture.mjs.
          uBlackLevel: { value: 0.0026 },
          uToneGamma: { value: 0.52 },
          uExposure: { value: 1.3 },
          uSaturation: { value: 1.35 },
          uShowMilkyWay: { value: 1 },
        },
      });
      this.skyMesh = new THREE.Mesh(buildSkySphere(256, 128), this.skyMaterial);
      this.skyMesh.renderOrder = 0;
      this.celestialGroup.add(this.skyMesh);
    } else if (this.skyMaterial) {
      this.skyMaterial.uniforms.uMap.value = texture;
    }
  }

  /** Set the EQJ -> ENU rotation for the current instant and observer. */
  setCelestialRotation(m: Mat3): void {
    const mat = new THREE.Matrix4();
    mat.set(
      m[0][0], m[0][1], m[0][2], 0,
      m[1][0], m[1][1], m[1][2], 0,
      m[2][0], m[2][1], m[2][2], 0,
      0, 0, 0, 1,
    );
    this.celestialGroup.matrix.copy(mat);
    this.celestialGroup.matrixWorldNeedsUpdate = true;
  }

  setAppearance(a: SkyAppearance): void {
    if (this.skyMaterial) {
      this.skyMaterial.uniforms.uContrast.value = a.milkyWayContrast;
      this.skyMaterial.uniforms.uBackground.value = a.backgroundLevel;
      (this.skyMaterial.uniforms.uGlow.value as THREE.Color).setRGB(
        a.glowColor[0],
        a.glowColor[1],
        a.glowColor[2],
      );
      this.skyMaterial.uniforms.uShowMilkyWay.value = a.showMilkyWay ? 1 : 0;
      this.skyMaterial.uniforms.uExposure.value = a.milkyWayExposure;
    }
    if (this.starMaterial) {
      this.starMaterial.uniforms.uLimitMag.value = a.limitingMagnitude;
      this.starMaterial.uniforms.uGain.value = a.starGain;
    }
    if (this.groundMaterial) {
      this.groundMaterial.uniforms.uHaze.value = 0.25 + a.backgroundLevel * 2.4;
      (this.groundMaterial.uniforms.uHazeColor.value as THREE.Color).setRGB(
        a.glowColor[0] * 0.5,
        a.glowColor[1] * 0.45,
        a.glowColor[2] * 0.55,
      );
    }
    if (this.equatorialGrid) this.equatorialGrid.visible = a.showEquatorialGrid;
    if (this.horizonGrid) this.horizonGrid.visible = a.showHorizonGrid;
    if (this.galacticEquator) this.galacticEquator.visible = a.showGalacticEquator;
  }

  setOrientation(o: OrientationState): void {
    // The OVERVIEW field, wider than the lens, so the view shows what is just
    // outside the frame. See src/camera/overview.ts.
    //
    // The axis is generally NOT at the canvas centre, so the frustum is
    // off-axis. `setViewOffset` expresses that: we describe a symmetric
    // virtual view centred on the axis and large enough to contain the canvas,
    // then render the canvas as a window onto it.
    const halfTan = Math.tan((clamp(o.fovVertical, 0.2, 165) / 2) * (Math.PI / 180));
    const fullW = 2 * Math.max(o.axisX, o.canvasWidth - o.axisX);
    const fullH = 2 * Math.max(o.axisY, o.canvasHeight - o.axisY);
    const fullHalfTan = (halfTan * (fullH / 2)) / Math.max(1, o.safeHeight / 2);

    this.camera.fov = clamp((2 * Math.atan(fullHalfTan) * 180) / Math.PI, 0.2, 170);
    this.camera.aspect = fullW / fullH;
    this.camera.setViewOffset(
      fullW,
      fullH,
      fullW / 2 - o.axisX,
      fullH / 2 - o.axisY,
      o.canvasWidth,
      o.canvasHeight,
    );

    // Build the view matrix from the camera basis directly: three.js lookAt
    // cannot express roll, and we want the exact same basis the projection
    // module uses for the DOM overlay.
    const az = (o.azimuth * Math.PI) / 180;
    const el = (o.elevation * Math.PI) / 180;
    const ca = Math.cos(el);
    const forward = new THREE.Vector3(ca * Math.sin(az), Math.sin(el), -ca * Math.cos(az)).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);

    let right: THREE.Vector3;
    if (Math.abs(forward.dot(worldUp)) > 0.999999) {
      const azDir = new THREE.Vector3(Math.sin(az), 0, -Math.cos(az));
      right = new THREE.Vector3().crossVectors(azDir, forward).normalize();
    } else {
      right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
    }
    let up = new THREE.Vector3().crossVectors(right, forward).normalize();

    if (o.roll !== 0) {
      const r = (o.roll * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      const nr = right.clone().multiplyScalar(c).add(up.clone().multiplyScalar(s)).normalize();
      const nu = right.clone().multiplyScalar(-s).add(up.clone().multiplyScalar(c)).normalize();
      right = nr;
      up = nu;
    }

    // three.js cameras look down -Z, so the third basis column is -forward.
    const back = forward.clone().multiplyScalar(-1);
    const m = new THREE.Matrix4().makeBasis(right, up, back);
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.setFromRotationMatrix(m);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();

    if (this.starMaterial) {
      // Keep stars readable: slightly larger when zoomed in, never huge.
      const zoom = clamp(Math.pow(45 / Math.max(1, o.fovVertical), 0.28), 0.75, 2.4);
      const density = clamp(this.canvasHeight / 760, 0.7, 2.2);
      this.starMaterial.uniforms.uSizeScale.value = zoom * density * this.pixelRatio;
    }
  }

  /**
   * Canvas size in CSS pixels. The sky fills the whole canvas; the camera frame
   * is a rectangle drawn over it by the DOM overlay, not a render viewport.
   */
  setViewport(canvasWidth: number, canvasHeight: number): void {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(canvasWidth, canvasHeight, false);
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.canvasWidth, this.canvasHeight);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.camera);
  }

  /** Direction of the Galactic Centre in EQJ, for overlay positioning. */
  static galacticCentreVector(): readonly [number, number, number] {
    return equatorialToVector(GALACTIC_CENTRE.raDeg, GALACTIC_CENTRE.decDeg);
  }

  private disposeStars(): void {
    if (this.stars) {
      this.celestialGroup.remove(this.stars);
      this.stars.geometry.dispose();
      this.stars = null;
    }
    this.starMaterial?.dispose();
    this.starMaterial = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeStars();
    if (this.skyMesh) {
      this.celestialGroup.remove(this.skyMesh);
      this.skyMesh.geometry.dispose();
      this.skyMesh = null;
    }
    this.skyMaterial?.dispose();
    this.texture?.dispose();
    for (const obj of [this.equatorialGrid, this.horizonGrid, this.galacticEquator, this.ground]) {
      if (!obj) continue;
      obj.removeFromParent();
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
    this.scene.traverse((obj: THREE.Object3D) => {
      const any = obj as THREE.Mesh;
      if (any.geometry) any.geometry.dispose();
      const mat = (any as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
