/**
 * Data provenance and licensing.
 *
 * Kept short, but not optional: the HYG catalogue is CC BY-SA and NASA imagery
 * requires credit, so the attributions here are a licence obligation rather
 * than a nicety.
 */
import { useEffect, useState } from 'react';
import { BookOpen, ExternalLink, X } from 'lucide-react';
import { Button } from './ui/primitives';
import { GLASS } from './ui/Dock';
import {
  loadMilkyWayMeta,
  loadStarCatalog,
  type MilkyWayMeta,
  type StarCatalogMeta,
} from '../data/catalog';

export function AttributionButton() {
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState<StarCatalogMeta | null>(null);
  const [milkyway, setMilkyway] = useState<MilkyWayMeta | null>(null);

  useEffect(() => {
    if (!open) return;
    loadStarCatalog()
      .then((c) => setStars(c.meta))
      .catch(() => undefined);
    loadMilkyWayMeta().then(setMilkyway).catch(() => undefined);
  }, [open]);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title="Data sources">
        <BookOpen size={12} className="mr-1 inline" />
        Sources
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Data sources"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div
            className={`max-h-[80vh] w-full max-w-xl animate-slideUp overflow-y-auto rounded-xl p-5 ${GLASS}`}
          >
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-sm font-semibold text-ink">Data sources</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="text-dim hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            <dl className="space-y-3 text-2xs leading-relaxed text-muted">
              <Row term="Stars">
                {stars ? (
                  <>
                    {stars.source}, {stars.count.toLocaleString()} to mag {stars.magnitudeLimit},{' '}
                    {stars.epoch}. {stars.license}.{' '}
                    <Link href={stars.sourceUrl}>astronexus/HYG-Database</Link>
                  </>
                ) : (
                  'Loading'
                )}
              </Row>

              <Row term="Milky Way">
                {milkyway ? (
                  <>
                    NASA/GSFC Scientific Visualization Studio, Deep Star Maps.{' '}
                    {milkyway.projection}, {milkyway.frame}. Registration measured, not assumed.{' '}
                    <Link href={milkyway.sourceUrl}>svs.gsfc.nasa.gov/3895</Link>
                  </>
                ) : (
                  'Loading'
                )}
              </Row>

              <Row term="Ephemerides">
                Astronomy Engine (Don Cross), MIT.{' '}
                <Link href="https://github.com/cosinekitty/astronomy">cosinekitty/astronomy</Link>
                <br />
                Galactic Centre: Sgr A*, RA 266.41683&deg;, Dec &minus;29.00781&deg; (ICRS).
              </Row>

              <Row term="Moonlight">
                Krisciunas &amp; Schaefer 1991, PASP 103, 1033. Limiting magnitude: Schaefer&apos;s
                visual-detection relation. Airmass: Pickering 2002.
              </Row>

              <Row term="Map">
                Tiles &copy; OpenStreetMap contributors, darkened client-side. Search via Nominatim.
                No map API key.
              </Row>

              <Row term="Not modelled">
                Weather and artificial light pollution. The sky is treated as naturally dark; only
                the Moon brightens it.
              </Row>
            </dl>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3">
      <dt className="text-2xs uppercase tracking-wider text-dim">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-0.5 text-accent hover:text-accent2"
    >
      {children}
      <ExternalLink size={9} />
    </a>
  );
}
