/**
 * The camera's view of the sky: a WebGL canvas showing the frame, plus a DOM
 * overlay for labels and guides.
 *
 * The overlay uses the SAME projection module as the renderer's camera, so a
 * label and the star it names cannot drift apart: both come from
 * `projectToFrame` with the identical basis and field of view.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { clsx } from 'clsx';
import { Crosshair, Expand, Loader2, Minimize2, MousePointer2, TriangleAlert } from 'lucide-react';
import { SkyRenderer, type FrameRect } from '../rendering/SkyRenderer';
import {
  type NamedStar,
  loadStarCatalog,
  loadStarNames,
  milkyWayTextureUrl,
} from '../data/catalog';
import { projectToFrame, dragToOrientationDelta } from '../camera/projection';
import {
  type Vec3,
  equatorialToVector,
  multiplyMatrixVector,
  enuFromHorizontal,
} from '../astronomy/coordinates';
import { CARDINALS, GALACTIC_CENTRE } from '../astronomy/constants';
import type { AstroViewState } from '../hooks/useAstroView';
import { Button } from './ui/primitives';

interface OverlayMarker {
  key: string;
  label: string;
  x: number;
  y: number;
  kind: 'cardinal' | 'star' | 'gc' | 'moon' | 'sun';
  detail?: string;
}

const GC_VECTOR = equatorialToVector(GALACTIC_CENTRE.raDeg, GALACTIC_CENTRE.decDeg);

export function SkyPreview({ state }: { state: AstroViewState }) {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<SkyRenderer | null>(null);
  const [frame, setFrame] = useState<FrameRect>({ x: 0, y: 0, width: 1, height: 1 });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [names, setNames] = useState<NamedStar[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const { camera, fov, basis, celestialMatrix, skyState, renderParameters, overlays } = state;

  /* ------------------------------------------------------- renderer setup */

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    // A fresh canvas per mount. Disposing a WebGLRenderer permanently loses its
    // canvas' context, so reusing one JSX-owned <canvas> would break on the
    // second mount - which StrictMode always does in development.
    const canvas = document.createElement('canvas');
    canvas.className = 'block h-full w-full';
    host.replaceChildren(canvas);

    let renderer: SkyRenderer;
    try {
      renderer = new SkyRenderer(canvas);
    } catch (err) {
      setStatus('error');
      const detail = err instanceof Error ? err.message : String(err);
      setErrorMessage(
        /webgl|context/i.test(detail)
          ? `WebGL could not be initialised in this browser. The sky preview needs WebGL; everything else on this page still works. (${detail})`
          : `The sky renderer failed to start: ${detail}`,
      );
      return;
    }
    rendererRef.current = renderer;

    let cancelled = false;
    (async () => {
      try {
        const catalog = await loadStarCatalog();
        if (cancelled) return;
        renderer.setStarCatalog(catalog);

        const texture = await new Promise<THREE.Texture | null>((resolve) => {
          new THREE.TextureLoader().load(
            milkyWayTextureUrl(),
            (t: THREE.Texture) => resolve(t),
            undefined,
            () => resolve(null),
          );
        });
        if (cancelled) return;
        if (texture) {
          renderer.setMilkyWayTexture(texture);
        } else {
          setErrorMessage(
            'The Milky Way texture could not be loaded. Stars are shown at their correct positions; the diffuse Milky Way is missing.',
          );
        }
        setStatus('ready');
        loadStarNames().then((n) => !cancelled && setNames(n));
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(
          err instanceof Error ? err.message : 'The star catalogue could not be loaded.',
        );
      }
    })();

    return () => {
      cancelled = true;
      renderer.dispose();
      rendererRef.current = null;
      canvas.remove();
    };
  }, []);

  /* ----------------------------------------------- layout and frame rect */

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const aspect = fov.aspect;
    // Letterbox the camera frame inside the available area, with a small margin.
    const availW = w - 24;
    const availH = h - 24;
    let fw = availW;
    let fh = fw / aspect;
    if (fh > availH) {
      fh = availH;
      fw = fh * aspect;
    }
    setFrame({
      x: Math.round((w - fw) / 2),
      y: Math.round((h - fh) / 2),
      width: Math.max(1, Math.round(fw)),
      height: Math.max(1, Math.round(fh)),
    });
    rendererRef.current?.setViewport(w, h, {
      x: Math.round((w - fw) / 2),
      y: Math.round((h - fh) / 2),
      width: Math.max(1, Math.round(fw)),
      height: Math.max(1, Math.round(fh)),
    });
  }, [fov.aspect]);

  useLayoutEffect(() => {
    measure();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    measure();
  }, [fullscreen, measure]);

  /* ---------------------------------------------------- push state to GL */

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setCelestialRotation(celestialMatrix);
    r.setAppearance({
      backgroundLevel: renderParameters.backgroundLevel,
      glowColor: renderParameters.glowColor,
      milkyWayContrast: renderParameters.milkyWayContrast,
      limitingMagnitude: renderParameters.limitingMagnitude,
      starGain: renderParameters.starGain,
      showEquatorialGrid: overlays.equatorialGrid,
      showHorizonGrid: overlays.horizonGrid,
      showGalacticEquator: overlays.galacticEquator,
      showMilkyWay: overlays.milkyWay,
    });
    r.setOrientation({
      azimuth: camera.azimuth,
      elevation: camera.elevation,
      roll: camera.roll,
      fovVertical: fov.vertical,
      aspect: fov.aspect,
    });
    r.render();
  }, [celestialMatrix, renderParameters, overlays, camera, fov, frame, status]);

  /* ------------------------------------------------------ drag to look around */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let active = false;
    let lastX = 0;
    let lastY = 0;
    let pointerId = -1;

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      active = true;
      pointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      setDragging(true);
    };
    const move = (e: PointerEvent) => {
      if (!active || e.pointerId !== pointerId) return;
      const dx = (e.clientX - lastX) / Math.max(1, frame.width);
      const dy = (e.clientY - lastY) / Math.max(1, frame.height);
      lastX = e.clientX;
      lastY = e.clientY;
      const delta = dragToOrientationDelta(dx, dy, fov, state.camera.elevation);
      state.nudgeOrientation(delta.dAzimuth, delta.dElevation);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      active = false;
      pointerId = -1;
      setDragging(false);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0014);
      state.updateCamera({ focalLength: state.camera.focalLength * factor });
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [frame.width, frame.height, fov, state]);

  /* --------------------------------------------------------- DOM overlay */

  const markers = useMemo<OverlayMarker[]>(() => {
    if (!overlays.labels) return [];
    const out: OverlayMarker[] = [];
    const push = (
      key: string,
      label: string,
      direction: Vec3,
      kind: OverlayMarker['kind'],
      detail?: string,
    ) => {
      const p = projectToFrame(direction, basis, fov);
      if (!p.inFrame) return;
      out.push({ key, label, x: (p.x + 1) / 2, y: (1 - p.y) / 2, kind, detail });
    };

    for (const c of CARDINALS) {
      if (!c.major && fov.horizontal > 60) continue;
      push(`cardinal-${c.label}`, c.label, enuFromHorizontal(c.azimuth, 0), 'cardinal');
    }

    const gcEnu = multiplyMatrixVector(celestialMatrix, GC_VECTOR);
    push(
      'gc',
      'Galactic Centre',
      gcEnu,
      'gc',
      `alt ${skyState.galacticCentre.altitude.toFixed(1)}°`,
    );

    if (skyState.moon.altitude > -2) {
      push(
        'moon',
        'Moon',
        enuFromHorizontal(skyState.moon.azimuth, skyState.moon.altitude),
        'moon',
        `${(skyState.moon.illumination * 100).toFixed(0)}% lit`,
      );
    }
    if (skyState.sun.altitude > -8) {
      push('sun', 'Sun', enuFromHorizontal(skyState.sun.azimuth, skyState.sun.altitude), 'sun');
    }

    // Named stars, brightest first, capped so the frame never fills with text.
    const magLimit = Math.min(renderParameters.limitingMagnitude, fov.horizontal > 50 ? 1.9 : 3.0);
    let shown = 0;
    for (const s of names) {
      if (shown >= 14) break;
      if (s.mag > magLimit) continue;
      const enu = multiplyMatrixVector(celestialMatrix, equatorialToVector(s.raDeg, s.decDeg));
      if (enu[1] < -0.02) continue;
      const before = out.length;
      push(`star-${s.name}`, s.name, enu, 'star', `m ${s.mag.toFixed(2)}`);
      if (out.length > before) shown++;
    }
    return out;
  }, [overlays.labels, basis, fov, celestialMatrix, skyState, names, renderParameters.limitingMagnitude]);

  const frameStyle = {
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
  } as const;

  return (
    <div
      className={clsx(
        'relative min-h-0 overflow-hidden rounded-lg border border-edge bg-void',
        fullscreen && 'fixed inset-0 z-50 rounded-none border-0',
      )}
    >
      <div
        ref={containerRef}
        className={clsx('absolute inset-0 touch-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
      >
        <div ref={canvasHostRef} className="h-full w-full" />
      </div>

      {/* Frame border + guides */}
      {overlays.frameGuides && status !== 'error' && (
        <div
          className="pointer-events-none absolute border border-accent/45"
          style={frameStyle}
          aria-hidden
        >
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="border border-accent/[0.07]" />
            ))}
          </div>
          <Crosshair
            size={16}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-accent/55"
          />
          {(['-left-px -top-px', '-right-px -top-px', '-left-px -bottom-px', '-right-px -bottom-px'] as const).map(
            (pos) => (
              <span key={pos} className={clsx('absolute h-3 w-3 border-accent', pos)} />
            ),
          )}
        </div>
      )}

      {/* Labels */}
      <div className="pointer-events-none absolute" style={frameStyle} aria-hidden>
        {markers.map((m) => (
          <div
            key={m.key}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
          >
            {m.kind === 'gc' ? (
              <div className="flex -translate-y-0 flex-col items-center">
                <span className="relative block h-4 w-4 rounded-full border border-warn/90">
                  <span className="absolute inset-0 animate-pulseRing rounded-full border border-warn/60" />
                </span>
                <span className="mt-1 rounded bg-void/70 px-1 py-px text-2xs font-semibold text-warn">
                  {m.label}
                  {m.detail && <span className="ml-1 font-normal text-warn/70">{m.detail}</span>}
                </span>
              </div>
            ) : m.kind === 'cardinal' ? (
              <span className="rounded border border-accent/30 bg-void/75 px-1.5 py-px text-2xs font-bold tracking-wider text-accent2">
                {m.label}
              </span>
            ) : m.kind === 'moon' || m.kind === 'sun' ? (
              <div className="flex flex-col items-center">
                <span
                  className={clsx(
                    'block h-3 w-3 rounded-full border',
                    m.kind === 'moon' ? 'border-ink/70 bg-ink/30' : 'border-warn bg-warn/40',
                  )}
                />
                <span className="mt-0.5 rounded bg-void/70 px-1 text-2xs text-ink/80">
                  {m.label}
                  {m.detail && <span className="ml-1 text-dim">{m.detail}</span>}
                </span>
              </div>
            ) : (
              <span className="rounded bg-void/55 px-1 text-2xs text-muted">
                {m.label}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Frame readout */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
        <div className="numeric rounded border border-edge bg-panel/85 px-2 py-1 text-2xs text-muted backdrop-blur">
          <span className="text-ink">{camera.focalLength.toFixed(0)}mm</span>
          <span className="mx-1.5 text-edge2">|</span>
          {fov.horizontal.toFixed(1)}&deg; &times; {fov.vertical.toFixed(1)}&deg;
          <span className="mx-1.5 text-edge2">|</span>
          {state.sensor.name}
        </div>
        <div className="numeric rounded border border-edge bg-panel/85 px-2 py-1 text-2xs text-muted backdrop-blur">
          az <span className="text-ink">{camera.azimuth.toFixed(1)}&deg;</span>
          <span className="mx-1.5 text-edge2">|</span>
          alt <span className="text-ink">{camera.elevation.toFixed(1)}&deg;</span>
          <span className="mx-1.5 text-edge2">|</span>
          roll <span className="text-ink">{camera.roll.toFixed(1)}&deg;</span>
        </div>
      </div>

      <div className="absolute right-3 top-3 flex items-center gap-1.5">
        <span className="numeric pointer-events-none rounded border border-edge bg-panel/85 px-2 py-1 text-2xs text-muted backdrop-blur">
          SQM {state.brightness.effectiveSqm.toFixed(2)} &middot; Bortle{' '}
          {state.brightness.bortle.bortle}
        </span>
        <Button size="sm" onClick={() => setFullscreen((f) => !f)} title="Toggle fullscreen">
          {fullscreen ? <Minimize2 size={12} /> : <Expand size={12} />}
        </Button>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 text-2xs text-dim">
        <MousePointer2 size={11} />
        drag to aim &middot; scroll to zoom the lens
      </div>

      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-void/70">
          <span className="flex items-center gap-2 text-xs text-muted">
            <Loader2 size={14} className="animate-spin" />
            Loading star catalogue and sky texture&hellip;
          </span>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-bad/40 bg-panel p-4">
            <div className="mb-2 flex items-center gap-2 text-bad">
              <TriangleAlert size={14} />
              <span className="text-xs font-semibold">Sky preview unavailable</span>
            </div>
            <p className="text-2xs leading-relaxed text-muted">{errorMessage}</p>
          </div>
        </div>
      )}

      {status === 'ready' && errorMessage && (
        <div className="absolute bottom-3 right-3 max-w-xs rounded border border-warn/40 bg-panel/90 px-2 py-1.5 text-2xs text-warn backdrop-blur">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
