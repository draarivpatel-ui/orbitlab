/* OrbitLab unit tests. Run with: node --test test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const O = require('./orbit.js');
const C = O.CONSTANTS;
const V = O.vectors;
const TAU = O.TAU;
const RAD = O.RAD;

function close(actual, expected, tol, label) {
  assert.ok(Math.abs(actual - expected) <= tol,
    `${label || 'value'}: expected ${expected}, got ${actual}, tolerance ${tol}`);
}
function relative(actual, expected, tol, label) {
  const err = Math.abs((actual - expected) / (expected || 1));
  assert.ok(err <= tol, `${label || 'value'}: expected ${expected}, got ${actual}, relative error ${err}`);
}
function angleClose(actual, expected, tol, label) {
  let d = (actual - expected) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  assert.ok(Math.abs(d) <= tol, `${label || 'angle'}: expected ${expected}, got ${actual}, diff ${d}`);
}
function vectorClose(actual, expected, tol, label) {
  assert.equal(actual.length, 3, `${label}: expected a 3 vector`);
  assert.ok(V.norm(V.sub(actual, expected)) <= tol,
    `${label || 'vector'}: expected ${expected.join(',')}, got ${actual.join(',')}`);
}
function finite(value, label) {
  assert.ok(Number.isFinite(value), `${label || 'value'} must be finite, got ${value}`);
}

/* --------------------------------------------------------------- */
/* Kepler equation                                                  */
/* --------------------------------------------------------------- */
const KEPLER_CASES = [
  { M: 0, e: 0 }, { M: 0.25, e: 0 }, { M: 1.0, e: 0 }, { M: 3.0, e: 0 },
  { M: 0.1, e: 0.01 }, { M: 0.5, e: 0.05 }, { M: 1.0, e: 0.1 },
  { M: 2.5, e: 0.3 }, { M: 0.01, e: 0.7 }, { M: 0.001, e: 0.9 },
  { M: 0.5, e: 0.95 }, { M: 3.1, e: 0.99 }, { M: -0.7, e: 0.2 },
  { M: 5.9, e: 0.8 }, { M: 12.0, e: 0.6 }
];
KEPLER_CASES.forEach((c, i) => {
  test(`Kepler elliptic case ${i + 1}: M=${c.M}, e=${c.e} satisfies M = E - e sin E`, () => {
    const s = O.solveKepler(c.M, c.e);
    finite(s.anomaly, 'anomaly');
    finite(s.trueAnomaly, 'true anomaly');
    assert.equal(s.type, 'elliptic');
    assert.ok(s.residual <= 1e-10, `residual ${s.residual}`);
    assert.ok(s.iterations >= 1 && s.iterations <= 120);
    const Mn = ((c.M + Math.PI) % TAU + TAU) % TAU - Math.PI;
    close(s.anomaly - c.e * Math.sin(s.anomaly), Mn, 1e-10, 'Kepler residual');
    const tanHalf = Math.sqrt((1 + c.e) / (1 - c.e)) * Math.tan(s.anomaly / 2);
    angleClose(2 * Math.atan(tanHalf), s.trueAnomaly, 1e-9, 'true anomaly identity');
  });
});

const HYPERBOLIC_CASES = [
  { M: 1, e: 1.2 }, { M: 5, e: 1.5 }, { M: 10, e: 2.5 },
  { M: 50, e: 3.0 }, { M: 0.1, e: 1.01 }, { M: 100, e: 6.0 },
  { M: -3, e: 1.8 }, { M: -20, e: 2.2 }
];
HYPERBOLIC_CASES.forEach((c, i) => {
  test(`Kepler hyperbolic case ${i + 1}: M=${c.M}, e=${c.e} satisfies M = e sinh H - H`, () => {
    const s = O.solveKepler(c.M, c.e);
    finite(s.anomaly, 'hyperbolic anomaly');
    assert.equal(s.type, 'hyperbolic');
    assert.ok(s.iterations >= 1);
    close(c.e * Math.sinh(s.anomaly) - s.anomaly, c.M, 1e-8, 'hyperbolic Kepler residual');
    assert.ok(s.residual <= 1e-9, `residual ${s.residual}`);
    assert.ok(Math.abs(s.trueAnomaly) < Math.PI, 'hyperbolic true anomaly is bounded');
  });
});

test('Kepler circular orbit returns E = M and nu = M', () => {
  const s = O.solveKepler(1.2345, 0);
  close(s.anomaly, 1.2345, 1e-14);
  angleClose(s.trueAnomaly, 1.2345, 1e-12);
  assert.equal(s.residual, 0);
});
test('Kepler solver accepts a custom tolerance', () => {
  const s = O.solveKepler(0.7, 0.8, 1e-15);
  assert.ok(s.residual <= 1e-14);
});
test('Kepler solver rejects invalid eccentricity and mean anomaly', () => {
  assert.throws(() => O.solveKepler(1, -0.1), RangeError);
  assert.throws(() => O.solveKepler(1, 1), RangeError);
  assert.throws(() => O.solveKepler(NaN, 0.5), RangeError);
});
test('Kepler high eccentricity near periapsis converges without overshoot', () => {
  const s = O.solveKepler(1e-7, 0.9999);
  assert.ok(s.anomaly >= 0 && s.anomaly < 0.1);
  assert.ok(s.residual <= 1e-11);
});
test('Kepler true anomaly is antisymmetric with mean anomaly for elliptic orbits', () => {
  const a = O.solveKepler(0.8, 0.6);
  const b = O.solveKepler(-0.8, 0.6);
  close(a.trueAnomaly, -b.trueAnomaly, 1e-10);
});

/* --------------------------------------------------------------- */
/* Element and state conversion                                     */
/* --------------------------------------------------------------- */
const ROUND_TRIP_CASES = [
  { a: 7000000, e: 0, i: 0, raan: 0, argPe: 0, nu: 0.4 },
  { a: 10000000, e: 0.3, i: 0.4, raan: 0.7, argPe: 1.1, nu: 0.9 },
  { a: 26554000, e: 0.72, i: 63.4 * RAD, raan: 210 * RAD, argPe: 270 * RAD, nu: 2.1 },
  { a: 42164000, e: 0.0001, i: 0.02, raan: 5.5, argPe: 4.4, nu: 3.0 },
  { a: 12000000, e: 0.55, i: 1.2, raan: 2.2, argPe: 0.3, nu: 5.7 },
  { a: 8000000, e: 0.05, i: 1.71, raan: 0.0, argPe: 0.0, nu: 4.2 }
];
ROUND_TRIP_CASES.forEach((el, i) => {
  test(`elementsToState round trip ${i + 1} preserves all six elements`, () => {
    const s = O.elementsToState(el, C.MU_EARTH);
    const back = O.stateToElements(s.r, s.v, C.MU_EARTH);
    relative(back.a, el.a, 1e-11, 'semi major axis');
    close(back.e, el.e, 1e-10, 'eccentricity');
    close(back.i, el.i, 1e-10, 'inclination');
    angleClose(back.raan, el.raan, 1e-10, 'RAAN');
    angleClose(back.argPe, el.argPe, 1e-10, 'argument of periapsis');
    angleClose(back.nu, el.nu, 1e-9, 'true anomaly');
    const rebuild = O.elementsToState(back, C.MU_EARTH);
    vectorClose(rebuild.r, s.r, 1e-5, 'rebuilt position');
    vectorClose(rebuild.v, s.v, 1e-8, 'rebuilt velocity');
  });
});

