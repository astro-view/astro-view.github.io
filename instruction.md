# Project: AstroView — Milky Way Photography Planner

You are a senior full-stack engineer specializing in scientific visualization, astronomy, WebGL, and modern frontend development.

Your task is to **design, implement, test, and deploy a complete astronomy photography planning website** called **AstroView**.

This is a real project, not a UI mockup or a prototype containing hardcoded fake data.

Build the application in the current working directory, push the complete source code to GitHub, and configure automatic deployment using GitHub Pages.

## 1. GitHub repository and deployment

Repository:

https://github.com/astro-view/astro-view.github.io.git

Production website:

https://astro-view.github.io/

Set up the Git remote:

```bash
git remote add origin https://github.com/astro-view/astro-view.github.io.git
```

If `origin` already exists, inspect it before updating. Do not overwrite unrelated work or force-push.

Requirements:

- Use the `main` branch.
- Create a GitHub Actions workflow at `.github/workflows/deploy.yml`.
- Automatically build and deploy whenever code is pushed to `main`.
- Deploy the compiled `dist/` directory using the official GitHub Pages actions.
- Configure Vite with `base: '/'`, since this is a GitHub Pages root website.
- Ensure that all static assets, textures, and JavaScript bundles load correctly in production.
- Do not require a Node.js server in production.
- Do not commit secrets or API keys.

After implementation, run the production build, execute tests, commit all project files, and push to the repository.

If GitHub authentication or Pages configuration requires manual user action, explain the exact required action. Never claim deployment succeeded without verification.

## 2. Project objective

AstroView is a web-based astrophotography planning tool.

Its primary purpose is to answer:

"If I stand at a particular location on Earth, at a particular date and time, and point my camera in a specific direction using a specific focal length, what will the night sky and Milky Way look like within my camera's field of view?"

The application must provide accurate astronomical positioning and an intuitive photography-oriented interface.

Users should be able to:

1. Select any observation location on a world map.
2. Select a date and local observation time.
3. View the corresponding night sky and Milky Way.
4. Adjust camera focal length, sensor size, and camera orientation.
5. Explore the exact composition within the camera frame.
6. Examine light pollution at the selected location.
7. Compare an ideal dark sky with an estimated light-polluted sky.
8. Find suitable observation periods for the Milky Way.

**Weather forecasting is explicitly out of scope. Do not integrate weather APIs, cloud forecasts, or precipitation data.**

## 3. Technology stack

Use:

- Vite
- React
- TypeScript
- Tailwind CSS
- shadcn/ui or a similarly clean UI component system
- Three.js / WebGL for rendering the celestial sphere
- Astronomy Engine for astronomical computations
- MapLibre GL JS for interactive map selection
- Lucide icons
- GitHub Pages for production hosting

Prefer a fully client-side application.

Do not introduce a backend, database, authentication system, or paid service unless absolutely necessary.

Keep dependencies minimal and avoid unnecessary complexity.

## 4. Design and user experience

Create a visually sophisticated scientific web application.

Design direction:

- Dark navy and near-black background
- Subtle blue accents
- Clean typography
- Minimal scientific instrumentation aesthetic
- Smooth animations
- Responsive layout
- High information density without visual clutter
- Large, immersive sky visualization

Desktop layout:

**Left panel — Location**

- Interactive world map
- Click to select observation coordinates
- Latitude and longitude display
- Location search if a suitable service is available
- Light pollution map overlay
- Selected observation marker

**Center panel — Sky Preview**

This is the primary visual component.

- Accurate star field
- Milky Way rendering
- Horizon and cardinal directions
- Interactive camera orientation
- Real-time FOV changes
- Camera framing information
- Optional coordinate grid
- Galactic Center marker
- Fullscreen mode

**Right panel — Controls**

- Observation date
- Local time
- Camera sensor
- Focal length
- Camera orientation
- Azimuth
- Elevation
- Roll
- Astronomical information
- Light pollution information

**Bottom panel — Time Timeline**

- Interactive observation-time slider
- Play/pause time animation
- Visible astronomical darkness intervals
- Galactic Center elevation over time
- Sunrise and sunset / astronomical twilight boundaries

On smaller screens, use collapsible panels while prioritizing the sky preview.

## 5. Astronomical data sources

Use real astronomical datasets.

### Star catalog

Prefer the HYG Star Database.

Repository:
https://github.com/astronexus/HYG-Database

Requirements:

