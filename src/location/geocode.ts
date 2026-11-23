/**
 * Place-name search, via OpenStreetMap's Nominatim.
 *
 * Nominatim is a free, keyless, public service. Its usage policy allows light,
 * user-initiated querying, which is what happens here: a request is sent only
 * when the user presses Enter or clicks Search, never while typing. No API key
 * exists, so none can leak, and nothing about the user is sent beyond the words
 * they typed into the search box.
 *
 * If the service is unreachable the UI falls back to entering coordinates
 * directly, which always works offline.
 */

export interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
  type: string;
}

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

export async function searchPlaces(query: string, limit = 6): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = new URL(ENDPOINT);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('addressdetails', '0');

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status}).`);
  const json = (await res.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
    type?: string;
  }>;
  return json.map((r) => ({
    name: r.display_name,
    latitude: Number(r.lat),
    longitude: Number(r.lon),
    type: r.type ?? '',
  }));
}

/** Format a coordinate pair the way a field notebook would. */
export function formatCoordinate(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(5)}° ${latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(longitude).toFixed(5)}° ${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}