test('elementsToState returns energy, h vector, eccentricity vector and period', () => {
  const el = { a: 10000000, e: 0.2, i: 0.3, raan: 0.4, argPe: 0.5, nu: 0.6 };
  const s = O.elementsToState(el, C.MU_EARTH);
  relative(s.specificEnergy, -C.MU_EARTH / (2 * el.a), 1e-12, 'energy');
  relative(s.hMagnitude, Math.sqrt(C.MU_EARTH * el.a * (1 - el.e ** 2)), 1e-12, 'h magnitude');
  close(s.eccentricity, el.e, 1e-12, 'eccentricity vector magnitude');
  relative(s.periodSec, TAU * Math.sqrt(el.a ** 3 / C.MU_EARTH), 1e-12, 'period');
});
test('derived orbit reports correct periapsis and apoapsis radii', () => {
  const el = { a: 20000000, e: 0.4, i: 0, raan: 0, argPe: 0, nu: 0 };
  const s = O.elementsToState(el, C.MU_EARTH);
  relative(s.periapsisRadius, el.a * (1 - el.e), 1e-12, 'periapsis');
  relative(s.apoapsisRadius, el.a * (1 + el.e), 1e-12, 'apoapsis');
});
test('periapsis and apoapsis speeds obey vis viva', () => {
  const el = { a: 12000000, e: 0.25, i: 0, raan: 0, argPe: 0, nu: 0 };
  const s = O.elementsToState(el, C.MU_EARTH);
  relative(s.periapsisSpeed, Math.sqrt(C.MU_EARTH * (2 / s.periapsisRadius - 1 / el.a)), 1e-12, 'vp');
  relative(s.apoapsisSpeed, Math.sqrt(C.MU_EARTH * (2 / s.apoapsisRadius - 1 / el.a)), 1e-12, 'va');
});
test('angular momentum is perpendicular to the orbital plane', () => {
  const el = { a: 9000000, e: 0.1, i: 0.5, raan: 1.0, argPe: 0.2, nu: 2.0 };
  const s = O.elementsToState(el, C.MU_EARTH);
  close(V.dot(s.h, s.r), 0, 1e-6, 'h dot r');
  close(V.dot(s.h, s.v) / (V.norm(s.h) * V.norm(s.v)), 0, 1e-12, 'h dot v normalized');
  close(V.dot(s.eccentricityVector, s.h) / V.norm(s.h), 0, 1e-12, 'e dot h normalized');
});
test('stateToElements handles circular equatorial orbit without singularities', () => {
  const r = [C.LEO_RADIUS, 0, 0];
  const v = [0, Math.sqrt(C.MU_EARTH / C.LEO_RADIUS), 0];
  const el = O.stateToElements(r, v, C.MU_EARTH);
  close(el.e, 0, 1e-12);
  close(el.i, 0, 1e-12);
  relative(el.a, C.LEO_RADIUS, 1e-12);
  finite(el.nu, 'true longitude');
});
test('stateToElements handles circular inclined orbit via argument of latitude', () => {
  const inc = 0.7, u = 1.1;
  const r = [C.LEO_RADIUS * Math.cos(u), C.LEO_RADIUS * Math.sin(u) * Math.cos(inc), C.LEO_RADIUS * Math.sin(u) * Math.sin(inc)];
  const vMag = Math.sqrt(C.MU_EARTH / C.LEO_RADIUS);
  const v = [-vMag * Math.sin(u), vMag * Math.cos(u) * Math.cos(inc), vMag * Math.cos(u) * Math.sin(inc)];
  const el = O.stateToElements(r, v, C.MU_EARTH);
  close(el.i, inc, 1e-12, 'inclination');
  close(el.e, 0, 1e-12, 'eccentricity');
  angleClose(el.nu, u, 1e-9, 'argument of latitude');
});
test('stateToElements detects a hyperbolic orbit', () => {
  const el = { a: -20000000, e: 2.5, i: 0.2, raan: 0.1, argPe: 0.3, nu: 0.5 };
  const s = O.elementsToState(el, C.MU_EARTH);
  const back = O.stateToElements(s.r, s.v, C.MU_EARTH);
  assert.ok(back.a < 0, 'negative semi major axis');
  relative(back.a, el.a, 1e-10, 'hyperbolic a');
  close(back.e, el.e, 1e-9, 'hyperbolic e');
  relative(back.specificEnergy, -C.MU_EARTH / (2 * el.a), 1e-12);
});
test('PQW to IJK rotation matrix is orthonormal', () => {
  const m = V.pqwToIjkMatrix(0.8, 0.5, 1.3);
  for (let i = 0; i < 3; i++) {
    close(V.dot(m[i], m[i]), 1, 1e-12, `row ${i} unit length`);
    for (let j = i + 1; j < 3; j++) close(V.dot(m[i], m[j]), 0, 1e-12, `rows ${i},${j} orthogonal`);
  }
});
test('elementsToState rejects invalid semi major axis and eccentricity', () => {
  assert.throws(() => O.elementsToState({ a: 0, e: 0, i: 0, raan: 0, argPe: 0, nu: 0 }), RangeError);
  assert.throws(() => O.elementsToState({ a: 1e7, e: -1, i: 0, raan: 0, argPe: 0, nu: 0 }), RangeError);
});
test('stateToElements rejects zero position and radial trajectory', () => {
  assert.throws(() => O.stateToElements([0, 0, 0], [1, 0, 0]), RangeError);
  assert.throws(() => O.stateToElements([7000000, 0, 0], [1000, 0, 0]), RangeError);
});
test('sampleOrbit returns uniform mean anomaly samples on the correct period', () => {
  const el = { a: 10000000, e: 0.2, i: 0, raan: 0, argPe: 0, nu: 0 };
  const s = O.sampleOrbit(el, C.MU_EARTH, 64);
  assert.equal(s.points.length, 64);
  close(s.points[0].M, 0, 1e-12);
  close(s.points[63].M, TAU, 1e-12);
  relative(s.points[63].tSec, s.periodSec, 1e-9, 'period');
  s.points.forEach((p, i) => {
    close(p.radius, el.a * (1 - el.e * Math.cos(p.E)), 1e-5, `radius ${i}`);
  });
});

