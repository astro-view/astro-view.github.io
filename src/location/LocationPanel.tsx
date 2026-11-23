/** Location panel: a dark world map you click to choose where you are standing. */
import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Crosshair, Loader2, LocateFixed, Search, X } from 'lucide-react';
import { Button, Field } from '../components/ui/primitives';
import { type GeocodeResult, formatCoordinate, searchPlaces } from './geocode';
import type { AstroViewState } from '../hooks/useAstroView';
import { clamp } from '../astronomy/constants';

/**
 * Basemap: OpenStreetMap standard raster tiles.
 *
 * Keyless on purpose. The good-looking dark basemaps (CARTO, Mapbox, Stadia and
 * the rest) all want an API key now, and a static site cannot keep one secret,
 * so instead the plain OSM tiles are darkened with MapLibre's own raster paint
 * filters. That costs nothing, needs no account, and keeps the instrument look.
 *
 * OSM's tile usage policy covers light, interactive use like this; attribution
 * is required and is displayed by the attribution control.
 */
const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#05070d' } },
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: {
        'raster-opacity': 0.85,
        'raster-brightness-min': 0.0,
        'raster-brightness-max': 0.42,
        'raster-saturation': -0.45,
        'raster-contrast': 0.12,
        'raster-hue-rotate': 190,
      },
    },
  ],
};

/* --------------------------------------------------------------------------
 * Camera direction indicator
 * -------------------------------------------------------------------------- */

const CONE_SIZE = 150;
const CONE_CENTRE = CONE_SIZE / 2;
const CONE_RADIUS = CONE_SIZE / 2 - 4;

const VIEW_CONE_SVG = `<svg width="${CONE_SIZE}" height="${CONE_SIZE}" viewBox="0 0 ${CONE_SIZE} ${CONE_SIZE}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g id="astroview-cone-rotate" style="transform-origin:${CONE_CENTRE}px ${CONE_CENTRE}px">
    <path id="astroview-cone-wedge" fill="rgba(77,163,255,0.17)" stroke="rgba(124,196,255,0.55)" stroke-width="1"/>
    <line id="astroview-cone-axis" x1="${CONE_CENTRE}" y1="${CONE_CENTRE}" x2="${CONE_CENTRE}" y2="${CONE_CENTRE - CONE_RADIUS}" stroke="rgba(124,196,255,0.9)" stroke-width="1.25" stroke-dasharray="4 3"/>
  </g>
</svg>`;

/**
 * SVG path for a wedge of half-angle `halfAngleDeg`, pointing straight up
 * (screen north) from the observer. The whole group is then rotated by the
 * azimuth, which works because map rotation is disabled, so screen up is north.
 */
