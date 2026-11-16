'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = __dirname;
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '.git') return [];
    const file = path.join(dir, entry.name); return entry.isDirectory() ? files(file) : [file];
  });
}
const paths = files(root);
test('all repository text uses ordinary hyphens and contains no private contact strings', () => {
  for (const file of paths) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/[\u2013\u2014]/u.test(text), path.relative(root, file));
    assert.ok(!/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text), path.relative(root, file));
  }
});
test('repository text has no restricted attribution terms or credential prefixes', () => {
  const words = [[65,73], [76,76,77], [71,80,84], [67,108,97,117,100,101], [79,112,101,110,65,73], [67,104,97,116,71,80,84]].map(v => new RegExp('\\b' + String.fromCharCode(...v) + '\\b', 'i'));
  const prefixes = [[115,107,45], [116,115,107,101,121,45], [103,104,112,95], [65,73,122,97]].map(v => String.fromCharCode(...v));
  for (const file of paths) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!words.some(re => re.test(text)), path.relative(root, file));
    assert.ok(!prefixes.some(prefix => text.includes(prefix)), path.relative(root, file));
  }
});
test('browser entry point has only local dependency files and unique identifiers', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
  for (const [, src] of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
    assert.ok(!/^(?:https?:)?\/\//.test(src)); assert.ok(fs.existsSync(path.join(root, src)), src);
  }
});