/* --------------------------------------------------------------- */
/* Transfers and plane changes                                      */
/* --------------------------------------------------------------- */
test('Hohmann LEO to GEO delta v matches the analytic two impulse solution', () => {
  const r1 = C.LEO_RADIUS, r2 = C.GEO_RADIUS, mu = C.MU_EARTH;
  const h = O.hohmannTransfer(r1, r2, mu);
  const at = (r1 + r2) / 2;
  const dv1 = Math.sqrt(mu * (2 / r1 - 1 / at)) - Math.sqrt(mu / r1);
  const dv2 = Math.sqrt(mu / r2) - Math.sqrt(mu * (2 / r2 - 1 / at));
  relative(h.dv1, dv1, 1e-12, 'dv1');
  relative(h.dv2, dv2, 1e-12, 'dv2');
  relative(h.totalDv, dv1 + dv2, 1e-12, 'total dv');
  relative(h.transferSemiMajorAxis, at, 1e-12, 'transfer a');
  relative(h.transferEccentricity, (r2 - r1) / (r2 + r1), 1e-12, 'transfer e');
  relative(h.timeOfFlightSec, Math.PI * Math.sqrt(at ** 3 / mu), 1e-12, 'time of flight');
});
test('Hohmann transfer is symmetric for a raise and a lower', () => {
  const up = O.hohmannTransfer(C.LEO_RADIUS, C.GEO_RADIUS, C.MU_EARTH);
  const down = O.hohmannTransfer(C.GEO_RADIUS, C.LEO_RADIUS, C.MU_EARTH);
  relative(up.totalDv, down.totalDv, 1e-12, 'symmetric dv');
  relative(up.timeOfFlightSec, down.timeOfFlightSec, 1e-12, 'symmetric tof');
});
test('Hohmann same radius transfer costs zero delta v', () => {
  const h = O.hohmannTransfer(C.GEO_RADIUS, C.GEO_RADIUS, C.MU_EARTH);
  close(h.totalDv, 0, 1e-9);
  close(h.transferEccentricity, 0, 1e-12);
});
test('Hohmann rejects nonpositive radii', () => {
  assert.throws(() => O.hohmannTransfer(0, C.GEO_RADIUS), RangeError);
  assert.throws(() => O.hohmannTransfer(C.LEO_RADIUS, -1), RangeError);
});
test('Bi-elliptic with r2/r1 = 15 saves delta v over Hohmann', () => {
  const r1 = C.LEO_RADIUS, r2 = 15 * r1, rb = 50 * r1;
  const b = O.biEllipticTransfer(r1, r2, rb, C.MU_EARTH);
  assert.ok(b.beatsHohmann, `expected savings, got ${b.savingsDv}`);
  assert.ok(b.savingsDv > 0, 'positive savings');
  assert.equal(b.aboveCriticalRatio, true);
  relative(b.radiusRatio, 15, 1e-12);
  close(b.totalDv, b.dv1 + b.dv2 + b.dv3, 1e-9, 'three burn sum');
});
test('Bi-elliptic with r2/r1 = 8 does not save delta v over Hohmann', () => {
  const r1 = C.LEO_RADIUS, r2 = 8 * r1, rb = 50 * r1;
  const b = O.biEllipticTransfer(r1, r2, rb, C.MU_EARTH);
  assert.equal(b.beatsHohmann, false);
  assert.ok(b.savingsDv < 0, 'negative savings');
  assert.equal(b.aboveCriticalRatio, false);
  assert.ok(b.radiusRatio < C.CRITICAL_BI_ELLIPTIC_RATIO);
});
test('Bi-elliptic critical ratio is 11.94 as documented', () => {
  const b = O.biEllipticTransfer(1e7, 1.2e8, 5e8, C.MU_EARTH);
  close(b.criticalRatio, 11.94, 1e-12);
});
test('Bi-elliptic time of flight is the sum of two half periods', () => {
  const r1 = 7000000, r2 = 1.05e8, rb = 3.5e8;
  const a1 = (r1 + rb) / 2, a2 = (r2 + rb) / 2;
  const b = O.biEllipticTransfer(r1, r2, rb, C.MU_EARTH);
  relative(b.timeOfFlightSec,
    Math.PI * Math.sqrt(a1 ** 3 / C.MU_EARTH) + Math.PI * Math.sqrt(a2 ** 3 / C.MU_EARTH),
    1e-12, 'bi-elliptic tof');
  assert.ok(b.timeOfFlightSec > b.hohmannTimeOfFlightSec, 'longer than Hohmann');
});
test('Bi-elliptic with rb equal to r2 reduces to a two impulse Hohmann raise', () => {
  const r1 = C.LEO_RADIUS, r2 = C.GEO_RADIUS;
  const b = O.biEllipticTransfer(r1, r2, r2, C.MU_EARTH);
  const h = O.hohmannTransfer(r1, r2, C.MU_EARTH);
  relative(b.totalDv, h.totalDv, 1e-12, 'dv degenerates to Hohmann');
  relative(b.timeOfFlightSec, h.timeOfFlightSec, 1e-12, 'one transfer half period');
  close(b.dv1, h.dv1, 1e-9, 'first burn matches Hohmann');
  close(b.dv2 + b.dv3, h.dv2, 1e-9, 'remaining burns sum to the circularization burn');
});
test('Bi-elliptic rejects nonpositive radii', () => {
  assert.throws(() => O.biEllipticTransfer(0, 1e7, 2e7), RangeError);
  assert.throws(() => O.biEllipticTransfer(1e7, 1e7, 0), RangeError);
});
test('Combined plane change uses the law of cosines', () => {
  const v1 = 7700, v2 = 3000, di = 0.5;
  const c = O.combinedPlaneChange(v1, v2, di);
  relative(c.dv, Math.sqrt(v1 ** 2 + v2 ** 2 - 2 * v1 * v2 * Math.cos(di)), 1e-12);
  assert.ok(c.dv <= c.twoBurnSplitCost + 1e-9, 'combined burn is no more expensive');
});
test('Zero plane change combined burn equals the speed difference', () => {
  const c = O.combinedPlaneChange(7700, 3000, 0);
  close(c.dv, 4700, 1e-9);
  close(c.twoBurnSplitCost, 4700, 1e-9);
  close(c.savingsDv, 0, 1e-9);
});
test('Ninety degree plane change at equal speeds equals sqrt(2) v', () => {
  const v = 7700;
  const c = O.combinedPlaneChange(v, v, Math.PI / 2);
  relative(c.dv, Math.SQRT2 * v, 1e-12);
});
test('Combined plane change accepts velocity vectors', () => {
  const c = O.combinedPlaneChange([3000, 0, 0], [0, 4000, 0], Math.PI / 2);
  relative(c.v1, 3000, 1e-12);
  relative(c.v2, 4000, 1e-12);
  finite(c.dv, 'combined dv');
});
test('Combined plane change is symmetric in the speed arguments', () => {
  const a = O.combinedPlaneChange(7700, 3000, 0.4);
  const b = O.combinedPlaneChange(3000, 7700, 0.4);
  close(a.dv, b.dv, 1e-9);
});

