/**
 * Application shell.
 *
 * The sky fills the window; two docks float over it:
 *
 *   right   one scrolling column - place, time, camera, sun, moon, overlays
 *   bottom  the night timeline and planner, spanning the space left of it
 *
 * Two docks rather than four scattered cards, so everything lines up against
 * the same two edges and nothing overlaps. The whole left side stays sky.
 *
 * The dock containers are `pointer-events-none`; only the panels themselves
 * accept events, so dragging the sky still works around them. Below `lg` the
 * docks become one bottom sheet, leaving the sky visible behind it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Aperture,
  Clock,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Moon,
  Sliders,
  Telescope,
} from 'lucide-react';
import { useAstroView } from './hooks/useAstroView';
import { SkyPreview, type SafeAreaInsets } from './components/SkyPreview';
import { ControlPanel } from './components/ControlPanel';
import { Timeline } from './components/Timeline';
import { AttributionButton } from './components/AttributionPanel';
import { Button, Pill } from './components/ui/primitives';
import { DockPanel, GLASS, HudChip, HudSep, HudValue } from './components/ui/Dock';
import { localTimeString } from './astronomy/time';

/** Right dock width, and the gutter the bottom dock must leave for it. */
const DOCK_W = '22rem';

export default function App() {
  const state = useAstroView();

  const [controlsOpen, setControlsOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  /** `H` clears the panels so the sky can be judged on its own. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === 'h' || e.key === 'H') setChromeHidden((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().then(
        () => setFullscreen(true),
        () => undefined,
      );
    } else {
      document.exitFullscreen?.().then(
        () => setFullscreen(false),
        () => undefined,
      );
    }
  }, []);

  /**
   * Measure the docks so the camera frame can be centred in the area they
   * leave free. Measured rather than hard-coded, because a dock's height
   * changes when it is collapsed or when its content wraps.
   */
  const rightDockRef = useRef<HTMLDivElement | null>(null);
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const [insets, setInsets] = useState<SafeAreaInsets>({ top: 52, right: 0, bottom: 0, left: 12 });

  useLayoutEffect(() => {
    const measure = () => {
      const wide = window.matchMedia('(min-width: 1024px)').matches;
      if (chromeHidden || !wide) {
        setInsets({ top: 0, right: 0, bottom: 0, left: 0 });
        return;
      }
      const right = rightDockRef.current?.getBoundingClientRect();
      const bottom = bottomDockRef.current?.getBoundingClientRect();
      setInsets({
        top: 52,
        right: right ? Math.max(0, window.innerWidth - right.left) + 12 : 0,
        bottom: bottom ? Math.max(0, window.innerHeight - bottom.top) + 12 : 0,
        left: 12,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (rightDockRef.current) ro.observe(rightDockRef.current);
    if (bottomDockRef.current) ro.observe(bottomDockRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [chromeHidden, controlsOpen, timelineOpen]);

  const { camera, fov, skyState, brightness } = state;
  const dark = skyState.astronomicallyDark;
  const coreAlt = skyState.galacticCentre.altitude;
  const coreTone = coreAlt > 10 ? 'good' : coreAlt > 0 ? 'warn' : 'bad';

  return (
    <div className="relative h-full w-full overflow-hidden bg-void">
      <SkyPreview state={state} insets={insets} />

      {/* ------------------------------------------------------- status bar */}
      <header
        className={clsx(
          'pointer-events-none absolute inset-x-0 top-0 z-20 transition-opacity duration-200',
          chromeHidden && 'opacity-0',
        )}
      >
        {/* A scrim keeps the bar legible over a bright patch of sky without
            needing a solid fill across the whole width. */}
        <div className="pointer-events-none absolute inset-0 h-16 bg-gradient-to-b from-black/60 to-transparent" />
        <div className="relative flex items-center gap-2 px-3 py-2.5">
          <span className="pointer-events-auto flex shrink-0 items-center gap-2">
            <Telescope size={16} className="text-accent" />
            <span className="text-sm font-semibold tracking-tight text-ink">AstroView</span>
          </span>

          <span className="mx-1 hidden h-4 w-px shrink-0 bg-white/10 md:block" />

          <div className="pointer-events-auto hidden min-w-0 items-baseline gap-3 md:flex">
            <span className="truncate text-xs text-muted" title={state.locationName}>
              {state.locationName}
            </span>
            <span className="numeric shrink-0 text-xs text-ink">
              {localTimeString(state.date, state.timeZone)}
            </span>
            <span className="numeric hidden shrink-0 text-[11px] text-dim lg:inline">
              {state.localDate}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <span className="pointer-events-auto hidden sm:block">
              <Pill tone={dark ? 'good' : skyState.sun.altitude > -6 ? 'bad' : 'warn'}>
                {dark ? 'Dark' : skyState.sun.altitude > -0.833 ? 'Daylight' : 'Twilight'}
              </Pill>
            </span>
            <span className="pointer-events-auto hidden sm:block">
              <Pill tone={coreTone}>Core {coreAlt.toFixed(0)}&deg;</Pill>
            </span>
            <span className="pointer-events-auto">
              <AttributionButton />
            </span>
            <span className="pointer-events-auto">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setChromeHidden(true)}
                title="Hide panels (H)"
              >
                <EyeOff size={13} />
              </Button>
            </span>
            <span className="pointer-events-auto">
              <Button size="sm" variant="ghost" onClick={toggleFullscreen} title="Fullscreen">
                {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </Button>
            </span>
          </div>
        </div>
      </header>

      {/* -------------------------------------------------- camera read-out */}
      <div
        className={clsx(
          'pointer-events-none absolute left-3 top-[3.4rem] z-20 hidden flex-col items-start gap-1.5 transition-opacity duration-200 lg:flex',
          chromeHidden && 'opacity-0',
        )}
      >
        <HudChip>
          <Aperture size={11} className="text-accent" />
          <span className="text-sm text-ink">
            {camera.focalLength < 10 ? camera.focalLength.toFixed(1) : camera.focalLength.toFixed(0)}
            <span className="text-[10px] text-dim"> mm</span>
          </span>
          <HudSep />
          {fov.horizontal.toFixed(1)}&deg; &times; {fov.vertical.toFixed(1)}&deg;
        </HudChip>
        <HudChip>
          <HudValue label="az">{camera.azimuth.toFixed(1)}&deg;</HudValue>
          <HudSep />
          <HudValue label="alt">{camera.elevation.toFixed(1)}&deg;</HudValue>
          {camera.roll !== 0 && (
            <>
              <HudSep />
              <HudValue label="roll">{camera.roll.toFixed(1)}&deg;</HudValue>
            </>
          )}
        </HudChip>
        <HudChip
          tone={
            brightness.moonPenaltyMag > 1 ? 'bad' : brightness.moonPenaltyMag > 0.3 ? 'warn' : 'good'
          }
        >
          <Moon size={11} />
          {(skyState.moon.illumination * 100).toFixed(0)}%
          <HudSep />
          <HudValue label="alt">{skyState.moon.altitude.toFixed(0)}&deg;</HudValue>
          {brightness.moonPenaltyMag > 0.01 && (
            <>
              <HudSep />
              &minus;{brightness.moonPenaltyMag.toFixed(2)} mag
            </>
          )}
        </HudChip>
      </div>

      {/* ------------------------------------------------------- right dock */}
      <div
        className={clsx(
          'pointer-events-none absolute bottom-3 right-3 top-[3.4rem] z-10 hidden flex-col transition-opacity duration-200 lg:flex',
          chromeHidden && 'opacity-0',
        )}
        style={{ width: DOCK_W }}
        ref={rightDockRef}
      >
        <DockPanel
          title="Controls"
          icon={<Sliders size={12} />}
          open={controlsOpen}
          onToggle={() => setControlsOpen((v) => !v)}
          className="max-h-full"
          bodyClassName="flex min-h-0 flex-col"
        >
          <ControlPanel state={state} />
        </DockPanel>
      </div>

      {/* ------------------------------------------------------ bottom dock */}
      <div
        className={clsx(
          'pointer-events-none absolute bottom-3 left-3 z-10 hidden transition-opacity duration-200 lg:block',
          chromeHidden && 'opacity-0',
        )}
        style={{ right: `calc(${DOCK_W} + 1.5rem)` }}
        ref={bottomDockRef}
      >
        <DockPanel
          title="Night timeline"
          icon={<Clock size={12} />}
          open={timelineOpen}
          onToggle={() => setTimelineOpen((v) => !v)}
        >
          <Timeline state={state} />
        </DockPanel>
      </div>

      {/* ------------------------------------------- small screens: a sheet */}
      <div
        className={clsx(
          'pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col lg:hidden',
          chromeHidden && 'opacity-0',
        )}
      >
        {sheetOpen && (
          <div
            className={clsx(
              'pointer-events-auto max-h-[64vh] animate-slideUp overflow-y-auto rounded-t-xl',
              GLASS,
            )}
          >
            <ControlPanel state={state} />
            <Timeline state={state} />
          </div>
        )}
        <nav
          className={clsx(
            'pointer-events-auto flex items-center gap-2 border-t border-white/[0.07] bg-[#080b14]/75 px-3 py-2 backdrop-blur-xl',
            !sheetOpen && 'rounded-t-xl border-x',
          )}
        >
          <span className="numeric flex-1 truncate text-[11px] text-muted">
            {camera.focalLength.toFixed(0)}mm &middot; az {camera.azimuth.toFixed(0)}&deg; &middot;
            core {coreAlt.toFixed(0)}&deg;
          </span>
          <Button size="sm" active={sheetOpen} onClick={() => setSheetOpen((v) => !v)}>
            {sheetOpen ? (
              <Eye size={13} className="mr-1 inline" />
            ) : (
              <Sliders size={13} className="mr-1 inline" />
            )}
            {sheetOpen ? 'Sky' : 'Controls'}
          </Button>
        </nav>
      </div>

      {chromeHidden && (
        <button
          type="button"
          onClick={() => setChromeHidden(false)}
          title="Show panels (H)"
          className={clsx(
            'absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:text-ink',
            GLASS,
          )}
        >
          <Eye size={13} />
          Show panels
        </button>
      )}
    </div>
  );
}