- Use real star positions, not randomly generated stars.
- Include right ascension, declination, apparent magnitude, and color index.
- Preprocess the catalog into a compact static dataset.
- Start with stars down to approximately magnitude 6.5.
- Preserve source attribution and dataset license requirements.
- Do not download the full Gaia catalog.

### Milky Way visualization

Use a suitable visible-light all-sky panorama or astronomically registered Milky Way texture.

Requirements:

- The image must have a known celestial coordinate mapping.
- Align the Milky Way with the actual celestial sphere.
- The Galactic Center must appear in the correct position.
- Rotate the celestial sphere according to observation location and time.
- Do not use a decorative Milky Way background image that remains fixed while time changes.
- Verify image usage rights and include attribution.
- Prefer a compressed, browser-friendly texture.

If a properly registered and licensed sky texture cannot be obtained, implement the star field and Galactic Center positioning first, and clearly document the missing Milky Way texture rather than fabricating an inaccurate simulation.

### Astronomy calculations

Use Astronomy Engine:

https://github.com/cosinekitty/astronomy

Calculate:

- Sun position
- Moon position
- Moon phase
- Sidereal time
- Astronomical twilight
- Coordinate transformations
- Galactic Center azimuth and elevation
- Rise/set conditions where applicable

Use appropriate reference coordinates and coordinate-frame transformations for the Galactic Center.

Handle the distinction between fixed stellar coordinates and apparent positions.

## 6. Coordinate systems and mathematical accuracy

The astronomy engine must correctly handle:

- Right Ascension and Declination
- Horizontal coordinates (azimuth and altitude)
- Geographic latitude and longitude
- UTC and local civil time
- Sidereal time
- Camera-local coordinate frames
- Projection onto the image plane

Use UTC internally.

Display local observation time using the timezone associated with the selected geographical location.

Handle daylight-saving transitions where applicable.

The camera orientation must be physically consistent with the sky coordinate system.

Use documented azimuth conventions, such as 0° North and 90° East.

Avoid confusing degrees with radians.

Create unit tests for representative locations, dates, and astronomical positions.

## 7. Camera and focal length simulator

This is one of the most important features.

Support:

- Full-frame sensor (36 × 24 mm)
- APS-C sensor
- Custom sensor dimensions
- Focal lengths from 8 mm to 200 mm
- Landscape and portrait orientation
- Azimuth from 0° to 360°
- Elevation from -10° to 90°
- Camera roll

Calculate camera FOV using:

FOV = 2 × atan(sensor_dimension / (2 × focal_length))

Implement a physically correct rectilinear camera projection.

Changing focal length must change the angular field of view rather than simply scaling a static Milky Way image.

Provide presets:

- 14 mm
- 20 mm
- 24 mm
- 35 mm
- 50 mm
- 85 mm

Default camera preset:

Sony A7C, full-frame sensor, 35 mm focal length.

Allow the user to drag the sky preview to change camera azimuth and elevation.

The camera preview should update interactively as parameters change.

## 8. Light pollution simulation

This feature is important, but it must be scientifically transparent.

Use publicly documented light pollution datasets or APIs, subject to their licenses and usage restrictions.

Potential source:
https://www.lightpollutionmap.info/

Support, where data is available:

- Light pollution map overlay
- Estimated sky brightness
- SQM in mag/arcsec²
- Approximate Bortle classification
- Dataset source and observation/model year

Distinguish VIIRS upward radiance from modeled sky brightness.

Do not directly treat VIIRS radiance as SQM.

Provide two display modes:

**Ideal Sky**

Show the astronomical sky without artificial light pollution.

**Estimated Sky**

Apply a simplified model for artificial sky brightness and reduced Milky Way contrast.

Use a clearly documented rendering approximation rather than claiming perfect photographic realism.

Also provide a manual SQM slider so users can compare different light pollution conditions without an external API.

If an external light pollution API requires a secret key, never embed the key in frontend code.

For the initial version, prioritize manual SQM control and a properly licensed static dataset if possible.

Do not implement an insecure API integration merely to complete the feature.

## 9. Moonlight and darkness

Display:

- Moon phase
- Moon altitude
- Moon azimuth
- Moonrise and moonset where defined
- Sun altitude
- Astronomical twilight periods
- Galactic Center altitude

Provide visual information indicating when the sky is astronomically dark.

Account for moonlight in the estimated sky rendering, using a documented approximation if necessary.

Do not confuse Milky Way visibility with Galactic Center visibility.