/* --------------------------------------------------------------- */
/* Lambert solver                                                   */
/* --------------------------------------------------------------- */
test('Lambert solver matches analytical Hohmann departure velocity vectors', () => {
  const r1 = [C.LEO_RADIUS, 0, 0], r2 = [-C.GEO_RADIUS, 0, 0];
  const h = O.hohmannTransfer(C.LEO_RADIUS, C.GEO_RADIUS, C.MU_EARTH);
  const lam = O.solveLambert(r1, r2, h.timeOfFlightSec, C.MU_EARTH, true);
  assert.equal(lam.converged, true);
  relative(lam.a, h.transferSemiMajorAxis, 1e-9, 'transfer semi major axis');
  vectorClose(lam.v1, [0, h.transferPeriapsisSpeed, 0], 1e-6, 'departure velocity');
  vectorClose(lam.v2, [0, -h.transferApoapsisSpeed, 0], 1e-6, 'arrival velocity');
  relative(V.norm(V.sub(lam.v1, [0, Math.sqrt(C.MU_EARTH / C.LEO_RADIUS), 0])), h.dv1, 1e-9, 'dv1');
});
test('Lambert retrograde antipodal solution reverses the velocity direction', () => {
  const r1 = [C.LEO_RADIUS, 0, 0], r2 = [-C.GEO_RADIUS, 0, 0];
  const h = O.hohmannTransfer(C.LEO_RADIUS, C.GEO_RADIUS, C.MU_EARTH);
  const lam = O.solveLambert(r1, r2, h.timeOfFlightSec, C.MU_EARTH, false);
  assert.equal(lam.converged, true);
  assert.ok(lam.v1[1] < 0, 'retrograde departure points down');
  close(Math.abs(lam.v1[1]), h.transferPeriapsisSpeed, 1e-6);
});
test('Lambert quarter revolution circular transfer recovers the circular speed', () => {
  const r1 = [C.LEO_RADIUS, 0, 0], r2 = [0, C.LEO_RADIUS, 0];
  const n = Math.sqrt(C.MU_EARTH / C.LEO_RADIUS ** 3);
  const dt = (Math.PI / 2) / n;
  const lam = O.solveLambert(r1, r2, dt, C.MU_EARTH, true);
  assert.equal(lam.converged, true, `not converged, iterations ${lam.iterations}`);
  relative(lam.a, C.LEO_RADIUS, 1e-8, 'semi major axis');
  relative(lam.p, C.LEO_RADIUS, 1e-8, 'semi latus rectum');
  const vc = Math.sqrt(C.MU_EARTH / C.LEO_RADIUS);
  vectorClose(lam.v1, [0, vc, 0], 1e-3, 'departure velocity');
  vectorClose(lam.v2, [-vc, 0, 0], 1e-3, 'arrival velocity');
  assert.ok(lam.iterations > 0);
});
test('Lambert solver preserves angular momentum direction for prograde transfer', () => {
  const r1 = [C.LEO_RADIUS, 0, 0], r2 = [0, C.GEO_RADIUS, 0];
  const lam = O.solveLambert(r1, r2, 12000, C.MU_EARTH, true);
  assert.equal(lam.converged, true);
  const h = V.cross(r1, lam.v1);
  assert.ok(h[2] > 0, 'prograde angular momentum is positive z');
  relative(lam.p, V.dot(h, h) / C.MU_EARTH, 1e-9, 'semi latus rectum');
});
test('Lambert solution obeys the orbit equation at both endpoints', () => {
  const r1 = [C.LEO_RADIUS, 0, 0], r2 = [0, C.GEO_RADIUS, 0];
  const lam = O.solveLambert(r1, r2, 14000, C.MU_EARTH, true);
  assert.equal(lam.converged, true);
  const h1 = V.cross(r1, lam.v1);
  const h2 = V.cross(r2, lam.v2);
  vectorClose(h1, h2, 1e-3, 'angular momentum is conserved');
  const p = V.dot(h1, h1) / C.MU_EARTH;
  const eVec = V.scale(V.sub(V.scale(r1, V.dot(lam.v1, lam.v1) - C.MU_EARTH / V.norm(r1)),
    V.scale(lam.v1, V.dot(r1, lam.v1))), 1 / C.MU_EARTH);
  const e = V.norm(eVec);
  relative(p / (1 + e * Math.cos(Math.atan2(
    V.dot(V.cross(eVec, r1), h1) / (e * V.norm(h1) * V.norm(r1)),
    V.dot(eVec, r1) / (e * V.norm(r1))))), V.norm(r1), 1e-9, 'radius at departure');
});
test('Lambert solver rejects invalid boundary conditions', () => {
  assert.throws(() => O.solveLambert([0, 0, 0], [1, 0, 0], 1000), RangeError);
  assert.throws(() => O.solveLambert([7000000, 0, 0], [0, 7000000, 0], 0), RangeError);
  assert.throws(() => O.solveLambert([7000000, 0, 0], [0, 7000000, 0], -5), RangeError);
});
test('Lambert solver reports a finite number of iterations', () => {
  const lam = O.solveLambert([C.LEO_RADIUS, 0, 0], [0, C.GEO_RADIUS, 0], 14000, C.MU_EARTH);
  assert.ok(Number.isInteger(lam.iterations) && lam.iterations > 0);
  finite(lam.a, 'semi major axis');
  finite(lam.p, 'semi latus rectum');
});

