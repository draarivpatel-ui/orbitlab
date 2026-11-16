'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./tests/dom-harness.cjs');
function app(options) { return boot(__dirname, ['orbit.js', 'app.js'], options); }
function hit(svg) { return svg.querySelectorAll('.mark-hit').at(-1); }

test('the actual document boots both scripts with finite SVG geometry and live numerical evidence', () => {
  const h = app(); assert.equal(h.errors.length, 0); assert.equal(h.node('verification-status').textContent, 'Numerical checks passed');
  assert.equal(h.node('verification-grid').children.length, 4); assert.equal(h.node('preset-select').children.length, 5);
  for (const svg of h.document.querySelectorAll('svg')) for (const node of svg.querySelectorAll('path, circle, line, rect, text')) {
    for (const value of Object.values(node.attributes)) assert.ok(!/NaN|Infinity/.test(value), `${node.tagName}: ${value}`);
  }
});
test('every static DOM binding has an element in the shipped index.html', () => {
  const h = app(), source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  for (const [, id] of source.matchAll(/\$\('([^']+)'\)/g)) assert.ok(h.node(id), id);
});
test('all five one-click showcases select a coherent mission and correct launch window', () => {
  const h = app(), presets = h.sandbox.OrbitLab.PRESETS;
  for (const button of h.document.querySelectorAll('[data-mission]')) {
    button.click(); const preset = presets.find(p => p.id === button.dataset.mission);
    assert.equal(h.node('hero-mission').textContent, preset.name); assert.equal(h.node('preset-select').value, preset.id);
    assert.equal(h.node('window-select').value, preset.porkchopPreset); assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(h.node('verification-status').textContent, 'Numerical checks passed');
  }
});
test('Sun synchronous showcase enables J2 while solar missions disable Earth oblateness', () => {
  const h = app(); h.document.querySelector('[data-mission="sun-sync-eo1"]').click(); assert.equal(h.node('j2-toggle').getAttribute('aria-checked'), 'true');
  assert.match(h.node('propagation-metrics').textContent, /RK45/);
  h.document.querySelector('[data-mission="earth-mars-rendezvous"]').click(); assert.equal(h.node('j2-toggle').disabled, true); assert.equal(h.node('j2-toggle').getAttribute('aria-checked'), 'false');
});
test('mission changes stop animation and reset the mean anomaly scrubber', () => {
  const h = app(); h.node('play-button').click(); h.frame(100); assert.notEqual(h.node('scrub-output').textContent, '0%');
  h.document.querySelector('[data-mission="molniya-12h"]').click(); assert.equal(h.node('scrub-output').textContent, '0%');
  assert.equal(h.node('play-button').getAttribute('aria-pressed'), 'false'); assert.equal(h.timers.size, 0);
});
test('keyboard arrows, Home and End scrub the same reference state as the slider', () => {
  const h = app(), svg = h.node('trajectory-svg'); h.event(svg, 'keydown', { key: 'ArrowRight' }); assert.equal(h.node('scrub-range').value, '1');
  h.event(svg, 'keydown', { key: 'End' }); assert.equal(h.node('scrub-range').value, '100'); assert.match(h.node('trajectory-readout').textContent, /M: 360/);
  h.event(svg, 'keydown', { key: 'Home' }); assert.equal(h.node('scrub-range').value, '0');
});
test('projection changes preserve the selected mission and regenerate the plotted geometry', () => {
  const h = app(); h.node('view-select').value = 'inertial'; h.event(h.node('view-select'), 'change');
  assert.match(h.node('trajectory-svg').textContent, /Inertial I \/ J projection/); assert.match(h.node('hero-mission').textContent, /LEO to GEO/);
});
test('all four numerical windows render a new grid and retain a converged optimal cell', () => {
  const h = app(); for (const preset of ['earth-mars', 'earth-venus', 'leo-geo', 'leo-lunar']) {
    h.node('window-select').value = preset; h.event(h.node('window-select'), 'change'); assert.match(h.node('porkchop-sub').textContent, /30x26 lambert/);
    assert.ok(!/NaN|Infinity/.test(h.node('porkchop-inspector').textContent));
  }
});
test('the selected Lambert arrival is checked by independent RK45 propagation', () => {
  const h = app(); h.document.querySelector('[data-mission="earth-mars-rendezvous"]').click(); h.node('verify-lambert').click();
  assert.match(h.node('lambert-check').textContent, /^Arrival verified: miss/); assert.match(h.node('lambert-check').textContent, /independent RK45 steps/);
});
test('porkchop keyboard inspection moves its crosshair and updates the readable cell data', () => {
  const h = app(), inspector = hit(h.node('porkchop-svg')), before = h.node('porkchop-inspector').textContent;
  h.event(inspector, 'keydown', { key: 'ArrowRight' }); h.event(inspector, 'keydown', { key: 'ArrowUp' }); assert.notEqual(h.node('porkchop-inspector').textContent, before);
  assert.equal(inspector.getAttribute('tabindex'), '0');
});
test('letterboxed SVG pointer coordinates select the physically displayed grid cell', () => {
  const h = app(), svg = h.node('porkchop-svg'); svg._rect = { width: 1000, height: 430, left: 10, top: 20 };
  h.event(hit(svg), 'mousemove', { clientX: 10 + 120 + 68 + 668 / 2, clientY: 20 + 18 + 356 / 2 });
  assert.match(h.node('porkchop-inspector').textContent, /Departure epoch: Day 0.31/);
  assert.equal(h.node('porkchop-tooltip').hidden, false); h.event(hit(svg), 'mouseleave'); assert.equal(h.node('porkchop-tooltip').hidden, true);
});
test('J2 toggle updates energy verification and its accessible state together', () => {
  const h = app(); h.node('j2-toggle').click(); assert.equal(h.node('j2-toggle').getAttribute('aria-checked'), 'true');
  assert.match(h.node('energy-sub').textContent, /J2 oblateness potential/); assert.equal(h.node('verification-status').textContent, 'Numerical checks passed');
});
test('all three exports create the requested files from the selected reference orbit', async () => {
  const h = app(); h.document.querySelector('[data-mission="earth-mars-rendezvous"]').click();
  h.node('download-gmat').click(); h.node('download-oem').click(); h.node('download-csv').click();
  assert.deepEqual(h.document.downloads.map(d => d.name), ['orbitlab-mission.script', 'orbitlab-ephemeris.oem', 'orbitlab-trajectory.csv']);
  const payloads = await Promise.all([...h.blobs.values()].map(blob => blob.text()));
  assert.match(payloads[0], /CentralBody = Sun/); assert.ok(!payloads[0].includes('Maneuver '));
  assert.match(payloads[1], /REF_FRAME\s+= ECLIPJ2000/); assert.ok(payloads[2].startsWith('epoch_utc,t_sec'));
  h.frame(1001); assert.equal(h.blobs.size, 0);
});
test('both themes remain operational when persistent storage is blocked', () => {
  const h = app({ blockStorage: true }); h.node('theme-toggle').click(); assert.equal(h.document.documentElement.getAttribute('data-theme'), 'light');
  h.node('theme-toggle').click(); assert.equal(h.document.documentElement.getAttribute('data-theme'), 'dark'); assert.equal(h.errors.length, 0);
});
test('a hidden document stops animation without changing the selected mission', () => {
  const h = app(), name = h.node('hero-mission').textContent; h.node('play-button').click(); h.document.hidden = true; h.event(h.document, 'visibilitychange');
  assert.equal(h.node('play-button').getAttribute('aria-pressed'), 'false'); assert.equal(h.node('hero-mission').textContent, name);
});
test('arrival verification clears when moving crosshair or switching launch window', () => {
  const h = app(); h.document.querySelector('[data-mission="earth-mars-rendezvous"]').click();
  h.node('verify-lambert').click();
  assert.match(h.node('lambert-check').textContent, /^Arrival verified:/);
  h.event(hit(h.node('porkchop-svg')), 'keydown', { key: 'ArrowRight' });
  assert.doesNotMatch(h.node('lambert-check').textContent, /^Arrival verified:/);
  h.node('verify-lambert').click();
  assert.match(h.node('lambert-check').textContent, /^Arrival verified:/);
  h.node('window-select').value = 'leo-geo'; h.event(h.node('window-select'), 'change');
  assert.doesNotMatch(h.node('lambert-check').textContent, /^Arrival verified:/);
});
test('energy chart inspection selects nearest actual tSec on adaptive Molniya grid', () => {
  const h = app(); h.document.querySelector('[data-mission="molniya-12h"]').click();
  const svg = h.node('energy-svg'); svg._rect = { width: 760, height: 290, left: 0, top: 0 };
  const plotLeft = 76, plotW = 660;
  h.event(hit(svg), 'mousemove', { clientX: plotLeft + plotW * 0.25, clientY: 100 });
  const tipTitle = h.node('energy-tooltip').textContent;
  const match = tipTitle.match(/\((\d[\d,]*) s\)/);
  assert.ok(match, tipTitle);
  const sec = Number(match[1].replace(/,/g, ''));
  assert.ok(sec > 9000 && sec < 12000, `expected near 10,766 s, got ${sec} s`);
});
test('bi-elliptic second leg joins the first leg at apoapsis (-rb, 0)', () => {
  const h = app(); h.document.querySelector('[data-mission="bi-elliptic-deep-space"]').click();
  const paths = [...h.node('trajectory-svg').querySelectorAll('path[stroke-dasharray]')].map(p => p.getAttribute('d'));
  const leg1 = paths.at(-2), leg2 = paths.at(-1);
  const leg1End = leg1.trim().split(' ').slice(-2).join(' ').replace(/^[ML]/, '');
  const leg2Start = leg2.trim().split(' ').slice(0, 2).join(' ').replace(/^[ML]/, '');
  assert.equal(leg1End, leg2Start);
});

