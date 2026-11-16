'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('./orbit.js');
const C = O.CONSTANTS, V = O.vectors;
function relative(a, b, tolerance = 1e-9) { assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} versus ${b}`); }
function miss(a, b) { return V.norm(V.sub(a, b)); }
function orbit(e = 0.3, nu = 0.7, i = 0.4) { return { a: 15000000, e, i, raan: 0.6, argPe: 0.9, nu }; }

test('every eccentric orbit sample obeys vis-viva and preserves angular momentum', () => {
  for (const e of [0, 0.1, 0.72, 0.99]) {
    const sampled = O.sampleOrbit(orbit(e), C.MU_EARTH, 101), expected = sampled.state;
    for (const p of sampled.points) {
      relative(V.dot(p.v, p.v) / 2 - C.MU_EARTH / p.radius, -C.MU_EARTH / (2 * expected.semiMajorAxis), 1e-10);
      relative(V.norm(V.cross(p.r, p.v)), expected.hMagnitude, 1e-10);
    }
  }
});
test('sampling honors the initial true anomaly and closes at exactly one period', () => {
  const el = orbit(0.6, 1.3), sampled = O.sampleOrbit(el, C.MU_EARTH, 101), state = O.elementsToState(el);
  assert.ok(miss(sampled.points[0].r, state.r) < 1e-7); assert.ok(miss(sampled.points[0].v, state.v) < 1e-9);
  assert.equal(sampled.points[0].tSec, 0); relative(sampled.points.at(-1).tSec, state.periodSec, 1e-12);
  assert.ok(miss(sampled.points.at(-1).r, state.r) < 1e-6);
});
test('sampling an open orbit fails explicitly', () => {
  assert.throws(() => O.sampleOrbit({ ...orbit(), a: -15000000, e: 1.2 }), RangeError);
});
test('retrograde equatorial circular and eccentric states survive reconstruction', () => {
  for (const e of [0, 0.4]) {
    const s = O.elementsToState(orbit(e, 0.8, Math.PI)), back = O.stateToElements(s.r, s.v), reconstructed = O.elementsToState(back);
    assert.ok(miss(s.r, reconstructed.r) < 1e-6); assert.ok(miss(s.v, reconstructed.v) < 1e-9);
  }
});
test('inclinations near zero and pi use stable angular momentum geometry', () => {
  for (const i of [1e-10, Math.PI - 1e-10]) {
    const s = O.elementsToState(orbit(0, 1.2, i)), back = O.stateToElements(s.r, s.v), reconstructed = O.elementsToState(back);
    assert.ok(miss(s.r, reconstructed.r) < 1e-5); assert.ok(miss(s.v, reconstructed.v) < 1e-8);
  }
});
test('unphysical conics and non finite vectors cannot silently become valid states', () => {
  for (const el of [null, { a: Infinity, e: 0 }, { a: 1000, e: 1 }, { a: 1000, e: 1.2 }, { a: -1000, e: 0.2 }, { a: -1000, e: 2, nu: Math.PI }, { a: 1000, e: 0, i: 4 }]) {
    assert.throws(() => O.elementsToState(el), RangeError);
  }
  for (const mu of [0, -1, Infinity, NaN]) assert.throws(() => O.elementsToState(orbit(), mu), RangeError);
  assert.throws(() => O.stateToElements([7000000, NaN, 0], [0, 7500, 0]), RangeError);
  assert.throws(() => O.stateToElements([7000000, 0], [0, 7500, 0]), RangeError);
});
test('Kepler retains tiny mean anomalies near the elliptic parabolic limit', () => {
  const M = 1e-15, e = 1 - 1e-12, result = O.solveKepler(M, e, 1e-14), E = result.anomaly;
  const stable = (1 - e) * E + e * E ** 3 * (1 / 6 - E ** 2 / 120 + E ** 4 / 5040);
  assert.ok(E > 1e-6); assert.ok(Math.abs(stable - M) / M < 1e-7);
});
test('Kepler handles tiny hyperbolic mean anomalies symmetrically', () => {
  const M = 1e-15, e = 1 + 1e-12, result = O.solveKepler(M, e, 1e-14), H = result.anomaly;
  const stable = (e - 1) * H + e * H ** 3 * (1 / 6 + H ** 2 / 120 + H ** 4 / 5040);
  assert.ok(H > 1e-6); assert.ok(Math.abs(stable - M) / M < 1e-7);
  relative(O.solveKepler(-M, e, 1e-14).anomaly, -H, 1e-13);
});
test('Kepler rejects infinite eccentricity and non finite tolerance', () => {
  assert.throws(() => O.solveKepler(1, Infinity), RangeError); assert.throws(() => O.solveKepler(1, 0.1, Infinity), RangeError);
});
test('Lambert resolves very short transfers at the positive-y boundary', () => {
  const r1 = [7000000, 0, 0], r2 = [0, 8000000, 0];
  for (const seconds of [1, 10, 100]) {
    const lambert = O.solveLambert(r1, r2, seconds); assert.equal(lambert.converged, true);
    const p = O.propagateRK45(r1, lambert.v1, seconds, { relativeTolerance: 1e-11 });
    assert.ok(miss(p.points.at(-1).r, r2) / V.norm(r2) < 1e-7, `seconds=${seconds}`);
  }
});
test('antipodal Hohmann approximation cannot claim convergence at the wrong time', () => {
  const h = O.hohmannTransfer(C.LEO_RADIUS, C.GEO_RADIUS);
  const result = O.solveLambert([C.LEO_RADIUS, 0, 0], [-C.GEO_RADIUS, 0, 0], h.timeOfFlightSec * 1.01);
  assert.equal(result.converged, false); assert.ok(Math.abs(result.residual) > 100);
});
test('antipodal endpoints along the polar axis have a nonzero tangential solution', () => {
  const h = O.hohmannTransfer(C.LEO_RADIUS, C.GEO_RADIUS);
  const result = O.solveLambert([0, 0, C.LEO_RADIUS], [0, 0, -C.GEO_RADIUS], h.timeOfFlightSec);
  assert.equal(result.converged, true); relative(V.norm(result.v1), h.departureTransferSpeed);
});
test('same-direction collinear Lambert endpoints have an explicit geometry error', () => {
  assert.throws(() => O.solveLambert([7000000, 0, 0], [8000000, 0, 0], 1000), RangeError);
});
test('long-way Lambert velocities reach their endpoint under an independent integrator', () => {
  const r1 = [7000000, 0, 0], r2 = [0, 9000000, 0], dt = 8000;
  const lambert = O.solveLambert(r1, r2, dt, C.MU_EARTH, false); assert.equal(lambert.converged, true);
  const p = O.propagateRK45(r1, lambert.v1, dt, { relativeTolerance: 1e-11 });
  assert.ok(miss(p.points.at(-1).r, r2) < 1); assert.ok(V.cross(r1, lambert.v1)[2] < 0);
});
test('failed Lambert cells are masked and cannot become a grid optimum', () => {
  const h = O.hohmannTransfer(C.LEO_RADIUS, C.GEO_RADIUS);
  const g = O.computePorkchopGrid({ preset: 'leo-geo', n1: 0, n2: 0, phase0: Math.PI,
    departureDays: [0, 1], flightDays: [h.timeOfFlightSec / C.DAY * 0.9, h.timeOfFlightSec / C.DAY * 1.1], departureSteps: 2, flightSteps: 2 });
  assert.equal(g.optimal, null); assert.ok(g.cells.every(c => !c.converged && c.totalDv === Infinity));
});
test('porkchop range errors reject zero flight time and reversed windows', () => {
  for (const config of [{ flightDays: [0, 1] }, { departureDays: [2, 1] }, { flightDays: [1, NaN] }]) assert.throws(() => O.computePorkchopGrid(config), RangeError);
});
test('all four 780-cell numerical windows have finite validated optima', () => {
  for (const preset of Object.keys(O.PRESET_WINDOWS)) {
    const g = O.computePorkchopGrid({ preset, departureSteps: 30, flightSteps: 26 });
    assert.equal(g.cells.length, 780); assert.equal(g.optimal.converged, true); assert.ok(g.optimal.departureVelocity.every(Number.isFinite));
    assert.equal(g.minimumTotalDv, Math.min(...g.cells.filter(c => c.converged).map(c => c.totalDv)));
  }
});
test('RK45 closes the high eccentricity Molniya orbit with a controlled error', () => {
  const el = O.PRESETS.find(p => p.id === 'molniya-12h'), s = O.elementsToState(el.elements, el.mu);
  const p = O.propagateRK45(s.r, s.v, s.periodSec, { relativeTolerance: 1e-11, positionTolerance: 0.0001, velocityTolerance: 1e-8 });
  assert.ok(p.maxEnergyDrift < 1e-8); assert.ok(miss(p.points.at(-1).r, s.r) / V.norm(s.r) < 1e-7);
  assert.equal(p.method, 'RK45'); assert.equal(p.points.at(-1).tSec, s.periodSec); assert.ok(p.rejectedSteps > 0);
});
test('the full J2 potential is conserved while the Kepler energy oscillates physically', () => {
  const el = O.PRESETS.find(p => p.id === 'sun-sync-eo1'), s = O.elementsToState(el.elements, el.mu);
  const p = O.propagateRK45(s.r, s.v, s.periodSec, { j2: C.J2_EARTH, relativeTolerance: 1e-11 });
  const spread = Math.max(...p.points.map(p => p.twoBodyEnergy)) - Math.min(...p.points.map(p => p.twoBodyEnergy));
  assert.ok(p.maxEnergyDrift < 1e-8); assert.ok(spread / Math.abs(p.initialEnergy) > 1e-4);
});
test('RK45 propagates backward and accepts a zero duration without artificial steps', () => {
  const s = O.elementsToState(orbit()), forward = O.propagateRK45(s.r, s.v, 2000), last = forward.points.at(-1);
  const back = O.propagateRK45(last.r, last.v, -2000); assert.ok(miss(back.points.at(-1).r, s.r) < 0.1);
  const zero = O.propagateRK45(s.r, s.v, 0); assert.equal(zero.steps, 0); assert.equal(zero.energyDrift, 0);
});
test('RK45 fails explicitly when its step budget or tolerance is invalid', () => {
  const s = O.elementsToState(orbit());
  assert.throws(() => O.propagateRK45(s.r, s.v, 1000, { maxSteps: 1 }), /budget exhausted/);
  assert.throws(() => O.propagateRK45(s.r, s.v, 1000, { relativeTolerance: 0 }), RangeError);
  assert.throws(() => O.propagateRK4(s.r, s.v, 1000, 1.2), RangeError);
  assert.throws(() => O.propagateRK45([0, 0, 0], s.v, 1000), RangeError);
});
test('RK45 energy normalization stays finite for a parabolic initial speed', () => {
  const r = [7000000, 0, 0], v = [0, Math.sqrt(2 * C.MU_EARTH / r[0]), 0];
  const p = O.propagateRK45(r, v, 100); assert.ok(p.points.every(p => Number.isFinite(p.energyDrift)));
});
test('Hohmann lowering labels apsidal speeds and signed burns consistently', () => {
  const h = O.hohmannTransfer(C.GEO_RADIUS, C.LEO_RADIUS);
  assert.ok(h.signedDv1 < 0 && h.signedDv2 < 0); assert.ok(h.transferPeriapsisSpeed > h.transferApoapsisSpeed);
  assert.equal(h.transferPeriapsisSpeed, h.arrivalTransferSpeed);
});
test('bi-elliptic geometry rejects an intermediate apsis below either endpoint', () => {
  assert.throws(() => O.biEllipticTransfer(7000000, 20000000, 10000000), RangeError);
});
test('plane changes normalize periodic angles and reject negative speeds', () => {
  relative(O.combinedPlaneChange(7000, 7000, 3 * Math.PI).dv, 14000);
  assert.throws(() => O.combinedPlaneChange(-1, 1, 0), RangeError);
});
test('stage mass and specific impulse errors are explicit instead of being clamped', () => {
  for (const stage of [{ dryMassKg: -1, propellantMassKg: 1, ispSec: 300 }, { dryMassKg: 1, propellantMassKg: NaN, ispSec: 300 }, { dryMassKg: 1, propellantMassKg: 1, ispSec: 0 }]) {
    assert.throws(() => O.computeStaging([stage], 1000), RangeError);
  }
});
test('GMAT uses a force model, valid local VNB burns and a beginning mission sequence', () => {
  const script = O.exportGmatScript({ elements: { a: 7000000, e: 0 }, burns: [{ dv1: 100 }] });
  assert.ok(script.includes('Create ForceModel OrbitLabForce;')); assert.ok(script.includes('OrbitLabProp.FM = OrbitLabForce;'));
  assert.ok(script.includes('.CoordinateSystem = Local;')); assert.ok(script.includes('.Axes = VNB;')); assert.ok(script.includes('BeginMissionSequence;'));
  assert.ok(!script.includes('NaN')); assert.throws(() => O.exportGmatScript({ spacecraftName: 'bad;name' }), RangeError);
});
test('OEM has one complete metadata block and uses the actual first timestamp', () => {
  const states = [{ tSec: 60, r: [7000000, 0, 0], v: [0, 7500, 0] }, { tSec: 120, r: [7000000, 450000, 0], v: [0, 7500, 0] }];
  const text = O.exportCcsdsOem(states, { epoch: '2026-11-08T00:00:00Z' });
  assert.equal((text.match(/META_START/g) || []).length, 1); assert.ok(text.includes('START_TIME           = 2026-11-08T00:01:00'));
  assert.ok(text.includes('INTERPOLATION_DEGREE = 3'));
  assert.throws(() => O.exportCcsdsOem(states, { objectName: 'bad\nMETA_START' }), RangeError);
});
test('OEM rejects unordered times and invalid epochs', () => {
  const point = { tSec: 0, r: [7000000, 0, 0], v: [0, 7500, 0] };
  assert.throws(() => O.exportCcsdsOem([point, point]), RangeError); assert.throws(() => O.formatEpoch('bad epoch'), RangeError);
});
test('CSV uses the selected gravitational center and export epoch', () => {
  const state = { tSec: 0, r: [C.AU, 0, 0], v: [0, Math.sqrt(C.MU_SUN / C.AU), 0] };
  const row = O.exportTrajectoryCsv([state], { mu: C.MU_SUN, epoch: '2026-11-15T00:00:00Z' }).trim().split('\n')[1].split(',');
  assert.equal(row[0], '2026-11-15T00:00:00.000'); relative(Number(row.at(-1)), -C.MU_SUN / (2 * C.AU));
});
test('OEM metadata STOP_TIME and START_TIME preserve milliseconds to include final state', () => {
  const orbitState = O.elementsToState(orbit());
  const period = 2 * Math.PI * Math.sqrt(Math.pow(orbit().a, 3) / C.MU_EARTH);
  const prop = O.propagateRK45(orbitState.r, orbitState.v, period);
  const oem = O.exportCcsdsOem(prop.points, { epoch: '2026-11-08T00:00:00.000Z' });
  const stopMatch = oem.match(/STOP_TIME\s*=\s*(\S+)/);
  const startMatch = oem.match(/START_TIME\s*=\s*(\S+)/);
  const dataLines = oem.trim().split('\n').filter(line => /^\d{4}-\d{2}-\d{2}T/.test(line));
  assert.equal(startMatch[1], dataLines[0].split(' ')[0]);
  assert.equal(stopMatch[1], dataLines.at(-1).split(' ')[0]);
  assert.match(stopMatch[1], /\.\d{3}$/);
});