/* --------------------------------------------------------------- */
/* Porkchop grids                                                   */
/* --------------------------------------------------------------- */
test('Porkchop grid exposes all four launch windows', () => {
  assert.deepEqual(Object.keys(O.PRESET_WINDOWS).sort(),
    ['earth-mars', 'earth-venus', 'leo-geo', 'leo-lunar']);
  ['earth-mars', 'earth-venus', 'leo-geo', 'leo-lunar'].forEach(key => {
    assert.ok(O.PRESET_WINDOWS[key].label.length > 0);
    assert.ok(O.PRESET_WINDOWS[key].mu > 0);
  });
});
test('Porkchop grid returns a full matrix of cells', () => {
  const g = O.computePorkchopGrid({ preset: 'earth-mars', departureSteps: 7, flightSteps: 6 });
  assert.equal(g.cells.length, 42);
  assert.equal(g.departureEpochs.length, 7);
  assert.equal(g.timeOfFlightSecs.length, 6);
  assert.equal(g.rows, 6);
  assert.equal(g.cols, 7);
});
test('Porkchop cells contain c3, departure dv, arrival dv and total dv', () => {
  const g = O.computePorkchopGrid({ preset: 'earth-mars', departureSteps: 6, flightSteps: 6 });
  g.cells.forEach((cell, i) => {
    finite(cell.c3, `cell ${i} c3`);
    finite(cell.dvDeparture, `cell ${i} departure dv`);
    finite(cell.dvArrival, `cell ${i} arrival dv`);
    finite(cell.totalDv, `cell ${i} total dv`);
    assert.ok(cell.c3 >= 0);
    close(cell.totalDv, cell.dvDeparture + cell.dvArrival, 1e-6, `cell ${i} dv sum`);
  });
});
test('Porkchop optimal cell is the true minimum of the grid', () => {
  const g = O.computePorkchopGrid({ preset: 'earth-mars', departureSteps: 9, flightSteps: 8 });
  const sorted = g.cells.slice().sort((a, b) => a.totalDv - b.totalDv);
  assert.equal(g.optimal.departureIndex, sorted[0].departureIndex);
  assert.equal(g.optimal.flightIndex, sorted[0].flightIndex);
  close(g.minimumTotalDv, sorted[0].totalDv, 1e-9);
  close(g.optimalCell.totalDv, g.minimumTotalDv, 1e-9);
});
test('Porkchop optimal cell coordinates are in bounds', () => {
  const g = O.computePorkchopGrid({ preset: 'leo-geo', departureSteps: 8, flightSteps: 8, method: 'analytic' });
  assert.ok(g.optimalCell.departureIndex >= 0 && g.optimalCell.departureIndex < 8);
  assert.ok(g.optimalCell.flightIndex >= 0 && g.optimalCell.flightIndex < 8);
  finite(g.optimalCell.departureDay, 'optimal departure day');
  finite(g.optimalCell.timeOfFlightDay, 'optimal flight day');
});
test('Porkchop Earth to Mars uses a heliocentric grid', () => {
  const g = O.computePorkchopGrid({ preset: 'earth-mars', departureSteps: 5, flightSteps: 5 });
  relative(g.mu, C.MU_SUN, 1e-12, 'sun mu');
  relative(g.r1, C.AU, 1e-12, 'Earth radius');
  assert.ok(g.r2 > g.r1, 'Mars orbit is outside Earth orbit');
});
test('Porkchop Earth to Venus uses an inner target orbit', () => {
  const g = O.computePorkchopGrid({ preset: 'earth-venus', departureSteps: 5, flightSteps: 5 });
  assert.ok(g.r2 < g.r1, 'Venus orbit is inside Earth orbit');
  assert.equal(g.label, 'Earth to Venus window');
});
test('Porkchop LEO to GEO and lunar windows are geocentric', () => {
  const geo = O.computePorkchopGrid({ preset: 'leo-geo', departureSteps: 5, flightSteps: 5 });
  const lunar = O.computePorkchopGrid({ preset: 'leo-lunar', departureSteps: 5, flightSteps: 5 });
  relative(geo.mu, C.MU_EARTH, 1e-12);
  relative(lunar.mu, C.MU_EARTH, 1e-12);
  relative(geo.r2, C.GEO_RADIUS, 1e-12);
  relative(lunar.r2, C.MOON_ORBIT_RADIUS, 1e-12);
});
test('Porkchop analytic method stays calibrated and finite', () => {
  const g = O.computePorkchopGrid({ preset: 'earth-mars', departureSteps: 12, flightSteps: 12, method: 'analytic' });
  assert.equal(g.method, 'analytic-calibrated');
  finite(g.minimumTotalDv, 'minimum dv');
  finite(g.maximumTotalDv, 'maximum dv');
  assert.ok(g.minimumTotalDv <= g.maximumTotalDv);
  assert.ok(g.optimal);
});
test('Porkchop grid rejects an unknown preset', () => {
  assert.throws(() => O.computePorkchopGrid({ preset: 'pluto' }), RangeError);
});
test('Porkchop Hohmann reference time of flight matches half the transfer period', () => {
  const g = O.computePorkchopGrid({ preset: 'earth-mars', departureSteps: 5, flightSteps: 5 });
  const at = (g.r1 + g.r2) / 2;
  relative(g.hohmannTimeOfFlightSec, Math.PI * Math.sqrt(at ** 3 / g.mu), 1e-9);
});

