// Run with: node --test server/tests/layout.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../hidagent/static/app.js'), 'utf8');

function page(saved, blocked = false) {
  const button = { textContent: '', attributes: {}, setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(event, fn) { this.click = fn; } };
  const classes = new Set();
  const values = { layout: saved };
  const context = vm.createContext({
    $: () => button, t: (key) => key,
    document: { body: { classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); } } } },
    localStorage: {
      getItem(k) { if (blocked) throw Error('blocked'); return values[k]; },
      setItem(k, v) { if (blocked) throw Error('blocked'); values[k] = v; },
    },
  });
  const start = source.indexOf('// ---- layout ');
  const end = source.indexOf('// ---- motion ', start);
  assert.ok(start >= 0 && end > start, 'layout controller exists');
  vm.runInContext(source.slice(start, end), context);
  return { button, classes, values, context };
}

test('defaults to portrait; switches both ways and persists preference', () => {
  const p = page(null);
  assert.equal(p.classes.has('landscape'), false);
  assert.equal(p.button.attributes['aria-pressed'], 'false');
  p.button.click();
  assert.equal(p.classes.has('landscape'), true);
  assert.equal(p.values.layout, 'landscape');
  assert.equal(p.button.textContent, 'layoutLandscape');
  assert.equal(p.button.attributes['aria-pressed'], 'true');
  p.button.click();
  assert.equal(p.classes.has('landscape'), false);
  assert.equal(p.values.layout, 'portrait');
});

test('restores landscape and tolerates unavailable storage or invalid preferences', () => {
  assert.equal(page('landscape').classes.has('landscape'), true);
  assert.equal(page('invalid').classes.has('landscape'), false);
  const p = page(null, true);
  p.button.click();
  assert.equal(p.classes.has('landscape'), true);
  vm.runInContext('applyLayout()', p.context);
  assert.equal(p.button.textContent, 'layoutLandscape');
});
