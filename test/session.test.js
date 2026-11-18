import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, itemsFromText } from '../js/session.js';

test('blocks on errors and counts a miss once per position', () => {
  const s = new Session(itemsFromText('ab'));
  assert.equal(s.feed('a', 0).ok, true);
  const bad = s.feed('x', 100);
  assert.equal(bad.ok, false);
  assert.equal(s.pos, 1);
  s.feed('y', 150);
  const good = s.feed('b', 200);
  assert.equal(good.ok, true);
  assert.equal(good.done, true);
  assert.deepEqual(good.event, { ch: 'b', prev: 'a', dt: null, miss: true, wrong: 'x' });
  assert.equal(s.typed, 2);
  assert.equal(s.clean, 1);
  assert.equal(s.accuracy, 0.5);
});

test('clean keystrokes carry pair timing; first has none', () => {
  const s = new Session(itemsFromText('abc'));
  assert.equal(s.feed('a', 1000).event.dt, null);
  assert.equal(s.feed('b', 1120).event.dt, 120);
  assert.equal(s.feed('c', 9000).event.dt, null, 'pauses are not timed');
});

test('skipped items are passed over', () => {
  const items = [{ ch: 'a', skip: false }, { ch: '\n', skip: false }, { ch: ' ', skip: true }, { ch: ' ', skip: true }, { ch: 'b', skip: false }];
  const s = new Session(items);
  s.feed('a', 0);
  s.feed('\n', 100);
  assert.equal(s.pos, 4);
  const r = s.feed('b', 200);
  assert.equal(r.event.prev, '\n');
  assert.equal(s.done, true);
  assert.equal(s.total, 3);
});

test('speed from active time', () => {
  const s = new Session(itemsFromText('aaaaaaaaaa'));
  for (let i = 0; i < 10; i++) s.feed('a', i * 120);
  // 10 chars in 1080 ms
  assert.ok(Math.abs(s.wpm - 10 / 5 / (1080 / 60000)) < 1e-9);
});