/* --------------------------------------------------------------- */
/* RK4 propagation and J2 perturbations                             */
/* --------------------------------------------------------------- */
test('RK4 two body specific energy conserves to better than 1e-8 relative drift', () => {
  const el = { a: 9000000, e: 0.15, i: 0.3, raan: 0.2, argPe: 0.4, nu: 0.7 };
  const s = O.elementsToState(el, C.MU_EARTH);
  const prop = O.propagateRK4(s.r, s.v, s.periodSec, 400, { mu: C.MU_EARTH });
  assert.ok(Math.abs(prop.energyDrift) < 1e-8, `final drift ${prop.energyDrift}`);
  assert.ok(prop.maxEnergyDrift < 1e-8, `max drift ${prop.maxEnergyDrift}`);
});
test('RK4 circular orbit conserves energy across many steps', () => {
  const r = [C.LEO_RADIUS, 0, 0], v = [0, Math.sqrt(C.MU_EARTH / C.LEO_RADIUS), 0];
  const prop = O.propagateRK4(r, v, TAU * Math.sqrt(C.LEO_RADIUS ** 3 / C.MU_EARTH), 800);
  assert.ok(Math.abs(prop.energyDrift) < 1e-8);
  prop.points.forEach((p, i) => {
    relative(p.radius, C.LEO_RADIUS, 1e-8, `radius ${i}`);
    relative(p.speed, Math.sqrt(C.MU_EARTH / C.LEO_RADIUS), 1e-8, `speed ${i}`);
  });
});
test('RK4 trajectory point count and timestamps are correct', () => {
  const r = [C.LEO_RADIUS, 0, 0], v = [0, Math.sqrt(C.MU_EARTH / C.LEO_RADIUS), 0];
  const prop = O.propagateRK4(r, v, 1000, 25);
  assert.equal(prop.points.length, 26);
  assert.equal(prop.steps, 25);
  close(prop.stepSizeSec, 40, 1e-12);
  close(prop.points[25].tSec, 1000, 1e-9);
  close(prop.points[0].tSec, 0, 1e-12);
});
test('RK4 returns to the start point after one full period', () => {
  const el = { a: 8000000, e: 0.1, i: 0.4, raan: 0.5, argPe: 0.8, nu: 1.2 };
  const s = O.elementsToState(el, C.MU_EARTH);
  const prop = O.propagateRK4(s.r, s.v, s.periodSec, 600, { mu: C.MU_EARTH });
  const last = prop.points[prop.points.length - 1];
  assert.ok(V.norm(V.sub(last.r, s.r)) / V.norm(s.r) < 1e-7, 'position closes');
  assert.ok(V.norm(V.sub(last.v, s.v)) / V.norm(s.v) < 1e-7, 'velocity closes');
});
test('RK4 central gravity has zero J2 drift rates', () => {
  const r = [C.LEO_RADIUS, 0, 0], v = [0, Math.sqrt(C.MU_EARTH / C.LEO_RADIUS), 0];
  const prop = O.propagateRK4(r, v, 1000, 10);
  close(prop.raanDriftDegPerDay, 0, 1e-12);
  close(prop.argPeDriftDegPerDay, 0, 1e-12);
  assert.equal(prop.j2Enabled, false);
});
test('J2 enabled propagation reports nonzero nodal and apsidal drift', () => {
  const el = { a: C.R_EARTH + 705000, e: 0.001, i: 98.2 * RAD, raan: 0, argPe: 0, nu: 0 };
  const s = O.elementsToState(el, C.MU_EARTH);
  const prop = O.propagateRK4(s.r, s.v, s.periodSec, 480, { mu: C.MU_EARTH, j2: C.J2_EARTH, bodyRadius: C.R_EARTH });
  assert.equal(prop.j2Enabled, true);
  assert.ok(prop.raanDriftDegPerDay > 0.9 && prop.raanDriftDegPerDay < 1.1,
    `nodal drift ${prop.raanDriftDegPerDay}`);
  assert.ok(Math.abs(prop.argPeDriftDegPerDay) > 2, 'apsidal precession is nonzero');
  assert.ok(Math.abs(prop.energyDrift) < 1e-6, `drift ${prop.energyDrift}`);
});
test('J2 drift rate signs flip for a prograde versus retrograde orbit', () => {
  const a = C.R_EARTH + 705000, e = 0.001;
  const pro = O.j2DriftRates(a, e, 60 * RAD);
  const retro = O.j2DriftRates(a, e, 120 * RAD);
  assert.ok(pro.raanDriftDegPerDay < 0, 'prograde node regresses');
  assert.ok(retro.raanDriftDegPerDay > 0, 'retrograde node advances');
  relative(pro.raanDriftDegPerDay, -retro.raanDriftDegPerDay, 1e-12);
});
test('J2 apsidal precession vanishes near the critical inclination', () => {
  const a = 12000000, e = 0.2;
  const critical = Math.acos(1 / Math.sqrt(5));
  const d = O.j2DriftRates(a, e, critical);
  close(d.argPeDriftDegPerDay, 0, 1e-10, 'critical inclination');
});
test('Sun synchronous solver yields about 0.9856 deg per day nodal drift', () => {
  const a = C.R_EARTH + 705000;
  const s = O.solveSunSyncInclination(a, 0.001);
  assert.ok(s, 'a solution exists');
  close(s.raanDriftDegPerDay, 0.9856, 1e-9);
  assert.ok(s.inclinationDeg > 90 && s.inclinationDeg < 110,
    `inclination ${s.inclinationDeg} is retrograde`);
  close(s.inclinationDeg, 98.2, 0.2);
});
test('Sun synchronous solver matches the target drift for several altitudes', () => {
  [600000, 705000, 800000, 1000000].forEach(alt => {
    const s = O.solveSunSyncInclination(C.R_EARTH + alt, 0.01);
    assert.ok(s, `solution at ${alt} m`);
    close(s.raanDriftDegPerDay, 0.9856, 1e-9, `drift at ${alt} m`);
    assert.ok(s.inclinationDeg > 90);
  });
});
test('Sun synchronous solver honors a custom target drift', () => {
  const s = O.solveSunSyncInclination(C.R_EARTH + 705000, 0, { targetDriftDegPerDay: 0.5 });
  close(s.raanDriftDegPerDay, 0.5, 1e-9);
  assert.ok(s.inclinationDeg < 98.2, 'smaller drift means less retrograde inclination');
});
test('Sun synchronous solver returns null when the requested drift is unreachable', () => {
  assert.equal(O.solveSunSyncInclination(C.GEO_RADIUS, 0), null);
});
test('J2 enabled RK4 conserves energy to a looser but still tight bound', () => {
  const el = { a: C.R_EARTH + 705000, e: 0.001, i: 98.2 * RAD, raan: 0, argPe: 0, nu: 0 };
  const s = O.elementsToState(el, C.MU_EARTH);
  const prop = O.propagateRK4(s.r, s.v, s.periodSec, 400, { mu: C.MU_EARTH, j2: C.J2_EARTH });
  assert.ok(Math.abs(prop.energyDrift) < 1e-5, `drift ${prop.energyDrift}`);
});

/* --------------------------------------------------------------- */
/* Staging                                                          */
/* --------------------------------------------------------------- */
const STAGES = [
  { name: 'Booster', dryMassKg: 25000, propellantMassKg: 400000, ispSec: 300 },
  { name: 'Upper', dryMassKg: 4000, propellantMassKg: 100000, ispSec: 350 },
  { name: 'Kick', dryMassKg: 1000, propellantMassKg: 20000, ispSec: 450 }
];
test('Single stage Tsiolkovsky delta v matches Isp g0 ln(m0/mf)', () => {
  const stage = STAGES[0];
  const st = O.computeStaging([stage], 10000);
  const expected = stage.ispSec * C.G0 * Math.log(
    (10000 + stage.dryMassKg + stage.propellantMassKg) / (10000 + stage.dryMassKg));
  relative(st.totalDv, expected, 1e-12);
  close(st.stages[0].dv, expected, 1e-9);
  close(st.totalDv, st.stages[0].dv, 1e-9);
});
test('Multi stage cumulative delta v is the sum of all stage contributions', () => {
  const st = O.computeStaging(STAGES, 5000);
  const sum = st.stages.reduce((acc, s) => acc + s.dv, 0);
  relative(st.totalDv, sum, 1e-12);
  close(st.stages[2].cumulativeDv, st.totalDv, 1e-9);
  assert.ok(st.stages[1].cumulativeDv > st.stages[0].cumulativeDv);
});
test('Multi stage initial mass equals payload plus all dry and propellant mass', () => {
  const st = O.computeStaging(STAGES, 5000);
  const expected = 5000 + 25000 + 400000 + 4000 + 100000 + 1000 + 20000;
  close(st.initialMassKg, expected, 1e-9);
  close(st.totalPropellantMassKg, 520000, 1e-9);
  close(st.totalDryMassKg, 30000, 1e-9);
});
test('Multi stage total mass ratio and payload fraction are reciprocal', () => {
  const st = O.computeStaging(STAGES, 5000);
  close(st.totalMassRatio * st.payloadFraction, 1, 1e-12);
  close(st.payloadFraction, 5000 / st.initialMassKg, 1e-12);
});
test('Each stage mass ratio uses the full stack above it', () => {
  const st = O.computeStaging(STAGES, 5000);
  const m2 = 5000 + 1000 + 20000;
  const m1 = m2 + 4000 + 100000;
  const m0 = m1 + 25000 + 400000;
  close(st.stages[0].initialMassKg, m0, 1e-9);
  close(st.stages[1].initialMassKg, m1, 1e-9);
  close(st.stages[2].initialMassKg, m2, 1e-9);
  close(st.stages[0].finalMassKg, m0 - 400000, 1e-9);
  close(st.stages[2].finalMassKg, 6000, 1e-9);
});
test('Larger payload reduces total delta v', () => {
  const small = O.computeStaging(STAGES, 1000);
  const large = O.computeStaging(STAGES, 50000);
  assert.ok(small.totalDv > large.totalDv);
});
test('Zero propellant stage contributes zero delta v', () => {
  const st = O.computeStaging([{ dryMassKg: 1000, propellantMassKg: 0, ispSec: 300 }], 5000);
  close(st.totalDv, 0, 1e-12);
  close(st.stages[0].massRatio, 1, 1e-12);
});
test('Staging rejects empty stage list and nonpositive payload', () => {
  assert.throws(() => O.computeStaging([], 1000), RangeError);
  assert.throws(() => O.computeStaging(STAGES, 0), RangeError);
  assert.throws(() => O.computeStaging(STAGES, -5), RangeError);
});
test('Staging breakdown exposes per stage propellant fraction', () => {
  const st = O.computeStaging(STAGES, 5000);
  st.stages.forEach((s, i) => {
    close(s.propellantFraction, s.propellantMassKg / s.initialMassKg, 1e-12, `stage ${i}`);
    assert.ok(s.propellantFraction > 0 && s.propellantFraction < 1);
  });
});

