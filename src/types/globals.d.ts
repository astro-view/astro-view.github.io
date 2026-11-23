/**
 * Ambient declarations for dependencies that ship no TypeScript types.
 */
declare module 'tz-lookup' {
  /** IANA time zone name for a geographic position. Throws on invalid input. */
  export default function tzLookup(latitude: number, longitude: number): string;
}
