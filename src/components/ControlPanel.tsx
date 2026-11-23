/** The controls dock: time, camera, sky, overlays. Numbers over prose. */
import { Aperture, CalendarClock, Layers, Moon, Sun, Telescope } from 'lucide-react';
import { Button, CollapsibleSection, Field, Slider, Stat, Toggle } from './ui/primitives';
import { FOCAL_MAX, FOCAL_MIN, FOCAL_PRESETS } from '../camera/sensors';
import { formatUtcOffset, localTimeString } from '../astronomy/time';
import type { AstroViewState } from '../hooks/useAstroView';

const deg = (v: number, digits = 1) => `${v.toFixed(digits)}°`;
const mm = (v: number) => (v < 10 ? v.toFixed(1) : v.toFixed(0));

function timeOrDash(d: Date | null, timeZone: string): string {
  return d ? localTimeString(d, timeZone) : '—';
}

export function ControlPanel({ state }: { state: AstroViewState }) {
  const {
    camera,
    sensor,
    sensorFormats,
    fov,
    skyState,
    brightness,
    events,
    gcRiseSet,
    timeZone,
    date,
    localDate,
    localTime,
    overlays,
    includeMoon,
    moonGcSeparation,
    bandVisibility,
  } = state;

  const moonUp = skyState.moon.altitude > 0;

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      {/* ------------------------------------------------------------- time */}
      <CollapsibleSection title="Time" icon={<CalendarClock size={12} />}>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <input
            type="date"
            aria-label="Local date"
            value={localDate}
            className="w-full"
            onChange={(e) => state.setLocalDateTime(e.target.value, localTime)}
          />
          <input
            type="time"
            aria-label="Local time"
            value={localTime}
            className="w-full"
            onChange={(e) => state.setLocalDateTime(localDate, e.target.value)}
          />
        </div>
        <div className="mb-2 flex gap-1.5">
          <Button size="sm" onClick={() => state.setDate(new Date())}>
            Now
          </Button>
          <Button size="sm" onClick={() => state.setDate(new Date(date.getTime() - 3600000))}>
            &minus;1h
          </Button>
          <Button size="sm" onClick={() => state.setDate(new Date(date.getTime() + 3600000))}>
            +1h
          </Button>
          {events.duskAstronomical && (
            <Button size="sm" onClick={() => state.setDate(events.duskAstronomical as Date)}>
              Dusk
            </Button>
          )}
        </div>
        <div className="numeric text-2xs text-dim">
          {formatUtcOffset(date, timeZone)} &middot; UTC {date.toISOString().slice(11, 16)}
        </div>
      </CollapsibleSection>

      {/* ----------------------------------------------------------- camera */}
      <CollapsibleSection title="Camera" icon={<Aperture size={12} />}>
        <select
          aria-label="Sensor"
          className="mb-2 w-full"
          value={camera.sensorId}
          onChange={(e) => state.updateCamera({ sensorId: e.target.value })}
        >
          {sensorFormats.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {camera.sensorId === 'custom' && (
          <div className="mb-2 grid grid-cols-2 gap-2">
            <input
              type="number"
              step="0.1"
              min="1"
              max="120"
              aria-label="Sensor width in mm"
              className="w-full"
              value={camera.customWidth}
              onChange={(e) => state.updateCamera({ customWidth: Number(e.target.value) })}
            />
            <input
              type="number"
              step="0.1"
              min="1"
              max="120"
              aria-label="Sensor height in mm"
              className="w-full"
              value={camera.customHeight}
              onChange={(e) => state.updateCamera({ customHeight: Number(e.target.value) })}
            />
          </div>
        )}

        <div className="mb-3 flex gap-1.5">
          {(['landscape', 'portrait'] as const).map((o) => (
            <Button
              key={o}
              size="sm"
              active={camera.orientation === o}
              onClick={() => state.updateCamera({ orientation: o })}
              className="flex-1 capitalize"
            >
              {o}
            </Button>
          ))}
        </div>

        <Field label="Focal length" value={`${mm(camera.focalLength)} mm`}>
          {/* Logarithmic: a linear 1-200 track buries 8-35 mm in its first sixth. */}
          <Slider
            min={0}
            max={1000}
            step={1}
            value={Math.round(
              (Math.log(camera.focalLength / FOCAL_MIN) / Math.log(FOCAL_MAX / FOCAL_MIN)) * 1000,
            )}
            ariaLabel="Focal length"
            onChange={(v) => {
              const f = FOCAL_MIN * Math.pow(FOCAL_MAX / FOCAL_MIN, v / 1000);
              state.updateCamera({ focalLength: f < 10 ? Math.round(f * 10) / 10 : Math.round(f) });
            }}
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {FOCAL_PRESETS.map((f) => (
              <Button
                key={f}
                size="sm"
                active={Math.abs(camera.focalLength - f) < 0.5}
                onClick={() => state.updateCamera({ focalLength: f })}
              >
                {f}
              </Button>
            ))}
            <input
              type="number"
              step="0.1"
              min={FOCAL_MIN}
              max={FOCAL_MAX}
              aria-label="Focal length, exact value"
              value={mm(camera.focalLength)}
              className="w-16 !py-1"
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) state.updateCamera({ focalLength: v });
              }}
            />
          </div>
        </Field>

        <div className="mb-3 grid grid-cols-3 gap-2">
          <Stat label="H" value={fov.horizontal.toFixed(1)} unit="&deg;" />
          <Stat label="V" value={fov.vertical.toFixed(1)} unit="&deg;" />
          <Stat label="Diag" value={fov.diagonal.toFixed(1)} unit="&deg;" />
        </div>

        {/* Azimuth and elevation have no sliders: you aim by dragging the sky.
            Roll stays, because dragging cannot express it. */}
        <Field label="Roll" value={deg(camera.roll)}>
          <Slider
            min={-180}
            max={180}
            step={0.5}
            value={camera.roll}
            ariaLabel="Camera roll"
            onChange={(v) => state.updateCamera({ roll: v })}
          />
        </Field>

        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            onClick={() =>
              state.updateCamera({
                azimuth: skyState.galacticCentre.azimuth,
                elevation: Math.max(-10, Math.min(90, skyState.galacticCentre.altitude)),
              })
            }
            title="Point at the Galactic Centre"
          >
            <Telescope size={11} className="mr-1 inline" />
            Aim at core
          </Button>
          <Button size="sm" onClick={() => state.updateCamera({ roll: 0 })}>
            Level
          </Button>
          <Button
            size="sm"
            onClick={() => state.updateCamera({ azimuth: 180, elevation: 30, roll: 0 })}
          >
            Reset
          </Button>
        </div>

        <p className="mt-2 text-2xs text-dim">
          {sensor.width} &times; {sensor.height} mm &middot; {sensor.cropFactor.toFixed(2)}&times;
        </p>
      </CollapsibleSection>

      {/* ---------------------------------------------------- sun and core */}
      <CollapsibleSection title="Sun and core" icon={<Sun size={12} />}>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Stat label="Sun alt" value={deg(skyState.sun.altitude)} />
          <Stat label="Sun az" value={deg(skyState.sun.azimuth)} />
          <Stat
            label="Core alt"
            value={deg(skyState.galacticCentre.altitude)}
            tone={
              skyState.galacticCentre.altitude > 10
                ? 'good'
                : skyState.galacticCentre.altitude > 0
                  ? 'warn'
                  : 'bad'
            }
          />
          <Stat label="Core az" value={deg(skyState.galacticCentre.azimuth)} />
          <Stat label="Sunset" value={timeOrDash(events.sunset, timeZone)} />
          <Stat label="Sunrise" value={timeOrDash(events.sunrise, timeZone)} />
          <Stat
            label="Astro dusk"
            value={timeOrDash(events.duskAstronomical, timeZone)}
            title="Sun reaches -18 degrees"
          />
          <Stat
            label="Astro dawn"
            value={timeOrDash(events.dawnAstronomical, timeZone)}
            title="Sun rises back through -18 degrees"
          />
          <Stat label="Core rise" value={timeOrDash(gcRiseSet.rise, timeZone)} />
          <Stat label="Core set" value={timeOrDash(gcRiseSet.set, timeZone)} />
        </div>

        {events.noAstronomicalDarkness && (
          <p className="text-2xs text-warn">No astronomical darkness tonight.</p>
        )}
        {events.darkAllNight && <p className="text-2xs text-good">Dark all night.</p>}

        <p className="text-2xs text-dim">
          Band {(bandVisibility.fractionAboveHorizon * 100).toFixed(0)}% up, peak{' '}
          {deg(bandVisibility.highestAltitude)}
        </p>
      </CollapsibleSection>

      {/* ------------------------------------------------------------- moon */}
      <CollapsibleSection title="Moonlight" icon={<Moon size={12} />}>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Stat label="Phase" value={skyState.moon.phaseName} />
          <Stat label="Lit" value={(skyState.moon.illumination * 100).toFixed(0)} unit="%" />
          <Stat
            label="Altitude"
            value={deg(skyState.moon.altitude)}
            tone={moonUp ? 'warn' : 'good'}
          />
          <Stat label="Azimuth" value={deg(skyState.moon.azimuth)} />
          <Stat label="Moonrise" value={timeOrDash(events.moonrise, timeZone)} />
          <Stat label="Moonset" value={timeOrDash(events.moonset, timeZone)} />
          <Stat label="Sky" value={brightness.effectiveSqm.toFixed(2)} unit="mag" />
          <Stat
            label="Penalty"
            value={brightness.moonPenaltyMag.toFixed(2)}
            unit="mag"
            tone={
              brightness.moonPenaltyMag > 1
                ? 'bad'
                : brightness.moonPenaltyMag > 0.3
                  ? 'warn'
                  : 'good'
            }
          />
          <Stat label="Limiting mag" value={brightness.limitingMagnitude.toFixed(2)} />
          <Stat label="Moon to core" value={deg(moonGcSeparation, 0)} />
        </div>

        <Toggle checked={includeMoon} onChange={state.setIncludeMoon} label="Include moonlight" />

        {brightness.twilightDominated && (
          <p className="mt-1 text-2xs text-warn">Sun above &minus;18&deg;: twilight dominates.</p>
        )}

        <p className="mt-2 text-2xs leading-relaxed text-dim">
          Natural dark sky plus moonlight only. Artificial light pollution is not modelled.
        </p>
      </CollapsibleSection>

      {/* --------------------------------------------------------- overlays */}
      <CollapsibleSection title="Overlays" icon={<Layers size={12} />} defaultOpen={false}>
        <Toggle
          checked={overlays.milkyWay}
          onChange={(v) => state.setOverlays({ ...overlays, milkyWay: v })}
          label="Milky Way"
        />
        <Toggle
          checked={overlays.frameGuides}
          onChange={(v) => state.setOverlays({ ...overlays, frameGuides: v })}
          label="Frame guides"
        />
        <Toggle
          checked={overlays.labels}
          onChange={(v) => state.setOverlays({ ...overlays, labels: v })}
          label="Labels"
        />
        <Toggle
          checked={overlays.equatorialGrid}
          onChange={(v) => state.setOverlays({ ...overlays, equatorialGrid: v })}
          label="Equatorial grid"
        />
        <Toggle
          checked={overlays.horizonGrid}
          onChange={(v) => state.setOverlays({ ...overlays, horizonGrid: v })}
          label="Alt / azimuth grid"
        />
        <Toggle
          checked={overlays.galacticEquator}
          onChange={(v) => state.setOverlays({ ...overlays, galacticEquator: v })}
          label="Galactic equator"
        />
      </CollapsibleSection>
    </div>
  );
}
