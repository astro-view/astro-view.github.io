/**
 * Application shell.
 *
 * Desktop: three columns (location | sky | controls) over a full-width night
 * timeline. Below `lg` the columns stack and the sky preview keeps the largest
 * share of the viewport, with the side panels collapsed into tabs.
 */
import { useState } from 'react';
import { clsx } from 'clsx';
import { Camera, Clock, Map as MapIcon, Sliders, Telescope } from 'lucide-react';
import { useAstroView } from './hooks/useAstroView';
import { SkyPreview } from './components/SkyPreview';
import { ControlPanel } from './components/ControlPanel';
import { Timeline } from './components/Timeline';
import { LocationPanel } from './location/LocationPanel';
import { AttributionButton } from './components/AttributionPanel';
import { Panel, Pill } from './components/ui/primitives';
import { localTimeString } from './astronomy/time';

type MobileTab = 'sky' | 'location' | 'controls' | 'timeline';

export default function App() {
  const state = useAstroView();
  const [tab, setTab] = useState<MobileTab>('sky');

  const dark = state.skyState.astronomicallyDark;

  return (
    <div className="flex h-full flex-col bg-void">
      {/* ------------------------------------------------------------ header */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge bg-panel/60 px-3 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2.5">
          <Telescope size={16} className="shrink-0 text-accent" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold leading-tight tracking-tight text-ink">
              AstroView
            </h1>
            <p className="truncate text-2xs leading-tight text-dim">
              Milky Way photography planner
            </p>
          </div>
        </div>

        <div className="hidden min-w-0 items-center gap-2 md:flex">
          <span className="numeric truncate text-2xs text-muted" title={state.locationName}>
            {state.locationName}
          </span>
          <span className="text-edge2">|</span>
          <span className="numeric text-2xs text-muted">
            {state.localDate} {localTimeString(state.date, state.timeZone)}
          </span>
          <Pill tone={dark ? 'good' : state.skyState.sun.altitude > -6 ? 'bad' : 'warn'}>
            {dark
              ? 'Astronomical darkness'
              : state.skyState.sun.altitude > -0.833
                ? 'Daylight'
                : 'Twilight'}
          </Pill>
          <Pill
            tone={
              state.skyState.galacticCentre.altitude > 10
                ? 'good'
                : state.skyState.galacticCentre.altitude > 0
                  ? 'warn'
                  : 'bad'
            }
          >
            Core {state.skyState.galacticCentre.altitude.toFixed(1)}&deg;
          </Pill>
        </div>

        <AttributionButton />
      </header>

      {/* ------------------------------------------------------ desktop grid */}
      <main className="hidden min-h-0 flex-1 flex-col gap-2 p-2 lg:flex">
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,20rem)_minmax(0,1fr)_minmax(280px,22rem)] gap-2">
          <Panel title="Location" icon={<MapIcon size={12} />} bodyClassName="min-h-0 flex-1 flex flex-col">
            <LocationPanel state={state} />
          </Panel>

          <SkyPreview state={state} />

          <Panel
            title="Controls"
            icon={<Sliders size={12} />}
            bodyClassName="min-h-0 flex-1 flex flex-col"
          >
            <ControlPanel state={state} />
          </Panel>
        </div>

        <section className="shrink-0 rounded-lg border border-edge bg-panel/80">
          <Timeline state={state} />
        </section>
      </main>

      {/* -------------------------------------------------------- small screens */}
      <main className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className={clsx('min-h-0 flex-1 p-2', tab !== 'sky' && 'hidden')}>
          <SkyPreview state={state} />
        </div>
        <div className={clsx('min-h-0 flex-1 overflow-hidden p-2', tab !== 'location' && 'hidden')}>
          <Panel title="Location" icon={<MapIcon size={12} />} bodyClassName="min-h-0 flex-1 flex flex-col" className="h-full">
            <LocationPanel state={state} />
          </Panel>
        </div>
        <div className={clsx('min-h-0 flex-1 overflow-hidden p-2', tab !== 'controls' && 'hidden')}>
          <Panel title="Controls" icon={<Sliders size={12} />} bodyClassName="min-h-0 flex-1 flex flex-col" className="h-full">
            <ControlPanel state={state} />
          </Panel>
        </div>
        <div className={clsx('min-h-0 flex-1 overflow-y-auto', tab !== 'timeline' && 'hidden')}>
          <Timeline state={state} />
        </div>

        <nav className="flex shrink-0 border-t border-edge bg-panel">
          {(
            [
              ['sky', 'Sky', <Camera key="c" size={14} />],
              ['location', 'Place', <MapIcon key="m" size={14} />],
              ['controls', 'Controls', <Sliders key="s" size={14} />],
              ['timeline', 'Night', <Clock key="t" size={14} />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id as MobileTab)}
              className={clsx(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-2xs transition-colors',
                tab === id ? 'text-accent2' : 'text-dim hover:text-muted',
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>
      </main>
    </div>
  );
}
