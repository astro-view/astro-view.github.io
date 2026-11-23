/** The controls dock: observation time, camera, sky conditions, astronomy, overlays. */
import {
  Aperture,
  CalendarClock,
  Eye,
  Info,
  Layers,
  Lightbulb,
  Moon,
  Sun,
  Telescope,
} from 'lucide-react';
import {
  Button,
  CollapsibleSection,
  Field,
  Note,
  Pill,
  Slider,
  Stat,
  Toggle,
} from './ui/primitives';
import { FOCAL_MAX, FOCAL_MIN, FOCAL_PRESETS } from '../camera/sensors';
import { formatUtcOffset, localTimeString, timeZoneAbbreviation } from '../astronomy/time';
import { BORTLE_CLASSES } from '../light-pollution/model';
import type { AstroViewState } from '../hooks/useAstroView';

const deg = (v: number, digits = 1) => `${v.toFixed(digits)}°`;

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
    skyMode,
    sqm,
    bandVisibility,
    moonGcSeparation,
  } = state;

  const darkTone = skyState.astronomicallyDark ? 'good' : skyState.sun.altitude > -6 ? 'bad' : 'warn';

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      {/* ---------------------------------------------------- observation time */}
      <CollapsibleSection title="Observation time" icon={<CalendarClock size={12} />}>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Field label="Local date" className="mb-0">
            <input
              type="date"
              value={localDate}
              className="w-full"
              onChange={(e) => state.setLocalDateTime(e.target.value, localTime)}
            />
          </Field>
          <Field label="Local time" className="mb-0">
            <input
              type="time"
              value={localTime}
              className="w-full"
              onChange={(e) => state.setLocalDateTime(localDate, e.target.value)}
            />
          </Field>
        </div>
        <div className="numeric flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-dim">
          <span>
            {timeZone} {timeZoneAbbreviation(date, timeZone)}
          </span>
          <span>{formatUtcOffset(date, timeZone)}</span>
          <span>UTC {date.toISOString().slice(11, 16)}</span>
        </div>
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" onClick={() => state.setDate(new Date())}>
            Now
          </Button>
          <Button
            size="sm"
            onClick={() => state.setDate(new Date(date.getTime() - 3600000))}
            title="Back one hour"
          >
            &minus;1 h
          </Button>
          <Button
            size="sm"
            onClick={() => state.setDate(new Date(date.getTime() + 3600000))}
            title="Forward one hour"
          >
            +1 h
          </Button>
          {events.duskAstronomical && (
            <Button
              size="sm"
              onClick={() => state.setDate(events.duskAstronomical as Date)}
              title="Jump to the start of astronomical darkness"
            >
              Dusk
            </Button>
          )}
        </div>
      </CollapsibleSection>

      {/* ------------------------------------------------------------- camera */}
      <CollapsibleSection title="Camera" icon={<Aperture size={12} />}>
        <Field label="Sensor">
          <select
            className="w-full"
            value={camera.sensorId}
            onChange={(e) => state.updateCamera({ sensorId: e.target.value })}
          >
            {sensorFormats.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        {camera.sensorId === 'custom' && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Field label="Width (mm)" className="mb-0">
              <input
                type="number"
                step="0.1"
                min="1"
                max="120"
                className="w-full"
                value={camera.customWidth}
                onChange={(e) => state.updateCamera({ customWidth: Number(e.target.value) })}
              />
            </Field>
            <Field label="Height (mm)" className="mb-0">
              <input
                type="number"
                step="0.1"
                min="1"
                max="120"
                className="w-full"
                value={camera.customHeight}
                onChange={(e) => state.updateCamera({ customHeight: Number(e.target.value) })}
              />
            </Field>
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

        <Field
          label="Focal length"
          value={`${camera.focalLength < 10 ? camera.focalLength.toFixed(1) : camera.focalLength.toFixed(0)} mm`}
        >
          {/*
            Logarithmic, because the useful range spans 1-200 mm: a linear
            slider would squeeze everything from 8 mm to 35 mm - where almost
            all Milky Way work happens - into the first sixth of the track.
          */}
          <Slider
            min={0}
            max={1000}
            step={1}
            value={Math.round(
              (Math.log(camera.focalLength / FOCAL_MIN) / Math.log(FOCAL_MAX / FOCAL_MIN)) * 1000,
            )}
            ariaLabel="Focal length in millimetres"
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
              value={camera.focalLength < 10 ? camera.focalLength.toFixed(1) : Math.round(camera.focalLength)}
              aria-label="Focal length, exact value in millimetres"
              className="w-16 !py-1"
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) state.updateCamera({ focalLength: v });
              }}
            />
          </div>
        </Field>

        <div className="mb-3 grid grid-cols-3 gap-2">
          <Stat label="H FOV" value={fov.horizontal.toFixed(1)} unit="&deg;" />
          <Stat label="V FOV" value={fov.vertical.toFixed(1)} unit="&deg;" />
          <Stat label="Diag" value={fov.diagonal.toFixed(1)} unit="&deg;" />
        </div>

        {/*
          Azimuth and elevation have no sliders: you aim by dragging the sky,
          which is both faster and the thing you are actually looking at. Roll
          stays, because dragging cannot express it.
        */}
        <Field label="Roll" value={deg(camera.roll)} hint="Aim by dragging the sky itself">
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
            title="Point the camera at the Galactic Centre"
          >
            <Telescope size={11} className="mr-1 inline" />
            Aim at core
          </Button>
          <Button size="sm" onClick={() => state.updateCamera({ roll: 0 })} title="Level the horizon">
            Level
          </Button>
          <Button
            size="sm"
            onClick={() => state.updateCamera({ azimuth: 180, elevation: 30, roll: 0 })}
            title="Face south, 30 degrees up"
          >
            Reset aim
          </Button>
        </div>

        <p className="mt-2 text-2xs leading-relaxed text-dim">
          {sensor.width} &times; {sensor.height} mm &middot; crop {sensor.cropFactor.toFixed(2)}
          &times; &middot; FOV = 2&middot;atan(d / 2f)
        </p>
      </CollapsibleSection>

      {/* ---------------------------------------------------------- astronomy */}
      <CollapsibleSection title="Astronomical information" icon={<Sun size={12} />}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Pill tone={darkTone}>
            {skyState.astronomicallyDark ? 'Astronomically dark' : `Sun ${deg(skyState.sun.altitude)}`}
          </Pill>
          <Pill tone={skyState.galacticCentre.altitude > 10 ? 'good' : skyState.galacticCentre.altitude > 0 ? 'warn' : 'bad'}>
            Core {deg(skyState.galacticCentre.altitude)}
          </Pill>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <Stat label="Sun alt" value={deg(skyState.sun.altitude)} />
          <Stat label="Sun az" value={deg(skyState.sun.azimuth)} />
          <Stat label="Core alt" value={deg(skyState.galacticCentre.altitude)} />
          <Stat label="Core az" value={deg(skyState.galacticCentre.azimuth)} />
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
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
          <Note>
            The Sun never reaches &minus;18&deg; on this date at this latitude, so there is no
            astronomical darkness at all tonight.
          </Note>
        )}
        {events.darkAllNight && (
          <Note>The Sun stays below &minus;18&deg; for the whole window: dark all night.</Note>
        )}

        <div className="mt-3 hairline pt-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-ink">
            <Moon size={12} className="text-accent" />
            Moon
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Phase" value={skyState.moon.phaseName} />
            <Stat
              label="Illuminated"
              value={(skyState.moon.illumination * 100).toFixed(0)}
              unit="%"
            />
            <Stat label="Altitude" value={deg(skyState.moon.altitude)} />
            <Stat label="Azimuth" value={deg(skyState.moon.azimuth)} />
            <Stat label="Moonrise" value={timeOrDash(events.moonrise, timeZone)} />
            <Stat label="Moonset" value={timeOrDash(events.moonset, timeZone)} />
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-dim">
            Moon to core separation {deg(moonGcSeparation)}.{' '}
            {skyState.moon.altitude <= 0
              ? 'The Moon is below the horizon and adds nothing to the sky background.'
              : `Moonlight adds ${brightness.moonPenaltyMag.toFixed(2)} mag of sky brightness at the frame centre.`}
          </p>
        </div>

        <div className="mt-3 hairline pt-3">
          <p className="text-2xs leading-relaxed text-dim">
            <strong className="text-muted">Milky Way band:</strong>{' '}
            {(bandVisibility.fractionAboveHorizon * 100).toFixed(0)}% of the galactic equator is
            above the horizon, peaking at {deg(bandVisibility.highestAltitude)} (galactic longitude{' '}
            {bandVisibility.highestLongitude.toFixed(0)}&deg;). The band can be well placed while
            the Galactic Centre itself is still below the horizon.
          </p>
        </div>
      </CollapsibleSection>

      {/* --------------------------------------------------- light pollution */}
      <CollapsibleSection title="Light pollution" icon={<Lightbulb size={12} />}>
        <div className="mb-3 flex gap-1.5">
          {(['ideal', 'estimated'] as const).map((m) => (
            <Button
              key={m}
              size="sm"
              active={skyMode === m}
              onClick={() => state.setSkyMode(m)}
              className="flex-1"
            >
              {m === 'ideal' ? 'Ideal dark sky' : 'Estimated sky'}
            </Button>
          ))}
        </div>

        <Field
          label="Sky brightness (SQM)"
          value={`${sqm.toFixed(2)} mag/arcsec²`}
          hint="Measured or looked up zenith brightness with no Moon. Drag to compare sites."
        >
          <Slider
            min={16}
            max={22}
            step={0.05}
            value={sqm}
            ariaLabel="Zenith sky brightness in magnitudes per square arcsecond"
            onChange={(v) => state.setSqm(v)}
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {[
              ['Pristine', 21.95],
              ['Rural', 21.7],
              ['Suburban', 20.3],
              ['City edge', 19.0],
              ['Inner city', 17.5],
            ].map(([label, value]) => (
              <Button
                key={label as string}
                size="sm"
                active={Math.abs(sqm - (value as number)) < 0.03}
                onClick={() => state.setSqm(value as number)}
              >
                {label}
              </Button>
            ))}
          </div>
        </Field>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <Stat
            label="Effective SQM"
            value={brightness.effectiveSqm.toFixed(2)}
            title="Including moonlight at the centre of the frame"
          />
          <Stat label="Bortle" value={brightness.bortle.bortle} />
          <Stat label="Limiting mag" value={brightness.limitingMagnitude.toFixed(2)} />
          <Stat
            label="Moon penalty"
            value={brightness.moonPenaltyMag.toFixed(2)}
            unit="mag"
            tone={brightness.moonPenaltyMag > 1 ? 'bad' : brightness.moonPenaltyMag > 0.3 ? 'warn' : 'good'}
          />
        </div>

        <p className="mb-2 text-2xs leading-relaxed text-muted">
          <strong className="text-ink">Class {brightness.bortle.bortle}</strong> &mdash;{' '}
          {brightness.bortle.label}. {brightness.bortle.description}
        </p>

        {brightness.twilightDominated && (
          <Note>
            The Sun is above &minus;18&deg;, so the real sky is brighter than the SQM figure: at
            this moment twilight, not artificial light, sets the background.
          </Note>
        )}

        <details className="mt-2 text-2xs text-dim">
          <summary className="cursor-pointer select-none py-1 text-muted hover:text-ink">
            <Info size={10} className="mr-1 inline" />
            How this is modelled
          </summary>
          <div className="mt-1 space-y-2 leading-relaxed">
            <p>
              Sky brightness is an input, not a prediction. AstroView does not know how bright your
              sky is; you supply an SQM reading, pick a preset, or read one off a published atlas.
            </p>
            <p>
              Moonlight is added with the Krisciunas &amp; Schaefer (1991) model, evaluated at the
              centre of the frame, and combined with the background in linear units before being
              converted back to mag/arcsec&sup2;. Limiting magnitude follows Schaefer&apos;s
              visual-detection relation in the form used by the Unihedron SQM/Bortle tables.
            </p>
            <p>
              VIIRS upward radiance is deliberately <em>not</em> treated as sky brightness: they are
              different quantities, related only through an atmospheric scattering model.
            </p>
            <p>
              The rendering itself is a documented approximation. It reproduces the loss of faint
              stars, the collapse of Milky Way contrast and the glow, not the photometric response
              of a specific camera.
            </p>
          </div>
        </details>

        <details className="mt-1 text-2xs text-dim">
          <summary className="cursor-pointer select-none py-1 text-muted hover:text-ink">
            Bortle scale reference
          </summary>
          <ul className="mt-1 space-y-1">
            {BORTLE_CLASSES.map((c) => (
              <li key={c.bortle} className="leading-snug">
                <span className="numeric text-muted">{c.bortle}</span>{' '}
                <span className="text-muted">{c.label}</span>{' '}
                <span className="numeric text-dim">
                  ({c.sqmRange[0].toFixed(2)}&ndash;{c.sqmRange[1].toFixed(2)})
                </span>
              </li>
            ))}
          </ul>
        </details>
      </CollapsibleSection>

      {/* ------------------------------------------------------------ overlays */}
      <CollapsibleSection title="Overlays" icon={<Layers size={12} />} defaultOpen={false}>
        <Toggle
          checked={overlays.milkyWay}
          onChange={(v) => state.setOverlays({ ...overlays, milkyWay: v })}
          label="Milky Way texture"
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
          hint="RA / Dec, fixed to the stars"
        />
        <Toggle
          checked={overlays.horizonGrid}
          onChange={(v) => state.setOverlays({ ...overlays, horizonGrid: v })}
          label="Alt / azimuth grid"
          hint="Fixed to the observer"
        />
        <Toggle
          checked={overlays.galacticEquator}
          onChange={(v) => state.setOverlays({ ...overlays, galacticEquator: v })}
          label="Galactic equator"
        />
        <div className="mt-2 flex items-center gap-1.5 text-2xs text-dim">
          <Eye size={10} />
          Rendering {skyMode === 'ideal' ? 'an ideal dark sky' : 'the estimated polluted sky'}
        </div>
      </CollapsibleSection>
    </div>
  );
}
