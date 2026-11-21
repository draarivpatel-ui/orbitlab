# OrbitLab submission upgrade

## Inspiration

Orbital mechanics becomes tangible when a judge can move a spacecraft, see its velocity change, and ask whether a computed transfer actually arrives. We wanted mission design to fit into a browser tab while keeping the equations and numerical evidence inspectable.

## What it does

OrbitLab offers five immediate missions: a geostationary transfer, Sun synchronous observation, Molniya apogee dwell, a Mars launch window, and a bi-elliptic maneuver tradeoff. It connects trajectory plots, maneuver budgets, staging, conserved energy, tables and reference orbit exports. The transfer grid has an arrow-key inspector and an arrival check that propagates the selected departure independently.

## How we built it

A shared JavaScript computation kernel solves Kepler's equation, rotates classical elements into state vectors, brackets universal-variable Lambert flight times, and integrates two-body or Earth J2 motion. Adaptive Dormand-Prince RK45 uses separate position and velocity error scales. Responsive SVG charts expose the actual values used in the plots. GitHub Pages serves the same files directly, with no external assets or runtime dependencies.

## Challenges

A solver can report a small residual while still producing a misleading application. We corrected an eccentric-anomaly velocity factor, tiny-anomaly cancellation, retrograde equatorial reconstruction, and a Lambert bracket that could skip short-flight solutions. We also replaced the J2 energy check with the conserved full potential, excluded unsolved grid cells from optimization, corrected physical axis labels, and repaired ephemeris metadata and gravitational-center handling.

## Accomplishments

- Five one-click scenarios backed by live numerical checks.
- Independent arrival verification for the selected Lambert transfer.
- Earth J2 applicability and Sun synchronous inclination shown directly.
- A visible fuel-versus-time tradeoff for the three-burn maneuver.
- Keyboard controls, accessible tables, two themes and animation cleanup.
- Reference exports whose center, epoch and coordinate frame follow the inspected orbit.

## Verification numbers

The command `node --test --test-reporter=spec` passes 178 tests, including 19 shipped-script DOM runtime tests. All seven JavaScript and fixture files pass `node --check`.

The four 30x26 numerical windows converge in all 3,120 cells. The selected Mars optimum costs 6,713.970956 m/s and misses its independently propagated arrival by 2.592943 m, or 1.13732e-11 relative to the arrival radius. The LEO/GEO optimum misses by 0.005337 m. Default conserved energy drift remains below 9e-10 across all five reference showcases. The Sun synchronous solution is 98.207969664 degrees, with 0.9856 degrees/day secular nodal drift.

At a radius ratio of 15 and intermediate radius ratio of 50, the bi-elliptic maneuver saves 44.549707 m/s, or 1.083402%, while taking 872,050.061 seconds versus 62,832.086 seconds for Hohmann. That cost is presented as a design tradeoff.

## What's next

Add ephemerides for actual departure dates, finite-thrust propagation, richer central-body models and validation in external mission tools. Current launch windows use circular ephemerides; exported reference scripts and OEM files have structural tests but have not been executed in those external tools. Browser layout is supported by responsive styles and DOM contract tests; rendered screenshots were not measured in this verification run.
