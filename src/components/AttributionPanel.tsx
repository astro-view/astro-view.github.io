/** Data provenance and licensing, shown in-app rather than buried in a README. */
import { useEffect, useState } from 'react';
import { BookOpen, ExternalLink, X } from 'lucide-react';
import { Button } from './ui/primitives';
import { loadMilkyWayMeta, loadStarCatalog, type MilkyWayMeta, type StarCatalogMeta } from '../data/catalog';

export function AttributionButton() {
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState<StarCatalogMeta | null>(null);
  const [milkyway, setMilkyway] = useState<MilkyWayMeta | null>(null);

  useEffect(() => {
    if (!open) return;
    loadStarCatalog().then((c) => setStars(c.meta)).catch(() => undefined);
    loadMilkyWayMeta().then(setMilkyway).catch(() => undefined);
  }, [open]);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title="Data sources and licences">
        <BookOpen size={12} className="mr-1 inline" />
        Sources
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-void/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Data sources"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="max-h-[80vh] w-full max-w-2xl animate-slideUp overflow-y-auto rounded-lg border border-edge bg-panel p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink">Data sources, methods and licences</h2>
                <p className="mt-1 text-2xs text-dim">
                  Every number on screen comes from one of these. Nothing is synthesised.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="text-dim hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 text-2xs leading-relaxed text-muted">
              <Section title="Star catalogue">
                {stars ? (
                  <>
                    <p>
                      {stars.source} &mdash; {stars.count.toLocaleString()} stars to magnitude{' '}
                      {stars.magnitudeLimit}, epoch {stars.epoch}.
                    </p>
                    <p>{stars.attribution}</p>
                    <p>
                      Licence: {stars.license}.{' '}
                      <Link href={stars.sourceUrl}>{stars.sourceUrl}</Link>
                    </p>
                  </>
                ) : (
                  <p>Loading&hellip;</p>
                )}
              </Section>

              <Section title="All-sky Milky Way texture">
                {milkyway ? (
                  <>
                    <p>{milkyway.source}</p>
                    <p>{milkyway.content}</p>
                    <p>
                      Projection: {milkyway.projection}, {milkyway.frame}. Mapping:{' '}
                      <code className="font-mono text-dim">{milkyway.mapping}</code>.{' '}
                      {milkyway.mappingNote}
                    </p>
                    <p className="text-dim">{milkyway.limitations}</p>
                    <p>
                      {milkyway.rights} <Link href={milkyway.sourceUrl}>{milkyway.sourceUrl}</Link>
                    </p>
                  </>
                ) : (
                  <p>Loading&hellip;</p>
                )}
              </Section>

              <Section title="Astronomical computation">
                <p>
                  Astronomy Engine (Don Cross), MIT licence &mdash; Sun and Moon ephemerides, nutation
                  and precession, sidereal time, rise/set and altitude searches, and the
                  equatorial-to-horizontal rotation used to orient the whole sky.{' '}
                  <Link href="https://github.com/cosinekitty/astronomy">
                    github.com/cosinekitty/astronomy
                  </Link>
                </p>
                <p>
                  Galactic Centre position: Sgr A* at RA 266.41683&deg;, Dec &minus;29.00781&deg;
                  (ICRS). Galactic coordinates use the IAU 1958 pole with J2000 values.
                </p>
              </Section>

              <Section title="Sky brightness and moonlight">
                <p>
                  Moonlight: Krisciunas, K. &amp; Schaefer, B. E. 1991, PASP 103, 1033, &ldquo;A model
                  of the brightness of moonlight&rdquo;.
                </p>
                <p>
                  Limiting magnitude from sky brightness: Schaefer&apos;s visual-detection relation,
                  in the form used alongside Unihedron SQM readings and the Bortle scale.
                </p>
                <p>
                  Airmass: Pickering (2002). Extinction coefficient k = 0.172 mag/airmass, a typical
                  clear-site V-band value.
                </p>
                <p className="text-dim">
                  The renderer&apos;s response to sky brightness is a presentation choice, documented
                  in <code className="font-mono">src/light-pollution/model.ts</code>, not a
                  photometric simulation of any particular camera.
                </p>
              </Section>

              <Section title="Map and place search">
                <p>
                  Basemap tiles from OpenStreetMap, &copy; OpenStreetMap contributors, darkened
                  client-side. No map API key is used. Place search
                  uses OpenStreetMap Nominatim, queried only when you press Search.
                </p>
                <p>
                  Time zones from <code className="font-mono">tz-lookup</code>; local time conversion
                  including daylight saving uses the browser&apos;s own IANA database via{' '}
                  <code className="font-mono">Intl</code>.
                </p>
              </Section>

              <Section title="Deliberate omissions">
                <p>
                  No weather, cloud or precipitation data is used anywhere: it is out of scope by
                  design.
                </p>
                <p>
                  No light-pollution raster is bundled. The published global atlases are either not
                  redistributable or need an API key, and a static site cannot keep a key secret, so
                  the overlay is opt-in with a key you supply and store yourself.
                </p>
              </Section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold text-ink">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
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
