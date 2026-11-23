/**
 * Application shell.
 *
 * The sky is the application: it fills the window edge to edge, and every
 * control is a floating panel over it. Nothing is letterboxed into a column,
 * and any panel can be folded away, so the sky can always be seen whole.
 *
 * Layout:
 *   top     one slim status bar - where, when, and whether it is dark
 *   left    location (map)
 *   right   time, camera, sky conditions, astronomy, overlays
 *   bottom  the night timeline and the observation planner
 *
 * The dock containers are `pointer-events-none`; only the panels themselves
 * accept events, so dragging the sky still works in the gaps between them.
 * Below `lg` the docks become one bottom sheet with a tab bar, leaving the sky
 * fully visible behind it.
 */
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  Aperture,
  Clock,
  Eye,
  EyeOff,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Moon,
  Sliders,
  Telescope,
} from 'lucide-react';
import { useAstroView } from './hooks/useAstroView';
import { SkyPreview } from './components/SkyPreview';
import { ControlPanel } from './components/ControlPanel';
import { Timeline } from './components/Timeline';
import { LocationPanel } from './location/LocationPanel';
import { AttributionButton } from './components/AttributionPanel';
import { Button, Pill } from './components/ui/primitives';
import { DockPanel, GLASS, HudChip, HudSep, HudValue } from './components/ui/Dock';
import { localTimeString } from './astronomy/time';

type Sheet = 'location' | 'controls' | 'timeline';

