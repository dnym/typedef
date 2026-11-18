import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStats, record, weakness, median, WINDOW } from '../js/stats.js';

test('median', () => {
  assert.equal(median([]), 0);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('record keeps a plain mean until WINDOW, then a moving average', () => {
  const s = emptyStats();
  record(s, { ch: 'a', prev: null, dt: null, miss: true, wrong: 's' });
  record(s, { ch: 'a', prev: 'x', dt: 100, miss: false });
  record(s, { ch: 'a', prev: 'x', dt: 200, miss: false });
  assert.equal(s.c.a[0], 3);
  assert.ok(Math.abs(s.c.a[2] - 333.33) < 0.1);
  // First timing is taken as is, later ones averaged.
  assert.equal(s.p.xa[0], 2);
  assert.equal(s.p.xa[1], 150);
  assert.deepEqual(s.x.a, { s: 1 });
  for (let i = 0; i < 500; i++) record(s, { ch: 'a', prev: 'x', dt: 100, miss: false });
  assert.ok(s.c.a[2] < 1, 'old errors fade');
  assert.ok(s.c.a[0] > WINDOW);
});

test('weakness: slow pair and error-prone char are weak, typical ones are not', () => {
  const s = emptyStats();
  const feed = (prev, ch, dt, miss = false, n = 20) => {
    for (let i = 0; i < n; i++) record(s, { ch, prev, dt: miss ? null : dt, miss });
  };
  feed('a', 'b', 100);
  feed('b', 'c', 100);
  feed('c', 'd', 100);
  feed('u', 'q', 300);
  feed('x', 'z', 100);
  for (let i = 0; i < 10; i++) record(s, { ch: 'z', prev: 'x', dt: null, miss: true });
  const w = weakness(s, { lambda: 3 });
  assert.ok(w.get('uq') > 1, 'pair three times slower than median');
  assert.ok(!w.has('ab'));
  assert.ok(w.get('z') > 0.5, 'a third of z was wrong');
});

test('weakness explores unseen letters', () => {
  const w = weakness(emptyStats(), { explore: 'qx' });
  assert.ok(w.get('q') > 0 && w.get('x') > 0);
});
