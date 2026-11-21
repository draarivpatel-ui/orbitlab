# OrbitLab Wave 2 critique

Scope: `app.js`, `orbit.js`, `style.css`, `index.html`, plus shipped docs. Baseline test suite: 178/178 passing (124 `test.js`, 32 `regressions.test.js`, 19 `ui.test.js`, 3 `constraints.test.js`). Headless-browser baseline at 1440x900 and 390x844: zero console errors, zero external requests, zero page-level horizontal overflow.

## Numerical correctness

I fuzzed 4,000 random Lambert geometries against independent universal-variable propagation: zero endpoint misses above 3e-7 relative (worst 2.8e-7) and zero falsely converged solutions. Edge cases (collinear same-direction, antipodal with wrong flight time, negative time, zero radius, tiny/huge flight times) all fail or close honestly. Kepler solver, J2 conserved-energy formulation, bi-elliptic geometry, staging rocket equation, export epochs/frames, and all printed "Verified measurements" in README were reproduced exactly (3,120/3,120 cells; Mars optimum 6,713.970956 m/s; arrival miss 2.592942 m; Sun-sync inclination 98.207969664 deg; bi-elliptic saving 44.549707 m/s). No numerical defects found.

## Findings

### [must] Stale, wrong telemetry defaults in shipped HTML
`index.html:76` hardcodes `11.86 km2/s2` and `index.html:77` hardcodes `Min dv: 6.714 km/s`. Those are the **Earth-to-Mars** launch-window numbers, but the page boots with the **LEO-to-GEO** window (`app.js:12` `windowPreset: 'leo-geo'`), whose real values are 5.75 km2/s2 and 3.857 km/s (`app.js:284-289` overwrites them on load). Any no-script, pre-hydration, or slow-JS view presents a false metric. Fix: replace the static placeholders with the correct LEO/GEO values.

### [should] J2 switch accessible text is inconsistent between render and interaction
`app.js:320` sets the switch text to `On (full J2 potential)` after a mission change, while `app.js:1509` sets it to `On (J2 = 1.0826e-3)` after a manual toggle. Both are correct physically, but a screen-reader user hears two different labels for the same state. Fix: use one canonical string in both paths.

### [should] DEVPOST_UPGRADE.md reports stale test counts
`DEVPOST_UPGRADE.md:30` claims 176 tests / 18 DOM tests. The actual baseline is 178 tests / 19 DOM tests (README is correct). Fix: sync the Devpost copy.

### [should] README has no verified-date line
`README.md` presents a "Verified measurements" table but no date tying the figures to a verification run. Fix: add a dated verification line.

### [nit] `role="application"` on the porkchop inspector hit rect
`app.js:1210` places `role="application"` on the interactive SVG rect. This is defensible for a custom arrow-key widget, but it suppresses normal screen-reader navigation modes. Leaving as-is; keyboard and live-region behavior verified working.

### [nit] Light-theme series colors below 4.5:1 on page background
`#d64d22`, `#0f8a5f`, `#b87900` give 3.85:1, 3.95:1 and 3.29:1 against the light page. These are used as graphical marks/palette keys (large, non-body text), which WCAG AA treats under the 3:1 graphical-object threshold. No change needed.

### [nit] Hardcoded export epoch 2026-11-08
`app.js:1547`, `1556`, `1565` use a fixed reference epoch for all exports. This is an explicitly fixed reference epoch, documented in README, and is deterministic. Not a defect.

## Browser verification

Both viewports showed `consoleErrors: []`, `externalRequests: []`, `horizontalOverflow: false`. Offenders reported by the check are table nodes inside intentionally scrollable `.table-scroll` wrappers, not page overflow. Full interactive sweep (all five mission buttons, four windows, theme toggle, play/pause, projection change, Lambert verification) produced zero errors in a real headless Chrome session.

## Score

**9.5/10.** The engine and UI are numerically and behaviorally sound. The only real defects are presentation/documentation accuracy issues, not calculation errors.
