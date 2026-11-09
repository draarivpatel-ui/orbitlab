# OrbitLab

An offline astrodynamics and trajectory analysis console that runs directly in the browser or under Node.js. Zero build step, zero server, and zero external dependencies. The same `orbit.js` UMD computation kernel powers the interactive flight dynamics console and the 125-test suite.

Live site: [https://aariv.me/orbitlab/](https://aariv.me/orbitlab/)

Released 08 Nov 2026 under the MIT license.

## Architecture

| File | Purpose |
| --- | --- |
| `orbit.js` | UMD astrodynamics kernel, usable via `require('./orbit.js')` or `window.OrbitLab` |
| `index.html` | Flight dynamics console layout, telemetry strip, plotting viewports, and data table twins |
| `style.css` | Carbon-graphite dark console and laboratory plotting sheet light mode |
| `app.js` | Perifocal/inertial SVG projections, marching-squares `C3` and `dv` Porkchop contour isolines, and file exporters |
| `test.js` | 125 automated unit tests executed via `node --test test.js` |
| `.nojekyll` | Bypasses Jekyll processing on GitHub Pages |
| `LICENSE` | MIT license |

## Quick Start

Open `index.html` directly from disk (`file://`), or serve the directory with any static HTTP server:

```sh
python3 -m http.server 8080
```

Run the automated test suite in Node.js:

```sh
node --test test.js
```

Use the computation kernel directly from Node.js:

```js
const O = require('./orbit.js');
const C = O.CONSTANTS;

const transfer = O.hohmannTransfer(C.LEO_RADIUS, C.GEO_RADIUS, C.MU_EARTH);
console.log(transfer.totalDv, transfer.timeOfFlightSec / 3600);

const state = O.elementsToState({ a: C.LEO_RADIUS, e: 0, i: 0, raan: 0, argPe: 0, nu: 0 }, C.MU_EARTH);
const back = O.stateToElements(state.r, state.v, C.MU_EARTH);
console.log(back.eccentricity, back.periodSec);
```

## Astrodynamics Kernel API

Internal calculations use SI units: meters (`m`), meters per second (`m/s`), kilograms (`kg`), radians (`rad`), and seconds (`s`). File exporters convert states to kilometers (`km`) and kilometers per second (`km/s`).

### Physical Constants and Presets

`O.CONSTANTS` defines `G0`, `MU_EARTH`, `MU_SUN`, `MU_MOON`, `R_EARTH`, `J2_EARTH`, `AU`, `DAY`, `HOUR`, `LEO_RADIUS`, `GEO_RADIUS`, `MOON_ORBIT_RADIUS`, `SUN_SYNC_DRIFT_DEG_PER_DAY` (`0.9856`), and `CRITICAL_BI_ELLIPTIC_RATIO` (`11.94`). `O.DEG` and `O.RAD` convert between degrees and radians. `O.PRESETS` defines five reference missions, and `O.PRESET_WINDOWS` defines four launch windows.

### Guarded Newton-Raphson Kepler Solver

`O.solveKepler(M, e, tol = 1e-12)` solves `M = E - e*sin(E)` for elliptic orbits (`0 <= e < 1`) and `M = e*sinh(H) - H` for hyperbolic orbits (`e > 1`). Every Newton step is guarded by a monotone bracket `[lo, hi]` with bisection fallback so near-parabolic (`e = 0.9999`) and high-anomaly hyperbolic cases converge without overshoot. Returns `{ anomaly, trueAnomaly, iterations, residual, eccentricity, meanAnomaly, type }`.

### Classical Elements and State Vectors

`O.elementsToState(elements, mu)` maps `{ a, e, i, raan, argPe, nu }` from the perifocal (`PQW`) frame into the inertial (`IJK`) frame and returns `{ r, v }` alongside `specificEnergy`, `h`, `hMagnitude`, `eccentricityVector`, `eccentricity`, `semiMajorAxis`, `semiLatusRectum`, `periodSec`, `periapsisRadius`, `apoapsisRadius`, `periapsisSpeed`, `apoapsisSpeed`, `radius`, and `speed`.

`O.stateToElements(rVec, vVec, mu)` inverts the transformation with explicit non-singular branches for circular inclined orbits (argument of latitude `u`) and circular equatorial orbits (true longitude `l`).

`O.sampleOrbit(elements, mu, samples)` generates uniformly spaced mean anomaly samples around a closed orbit.

### Coplanar and Plane-Change Transfers

`O.hohmannTransfer(r1, r2, mu)` computes `dv1`, `dv2`, `totalDv`, `transferSemiMajorAxis`, `transferEccentricity`, `timeOfFlightSec`, and the circular and apsidal speeds.

`O.biEllipticTransfer(r1, r2, rb, mu)` evaluates a three-burn transfer through intermediate apsis `rb`, returning `dv1`, `dv2`, `dv3`, `totalDv`, `timeOfFlightSec`, `savingsDv`, `savingsPercent`, `radiusRatio`, `criticalRatio` (`11.94`), `aboveCriticalRatio`, and `beatsHohmann`.

`O.combinedPlaneChange(v1, v2, deltaIncRad)` compares a single vector-cosine plane change against a split two-burn sequence.

### Universal-Variable Lambert Solver and Porkchop Contours

`O.solveLambert(r1Vec, r2Vec, dtSec, mu, prograde = true)` solves the two-point boundary-value problem using Bate, Mueller, and White universal variables (`z`) and Stumpff functions `C(z)` and `S(z)` (switching to a 10-term Taylor expansion when `|z| < 1e-4` to prevent catastrophic cancellation near the parabolic transition `z = 0`). Returns `{ v1, v2, a, p, iterations, converged, transferAngleRad, residual, prograde }`.

`O.computePorkchopGrid(config)` evaluates a departure epoch by time-of-flight matrix for `earth-mars`, `earth-venus`, `leo-geo`, or `leo-lunar`. In the browser console, the 30x26 grid (780 cells) runs the full universal-variable Lambert solver on every cell and extracts 2D marching-squares contour isolines for both total `dv` (`km/s`) and characteristic energy `C3` (`km2/s2`).

### RK4 Numerical Integration and J2 Oblateness Precession

`O.propagateRK4(r0, v0, dtSec, steps, options)` integrates the equations of motion with a 4th-order Runge-Kutta stepper, optionally including the Earth `J2` zonal harmonic acceleration (`J2 = 1.08262668e-3`). Returns `points`, `initialEnergy`, `finalEnergy`, `energyDrift`, `maxEnergyDrift`, `raanDriftDegPerDay`, and `argPeDriftDegPerDay`.

`O.j2DriftRates(a, e, inc, mu, j2, bodyRadius)` computes secular nodal regression, apsidal rotation, and mean-motion drift. `O.solveSunSyncInclination(a, e, options)` solves for the retrograde inclination (`98.208 deg` at `705 km`) where nodal precession matches `0.9856 deg/day`.

### Tsiolkovsky Staging and Flight Dynamics Exporters

`O.computeStaging(stages, payloadKg)` evaluates the multi-stage rocket equation (`dv = Isp * g0 * ln(m0/mf)`).

`O.exportGmatScript(mission)` generates a NASA General Mission Analysis Tool (`.script`) file with spacecraft Keplerian elements, `LocalVNB` `ImpulsiveBurn` blocks, `RungeKutta89` propagator settings, and a `MissionSequence`.

`O.exportCcsdsOem(trajectory, meta)` generates a CCSDS 2.0 Orbit Ephemeris Message (`.oem`) in `km` and `km/s` with `UTC` timestamps, `ICRF` / `EME2000` reference frames, and `HERMITE` degree-5 interpolation metadata.

`O.exportTrajectoryCsv(trajectory)` exports a comma-separated state vector and specific energy history.

## Reference Mission Presets

1. `LEO to GEO Comms Transfer`
2. `Sun-Synchronous EO-1 (705 km)`
3. `Molniya 12h High-Eccentricity`
4. `Earth to Mars Rendezvous`
5. `Bi-Elliptic Deep-Space (r2/r1 = 15)`

## Automated Verification

Running `node --test test.js` executes 125 unit tests covering:

- Elliptic and hyperbolic Kepler solver residuals across `0 <= e <= 6`
- Classical element and Cartesian state round trips, vis-viva apsis speeds, and PQW-to-IJK rotation matrix orthonormality
- Hohmann symmetry, bi-elliptic savings above `r2/r1 = 11.94` (`r2/r1 = 15` vs `r2/r1 = 8`), and law-of-cosines combined plane changes
- Universal-variable Lambert convergence against analytical Hohmann velocity vectors, quarter-orbit circular transfers, and angular momentum conservation
- Porkchop matrix dimensions, finite cell invariants, and optimal launch window search
- RK4 two-body specific mechanical energy conservation (`|dE/E0| < 1e-8`), critical inclination (`63.435 deg`), and `0.9856 deg/day` sun-synchronous nodal drift
- Tsiolkovsky stage mass ratios, NASA GMAT `.script` and CCSDS 2.0 `.oem` formatting, CSV state tables, and UMD sandbox loading

## License

MIT. See `LICENSE`.