/* --------------------------------------------------------------- */
/* Exporters                                                        */
/* --------------------------------------------------------------- */
const MISSION = {
  name: 'LEO to GEO Transfer',
  epoch: '2026-11-08T00:00:00.000Z',
  mu: C.MU_EARTH,
  elements: { a: C.LEO_RADIUS, e: 0, i: 0, raan: 0, argPe: 0, nu: 0 },
  burns: [
    { id: 'Burn1', dv1: 2397.47, dv2: 0, dv3: 0, propagateSec: 19048 },
    { id: 'Burn2', dv1: 1456.49, dv2: 0, dv3: 0 }
  ]
};
test('GMAT exporter emits a valid script header and spacecraft block', () => {
  const text = O.exportGmatScript(MISSION);
  assert.ok(text.startsWith('%'));
  assert.ok(text.includes('Create Spacecraft OrbitLabSat;'));
  assert.ok(text.includes('GMAT OrbitLabSat.Epoch'));
  assert.ok(text.includes('GMAT OrbitLabSat.SMA'));
  assert.ok(text.includes('08 Nov 2026'));
});
test('GMAT exporter writes one impulsive burn per maneuver', () => {
  const text = O.exportGmatScript(MISSION);
  assert.equal((text.match(/Create ImpulsiveBurn/g) || []).length, 2);
  assert.equal((text.match(/Maneuver /g) || []).length, 2);
  assert.ok(text.includes('Burn1'));
  assert.ok(text.includes('Burn2'));
  assert.ok(text.includes('GMAT Burn1.Element1 = 2.397470000;'));
});
test('GMAT exporter includes a propagator and mission sequence', () => {
  const text = O.exportGmatScript(MISSION);
  assert.ok(text.includes('Create Propagator OrbitLabProp;'));
  assert.ok(text.includes('MissionSequence;'));
  assert.ok(text.includes('Propagate OrbitLabProp'));
  assert.ok(text.includes('Create OrbitView OrbitLabView;'));
});
test('GMAT exporter adds J2 gravity terms when requested', () => {
  const text = O.exportGmatScript(Object.assign({}, MISSION, { j2: true }));
  assert.ok(text.includes('GravityField.Earth.Degree = 2'));
});
test('GMAT exporter writes a propagate command without burns', () => {
  const text = O.exportGmatScript({ name: 'Free drift' });
  assert.equal((text.match(/Create ImpulsiveBurn/g) || []).length, 0);
  assert.ok(text.includes('Propagate OrbitLabProp(OrbitLabSat)'));
});
test('GMAT exporter converts delta v from m/s to km/s', () => {
  const text = O.exportGmatScript({ burns: [{ id: 'B', dv1: 1234.5 }] });
  assert.ok(text.includes('GMAT B.Element1 = 1.234500000;'));
});
test('GMAT exporter uses the solar center and ecliptic frame for heliocentric missions', () => {
  const text = O.exportGmatScript({ mu: C.MU_SUN, name: 'Mars' });
  assert.ok(text.includes('CentralBody = Sun'));
  assert.ok(text.includes('SunMJ2000Ec'));
});
test('CCSDS OEM exporter emits a version 2.0 header and metadata', () => {
  const traj = [{ tSec: 0, r: [7000000, 0, 0], v: [0, 7500, 0] },
    { tSec: 60, r: [6999000, 450000, 0], v: [-480, 7490, 0] }];
  const text = O.exportCcsdsOem(traj, { objectName: 'ORBITLAB TEST', epoch: '2026-11-08T00:00:00.000Z' });
  assert.ok(text.startsWith('CCSDS_OEM_VERS = 2.0'));
  assert.ok(text.includes('META_START'));
  assert.ok(text.includes('META_STOP'));
  assert.ok(text.includes('OBJECT_NAME          = ORBITLAB TEST'));
  assert.ok(text.includes('TIME_SYSTEM          = UTC'));
  assert.ok(text.includes('INTERPOLATION        = HERMITE'));
  assert.ok(text.includes('CENTER_NAME          = EARTH'));
});
test('CCSDS OEM exporter writes states in km and km/s', () => {
  const traj = [{ tSec: 0, r: [7000000, 0, 0], v: [0, 7500, 0] }];
  const text = O.exportCcsdsOem(traj, { epoch: '2026-11-08T00:00:00.000Z' });
  assert.ok(text.includes('7000.000000 0.000000 0.000000 0.000000000 7.500000000 0.000000000'));
  assert.ok(text.includes('2026-11-08T00:00:00'));
});
test('CCSDS OEM exporter advances epoch with each trajectory time', () => {
  const traj = [{ tSec: 0, r: [7000000, 0, 0], v: [0, 7500, 0] },
    { tSec: 3600, r: [6000000, 1000000, 0], v: [-1000, 7000, 0] }];
  const text = O.exportCcsdsOem(traj, { epoch: '2026-11-08T00:00:00.000Z' });
  assert.ok(text.includes('START_TIME           = 2026-11-08T00:00:00'));
  assert.ok(text.includes('STOP_TIME            = 2026-11-08T01:00:00'));
  assert.ok(text.includes('2026-11-08T01:00:00.000'));
});
test('CCSDS OEM exporter supports a heliocentric frame', () => {
  const traj = [{ tSec: 0, r: [C.AU, 0, 0], v: [0, 29780, 0] }];
  const text = O.exportCcsdsOem(traj, { mu: C.MU_SUN, epoch: '2026-11-08T00:00:00.000Z' });
  assert.ok(text.includes('CENTER_NAME          = SUN'));
  assert.ok(text.includes('REF_FRAME            = EME2000'));
});
test('CCSDS OEM exporter rejects an empty trajectory', () => {
  assert.throws(() => O.exportCcsdsOem([]), RangeError);
  assert.throws(() => O.exportCcsdsOem(null), RangeError);
});
test('CSV exporter writes a header and one row per trajectory point', () => {
  const traj = [{ tSec: 0, r: [7000000, 0, 0], v: [0, 7500, 0] },
    { tSec: 60, r: [6999000, 450000, 0], v: [-480, 7490, 0] }];
  const text = O.exportTrajectoryCsv(traj);
  const lines = text.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith('epoch_utc,t_sec,t_day,x_m,y_m,z_m'));
  assert.equal(lines[1].split(',').length, lines[0].split(',').length);
  assert.ok(lines[1].includes('7000000.000000'));
});
test('CSV exporter handles RK4 trajectory points with energy drift field', () => {
  const r = [C.LEO_RADIUS, 0, 0], v = [0, Math.sqrt(C.MU_EARTH / C.LEO_RADIUS), 0];
  const prop = O.propagateRK4(r, v, 200, 4);
  const text = O.exportTrajectoryCsv(prop.points);
  assert.equal(text.trim().split('\n').length, 6);
  assert.ok(text.includes('specific_energy_j_kg'));
});
test('formatEpoch produces an ISO like UTC timestamp', () => {
  assert.equal(O.formatEpoch('2026-11-08T00:00:00.000Z'), '2026-11-08T00:00:00.000');
});