The Galactic Center may be below the horizon even when other parts of the Milky Way are visible.

## 10. Observation planner

Provide a tool to search for favorable observation times.

Given a selected location and date, identify intervals when:

- The Sun is below -18° altitude
- The Galactic Center is above a user-defined minimum altitude
- Moonlight conditions are favorable

Allow the user to visualize Galactic Center elevation throughout the night.

Keep this module independent from weather forecasts.

For the initial version, a simple time sweep and interval detection algorithm is sufficient.

## 11. Performance and architecture

The application must be suitable for GitHub Pages.

Use:

- Client-side astronomy computations
- GPU-accelerated sky rendering
- Static preprocessed star data
- Compressed textures
- Lazy loading
- Efficient rendering updates
- Responsive canvas resizing

Avoid unnecessarily recomputing astronomical data on every animation frame.

Separate code into logical modules:

- astronomy/
- rendering/
- camera/
- location/
- light-pollution/
- components/
- hooks/
- data/
- tests/

Use strict TypeScript types.

Ensure WebGL resources are properly disposed when components unmount.

Provide graceful fallback messages when WebGL or external resources are unavailable.

## 12. Validation and testing

Accuracy is more important than decorative effects.

Test:

1. Horizontal and vertical FOV calculations.
2. Local time to UTC conversion.
3. Star coordinate transformations.
4. Galactic Center position for representative observations.
5. Sun altitude and astronomical twilight calculations.
6. Camera orientation and projection.
7. Correct behavior when changing focal length.
8. Correct behavior for locations in both hemispheres.
9. Correct behavior when the Galactic Center is below the horizon.
10. Production asset loading on GitHub Pages.

Use trusted astronomy references to validate astronomical calculations.

Do not silently replace failures with fake astronomical values.

## 13. Documentation

Create a comprehensive README.md containing:

- Project overview
- Features
- Screenshots if available
- Technology stack
- Local development instructions
- Data sources and attribution
- Mathematical and modeling assumptions
- Known limitations
- GitHub Pages deployment instructions

Include:

```bash
npm install
npm run dev
npm run build
npm run test
```

Provide a LICENSE file for the project's original code after selecting an appropriate license. Respect third-party license obligations separately.

## 14. Implementation workflow

Work autonomously and implement the project rather than stopping after producing a plan.

Follow these phases:

**Phase 1 — Project foundation**

- Inspect the working directory and Git repository.
- Set up Vite, React, TypeScript and styling.
- Build the responsive application layout.

**Phase 2 — Real astronomy engine**

- Integrate astronomical calculations.
- Prepare the star catalog.
- Implement celestial coordinate transformations.
- Render real stars and astronomical objects.

**Phase 3 — Photography simulation**

- Implement camera sensor and focal length controls.
- Implement accurate FOV and camera projection.
- Add camera orientation controls.
- Render the Milky Way with correct celestial alignment.

**Phase 4 — Planning and light pollution**

- Implement astronomical darkness and Moon information.
- Add Galactic Center elevation timeline.
- Add manual SQM adjustment.
- Implement available light pollution data integration.
- Implement ideal/estimated sky comparison.

**Phase 5 — Quality assurance**

- Run TypeScript checks.
- Run unit tests.
- Build for production.
- Fix errors, warnings and rendering issues.
- Verify no secrets are exposed.

**Phase 6 — GitHub deployment**

- Set the Git remote to:
  https://github.com/astro-view/astro-view.github.io.git
- Create GitHub Actions deployment workflow.
- Commit the project files.
- Push to the `main` branch.
- Verify deployment status if GitHub access is available.
- Report the final website URL and deployment status.

Do not use force push or delete existing repository content without permission.

## 15. Definition of done

The project is complete when:

- The website builds successfully.
- The location map works.
- Date and time controls work.
- Real stars appear at astronomically correct positions.
- The Milky Way is positioned accurately using suitable data.
- Camera focal length and direction change the actual sky composition.
- Sun, Moon and Galactic Center calculations are functional.
- The light pollution module works at least with manual SQM input.
- The GitHub Pages deployment workflow is configured.
- The source code is pushed to the requested repository.

Do not describe unimplemented features as completed.

If any feature cannot be completed, clearly identify what works, what remains incomplete, and why.

**Final instruction: Build the actual working AstroView website, not merely an implementation guide. Prioritize a correct, usable end-to-end application over an elaborate but nonfunctional demonstration.**