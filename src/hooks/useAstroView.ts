/**
 * Central application state and the derived astronomical values.
 *
 * Expensive work is memoised on exactly what it depends on:
 *   - the EQJ -> ENU rotation and the Sun/Moon/GC state depend on time + place
 *   - the timeline sweep depends on time + place but only at the day level
 *   - the field of view depends only on the camera, not on time at all
 * so dragging the camera around never re-runs an ephemeris.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type GeoLocation,
  equatorialToEnuMatrix,
} from '../astronomy/coordinates';
import {
  computeEvents,
  computeSkyState,
  galacticCentreRiseSet,
  milkyWayBandVisibility,
  moonToGalacticCentreSeparation,
} from '../astronomy/sky';
import {
  localDateString,
  localMidnight,
  localTimeString,
  parseLocalDateTime,
  timeZoneForLocation,
  utcToLocalParts,
} from '../astronomy/time';
import {
  DEFAULT_CRITERIA,
  type PlannerCriteria,
  findObservationWindows,
} from '../astronomy/planner';
import {
  DEFAULT_CAMERA_PRESET,
  FOCAL_MAX,
  FOCAL_MIN,
  type SensorFormat,
  SENSOR_FORMATS,
  sensorById,
} from '../camera/sensors';
import {
  type FrameOrientation,
  cameraBasis,
  clampElevation,
  clampRoll,
  computeFieldOfView,
  wrapAzimuth,
} from '../camera/projection';
import {
  computeSkyBrightness,
  skyRenderParameters,
} from '../light-pollution/model';
import { angularSeparationDeg, clamp } from '../astronomy/constants';

export type SkyMode = 'ideal' | 'estimated';

export interface Overlays {
  milkyWay: boolean;
  equatorialGrid: boolean;
  horizonGrid: boolean;
  galacticEquator: boolean;
  labels: boolean;
  frameGuides: boolean;
}

export interface CameraState {
  sensorId: string;
  customWidth: number;
  customHeight: number;
  focalLength: number;
  orientation: FrameOrientation;
  azimuth: number;
  elevation: number;
  roll: number;
}

const DEFAULT_LOCATION: GeoLocation = {
  // Teide National Park, Tenerife: a well-known dark-sky site, and far enough
  // south that the Galactic Centre gets properly high in northern summer.
  latitude: 28.2723,
  longitude: -16.6425,
  elevation: 2100,
};

export function useAstroView() {
  const [location, setLocationState] = useState<GeoLocation>(DEFAULT_LOCATION);
  const [locationName, setLocationName] = useState('Teide National Park, Tenerife');
  const [timeZone, setTimeZone] = useState(() =>
    timeZoneForLocation(DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude),
  );
  const [date, setDate] = useState<Date>(() => {
    // Open on tonight's astronomical dark hours rather than "now at noon".
    const d = new Date();
    d.setHours(23, 0, 0, 0);
    return d;
  });

  const [camera, setCamera] = useState<CameraState>({
    sensorId: DEFAULT_CAMERA_PRESET.sensorId,
    customWidth: 36,
    customHeight: 24,
    focalLength: DEFAULT_CAMERA_PRESET.focalLength,
    orientation: 'landscape',
    azimuth: 165,
    elevation: 28,
    roll: 0,
  });

  const [sqm, setSqm] = useState(21.6);
  const [skyMode, setSkyMode] = useState<SkyMode>('estimated');
  const [overlays, setOverlays] = useState<Overlays>({
    milkyWay: true,
    equatorialGrid: false,
    horizonGrid: false,
    galacticEquator: false,
    labels: true,
    frameGuides: true,
  });
  const [criteria, setCriteria] = useState<PlannerCriteria>({ ...DEFAULT_CRITERIA, baseSqm: 21.6 });

  // Keep the planner's base brightness tied to the SQM control.
  useEffect(() => {
    setCriteria((c) => (c.baseSqm === sqm ? c : { ...c, baseSqm: sqm }));
  }, [sqm]);

  /* ------------------------------------------------------------- location */

  const setLocation = useCallback((next: GeoLocation, name?: string) => {
    setLocationState(next);
    setTimeZone(timeZoneForLocation(next.latitude, next.longitude));
    setLocationName(
      name ??
        `${Math.abs(next.latitude).toFixed(4)}${next.latitude >= 0 ? 'N' : 'S'}, ${Math.abs(
          next.longitude,
        ).toFixed(4)}${next.longitude >= 0 ? 'E' : 'W'}`,
    );
  }, []);

  /* ----------------------------------------------------------------- time */

  const localDate = useMemo(() => localDateString(date, timeZone), [date, timeZone]);
  const localTime = useMemo(() => localTimeString(date, timeZone), [date, timeZone]);

  const setLocalDateTime = useCallback(
    (dateStr: string, timeStr: string) => {
      const { date: utc } = parseLocalDateTime(dateStr, timeStr, timeZone);
      setDate(utc);
    },
    [timeZone],
  );

  /* --------------------------------------------------------------- camera */

  const sensor: SensorFormat = useMemo(() => {
    if (camera.sensorId === 'custom') {
      return {
        id: 'custom',
        name: 'Custom',
        width: camera.customWidth,
        height: camera.customHeight,
        cropFactor: Math.hypot(36, 24) / Math.hypot(camera.customWidth, camera.customHeight),
      };
    }
    return sensorById(camera.sensorId);
  }, [camera.sensorId, camera.customWidth, camera.customHeight]);

  const fov = useMemo(
    () => computeFieldOfView(sensor, camera.focalLength, camera.orientation),
    [sensor, camera.focalLength, camera.orientation],
  );

  const basis = useMemo(
    () => cameraBasis(camera.azimuth, camera.elevation, camera.roll),
    [camera.azimuth, camera.elevation, camera.roll],
  );

  const updateCamera = useCallback((patch: Partial<CameraState>) => {
    setCamera((c) => {
      const next = { ...c, ...patch };
      return {
        ...next,
        azimuth: wrapAzimuth(next.azimuth),
        elevation: clampElevation(next.elevation),
        roll: clampRoll(next.roll),
        focalLength: clamp(next.focalLength, FOCAL_MIN, FOCAL_MAX),
        customWidth: clamp(next.customWidth, 1, 120),
        customHeight: clamp(next.customHeight, 1, 120),
      };
    });
  }, []);

  const nudgeOrientation = useCallback(
    (dAzimuth: number, dElevation: number) =>
      setCamera((c) => ({
        ...c,
        azimuth: wrapAzimuth(c.azimuth + dAzimuth),
        elevation: clampElevation(c.elevation + dElevation),
      })),
    [],
  );

  /* -------------------------------------------------------------- the sky */

  const skyState = useMemo(() => computeSkyState(date, location), [date, location]);
  const celestialMatrix = useMemo(
    () => equatorialToEnuMatrix(date, location),
    [date, location],
  );

  const moonGcSeparation = useMemo(() => moonToGalacticCentreSeparation(skyState), [skyState]);

  const bandVisibility = useMemo(
    () => milkyWayBandVisibility(date, location),
    [date, location],
  );

  /** Sky brightness at the centre of the camera frame. */
  const brightness = useMemo(() => {
    const frameCentreAltitude = camera.elevation;
    const moonSeparation = angularSeparationDeg(
      skyState.moon.azimuth,
      skyState.moon.altitude,
      camera.azimuth,
      camera.elevation,
    );
    return computeSkyBrightness({
      baseSqm: skyMode === 'ideal' ? 22.0 : sqm,
      moonAltitudeDeg: skyMode === 'ideal' ? -90 : skyState.moon.altitude,
      moonIllumination: skyState.moon.illumination,
      sunMoonEarthAngleDeg: skyState.moon.sunMoonEarthAngleDeg,
      targetAltitudeDeg: Math.max(1, frameCentreAltitude),
      moonSeparationDeg: moonSeparation,
      sunAltitudeDeg: skyState.sun.altitude,
    });
  }, [skyMode, sqm, skyState, camera.azimuth, camera.elevation]);

  const renderParameters = useMemo(
    () => skyRenderParameters(brightness.effectiveSqm, { idealSky: skyMode === 'ideal' }),
    [brightness.effectiveSqm, skyMode],
  );

  /* ------------------------------------------------------- night timeline */

  /** Noon local time of the civil day the current instant belongs to. */
  const nightAnchor = useMemo(() => {
    const midnight = localMidnight(date, timeZone);
    const parts = utcToLocalParts(date, timeZone);
    // A time before noon belongs to the night that started the previous evening.
    const dayOffset = parts.hour < 12 ? -1 : 0;
    return new Date(midnight.getTime() + (12 + dayOffset * 24) * 3600000);
  }, [date, timeZone]);

  const nightEnd = useMemo(
    () => new Date(nightAnchor.getTime() + 24 * 3600000),
    [nightAnchor],
  );

  const events = useMemo(
    () => computeEvents(nightAnchor, location, 24),
    [nightAnchor, location],
  );

  const gcRiseSet = useMemo(
    () => galacticCentreRiseSet(nightAnchor, location, 24),
    [nightAnchor, location],
  );

  const planner = useMemo(
    () => findObservationWindows(nightAnchor, nightEnd, location, criteria, 5),
    [nightAnchor, nightEnd, location, criteria],
  );

  /* ------------------------------------------------------- time animation */

  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(120); // simulated seconds per real second
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setDate((d) => {
        const next = new Date(d.getTime() + dt * playSpeed * 1000);
        // Loop within the night window so playback stays useful.
        if (next.getTime() > nightEnd.getTime()) return nightAnchor;
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, playSpeed, nightAnchor, nightEnd]);

  return {
    // state
    location,
    locationName,
    timeZone,
    date,
    localDate,
    localTime,
    camera,
    sensor,
    sensorFormats: SENSOR_FORMATS,
    sqm,
    skyMode,
    overlays,
    criteria,
    playing,
    playSpeed,

    // derived
    fov,
    basis,
    skyState,
    celestialMatrix,
    brightness,
    renderParameters,
    events,
    gcRiseSet,
    planner,
    nightAnchor,
    nightEnd,
    moonGcSeparation,
    bandVisibility,

    // actions
    setLocation,
    setDate,
    setLocalDateTime,
    updateCamera,
    nudgeOrientation,
    setSqm,
    setSkyMode,
    setOverlays,
    setCriteria,
    setPlaying,
    setPlaySpeed,
  };
}

export type AstroViewState = ReturnType<typeof useAstroView>;
