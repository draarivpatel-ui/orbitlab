# OrbitLab

**Plan the burn. Prove the orbit.** A mission design workbench with inspectable orbital mechanics, adaptive propagation and independent arrival checks. Open the page, select a mission, and inspect the numerical evidence.

[Open OrbitLab](https://aariv.me/orbitlab/)

## Try it in five seconds

| Showcase | Inspect |
| --- | --- |
| Reach geostationary orbit | Two impulsive burns, transfer geometry and the maneuver budget |
| Follow the Sun with J2 | A 705 km orbit at 98.207970 degrees with 0.9856 degrees/day secular nodal drift |
| Ride a Molniya ellipse | Speed and flight path angle at eccentricity 0.72 |
| Find a Mars launch window | 780 numerical Lambert cells, an arrow-key crosshair and an independently propagated arrival |
| Spend less with three burns | A 44.549707 m/s saving over Hohmann, with the longer flight time shown |

The verification strip recalculates Kepler residuals, Cartesian state reconstruction, vis-viva energy and propagated conserved energy for the selected mission. Select **Verify selected arrival** to integrate a Lambert departure using an independent RK45 solver and measure its endpoint miss.

## What runs here

- Safeguarded elliptic and hyperbolic Kepler solvers, including small-anomaly behavior near the parabolic limit.
- Classical element and state conversions with circular, equatorial and retrograde branches.
- Hohmann, bi-elliptic, combined plane change and multistage rocket equation calculations.
- Zero-revolution universal-variable Lambert solves with a monotone time-of-flight bracket and positive-y boundary refinement. Unsolved cells are masked and excluded from optimization.
- Four numerical departure/flight grids with delta-v and C3 contours, live inspection and accessible data tables.
- Fixed-step RK4 for comparison and adaptive Dormand-Prince RK45 for the interface. Position and velocity have separate absolute error scales.
- Two-body and optional Earth J2 acceleration. Energy checks include the J2 potential instead of treating physical changes in Kepler energy as integrator error.
- Reference orbit exports as a GMAT script, CCSDS 2.0 OEM and SI state CSV. The exported orbit is the inspected reference spacecraft; transfer arcs are a separate design comparison.

## Verified measurements

| Reproduced check | Result |
| --- | --- |
| Numerical launch grids | 3,120 of 3,120 cells converged across four 30x26 windows |
| Mars grid optimum | 6,713.970956 m/s total departure and arrival velocity change |
| Independent Mars optimum arrival | 2.592943 m position miss, 1.13732e-11 relative to arrival radius |
| Independent LEO/GEO optimum arrival | 0.005337 m position miss |
| Reference LEO orbit closure | 0.009325 m after one period at default tolerances |
| Default conserved energy drift | Below 9e-10 relative for all five reference showcases, including J2 |
| Sun synchronous inclination | 98.207969664 degrees at 705 km |
| Bi-elliptic tradeoff | 4,067.470682 m/s versus 4,112.020389 m/s for Hohmann; 1.083402% saving |

These are deterministic calculations, not measured flight performance. Tests check analytic identities, independent integration and explicit tolerances.

## Run and verify

Open `index.html` directly or deploy these files as a static GitHub Pages site. There is no installation, build step, account, external asset or network request in the application.

Node.js 22 or newer is sufficient for the test runner:

```sh
node --test --test-reporter=spec
```

The suite has **178 passing tests**: 156 engine, regression and export checks, 19 DOM runtime checks, and three repository/content checks. DOM tests evaluate the actual HTML and scripts in a small browser contract fixture. They cover every bound control, all presets and windows, animation cleanup, keyboard inspection, letterboxed SVG coordinates, exports, J2 applicability and blocked browser storage.

Syntax verification:

```sh
for file in orbit.js app.js test.js regressions.test.js ui.test.js constraints.test.js tests/dom-harness.cjs; do node --check "$file" || exit 1; done
```

## Engine API

```js
const O = require('./orbit.js');
const C = O.CONSTANTS;
const transfer = O.hohmannTransfer(C.LEO_RADIUS, C.GEO_RADIUS);
const state = O.elementsToState({ a: C.LEO_RADIUS, e: 0 });
const result = O.propagateRK45(state.r, state.v, state.periodSec, {
  relativeTolerance: 1e-10,
  positionTolerance: 0.001,
  velocityTolerance: 0.000001
});
console.log(transfer.totalDv, result.maxEnergyDrift);
```

All internal units are meters, seconds, meters/second, kilograms and radians. Exporters convert OEM and GMAT states to kilometers and kilometers/second. `exportTrajectoryCsv(points, { mu, epoch })` preserves the selected gravitational center and timestamp. `sampleOrbit` starts at the supplied true anomaly.

| File | Role |
| --- | --- |
| `orbit.js` | Shared UMD computation kernel |
| `app.js` | Mission controls, numerical evidence, SVG plots, inspection and exports |
| `index.html`, `style.css` | Responsive workbench and two themes |
| `test.js`, `regressions.test.js` | Analytic, numerical and export tests |
| `ui.test.js`, `tests/dom-harness.cjs` | Shipped-script DOM runtime verification |
| `constraints.test.js` | Repository text, identifiers and local asset checks |
| `DEVPOST_UPGRADE.md` | Submission copy based on reproduced behavior |

## Modeling scope

Launch windows use circular ephemerides and point-mass transfers, with target inclinations included. J2 is available for Earth reference orbits. There is no atmospheric drag, launch ascent, finite thrust, collision avoidance or flight certification. Exactly antipodal Lambert endpoints use an apsidal half-period solution only when its time matches; same-direction collinear geometry fails explicitly. The optional calibrated analytic grid remains a labeled approximation.

GMAT and OEM output is verified structurally and numerically here; execution in external mission tools has not been measured. Solar reference states use ecliptic coordinates and the interface labels their OEM frame `ECLIPJ2000`.

## License

MIT. See [LICENSE](LICENSE).
