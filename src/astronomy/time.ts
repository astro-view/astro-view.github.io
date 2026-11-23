/**
 * Local civil time <-> UTC, using the IANA time zone of the selected location.
 *
 * AstroView stores every instant as a JavaScript `Date`, which is UTC. The user
 * however thinks in local civil time at the observing site - which is usually
 * NOT the time zone of the browser. All conversion happens here.
 *
 * Daylight saving is handled by `Intl.DateTimeFormat`, so transitions, historic
 * rule changes and half-hour/three-quarter-hour zones all behave correctly
 * without a rules table of our own.
 *
 * Two awkward cases exist at a DST transition and are handled explicitly:
 *  - A "spring forward" gap: the requested local time does not exist. We return
 *    the instant just after the gap and report `gap: true`.
 *  - A "fall back" overlap: the local time happens twice. We return the first
 *    (earlier, still-DST) occurrence and report `ambiguous: true`.
 */
import tzLookup from 'tz-lookup';

export interface LocalTimeParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

export interface ZonedConversion {
  date: Date;
  gap: boolean;
  ambiguous: boolean;
}

/** IANA time zone for a geographic position; falls back to UTC if unknown. */
export function timeZoneForLocation(latitude: number, longitude: number): string {
  try {
    return tzLookup(latitude, longitude);
  } catch {
    return 'UTC';
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant, as seen in `timeZone`. */
export function utcToLocalParts(date: Date, timeZone: string): LocalTimeParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** The zone's UTC offset in minutes at a given instant (east of Greenwich positive). */
export function utcOffsetMinutes(date: Date, timeZone: string): number {
  const p = utcToLocalParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Round to the nearest minute: formatToParts drops milliseconds.
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * Convert wall-clock time in `timeZone` to the corresponding UTC instant.
 *
 * Uses two offset probes, which converges for every real zone: the first probe
 * guesses with the offset at the naive instant, the second corrects it if that
 * guess landed on the other side of a transition.
 */
export function localPartsToUtc(parts: LocalTimeParts, timeZone: string): ZonedConversion {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offset1 = utcOffsetMinutes(new Date(naive), timeZone);
  const guess1 = new Date(naive - offset1 * 60000);
  const offset2 = utcOffsetMinutes(guess1, timeZone);
  const guess2 = new Date(naive - offset2 * 60000);

  const roundTrip = (d: Date): boolean => {
    const p = utcToLocalParts(d, timeZone);
    return (
      p.year === parts.year &&
      p.month === parts.month &&
      p.day === parts.day &&
      p.hour === parts.hour &&
      p.minute === parts.minute
    );
  };

  if (offset1 === offset2) {
    if (roundTrip(guess2)) {
      // Check for a "fall back" overlap: the same wall clock one hour later in UTC.
      const earlier = new Date(guess2.getTime() - 3600000);
      const ambiguous = roundTrip(earlier);
      return { date: ambiguous ? earlier : guess2, gap: false, ambiguous };
    }
    // Offsets agree but the wall clock does not round-trip: a spring-forward gap.
    return { date: guess2, gap: true, ambiguous: false };
  }

  if (roundTrip(guess2)) return { date: guess2, gap: false, ambiguous: false };
  if (roundTrip(guess1)) return { date: guess1, gap: false, ambiguous: false };
  // Neither round-trips: the local time falls inside a spring-forward gap.
  return { date: guess2, gap: true, ambiguous: false };
}

/** `YYYY-MM-DD` as seen in `timeZone`. */
export function localDateString(date: Date, timeZone: string): string {
  const p = utcToLocalParts(date, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(
    p.day,
  ).padStart(2, '0')}`;
}

/** `HH:MM` as seen in `timeZone`. */
export function localTimeString(date: Date, timeZone: string): string {
  const p = utcToLocalParts(date, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Parse `YYYY-MM-DD` + `HH:MM` in `timeZone` into a UTC instant. */
export function parseLocalDateTime(
  dateString: string,
  timeString: string,
  timeZone: string,
): ZonedConversion {
  const [y, m, d] = dateString.split('-').map(Number);
  const [hh, mm] = timeString.split(':').map(Number);
  return localPartsToUtc(
    { year: y, month: m, day: d, hour: hh, minute: mm, second: 0 },
    timeZone,
  );
}

/** Human-readable offset such as `UTC+05:45`. */
export function formatUtcOffset(date: Date, timeZone: string): string {
  const mins = utcOffsetMinutes(date, timeZone);
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Short zone abbreviation such as `CEST`, when the platform can supply one. */
export function timeZoneAbbreviation(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/**
 * Local midnight (00:00) of the civil day containing `date`, as a UTC instant.
 * Used as the anchor for the night timeline.
 */
export function localMidnight(date: Date, timeZone: string): Date {
  const p = utcToLocalParts(date, timeZone);
  return localPartsToUtc(
    { year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0 },
    timeZone,
  ).date;
}