function wedgePath(halfAngleDeg: number): string {
  const half = clamp(halfAngleDeg, 0.4, 179);
  if (half >= 179) {
    return `M ${CONE_CENTRE - CONE_RADIUS},${CONE_CENTRE} a ${CONE_RADIUS},${CONE_RADIUS} 0 1,0 ${CONE_RADIUS * 2},0 a ${CONE_RADIUS},${CONE_RADIUS} 0 1,0 ${-CONE_RADIUS * 2},0 Z`;
  }
  const toXY = (deg: number) => {
    const a = (deg - 90) * (Math.PI / 180); // -90 so 0 deg points up
    return [CONE_CENTRE + CONE_RADIUS * Math.cos(a), CONE_CENTRE + CONE_RADIUS * Math.sin(a)];
  };
  const [x0, y0] = toXY(-half);
  const [x1, y1] = toXY(half);
  const largeArc = half > 90 ? 1 : 0;
  return `M ${CONE_CENTRE},${CONE_CENTRE} L ${x0.toFixed(2)},${y0.toFixed(2)} A ${CONE_RADIUS},${CONE_RADIUS} 0 ${largeArc} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
}

export function LocationPanel({ state }: { state: AstroViewState }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const viewConeRef = useRef<maplibregl.Marker | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const { location, setLocation } = state;

  /* ------------------------------------------------------------- map init */

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container,
        style: BASE_STYLE,
        center: [location.longitude, location.latitude],
        zoom: 4,
        attributionControl: { compact: true },
        maxZoom: 14,
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch {
      setMapError(
        'The map could not start (WebGL unavailable). Enter latitude and longitude directly instead.',
      );
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // Camera direction wedge, drawn under the observer dot. It is a fixed-size
    // DOM marker rather than a geographic polygon so it stays legible at every
    // zoom level, and because its meaning is angular, not metric.
    const viewEl = document.createElement('div');
    viewEl.style.pointerEvents = 'none';
    viewEl.innerHTML = VIEW_CONE_SVG;
    viewConeRef.current = new maplibregl.Marker({ element: viewEl, anchor: 'center' })
      .setLngLat([location.longitude, location.latitude])
      .addTo(map);

    const el = document.createElement('div');
    el.className = 'astroview-marker';
    el.innerHTML =
      '<span class="block h-3 w-3 rounded-full border-2 border-[#4da3ff] bg-[#7cc4ff]/40 shadow-[0_0_10px_rgba(77,163,255,0.9)]"></span>';
    markerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([location.longitude, location.latitude])
      .addTo(map);

    map.on('click', (e) => {
      setLocation({
        latitude: clamp(e.lngLat.lat, -89.5, 89.5),
        longitude: ((((e.lngLat.lng + 180) % 360) + 360) % 360) - 180,
        elevation: 0,
      });
    });
    map.on('error', (e) => {
      // Tile failures are common on flaky networks; do not nuke the whole panel.
      if (e?.error && 'status' in e.error) return;
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      viewConeRef.current?.remove();
      viewConeRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; location changes are pushed through effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    markerRef.current?.setLngLat([location.longitude, location.latitude]);
    viewConeRef.current?.setLngLat([location.longitude, location.latitude]);
  }, [location.latitude, location.longitude]);

  // Keep the wedge pointing where the camera points, as wide as the lens sees.
  useEffect(() => {
    const el = viewConeRef.current?.getElement();
    if (!el) return;
    const group = el.querySelector('#astroview-cone-rotate') as SVGGElement | null;
    const wedge = el.querySelector('#astroview-cone-wedge') as SVGPathElement | null;
    if (!group || !wedge) return;
    wedge.setAttribute('d', wedgePath(state.fov.horizontal / 2));
    group.style.transform = `rotate(${state.camera.azimuth}deg)`;
    // Fade the indicator when the camera is pointed steeply up: the ground
    // footprint of the view stops meaning much near the zenith.
    el.style.opacity = String(clamp(1 - state.camera.elevation / 110, 0.25, 1));
  }, [state.camera.azimuth, state.camera.elevation, state.fov.horizontal]);

  /* ------------------------------------------------------------- search */

  const runSearch = useCallback(async () => {
    setSearchError(null);
    setSearching(true);
    try {
      const r = await searchPlaces(query);
      setResults(r);
      if (r.length === 0) setSearchError('No matching place found.');
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Place search is unavailable.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const choose = useCallback(
    (r: GeocodeResult) => {
      setLocation({ latitude: r.latitude, longitude: r.longitude, elevation: 0 }, r.name);
      mapRef.current?.flyTo({ center: [r.longitude, r.latitude], zoom: 8, duration: 900 });
      setResults([]);
      setQuery('');
    },
    [setLocation],
  );

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setSearchError('This browser does not expose a geolocation API.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          elevation: pos.coords.altitude ?? 0,
        });
        mapRef.current?.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 9,
          duration: 900,
        });
      },
      () => setSearchError('Location permission was denied.'),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }, [setLocation]);

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      <div className="border-b border-white/[0.06] p-3">
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
            <input
              type="text"
              value={query}
              placeholder="Search for a place"
              aria-label="Search for a place"
              className="w-full !pl-7"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch();
              }}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-ink"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                  setSearchError(null);
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
          <Button onClick={() => void runSearch()} disabled={searching} title="Search">
            {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          </Button>
          <Button onClick={useMyLocation} title="Use my current location">
            <LocateFixed size={12} />
          </Button>
        </div>

        {searchError && <p className="mt-2 text-2xs text-warn">{searchError}</p>}

        {results.length > 0 && (
          <ul className="mt-2 max-h-40 overflow-y-auto rounded border border-white/[0.08] bg-[#080b14]/90 backdrop-blur-xl">
            {results.map((r) => (
              <li key={`${r.latitude},${r.longitude},${r.name}`}>
                <button
                  type="button"
                  onClick={() => choose(r)}
                  className="block w-full px-2 py-1.5 text-left text-2xs leading-snug text-muted transition-colors hover:bg-panel hover:text-ink"
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="relative h-52 shrink-0">
        <div ref={containerRef} className="absolute inset-0" />
        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-panel/90 p-4">
            <p className="text-2xs leading-relaxed text-warn">{mapError}</p>
          </div>
        )}
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded border border-white/[0.08] bg-[#080b14]/60 px-2 py-1 text-2xs text-muted backdrop-blur-md">
          <Crosshair size={10} className="text-accent" />
          click the map to place the observer
        </div>
      </div>

      <div className="border-t border-white/[0.06] p-3">
        <div className="numeric mb-2 text-xs text-ink">
          {formatCoordinate(location.latitude, location.longitude)}
        </div>
        <div className="mb-3 truncate text-2xs text-dim" title={state.locationName}>
          {state.locationName} &middot; {state.timeZone}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Latitude" className="mb-0">
            <input
              type="number"
              step="0.0001"
              min={-89.5}
              max={89.5}
              value={location.latitude.toFixed(4)}
              className="w-full"
              onChange={(e) =>
                setLocation({ ...location, latitude: clamp(Number(e.target.value), -89.5, 89.5) })
              }
            />
          </Field>
          <Field label="Longitude" className="mb-0">
            <input
              type="number"
              step="0.0001"
              min={-180}
              max={180}
              value={location.longitude.toFixed(4)}
              className="w-full"
              onChange={(e) =>
                setLocation({ ...location, longitude: clamp(Number(e.target.value), -180, 180) })
              }
            />
          </Field>
          <Field label="Elev (m)" className="mb-0">
            <input
              type="number"
              step="10"
              value={Math.round(location.elevation)}
              className="w-full"
              onChange={(e) =>
                setLocation({ ...location, elevation: clamp(Number(e.target.value), -400, 9000) })
              }
            />
          </Field>
        </div>

      </div>
    </div>
  );
}
