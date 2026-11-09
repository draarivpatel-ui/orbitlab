/* OrbitLab browser workbench. Depends on orbit.js exposing window.OrbitLab. */
(function () {
  'use strict';
  var O = window.OrbitLab;
  if (!O) { console.error('OrbitLab engine did not load.'); return; }
  var C = O.CONSTANTS, V = O.vectors, NS = 'http://www.w3.org/2000/svg';
  var doc = window.document;

  var state = {
    presetId: O.PRESETS[0].id,
    view: 'plane',
    windowPreset: 'earth-mars',
    j2: false,
    scrub: 0,
    playing: false,
    timer: null,
    cell: { departureIndex: 0, flightIndex: 0 }
  };

  var data = {
    preset: null, orbit: null, hohmann: null, burns: [], staging: null,
    porkchop: null, propagation: null, trajectory: null
  };

  var SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
  var SEQ_STEPS = ['#CDE2FB', '#9EC5F4', '#6DA7EC', '#3987E5', '#256ABF', '#184F95', '#0D366B'];

  function $(id) { return doc.getElementById(id); }
  function el(tag, attrs, text) {
    var node = doc.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.setAttribute('class', attrs[k]);
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, String(attrs[k]));
    });
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function html(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function cssVar(name) {
    return getComputedStyle(doc.documentElement).getPropertyValue(name).trim() || '#3987E5';
  }
  function seriesColor(i) { return cssVar('--series-' + (i + 1)) || SERIES[i % 4]; }
  function num(v, digits) {
    if (!isFinite(v)) return 'n/a';
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits === undefined ? 2 : digits,
      minimumFractionDigits: digits === undefined ? 2 : digits });
  }
  function sci(v, digits) {
    if (!isFinite(v)) return 'n/a';
    return Number(v).toExponential(digits === undefined ? 2 : digits);
  }
  function compact(v, digits) {
    var d = digits === undefined ? 2 : digits;
    if (!isFinite(v)) return 'n/a';
    if (Math.abs(v) >= 1e9) return num(v / 1e9, d) + 'B';
    if (Math.abs(v) >= 1e6) return num(v / 1e6, d) + 'M';
    if (Math.abs(v) >= 1e3) return num(v / 1e3, d) + 'K';
    return num(v, d);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* Sequential single hue ramp for the porkchop heatmap. */
  function rampColor(t) {
    var x = clamp(t, 0, 1) * (SEQ_STEPS.length - 1);
    var i = Math.min(SEQ_STEPS.length - 2, Math.floor(x));
    var f = x - i;
    var a = hexToRgb(SEQ_STEPS[i]), b = hexToRgb(SEQ_STEPS[i + 1]);
    return 'rgb(' + Math.round(lerp(a[0], b[0], f)) + ',' +
      Math.round(lerp(a[1], b[1], f)) + ',' +
      Math.round(lerp(a[2], b[2], f)) + ')';
  }
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function showTooltip(id, x, y, title, rows) {
    var tip = $(id);
    clear(tip);
    tip.appendChild(html('div', 'tip-title', title));
    rows.forEach(function (row) {
      var line = html('div', 'tip-row');
      var label = html('span', 'tip-label');
      if (row.color) {
        var key = html('i', 'tip-key');
        key.style.background = row.color;
        label.appendChild(key);
      }
      label.appendChild(doc.createTextNode(row.label));
      var value = html('strong', 'tip-value', row.value);
      line.appendChild(label); line.appendChild(value);
      tip.appendChild(line);
    });
    tip.hidden = false;
    var frame = tip.parentNode.getBoundingClientRect();
    var width = 170, height = 22 + rows.length * 20;
    tip.style.left = clamp(x + 14, 4, Math.max(4, frame.width - width)) + 'px';
    tip.style.top = clamp(y - height - 10, 4, Math.max(4, frame.height - height)) + 'px';
  }
  function hideTooltip(id) { var tip = $(id); if (tip) tip.hidden = true; }

  /* Legend built with textContent so labels never enter the DOM as markup. */
  function renderLegend(id, items) {
    var box = $(id);
    clear(box);
    (items || []).forEach(function (item) {
      var row = html('span', 'legend-item');
      var swatch = html('i', 'legend-swatch' + (item.rect ? ' rect' : ''));
      swatch.style.background = item.color;
      row.appendChild(swatch);
      row.appendChild(doc.createTextNode(item.label));
      box.appendChild(row);
    });
  }
  function renderScaleLegend(id) {
    var box = $(id);
    clear(box);
    box.appendChild(html('span', null, 'Low'));
    var ramp = html('span', 'legend-ramp');
    SEQ_STEPS.forEach(function (step) {
      var swatch = html('i');
      swatch.style.background = step;
      ramp.appendChild(swatch);
    });
    box.appendChild(ramp);
    box.appendChild(html('span', null, 'High dv'));
  }

  /* Accessible table twin builder. */
  function renderTable(tableId, headers, rows, optimalIndex) {
    var table = $(tableId);
    var caption = table.querySelector('caption');
    var captionText = caption ? caption.textContent : '';
    clear(table);
    if (captionText) {
      var cap = doc.createElement('caption');
      cap.textContent = captionText;
      table.appendChild(cap);
    }
    var thead = doc.createElement('thead');
    var hrow = doc.createElement('tr');
    headers.forEach(function (h) { hrow.appendChild(html('th', null, h)); });
    thead.appendChild(hrow);
    table.appendChild(thead);
    var tbody = doc.createElement('tbody');
    rows.forEach(function (row, i) {
      var tr = doc.createElement('tr');
      if (optimalIndex === i) tr.className = 'optimal-row';
      row.forEach(function (cell) { tr.appendChild(html('td', null, cell)); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function downloadFile(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url; a.download = filename;
    doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
    if (URL.revokeObjectURL) setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    var status = $('download-status');
    if (status) status.textContent = 'Downloaded ' + filename;
  }

  var STAGE_SPEC = [
    { name: ' booster core', ispSec: 282, dryMassKg: 23000, propellantMassKg: 410000 },
    { name: ' upper stage', ispSec: 348, dryMassKg: 4200, propellantMassKg: 108000 },
    { name: ' kick stage', ispSec: 452, dryMassKg: 950, propellantMassKg: 16500 }
  ];

  function buildMission() {
    var preset = null;
    O.PRESETS.forEach(function (p) { if (p.id === state.presetId) preset = p; });
    if (!preset) preset = O.PRESETS[0];
    data.preset = preset;
    data.orbit = O.sampleOrbit(preset.elements, preset.mu, 181);
    var orbitState = data.orbit.state;
    var r1 = preset.r1 || orbitState.periapsisRadius;
    var r2 = preset.r2 || (orbitState.apoapsisRadius || orbitState.periapsisRadius * 1.6);
    data.hohmann = preset.biElliptic
      ? O.hohmannTransfer(r1, r2, preset.mu)
      : (preset.hohmann || O.hohmannTransfer(r1, r2, preset.mu));
    data.biElliptic = preset.biElliptic || null;
    if (preset.biElliptic) {
      data.burns = [
        { name: 'Departure raise', dv: preset.biElliptic.dv1 },
        { name: 'Apoapsis plane trim', dv: preset.biElliptic.dv2 },
        { name: 'Arrival circularize', dv: preset.biElliptic.dv3 }
      ];
    } else {
      data.burns = [
        { name: 'Departure impulse', dv: data.hohmann.dv1 },
        { name: 'Arrival circularize', dv: data.hohmann.dv2 }
      ];
    }
    data.burnTotal = data.burns.reduce(function (sum, b) { return sum + b.dv; }, 0);
    data.staging = O.computeStaging(STAGE_SPEC, 4200);
    data.propagation = O.propagateRK4(orbitState.r, orbitState.v,
      data.orbit.periodSec, 240, {
        mu: preset.mu,
        j2: state.j2 ? C.J2_EARTH : 0,
        bodyRadius: C.R_EARTH
      });
    data.trajectory = data.propagation.points;
    data.porkchop = O.computePorkchopGrid({
      preset: state.windowPreset, departureSteps: 22, flightSteps: 18
    });
    if (data.porkchop.optimal) {
      state.cell.departureIndex = data.porkchop.optimal.departureIndex;
      state.cell.flightIndex = data.porkchop.optimal.flightIndex;
    }
  }

  function updateHero() {
    $('hero-mission').textContent = data.preset.name;
    $('hero-dv').textContent = num(data.burnTotal, 2);
    var p = data.orbit.periodSec;
    $('hero-period').textContent = p ? num(p / 3600, 2) + ' h' : 'Open orbit';
    $('preset-description').textContent = data.preset.description;
  }

  function updateReference() {
    var box = $('reference-grid');
    clear(box);
    var s = data.orbit.state;
    var rows = [
      ['MU', 'Gravitational parameter', sci(data.preset.mu, 4) + ' m3/s2'],
      ['a', 'Semi major axis', compact(s.semiMajorAxis, 2) + ' m'],
      ['e', 'Eccentricity', num(s.eccentricity, 5)],
      ['i', 'Inclination', num(data.preset.elements.i * O.DEG, 3) + ' deg'],
      ['h', 'Angular momentum', sci(s.hMagnitude, 4) + ' m2/s'],
      ['E', 'Specific energy', sci(s.specificEnergy, 4) + ' J/kg'],
      ['rp', 'Periapsis radius', compact(s.periapsisRadius, 2) + ' m'],
      ['ra', 'Apoapsis radius', s.apoapsisRadius ? compact(s.apoapsisRadius, 2) + ' m' : 'unbounded'],
      ['T', 'Orbital period', data.orbit.periodSec ? num(data.orbit.periodSec / 3600, 3) + ' h' : 'none'],
      ['vp', 'Periapsis speed', num(s.periapsisSpeed, 1) + ' m/s'],
      ['va', 'Apoapsis speed', s.apoapsisSpeed ? num(s.apoapsisSpeed, 1) + ' m/s' : 'none'],
      ['C3', 'Characteristic energy', sci(data.porkchop.minimumC3, 4) + ' m2/s2']
    ];
    rows.forEach(function (r) {
      var item = html('div', 'reference-item');
      item.appendChild(html('strong', null, r[0] + ' / ' + r[2]));
      item.appendChild(html('span', null, r[1]));
      box.appendChild(item);
    });
  }

  /* Project an inertial vector into the chart plane. */
  function project(p, view, scale, cx, cy) {
    if (view === 'plane') {
      var m = V.pqwToIjkMatrix(data.preset.elements.raan || 0,
        data.preset.elements.i || 0, data.preset.elements.argPe || 0);
      /* Columns of the rotation matrix are the perifocal axes. */
      var xAxis = [m[0][0], m[1][0], m[2][0]];
      var yAxis = [m[0][1], m[1][1], m[2][1]];
      return [cx + V.dot(p, xAxis) * scale, cy - V.dot(p, yAxis) * scale];
    }
    var isoX = 0.866 * p[0] - 0.866 * p[1];
    var isoY = -0.5 * p[0] - 0.5 * p[1] + p[2];
    return [cx + isoX * scale, cy - isoY * scale];
  }

  function drawAxes(svg, width, height, box, xTitle, yTitle, ticksX, ticksY, color) {
    var g = el('g');
    ticksX.forEach(function (t) {
      var x = box.x + box.w * t.u;
      g.appendChild(el('line', { x1: x, y1: box.y, x2: x, y2: box.y + box.h, 'class': 'gridline' }));
      if (t.label !== null) g.appendChild(el('text', { x: x, y: box.y + box.h + 16, 'class': 'axis-tick',
        'text-anchor': 'middle' }, t.label));
    });
    ticksY.forEach(function (t) {
      var y = box.y + box.h * (1 - t.u);
      g.appendChild(el('line', { x1: box.x, y1: y, x2: box.x + box.w, y2: y, 'class': 'gridline' }));
      g.appendChild(el('text', { x: box.x - 8, y: y + 3, 'class': 'axis-tick', 'text-anchor': 'end' }, t.label));
    });
    g.appendChild(el('line', { x1: box.x, y1: box.y + box.h, x2: box.x + box.w, y2: box.y + box.h, 'class': 'baseline' }));
    g.appendChild(el('line', { x1: box.x, y1: box.y, x2: box.x, y2: box.y + box.h, 'class': 'baseline' }));
    g.appendChild(el('text', { x: box.x + box.w / 2, y: height - 4, 'class': 'axis-title', 'text-anchor': 'middle' }, xTitle));
    g.appendChild(el('text', { x: 12, y: box.y + box.h / 2, 'class': 'axis-title', 'text-anchor': 'middle',
      transform: 'rotate(-90 12 ' + (box.y + box.h / 2) + ')' }, yTitle));
    svg.appendChild(g);
  }

  function renderTrajectory() {
    var svg = $('trajectory-svg');
    clear(svg);
    var desc = el('desc', { id: 'trajectory-desc' },
      'Orbit path, central body, spacecraft, velocity vector and apsis markers. The matching data table follows the chart.');
    svg.appendChild(desc);
    var width = 760, height = 420;
    var box = { x: 62, y: 22, w: 660, h: 340 };
    var pts = data.orbit.points;
    var maxR = 0;
    pts.forEach(function (p) { maxR = Math.max(maxR, V.norm(p.r)); });
    var scale = Math.min(box.w * 0.47, box.h * 0.47) / maxR;
    var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    var path = [];
    var coords = pts.map(function (p) {
      var q = project(p.r, state.view, scale, cx, cy);
      path.push((path.length ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2));
      return q;
    });

    drawAxes(svg, width, height, box,
      state.view === 'plane' ? 'Perifocal X (m)' : 'Inertial X / Y (m)',
      state.view === 'plane' ? 'Perifocal Y (m)' : 'Inertial Z (m)',
      [{ u: 0, label: '-' + compact(maxR, 1) }, { u: 0.25, label: null }, { u: 0.5, label: '0' },
        { u: 0.75, label: null }, { u: 1, label: compact(maxR, 1) }],
      [{ u: 0, label: '-' + compact(maxR, 1) }, { u: 0.25, label: null }, { u: 0.5, label: '0' },
        { u: 0.75, label: null }, { u: 1, label: compact(maxR, 1) }]);

    /* Central body. */
    var bodyR = clamp(Math.min(box.w, box.h) * 0.055, 12, 26);
    svg.appendChild(el('circle', { cx: cx, cy: cy, r: bodyR, fill: 'var(--planet)',
      stroke: 'var(--planet-rim)', 'stroke-width': 1 }));
    svg.appendChild(el('text', { x: cx + bodyR + 7, y: cy + 4, 'class': 'axis-tick' }, 'central body'));

    /* Apsis markers. */
    var rp = V.normalize(data.orbit.state.eccentricityVector);
    if (V.norm(rp) === 0) rp = [1, 0, 0];
    var apsis = [
      { label: 'periapsis', r: V.scale(rp, data.orbit.state.periapsisRadius), color: seriesColor(2) },
      { label: 'apoapsis', r: V.scale(rp, -data.orbit.state.apoapsisRadius || data.orbit.state.periapsisRadius), color: seriesColor(3) }
    ];
    apsis.forEach(function (a) {
      var q = project(a.r, state.view, scale, cx, cy);
      svg.appendChild(el('circle', { cx: q[0], cy: q[1], r: 5, fill: cssVar('--surface-1'),
        stroke: a.color, 'stroke-width': 2 }));
      svg.appendChild(el('text', { x: q[0] + 9, y: q[1] - 7, 'class': 'direct-label' }, a.label));
    });

    /* Burn markers at departure and arrival anomalies. */
    var burnAnomalies = [0, Math.PI];
    burnAnomalies.forEach(function (nu, i) {
      var idx = Math.round(nu / O.TAU * (pts.length - 1));
      var q = coords[clamp(idx, 0, coords.length - 1)];
      var c = seriesColor(1);
      svg.appendChild(el('circle', { cx: q[0], cy: q[1], r: 6, fill: c,
        stroke: 'var(--surface-1)', 'stroke-width': 2 }));
      svg.appendChild(el('text', { x: q[0] + 10, y: q[1] + 4, 'class': 'direct-label' },
        'burn ' + (i + 1)));
    });

    /* Orbit path. */
    svg.appendChild(el('path', { d: path.join(' ') + ' Z', fill: 'none',
      stroke: seriesColor(0), 'stroke-width': 2, 'stroke-linejoin': 'round' }));

    /* Spacecraft and velocity vector at the scrubbed true anomaly. */
    var scrubIdx = Math.round(state.scrub / 100 * (pts.length - 1));
    var p = pts[clamp(scrubIdx, 0, pts.length - 1)];
    var q = coords[clamp(scrubIdx, 0, coords.length - 1)];
    var speed = V.norm(p.v) || 1;
    var vEnd = project(V.add(p.r, V.scale(p.v, maxR / speed * 0.14)), state.view, scale, cx, cy);
    svg.appendChild(el('line', { x1: q[0], y1: q[1], x2: vEnd[0], y2: vEnd[1],
      stroke: seriesColor(1), 'stroke-width': 2, 'stroke-linecap': 'round' }));
    svg.appendChild(el('circle', { cx: vEnd[0], cy: vEnd[1], r: 3, fill: seriesColor(1) }));
    svg.appendChild(el('circle', { id: 'spacecraft-marker', cx: q[0], cy: q[1], r: 8,
      fill: cssVar('--surface-1'), stroke: seriesColor(0), 'stroke-width': 2 }));
    svg.appendChild(el('circle', { cx: q[0], cy: q[1], r: 3.5, fill: seriesColor(0) }));
    svg.appendChild(el('text', { x: q[0] + 12, y: q[1] - 10, 'class': 'direct-label' }, 'spacecraft'));

    /* Transparent hit layer with a nearest point crosshair. */
    var hit = el('rect', { x: box.x, y: box.y, width: box.w, height: box.h,
      'class': 'mark-hit' });
    svg.appendChild(hit);
    var ghost = el('circle', { r: 5, fill: cssVar('--surface-1'), stroke: seriesColor(0),
      'stroke-width': 2, opacity: 0 });
    svg.appendChild(ghost);
    hit.addEventListener('mousemove', function (ev) {
      var rect = svg.getBoundingClientRect();
      var mx = (ev.clientX - rect.left) / rect.width * width;
      var my = (ev.clientY - rect.top) / rect.height * height;
      var best = 0, bestD = Infinity;
      coords.forEach(function (c, i) {
        var d = (c[0] - mx) * (c[0] - mx) + (c[1] - my) * (c[1] - my);
        if (d < bestD) { bestD = d; best = i; }
      });
      var c = coords[best], sample = pts[best];
      ghost.setAttribute('cx', c[0]); ghost.setAttribute('cy', c[1]); ghost.setAttribute('opacity', 1);
      showTooltip('trajectory-tooltip', ev.clientX - rect.left, ev.clientY - rect.top,
        'Orbit sample ' + best, [
          { label: 'radius', value: compact(sample.radius, 2) + ' m', color: seriesColor(0) },
          { label: 'speed', value: num(sample.speed, 1) + ' m/s', color: seriesColor(1) },
          { label: 'true anomaly', value: num(sample.nu * O.DEG, 1) + ' deg' },
          { label: 'elapsed', value: num(sample.tSec / 60, 1) + ' min' }
        ]);
    });
    hit.addEventListener('mouseleave', function () {
      ghost.setAttribute('opacity', 0);
      hideTooltip('trajectory-tooltip');
    });

    renderLegend('trajectory-legend', [
      { label: 'Orbit path', color: seriesColor(0) },
      { label: 'Velocity vector', color: seriesColor(1) },
      { label: 'Periapsis', color: seriesColor(2), rect: true },
      { label: 'Apoapsis', color: seriesColor(3), rect: true }
    ]);
    $('trajectory-sub').textContent = state.view === 'plane'
      ? '2D perifocal plane: velocity vector, apsides and burn markers'
      : '3D inertial projection: velocity vector, apsides and burn markers';

    var step = Math.max(1, Math.floor(pts.length / 16));
    var rows = [];
    for (var i = 0; i < pts.length; i += step) {
      var s = pts[i];
      rows.push([num(s.nu * O.DEG, 1) + ' deg', num(s.tSec / 60, 2),
        compact(s.radius, 3), num(s.speed, 2), compact(s.r[0], 3), compact(s.r[1], 3), compact(s.r[2], 3)]);
    }
    renderTable('trajectory-table', ['True anomaly', 't (min)', 'r (m)', 'v (m/s)', 'x (m)', 'y (m)', 'z (m)'], rows);
  }

  function renderTransfer() {
    var svg = $('transfer-svg');
    clear(svg);
    svg.appendChild(el('desc', { id: 'transfer-desc' },
      'Horizontal bars showing the delta v of each maneuver burn.'));
    var width = 420, height = 270;
    var box = { x: 108, y: 34, w: 278, h: 180 };
    var max = Math.max.apply(null, data.burns.map(function (b) { return b.dv; })) * 1.15 || 1;
    var gap = data.burns.length > 1 ? 18 : 0;
    var barH = (box.h - gap * (data.burns.length - 1)) / data.burns.length;
    [0, 0.25, 0.5, 0.75, 1].forEach(function (u) {
      var x = box.x + box.w * u;
      svg.appendChild(el('line', { x1: x, y1: box.y, x2: x, y2: box.y + box.h, 'class': 'gridline' }));
      svg.appendChild(el('text', { x: x, y: box.y + box.h + 16, 'class': 'axis-tick',
        'text-anchor': 'middle' }, compact(max * u, 1)));
    });
    svg.appendChild(el('line', { x1: box.x, y1: box.y + box.h, x2: box.x + box.w,
      y2: box.y + box.h, 'class': 'baseline' }));
    svg.appendChild(el('text', { x: box.x + box.w / 2, y: height - 4, 'class': 'axis-title',
      'text-anchor': 'middle' }, 'Delta v (m/s)'));

    data.burns.forEach(function (b, i) {
      var y = box.y + i * (barH + gap);
      var w = box.w * b.dv / max;
      var c = seriesColor(i % 4);
      svg.appendChild(el('rect', { x: box.x, y: y, width: w, height: barH, rx: 4,
        fill: c }));
      svg.appendChild(el('text', { x: box.x - 9, y: y + barH / 2 + 4, 'class': 'axis-tick',
        'text-anchor': 'end' }, b.name));
      svg.appendChild(el('text', { x: box.x + w + 7, y: y + barH / 2 + 4, 'class': 'direct-label' },
        num(b.dv, 0)));
      var hit = el('rect', { x: box.x, y: y - 5, width: box.w, height: barH + 10,
        'class': 'mark-hit' });
      hit.addEventListener('mousemove', function (ev) {
        var r = svg.getBoundingClientRect();
        showTooltip('transfer-tooltip', ev.clientX - r.left, ev.clientY - r.top, b.name, [
          { label: 'delta v', value: num(b.dv, 2) + ' m/s', color: c },
          { label: 'share', value: num(100 * b.dv / data.burnTotal, 1) + ' %' },
          { label: 'cumulative', value: num(data.burns.slice(0, i + 1)
            .reduce(function (s, x) { return s + x.dv; }, 0), 2) + ' m/s' }
        ]);
      });
      hit.addEventListener('mouseleave', function () { hideTooltip('transfer-tooltip'); });
      svg.appendChild(hit);
    });

    var rows = [], running = 0;
    data.burns.forEach(function (b) {
      running += b.dv;
      rows.push([b.name, num(b.dv, 3), num(100 * b.dv / data.burnTotal, 2), num(running, 3)]);
    });
    rows.push(['Total', num(data.burnTotal, 3), '100.00', num(data.burnTotal, 3)]);
    renderTable('transfer-table', ['Burn', 'Delta v (m/s)', 'Share (%)', 'Cumulative (m/s)'], rows);
  }

  function renderStaging() {
    var svg = $('staging-svg');
    clear(svg);
    svg.appendChild(el('desc', { id: 'staging-desc' },
      'Stage by stage delta v bars with a cumulative total line.'));
    var width = 420, height = 270;
    var box = { x: 52, y: 26, w: 330, h: 186 };
    var stages = data.staging.stages;
    var max = data.staging.totalDv * 1.12;
    [0, 0.25, 0.5, 0.75, 1].forEach(function (u) {
      var y = box.y + box.h * (1 - u);
      svg.appendChild(el('line', { x1: box.x, y1: y, x2: box.x + box.w, y2: y, 'class': 'gridline' }));
      svg.appendChild(el('text', { x: box.x - 8, y: y + 3, 'class': 'axis-tick',
        'text-anchor': 'end' }, compact(max * u, 1)));
    });
    svg.appendChild(el('line', { x1: box.x, y1: box.y + box.h, x2: box.x + box.w,
      y2: box.y + box.h, 'class': 'baseline' }));
    svg.appendChild(el('text', { x: 12, y: box.y + box.h / 2, 'class': 'axis-title',
      'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (box.y + box.h / 2) + ')' }, 'Delta v (m/s)'));

    var slot = box.w / stages.length;
    var barW = slot * 0.54;
    var linePts = [];
    stages.forEach(function (s, i) {
      var x = box.x + i * slot + (slot - barW) / 2;
      var h = box.h * s.dv / max;
      var y = box.y + box.h - h;
      var c = seriesColor(i % 4);
      svg.appendChild(el('rect', { x: x, y: y, width: barW, height: h, rx: 4, fill: c }));
      svg.appendChild(el('text', { x: x + barW / 2, y: y - 6, 'class': 'direct-label',
        'text-anchor': 'middle' }, compact(s.dv, 1)));
      svg.appendChild(el('text', { x: x + barW / 2, y: box.y + box.h + 16,
        'class': 'axis-tick', 'text-anchor': 'middle' }, 'S' + (i + 1)));
      linePts.push([x + barW / 2, box.y + box.h * (1 - s.cumulativeDv / max)]);
      var hit = el('rect', { x: box.x + i * slot, y: box.y, width: slot, height: box.h,
        'class': 'mark-hit' });
      hit.addEventListener('mousemove', function (ev) {
        var r = svg.getBoundingClientRect();
        showTooltip('staging-tooltip', ev.clientX - r.left, ev.clientY - r.top, s.name, [
          { label: 'delta v', value: num(s.dv, 1) + ' m/s', color: c },
          { label: 'Isp', value: num(s.ispSec, 0) + ' s' },
          { label: 'mass ratio', value: num(s.massRatio, 3) },
          { label: 'cumulative', value: num(s.cumulativeDv, 1) + ' m/s' }
        ]);
      });
      hit.addEventListener('mouseleave', function () { hideTooltip('staging-tooltip'); });
      svg.appendChild(hit);
    });
    var d = linePts.map(function (q, i) {
      return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
    }).join(' ');
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: seriesColor(1),
      'stroke-width': 2, 'stroke-linecap': 'round' }));
    linePts.forEach(function (q) {
      svg.appendChild(el('circle', { cx: q[0], cy: q[1], r: 4.5, fill: cssVar('--surface-1'),
        stroke: seriesColor(1), 'stroke-width': 2 }));
    });

    renderLegend('staging-legend', [
      { label: 'Stage dv', color: seriesColor(0), rect: true },
      { label: 'Cumulative', color: seriesColor(1) }
    ]);
    var rows = stages.map(function (s) {
      return [s.name, compact(s.initialMassKg, 2), num(s.massRatio, 3),
        num(s.ispSec, 0), num(s.dv, 2), num(s.cumulativeDv, 2)];
    });
    rows.push(['Vehicle total', compact(data.staging.initialMassKg, 2),
      num(data.staging.totalMassRatio, 3), '', num(data.staging.totalDv, 2),
      num(data.staging.totalDv, 2)]);
    renderTable('staging-table', ['Stage', 'Initial mass (kg)', 'Mass ratio', 'Isp (s)',
      'Stage dv (m/s)', 'Cumulative (m/s)'], rows);
  }

  function cellAt(g, di, fi) {
    return g.cells[di * g.rows + fi];
  }
  function inspectorText(cell) {
    var box = $('porkchop-inspector');
    clear(box);
    if (!cell) return;
    var fields = [
      ['Departure', num(cell.departureDay, 2) + ' d'],
      ['Flight time', num(cell.timeOfFlightDay, 2) + ' d'],
      ['C3', sci(cell.c3, 3) + ' m2/s2'],
      ['Departure dv', num(cell.dvDeparture, 1) + ' m/s'],
      ['Arrival dv', num(cell.dvArrival, 1) + ' m/s'],
      ['Total dv', num(cell.totalDv, 1) + ' m/s']
    ];
    fields.forEach(function (f) {
      var wrap = html('span');
      wrap.appendChild(doc.createTextNode(f[0] + ': '));
      wrap.appendChild(html('strong', null, f[1]));
      box.appendChild(wrap);
    });
  }

  function renderPorkchop() {
    var g = data.porkchop;
    var svg = $('porkchop-svg');
    clear(svg);
    svg.appendChild(el('desc', { id: 'porkchop-desc' },
      'Heatmap of total delta v across departure days and flight days. The crosshair inspector reads a single cell. The matching data table follows the chart.'));
    var width = 760, height = 420;
    var box = { x: 74, y: 20, w: 630, h: 336 };
    var cw = box.w / g.cols, ch = box.h / g.rows;
    var lo = g.minimumTotalDv, hi = g.maximumTotalDv;
    var span = Math.max(1, hi - lo);
    var minD = g.departureDays[0], maxD = g.departureDays[g.departureDays.length - 1];
    var minF = g.flightDays[0], maxF = g.flightDays[g.flightDays.length - 1];
    var finite = g.cells.filter(function (c) { return isFinite(c.totalDv) && c.totalDv < 1e11; });
    finite = finite.length ? finite : g.cells;

    var heat = el('g');
    g.cells.forEach(function (cell) {
      var t = isFinite(cell.totalDv) ? clamp((cell.totalDv - lo) / span, 0, 1) : 1;
      heat.appendChild(el('rect', {
        x: box.x + cell.departureIndex * cw + 1,
        y: box.y + (g.rows - 1 - cell.flightIndex) * ch + 1,
        width: Math.max(1, cw - 2), height: Math.max(1, ch - 2),
        rx: 1, fill: rampColor(t)
      }));
    });
    svg.appendChild(heat);

    /* Thin minimum energy contour. */
    var contour = [], ci;
    for (ci = 0; ci < g.cols; ci++) {
      var best = 0, bestV = Infinity;
      for (var fi = 0; fi < g.rows; fi++) {
        var c = cellAt(g, ci, fi);
        if (c.totalDv < bestV) { bestV = c.totalDv; best = fi; }
      }
      contour.push([box.x + (ci + 0.5) * cw, box.y + (g.rows - 1 - best + 0.5) * ch]);
    }
    if (contour.length > 1) {
      svg.appendChild(el('path', {
        d: contour.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' '),
        fill: 'none', stroke: cssVar('--label-on-fill'), 'stroke-width': 1.2,
        'stroke-opacity': 0.55
      }));
    }

    /* Axes. */
    var xt = [], yt = [], k;
    for (k = 0; k <= 4; k++) {
      xt.push({ u: k / 4, label: num(lerp(minD, maxD, k / 4), 1) });
      yt.push({ u: k / 4, label: num(lerp(minF, maxF, k / 4), 1) });
    }
    drawAxes(svg, width, height, box, 'Departure epoch (days from window open)',
      'Time of flight (days)', xt, yt);
    svg.appendChild(el('rect', { x: box.x, y: box.y, width: box.w, height: box.h,
      fill: 'none', stroke: 'var(--grid-strong)', 'stroke-width': 1 }));

    /* Crosshair and optimal marker. */
    var vline = el('line', { y1: box.y, y2: box.y + box.h, stroke: cssVar('--label-on-fill'),
      'stroke-width': 1, 'stroke-opacity': 0.85, 'pointer-events': 'none' });
    var hline = el('line', { x1: box.x, x2: box.x + box.w, stroke: cssVar('--label-on-fill'),
      'stroke-width': 1, 'stroke-opacity': 0.85, 'pointer-events': 'none' });
    svg.appendChild(vline); svg.appendChild(hline);
    if (g.optimal) {
      var ox = box.x + (g.optimal.departureIndex + 0.5) * cw;
      var oy = box.y + (g.rows - 1 - g.optimal.flightIndex + 0.5) * ch;
      svg.appendChild(el('circle', { cx: ox, cy: oy, r: 6, fill: 'none',
        stroke: seriesColor(1), 'stroke-width': 2 }));
      svg.appendChild(el('text', { x: clamp(ox + 10, box.x, box.x + box.w - 90),
        y: clamp(oy - 9, box.y + 12, box.y + box.h - 4), 'class': 'direct-label' }, 'minimum dv'));
    }

    function setCrosshair(di, fi) {
      state.cell.departureIndex = clamp(di, 0, g.cols - 1);
      state.cell.flightIndex = clamp(fi, 0, g.rows - 1);
      vline.setAttribute('x1', box.x + (state.cell.departureIndex + 0.5) * cw);
      vline.setAttribute('x2', vline.getAttribute('x1'));
      hline.setAttribute('y1', box.y + (g.rows - 1 - state.cell.flightIndex + 0.5) * ch);
      hline.setAttribute('y2', hline.getAttribute('y1'));
      inspectorText(cellAt(g, state.cell.departureIndex, state.cell.flightIndex));
    }

    var hit = el('rect', { x: box.x, y: box.y, width: box.w, height: box.h,
      'class': 'mark-hit', tabindex: 0, role: 'application',
      'aria-label': 'Porkchop grid inspector, use arrow keys to move the crosshair' });
    svg.appendChild(hit);
    hit.addEventListener('mousemove', function (ev) {
      var r = svg.getBoundingClientRect();
      var mx = (ev.clientX - r.left) / r.width * width;
      var my = (ev.clientY - r.top) / r.height * height;
      var di = clamp(Math.floor((mx - box.x) / cw), 0, g.cols - 1);
      var fi = clamp(g.rows - 1 - Math.floor((my - box.y) / ch), 0, g.rows - 1);
      setCrosshair(di, fi);
      var c = cellAt(g, di, fi);
      showTooltip('porkchop-tooltip', ev.clientX - r.left, ev.clientY - r.top,
        'Day ' + num(c.departureDay, 1) + ' / ' + num(c.timeOfFlightDay, 1) + ' d', [
          { label: 'total dv', value: num(c.totalDv, 1) + ' m/s' },
          { label: 'C3', value: sci(c.c3, 2) + ' m2/s2' },
          { label: 'departure', value: num(c.dvDeparture, 1) + ' m/s' },
          { label: 'arrival', value: num(c.dvArrival, 1) + ' m/s' }
        ]);
    });
    hit.addEventListener('mouseleave', function () { hideTooltip('porkchop-tooltip'); });
    hit.addEventListener('keydown', function (ev) {
      var map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      var d = map[ev.key];
      if (!d) return;
      ev.preventDefault();
      setCrosshair(state.cell.departureIndex + d[0], state.cell.flightIndex + d[1]);
    });

    setCrosshair(state.cell.departureIndex, state.cell.flightIndex);
    renderScaleLegend('porkchop-legend');
    $('porkchop-sub').textContent = g.label + ' / ' + g.method + ' / optimum ' +
      num(g.optimal.departureDay, 1) + ' d departure and ' +
      num(g.optimal.timeOfFlightDay, 1) + ' d flight';

    var rows = g.cells.map(function (c) {
      return [num(c.departureDay, 2), num(c.timeOfFlightDay, 2), sci(c.c3, 3),
        num(c.dvDeparture, 1), num(c.dvArrival, 1), num(c.totalDv, 1)];
    });
    var optimalRow = g.optimal ? g.optimal.departureIndex * g.rows + g.optimal.flightIndex : -1;
    renderTable('porkchop-table', ['Departure (d)', 'Flight (d)', 'C3 (m2/s2)',
      'Departure dv (m/s)', 'Arrival dv (m/s)', 'Total dv (m/s)'], rows, optimalRow);
  }

  function renderEnergy() {
    var svg = $('energy-svg');
    clear(svg);
    svg.appendChild(el('desc', { id: 'energy-desc' },
      'Line chart of relative specific energy drift over time with a marker at the maximum drift. The matching data table follows the chart.'));
    var width = 760, height = 300;
    var box = { x: 76, y: 22, w: 640, h: 218 };
    var pts = data.trajectory;
    var maxAbs = 0;
    pts.forEach(function (p) { maxAbs = Math.max(maxAbs, Math.abs(p.energyDrift)); });
    maxAbs = Math.max(maxAbs, 1e-12) * 1.15;
    var tMax = pts[pts.length - 1].tSec / 3600 || 1;
    var map = function (p) {
      return [box.x + box.w * (p.tSec / 3600) / tMax,
        box.y + box.h * (0.5 - p.energyDrift / (2 * maxAbs))];
    };
    [0, 0.25, 0.5, 0.75, 1].forEach(function (u) {
      var x = box.x + box.w * u;
      svg.appendChild(el('line', { x1: x, y1: box.y, x2: x, y2: box.y + box.h, 'class': 'gridline' }));
      svg.appendChild(el('text', { x: x, y: box.y + box.h + 16, 'class': 'axis-tick',
        'text-anchor': 'middle' }, num(tMax * u, 2)));
    });
    [-1, -0.5, 0, 0.5, 1].forEach(function (u) {
      var y = box.y + box.h * (0.5 - u * 0.5);
      svg.appendChild(el('line', { x1: box.x, y1: y, x2: box.x + box.w, y2: y,
        'class': u === 0 ? 'baseline' : 'gridline' }));
      svg.appendChild(el('text', { x: box.x - 8, y: y + 3, 'class': 'axis-tick',
        'text-anchor': 'end' }, sci(u * maxAbs, 1)));
    });
    svg.appendChild(el('text', { x: box.x + box.w / 2, y: height - 4, 'class': 'axis-title',
      'text-anchor': 'middle' }, 'Elapsed time (hours)'));
    svg.appendChild(el('text', { x: 14, y: box.y + box.h / 2, 'class': 'axis-title',
      'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (box.y + box.h / 2) + ')' },
      'Relative energy drift'));

    var d = [];
    pts.forEach(function (p, i) {
      var q = map(p);
      d.push((i ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2));
    });
    svg.appendChild(el('path', { d: d.join(' '), fill: 'none', stroke: seriesColor(0),
      'stroke-width': 2, 'stroke-linejoin': 'round' }));
    var worst = pts.reduce(function (a, b) {
      return Math.abs(b.energyDrift) > Math.abs(a.energyDrift) ? b : a;
    }, pts[0]);
    var wq = map(worst);
    svg.appendChild(el('circle', { cx: wq[0], cy: wq[1], r: 5, fill: cssVar('--surface-1'),
      stroke: seriesColor(1), 'stroke-width': 2 }));
    svg.appendChild(el('text', { x: clamp(wq[0] + 9, box.x, box.x + box.w - 130),
      y: clamp(wq[1] - 9, box.y + 12, box.y + box.h - 4), 'class': 'direct-label' },
      'max drift ' + sci(Math.abs(worst.energyDrift), 2)));
    svg.appendChild(el('text', { x: box.x + 10, y: box.y + 14, 'class': 'axis-tick' },
      'specific energy line'));

    var cross = el('line', { y1: box.y, y2: box.y + box.h, stroke: seriesColor(3),
      'stroke-width': 1, opacity: 0, 'pointer-events': 'none' });
    svg.appendChild(cross);
    var dot = el('circle', { r: 5, fill: cssVar('--surface-1'), stroke: seriesColor(0),
      'stroke-width': 2, opacity: 0, 'pointer-events': 'none' });
    svg.appendChild(dot);
    var hit = el('rect', { x: box.x, y: box.y, width: box.w, height: box.h,
      'class': 'mark-hit' });
    svg.appendChild(hit);
    hit.addEventListener('mousemove', function (ev) {
      var r = svg.getBoundingClientRect();
      var mx = (ev.clientX - r.left) / r.width * width;
      var idx = clamp(Math.round((mx - box.x) / box.w * (pts.length - 1)), 0, pts.length - 1);
      var p = pts[idx], q = map(p);
      cross.setAttribute('x1', q[0]); cross.setAttribute('x2', q[0]); cross.setAttribute('opacity', 1);
      dot.setAttribute('cx', q[0]); dot.setAttribute('cy', q[1]); dot.setAttribute('opacity', 1);
      showTooltip('energy-tooltip', ev.clientX - r.left, ev.clientY - r.top,
        't = ' + num(p.tSec / 3600, 3) + ' h', [
          { label: 'energy drift', value: sci(p.energyDrift, 3), color: seriesColor(0) },
          { label: 'energy', value: sci(p.energy, 4) + ' J/kg' },
          { label: 'radius', value: compact(p.radius, 2) + ' m' },
          { label: 'speed', value: num(p.speed, 1) + ' m/s' }
        ]);
    });
    hit.addEventListener('mouseleave', function () {
      cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0);
      hideTooltip('energy-tooltip');
    });

    var prop = data.propagation;
    var metrics = [
      ['Steps', num(prop.steps, 0)],
      ['Step size', num(prop.stepSizeSec, 1) + ' s'],
      ['Max |dE/E|', sci(prop.maxEnergyDrift, 3)],
      ['Final dE/E', sci(prop.energyDrift, 3)],
      ['J2', state.j2 ? 'on' : 'off'],
      ['RAAN drift', num(prop.raanDriftDegPerDay, 5) + ' deg/day'],
      ['ArgPe drift', num(prop.argPeDriftDegPerDay, 5) + ' deg/day']
    ];
    var strip = $('propagation-metrics');
    clear(strip);
    metrics.forEach(function (m) {
      var wrap = html('span');
      wrap.appendChild(doc.createTextNode(m[0] + ': '));
      wrap.appendChild(html('strong', null, m[1]));
      strip.appendChild(wrap);
    });
    $('energy-sub').textContent = 'RK4 over one orbit: ' + num(prop.dtSec / 3600, 2) +
      ' h with ' + (state.j2 ? 'J2 zonal acceleration' : 'central gravity only');
    renderLegend('energy-legend', [
      { label: 'Relative energy drift', color: seriesColor(0) },
      { label: 'Maximum drift', color: seriesColor(1), rect: true }
    ]);

    var step = Math.max(1, Math.floor(pts.length / 20));
    var rows = [];
    for (var i = 0; i < pts.length; i += step) {
      var p = pts[i];
      rows.push([num(p.tSec, 1), num(p.tSec / 3600, 3), compact(p.radius, 3),
        num(p.speed, 2), sci(p.energy, 4), sci(p.energyDrift, 3)]);
    }
    renderTable('energy-table', ['t (s)', 't (h)', 'r (m)', 'v (m/s)',
      'Energy (J/kg)', 'dE/E'], rows);
  }

  function renderAll() {
    updateHero();
    updateReference();
    renderTrajectory();
    renderTransfer();
    renderStaging();
    renderPorkchop();
    renderEnergy();
  }

  function stopAnimation() {
    state.playing = false;
    if (state.timer !== null) { clearInterval(state.timer); state.timer = null; }
    var btn = $('play-button');
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = 'Play animation';
  }

  function setTheme(theme) {
    var dark = theme === 'dark';
    doc.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var btn = $('theme-toggle');
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    var icon = btn.querySelector('.theme-icon');
    var label = btn.querySelector('.theme-label');
    if (icon) icon.textContent = dark ? '☽' : '☀';
    if (label) label.textContent = dark ? 'Dark' : 'Light';
    try { window.localStorage.setItem('orbitlab-theme', dark ? 'dark' : 'light'); } catch (e) { /* storage unavailable */ }
    renderAll();
  }

  function initTheme() {
    var saved = null;
    try { saved = window.localStorage.getItem('orbitlab-theme'); } catch (e) { /* storage unavailable */ }
    setTheme(saved === 'light' ? 'light' : 'dark');
  }

  function bindEvents() {
    var presetSelect = $('preset-select');
    clear(presetSelect);
    O.PRESETS.forEach(function (p) {
      var option = doc.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      presetSelect.appendChild(option);
    });
    presetSelect.value = state.presetId;
    $('view-select').value = state.view;
    $('window-select').value = state.windowPreset;

    presetSelect.addEventListener('change', function () {
      state.presetId = this.value;
      state.scrub = 0;
      $('scrub-range').value = '0';
      $('scrub-output').textContent = '0%';
      buildMission();
      renderAll();
    });
    $('view-select').addEventListener('change', function () {
      state.view = this.value;
      renderTrajectory();
    });
    $('window-select').addEventListener('change', function () {
      state.windowPreset = this.value;
      data.porkchop = O.computePorkchopGrid({
        preset: state.windowPreset, departureSteps: 22, flightSteps: 18
      });
      if (data.porkchop.optimal) {
        state.cell.departureIndex = data.porkchop.optimal.departureIndex;
        state.cell.flightIndex = data.porkchop.optimal.flightIndex;
      }
      renderPorkchop();
      updateReference();
    });
    $('j2-toggle').addEventListener('click', function () {
      state.j2 = !state.j2;
      this.setAttribute('aria-checked', state.j2 ? 'true' : 'false');
      var text = this.querySelector('.switch-text');
      if (text) text.textContent = state.j2 ? 'On' : 'Off';
      var os = data.orbit.state;
      data.propagation = O.propagateRK4(os.r, os.v, data.orbit.periodSec, 240, {
        mu: data.preset.mu,
        j2: state.j2 ? C.J2_EARTH : 0,
        bodyRadius: C.R_EARTH
      });
      data.trajectory = data.propagation.points;
      renderEnergy();
    });
    $('theme-toggle').addEventListener('click', function () {
      setTheme(doc.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    $('scrub-range').addEventListener('input', function () {
      state.scrub = Number(this.value);
      $('scrub-output').textContent = state.scrub + '%';
      renderTrajectory();
    });
    $('play-button').addEventListener('click', function () {
      if (state.playing) { stopAnimation(); return; }
      state.playing = true;
      this.setAttribute('aria-pressed', 'true');
      this.textContent = 'Pause animation';
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      state.timer = setInterval(function () {
        state.scrub = (state.scrub + (reduce ? 2 : 0.7)) % 100;
        $('scrub-range').value = String(Math.round(state.scrub));
        $('scrub-output').textContent = Math.round(state.scrub) + '%';
        renderTrajectory();
      }, reduce ? 120 : 40);
    });

    $('download-gmat').addEventListener('click', function () {
      var mission = {
        name: data.preset.name,
        mu: data.preset.mu,
        elements: data.preset.elements,
        epoch: '2026-11-08T00:00:00.000Z',
        j2: state.j2,
        propagateSec: data.hohmann.timeOfFlightSec,
        burns: data.burns.map(function (b, i) {
          return { id: 'Burn' + (i + 1), dv1: b.dv,
            propagateSec: data.hohmann.timeOfFlightSec / data.burns.length };
        })
      };
      downloadFile('orbitlab-mission.script', O.exportGmatScript(mission), 'text/plain');
    });
    $('download-oem').addEventListener('click', function () {
      downloadFile('orbitlab-ephemeris.oem', O.exportCcsdsOem(data.trajectory, {
        epoch: '2026-11-08T00:00:00.000Z',
        objectName: data.preset.name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 32),
        objectId: '2026-001A',
        mu: data.preset.mu,
        originator: 'ORBITLAB'
      }), 'text/plain');
    });
    $('download-csv').addEventListener('click', function () {
      downloadFile('orbitlab-trajectory.csv', O.exportTrajectoryCsv(data.trajectory), 'text/csv');
    });
  }

  buildMission();
  initTheme();
  bindEvents();
})();
