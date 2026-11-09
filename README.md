# OrbitLab

An open source orbital mechanics workbench that runs entirely in the browser. No build step, no server, no dependencies. The same `orbit.js` UMD engine powers the interactive page and the Node test suite.

Live site: [https://aariv.me/orbitlab/](https://aariv.me/orbitlab/)

Released 08 Nov 2026 under the MIT license.

## What is here

| File | Purpose |
| --- | --- |
| `orbit.js` | UMD astrodynamics engine, usable with `require('./orbit.js')` or `window.OrbitLab` |
| `index.html` | Mission control page with all chart and table containers |
| `style.css` | Obsidian slate dark theme with a crisp light theme toggle |
| `app.js` | SVG rendering, controls, inspectors, tooltips and file exports |
| `test.js` | 125 unit tests, run with `node --test test.js` |
| `.nojekyll` | Keeps GitHub Pages from filtering the static site |
| `LICENSE` | MIT license |

## Run it

Open `index.html` directly, or serve the directory with any static file server:

```
python3 -m http.server 8080
```

Then visit `http://localhost:8080/`. Fonts load from Google Fonts when online; the system font stack is the fallback.

Run the tests:

```
node --test test.js
```

Use the engine from Node:

```js
const O = require('./orbit.js');

const mu = O.CONSTANTS.MU_EARTH;
const r1 = O.CONSTANTS.LEO_RADIUS;
const r2 = O.CONSTANTS.GEO_RADIUS;

const transfer = O.hohmannTransfer(r1, r2, mu);
console.log(transfer.totalDv, transfer.timeOfFlightSec / 3600);

const state = O.elementsToState({ a: r1, e: 0, i: 0, raan: 0, argPe: 0, nu: 0 }, mu);
const back = O.stateToElements(state.r, state.v, mu);
console.log(back.eccentricity, back.periodSec);
```

## Engine API

All distances are meters, velocities meters per second, masses kilograms, angles radians and times seconds unless a field name says otherwise.

### Constants and presets

`O.CONSTANTS` holds `G0`, `MU_EARTH`, `MU_SUN`, `MU_MOON`, `R_EARTH`, `J2_EARTH`, `AU`, `DAY`, `HOUR`, `LEO_RADIUS`, `GEO_RADIUS`, `MOON_ORBIT_RADIUS`, `SUN_SYNC_DRIFT_DEG_PER_DAY` and `CRITICAL_BI_ELLIPTIC_RATIO`. `O.DEG` and `O.RAD` convert degrees and radians. `O.PRESETS` has five missions. `O.PRESET_WINDOWS` has four launch window definitions.

### Kepler solver

`O.solveKepler(M, e, tol = 1e-12)` solves `M = E - e*sin(E)` for elliptic orbits and `M = e*sinh(H) - H` for hyperbolic orbits. A monotone bracket guards each Newton step. Returns `{ anomaly, trueAnomaly, iterations, residual }` plus `eccentricity`, `meanAnomaly` and `type`.

### Elements and state vectors

`O.elementsToState(elements, mu)` converts `{ a, e, i, raan, argPe, nu }` to `{ r, v }`. Both functions also return `specificEnergy`, `h`, `hMagnitude`, `eccentricityVector`, `eccentricity`, `semiMajorAxis`, `semiLatusRectum`, `periodSec`, `periapsisRadius`, `apoapsisRadius`, `periapsisSpeed`, `apoapsisSpeed`, `radius` and `speed`.

`O.stateToElements(rVec, vVec, mu)` is the inverse and handles circular, equatorial, elliptic and hyperbolic cases.

`O.sampleOrbit(elements, mu, samples)` returns evenly spaced mean anomaly samples with `M`, `E`, `nu`, `r`, `v`, `radius` and `speed`.

### Transfers

`O.hohmannTransfer(r1, r2, mu)` returns `dv1`, `dv2`, `totalDv`, `transferSemiMajorAxis`, `transferEccentricity`, `timeOfFlightSec` and the four speeds involved.

`O.biEllipticTransfer(r1, r2, rb, mu)` returns `dv1`, `dv2`, `dv3`, `totalDv`, `timeOfFlightSec`, `savingsDv`, `radiusRatio`, `criticalRatio`, `aboveCriticalRatio` and `beatsHohmann`. Above a radius ratio of about 11.94 a sufficiently high intermediate apsis can beat Hohmann.

`O.combinedPlaneChange(v1, v2, deltaIncRad)` compares one combined burn with a two burn split. Inputs may be scalars or velocity vectors.

### Lambert and porkchop grids

`O.solveLambert(r1Vec, r2Vec, dtSec, mu, prograde = true)` is a universal variable Bate, Mueller and White style solver using Stumpff functions. Returns `{ v1, v2, a, p, iterations, converged }` plus `transferAngleRad`, `residual` and `prograde`.

`O.computePorkchopGrid(config)` builds a departure epoch by time of flight grid. Pass `preset` as one of `earth-mars`, `earth-venus`, `leo-geo` or `leo-lunar`. Optional fields: `departureSteps`, `flightSteps`, `departureDays`, `flightDays`, `mu`, `r1`, `r2`, `i1`, `i2`, `n1`, `n2`, `phase0`, `prograde` and `method`. Each cell has `c3`, `dvDeparture`, `dvArrival`, `totalDv`, `converged`, `departureDay` and `timeOfFlightDay`. The result also has `minimumTotalDv`, `minimumC3`, `maximumTotalDv`, `optimal`, `optimalCell` and `optimalC3Cell`.

Small grids solve every cell with Lambert. Larger grids use a patched conic approximation calibrated against a Lambert cell, which keeps the page responsive.

### Propagation and J2

`O.propagateRK4(r0, v0, dtSec, steps, options)` integrates central gravity with a fourth order Runge Kutta step. Set `options.mu`, `options.j2` and `options.bodyRadius` to enable the J2 zonal harmonic. Returns `points` (also aliased as `trajectory`), `initialEnergy`, `finalEnergy`, `energyDrift`, `maxEnergyDrift`, `raanDriftDegPerDay` and `argPeDriftDegPerDay`.

`O.j2DriftRates(a, e, inc, mu, j2, bodyRadius)` returns the secular node, apsis and mean motion drift rates. `O.solveSunSyncInclination(a, e, options)` finds the retrograde inclination whose nodal regression matches `0.9856` degrees per day.

### Staging and exports

`O.computeStaging(stages, payloadKg)` applies the Tsiolkovsky rocket equation to a list of `{ name, dryMassKg, propellantMassKg, ispSec }`. Returns `stages`, `initialMassKg`, `totalMassRatio`, `payloadFraction` and `totalDv`.

`O.exportGmatScript(mission)` produces a NASA GMAT `.script` with spacecraft elements, impulsive burns, a propagator and a mission sequence.

`O.exportCcsdsOem(trajectory, meta)` produces a CCSDS 2.0 Orbit Ephemeris Message in kilometers and kilometers per second.

`O.exportTrajectoryCsv(trajectory)` produces a comma separated state history.

## Mission presets

1. `LEO to GEO Comms Transfer`
2. `Sun-Synchronous EO-1 (705 km)`
3. `Molniya 12h High-Eccentricity`
4. `Earth to Mars Rendezvous`
5. `Bi-Elliptic Deep-Space (r2/r1 = 15)`

## Visualizations

The page renders an orbital plane or inertial projection with velocity vectors, apsides, burn markers and a scrubbed spacecraft. It also draws a transfer budget bar chart, a staging breakdown, a porkchop heatmap with a keyboard accessible crosshair inspector, and a relative energy drift line chart. Every chart has an HTML data table twin that exposes the same values. Two or more series always have a legend and direct labels, so identity never depends on color alone.

Downloads are generated in the browser with the same engine values shown on screen: a GMAT `.script`, a CCSDS `.oem` and a trajectory `.csv`.

## Test coverage

`node --test test.js` covers:

- Kepler residuals at low, high and hyperbolic eccentricity
- element and state round trips, energy, angular momentum and eccentricity vectors
- Hohmann timing, bi-elliptic crossover at radius ratios 8 and 15, combined plane changes
- Lambert convergence against analytical Hohmann velocity vectors and boundary value identities
- porkchop grid shape, finite cells and optimal coordinates for several windows
- RK4 two body specific energy conservation below `1e-8`, J2 nodal drift near `0.9856` degrees per day
- Tsiolkovsky staging, GMAT and CCSDS OEM exporters, CSV rows and UMD loading in a VM sandbox
- repository text rules for dashes and forbidden terms

## License

MIT. See `LICENSE`.
