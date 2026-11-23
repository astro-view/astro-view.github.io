/**
 * Bottom panel: the night at a glance.
 *
 * One SVG, drawn from the planner's 5-minute sweep:
 *   - twilight bands from the Sun's altitude
 *   - the Galactic Centre's altitude curve
 *   - the Moon's altitude, shaded by illuminated fraction
 *   - green blocks marking intervals that satisfy every planner criterion
 * The scrubber under it sets the observation time.
 */
import { useCallback, useMemo, useRef } from 'react';
import { clsx } from 'clsx';
import { Pause, Play, Rewind, Sparkles, Target } from 'lucide-react';
import { Button, Field, Slider, Stat } from './ui/primitives';
import { localTimeString } from '../astronomy/time';
import type { AstroViewState } from '../hooks/useAstroView';
import { TWILIGHT } from '../astronomy/constants';

const HEIGHT = 128;
const PAD_TOP = 10;
const PAD_BOTTOM = 20;

export function Timeline({ state }: { state: AstroViewState }) {
  const { planner, nightAnchor, nightEnd, date, timeZone, criteria } = state;
  const svgRef = useRef<SVGSVGElement | null>(null);

  const span = nightEnd.getTime() - nightAnchor.getTime();
  const xOf = useCallback(
    (t: Date | number) =>
      ((typeof t === 'number' ? t : t.getTime()) - nightAnchor.getTime()) / span,
    [nightAnchor, span],
  );

  /** Altitude -90..90 mapped into the plot area. */
  const yOf = useCallback((altitude: number) => {
    const plot = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const t = (90 - altitude) / 180;
    return PAD_TOP + t * plot;
  }, []);

  const geometry = useMemo(() => {
    const s = planner.samples;
    if (s.length === 0) return null;
    const toPath = (pick: (i: number) => number) =>
      s
        .map((sample, i) => `${i === 0 ? 'M' : 'L'}${(xOf(sample.date) * 100).toFixed(3)},${yOf(pick(i)).toFixed(2)}`)
        .join(' ');

    // Contiguous bands where the Sun is below each twilight threshold.
    const bands: Array<{ from: number; to: number; level: number }> = [];
    let current: { from: number; level: number } | null = null;
    const levelOf = (alt: number) =>
      alt > TWILIGHT.sunrise ? 0 : alt > TWILIGHT.civil ? 1 : alt > TWILIGHT.nautical ? 2 : alt > TWILIGHT.astronomical ? 3 : 4;
    for (let i = 0; i < s.length; i++) {
      const lvl = levelOf(s[i].sunAltitude);
      if (!current) current = { from: xOf(s[i].date), level: lvl };
      else if (current.level !== lvl) {
        bands.push({ from: current.from, to: xOf(s[i].date), level: current.level });
        current = { from: xOf(s[i].date), level: lvl };
      }
    }
    if (current) bands.push({ from: current.from, to: 1, level: current.level });

    return {
      gcPath: toPath((i) => s[i].galacticCentreAltitude),
      moonPath: toPath((i) => s[i].moonAltitude),
      sunPath: toPath((i) => s[i].sunAltitude),
      bands,
    };
  }, [planner.samples, xOf, yOf]);

  const scrub = useCallback(
    (clientX: number) => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      state.setDate(new Date(nightAnchor.getTime() + f * span));
    },
    [nightAnchor, span, state],
  );

  const bandFill = ['#0d1726', '#101c30', '#0b1322', '#080e19', '#05070d'];

  const totalMinutes = planner.windows.reduce((a, w) => a + w.durationMinutes, 0);
  const best = planner.windows.reduce<null | (typeof planner.windows)[number]>(
    (b, w) => (!b || w.peakGalacticCentreAltitude > b.peakGalacticCentreAltitude ? w : b),
    null,
  );

  return (
    <div className="flex min-h-0 flex-col gap-3 p-3 lg:flex-row">
      {/* ------------------------------------------------------------- chart */}
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="panel-title">Night timeline</h2>
            <span className="numeric text-2xs text-dim">
              {localTimeString(nightAnchor, timeZone)} &rarr; {localTimeString(nightEnd, timeZone)}{' '}
              local
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={() => state.setDate(nightAnchor)}
              title="Back to the start of the window"
            >
              <Rewind size={11} />
            </Button>
            <Button
              size="sm"
              variant={state.playing ? 'accent' : 'default'}
              onClick={() => state.setPlaying(!state.playing)}
              title={state.playing ? 'Pause' : 'Play the night'}
            >
              {state.playing ? <Pause size={11} /> : <Play size={11} />}
            </Button>
            <select
              className="!py-1 !text-2xs"
              value={state.playSpeed}
              aria-label="Playback speed"
              onChange={(e) => state.setPlaySpeed(Number(e.target.value))}
            >
              <option value={60}>1 min/s</option>
              <option value={120}>2 min/s</option>
              <option value={300}>5 min/s</option>
              <option value={900}>15 min/s</option>
              <option value={1800}>30 min/s</option>
            </select>
          </div>
        </div>

        <div className="relative rounded border border-white/[0.07] bg-black/25">
          <svg
            ref={svgRef}
            viewBox={`0 0 100 ${HEIGHT}`}
            preserveAspectRatio="none"
            className="block h-32 w-full cursor-crosshair touch-none"
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              scrub(e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) scrub(e.clientX);
            }}
            role="slider"
            aria-label="Observation time"
            aria-valuemin={nightAnchor.getTime()}
            aria-valuemax={nightEnd.getTime()}
            aria-valuenow={date.getTime()}
          >
            {/* twilight bands */}
            {geometry?.bands.map((b, i) => (
              <rect
                key={i}
                x={b.from * 100}
                y={0}
                width={Math.max(0, (b.to - b.from) * 100)}
                height={HEIGHT}
                fill={bandFill[b.level]}
              />
            ))}

            {/* qualifying windows */}
            {planner.windows.map((w, i) => (
              <rect
                key={`w${i}`}
                x={xOf(w.start) * 100}
                y={PAD_TOP}
                width={Math.max(0.2, (xOf(w.end) - xOf(w.start)) * 100)}
                height={HEIGHT - PAD_TOP - PAD_BOTTOM}
                fill="rgba(74,222,128,0.12)"
                stroke="rgba(74,222,128,0.45)"
                strokeWidth={0.12}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* horizon */}
            <line
              x1={0}
              x2={100}
              y1={yOf(0)}
              y2={yOf(0)}
              stroke="#27344b"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={0}
              x2={100}
              y1={yOf(criteria.minGalacticCentreAltitude)}
              y2={yOf(criteria.minGalacticCentreAltitude)}
              stroke="rgba(74,222,128,0.4)"
              strokeDasharray="3 3"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={0}
              x2={100}
              y1={yOf(TWILIGHT.astronomical)}
              y2={yOf(TWILIGHT.astronomical)}
              stroke="rgba(255,182,72,0.3)"
              strokeDasharray="2 4"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />

            {/* hour ticks */}
            {Array.from({ length: 25 }).map((_, h) => (
              <line
                key={h}
                x1={(h / 24) * 100}
                x2={(h / 24) * 100}
                y1={HEIGHT - PAD_BOTTOM}
                y2={HEIGHT - PAD_BOTTOM + (h % 6 === 0 ? 6 : 3)}
                stroke="#27344b"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {geometry && (
              <>
                <path
                  d={geometry.sunPath}
                  fill="none"
                  stroke="rgba(255,182,72,0.5)"
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={geometry.moonPath}
                  fill="none"
                  stroke="rgba(230,236,247,0.42)"
                  strokeWidth={1.2}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={geometry.gcPath}
                  fill="none"
                  stroke="#4da3ff"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}

            {/* now marker */}
            <line
              x1={xOf(date) * 100}
              x2={xOf(date) * 100}
              y1={0}
              y2={HEIGHT}
              stroke="#7cc4ff"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* hour labels */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0.5 flex justify-between px-1 text-[9px] text-dim">
            {[0, 6, 12, 18, 24].map((h) => (
              <span key={h} className="numeric">
                {localTimeString(new Date(nightAnchor.getTime() + h * 3600000), timeZone)}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-dim">
          <LegendSwatch color="#4da3ff" label="Core" />
          <LegendSwatch color="rgba(255,182,72,0.6)" label="Sun" />
          <LegendSwatch color="rgba(230,236,247,0.5)" label="Moon" dashed />
          <LegendSwatch color="rgba(74,222,128,0.5)" label="Window" block />
        </div>
      </div>

      {/* ------------------------------------------------------------ planner */}
      <div className="w-full shrink-0 lg:w-80">
        <div className="mb-2 flex items-center gap-2">
          <Target size={12} className="text-accent" />
          <h2 className="panel-title">Observation planner</h2>
        </div>

        <div className="mb-2 grid grid-cols-2 gap-2">
          <Field label="Min core altitude" value={`${criteria.minGalacticCentreAltitude}°`} className="mb-0">
            <Slider
              min={0}
              max={60}
              step={1}
              value={criteria.minGalacticCentreAltitude}
              ariaLabel="Minimum Galactic Centre altitude"
              onChange={(v) => state.setCriteria({ ...criteria, minGalacticCentreAltitude: v })}
            />
          </Field>
          <Field label="Max moon penalty" value={`${criteria.maxMoonPenaltyMag.toFixed(2)} mag`} className="mb-0">
            <Slider
              min={0}
              max={3}
              step={0.05}
              value={criteria.maxMoonPenaltyMag}
              ariaLabel="Maximum sky brightening from the Moon"
              onChange={(v) => state.setCriteria({ ...criteria, maxMoonPenaltyMag: v })}
            />
          </Field>
        </div>

        <div className="mb-2 grid grid-cols-2 gap-2">
          <Stat
            label="Usable tonight"
            value={totalMinutes > 0 ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m` : 'none'}
            tone={totalMinutes > 0 ? 'good' : 'bad'}
          />
          <Stat
            label="Best core alt"
            value={best ? `${best.peakGalacticCentreAltitude.toFixed(1)}°` : '—'}
          />
        </div>

        {planner.windows.length > 0 ? (
          <ul className="max-h-32 space-y-1 overflow-y-auto">
            {planner.windows.map((w, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => state.setDate(w.peakAt)}
                  className={clsx(
                    'flex w-full items-center justify-between gap-2 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-left transition-colors hover:border-good/50 hover:bg-good/5',
                  )}
                >
                  <span className="numeric text-xs text-ink">
                    {localTimeString(w.start, timeZone)} &ndash; {localTimeString(w.end, timeZone)}
                  </span>
                  <span className="numeric text-2xs text-dim">
                    {Math.floor(w.durationMinutes / 60)}h {w.durationMinutes % 60}m &middot; peak{' '}
                    {w.peakGalacticCentreAltitude.toFixed(0)}&deg;
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded border border-white/[0.07] bg-white/[0.03] px-2 py-2 text-2xs leading-relaxed text-dim">
            <Sparkles size={10} className="mr-1 inline text-warn" />
            {planner.diagnosis}
          </p>
        )}

      </div>
    </div>
  );
}

function LegendSwatch({
  color,
  label,
  dashed,
  block,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  block?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      {block ? (
        <span className="h-2.5 w-3.5 rounded-sm" style={{ backgroundColor: color }} />
      ) : (
        <span
          className="h-0 w-4"
          style={{
            borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
          }}
        />
      )}
      {label}
    </span>
  );
}
