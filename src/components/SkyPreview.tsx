/**
 * The sky view.
 *
 * This fills the whole window and is the background everything else floats
 * over, so it owns only the sky itself: the WebGL canvas, the camera frame
 * rectangle, the labels, and the warnings that belong to the rendering. All
 * other chrome lives in the overlay layer in App.tsx.
 *
 * The canvas renders a WIDER field than the lens captures, and the camera frame
 * is drawn over it as a rectangle, so you can see what is just outside the
 * frame while composing. Both views share one optical axis and one rectilinear
 * projection (see src/camera/overview.ts), so the rectangle marks exactly what
 * the lens would record.
 *
 * The DOM overlay uses the SAME projection module as the renderer's camera, so
 * a label and the star it names cannot drift apart.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { clsx } from 'clsx';
import { Crosshair, Loader2, TriangleAlert } from 'lucide-react';
import { SkyRenderer } from '../rendering/SkyRenderer';
import {
  type NamedStar,
  loadStarCatalog,
  loadStarNames,
  milkyWayTextureUrl,
} from '../data/catalog';
import { projectToFrame } from '../camera/projection';
import { computeOverview } from '../camera/overview';
import { RECTILINEAR_PRACTICAL_FOV_DEG } from '../camera/sensors';
import {
  type Vec3,
  equatorialToVector,
  multiplyMatrixVector,
  enuFromHorizontal,
} from '../astronomy/coordinates';
import { CARDINALS, DEG2RAD, GALACTIC_CENTRE } from '../astronomy/constants';
import type { AstroViewState } from '../hooks/useAstroView';

interface OverlayMarker {
  key: string;
  label: string;
  /** Pixel position inside the canvas. */
  x: number;
  y: number;
  kind: 'cardinal' | 'star' | 'gc' | 'moon' | 'sun';
  detail?: string;
  /** True when the lens would actually capture this direction. */
  inFrame: boolean;
}

const GC_VECTOR = equatorialToVector(GALACTIC_CENTRE.raDeg, GALACTIC_CENTRE.decDeg);

/**
 * Pixels along each edge that the floating docks cover. The sky still renders
 * edge to edge; this only says where the camera frame may sit.
 */
