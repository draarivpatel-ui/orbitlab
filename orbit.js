/*
 * OrbitLab orbital mechanics engine.
 * UMD build: works with Node.js require() and as window.OrbitLab in a browser.
 * Units are SI (meters, seconds, radians, kilograms) unless a key says otherwise.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.OrbitLab = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TAU = 2 * Math.PI;
  var DEG = 180 / Math.PI;
  var RAD = Math.PI / 180;

  var CONSTANTS = Object.freeze({
    G0: 9.80665,
    MU_EARTH: 3.986004418e14,
    MU_SUN: 1.32712440018e20,
    MU_MOON: 4.9048695e12,
    R_EARTH: 6378137,
    J2_EARTH: 1.08262668e-3,
    AU: 149597870700,
    DAY: 86400,
    HOUR: 3600,
    LEO_RADIUS: 6778137,
    GEO_RADIUS: 42164000,
    MOON_ORBIT_RADIUS: 384400000,
    TROPICAL_YEAR_DAYS: 365.2421897,
    SUN_MEAN_MOTION_RAD_S: TAU / (365.2421897 * 86400),
    SUN_SYNC_DRIFT_DEG_PER_DAY: 0.9856,
    CRITICAL_BI_ELLIPTIC_RATIO: 11.94
  });

  function num(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  function vec(x) { return [num(x[0], 0), num(x[1], 0), num(x[2], 0)]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function normalize(a) { var n = norm(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function wrapAngle(x) { var w = x % TAU; return w < 0 ? w + TAU : w; }

  /* Rotation from the perifocal PQW frame into the inertial IJK frame. */
  function pqwToIjkMatrix(raan, inc, argPe) {
    var cO = Math.cos(raan), sO = Math.sin(raan);
    var ci = Math.cos(inc), si = Math.sin(inc);
    var cw = Math.cos(argPe), sw = Math.sin(argPe);
    return [
      [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * si],
      [sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si],
      [sw * si, cw * si, ci]
    ];
  }
  function matVec(m, v) {
    return [
      m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
      m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
      m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
    ];
  }

  /*
   * Newton Raphson solver for Kepler's equation.
   * Elliptic (0 <= e < 1): M = E - e sin(E), returns the eccentric anomaly.
   * Hyperbolic (e > 1):    M = e sinh(H) - H, returns the hyperbolic anomaly.
   * A monotone bracket guards every Newton step, so high eccentricity and
   * near parabolic cases converge instead of overshooting.
   */
  function solveKepler(M, e, tol) {
    tol = (typeof tol === 'number' && tol > 0) ? tol : 1e-12;
    if (!isFinite(M)) throw new RangeError('Mean anomaly must be finite.');
    if (!(e >= 0)) throw new RangeError('Eccentricity must be non negative.');
    if (e === 1) throw new RangeError('Parabolic orbits have no Kepler anomaly.');
    var maxIterations = 120;
    var iterations = 0;
    var anomaly, trueAnomaly, residual, i, f, fp, next, lo, hi;

    if (e < 1) {
      var Mn = ((M + Math.PI) % TAU + TAU) % TAU - Math.PI;
      var denom = 1 - Math.sin(Mn + e) + Math.sin(Mn);
      var E = Math.abs(denom) > 1e-8
        ? Mn + e * Math.sin(Mn) / denom
        : (Mn >= 0 ? Math.PI : -Math.PI);
      lo = Mn - e;
      hi = Mn + e;
      E = clamp(E, lo, hi);
      for (i = 0; i < maxIterations; i++) {
        iterations = i + 1;
        f = E - e * Math.sin(E) - Mn;
        residual = Math.abs(f);
        if (residual <= tol) break;
        if (f > 0) hi = E; else lo = E;
        fp = 1 - e * Math.cos(E);
        next = E - f / fp;
        if (!isFinite(next) || !(next > lo && next < hi)) next = 0.5 * (lo + hi);
        if (Math.abs(next - E) <= tol * 0.25) { E = next; break; }
        E = next;
      }
      anomaly = E;
      residual = Math.abs(E - e * Math.sin(E) - Mn);
      trueAnomaly = 2 * Math.atan2(
        Math.sqrt(1 + e) * Math.sin(E / 2),
        Math.sqrt(1 - e) * Math.cos(E / 2)
      );
      return {
        anomaly: anomaly, trueAnomaly: trueAnomaly, iterations: iterations,
        residual: residual, eccentricity: e, meanAnomaly: Mn, type: 'elliptic'
      };
    }

    var sign = M < 0 ? -1 : 1;
    var Ma = Math.abs(M);
    var H = 0;
    if (Ma > 0) {
      lo = 0;
      hi = Math.max(0.5, Math.asinh(Ma / e) + 0.5);
      var guard = 0;
      while (e * Math.sinh(hi) - hi - Ma < 0 && hi < 350 && guard < 60) { hi *= 1.6; guard++; }
      H = clamp(Math.asinh(Ma / e), 0, hi);
      for (i = 0; i < maxIterations; i++) {
        iterations = i + 1;
        f = e * Math.sinh(H) - H - Ma;
        residual = Math.abs(f);
        if (residual <= tol) break;
        if (f > 0) hi = H; else lo = H;
        fp = e * Math.cosh(H) - 1;
        next = H - f / fp;
        if (!isFinite(next) || !(next > lo && next < hi)) next = 0.5 * (lo + hi);
        if (Math.abs(next - H) <= tol * 0.25) { H = next; break; }
        H = next;
      }
    }
    anomaly = sign * H;
    residual = Math.abs(e * Math.sinh(H) - H - Ma);
    trueAnomaly = 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(anomaly / 2));
    return {
      anomaly: anomaly, trueAnomaly: trueAnomaly, iterations: iterations,
      residual: residual, eccentricity: e, meanAnomaly: M, type: 'hyperbolic'
    };
  }

  /* Derived quantities shared by both element and state representations. */
  function derivedOrbit(r, v, mu, a, e, p) {
    var rmag = norm(r);
    var vmag2 = dot(v, v);
    var h = cross(r, v);
    var eVec = scale(sub(scale(r, vmag2 - mu / rmag), scale(v, dot(r, v))), 1 / mu);
    var energy = vmag2 / 2 - mu / rmag;
    var rp = p / (1 + e);
    var ra = e < 1 ? p / (1 - e) : null;
    var vp = Math.sqrt(Math.max(0, mu * (2 / rp - 1 / a)));
    var va = ra !== null ? Math.sqrt(Math.max(0, mu * (2 / ra - 1 / a))) : null;
    var periodSec = a > 0 ? TAU * Math.sqrt(a * a * a / mu) : null;
    return {
      specificEnergy: energy,
      h: h,
      hMagnitude: norm(h),
      eccentricityVector: eVec,
      eccentricity: norm(eVec),
      semiMajorAxis: a,
      semiLatusRectum: p,
      periodSec: periodSec,
      periapsisRadius: rp,
      apoapsisRadius: ra,
      periapsisSpeed: vp,
      apoapsisSpeed: va,
      radius: rmag,
      speed: Math.sqrt(vmag2)
    };
  }

  /* Classical elements to Cartesian state. Elements: { a, e, i, raan, argPe, nu }. */
  function elementsToState(elements, mu) {
    mu = num(mu, CONSTANTS.MU_EARTH);
    var a = elements.a;
    var e = elements.e;
    var inc = num(elements.i, 0);
    var raan = num(elements.raan, 0);
    var argPe = num(elements.argPe, 0);
    var nu = num(elements.nu, 0);
    if (!(a > 0) && !(a < 0)) throw new RangeError('Semi major axis must be finite and non zero.');
    if (!(e >= 0)) throw new RangeError('Eccentricity must be non negative.');
    var p = a * (1 - e * e);
    var radius = p / (1 + e * Math.cos(nu));
    var k = Math.sqrt(mu / p);
    var rPqw = [radius * Math.cos(nu), radius * Math.sin(nu), 0];
    var vPqw = [-k * Math.sin(nu), k * (e + Math.cos(nu)), 0];
    var m = pqwToIjkMatrix(raan, inc, argPe);
    var r = matVec(m, rPqw);
    var v = matVec(m, vPqw);
    var d = derivedOrbit(r, v, mu, a, e, p);
    var out = { r: r, v: v, mu: mu, elements: { a: a, e: e, i: inc, raan: raan, argPe: argPe, nu: nu } };
    for (var key in d) if (Object.prototype.hasOwnProperty.call(d, key)) out[key] = d[key];
    return out;
  }

  /* Cartesian state to classical elements. Handles circular and equatorial orbits. */
  function stateToElements(rVec, vVec, mu) {
    mu = num(mu, CONSTANTS.MU_EARTH);
    var r = vec(rVec), v = vec(vVec);
    var rmag = norm(r);
    if (rmag === 0) throw new RangeError('Position vector must be non zero.');
    var vmag2 = dot(v, v);
    var energy = vmag2 / 2 - mu / rmag;
    var h = cross(r, v);
    var hmag = norm(h);
    if (hmag === 0) throw new RangeError('Angular momentum is zero; radial trajectories have no classical elements.');
    var a = Math.abs(energy) > 1e-14 ? -mu / (2 * energy) : Infinity;
    var p = hmag * hmag / mu;
    var eVec = scale(sub(scale(r, vmag2 - mu / rmag), scale(v, dot(r, v))), 1 / mu);
    var e = norm(eVec);
    var n = [-h[1], h[0], 0];
    var nmag = norm(n);
    var inc = Math.acos(clamp(h[2] / hmag, -1, 1));
    var raan, argPe, nu;

    if (nmag > 1e-12) {
      raan = Math.atan2(n[1], n[0]);
      if (e > 1e-12) {
        var ne = dot(n, eVec) / (nmag * e);
        var neh = dot(cross(n, eVec), h) / (nmag * e * hmag);
        argPe = Math.atan2(neh, ne);
      } else {
        argPe = 0;
      }
    } else {
      raan = 0;
      argPe = e > 1e-12 ? Math.atan2(eVec[1], eVec[0]) : 0;
    }

    if (e > 1e-12) {
      var er = dot(eVec, r) / (e * rmag);
      var erh = dot(cross(eVec, r), h) / (e * hmag * rmag);
      nu = Math.atan2(erh, er);
    } else if (nmag > 1e-12) {
      /* Circular inclined orbit: true anomaly becomes argument of latitude. */
      nu = Math.atan2(r[2] / Math.sin(inc), dot(r, normalize(n)));
      argPe = 0;
    } else {
      /* Circular equatorial orbit: true longitude is the only angle left. */
      nu = Math.atan2(r[1], r[0]);
      argPe = 0;
      raan = 0;
    }
    raan = wrapAngle(raan);
    argPe = wrapAngle(argPe);
    nu = wrapAngle(nu);
    var d = derivedOrbit(r, v, mu, a, e, p);
    var out = {
      a: a, e: e, i: inc, raan: raan, argPe: argPe, nu: nu,
      r: r, v: v, mu: mu
    };
    for (var key in d) if (Object.prototype.hasOwnProperty.call(d, key)) out[key] = d[key];
    return out;
  }

  /* Two-impulse Hohmann transfer between coplanar circular orbits. */
  function hohmannTransfer(r1, r2, mu) {
    mu = num(mu, CONSTANTS.MU_EARTH);
    if (!(r1 > 0) || !(r2 > 0)) throw new RangeError('Orbit radii must be positive.');
    var at = (r1 + r2) / 2;
    var et = Math.abs(r2 - r1) / (r1 + r2);
    var v1 = Math.sqrt(mu / r1);
    var v2 = Math.sqrt(mu / r2);
    var vp = Math.sqrt(Math.max(0, mu * (2 / r1 - 1 / at)));
    var va = Math.sqrt(Math.max(0, mu * (2 / r2 - 1 / at)));
    var dv1 = Math.abs(vp - v1);
    var dv2 = Math.abs(v2 - va);
    return {
      r1: r1, r2: r2, mu: mu,
      dv1: dv1, dv2: dv2, totalDv: dv1 + dv2,
      transferSemiMajorAxis: at, transferEccentricity: et,
      timeOfFlightSec: Math.PI * Math.sqrt(at * at * at / mu),
      circularSpeed1: v1, circularSpeed2: v2,
      transferPeriapsisSpeed: vp, transferApoapsisSpeed: va
    };
  }

  /* Three-impulse bi-elliptic transfer via an intermediate radius rb. */
  function biEllipticTransfer(r1, r2, rb, mu) {
    mu = num(mu, CONSTANTS.MU_EARTH);
    if (!(r1 > 0) || !(r2 > 0) || !(rb > 0)) throw new RangeError('Orbit radii must be positive.');
    var a1 = (r1 + rb) / 2;
    var a2 = (r2 + rb) / 2;
    var v1 = Math.sqrt(mu / r1);
    var v2 = Math.sqrt(mu / r2);
    var vAtR1 = Math.sqrt(Math.max(0, mu * (2 / r1 - 1 / a1)));
    var vAtRbFromA = Math.sqrt(Math.max(0, mu * (2 / rb - 1 / a1)));
    var vAtRbFromB = Math.sqrt(Math.max(0, mu * (2 / rb - 1 / a2)));
    var vAtR2 = Math.sqrt(Math.max(0, mu * (2 / r2 - 1 / a2)));
    var dv1 = Math.abs(vAtR1 - v1);
    var dv2 = Math.abs(vAtRbFromB - vAtRbFromA);
    var dv3 = Math.abs(v2 - vAtR2);
    var totalDv = dv1 + dv2 + dv3;
    var hohmann = hohmannTransfer(r1, r2, mu);
    var ratio = r2 / r1;
    var tof1 = Math.PI * Math.sqrt(a1 * a1 * a1 / mu);
    var tof2 = Math.abs(rb - r2) < 1e-9
      ? 0
      : Math.PI * Math.sqrt(a2 * a2 * a2 / mu);
    return {
      r1: r1, r2: r2, rb: rb, mu: mu,
      dv1: dv1, dv2: dv2, dv3: dv3, totalDv: totalDv,
      timeOfFlightSec: tof1 + tof2,
      timeOfFlightSec1: tof1, timeOfFlightSec2: tof2,
      semiMajorAxis1: a1, semiMajorAxis2: a2,
      hohmannTotalDv: hohmann.totalDv,
      savingsDv: hohmann.totalDv - totalDv,
      savingsPercent: 100 * (hohmann.totalDv - totalDv) / hohmann.totalDv,
      radiusRatio: ratio,
      criticalRatio: CONSTANTS.CRITICAL_BI_ELLIPTIC_RATIO,
      aboveCriticalRatio: ratio > CONSTANTS.CRITICAL_BI_ELLIPTIC_RATIO,
      beatsHohmann: totalDv < hohmann.totalDv,
      hohmannTimeOfFlightSec: hohmann.timeOfFlightSec
    };
  }

  /* Compare a single combined plane change burn with a split burn sequence. */
  function combinedPlaneChange(v1, v2, deltaIncRad) {
    var s1 = (typeof v1 === 'number') ? v1 : norm(vec(v1));
    var s2 = (typeof v2 === 'number') ? v2 : norm(vec(v2));
    var di = Math.abs(num(deltaIncRad, 0));
    var combinedDv = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - 2 * s1 * s2 * Math.cos(di)));
    var speedChange = Math.abs(s2 - s1);
    var splitTurn = 2 * Math.min(s1, s2) * Math.sin(di / 2);
    var splitCost = speedChange + splitTurn;
    return {
      v1: s1, v2: s2, deltaIncRad: di,
      dv: combinedDv, combinedDv: combinedDv,
      twoBurnSplitCost: splitCost, splitCost: splitCost,
      savingsDv: splitCost - combinedDv,
      savingsPercent: splitCost > 0 ? 100 * (splitCost - combinedDv) / splitCost : 0
    };
  }

  /* Stumpff functions C(z) and S(z), with a series for small arguments. */
  function stumpff(z) {
    var c, s;
    if (Math.abs(z) < 1e-4) {
      c = 0; s = 0;
      var termC = 1 / 2, termS = 1 / 6;
      for (var k = 0; k < 10; k++) {
        c += termC; s += termS;
        termC *= -z / ((2 * k + 3) * (2 * k + 4));
        termS *= -z / ((2 * k + 5) * (2 * k + 6));
      }
      return { C: c, S: s };
    }
    if (z > 0) {
      var u = Math.sqrt(z);
      c = (1 - Math.cos(u)) / z;
      s = (u - Math.sin(u)) / (u * u * u);
    } else {
      var w = Math.sqrt(-z);
      if (w > 300) return { C: Infinity, S: Infinity };
      c = (Math.cosh(w) - 1) / (-z);
      s = (Math.sinh(w) - w) / (w * w * w);
    }
    return { C: c, S: s };
  }

  /* Universal variable Lambert boundary value solver, zero revolutions. */
  function solveLambert(r1Vec, r2Vec, dtSec, mu, prograde) {
    mu = num(mu, CONSTANTS.MU_EARTH);
    if (prograde === undefined) prograde = true;
    var r1v = vec(r1Vec), r2v = vec(r2Vec);
    var r1 = norm(r1v), r2 = norm(r2v);
    if (!(r1 > 0) || !(r2 > 0) || !(dtSec > 0)) {
      throw new RangeError('Lambert needs two nonzero position vectors and a positive flight time.');
    }
    var cosDnu = clamp(dot(r1v, r2v) / (r1 * r2), -1, 1);
    var crossZ = cross(r1v, r2v)[2];
    var shortWay = prograde ? crossZ >= 0 : crossZ < 0;
    var dnu = shortWay ? Math.acos(cosDnu) : TAU - Math.acos(cosDnu);
    var sinDnu = Math.sin(dnu);
    var sqrtMu = Math.sqrt(mu);
    var iterations = 0;
    var converged = false;

    /* Exactly antipodal transfers are the apsidal half revolution case. */
    if (Math.abs(sinDnu) < 1e-9 && cosDnu < 0) {
      var at = (r1 + r2) / 2;
      var tof = Math.PI * Math.sqrt(at * at * at / mu);
      var rp = Math.min(r1, r2), ra = Math.max(r1, r2);
      var et = (ra - rp) / (ra + rp);
      var hhat = prograde ? [0, 0, 1] : [0, 0, -1];
      var t1 = normalize(cross(hhat, r1v));
      var t2 = normalize(cross(hhat, r2v));
      var vp = Math.sqrt(Math.max(0, mu * (2 / r1 - 1 / at)));
      var va = Math.sqrt(Math.max(0, mu * (2 / r2 - 1 / at)));
      var v1 = scale(t1, vp), v2 = scale(t2, va);
      converged = Math.abs(dtSec - tof) <= Math.max(1e-3, 0.02 * tof);
      return {
        v1: v1, v2: v2, a: at, p: at * (1 - et * et),
        iterations: 1, converged: converged,
        transferAngleRad: dnu, prograde: prograde,
        timeOfFlightSec: dtSec, residual: dtSec - tof,
        deltaV1: null, deltaV2: null, method: 'apsidal-half-revolution'
      };
    }

    var A = sinDnu * Math.sqrt(r1 * r2 / (1 - cosDnu));
    function evaluate(z) {
      var cs = stumpff(z);
      if (!isFinite(cs.C) || cs.C <= 0 || !isFinite(cs.S)) return { ok: false, z: z };
      var y = r1 + r2 + A * (z * cs.S - 1) / Math.sqrt(cs.C);
      if (!(y > 0)) return { ok: false, y: y, z: z };
      var x = Math.sqrt(y / cs.C);
      var f = x * x * x * cs.S + A * Math.sqrt(y) - sqrtMu * dtSec;
      return { ok: true, y: y, x: x, C: cs.C, S: cs.S, f: f, z: z };
    }

    /* Scan the universal variable range, then bracket any sign change and bisect. */
    var zHigh = TAU * TAU - 1e-5;
    var samples = [];
    var si;
    for (si = 0; si <= 480; si++) {
      var zz = -16 + (zHigh + 16) * si / 480;
      var ev = evaluate(zz);
      iterations++;
      if (ev.ok) samples.push(ev);
    }
    if (samples.length < 2 || !(samples[0].f < 0) || !(samples[samples.length - 1].f > 0)) {
      return { v1: [0, 0, 0], v2: [0, 0, 0], a: Infinity, p: Infinity, iterations: iterations,
        converged: false, transferAngleRad: dnu, prograde: prograde, residual: Infinity };
    }
    var bracket = null;
    for (si = 0; si < samples.length - 1; si++) {
      var before = samples[si], after = samples[si + 1];
      if (before.f >= 0 && after.f <= 0) { bracket = [before, after]; break; }
      if (before.f <= 0 && after.f >= 0) { bracket = [before, after]; break; }
    }
    if (!bracket) {
      return { v1: [0, 0, 0], v2: [0, 0, 0], a: Infinity, p: Infinity, iterations: iterations,
        converged: false, transferAngleRad: dnu, prograde: prograde, residual: Infinity };
    }
    var left = bracket[0], right = bracket[1];
    var mid = left;
    for (var k2 = 0; k2 < 120; k2++) {
      var zm = 0.5 * (left.z + right.z);
      mid = evaluate(zm);
      iterations++;
      if (!mid.ok) break;
      if (Math.abs(mid.f) / sqrtMu < 1e-7) break;
      if ((mid.f > 0) === (left.f > 0)) left = mid; else right = mid;
    }
    /* Newton polish, keeping the iterate inside the bracket. */
    for (var n = 0; n < 20 && mid.ok; n++) {
      var dz = Math.max(1e-6, Math.abs(mid.z) * 1e-6);
      var fp = evaluate(mid.z + dz), fm = evaluate(mid.z - dz);
      if (!fp.ok || !fm.ok) break;
      var slope = (fp.f - fm.f) / (2 * dz);
      if (!isFinite(slope) || slope === 0) break;
      var zn = mid.z - mid.f / slope;
      var zMin = Math.min(left.z, right.z), zMax = Math.max(left.z, right.z);
      if (!(zn > zMin && zn < zMax)) break;
      var nextEv = evaluate(zn);
      iterations++;
      if (!nextEv.ok) break;
      mid = nextEv;
      if (Math.abs(mid.f) / sqrtMu < 1e-9) break;
    }
    converged = mid.ok && Math.abs(mid.f) / sqrtMu < 1e-3;
    var y = mid.y;
    var g = A * Math.sqrt(y / mu);
    if (Math.abs(g) < 1e-12) {
      return { v1: [0, 0, 0], v2: [0, 0, 0], a: Infinity, p: Infinity, iterations: iterations,
        converged: false, transferAngleRad: dnu, prograde: prograde, residual: Infinity };
    }
    var fCoef = 1 - y / r1;
    var gdCoef = 1 - y / r2;
    var v1out = scale(sub(r2v, scale(r1v, fCoef)), 1 / g);
    var v2out = scale(sub(scale(r2v, gdCoef), r1v), 1 / g);
    var energy = dot(v1out, v1out) / 2 - mu / r1;
    var a = Math.abs(energy) > 1e-14 ? -mu / (2 * energy) : Infinity;
    var hvec = cross(r1v, v1out);
    var p = dot(hvec, hvec) / mu;
    return {
      v1: v1out, v2: v2out, a: a, p: p, iterations: iterations, converged: converged,
      transferAngleRad: dnu, prograde: prograde,
      timeOfFlightSec: dtSec, residual: mid.ok ? mid.f / sqrtMu : Infinity,
      universalVariable: mid.z, semiLatusRectum: p,
      method: 'universal-variable-bate-mueller-white'
    };
  }

  /* Preset heliocentric and geocentric transfer windows. */
  var PRESET_WINDOWS = Object.freeze({
    'earth-mars': {
      label: 'Earth to Mars Hohmann window',
      mu: CONSTANTS.MU_SUN,
      r1: 1.000 * CONSTANTS.AU,
      r2: 1.524 * CONSTANTS.AU,
      i1: 0, i2: 1.85 * RAD,
      n1: TAU / (365.256 * CONSTANTS.DAY),
      n2: TAU / (686.980 * CONSTANTS.DAY),
      phase0: 0,
      departureDays: [0, 780],
      flightDays: [120, 340],
      departureSteps: 30, flightSteps: 26,
      description: 'Heliocentric Earth to Mars rendezvous, low inclination included.'
    },
    'earth-venus': {
      label: 'Earth to Venus window',
      mu: CONSTANTS.MU_SUN,
      r1: 1.000 * CONSTANTS.AU,
      r2: 0.723 * CONSTANTS.AU,
      i1: 0, i2: 3.39 * RAD,
      n1: TAU / (365.256 * CONSTANTS.DAY),
      n2: TAU / (224.701 * CONSTANTS.DAY),
      phase0: 0,
      departureDays: [0, 600],
      flightDays: [80, 230],
      departureSteps: 28, flightSteps: 24,
      description: 'Heliocentric Earth to Venus rendezvous, inward spiral transfer.'
    },
    'leo-geo': {
      label: 'LEO to GEO transfer',
      mu: CONSTANTS.MU_EARTH,
      r1: CONSTANTS.LEO_RADIUS,
      r2: CONSTANTS.GEO_RADIUS,
      i1: 0, i2: 0,
      n1: Math.sqrt(CONSTANTS.MU_EARTH / Math.pow(CONSTANTS.LEO_RADIUS, 3)),
      n2: Math.sqrt(CONSTANTS.MU_EARTH / Math.pow(CONSTANTS.GEO_RADIUS, 3)),
      phase0: Math.PI,
      departureDays: [0, 0.6],
      flightDays: [0.12, 0.42],
      departureSteps: 24, flightSteps: 22,
      description: 'Geocentric coplanar low Earth orbit to geostationary transfer.'
    },
    'leo-lunar': {
      label: 'LEO to Lunar injection',
      mu: CONSTANTS.MU_EARTH,
      r1: CONSTANTS.LEO_RADIUS,
      r2: CONSTANTS.MOON_ORBIT_RADIUS,
      i1: 0, i2: 5.145 * RAD,
      n1: Math.sqrt(CONSTANTS.MU_EARTH / Math.pow(CONSTANTS.LEO_RADIUS, 3)),
      n2: TAU / (27.3217 * CONSTANTS.DAY),
      phase0: Math.PI * 0.75,
      departureDays: [0, 3],
      flightDays: [2.5, 6],
      departureSteps: 24, flightSteps: 22,
      description: 'Geocentric translunar injection with lunar orbital inclination.'
    }
  });

  /* Circular ephemeris rotated into the target orbital plane. */
  function circularState(radius, angleRad, inclinationRad, n, mu) {
    var x = radius * Math.cos(angleRad);
    var y = radius * Math.sin(angleRad);
    var ci = Math.cos(inclinationRad), si = Math.sin(inclinationRad);
    var v = Math.sqrt(mu / radius);
    return {
      r: [x, y * ci, y * si],
      v: [-v * Math.sin(angleRad), v * Math.cos(angleRad) * ci, v * Math.cos(angleRad) * si]
    };
  }

  function solveCell(windowSpec, departureSec, flightSec, prograde) {
    var theta1 = windowSpec.phase0 + windowSpec.n1 * departureSec;
    var theta2 = windowSpec.n2 * departureSec;
    var s1 = circularState(windowSpec.r1, theta1, windowSpec.i1, windowSpec.n1, windowSpec.mu);
    var s2 = circularState(windowSpec.r2, theta2 + windowSpec.n2 * flightSec, windowSpec.i2, windowSpec.n2, windowSpec.mu);
    var lambert = solveLambert(s1.r, s2.r, flightSec, windowSpec.mu, prograde);
    var v1Inf = sub(lambert.v1, s1.v);
    var v2Inf = sub(lambert.v2, s2.v);
    var c3 = dot(v1Inf, v1Inf);
    var dvDeparture = norm(v1Inf);
    var dvArrival = norm(v2Inf);
    return {
      c3: c3, dvDeparture: dvDeparture, dvArrival: dvArrival,
      totalDv: dvDeparture + dvArrival,
      converged: lambert.converged,
      a: lambert.a, p: lambert.p,
      iterations: lambert.iterations,
      departureVelocity: lambert.v1, arrivalVelocity: lambert.v2,
      r1: s1.r, r2: s2.r
    };
  }

  /*
   * Departure epoch versus time of flight grid.
   * Numerical Lambert cells are used when the grid is small enough; otherwise a
   * patched conic approximation keeps the browser responsive and is calibrated
   * against Lambert cells from the same window.
   */
  function computePorkchopGrid(config) {
    config = config || {};
    var key = config.preset || 'earth-mars';
    var base = PRESET_WINDOWS[key];
    if (!base) throw new RangeError('Unknown porkchop preset: ' + key);
    var w = {
      label: base.label, mu: num(config.mu, base.mu),
      r1: num(config.r1, base.r1), r2: num(config.r2, base.r2),
      i1: num(config.i1, base.i1), i2: num(config.i2, base.i2),
      n1: num(config.n1, base.n1), n2: num(config.n2, base.n2),
      phase0: num(config.phase0, base.phase0),
      departureDays: config.departureDays || base.departureDays,
      flightDays: config.flightDays || base.flightDays,
      departureSteps: clamp(Math.round(num(config.departureSteps, base.departureSteps)), 2, 80),
      flightSteps: clamp(Math.round(num(config.flightSteps, base.flightSteps)), 2, 80),
      description: base.description
    };
    var prograde = config.prograde !== false;
    var useLambert = config.method === 'lambert' ||
      (config.method !== 'analytic' && w.departureSteps * w.flightSteps <= 900);
    var t0 = w.departureDays[0] * CONSTANTS.DAY;
    var t1 = w.departureDays[1] * CONSTANTS.DAY;
    var f0 = w.flightDays[0] * CONSTANTS.DAY;
    var f1 = w.flightDays[1] * CONSTANTS.DAY;
    var departureEpochs = [], flightTimes = [], cells = [];
    var di, fi, depSec, flSec;
    for (di = 0; di < w.departureSteps; di++) {
      depSec = t0 + (t1 - t0) * di / (w.departureSteps - 1);
      departureEpochs.push(depSec);
    }
    for (fi = 0; fi < w.flightSteps; fi++) {
      flSec = f0 + (f1 - f0) * fi / (w.flightSteps - 1);
      flightTimes.push(flSec);
    }

    /* Patched conic Hohmann phase model, used as a fast fallback. */
    var at = (w.r1 + w.r2) / 2;
    var nTrans = Math.sqrt(w.mu / (at * at * at));
    var dt0 = Math.PI / nTrans;
    var requiredPhase = Math.PI - w.n2 * dt0;
    function analyticCell(depSec, flSec) {
      var rel = w.n2 * depSec - w.n1 * depSec - w.phase0;
      var phaseError = Math.abs(Math.atan2(Math.sin(rel - requiredPhase), Math.cos(rel - requiredPhase)));
      var tofError = Math.abs(flSec - dt0) / dt0;
      var vc1 = Math.sqrt(w.mu / w.r1), vc2 = Math.sqrt(w.mu / w.r2);
      var vp = Math.sqrt(Math.max(0, w.mu * (2 / w.r1 - 2 / (w.r1 + w.r2))));
      var va = Math.sqrt(Math.max(0, w.mu * (2 / w.r2 - 2 / (w.r1 + w.r2))));
      var baseDv = Math.abs(vp - vc1) + Math.abs(vc2 - va);
      var penalty = 0.55 * baseDv * phaseError / Math.PI + 0.8 * baseDv * tofError;
      var inclPenalty = Math.min(vc1, vc2) * Math.abs(w.i2 - w.i1);
      var dvDep = baseDv * 0.55 + penalty * 0.6 + inclPenalty * 0.25;
      var dvArr = baseDv * 0.45 + penalty * 0.4 + inclPenalty * 0.25;
      return {
        dvDeparture: dvDep, dvArrival: dvArr, totalDv: dvDep + dvArr,
        c3: dvDep * dvDep, converged: true
      };
    }

    var correction = 1;
    if (!useLambert) {
      /* Calibrate the analytic surface on one Lambert cell near the Hohmann phase. */
      var calDep = t0 + (t1 - t0) * 0.5;
      var calFlight = clamp(dt0, f0, f1);
      var lam = solveCell(w, calDep, calFlight, prograde);
      var ana = analyticCell(calDep, calFlight);
      if (lam.converged && isFinite(lam.totalDv) && lam.totalDv > 0 && ana.totalDv > 0) {
        correction = clamp(lam.totalDv / ana.totalDv, 0.2, 5);
      }
    }

    var minTotal = Infinity, best = null, maxTotal = 0, minC3 = Infinity, minC3Cell = null;
    for (di = 0; di < w.departureSteps; di++) {
      for (fi = 0; fi < w.flightSteps; fi++) {
        depSec = departureEpochs[di];
        flSec = flightTimes[fi];
        var cell = useLambert ? solveCell(w, depSec, flSec, prograde) : analyticCell(depSec, flSec);
        if (!useLambert) {
          cell.totalDv *= correction;
          cell.dvDeparture *= correction;
          cell.dvArrival *= correction;
          cell.c3 = cell.dvDeparture * cell.dvDeparture;
        }
        if (!isFinite(cell.totalDv)) cell.totalDv = 1e12;
        var record = {
          departureIndex: di, flightIndex: fi,
          departureSec: depSec, departureDay: depSec / CONSTANTS.DAY,
          timeOfFlightSec: flSec, timeOfFlightDay: flSec / CONSTANTS.DAY,
          c3: cell.c3, dvDeparture: cell.dvDeparture, dvArrival: cell.dvArrival,
          totalDv: cell.totalDv, converged: cell.converged
        };
        cells.push(record);
        if (record.totalDv < minTotal) { minTotal = record.totalDv; best = record; }
        if (record.c3 < minC3) { minC3 = record.c3; minC3Cell = record; }
        if (record.totalDv < 1e11) maxTotal = Math.max(maxTotal, record.totalDv);
      }
    }
    return {
      preset: key, label: w.label, description: w.description,
      mu: w.mu, r1: w.r1, r2: w.r2,
      prograde: prograde, method: useLambert ? 'lambert' : 'analytic-calibrated',
      departureEpochs: departureEpochs, departureDays: departureEpochs.map(function (t) { return t / CONSTANTS.DAY; }),
      timeOfFlightSecs: flightTimes, flightDays: flightTimes.map(function (t) { return t / CONSTANTS.DAY; }),
      departureSteps: w.departureSteps, flightSteps: w.flightSteps,
      cells: cells, rows: w.flightSteps, cols: w.departureSteps,
      minimumTotalDv: minTotal, minimumC3: minC3, maximumTotalDv: maxTotal,
      optimal: best,
      optimalCell: best ? { departureIndex: best.departureIndex, flightIndex: best.flightIndex,
        departureDay: best.departureDay, timeOfFlightDay: best.timeOfFlightDay,
        totalDv: best.totalDv, c3: best.c3 } : null,
      optimalC3Cell: minC3Cell ? { departureIndex: minC3Cell.departureIndex,
        flightIndex: minC3Cell.flightIndex, c3: minC3Cell.c3 } : null,
      hohmannTimeOfFlightSec: dt0,
      hohmannPhaseRad: requiredPhase
    };
  }

  /* J2 secular drift rates, in degrees per day. */
  function j2DriftRates(a, e, inc, mu, j2, bodyRadius) {
    mu = num(mu, CONSTANTS.MU_EARTH);
    j2 = num(j2, CONSTANTS.J2_EARTH);
    bodyRadius = num(bodyRadius, CONSTANTS.R_EARTH);
    var p = a * (1 - e * e);
    var factor = 1.5 * j2 * bodyRadius * bodyRadius * Math.sqrt(mu) /
      (Math.pow(a, 3.5) * Math.pow(1 - e * e, 2));
    var raanRate = -factor * Math.cos(inc) * CONSTANTS.DAY * DEG;
    var argPeRate = 0.5 * factor * (5 * Math.cos(inc) * Math.cos(inc) - 1) * CONSTANTS.DAY * DEG;
    var meanRate = 0.5 * factor * Math.sqrt(1 - e * e) *
      (3 * Math.cos(inc) * Math.cos(inc) - 1) * CONSTANTS.DAY * DEG;
    return {
      p: p, raanDriftDegPerDay: raanRate,
      argPeDriftDegPerDay: argPeRate,
      meanMotionDriftDegPerDay: meanRate,
      j2: j2, bodyRadius: bodyRadius
    };
  }

  /*
   * Solve for the retrograde inclination whose J2 nodal precession matches the
   * apparent solar rate for a Sun Synchronous Orbit. Returns null if no solution.
   */
  function solveSunSyncInclination(a, e, options) {
    options = options || {};
    var mu = num(options.mu, CONSTANTS.MU_EARTH);
    var j2 = num(options.j2, CONSTANTS.J2_EARTH);
    var bodyRadius = num(options.bodyRadius, CONSTANTS.R_EARTH);
    var target = num(options.targetDriftDegPerDay, CONSTANTS.SUN_SYNC_DRIFT_DEG_PER_DAY);
    var ecc = num(e, 0);
    var magnitude = 1.5 * j2 * bodyRadius * bodyRadius * Math.sqrt(mu) /
      (Math.pow(a, 3.5) * Math.pow(1 - ecc * ecc, 2)) * CONSTANTS.DAY * DEG;
    var cosInc = -target / magnitude;
    if (!(Math.abs(cosInc) <= 1)) return null;
    var inc = Math.acos(clamp(cosInc, -1, 1));
    var check = j2DriftRates(a, ecc, inc, mu, j2, bodyRadius);
    return {
      inclinationRad: inc, inclinationDeg: inc * DEG,
      a: a, e: ecc,
      raanDriftDegPerDay: check.raanDriftDegPerDay,
      argPeDriftDegPerDay: check.argPeDriftDegPerDay,
      targetDriftDegPerDay: target,
      j2: j2, mu: mu, bodyRadius: bodyRadius
    };
  }

  /* Fourth order Runge Kutta propagation of the two body plus J2 equations. */
  function propagateRK4(r0, v0, dtSec, steps, options) {
    options = options || {};
    var mu = num(options.mu, CONSTANTS.MU_EARTH);
    var useJ2 = options.j2 !== 0 && options.j2 !== undefined;
    var j2 = useJ2 ? num(options.j2, CONSTANTS.J2_EARTH) : 0;
    var radiusBody = num(options.bodyRadius, CONSTANTS.R_EARTH);
    var count = clamp(Math.round(num(steps, 100)), 1, 100000);
    var total = num(dtSec, 0);
    var stepSize = total / count;
    var j2Factor = 1.5 * j2 * mu * radiusBody * radiusBody;

    function accel(r) {
      var x = r[0], y = r[1], z = r[2];
      var r2 = x * x + y * y + z * z;
      var rm = Math.sqrt(r2);
      var k = -mu / (r2 * rm);
      var ax = k * x, ay = k * y, az = k * z;
      if (useJ2 && j2Factor !== 0) {
        var q = j2Factor / (r2 * r2 * rm);
        var s = 5 * z * z / r2;
        ax += q * x * (s - 1);
        ay += q * y * (s - 1);
        az += q * z * (s - 3);
      }
      return [ax, ay, az];
    }
    function derivative(s) {
      var a = accel([s[0], s[1], s[2]]);
      return [s[3], s[4], s[5], a[0], a[1], a[2]];
    }
    function advance(s, h) {
      var k1 = derivative(s);
      var s2 = [], s3 = [], s4 = [], q;
      for (q = 0; q < 6; q++) s2[q] = s[q] + 0.5 * h * k1[q];
      var k2 = derivative(s2);
      for (q = 0; q < 6; q++) s3[q] = s[q] + 0.5 * h * k2[q];
      var k3 = derivative(s3);
      for (q = 0; q < 6; q++) s4[q] = s[q] + h * k3[q];
      var k4 = derivative(s4);
      var out = [];
      for (q = 0; q < 6; q++) out[q] = s[q] + h * (k1[q] + 2 * k2[q] + 2 * k3[q] + k4[q]) / 6;
      return out;
    }

    var r = vec(r0), v = vec(v0);
    var s = [r[0], r[1], r[2], v[0], v[1], v[2]];
    var e0 = dot(v, v) / 2 - mu / norm(r);
    var points = [{
      tSec: 0, tDay: 0, r: [r[0], r[1], r[2]], v: [v[0], v[1], v[2]],
      energy: e0, energyDrift: 0, radius: norm(r), speed: norm(v)
    }];
    var maxDrift = 0, idx;
    for (idx = 1; idx <= count; idx++) {
      s = advance(s, stepSize);
      var rs = [s[0], s[1], s[2]], vs = [s[3], s[4], s[5]];
      var energy = dot(vs, vs) / 2 - mu / norm(rs);
      var drift = Math.abs((energy - e0) / e0);
      maxDrift = Math.max(maxDrift, drift);
      points.push({
        tSec: idx * stepSize, tDay: idx * stepSize / CONSTANTS.DAY,
        r: rs.slice(), v: vs.slice(), energy: energy,
        energyDrift: (energy - e0) / e0, radius: norm(rs), speed: norm(vs)
      });
    }
    var finalEnergy = points[points.length - 1].energy;
    var el = stateToElements(points[0].r, points[0].v, mu);
    var inc = el.i, a = isFinite(el.a) ? el.a : 1 / (2 / norm(r) - dot(v, v) / mu);
    var driftRates = j2DriftRates(a, Math.min(el.eccentricity, 0.99), inc, mu, j2, radiusBody);
    return {
      points: points, trajectory: points,
      initialEnergy: e0, finalEnergy: finalEnergy,
      energyDrift: (finalEnergy - e0) / e0,
      maxEnergyDrift: maxDrift,
      stepSizeSec: stepSize, steps: count, dtSec: total,
      mu: mu, j2: j2, bodyRadius: radiusBody, j2Enabled: useJ2,
      raanDriftDegPerDay: useJ2 ? driftRates.raanDriftDegPerDay : 0,
      argPeDriftDegPerDay: useJ2 ? driftRates.argPeDriftDegPerDay : 0,
      meanMotionDriftDegPerDay: useJ2 ? driftRates.meanMotionDriftDegPerDay : 0,
      inclinationRad: inc, semiMajorAxis: a
    };
  }

  /* Tsiolkovsky multi stage rocket equation. */
  function computeStaging(stages, payloadKg) {
    if (!Array.isArray(stages) || stages.length === 0) throw new RangeError('At least one stage is required.');
    var payload = num(payloadKg, 0);
    if (!(payload > 0)) throw new RangeError('Payload mass must be positive.');
    var dry = [], prop = [], isp = [];
    for (var i = 0; i < stages.length; i++) {
      dry.push(Math.max(0, num(stages[i].dryMassKg, 0)));
      prop.push(Math.max(0, num(stages[i].propellantMassKg, 0)));
      isp.push(Math.max(1, num(stages[i].ispSec, 300)));
    }
    var wet = [];
    var remaining = payload;
    for (var j = stages.length - 1; j >= 0; j--) {
      wet[j] = remaining + dry[j] + prop[j];
      remaining = wet[j];
    }
    var breakdown = [], cumulative = 0;
    for (var k = 0; k < stages.length; k++) {
      var m0 = wet[k];
      var mf = m0 - prop[k];
      var massRatio = m0 / mf;
      var dv = isp[k] * CONSTANTS.G0 * Math.log(massRatio);
      cumulative += dv;
      breakdown.push({
        stage: k + 1,
        name: stages[k].name || ('Stage ' + (k + 1)),
        ispSec: isp[k], dryMassKg: dry[k], propellantMassKg: prop[k],
        initialMassKg: m0, finalMassKg: mf, massRatio: massRatio,
        dv: dv, cumulativeDv: cumulative,
        propellantFraction: prop[k] / m0
      });
    }
    var initialMass = wet[0];
    return {
      payloadKg: payload, initialMassKg: initialMass,
      totalMassRatio: initialMass / payload,
      payloadFraction: payload / initialMass,
      totalPropellantMassKg: prop.reduce(function (x, y) { return x + y; }, 0),
      totalDryMassKg: dry.reduce(function (x, y) { return x + y; }, 0),
      totalDv: cumulative,
      stages: breakdown,
      g0: CONSTANTS.G0
    };
  }

  function pad(value, width) { return String(value).padStart(width, '0'); }
  function formatEpoch(date) {
    var d = (date instanceof Date) ? date : new Date(date);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2) + '-' +
      pad(d.getUTCDate(), 2) + 'T' + pad(d.getUTCHours(), 2) + ':' +
      pad(d.getUTCMinutes(), 2) + ':' + pad(d.getUTCSeconds(), 2) + '.' +
      pad(d.getUTCMilliseconds(), 3);
  }
  function formatGmatEpoch(date) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var d = (date instanceof Date) ? date : new Date(date);
    return pad(d.getUTCDate(), 2) + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear() +
      ' ' + pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2) + ':' +
      pad(d.getUTCSeconds(), 2) + '.' + pad(d.getUTCMilliseconds(), 3);
  }
  function stateLine(point, epoch) {
    return [epoch,
      (point.r[0] / 1000).toFixed(6), (point.r[1] / 1000).toFixed(6), (point.r[2] / 1000).toFixed(6),
      (point.v[0] / 1000).toFixed(9), (point.v[1] / 1000).toFixed(9), (point.v[2] / 1000).toFixed(9)
    ].join(' ');
  }

  /* NASA General Mission Analysis Tool script exporter. */
  function exportGmatScript(mission) {
    mission = mission || {};
    var name = mission.name || 'OrbitLab Mission';
    var epoch = mission.epoch || '2026-11-08T00:00:00.000Z';
    var mu = num(mission.mu, CONSTANTS.MU_EARTH);
    var el = mission.elements || { a: CONSTANTS.LEO_RADIUS, e: 0, i: 0, raan: 0, argPe: 0, nu: 0 };
    var center = mission.center || (mu === CONSTANTS.MU_SUN ? 'Sun' : 'Earth');
    var frame = mission.frame || (mu === CONSTANTS.MU_SUN ? 'SunMJ2000Ec' : 'EarthMJ2000Eq');
    var sc = mission.spacecraftName || 'OrbitLabSat';
    var burnList = Array.isArray(mission.burns) ? mission.burns : [];
    var lines = [
      '%----------------------------------------',
      '% OrbitLab generated GMAT mission script',
      '% Mission: ' + name,
      '% Epoch: ' + formatEpoch(epoch),
      '%----------------------------------------',
      '',
      'Create Spacecraft ' + sc + ';',
      'GMAT ' + sc + '.DateFormat = UTCGregorian;',
      'GMAT ' + sc + '.Epoch = \'' + formatGmatEpoch(epoch) + '\';',
      'GMAT ' + sc + '.CoordinateSystem = ' + frame + ';',
      'GMAT ' + sc + '.DisplayStateType = Keplerian;',
      'GMAT ' + sc + '.SMA = ' + (el.a / 1000).toFixed(6) + ';',
      'GMAT ' + sc + '.ECC = ' + Number(el.e).toFixed(9) + ';',
      'GMAT ' + sc + '.INC = ' + (el.i * DEG).toFixed(6) + ';',
      'GMAT ' + sc + '.RAAN = ' + (el.raan * DEG).toFixed(6) + ';',
      'GMAT ' + sc + '.AOP = ' + (el.argPe * DEG).toFixed(6) + ';',
      'GMAT ' + sc + '.TA = ' + (el.nu * DEG).toFixed(6) + ';',
      'GMAT ' + sc + '.DryMass = ' + Number(num(mission.dryMassKg, 850)).toFixed(3) + ';',
      ''
    ];
    burnList.forEach(function (burn, i) {
      var id = burn.id || ('Burn' + (i + 1));
      lines.push('Create ImpulsiveBurn ' + id + ';');
      lines.push('GMAT ' + id + '.CoordinateSystem = LocalVNB;');
      lines.push('GMAT ' + id + '.Element1 = ' + Number(num(burn.dv1, burn.dv || 0) / 1000).toFixed(9) + ';');
      lines.push('GMAT ' + id + '.Element2 = ' + Number(num(burn.dv2, 0) / 1000).toFixed(9) + ';');
      lines.push('GMAT ' + id + '.Element3 = ' + Number(num(burn.dv3, 0) / 1000).toFixed(9) + ';');
      lines.push('');
    });
    lines.push('Create Propagator OrbitLabProp;');
    lines.push('GMAT OrbitLabProp.Type = RungeKutta89;');
    lines.push('GMAT OrbitLabProp.InitialStepSize = 60;');
    lines.push('GMAT OrbitLabProp.Accuracy = 1e-12;');
    lines.push('GMAT OrbitLabProp.CentralBody = ' + center + ';');
    lines.push('GMAT OrbitLabProp.PointMasses = {' + center + '};');
    if (mission.j2) {
      lines.push('GMAT OrbitLabProp.GravityField.Earth.Degree = 2;');
      lines.push('GMAT OrbitLabProp.GravityField.Earth.Order = 0;');
    }
    lines.push('');
    lines.push('Create OrbitView OrbitLabView;');
    lines.push('GMAT OrbitLabView.SolverIterations = Internal;');
    lines.push('GMAT OrbitLabView.Add = {' + sc + ', ' + center + '};');
    lines.push('');
    lines.push('MissionSequence;');
    burnList.forEach(function (burn, i) {
      var id = burn.id || ('Burn' + (i + 1));
      lines.push('Maneuver ' + id + '(' + sc + ');');
      var propTime = num(burn.propagateSec, mission.propagateSec || 3600);
      lines.push('Propagate OrbitLabProp(' + sc + ') { ' + sc + '.ElapsedSecs = ' + propTime.toFixed(1) + ' };');
    });
    if (!burnList.length) {
      lines.push('Propagate OrbitLabProp(' + sc + ') { ' + sc + '.ElapsedSecs = ' +
        Number(num(mission.propagateSec, 5400)).toFixed(1) + ' };');
    }
    lines.push('');
    return lines.join('\n');
  }

  /* CCSDS 2.0 Orbit Ephemeris Message exporter. Positions in km, velocity in km/s. */
  function exportCcsdsOem(trajectory, meta) {
    if (!Array.isArray(trajectory) || trajectory.length === 0) throw new RangeError('Trajectory needs at least one state.');
    meta = meta || {};
    var epoch0 = meta.epoch || '2026-11-08T00:00:00.000Z';
    var base = new Date(epoch0).getTime();
    var objectName = meta.objectName || 'ORBITLAB SAT';
    var objectId = meta.objectId || '2026-001A';
    var center = meta.centerName || (num(meta.mu, CONSTANTS.MU_EARTH) === CONSTANTS.MU_SUN ? 'SUN' : 'EARTH');
    var frame = meta.refFrame || (center === 'SUN' ? 'EME2000' : 'ICRF');
    var lines = [
      'CCSDS_OEM_VERS = 2.0',
      'CREATION_DATE = ' + formatEpoch(new Date()).replace(/\.\d{3}$/, ''),
      'ORIGINATOR = ' + (meta.originator || 'ORBITLAB'),
      '',
      'META_START',
      'OBJECT_NAME          = ' + objectName,
      'OBJECT_ID            = ' + objectId,
      'CENTER_NAME          = ' + center,
      'REF_FRAME            = ' + frame,
      'TIME_SYSTEM          = UTC',
      'START_TIME           = ' + formatEpoch(base).replace(/\.\d{3}$/, ''),
      'STOP_TIME            = ' + formatEpoch(base + num(trajectory[trajectory.length - 1].tSec, 0) * 1000).replace(/\.\d{3}$/, ''),
      'INTERPOLATION        = HERMITE',
      'INTERPOLATION_DEGREE = 5',
      'META_STOP',
      ''
    ];
    trajectory.forEach(function (p, i) {
      var t = p.tSec !== undefined ? p.tSec : i;
      var epoch = formatEpoch(base + t * 1000);
      lines.push(stateLine(p, epoch));
    });
    lines.push('');
    lines.push('META_START');
    lines.push('OBJECT_NAME          = ' + objectName);
    lines.push('META_STOP');
    lines.push('');
    return lines.join('\n');
  }

  function exportTrajectoryCsv(trajectory) {
    var header = 'epoch_utc,t_sec,t_day,x_m,y_m,z_m,vx_m_s,vy_m_s,vz_m_s,r_m,v_m_s,specific_energy_j_kg';
    var mu = CONSTANTS.MU_EARTH;
    var rows = [header];
    (trajectory || []).forEach(function (p, i) {
      var t = num(p.tSec, i);
      var r = vec(p.r), v = vec(p.v);
      var epoch = p.epoch || formatEpoch(Date.UTC(2026, 10, 8) + t * 1000);
      var energy = p.energy !== undefined ? p.energy : dot(v, v) / 2 - mu / norm(r);
      rows.push([
        epoch, t.toFixed(6), (t / CONSTANTS.DAY).toFixed(9),
        r[0].toFixed(6), r[1].toFixed(6), r[2].toFixed(6),
        v[0].toFixed(9), v[1].toFixed(9), v[2].toFixed(9),
        norm(r).toFixed(6), norm(v).toFixed(9), energy.toFixed(6)
      ].join(','));
    });
    return rows.join('\n') + '\n';
  }

  /* Sample one elliptic orbit at evenly spaced mean anomalies. */
  function sampleOrbit(elements, mu, samples) {
    mu = num(mu, CONSTANTS.MU_EARTH);
    var count = clamp(Math.round(num(samples, 180)), 8, 2000);
    var state = elementsToState(elements, mu);
    var a = elements.a, e = elements.e;
    var n = Math.sqrt(mu / (a * a * a));
    var m = pqwToIjkMatrix(elements.raan || 0, elements.i || 0, elements.argPe || 0);
    var points = [];
    for (var i = 0; i < count; i++) {
      var M = TAU * i / (count - 1);
      var sol = solveKepler(M, e);
      var E = sol.anomaly;
      var nu = sol.trueAnomaly;
      var radius = a * (1 - e * Math.cos(E));
      var k = Math.sqrt(mu / (a * (1 - e * e)));
      var rP = matVec(m, [radius * Math.cos(nu), radius * Math.sin(nu), 0]);
      var vP = matVec(m, [-k * Math.sin(E) * Math.sqrt(1 - e * e) / (1 - e * Math.cos(E)),
        k * Math.sqrt(1 - e * e) * Math.cos(E) / (1 - e * Math.cos(E)), 0]);
      points.push({
        tSec: M / n, tDay: M / n / CONSTANTS.DAY,
        M: M, E: E, nu: nu,
        r: rP, v: vP, radius: radius, speed: norm(vP)
      });
    }
    return { points: points, elements: elements, mu: mu, periodSec: state.periodSec, state: state };
  }

  var sunSyncA = CONSTANTS.R_EARTH + 705000;
  var sunSync = solveSunSyncInclination(sunSyncA, 0.001);
  var molniyaA = 26554000;

  var PRESETS = Object.freeze([
    {
      id: 'leo-geo-comms',
      name: 'LEO to GEO Comms Transfer',
      category: 'Geocentric transfer',
      mu: CONSTANTS.MU_EARTH,
      elements: { a: CONSTANTS.LEO_RADIUS, e: 0, i: 0, raan: 0, argPe: 0, nu: 0 },
      r1: CONSTANTS.LEO_RADIUS, r2: CONSTANTS.GEO_RADIUS,
      description: 'A two impulse Hohmann raise from a 400 km parking orbit to geostationary radius.',
      hohmann: hohmannTransfer(CONSTANTS.LEO_RADIUS, CONSTANTS.GEO_RADIUS, CONSTANTS.MU_EARTH),
      porkchopPreset: 'leo-geo'
    },
    {
      id: 'sun-sync-eo1',
      name: 'Sun-Synchronous EO-1 (705 km)',
      category: 'Earth observation',
      mu: CONSTANTS.MU_EARTH,
      elements: {
        a: sunSyncA, e: 0.001,
        i: sunSync ? sunSync.inclinationRad : 98.2 * RAD,
        raan: 30 * RAD, argPe: 90 * RAD, nu: 0
      },
      sunSync: sunSync,
      description: 'A 705 km retrograde orbit whose nodal regression tracks the apparent solar rate.',
      porkchopPreset: 'leo-geo'
    },
    {
      id: 'molniya-12h',
      name: 'Molniya 12h High-Eccentricity',
      category: 'High eccentricity',
      mu: CONSTANTS.MU_EARTH,
      elements: {
        a: molniyaA, e: 0.72, i: 63.4 * RAD,
        raan: 210 * RAD, argPe: 270 * RAD, nu: 0
      },
      description: 'A twelve hour critically inclined orbit with apogee dwell over high latitudes.',
      porkchopPreset: 'leo-lunar'
    },
    {
      id: 'earth-mars-rendezvous',
      name: 'Earth to Mars Rendezvous',
      category: 'Interplanetary',
      mu: CONSTANTS.MU_SUN,
      elements: { a: CONSTANTS.AU, e: 0.0167, i: 0, raan: 0, argPe: 102.9 * RAD, nu: 0 },
      r1: CONSTANTS.AU, r2: 1.524 * CONSTANTS.AU,
      description: 'Heliocentric minimum energy transfer window from Earth to Mars.',
      porkchopPreset: 'earth-mars'
    },
    {
      id: 'bi-elliptic-deep-space',
      name: 'Bi-Elliptic Deep-Space (r2/r1 = 15)',
      category: 'Three impulse transfer',
      mu: CONSTANTS.MU_EARTH,
      elements: { a: CONSTANTS.LEO_RADIUS, e: 0, i: 0, raan: 0, argPe: 0, nu: 0 },
      r1: CONSTANTS.LEO_RADIUS,
      r2: 15 * CONSTANTS.LEO_RADIUS,
      rb: 50 * CONSTANTS.LEO_RADIUS,
      description: 'A three burn bi-elliptic raise that beats Hohmann beyond the critical radius ratio.',
      biElliptic: biEllipticTransfer(CONSTANTS.LEO_RADIUS, 15 * CONSTANTS.LEO_RADIUS,
        50 * CONSTANTS.LEO_RADIUS, CONSTANTS.MU_EARTH),
      porkchopPreset: 'earth-mars'
    }
  ]);

  var API = {
    version: '1.0.0',
    CONSTANTS: CONSTANTS,
    PRESETS: PRESETS,
    PRESET_WINDOWS: PRESET_WINDOWS,
    TAU: TAU,
    DEG: DEG,
    RAD: RAD,
    vectors: {
      add: add, sub: sub, scale: scale, dot: dot, cross: cross,
      norm: norm, normalize: normalize, matVec: matVec, pqwToIjkMatrix: pqwToIjkMatrix
    },
    solveKepler: solveKepler,
    elementsToState: elementsToState,
    stateToElements: stateToElements,
    hohmannTransfer: hohmannTransfer,
    biEllipticTransfer: biEllipticTransfer,
    combinedPlaneChange: combinedPlaneChange,
    solveLambert: solveLambert,
    computePorkchopGrid: computePorkchopGrid,
    propagateRK4: propagateRK4,
    j2DriftRates: j2DriftRates,
    solveSunSyncInclination: solveSunSyncInclination,
    computeStaging: computeStaging,
    sampleOrbit: sampleOrbit,
    circularState: circularState,
    exportGmatScript: exportGmatScript,
    exportCcsdsOem: exportCcsdsOem,
    exportTrajectoryCsv: exportTrajectoryCsv,
    formatEpoch: formatEpoch
  };

  return API;
});
