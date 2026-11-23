/**
 * Camera sensor formats and focal-length presets.
 *
 * Sensor dimensions are the active image area in millimetres, width x height in
 * landscape orientation. These drive the field of view directly, so they are
 * the real figures rather than marketing "equivalent" numbers.
 */

export interface SensorFormat {
  id: string;
  name: string;
  /** Long edge, mm. */
  width: number;
  /** Short edge, mm. */
  height: number;
  /** Diagonal crop factor relative to 35 mm full frame, for reference only. */
  cropFactor: number;
  note?: string;
}

export const SENSOR_FORMATS: readonly SensorFormat[] = [
  {
    id: 'full-frame',
    name: 'Full frame (35 mm)',
    width: 36,
    height: 24,
    cropFactor: 1.0,
    note: 'Sony A7C, Canon R6, Nikon Z6 and similar',
  },
  { id: 'aps-c', name: 'APS-C', width: 23.5, height: 15.6, cropFactor: 1.53, note: 'Sony, Nikon, Fuji' },
  { id: 'aps-c-canon', name: 'APS-C (Canon)', width: 22.3, height: 14.9, cropFactor: 1.61 },
  { id: 'mft', name: 'Micro Four Thirds', width: 17.3, height: 13.0, cropFactor: 2.0 },
  { id: 'medium-44x33', name: 'Medium format 44x33', width: 44, height: 33, cropFactor: 0.79 },
  { id: 'one-inch', name: '1 inch', width: 13.2, height: 8.8, cropFactor: 2.72 },
  { id: 'custom', name: 'Custom', width: 36, height: 24, cropFactor: 1.0 },
];

export const DEFAULT_SENSOR_ID = 'full-frame';

/** Focal-length presets offered as one-tap buttons. */
export const FOCAL_PRESETS: readonly number[] = [14, 20, 24, 35, 50, 85];

export const FOCAL_MIN = 8;
export const FOCAL_MAX = 200;

/**
 * The default camera. The brief specifies a Sony A7C body (full frame) with a
 * 35 mm lens - a common Milky Way panorama setup.
 */
export const DEFAULT_CAMERA_PRESET = {
  bodyName: 'Sony A7C',
  sensorId: DEFAULT_SENSOR_ID,
  focalLength: 35,
} as const;

export function sensorById(id: string): SensorFormat {
  return SENSOR_FORMATS.find((s) => s.id === id) ?? SENSOR_FORMATS[0];
}
