# AstroView

**A Milky Way photography planner.** Pick a place on Earth, a date and time, a sensor and a focal
length, and see what your camera will actually frame.

Live site: **https://astro-view.github.io/**

AstroView answers one question precisely: *if I stand here, at this moment, and point this lens in
this direction, what is in the frame?* It renders the real sky — catalogue stars at their computed
positions, an astrometrically registered Milky Way, the horizon — through a physically correct
rectilinear camera projection, and tells you when the core is up, how dark it will be, and how much
the Moon will cost you.

Everything runs in the browser. There is no backend, no database, no account and no API key.

---

## Features

**Sky preview (the main view)**
- ~8,900 real stars from the HYG Database to magnitude 6.5, with colour from B−V index
- All-sky Milky Way texture registered to J2000 equatorial coordinates (see
  [Milky Way registration](#milky-way-registration) — the registration was *measured*, not assumed)
- Rectilinear projection with the true field of view for the chosen sensor and focal length
- Drag to aim, scroll to change focal length, fullscreen mode
- Horizon, cardinal points, optional equatorial grid, alt/az grid and galactic equator
- Galactic Centre, Moon and Sun markers; labels for named stars
- Frame guides with thirds and the optical axis

**Location**
- Click anywhere on a world map to place the observer
- Place-name search, or type coordinates and elevation directly
- Time zone resolved from the coordinates, with daylight saving handled correctly
- Optional light-pollution tile overlay using *your own* API key (never bundled)

**Camera**
- Full frame, APS-C (Sony/Nikon/Fuji and Canon), Micro Four Thirds, 44×33 medium format, 1 inch,
  or custom sensor dimensions
- Focal length 8–200 mm with 14/20/24/35/50/85 mm presets
- Landscape and portrait, azimuth 0–360°, elevation −10–90°, full roll
- Default preset: Sony A7C, full frame, 35 mm

**Night planning**
- Timeline of the whole night: twilight bands, Galactic Centre altitude, Moon altitude
- Play/pause time animation and a scrubber
- Planner that finds the intervals where the Sun is below −18°, the core is above a chosen
  altitude, and moonlight stays under a chosen penalty
- Sunset/sunrise, astronomical dusk/dawn, moonrise/moonset, core rise/set
- Milky Way band visibility reported *separately* from Galactic Centre altitude

**Light pollution**
- Manual SQM control (16–22 mag/arcsec²) with Bortle classification and site presets
- Ideal dark sky vs. estimated sky comparison
- Moonlight contribution computed with the Krisciunas & Schaefer (1991) model
- Limiting magnitude, moon penalty in magnitudes, effective SQM at the frame centre

**Not included, by design:** weather, cloud cover and precipitation forecasting are explicitly out
of scope.

---

## Technology

Vite · React 18 · TypeScript (strict) · Tailwind CSS · Three.js · Astronomy Engine · MapLibre GL JS ·
Lucide icons · Vitest · GitHub Pages

---

## Local development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check, then build to dist/
npm run test     # 129 unit tests
```

Other scripts:

```bash
npm run preview       # serve the production build locally
npm run data:stars    # rebuild public/data/stars.bin from the HYG Database
npm run data:milkyway # rebuild and re-verify public/data/milkyway.webp
```

The generated datasets are committed, so a normal build never touches the network. The `data:*`
scripts are only needed when changing a source catalogue or a magnitude limit.

---

## Project structure

```
scripts/            dataset preprocessing (HYG catalogue, sky texture + registration check)
src/
  astronomy/        constants, coordinate transforms, time zones, sky state, planner
  camera/           sensor formats, field of view, rectilinear projection
  rendering/        Three.js sky renderer, texture UV mapping
  location/         map panel, place search
  light-pollution/  sky brightness, moonlight, Bortle, render parameters
  components/       UI panels and primitives
  hooks/            central application state
  data/             static dataset loaders
tests/              unit tests
public/data/        preprocessed star catalogue and sky texture
```

---

## Coordinate conventions

These hold throughout the codebase; mixing them is the usual source of silent astronomy bugs.

| Quantity | Convention |
|---|---|
| Angles | **Degrees** in every public API. Radians only inside a function body. |
| Azimuth | 0° = North, increasing **eastward** (90° E, 180° S, 270° W) |
| Altitude | Degrees above the **geometric** horizon |
| Right ascension | **Degrees** 0–360 internally (HYG's hours are converted at build time) |
| Time | UTC internally; local civil time only at the UI boundary |
| EQJ frame | Equatorial J2000/ICRS: x → RA 0h, z → north celestial pole |
| HOR frame | astronomy-engine's: x → north, y → west, z → zenith |
| ENU frame | The renderer's world frame: x → **east**, y → **up**, z → **south** |

The equatorial→horizontal transform comes from `Astronomy.Rotation_EQJ_HOR`, exposed as a 3×3
matrix so all ~8,900 stars are transformed with one matrix multiply instead of 8,900 trigonometric
reductions per frame. Unit tests assert this matrix path agrees with `Astronomy.Horizon` to better
than 0.02° at five locations in both hemispheres.

---

## Data sources and attribution

### Star catalogue

[**HYG Database**](https://github.com/astronexus/HYG-Database) v4.1, compiled by David Nash from
Hipparcos, the Yale Bright Star Catalogue and Gliese. **Licensed CC BY-SA 4.0.**

`scripts/build-star-catalog.mjs` filters to magnitude ≤ 6.5, drops the Sun, converts RA from hours
to degrees, sorts brightest-first and writes a 139 KB `Float32Array` with stride 4
(`[raDeg, decDeg, vmag, colorIndexBV]`). The derived files in `public/data` are redistributed under
CC BY-SA 4.0.

### Milky Way texture

[**Deep Star Maps**](https://svs.gsfc.nasa.gov/3895/) (SVS ID 3895), NASA/Goddard Space Flight
Center Scientific Visualization Studio, `starmap_8k.jpg`, resampled to 4096×2048 WebP (459 KB).
NASA SVS imagery is not copyrighted; credit NASA/GSFC SVS.

It is plotted from the Bright Star, Tycho-2 and UCAC3 catalogues (~100 million stars), so the
Milky Way band is **real integrated starlight**, not an artistic rendering, and it rotates with the
celestial sphere like everything else.

#### Milky Way registration

The SVS page states the map is a plate carrée projection in J2000 celestial coordinates, but does
not state the axis orientation or where RA zero sits. Guessing would have produced a sky that looks
plausible and is wrong everywhere, so the registration was **measured**:

1. The image is high-pass filtered, leaving only point sources.
2. A matched filter sums image brightness at the pixels where the HYG catalogue places the 520 stars
   brighter than magnitude 4, over every axis flip and every pixel offset.
3. The true alignment appears as a single sharp peak **57× above chance**, with no competing peak.

The result:

```
u = ((180 − raDeg) / 360) mod 1        v = (90 − decDeg) / 180
```

— north up, right ascension increasing to the **left**, RA 0h at the horizontal centre: the
conventional "view from inside the celestial sphere" star-chart layout, which is *not* the naive
`u = RA/360` a reader of the SVS description would assume.

Two independent checks confirm it. Fitting the great circle of the bright band puts its pole 2.1°
from the south galactic pole under this mapping (and 25–60° away under every alternative). The
diffuse structure check verifies that the galactic plane is 3.25× brighter than high galactic
latitudes, and that the inner Galaxy outshines the anticentre by 1.34× — the test that catches a
180° longitude error, which a symmetric great-circle fit cannot see.

`scripts/build-milkyway-texture.mjs` re-runs all of this on every dataset rebuild and **refuses to
write the texture** if the measured registration disagrees with the one the renderer uses. The full
report is stored in `public/data/milkyway.meta.json` and asserted by `tests/data.test.ts`.

### Astronomical computation

[**Astronomy Engine**](https://github.com/cosinekitty/astronomy) by Don Cross, MIT licence. Used for
Sun and Moon ephemerides, precession and nutation, sidereal time, rise/set and altitude searches,
and the EQJ→HOR rotation.

Galactic Centre: **Sgr A\*** at RA 266.41683°, Dec −29.00781° (ICRS). Galactic coordinates use the
IAU 1958 system with J2000 pole values (NGP at RA 192.85948°, Dec 27.12825°; galactic longitude of
the NCP 122.93192°).

### Map and search

Basemap tiles from [OpenStreetMap](https://www.openstreetmap.org/copyright), © OpenStreetMap
contributors, darkened client-side with MapLibre's raster paint filters — **no map API key is
used**. Place search uses OpenStreetMap Nominatim and fires only when you press Search, never while
typing. Time zones from `tz-lookup`; DST handling via the browser's own IANA database through `Intl`.

---

## Modelling assumptions

### What is computed from physics

- **Positions.** Star, Sun, Moon and Galactic Centre positions are real ephemeris/catalogue values.
  Nothing is interpolated or invented.
- **Field of view.** `FOV = 2·atan(d / 2f)` — the thin-lens, infinity-focus, rectilinear model.
  Changing focal length changes the *angular* coverage; it never scales a fixed image. Verified in
  tests against published 35 mm-format angles of view.
- **Moonlight.** Krisciunas, K. & Schaefer, B. E. 1991, *PASP* **103**, 1033. Evaluated at the frame
  centre and added to the background **in linear units** before converting back to mag/arcsec².
- **Limiting magnitude.** Schaefer's visual-detection relation,
  `NELM = 7.93 − 5·log₁₀(1 + 10^(4.316 − SQM/5))`. Note this is more conservative than the NELM
  figures Bortle quotes for each class: the formula describes a typical observer, Bortle described
  exceptional ones.
- **Airmass.** Pickering (2002). Extinction coefficient k = 0.172 mag/airmass (clear-site V band).

### Refraction

AstroView uses **geometric (unrefracted) altitudes everywhere**, deliberately:

- the matrix path that positions the stars and the Galactic Centre is geometric, so refracting the
  Sun and Moon would make them inconsistent with everything else on screen;
- the twilight definitions (−6/−12/−18°) are stated for the geometric centre of the Sun, and that
  is what `Astronomy.SearchAltitude` uses;
- astronomy-engine's `'normal'` refraction does *not* fall to zero below the horizon — it clamps its
  formula at −1° and tapers linearly to the nadir, adding a non-physical **+0.52°** at an altitude
  of −18°, which would make the displayed Sun altitude disagree with the computed dusk time.

Refraction only matters within about half a degree of the horizon, and `SearchRiseSet` applies its
own atmosphere model for rise and set times.

### What is *not* a physical simulation

**Sky brightness is an input, not a prediction.** AstroView does not claim to know how bright your
sky is. You supply an SQM reading, pick a preset, or read a value off a published atlas; it then
shows you consistently what that implies.

**The rendering response is a presentation choice**, documented in `src/light-pollution/model.ts`:
background level rises with luminance normalised to a Bortle 8 sky, Milky Way contrast falls with
the ratio of natural to actual background, and the star cut-off is the computed naked-eye limiting
magnitude plus one magnitude (a camera on a tripod reaches deeper than the eye). It reproduces the
loss of faint stars, the collapse of Milky Way contrast and the glow — not the photometric response
of a particular camera and raw converter.

**VIIRS upward radiance is not treated as sky brightness.** Upward radiance measures light leaving
the ground towards the satellite; zenith sky brightness is scattered light coming back down. The two
are related only through an atmospheric scattering model (Falchi et al. 2016). Where a radiance
figure appears it is labelled as radiance, and any derived brightness is marked indicative.

**Milky Way visibility ≠ Galactic Centre visibility.** The core can be below the horizon while much
of the band is well placed. Both are reported, separately.

---

## Known limitations

- **Texture resolution.** The sky texture is 4096×2048, i.e. 0.088°/pixel. At 200 mm on full frame
  (10.3° horizontal) the Milky Way is only ~117 texture pixels wide and looks soft. Stars from the
  catalogue stay sharp at any focal length; the diffuse band does not. 8192×4096 was rejected
  because it is not reliably supported on mobile GPUs.
- **Polar smearing in the texture.** Within roughly 20° of the celestial poles the source map smears
  stars horizontally — an artefact of the equirectangular projection in the NASA original, not of
  this app. The catalogue stars drawn on top are unaffected.
- **Double-drawn stars.** The texture contains stars *and* the catalogue draws them, so bright stars
  have a soft texture halo under a sharp point. This is deliberate: the texture supplies the
  integrated faint-star glow that makes the band, the catalogue supplies accurate bright stars.
- **No proper motion.** Catalogue positions are J2000 and are not propagated to the observation
  date. For naked-eye stars over a century this is well under a pixel at any usable focal length.
- **No deep-sky objects.** Only stars and the Milky Way band; no nebula or galaxy catalogue.
- **No atmospheric extinction in the render.** Objects near the horizon are not dimmed or reddened,
  though airmass is computed and used by the moonlight model.
- **No terrain horizon.** The horizon is the geometric one at the observer's elevation; hills,
  buildings and trees are not modelled.
- **Light pollution overlay needs your own key.** No raster is bundled — see below.
- **Planner granularity.** The sweep samples every 5 minutes; window boundaries are accurate to
  about that.
- **Elevation is not looked up.** Enter it manually; it is used for the observer's position, not for
  a terrain horizon.

---

## Light pollution overlay

No light-pollution raster is bundled. The well-known global atlases are either not redistributable
or require an API key, and **a static site cannot keep an API key secret** — anything shipped in the
bundle is readable by every visitor.

So the overlay is opt-in and uses a key *you* supply. It is stored only in your own browser's
`localStorage` and is sent only to lightpollutionmap.info when it requests tiles. Without a key, the
manual SQM control is the supported path and works entirely offline.

---

## Deployment

The site deploys automatically to GitHub Pages on every push to `main`, via
`.github/workflows/deploy.yml`, which type-checks, runs the tests and builds before publishing
`dist/` with the official Pages actions. A failing test blocks the deployment.

Vite is configured with `base: '/'` because this is a GitHub Pages **root** site
(`astro-view.github.io`). On a project site the base would need to be `/<repo-name>/`.

### One-time repository setup

GitHub Pages must be switched to the Actions source before the first deployment can succeed:

1. Open **Settings → Pages** in the repository.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).

No secrets need to be configured: the workflow uses the built-in `GITHUB_TOKEN` with the `pages:
write` and `id-token: write` permissions declared in the workflow file.

---

## Licence

This project's own source code is [MIT](LICENSE). The bundled datasets carry their own terms, which
the MIT licence does not override — the HYG-derived files are CC BY-SA 4.0, and the sky texture is
NASA/GSFC SVS imagery. See [LICENSE](LICENSE) for the full statement.
