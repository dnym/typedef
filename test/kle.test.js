import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKLE, parseKLEText, findKey, cleanLegend, renderSVG, keyChars } from '../js/kle.js';

// A made-up board: one row with an ISO Enter, a stepped row, and a rotated
// thumb cluster with a negative offset.
const BOARD = [
  { name: 'Test' },
  ['!\n1', '"\n2\n\n@', { w: 1.5 }, 'Tab', { x: 0.25, w: 1.25, h: 2, w2: 1.5, h2: 1, x2: -0.25 }, 'Enter'],
  [{ a: 5 }, 'A', 'S\n{', { w: 6 }, ''],
  [{ r: 15, rx: 5, ry: 4, y: -0.5, x: 1 }, 'Ctrl', 'Back<br>Space'],
  [{ x: 0.5 }, "<i class='fa fa-arrow-up'></i>"],
];

test('positions, sizes and ISO Enter', () => {
  const { meta, keys } = parseKLE(BOARD);
  assert.equal(meta.name, 'Test');
  assert.deepEqual([keys[0].x, keys[0].y], [0, 0]);
  assert.deepEqual([keys[2].x, keys[2].w], [2, 1.5]);
  const enter = keys[3];
  assert.deepEqual([enter.x, enter.w, enter.h, enter.x2, enter.w2, enter.h2], [3.75, 1.25, 2, -0.25, 1.5, 1]);
  assert.deepEqual([keys[4].x, keys[4].y], [0, 1]);
  assert.equal(keys[6].w, 6);
});

test('legend slots follow alignment', () => {
  const { keys } = parseKLE(BOARD);
  // Default alignment 4: second line goes to bottom-left (slot 6), fourth to bottom-right (8).
  assert.equal(keys[1].legends[0], '"');
  assert.equal(keys[1].legends[6], '2');
  assert.equal(keys[1].legends[8], '@');
  // Alignment 5 centres horizontally: top-centre (1) and bottom-centre (7).
  assert.equal(keys[5].legends[1], 'S');
  assert.equal(keys[5].legends[7], '{');
});

test('rotation clusters and negative offsets', () => {
  const { keys } = parseKLE(BOARD);
  const [ctrl, bs, up] = keys.slice(7);
  assert.deepEqual([ctrl.r, ctrl.rx, ctrl.ry, ctrl.x, ctrl.y], [15, 5, 4, 6, 3.5]);
  assert.deepEqual([bs.x, bs.y], [7, 3.5]);
  assert.equal(bs.legends[1], 'Back Space');
  // Next row restarts at the rotation origin x.
  assert.deepEqual([up.x, up.y, up.r], [5.5, 4.5, 15]);
  assert.equal(up.legends[0], '');
});

test('cleanLegend strips HTML', () => {
  assert.equal(cleanLegend("F1 <i class='x'></i>"), 'F1');
  assert.equal(cleanLegend('Caps<br>Lock'), 'Caps Lock');
  assert.equal(cleanLegend('&lt;'), '<');
});

test('findKey: legends, case, space, enter, learned codes', () => {
  const { keys } = parseKLE(BOARD);
  assert.equal(findKey(keys, 'a'), 4);
  assert.equal(findKey(keys, '@'), 1);
  assert.equal(findKey(keys, '{'), 5);
  assert.equal(findKey(keys, ' '), 6);
  assert.equal(findKey(keys, '\n'), 3);
  assert.equal(findKey(keys, 'å'), -1);
  // å typed with the key that is "1" on a US board.
  assert.equal(findKey(keys, 'å', { å: 'Digit1' }), 0);
});

test('findKey prefers the key a character was typed on', () => {
  const { keys } = parseKLE([['Q\n/', 'W'], ['/'], ['-\n/']]);
  assert.equal(findKey(keys, '/'), 0, 'more typing legends wins by default');
  // Swedish layouts send Slash from the - key.
  assert.equal(findKey(keys, '/', { '/': 'Slash' }), 3);
  assert.equal(findKey(keys, '/', { '/': 'KeyQ' }), 0);
});

test('built-in layouts parse and render', () => {
  for (const f of ['iso-sv', 'ansi-us']) {
    const layout = parseKLE(readFileSync(new URL(`../data/layouts/${f}.json`, import.meta.url), 'utf8'));
    assert.ok(layout.keys.length >= 58, f);
    const svg = renderSVG(layout);
    assert.match(svg, /^<svg/);
    for (const ch of 'abcxyz ,.\n') assert.ok(findKey(layout.keys, ch) >= 0, `${f} ${JSON.stringify(ch)}`);
  }
  const sv = parseKLE(readFileSync(new URL('../data/layouts/iso-sv.json', import.meta.url), 'utf8'));
  for (const ch of 'åäö{}[]@$\\~') assert.ok(findKey(sv.keys, ch) >= 0, ch);
  assert.ok(keyChars(sv.keys[findKey(sv.keys, 'å')]).includes('å'));
});

test('parseKLEText reads files and the site raw data', () => {
  assert.deepEqual(parseKLEText('[["A"]]'), [['A']]);
  assert.deepEqual(parseKLEText('["Esc",{x:1},"F1"],\n[{w:1.5},"Tab"]'), [['Esc', { x: 1 }, 'F1'], [{ w: 1.5 }, 'Tab']]);
  assert.deepEqual(parseKLEText('{name:"x"},\n["A"]'), [{ name: 'x' }, ['A']]);
  assert.throws(() => parseKLEText('hello'));
});
