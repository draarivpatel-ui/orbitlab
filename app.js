/* OrbitLab browser trajectory analysis console. Depends on orbit.js exposing window.OrbitLab. */
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
    preset: null, orbit: null, hohmann: null, biElliptic: null, burns: [],
    staging: null, porkchop: null, propagation: null, trajectory: null
  };

  var SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
  var SEQ_STEPS = ['#0f2942', '#173d63', '#1f5487', '#286bb8', '#4287d6', '#72aeeed9', '#b8dcff'];
  var SEQ_HEX = ['#0f2942', '#173d63', '#1f5487', '#286bb8', '#4287d6', '#75b0f0', '#b8dcff'];

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
  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function cssVar(name) {
    return getComputedStyle(doc.documentElement).getPropertyValue(name).trim() || '#4da3ff';
  }
  function seriesColor(i) { return cssVar('--series-' + (i + 1)) || SERIES[i % 4]; }
  function num(v, digits) {
    if (!isFinite(v)) return 'n/a';
    var d = digits === undefined ? 2 : digits;
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  }
  function sci(v, digits) {
    if (!isFinite(v)) return 'n/a';
    return Number(v).toExponential(digits === undefined ? 2 : digits);
  }
  function compact(v, digits) {
    var d = digits === undefined ? 2 : digits;
    if (!isFinite(v)) return 'n/a';
    if (Math.abs(v) >= 1e9) return num(v / 1e9, d) + ' Gm';
    if (Math.abs(v) >= 1e6) return num(v / 1e6, d) + ' Mm';
    if (Math.abs(v) >= 1e3) return num(v / 1e3, d) + ' km';
    return num(v, d);
  }
  function compactRaw(v, digits) {
    var d = digits === undefined ? 2 : digits;
    if (!isFinite(v)) return 'n/a';
    if (Math.abs(v) >= 1e9) return num(v / 1e9, d) + 'B';
    if (Math.abs(v) >= 1e6) return num(v / 1e6, d) + 'M';
    if (Math.abs(v) >= 1e3) return num(v / 1e3, d) + 'K';
    return num(v, d);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* Sequential ramp for the Porkchop scalar field (dark = minimum dv basin). */
  function rampColor(t) {
    var x = clamp(t, 0, 1) * (SEQ_HEX.length - 1);
    var i = Math.min(SEQ_HEX.length - 2, Math.floor(x));
    var f = x - i;
    var a = hexToRgb(SEQ_HEX[i]), b = hexToRgb(SEQ_HEX[i + 1]);
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
    if (!tip) return;
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
    var width = 180, height = 24 + rows.length * 19;
    tip.style.left = clamp(x + 14, 4, Math.max(4, frame.width - width)) + 'px';
    tip.style.top = clamp(y - height - 8, 4, Math.max(4, frame.height - height)) + 'px';
  }
  function hideTooltip(id) { var tip = $(id); if (tip) tip.hidden = true; }

  function renderLegend(id, items) {
    var box = $(id);
    if (!box) return;
    clear(box);
    (items || []).forEach(function (item) {
      var row = html('span', 'legend-item');
      var cls = 'legend-swatch' + (item.rect ? ' rect' : '') + (item.dashed ? ' dashed' : '');
      var swatch = html('i', cls);
      if (item.dashed) swatch.style.color = item.color;
      else swatch.style.background = item.color;
      row.appendChild(swatch);
      row.appendChild(doc.createTextNode(item.label));
      box.appendChild(row);
    });
  }

  function renderPorkchopLegend(id, minDvKmS, maxDvKmS) {
    var box = $(id);
    if (!box) return;
    clear(box);
    var dvItem = html('span', 'legend-item');
    var dvLine = html('i', 'legend-swatch');
    dvLine.style.background = cssVar('--label-on-fill');
    dvItem.appendChild(dvLine);
    dvItem.appendChild(doc.createTextNode('Total dv isoline (km/s)'));
    box.appendChild(dvItem);

    var c3Item = html('span', 'legend-item');
    var c3Line = html('i', 'legend-swatch dashed');
    c3Line.style.color = seriesColor(3);
    c3Item.appendChild(c3Line);
    c3Item.appendChild(doc.createTextNode('C3 isoline (km2/s2)'));
    box.appendChild(c3Item);

    box.appendChild(html('span', null, num(minDvKmS, 2) + ' km/s'));
    var ramp = html('span', 'legend-ramp');
    SEQ_HEX.forEach(function (step) {
      var swatch = html('i');
      swatch.style.background = step;
      ramp.appendChild(swatch);
    });
    box.appendChild(ramp);
    box.appendChild(html('span', null, num(maxDvKmS, 1) + ' km/s'));
  }

  function renderTable(tableId, headers, rows, optimalIndex) {
    var table = $(tableId);
    if (!table) return;
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
    { name: 'Stage 1 Booster Core', ispSec: 282, dryMassKg: 23000, propellantMassKg: 410000 },
    { name: 'Stage 2 Upper', ispSec: 348, dryMassKg: 4200, propellantMassKg: 108000 },
    { name: 'Stage 3 Kick', ispSec: 452, dryMassKg: 950, propellantMassKg: 16500 }
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
        { name: 'Burn 1: Departure raise (r1)', dv: preset.biElliptic.dv1 },
        { name: 'Burn 2: Mid-apsis match (rb)', dv: preset.biElliptic.dv2 },
        { name: 'Burn 3: Circularize (r2)', dv: preset.biElliptic.dv3 }
      ];
    } else {
      data.burns = [
        { name: 'Burn 1: Perigee injection', dv: data.hohmann.dv1 },
        { name: 'Burn 2: Apogee circularize', dv: data.hohmann.dv2 }
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
      preset: state.windowPreset, departureSteps: 30, flightSteps: 26
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

    var modeEl = $('telemetry-transfer-mode');
    if (modeEl) {
      if (data.biElliptic) {
        modeEl.textContent = '3-burn Bi-Elliptic (saves ' + num(data.biElliptic.savingsDv, 2) + ' m/s vs Hohmann)';
      } else {
        modeEl.textContent = '2-burn Hohmann (TOF ' + num(data.hohmann.timeOfFlightSec / 3600, 2) + ' h)';
      }
    }
    var apsidesEl = $('telemetry-apsides');
    if (apsidesEl) {
      var st = data.orbit.state;
      apsidesEl.textContent = 'rp ' + compact(st.periapsisRadius, 2) + ' / ra ' +
        (st.apoapsisRadius ? compact(st.apoapsisRadius, 2) : 'open');
    }
    var winOpt = $('telemetry-window-opt');
    var winSub = $('telemetry-window-sub');
    if (winOpt && data.porkchop && data.porkchop.optimal) {
      winOpt.textContent = num(data.porkchop.optimal.c3 / 1e6, 2) + ' km2/s2';
    }
    if (winSub && data.porkchop && data.porkchop.optimal) {
      winSub.textContent = 'Min dv ' + num(data.porkchop.minimumTotalDv / 1000, 3) +
        ' km/s at day ' + num(data.porkchop.optimal.departureDay, 1);
    }
  }

  function updateReference() {
    var box = $('reference-grid');
    if (!box) return;
    clear(box);
    var s = data.orbit.state;
    var rows = [
      ['mu', 'Gravitational parameter', sci(data.preset.mu, 4) + ' m3/s2'],
      ['a', 'Semi-major axis', compact(s.semiMajorAxis, 3)],
      ['e', 'Eccentricity', num(s.eccentricity, 5)],
      ['i', 'Inclination', num(data.preset.elements.i * O.DEG, 3) + ' deg'],
      ['h', 'Specific angular momentum', sci(s.hMagnitude, 4) + ' m2/s'],
      ['epsilon', 'Specific mechanical energy', sci(s.specificEnergy, 4) + ' J/kg'],
      ['rp', 'Periapsis radius', compact(s.periapsisRadius, 3)],
      ['ra', 'Apoapsis radius', s.apoapsisRadius ? compact(s.apoapsisRadius, 3) : 'unbounded'],
      ['T', 'Keplerian orbital period', data.orbit.periodSec ? num(data.orbit.periodSec / 3600, 3) + ' h' : 'none'],
      ['vp', 'Periapsis speed (vis-viva)', num(s.periapsisSpeed, 2) + ' m/s'],
      ['va', 'Apoapsis speed (vis-viva)', s.apoapsisSpeed ? num(s.apoapsisSpeed, 2) + ' m/s' : 'none'],
      ['C3_min', 'Window minimum C3', num(data.porkchop.minimumC3 / 1e6, 3) + ' km2/s2']
    ];
    rows.forEach(function (r) {
      var item = html('div', 'reference-item');
      item.appendChild(html('strong', null, r[0] + ' = ' + r[2]));
      item.appendChild(html('span', null, r[1]));
      box.appendChild(item);
    });
  }

  /* Project an inertial 3D vector into the chart plane (PQW perifocal or 3D isometric IJK). */
  function project(p, view, scale, cx, cy) {
    if (view === 'plane') {
      var m = V.pqwToIjkMatrix(data.preset.elements.raan || 0,
        data.preset.elements.i || 0, data.preset.elements.argPe || 0);
      var xAxis = [m[0][0], m[1][0], m[2][0]];
      var yAxis = [m[0][1], m[1][1], m[2][1]];
      return [cx + V.dot(p, xAxis) * scale, cy - V.dot(p, yAxis) * scale];
    }
    var isoX = 0.866 * p[0] - 0.866 * p[1];
    var isoY = -0.45 * p[0] - 0.45 * p[1] + 0.88 * p[2];
    return [cx + isoX * scale, cy - isoY * scale];
  }

  function drawAxes(svg, width, height, box, xTitle, yTitle, ticksX, ticksY) {
    var g = el('g');
    ticksX.forEach(function (t) {
      var x = box.x + box.w * t.u;
      g.appendChild(el('line', {
        x1: x, y1: box.y, x2: x, y2: box.y + box.h,
        'class': t.label === null ? 'gridline-minor' : 'gridline'
      }));
      if (t.label !== null) {
        g.appendChild(el('text', {
          x: x, y: box.y + box.h + 15, 'class': 'axis-tick', 'text-anchor': 'middle'
        }, t.label));
      }
    });
    ticksY.forEach(function (t) {
      var y = box.y + box.h * (1 - t.u);
      g.appendChild(el('line', {
        x1: box.x, y1: y, x2: box.x + box.w, y2: y,
        'class': t.label === null ? 'gridline-minor' : 'gridline'
      }));
      if (t.label !== null) {
        g.appendChild(el('text', {
          x: box.x - 7, y: y + 3, 'class': 'axis-tick', 'text-anchor': 'end'
        }, t.label));
      }
    });
    g.appendChild(el('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h,
      fill: 'none', stroke: 'var(--border-strong)', 'stroke-width': 1
    }));
    g.appendChild(el('text', {
      x: box.x + box.w / 2, y: height - 4, 'class': 'axis-title', 'text-anchor': 'middle'
    }, xTitle));
    g.appendChild(el('text', {
      x: 13, y: box.y + box.h / 2, 'class': 'axis-title', 'text-anchor': 'middle',
      transform: 'rotate(-90 13 ' + (box.y + box.h / 2) + ')'
    }, yTitle));
    svg.appendChild(g);
  }

  function sampleHalfEllipsePqw(rp, ra, flip, m, scale, cx, cy, view) {
    var a = (rp + ra) / 2;
    var e = (ra - rp) / (ra + rp);
    var p = a * (1 - e * e);
    var d = [];
    for (var k = 0; k <= 72; k++) {
      var nu = Math.PI * k / 72;
      var r = p / (1 + e * Math.cos(nu));
      var xPqw = (flip ? -1 : 1) * r * Math.cos(nu);
      var yPqw = (flip ? -1 : 1) * r * Math.sin(nu);
      var rIjk = V.matVec(m, [xPqw, yPqw, 0]);
      var q = project(rIjk, view, scale, cx, cy);
      d.push((k ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2));
    }
    return d.join(' ');
  }

  function sampleCirclePqw(radius, m, scale, cx, cy, view) {
    var d = [];
    for (var k = 0; k <= 90; k++) {
      var nu = O.TAU * k / 90;
      var rIjk = V.matVec(m, [radius * Math.cos(nu), radius * Math.sin(nu), 0]);
      var q = project(rIjk, view, scale, cx, cy);
      d.push((k ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2));
    }
    return d.join(' ');
  }

  function renderTrajectory() {
    var svg = $('trajectory-svg');
    clear(svg);
    svg.appendChild(el('desc', { id: 'trajectory-desc' },
      'Technical orbital plot showing central body, parking orbit, transfer arcs, apsis markers, velocity vector, and scrubbed spacecraft state.'));
    var width = 760, height = 420;
    var box = { x: 68, y: 18, w: 668, h: 354 };
    var pts = data.orbit.points;
    var maxR = 0;
    pts.forEach(function (p) { maxR = Math.max(maxR, V.norm(p.r)); });
    var hasTransferArc = Boolean(data.preset.r2 && data.preset.r2 > maxR * 1.05);
    var plotMaxR = maxR;
    if (data.preset.rb) plotMaxR = Math.max(plotMaxR, data.preset.rb);
    else if (hasTransferArc) plotMaxR = Math.max(plotMaxR, data.preset.r2);

    var scale = Math.min(box.w * 0.44, box.h * 0.44) / plotMaxR;
    var cx = box.x + box.w / 2, cy = box.y + box.h / 2;

    drawAxes(svg, width, height, box,
      state.view === 'plane' ? 'Perifocal P axis (position)' : 'Inertial I / J projection',
      state.view === 'plane' ? 'Perifocal Q axis (position)' : 'Inertial K projection',
      [
        { u: 0, label: '-' + compact(plotMaxR, 1) },
        { u: 0.125, label: null },
        { u: 0.25, label: '-' + compact(plotMaxR * 0.5, 1) },
        { u: 0.375, label: null },
        { u: 0.5, label: '0' },
        { u: 0.625, label: null },
        { u: 0.75, label: '+' + compact(plotMaxR * 0.5, 1) },
        { u: 0.875, label: null },
        { u: 1, label: '+' + compact(plotMaxR, 1) }
      ],
      [
        { u: 0, label: '-' + compact(plotMaxR, 1) },
        { u: 0.125, label: null },
        { u: 0.25, label: '-' + compact(plotMaxR * 0.5, 1) },
        { u: 0.375, label: null },
        { u: 0.5, label: '0' },
        { u: 0.625, label: null },
        { u: 0.75, label: '+' + compact(plotMaxR * 0.5, 1) },
        { u: 0.875, label: null },
        { u: 1, label: '+' + compact(plotMaxR, 1) }
      ]);

    /* Origin crosshair & reference frame triad. */
    svg.appendChild(el('line', {
      x1: box.x, y1: cy, x2: box.x + box.w, y2: cy,
      stroke: 'var(--baseline)', 'stroke-width': 0.8, 'stroke-dasharray': '4 4'
    }));
    svg.appendChild(el('line', {
      x1: cx, y1: box.y, x2: cx, y2: box.y + box.h,
      stroke: 'var(--baseline)', 'stroke-width': 0.8, 'stroke-dasharray': '4 4'
    }));

    var mPqw = V.pqwToIjkMatrix(data.preset.elements.raan || 0,
      data.preset.elements.i || 0, data.preset.elements.argPe || 0);

    /* If preset includes a transfer target r2 or bi-elliptic rb, plot target ring & transfer ellipse(s). */
    if (data.preset.biElliptic) {
      var r1b = data.preset.r1, r2b = data.preset.r2, rbb = data.preset.rb;
      svg.appendChild(el('path', {
        d: sampleCirclePqw(r2b, mPqw, scale, cx, cy, state.view),
        fill: 'none', stroke: 'var(--text-muted)', 'stroke-width': 1.1, 'stroke-dasharray': '4 3'
      }));
      svg.appendChild(el('path', {
        d: sampleHalfEllipsePqw(r1b, rbb, false, mPqw, scale, cx, cy, state.view),
        fill: 'none', stroke: seriesColor(1), 'stroke-width': 1.6, 'stroke-dasharray': '5 3'
      }));
      svg.appendChild(el('path', {
        d: sampleHalfEllipsePqw(r2b, rbb, true, mPqw, scale, cx, cy, state.view),
        fill: 'none', stroke: seriesColor(3), 'stroke-width': 1.6, 'stroke-dasharray': '3 3'
      }));
      var qRb = project(V.matVec(mPqw, [-rbb, 0, 0]), state.view, scale, cx, cy);
      svg.appendChild(el('circle', {
        cx: qRb[0], cy: qRb[1], r: 4.5, fill: seriesColor(3), stroke: 'var(--surface-1)', 'stroke-width': 1.5
      }));
      svg.appendChild(el('text', {
        x: qRb[0] + 8, y: qRb[1] - 6, 'class': 'direct-label'
      }, 'rb burn 2 (' + num(data.biElliptic.dv2, 0) + ' m/s)'));
    } else if (hasTransferArc) {
      var r1h = data.preset.r1 || data.orbit.state.periapsisRadius;
      var r2h = data.preset.r2;
      svg.appendChild(el('path', {
        d: sampleCirclePqw(r2h, mPqw, scale, cx, cy, state.view),
        fill: 'none', stroke: 'var(--text-muted)', 'stroke-width': 1.1, 'stroke-dasharray': '4 3'
      }));
      svg.appendChild(el('path', {
        d: sampleHalfEllipsePqw(r1h, r2h, false, mPqw, scale, cx, cy, state.view),
        fill: 'none', stroke: seriesColor(1), 'stroke-width': 1.7, 'stroke-dasharray': '5 3'
      }));
      var qArr = project(V.matVec(mPqw, [-r2h, 0, 0]), state.view, scale, cx, cy);
      svg.appendChild(el('circle', {
        cx: qArr[0], cy: qArr[1], r: 4.5, fill: seriesColor(1), stroke: 'var(--surface-1)', 'stroke-width': 1.5
      }));
      svg.appendChild(el('text', {
        x: qArr[0] + 8, y: qArr[1] + 4, 'class': 'direct-label'
      }, 'r2 arrival (' + compact(r2h, 1) + ')'));
    }

    /* Central gravitational body. */
    var isSun = data.preset.mu === C.MU_SUN;
    var physBodyR = isSun ? 0 : C.R_EARTH * scale;
    var bodyR = clamp(physBodyR || 10, 7, 36);
    svg.appendChild(el('circle', {
      cx: cx, cy: cy, r: bodyR,
      fill: isSun ? 'rgba(229, 169, 60, 0.25)' : 'var(--planet)',
      stroke: isSun ? seriesColor(3) : 'var(--planet-rim)',
      'stroke-width': 1.4
    }));
    svg.appendChild(el('line', {
      x1: cx - 4, y1: cy, x2: cx + 4, y2: cy, stroke: 'var(--planet-rim)', 'stroke-width': 1
    }));
    svg.appendChild(el('line', {
      x1: cx, y1: cy - 4, x2: cx, y2: cy + 4, stroke: 'var(--planet-rim)', 'stroke-width': 1
    }));
    svg.appendChild(el('text', {
      x: cx + bodyR + 6, y: cy + 12, 'class': 'axis-tick'
    }, isSun ? 'Sun (focus)' : 'Earth (focus)'));

    var path = [];
    var coords = pts.map(function (p) {
      var q = project(p.r, state.view, scale, cx, cy);
      path.push((path.length ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2));
      return q;
    });

    /* Apsis line and markers. */
    var rpVec = V.normalize(data.orbit.state.eccentricityVector);
    if (V.norm(rpVec) === 0) rpVec = V.matVec(mPqw, [1, 0, 0]);
    var pPeri = V.scale(rpVec, data.orbit.state.periapsisRadius);
    var pApo = V.scale(rpVec, -(data.orbit.state.apoapsisRadius || data.orbit.state.periapsisRadius));
    var qPeri = project(pPeri, state.view, scale, cx, cy);
    var qApo = project(pApo, state.view, scale, cx, cy);

    svg.appendChild(el('line', {
      x1: qPeri[0], y1: qPeri[1], x2: qApo[0], y2: qApo[1],
      stroke: 'var(--baseline)', 'stroke-width': 1, 'stroke-dasharray': '2 3'
    }));

    /* Primary sampled Keplerian orbit path. */
    svg.appendChild(el('path', {
      d: path.join(' ') + ' Z', fill: 'none',
      stroke: seriesColor(0), 'stroke-width': 2, 'stroke-linejoin': 'round'
    }));

    [
      { label: 'rp (' + compact(data.orbit.state.periapsisRadius, 2) + ')', q: qPeri, color: seriesColor(2), dy: -8 },
      { label: 'ra (' + compact(data.orbit.state.apoapsisRadius || data.orbit.state.periapsisRadius, 2) + ')', q: qApo, color: seriesColor(3), dy: 14 }
    ].forEach(function (a) {
      svg.appendChild(el('circle', {
        cx: a.q[0], cy: a.q[1], r: 4.5, fill: cssVar('--surface-1'),
        stroke: a.color, 'stroke-width': 2
      }));
      svg.appendChild(el('text', {
        x: clamp(a.q[0] + 8, box.x + 6, box.x + box.w - 115),
        y: clamp(a.q[1] + a.dy, box.y + 12, box.y + box.h - 6),
        'class': 'direct-label'
      }, a.label));
    });

    /* Burn node markers. */
    var burnAnomalies = [0, Math.PI];
    burnAnomalies.forEach(function (nu, i) {
      var idx = Math.round(nu / O.TAU * (pts.length - 1));
      var q = coords[clamp(idx, 0, coords.length - 1)];
      var c = seriesColor(1);
      svg.appendChild(el('rect', {
        x: q[0] - 4, y: q[1] - 4, width: 8, height: 8,
        fill: c, stroke: 'var(--surface-1)', 'stroke-width': 1.5
      }));
      svg.appendChild(el('text', {
        x: clamp(q[0] + 8, box.x + 6, box.x + box.w - 90),
        y: clamp(q[1] + (i === 0 ? 13 : -8), box.y + 12, box.y + box.h - 6),
        'class': 'direct-label'
      }, 'dv' + (i + 1)));
    });

    /* Scrubbed spacecraft radius vector, velocity vector, and state marker. */
    var scrubIdx = Math.round(state.scrub / 100 * (pts.length - 1));
    var p = pts[clamp(scrubIdx, 0, pts.length - 1)];
    var q = coords[clamp(scrubIdx, 0, coords.length - 1)];
    var speed = V.norm(p.v) || 1;
    var vEnd = project(V.add(p.r, V.scale(p.v, plotMaxR / speed * 0.16)), state.view, scale, cx, cy);

    svg.appendChild(el('line', {
      x1: cx, y1: cy, x2: q[0], y2: q[1],
      stroke: seriesColor(0), 'stroke-width': 1, 'stroke-opacity': 0.55, 'stroke-dasharray': '3 2'
    }));
    svg.appendChild(el('line', {
      x1: q[0], y1: q[1], x2: vEnd[0], y2: vEnd[1],
      stroke: seriesColor(1), 'stroke-width': 2, 'stroke-linecap': 'round'
    }));
    svg.appendChild(el('circle', { cx: vEnd[0], cy: vEnd[1], r: 2.8, fill: seriesColor(1) }));
    svg.appendChild(el('circle', {
      id: 'spacecraft-marker', cx: q[0], cy: q[1], r: 6.5,
      fill: cssVar('--surface-1'), stroke: seriesColor(0), 'stroke-width': 2
    }));
    svg.appendChild(el('circle', { cx: q[0], cy: q[1], r: 2.5, fill: seriesColor(0) }));
    svg.appendChild(el('text', {
      x: clamp(q[0] + 10, box.x + 6, box.x + box.w - 115),
      y: clamp(q[1] - 9, box.y + 12, box.y + box.h - 6),
      'class': 'direct-label'
    }, 'SC (nu=' + num(p.nu * O.DEG, 1) + ' deg)'));

    /* Update live state telemetry strip below the trajectory plot. */
    var readout = $('trajectory-readout');
    if (readout) {
      clear(readout);
      var rvDot = V.dot(p.r, p.v);
      var fpaRad = Math.asin(clamp(rvDot / ((p.radius || 1) * (p.speed || 1)), -1, 1));
      var fields = [
        ['nu', num(p.nu * O.DEG, 2) + ' deg'],
        ['E', num(p.E * O.DEG, 2) + ' deg'],
        ['M', num(p.M * O.DEG, 2) + ' deg'],
        ['r', compact(p.radius, 3)],
        ['v', num(p.speed, 2) + ' m/s'],
        ['gamma (FPA)', num(fpaRad * O.DEG, 2) + ' deg'],
        ['t', num(p.tSec / 60, 2) + ' min']
      ];
      fields.forEach(function (f) {
        var span = html('span');
        span.appendChild(doc.createTextNode(f[0] + ': '));
        span.appendChild(html('strong', null, f[1]));
        readout.appendChild(span);
      });
    }

    /* Interactive nearest-sample hover inspector. */
    var hit = el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, 'class': 'mark-hit' });
    svg.appendChild(hit);
    var ghost = el('circle', {
      r: 4.5, fill: cssVar('--surface-1'), stroke: seriesColor(0), 'stroke-width': 2, opacity: 0
    });
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
        'Sample #' + best + ' (nu = ' + num(sample.nu * O.DEG, 1) + ' deg)', [
          { label: 'r', value: compact(sample.radius, 3), color: seriesColor(0) },
          { label: 'v', value: num(sample.speed, 1) + ' m/s', color: seriesColor(1) },
          { label: 'E', value: num(sample.E * O.DEG, 1) + ' deg' },
          { label: 't', value: num(sample.tSec / 60, 1) + ' min' }
        ]);
    });
    hit.addEventListener('mouseleave', function () {
      ghost.setAttribute('opacity', 0);
      hideTooltip('trajectory-tooltip');
    });

    var legendItems = [
      { label: 'Reference orbit', color: seriesColor(0) },
      { label: 'Transfer / velocity vector', color: seriesColor(1) },
      { label: 'Periapsis (rp)', color: seriesColor(2), rect: true },
      { label: 'Apoapsis (ra)', color: seriesColor(3), rect: true }
    ];
    renderLegend('trajectory-legend', legendItems);
    $('trajectory-sub').textContent = state.view === 'plane'
      ? 'Perifocal PQW plane: reference orbit, transfer arc, apsides, and velocity vector'
      : '3D inertial IJK projection (i = ' + num(data.preset.elements.i * O.DEG, 2) +
        ' deg, RAAN = ' + num((data.preset.elements.raan || 0) * O.DEG, 1) + ' deg)';

    var step = Math.max(1, Math.floor(pts.length / 16));
    var rows = [];
    for (var i = 0; i < pts.length; i += step) {
      var s = pts[i];
      rows.push([
        num(s.nu * O.DEG, 1) + ' deg',
        num(s.tSec / 60, 2),
        compact(s.radius, 3),
        num(s.speed, 2),
        compact(s.r[0], 2),
        compact(s.r[1], 2),
        compact(s.r[2], 2)
      ]);
    }
    renderTable('trajectory-table', ['nu (deg)', 't (min)', 'r', 'v (m/s)', 'x', 'y', 'z'], rows);
  }

  function renderTransfer() {
    var svg = $('transfer-svg');
    clear(svg);
    svg.appendChild(el('desc', { id: 'transfer-desc' },
      'Horizontal technical bars showing the delta-v magnitude and share of each maneuver burn.'));
    var width = 440, height = 270;
    var box = { x: 148, y: 24, w: 238, h: 184 };
    var max = Math.max.apply(null, data.burns.map(function (b) { return b.dv; })) * 1.18 || 1;
    var gap = data.burns.length > 1 ? 16 : 0;
    var barH = (box.h - gap * (data.burns.length - 1)) / data.burns.length;

    [0, 0.25, 0.5, 0.75, 1].forEach(function (u) {
      var x = box.x + box.w * u;
      svg.appendChild(el('line', { x1: x, y1: box.y, x2: x, y2: box.y + box.h, 'class': 'gridline' }));
      svg.appendChild(el('text', {
        x: x, y: box.y + box.h + 15, 'class': 'axis-tick', 'text-anchor': 'middle'
      }, compactRaw(max * u, 1)));
    });
    svg.appendChild(el('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h,
      fill: 'none', stroke: 'var(--border-strong)', 'stroke-width': 1
    }));
    svg.appendChild(el('text', {
      x: box.x + box.w / 2, y: height - 6, 'class': 'axis-title', 'text-anchor': 'middle'
    }, 'Impulsive burn magnitude dv (m/s)'));

    var subEl = $('transfer-sub');
    if (subEl) {
      if (data.biElliptic) {
        subEl.textContent = 'Bi-Elliptic (r2/r1 = ' + num(data.biElliptic.radiusRatio, 1) +
          ' > 11.94): saves ' + num(data.biElliptic.savingsDv, 2) + ' m/s (' +
          num(data.biElliptic.savingsPercent, 2) + '%) vs Hohmann';
      } else {
        var rRatio = (data.hohmann.r2 || 1) / (data.hohmann.r1 || 1);
        subEl.textContent = 'Hohmann 2-burn raise (r2/r1 = ' + num(rRatio, 2) +
          ', TOF = ' + num(data.hohmann.timeOfFlightSec / 3600, 2) + ' h)';
      }
    }

    data.burns.forEach(function (b, i) {
      var y = box.y + i * (barH + gap);
      var w = box.w * b.dv / max;
      var c = seriesColor(i % 4);
      svg.appendChild(el('rect', {
        x: box.x, y: y + barH * 0.15, width: w, height: barH * 0.7, rx: 2, fill: c
      }));
      svg.appendChild(el('text', {
        x: box.x - 8, y: y + barH / 2 + 4, 'class': 'axis-tick', 'text-anchor': 'end'
      }, b.name));
      svg.appendChild(el('text', {
        x: box.x + w + 6, y: y + barH / 2 + 4, 'class': 'direct-label'
      }, num(b.dv, 1) + ' m/s'));
      var hit = el('rect', {
        x: box.x, y: y, width: box.w, height: barH, 'class': 'mark-hit'
      });
      hit.addEventListener('mousemove', function (ev) {
        var r = svg.getBoundingClientRect();
        showTooltip('transfer-tooltip', ev.clientX - r.left, ev.clientY - r.top, b.name, [
          { label: 'dv', value: num(b.dv, 2) + ' m/s', color: c },
          { label: 'share', value: num(100 * b.dv / data.burnTotal, 1) + '%' },
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
      rows.push([b.name, num(b.dv, 3), num(100 * b.dv / data.burnTotal, 2) + '%', num(running, 3)]);
    });
    rows.push(['Total maneuver dv', num(data.burnTotal, 3), '100.00%', num(data.burnTotal, 3)]);
    renderTable('transfer-table', ['Maneuver burn', 'dv (m/s)', 'Budget share', 'Cumulative (m/s)'], rows);
  }

  function renderStaging() {
    var svg = $('staging-svg');
    clear(svg);
    svg.appendChild(el('desc', { id: 'staging-desc' },
      'Stage-by-stage delta-v bars overlaid with the cumulative vehicle delta-v profile.'));
    var width = 440, height = 270;
    var box = { x: 56, y: 24, w: 356, h: 184 };
    var stages = data.staging.stages;
    var max = data.staging.totalDv * 1.14;

    [0, 0.25, 0.5, 0.75, 1].forEach(function (u) {
      var y = box.y + box.h * (1 - u);
      svg.appendChild(el('line', { x1: box.x, y1: y, x2: box.x + box.w, y2: y, 'class': 'gridline' }));
      svg.appendChild(el('text', {
        x: box.x - 7, y: y + 3, 'class': 'axis-tick', 'text-anchor': 'end'
      }, compactRaw(max * u, 1)));
    });
    svg.appendChild(el('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h,
      fill: 'none', stroke: 'var(--border-strong)', 'stroke-width': 1
    }));
    svg.appendChild(el('text', {
      x: 13, y: box.y + box.h / 2, 'class': 'axis-title', 'text-anchor': 'middle',
      transform: 'rotate(-90 13 ' + (box.y + box.h / 2) + ')'
    }, 'Velocity increment dv (m/s)'));

    var slot = box.w / stages.length;
    var barW = slot * 0.46;
    var linePts = [];
    stages.forEach(function (s, i) {
      var x = box.x + i * slot + (slot - barW) / 2;
      var h = box.h * s.dv / max;
      var y = box.y + box.h - h;
      var c = seriesColor(i % 4);
      svg.appendChild(el('rect', { x: x, y: y, width: barW, height: h, rx: 2, fill: c }));
      svg.appendChild(el('text', {
        x: x + barW / 2, y: y - 6, 'class': 'direct-label', 'text-anchor': 'middle'
      }, num(s.dv / 1000, 2) + ' km/s'));
      svg.appendChild(el('text', {
        x: x + barW / 2, y: box.y + box.h + 15, 'class': 'axis-tick', 'text-anchor': 'middle'
      }, 'Stage ' + (i + 1) + ' (Isp ' + s.ispSec + 's)'));
      linePts.push([x + barW / 2, box.y + box.h * (1 - s.cumulativeDv / max)]);

      var hit = el('rect', {
        x: box.x + i * slot, y: box.y, width: slot, height: box.h, 'class': 'mark-hit'
      });
      hit.addEventListener('mousemove', function (ev) {
        var r = svg.getBoundingClientRect();
        showTooltip('staging-tooltip', ev.clientX - r.left, ev.clientY - r.top, s.name, [
          { label: 'stage dv', value: num(s.dv, 1) + ' m/s', color: c },
          { label: 'Isp', value: num(s.ispSec, 0) + ' s' },
          { label: 'mass ratio m0/mf', value: num(s.massRatio, 3) },
          { label: 'cumulative dv', value: num(s.cumulativeDv, 1) + ' m/s' }
        ]);
      });
      hit.addEventListener('mouseleave', function () { hideTooltip('staging-tooltip'); });
      svg.appendChild(hit);
    });

    var d = linePts.map(function (q, i) {
      return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
    }).join(' ');
    svg.appendChild(el('path', {
      d: d, fill: 'none', stroke: seriesColor(1), 'stroke-width': 1.8, 'stroke-linecap': 'round'
    }));
    linePts.forEach(function (q, i) {
      svg.appendChild(el('circle', {
        cx: q[0], cy: q[1], r: 4, fill: cssVar('--surface-1'),
        stroke: seriesColor(1), 'stroke-width': 2
      }));
      if (i === linePts.length - 1) {
        svg.appendChild(el('text', {
          x: q[0] - 8, y: q[1] - 8, 'class': 'direct-label', 'text-anchor': 'end'
        }, 'Total ' + num(data.staging.totalDv / 1000, 2) + ' km/s'));
      }
    });

    renderLegend('staging-legend', [
      { label: 'Stage dv', color: seriesColor(0), rect: true },
      { label: 'Cumulative dv', color: seriesColor(1) }
    ]);
    var rows = stages.map(function (s) {
      return [
        s.name,
        num(s.initialMassKg, 0) + ' kg',
        num(s.massRatio, 3),
        num(s.ispSec, 0) + ' s',
        num(s.dv, 2),
        num(s.cumulativeDv, 2)
      ];
    });
    rows.push([
      'Vehicle Stack Total (payload 4,200 kg)',
      num(data.staging.initialMassKg, 0) + ' kg',
      num(data.staging.totalMassRatio, 3),
      '-',
      num(data.staging.totalDv, 2),
      num(data.staging.totalDv, 2)
    ]);
    renderTable('staging-table', ['Stage', 'm0 (kg)', 'm0/mf', 'Isp', 'Stage dv (m/s)', 'Cumulative (m/s)'], rows);
  }

  function cellAt(g, di, fi) {
    return g.cells[di * g.rows + fi];
  }

  function inspectorText(cell) {
    var box = $('porkchop-inspector');
    if (!box) return;
    clear(box);
    if (!cell) return;
    var fields = [
      ['Departure epoch', 'Day ' + num(cell.departureDay, 2)],
      ['Time of flight', num(cell.timeOfFlightDay, 2) + ' d'],
      ['C3', num(cell.c3 / 1e6, 3) + ' km2/s2'],
      ['v_inf,dep (dv1)', num(cell.dvDeparture, 1) + ' m/s'],
      ['v_inf,arr (dv2)', num(cell.dvArrival, 1) + ' m/s'],
      ['Total dv', num(cell.totalDv, 1) + ' m/s (' + num(cell.totalDv / 1000, 3) + ' km/s)']
    ];
    fields.forEach(function (f) {
      var wrap = html('span');
      wrap.appendChild(doc.createTextNode(f[0] + ': '));
      wrap.appendChild(html('strong', null, f[1]));
      box.appendChild(wrap);
    });
  }

  /* Marching Squares 2D contour extraction on the (cols x rows) grid.
   * Returns { d: svgPathString, labelPt: [x, y] } for a given threshold level.
   */
  function buildMarchingSquaresContour(g, box, cw, ch, valueFn, level) {
    var segs = [];
    var labelPt = null;
    var bestDistCenter = Infinity;
    var centerX = box.x + box.w * 0.52;
    var centerY = box.y + box.h * 0.48;

    function gx(di) { return box.x + (di + 0.5) * cw; }
    function gy(fi) { return box.y + (g.rows - 1 - fi + 0.5) * ch; }
    function interp(vA, vB, pA, pB) {
      var denom = vB - vA;
      var t = Math.abs(denom) > 1e-12 ? clamp((level - vA) / denom, 0, 1) : 0.5;
      return [pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t];
    }

    for (var di = 0; di < g.cols - 1; di++) {
      for (var fi = 0; fi < g.rows - 1; fi++) {
        var v00 = valueFn(cellAt(g, di, fi));
        var v10 = valueFn(cellAt(g, di + 1, fi));
        var v11 = valueFn(cellAt(g, di + 1, fi + 1));
        var v01 = valueFn(cellAt(g, di, fi + 1));
        if (!isFinite(v00) || !isFinite(v10) || !isFinite(v11) || !isFinite(v01)) continue;

        var p00 = [gx(di), gy(fi)];
        var p10 = [gx(di + 1), gy(fi)];
        var p11 = [gx(di + 1), gy(fi + 1)];
        var p01 = [gx(di), gy(fi + 1)];

        var idx = (v00 >= level ? 1 : 0) |
                  (v10 >= level ? 2 : 0) |
                  (v11 >= level ? 4 : 0) |
                  (v01 >= level ? 8 : 0);
        if (idx === 0 || idx === 15) continue;

        var eBottom = interp(v00, v10, p00, p10);
        var eRight = interp(v10, v11, p10, p11);
        var eTop = interp(v01, v11, p01, p11);
        var eLeft = interp(v00, v01, p00, p01);

        var pairs = [];
        if (idx === 1 || idx === 14) pairs.push([eLeft, eBottom]);
        else if (idx === 2 || idx === 13) pairs.push([eBottom, eRight]);
        else if (idx === 3 || idx === 12) pairs.push([eLeft, eRight]);
        else if (idx === 4 || idx === 11) pairs.push([eRight, eTop]);
        else if (idx === 6 || idx === 9) pairs.push([eBottom, eTop]);
        else if (idx === 7 || idx === 8) pairs.push([eLeft, eTop]);
        else if (idx === 5) { pairs.push([eLeft, eTop]); pairs.push([eBottom, eRight]); }
        else if (idx === 10) { pairs.push([eLeft, eBottom]); pairs.push([eRight, eTop]); }

        pairs.forEach(function (pair) {
          segs.push('M' + pair[0][0].toFixed(1) + ' ' + pair[0][1].toFixed(1) +
                    'L' + pair[1][0].toFixed(1) + ' ' + pair[1][1].toFixed(1));
          var mx = 0.5 * (pair[0][0] + pair[1][0]);
          var my = 0.5 * (pair[0][1] + pair[1][1]);
          var d2 = (mx - centerX) * (mx - centerX) + (my - centerY) * (my - centerY);
          if (d2 < bestDistCenter && mx > box.x + 36 && mx < box.x + box.w - 48 &&
              my > box.y + 16 && my < box.y + box.h - 16) {
            bestDistCenter = d2;
            labelPt = [mx, my];
          }
        });
      }
    }
    return { d: segs.join(' '), labelPt: labelPt };
  }

  function renderPorkchop() {
    var g = data.porkchop;
    var svg = $('porkchop-svg');
    clear(svg);
    svg.appendChild(el('desc', { id: 'porkchop-desc' },
      'Two-dimensional Lambert transfer contour plot with total delta-v heatmap, marching-squares total dv isolines, dashed C3 characteristic energy isolines, and minimum-energy markers.'));
    var width = 760, height = 430;
    var box = { x: 68, y: 18, w: 668, h: 356 };
    var cw = box.w / g.cols, ch = box.h / g.rows;
    var lo = g.minimumTotalDv, hi = g.maximumTotalDv;
    var span = Math.max(1, hi - lo);
    var minD = g.departureDays[0], maxD = g.departureDays[g.departureDays.length - 1];
    var minF = g.flightDays[0], maxF = g.flightDays[g.flightDays.length - 1];

    /* 1. Raster heatmap cells (dark blue basin = minimum total dv). */
    var heat = el('g');
    g.cells.forEach(function (cell) {
      var t = isFinite(cell.totalDv) ? clamp((cell.totalDv - lo) / span, 0, 1) : 1;
      /* Use sqrt compression so the optimal basin structure has high visual contrast. */
      var tone = Math.pow(t, 0.62);
      heat.appendChild(el('rect', {
        x: (box.x + cell.departureIndex * cw).toFixed(2),
        y: (box.y + (g.rows - 1 - cell.flightIndex) * ch).toFixed(2),
        width: (cw + 0.4).toFixed(2),
        height: (ch + 0.4).toFixed(2),
        fill: rampColor(tone)
      }));
    });
    svg.appendChild(heat);

    /* 2. Marching-squares 2D contour isolines for Total dv (km/s). */
    var dvContours = el('g');
    var dvFracs = [0.06, 0.14, 0.25, 0.40, 0.60];
    dvFracs.forEach(function (frac, idx) {
      var levelDv = lo + span * frac;
      var iso = buildMarchingSquaresContour(g, box, cw, ch, function (c) { return c.totalDv; }, levelDv);
      if (iso.d) {
        dvContours.appendChild(el('path', {
          d: iso.d,
          fill: 'none',
          stroke: cssVar('--label-on-fill'),
          'stroke-width': idx === 0 ? 1.5 : 1.0,
          'stroke-opacity': idx === 0 ? 0.92 : 0.68
        }));
        if (iso.labelPt && idx < 4) {
          dvContours.appendChild(el('text', {
            x: iso.labelPt[0].toFixed(1),
            y: iso.labelPt[1].toFixed(1),
            'class': 'isoline-label',
            'text-anchor': 'middle'
          }, num(levelDv / 1000, 1) + ' km/s'));
        }
      }
    });
    svg.appendChild(dvContours);

    /* 3. Marching-squares 2D contour isolines for C3 characteristic energy (km2/s2). */
    var maxC3 = 0;
    g.cells.forEach(function (c) { if (isFinite(c.c3) && c.c3 < 1e11) maxC3 = Math.max(maxC3, c.c3); });
    var minC3 = g.minimumC3;
    var spanC3 = Math.max(1, maxC3 - minC3);
    var c3Contours = el('g');
    [0.05, 0.14, 0.28].forEach(function (frac, idx) {
      var levelC3 = minC3 + spanC3 * frac;
      var isoC3 = buildMarchingSquaresContour(g, box, cw, ch, function (c) { return c.c3; }, levelC3);
      if (isoC3.d) {
        c3Contours.appendChild(el('path', {
          d: isoC3.d,
          fill: 'none',
          stroke: seriesColor(3),
          'stroke-width': 1.15,
          'stroke-dasharray': '4 3',
          'stroke-opacity': 0.9
        }));
        if (isoC3.labelPt && idx < 2) {
          c3Contours.appendChild(el('text', {
            x: isoC3.labelPt[0].toFixed(1),
            y: (isoC3.labelPt[1] + 10).toFixed(1),
            'class': 'isoline-label',
            'text-anchor': 'middle'
          }, 'C3=' + num(levelC3 / 1e6, 1)));
        }
      }
    });
    svg.appendChild(c3Contours);

    /* 4. Axes and ticks. */
    var xt = [], yt = [], k;
    for (k = 0; k <= 5; k++) {
      xt.push({ u: k / 5, label: num(lerp(minD, maxD, k / 5), 1) });
      yt.push({ u: k / 5, label: num(lerp(minF, maxF, k / 5), 1) });
    }
    drawAxes(svg, width, height, box,
      'Departure epoch (days from window open)',
      'Time of flight (days)', xt, yt);

    /* 5. Minimum C3 and Minimum Total dv markers + interactive crosshair. */
    var vline = el('line', {
      y1: box.y, y2: box.y + box.h, stroke: cssVar('--label-on-fill'),
      'stroke-width': 1, 'stroke-opacity': 0.85, 'pointer-events': 'none'
    });
    var hline = el('line', {
      x1: box.x, x2: box.x + box.w, stroke: cssVar('--label-on-fill'),
      'stroke-width': 1, 'stroke-opacity': 0.85, 'pointer-events': 'none'
    });
    svg.appendChild(vline); svg.appendChild(hline);

    if (g.optimalC3Cell && g.optimal &&
        (g.optimalC3Cell.departureIndex !== g.optimal.departureIndex ||
         g.optimalC3Cell.flightIndex !== g.optimal.flightIndex)) {
      var c3x = box.x + (g.optimalC3Cell.departureIndex + 0.5) * cw;
      var c3y = box.y + (g.rows - 1 - g.optimalC3Cell.flightIndex + 0.5) * ch;
      svg.appendChild(el('rect', {
        x: c3x - 4.5, y: c3y - 4.5, width: 9, height: 9,
        fill: 'none', stroke: seriesColor(3), 'stroke-width': 1.8
      }));
      svg.appendChild(el('text', {
        x: clamp(c3x + 8, box.x + 4, box.x + box.w - 95),
        y: clamp(c3y + 12, box.y + 12, box.y + box.h - 4),
        'class': 'isoline-label'
      }, 'min C3 (' + num(g.minimumC3 / 1e6, 2) + ')'));
    }

    if (g.optimal) {
      var ox = box.x + (g.optimal.departureIndex + 0.5) * cw;
      var oy = box.y + (g.rows - 1 - g.optimal.flightIndex + 0.5) * ch;
      svg.appendChild(el('circle', {
        cx: ox, cy: oy, r: 6.5, fill: 'none', stroke: seriesColor(2), 'stroke-width': 2.2
      }));
      svg.appendChild(el('circle', {
        cx: ox, cy: oy, r: 2, fill: seriesColor(2)
      }));
      svg.appendChild(el('text', {
        x: clamp(ox + 9, box.x + 4, box.x + box.w - 130),
        y: clamp(oy - 8, box.y + 12, box.y + box.h - 4),
        'class': 'isoline-label'
      }, 'min dv (' + num(g.minimumTotalDv / 1000, 2) + ' km/s)'));
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

    var hit = el('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h,
      'class': 'mark-hit', tabindex: 0, role: 'application',
      'aria-label': 'Porkchop Lambert contour grid inspector, use arrow keys to move the crosshair'
    });
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
        'Dep day ' + num(c.departureDay, 1) + ' | TOF ' + num(c.timeOfFlightDay, 1) + ' d', [
          { label: 'Total dv', value: num(c.totalDv / 1000, 3) + ' km/s', color: seriesColor(2) },
          { label: 'C3', value: num(c.c3 / 1e6, 2) + ' km2/s2', color: seriesColor(3) },
          { label: 'v_inf,dep', value: num(c.dvDeparture, 1) + ' m/s' },
          { label: 'v_inf,arr', value: num(c.dvArrival, 1) + ' m/s' }
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
    renderPorkchopLegend('porkchop-legend', lo / 1000, hi / 1000);
    $('porkchop-sub').textContent = g.label + ' (' + g.cols + 'x' + g.rows + ' ' + g.method +
      ' solver): min dv ' + num(g.minimumTotalDv / 1000, 3) + ' km/s at day ' +
      num(g.optimal.departureDay, 2) + ', TOF ' + num(g.optimal.timeOfFlightDay, 2) + ' d';

    var rows = g.cells.map(function (c) {
      return [
        num(c.departureDay, 2),
        num(c.timeOfFlightDay, 2),
        num(c.c3 / 1e6, 3),
        num(c.dvDeparture, 1),
        num(c.dvArrival, 1),
        num(c.totalDv, 1)
      ];
    });
    var optimalRow = g.optimal ? g.optimal.departureIndex * g.rows + g.optimal.flightIndex : -1;
    renderTable('porkchop-table', [
      'Departure (d)', 'Flight (d)', 'C3 (km2/s2)',
      'v_inf,dep (m/s)', 'v_inf,arr (m/s)', 'Total dv (m/s)'
    ], rows, optimalRow);
  }

  function renderEnergy() {
    var svg = $('energy-svg');
    clear(svg);
    svg.appendChild(el('desc', { id: 'energy-desc' },
      'Technical line plot of relative specific energy drift over one orbital period under 4th-order Runge-Kutta integration.'));
    var width = 760, height = 290;
    var box = { x: 76, y: 20, w: 660, h: 214 };
    var pts = data.trajectory;
    var maxAbs = 0;
    pts.forEach(function (p) { maxAbs = Math.max(maxAbs, Math.abs(p.energyDrift)); });
    maxAbs = Math.max(maxAbs, 1e-12) * 1.18;
    var tMax = pts[pts.length - 1].tSec / 3600 || 1;
    var map = function (p) {
      return [
        box.x + box.w * (p.tSec / 3600) / tMax,
        box.y + box.h * (0.5 - p.energyDrift / (2 * maxAbs))
      ];
    };
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(function (u) {
      var x = box.x + box.w * u;
      svg.appendChild(el('line', { x1: x, y1: box.y, x2: x, y2: box.y + box.h, 'class': 'gridline' }));
      svg.appendChild(el('text', {
        x: x, y: box.y + box.h + 15, 'class': 'axis-tick', 'text-anchor': 'middle'
      }, num(tMax * u, 2)));
    });
    [-1, -0.5, 0, 0.5, 1].forEach(function (u) {
      var y = box.y + box.h * (0.5 - u * 0.5);
      svg.appendChild(el('line', {
        x1: box.x, y1: y, x2: box.x + box.w, y2: y,
        'class': u === 0 ? 'baseline' : 'gridline'
      }));
      svg.appendChild(el('text', {
        x: box.x - 7, y: y + 3, 'class': 'axis-tick', 'text-anchor': 'end'
      }, sci(u * maxAbs, 1)));
    });
    svg.appendChild(el('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h,
      fill: 'none', stroke: 'var(--border-strong)', 'stroke-width': 1
    }));
    svg.appendChild(el('text', {
      x: box.x + box.w / 2, y: height - 4, 'class': 'axis-title', 'text-anchor': 'middle'
    }, 'Elapsed propagation time (hours)'));
    svg.appendChild(el('text', {
      x: 13, y: box.y + box.h / 2, 'class': 'axis-title', 'text-anchor': 'middle',
      transform: 'rotate(-90 13 ' + (box.y + box.h / 2) + ')'
    }, 'Relative drift (E - E0) / E0'));

    var d = [];
    pts.forEach(function (p, i) {
      var q = map(p);
      d.push((i ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2));
    });
    svg.appendChild(el('path', {
      d: d.join(' '), fill: 'none', stroke: seriesColor(0),
      'stroke-width': 1.8, 'stroke-linejoin': 'round'
    }));
    var worst = pts.reduce(function (a, b) {
      return Math.abs(b.energyDrift) > Math.abs(a.energyDrift) ? b : a;
    }, pts[0]);
    var wq = map(worst);
    svg.appendChild(el('circle', {
      cx: wq[0], cy: wq[1], r: 4.5, fill: cssVar('--surface-1'),
      stroke: seriesColor(1), 'stroke-width': 2
    }));
    svg.appendChild(el('text', {
      x: clamp(wq[0] + 8, box.x + 4, box.x + box.w - 135),
      y: clamp(wq[1] - 8, box.y + 12, box.y + box.h - 4),
      'class': 'direct-label'
    }, 'peak |dE/E0| = ' + sci(Math.abs(worst.energyDrift), 2)));

    var cross = el('line', {
      y1: box.y, y2: box.y + box.h, stroke: seriesColor(3),
      'stroke-width': 1, opacity: 0, 'pointer-events': 'none'
    });
    svg.appendChild(cross);
    var dot = el('circle', {
      r: 4.5, fill: cssVar('--surface-1'), stroke: seriesColor(0),
      'stroke-width': 2, opacity: 0, 'pointer-events': 'none'
    });
    svg.appendChild(dot);
    var hit = el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, 'class': 'mark-hit' });
    svg.appendChild(hit);
    hit.addEventListener('mousemove', function (ev) {
      var r = svg.getBoundingClientRect();
      var mx = (ev.clientX - r.left) / r.width * width;
      var idx = clamp(Math.round((mx - box.x) / box.w * (pts.length - 1)), 0, pts.length - 1);
      var p = pts[idx], q = map(p);
      cross.setAttribute('x1', q[0]); cross.setAttribute('x2', q[0]); cross.setAttribute('opacity', 1);
      dot.setAttribute('cx', q[0]); dot.setAttribute('cy', q[1]); dot.setAttribute('opacity', 1);
      showTooltip('energy-tooltip', ev.clientX - r.left, ev.clientY - r.top,
        't = ' + num(p.tSec / 3600, 3) + ' h (' + num(p.tSec, 0) + ' s)', [
          { label: 'dE/E0', value: sci(p.energyDrift, 3), color: seriesColor(0) },
          { label: 'E', value: sci(p.energy, 4) + ' J/kg' },
          { label: 'r', value: compact(p.radius, 3) },
          { label: 'v', value: num(p.speed, 1) + ' m/s' }
        ]);
    });
    hit.addEventListener('mouseleave', function () {
      cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0);
      hideTooltip('energy-tooltip');
    });

    var prop = data.propagation;
    var metrics = [
      ['RK4 steps', num(prop.steps, 0)],
      ['dt', num(prop.stepSizeSec, 2) + ' s'],
      ['Max |dE/E0|', sci(prop.maxEnergyDrift, 3)],
      ['Final dE/E0', sci(prop.energyDrift, 3)],
      ['J2 zonal harmonic', state.j2 ? 'Enabled (1.08263e-3)' : 'Disabled (0)'],
      ['Secular dRAAN/dt', num(prop.raanDriftDegPerDay, 4) + ' deg/day'],
      ['Secular dArgPe/dt', num(prop.argPeDriftDegPerDay, 4) + ' deg/day']
    ];
    var strip = $('propagation-metrics');
    clear(strip);
    metrics.forEach(function (m) {
      var wrap = html('span');
      wrap.appendChild(doc.createTextNode(m[0] + ': '));
      wrap.appendChild(html('strong', null, m[1]));
      strip.appendChild(wrap);
    });
    $('energy-sub').textContent = 'RK4 integration over ' + num(prop.dtSec / 3600, 2) +
      ' h (' + (state.j2 ? 'two-body + J2 oblateness potential' : 'point-mass Keplerian gravity') + ')';
    renderLegend('energy-legend', [
      { label: 'Relative energy drift (dE/E0)', color: seriesColor(0) },
      { label: 'Peak excursion', color: seriesColor(1), rect: true }
    ]);

    var step = Math.max(1, Math.floor(pts.length / 20));
    var rows = [];
    for (var i = 0; i < pts.length; i += step) {
      var p = pts[i];
      rows.push([
        num(p.tSec, 1),
        num(p.tSec / 3600, 3),
        compact(p.radius, 3),
        num(p.speed, 2),
        sci(p.energy, 4),
        sci(p.energyDrift, 3)
      ]);
    }
    renderTable('energy-table', ['t (s)', 't (h)', 'r', 'v (m/s)', 'Energy (J/kg)', 'dE/E0'], rows);
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
    if (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = 'Step orbit';
    }
  }

  function setTheme(theme) {
    var dark = theme === 'dark';
    doc.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var btn = $('theme-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
      btn.setAttribute('aria-label', dark ? 'Switch to light plotting sheet' : 'Switch to dark console');
      var label = btn.querySelector('.theme-label');
      if (label) label.textContent = dark ? 'Theme: Dark console' : 'Theme: Light sheet';
    }
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
        preset: state.windowPreset, departureSteps: 30, flightSteps: 26
      });
      if (data.porkchop.optimal) {
        state.cell.departureIndex = data.porkchop.optimal.departureIndex;
        state.cell.flightIndex = data.porkchop.optimal.flightIndex;
      }
      updateHero();
      renderPorkchop();
      updateReference();
    });
    $('j2-toggle').addEventListener('click', function () {
      state.j2 = !state.j2;
      this.setAttribute('aria-checked', state.j2 ? 'true' : 'false');
      var text = this.querySelector('.switch-text');
      if (text) text.textContent = state.j2 ? 'On (J2 = 1.0826e-3)' : 'Off (two-body)';
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
      this.textContent = 'Pause step';
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
          return {
            id: 'Burn' + (i + 1),
            dv1: b.dv,
            propagateSec: data.hohmann.timeOfFlightSec / data.burns.length
          };
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