export default function App() {
  const state = useAstroView();

  const [openPanels, setOpenPanels] = useState({
    location: true,
    controls: true,
    timeline: true,
  });
  const [chromeHidden, setChromeHidden] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const toggle = useCallback(
    (key: keyof typeof openPanels) => setOpenPanels((p) => ({ ...p, [key]: !p[key] })),
    [],
  );

  /** `H` clears every panel so the sky can be judged on its own. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.key === 'h' || e.key === 'H') setChromeHidden((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(
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

  const { camera, fov, skyState, brightness } = state;
  const dark = skyState.astronomicallyDark;
  const coreTone =
    skyState.galacticCentre.altitude > 10
      ? 'good'
      : skyState.galacticCentre.altitude > 0
        ? 'warn'
        : 'bad';

  return (
    <div className="relative h-full w-full overflow-hidden bg-void">
      {/* ---------------------------------------------------------- the sky */}
      <SkyPreview state={state} />

      {/* ------------------------------------------------------- status bar */}
      <header
        className={clsx(
          'pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-2.5 py-2 transition-opacity duration-200',
          chromeHidden && 'pointer-events-none opacity-0',
        )}
      >
        <span
          className={clsx(
            'pointer-events-auto flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5',
            GLASS,
          )}
        >
          <Telescope size={15} className="text-accent" />
          <span className="text-xs font-semibold tracking-tight text-ink">AstroView</span>
        </span>

        <div className="pointer-events-auto hidden min-w-0 items-center gap-2 md:flex">
          <HudChip className="min-w-0">
            <span className="truncate text-ink" title={state.locationName}>
              {state.locationName}
            </span>
          </HudChip>
          <HudChip>
            {state.localDate} {localTimeString(state.date, state.timeZone)}
            <HudSep />
            <span className="text-dim">{state.timeZone}</span>
          </HudChip>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="pointer-events-auto hidden sm:block">
            <Pill tone={dark ? 'good' : skyState.sun.altitude > -6 ? 'bad' : 'warn'}>
              {dark
                ? 'Astronomical darkness'
                : skyState.sun.altitude > -0.833
                  ? 'Daylight'
                  : 'Twilight'}
            </Pill>
          </span>
          <span className="pointer-events-auto hidden sm:block">
            <Pill tone={coreTone}>Core {skyState.galacticCentre.altitude.toFixed(1)}&deg;</Pill>
          </span>
          <span className={clsx('pointer-events-auto rounded-lg', GLASS)}>
            <AttributionButton />
          </span>
          <span className="pointer-events-auto">
            <Button
              size="sm"
              onClick={() => setChromeHidden(true)}
              title="Hide all panels (H)"
              className={GLASS}
            >
              <EyeOff size={12} />
            </Button>
          </span>
          <span className="pointer-events-auto">
            <Button
              size="sm"
              onClick={toggleFullscreen}
              title="Fullscreen"
              className={GLASS}
            >
              {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </Button>
          </span>
        </div>
      </header>

      {/* ------------------------------------------------- camera read-out */}
      <div
        className={clsx(
          'pointer-events-none absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 flex-wrap justify-center gap-1.5 px-2 transition-opacity duration-200 lg:bottom-auto lg:left-2.5 lg:top-14 lg:translate-x-0 lg:justify-start',
          chromeHidden && 'opacity-0',
        )}
      >
        <HudChip>
          <Aperture size={10} className="text-accent" />
          <span className="text-ink">
            {camera.focalLength < 10
              ? camera.focalLength.toFixed(1)
              : camera.focalLength.toFixed(0)}
            mm
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
          <Moon size={10} />
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

      {/* ------------------------------------------------------- left dock */}
      <div
        className={clsx(
          'pointer-events-none absolute bottom-3 left-2.5 top-24 z-10 hidden w-[20rem] flex-col justify-end transition-opacity duration-200 lg:flex',
          chromeHidden && 'pointer-events-none opacity-0',
        )}
      >
        <DockPanel
          title="Location"
          icon={<MapIcon size={12} />}
          open={openPanels.location}
          onToggle={() => toggle('location')}
          className="max-h-full"
          bodyClassName="flex min-h-0 flex-col"
        >
          <LocationPanel state={state} />
        </DockPanel>
      </div>

      {/* ------------------------------------------------------ right dock */}
      <div
        className={clsx(
          'pointer-events-none absolute bottom-3 right-2.5 top-14 z-10 hidden w-[21.5rem] flex-col transition-opacity duration-200 lg:flex',
          chromeHidden && 'pointer-events-none opacity-0',
        )}
      >
        <DockPanel
          title="Controls"
          icon={<Sliders size={12} />}
          open={openPanels.controls}
          onToggle={() => toggle('controls')}
          className="max-h-full"
          bodyClassName="flex min-h-0 flex-col"
        >
          <ControlPanel state={state} />
        </DockPanel>
      </div>

      {/* ----------------------------------------------------- bottom dock */}
      <div
        className={clsx(
          'pointer-events-none absolute bottom-3 left-[21.5rem] right-[22.5rem] z-10 hidden transition-opacity duration-200 lg:block',
          chromeHidden && 'pointer-events-none opacity-0',
        )}
      >
        <DockPanel
          title="Night timeline and planner"
          icon={<Clock size={12} />}
          open={openPanels.timeline}
          onToggle={() => toggle('timeline')}
        >
          <Timeline state={state} />
        </DockPanel>
      </div>

      {/* ------------------------------------------- small screens: a sheet */}
      <div
        className={clsx(
          'pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col lg:hidden',
          chromeHidden && 'pointer-events-none opacity-0',
        )}
      >
        {sheet && (
          <div
            className={clsx(
              'pointer-events-auto max-h-[62vh] animate-slideUp overflow-hidden rounded-t-xl',
              GLASS,
            )}
          >
            <div className="flex max-h-[62vh] flex-col overflow-y-auto">
              {sheet === 'location' && <LocationPanel state={state} />}
              {sheet === 'controls' && <ControlPanel state={state} />}
              {sheet === 'timeline' && <Timeline state={state} />}
            </div>
          </div>
        )}
        <nav
          className={clsx(
            'pointer-events-auto flex border-t border-white/[0.07] bg-[#080b14]/75 backdrop-blur-xl',
            !sheet && 'rounded-t-xl border-x',
          )}
        >
          {(
            [
              ['location', 'Place', <MapIcon key="m" size={15} />],
              ['controls', 'Controls', <Sliders key="s" size={15} />],
              ['timeline', 'Night', <Clock key="t" size={15} />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSheet((s) => (s === id ? null : (id as Sheet)))}
              className={clsx(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-2xs transition-colors',
                sheet === id ? 'text-accent2' : 'text-dim hover:text-muted',
              )}
            >
              {icon}
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSheet(null)}
            className={clsx(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-2xs transition-colors',
              sheet === null ? 'text-accent2' : 'text-dim hover:text-muted',
            )}
          >
            <Eye size={15} />
            Sky
          </button>
        </nav>
      </div>

      {/* Bring the panels back after `H` or the hide button. */}
      {chromeHidden && (
        <button
          type="button"
          onClick={() => setChromeHidden(false)}
          title="Show panels (H)"
          className={clsx(
            'absolute right-2.5 top-2 z-30 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-2xs text-muted transition-colors hover:text-ink',
            GLASS,
          )}
        >
          <Eye size={12} />
          Show panels
        </button>
      )}

      <div
        className={clsx(
          'pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 text-2xs text-dim transition-opacity lg:block',
          !chromeHidden && 'opacity-0',
        )}
      >
        drag to aim &middot; scroll to zoom the lens &middot; H to show panels
      </div>
    </div>
  );
}