/* --------------------------------------------------------------- */
/* Presets, UMD loading and repository wide text rules               */
/* --------------------------------------------------------------- */
test('All five built in mission presets are present and named', () => {
  const names = O.PRESETS.map(p => p.name);
  assert.equal(O.PRESETS.length, 5);
  assert.deepEqual(names, [
    'LEO to GEO Comms Transfer',
    'Sun-Synchronous EO-1 (705 km)',
    'Molniya 12h High-Eccentricity',
    'Earth to Mars Rendezvous',
    'Bi-Elliptic Deep-Space (r2/r1 = 15)'
  ]);
});
test('Every preset carries usable orbital elements and a description', () => {
  O.PRESETS.forEach(p => {
    assert.ok(p.elements && p.elements.a > 0, `${p.name} has a`);
    assert.ok(p.elements.e >= 0, `${p.name} has e`);
    assert.ok(p.description.length > 20, `${p.name} description`);
    const s = O.elementsToState(p.elements, p.mu);
    finite(s.periodSec, `${p.name} period`);
    finite(s.periapsisSpeed, `${p.name} periapsis speed`);
  });
});
test('Sun synchronous preset inclination matches the J2 solver', () => {
  const p = O.PRESETS.find(x => x.id === 'sun-sync-eo1');
  assert.ok(p.sunSync);
  close(p.sunSync.raanDriftDegPerDay, 0.9856, 1e-9);
  close(p.elements.i, p.sunSync.inclinationRad, 1e-12);
});
test('Bi-elliptic preset saves delta v at r2/r1 = 15', () => {
  const p = O.PRESETS.find(x => x.id === 'bi-elliptic-deep-space');
  assert.ok(p.biElliptic.beatsHohmann);
  relative(p.r2 / p.r1, 15, 1e-12);
});
test('LEO to GEO preset hohmann delta v is about 3.85 km/s', () => {
  const p = O.PRESETS.find(x => x.id === 'leo-geo-comms');
  assert.ok(p.hohmann.totalDv > 3800 && p.hohmann.totalDv < 3900);
});
test('UMD module loads in a browser like VM as window.OrbitLab', () => {
  const source = fs.readFileSync(path.join(__dirname, 'orbit.js'), 'utf8');
  const sandbox = { window: {}, console: console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const api = sandbox.window.OrbitLab || sandbox.OrbitLab;
  assert.ok(api, 'window.OrbitLab exists');
  assert.equal(api.version, '1.0.0');
  assert.equal(typeof api.solveKepler, 'function');
  assert.equal(typeof api.computePorkchopGrid, 'function');
  close(api.solveKepler(1, 0.1).residual, 0, 1e-12);
});
test('Engine surface exposes every documented public function', () => {
  ['solveKepler', 'elementsToState', 'stateToElements', 'hohmannTransfer',
    'biEllipticTransfer', 'combinedPlaneChange', 'solveLambert', 'computePorkchopGrid',
    'propagateRK4', 'solveSunSyncInclination', 'computeStaging', 'exportGmatScript',
    'exportCcsdsOem', 'exportTrajectoryCsv'].forEach(name => {
      assert.equal(typeof O[name], 'function', `${name} is exported`);
    });
});
test('Engine constants match standard physical values', () => {
  close(C.G0, 9.80665, 1e-12);
  close(C.MU_EARTH, 3.986004418e14, 1e-3);
  close(C.AU, 149597870700, 1e-3);
  close(C.SUN_SYNC_DRIFT_DEG_PER_DAY, 0.9856, 1e-12);
});
test('All shipped text files contain zero em dashes and en dashes', () => {
  const files = ['README.md', 'index.html', 'style.css', 'orbit.js', 'app.js', 'test.js', 'LICENSE'];
  files.forEach(file => {
    const full = path.join(__dirname, file);
    if (!fs.existsSync(full)) return;
    const text = fs.readFileSync(full, 'utf8');
    assert.ok(!text.includes(String.fromCharCode(8212)), `${file} contains a long dash`);
    assert.ok(!text.includes(String.fromCharCode(8211)), `${file} contains a short dash`);
  });
});
test('All shipped text files contain zero prohibited model references', () => {
  const files = ['README.md', 'index.html', 'style.css', 'orbit.js', 'app.js', 'test.js', 'LICENSE'];
  const banned = [/\bAI\b/i, /\bLLM\b/i, /\bClaude\b/i, /\bGPT\b/i, /\bagents?\b/i];
  files.forEach(file => {
    const full = path.join(__dirname, file);
    if (!fs.existsSync(full)) return;
    const text = fs.readFileSync(full, 'utf8');
    banned.forEach(re => {
      assert.ok(!re.test(text), `${file} contains a prohibited term ${re}`);
    });
  });
});