export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function SkyPreview({
  state,
  insets = NO_INSETS,
}: {
  state: AstroViewState;
  insets?: SafeAreaInsets;
}) {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<SkyRenderer | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [names, setNames] = useState<NamedStar[]>([]);
  const [dragging, setDragging] = useState(false);

  const { camera, fov, basis, celestialMatrix, skyState, renderParameters, overlays } = state;

  /**
   * The area the docks leave free. The sky fills the whole canvas, but the
   * optical axis and the camera frame live here, so the frame is never hidden
   * behind a panel.
   */
  const safe = useMemo(() => {
    const left = insets.left;
    const top = insets.top;
    const width = Math.max(120, size.width - insets.left - insets.right);
    const height = Math.max(120, size.height - insets.top - insets.bottom);
    return { left, top, width, height, centreX: left + width / 2, centreY: top + height / 2 };
  }, [insets, size.width, size.height]);

  /** The wider field shown across the safe area, and the lens' frame inside it. */
  const overview = useMemo(
    () => computeOverview(fov, safe.width, safe.height),
    [fov, safe.width, safe.height],
  );

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
          ? `WebGL could not be initialised in this browser. The sky view needs WebGL; everything else on this page still works. (${detail})`
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

  /* ------------------------------------------------------ size and layout */

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const width = Math.max(1, el.clientWidth);
    const height = Math.max(1, el.clientHeight);
    setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    rendererRef.current?.setViewport(width, height);
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  /* ---------------------------------------------------- push state to GL */

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setViewport(size.width, size.height);
    r.setCelestialRotation(celestialMatrix);
    r.setAppearance({
      backgroundLevel: renderParameters.backgroundLevel,
      glowColor: renderParameters.glowColor,
      milkyWayContrast: renderParameters.milkyWayContrast,
      milkyWayExposure: renderParameters.milkyWayExposure,
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
      fovVertical: overview.fov.vertical,
      axisX: safe.centreX,
      axisY: safe.centreY,
      safeWidth: safe.width,
      safeHeight: safe.height,
      canvasWidth: size.width,
      canvasHeight: size.height,
    });
    r.render();
  }, [celestialMatrix, renderParameters, overlays, camera, overview, safe, size, status]);

  /* ------------------------------------------- drag to aim, wheel to zoom */

  /**
   * Pointer handlers read everything they need from this ref.
   *
   * They must NOT close over `state` or `fov`: those identities change on every
   * render, so an effect depending on them would tear the listeners down and
   * rebuild them after the first pointermove - which silently kills the drag
   * halfway through.
   */
  const interaction = useRef({
    width: 1,
    height: 1,
    overviewHorizontal: 60,
    overviewVertical: 40,
    elevation: 0,
    focalLength: 35,
    nudge: (_dAz: number, _dEl: number) => {},
    setFocal: (_f: number) => {},
  });

  interaction.current.width = safe.width;
  interaction.current.height = safe.height;
  interaction.current.overviewHorizontal = overview.fov.horizontal;
  interaction.current.overviewVertical = overview.fov.vertical;
  interaction.current.elevation = camera.elevation;
  interaction.current.focalLength = camera.focalLength;
  interaction.current.nudge = state.nudgeOrientation;
  interaction.current.setFocal = (f: number) => state.updateCamera({ focalLength: f });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let pointerId = -1;
    let lastX = 0;
    let lastY = 0;

    const down = (e: PointerEvent) => {
      if (e.button !== 0 || pointerId !== -1) return;
      pointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      setDragging(true);
    };

    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const i = interaction.current;
      const dxFraction = (e.clientX - lastX) / Math.max(1, i.width);
      const dyFraction = (e.clientY - lastY) / Math.max(1, i.height);
      lastX = e.clientX;
      lastY = e.clientY;

      // Scale by the field actually on screen, so a drag moves the sky by the
      // same fraction of the view at every focal length. Dividing azimuth by
      // cos(elevation) keeps the motion under the cursor roughly one-to-one
      // when the camera is pitched up, where lines of azimuth converge.
      const cosEl = Math.max(0.12, Math.cos(i.elevation * DEG2RAD));
      i.nudge((-dxFraction * i.overviewHorizontal) / cosEl, dyFraction * i.overviewVertical);
    };

    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      pointerId = -1;
      setDragging(false);
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const i = interaction.current;
      i.setFocal(i.focalLength * Math.exp(-e.deltaY * 0.0014));
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      el.removeEventListener('wheel', wheel);
    };
    // Deliberately empty: everything mutable is read from `interaction`.
  }, []);

  /** Keyboard aiming, for people who would rather not drag. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case 'ArrowLeft':
          state.nudgeOrientation(-step, 0);
          break;
        case 'ArrowRight':
          state.nudgeOrientation(step, 0);
          break;
        case 'ArrowUp':
          state.nudgeOrientation(0, step);
          break;
        case 'ArrowDown':
          state.nudgeOrientation(0, -step);
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    [state],
  );

  /* --------------------------------------------------------- DOM overlay */

  const markers = useMemo<OverlayMarker[]>(() => {
    if (!overlays.labels) return [];
    const out: OverlayMarker[] = [];
    const place = (
      key: string,
      label: string,
      direction: Vec3,
      kind: OverlayMarker['kind'],
      detail?: string,
    ) => {
      const wide = projectToFrame(direction, basis, overview.fov);
      if (!wide.inFrame) return;
      // Whether the LENS captures it, as opposed to merely being on screen.
      const lens = projectToFrame(direction, basis, fov);
      out.push({
        key,
        label,
        x: safe.centreX + wide.x * (safe.width / 2),
        y: safe.centreY - wide.y * (safe.height / 2),
        kind,
        detail,
        inFrame: lens.inFrame,
      });
    };

    for (const c of CARDINALS) {
      if (!c.major && overview.fov.horizontal > 90) continue;
      place(`cardinal-${c.label}`, c.label, enuFromHorizontal(c.azimuth, 0), 'cardinal');
    }

    place(
      'gc',
      'Galactic Centre',
      multiplyMatrixVector(celestialMatrix, GC_VECTOR),
      'gc',
      `alt ${skyState.galacticCentre.altitude.toFixed(1)}°`,
    );

    if (skyState.moon.altitude > -2) {
      place(
        'moon',
        'Moon',
        enuFromHorizontal(skyState.moon.azimuth, skyState.moon.altitude),
        'moon',
        `${(skyState.moon.illumination * 100).toFixed(0)}% lit`,
      );
    }
    if (skyState.sun.altitude > -8) {
      place('sun', 'Sun', enuFromHorizontal(skyState.sun.azimuth, skyState.sun.altitude), 'sun');
    }

    const magLimit = Math.min(
      renderParameters.limitingMagnitude,
      overview.fov.horizontal > 70 ? 1.9 : 3.0,
    );
    let shown = 0;
    for (const s of names) {
      if (shown >= 16) break;
      if (s.mag > magLimit) continue;
      const enu = multiplyMatrixVector(celestialMatrix, equatorialToVector(s.raDeg, s.decDeg));
      if (enu[1] < -0.02) continue;
      const before = out.length;
      place(`star-${s.name}`, s.name, enu, 'star', `m ${s.mag.toFixed(2)}`);
      if (out.length > before) shown++;
    }
    return out;
  }, [
    overlays.labels,
    basis,
    fov,
    overview.fov,
    safe,
    celestialMatrix,
    skyState,
    names,
    renderParameters.limitingMagnitude,
  ]);

  const frameStyle = {
    width: overview.frameWidth,
    height: overview.frameHeight,
    left: safe.centreX - overview.frameWidth / 2,
    top: safe.centreY - overview.frameHeight / 2,
  } as const;

  const extremeWideAngle = fov.horizontal > RECTILINEAR_PRACTICAL_FOV_DEG;

  return (
    <div className="absolute inset-0 overflow-hidden bg-void">
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label="Sky view. Drag or use the arrow keys to aim the camera."
        onKeyDown={onKeyDown}
        className={clsx(
          'absolute inset-0 touch-none outline-none',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <div ref={canvasHostRef} className="h-full w-full" />
      </div>

      {/* Camera frame: everything outside it is dimmed, so the frame reads as
          the capture area while the surrounding sky stays visible. It is hidden
          when the lens is wider than the view itself, because a rectangle
          clipped to the window edge would wrongly say "all of this is in frame". */}
      {overlays.frameGuides && status !== 'error' && !overview.frameExceedsView && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div
            className="absolute border border-accent/70"
            style={{ ...frameStyle, boxShadow: '0 0 0 9999px rgba(5, 7, 13, 0.5)' }}
          >
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="border border-accent/[0.08]" />
              ))}
            </div>
            <Crosshair
              size={16}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-accent/60"
            />
            <span className="absolute -left-px -top-px h-3.5 w-3.5 border-l-2 border-t-2 border-accent" />
            <span className="absolute -right-px -top-px h-3.5 w-3.5 border-r-2 border-t-2 border-accent" />
            <span className="absolute -bottom-px -left-px h-3.5 w-3.5 border-b-2 border-l-2 border-accent" />
            <span className="absolute -bottom-px -right-px h-3.5 w-3.5 border-b-2 border-r-2 border-accent" />
          </div>
        </div>
      )}

      {/* Labels, positioned in the wider view */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {markers.map((m) => (
          <div
            key={m.key}
            className={clsx(
              'absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap transition-opacity',
              m.inFrame ? 'opacity-100' : 'opacity-45',
            )}
            style={{ left: m.x, top: m.y }}
          >
            {m.kind === 'gc' ? (
              <div className="flex flex-col items-center">
                <span className="relative block h-4 w-4 rounded-full border border-warn/90">
                  <span className="absolute inset-0 animate-pulseRing rounded-full border border-warn/60" />
                </span>
                <span className="mt-1 rounded bg-void/70 px-1 py-px text-2xs font-semibold text-warn">
                  {m.label}
                  {m.detail && <span className="ml-1 font-normal text-warn/70">{m.detail}</span>}
                </span>
              </div>
            ) : m.kind === 'cardinal' ? (
              // Lifted clear of the horizon line it marks, so it reads as a
              // label on the horizon rather than a tag sliced by it.
              <span className="-mt-3 block rounded border border-accent/30 bg-void/75 px-1.5 py-px text-2xs font-bold tracking-wider text-accent2">
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
              <span className="rounded bg-void/55 px-1 text-2xs text-muted">{m.label}</span>
            )}
          </div>
        ))}
      </div>

      {/* A moonlit sky is legitimately almost empty. Say so, so it does not
          read as a failure to render anything. */}
      {status === 'ready' && state.brightness.moonPenaltyMag > 1 && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/[0.07] bg-[#080b14]/70 px-2.5 py-1 text-2xs text-warn backdrop-blur-md"
          style={{ left: safe.centreX, top: safe.centreY + overview.frameHeight / 2 + 14 }}
        >
          Moonlight is washing out the Milky Way
        </div>
      )}

      {(extremeWideAngle || overview.frameExceedsView) && status === 'ready' && (
        <div
          className={clsx(
            'pointer-events-none absolute left-1/2 top-16 max-w-sm -translate-x-1/2 rounded-lg',
            'border border-warn/40 bg-panel/90 px-3 py-2 text-2xs leading-relaxed text-warn backdrop-blur-md',
          )}
        >
          {overview.frameExceedsView && (
            <>
              <strong>The frame is wider than this view.</strong> The rectangle is hidden rather
              than clipped to the edge, which would wrongly suggest everything visible is
              captured.{' '}
            </>
          )}
          {extremeWideAngle && (
            <>
              {fov.horizontal.toFixed(0)}&deg; horizontal: a rectilinear projection stretches badly
              past about {RECTILINEAR_PRACTICAL_FOV_DEG}&deg;, and real lenses this wide are
              fisheyes, which project differently. The geometry is still exact on the optical axis.
            </>
          )}
        </div>
      )}

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
              <span className="text-xs font-semibold">Sky view unavailable</span>
            </div>
            <p className="text-2xs leading-relaxed text-muted">{errorMessage}</p>
          </div>
        </div>
      )}

      {status === 'ready' && errorMessage && !extremeWideAngle && !overview.frameExceedsView && (
        <div className="pointer-events-none absolute left-1/2 top-16 max-w-sm -translate-x-1/2 rounded-lg border border-warn/40 bg-panel/90 px-3 py-2 text-2xs text-warn backdrop-blur-md">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
