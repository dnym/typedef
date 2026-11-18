import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeContext, buildLine, tokenFor, trigraphs, decorateFor, mulberry32 } from '../js/picker.js';
import sv from '../data/words-sv.js';

const words = ['the', 'quick', 'quit', 'kumquat', 'and', 'brown', 'fox', 'equal', 'squid', 'aqua', 'zebra', 'is', 'a', 'of'];
const ctx = makeContext(words, 'abcdefghijklmnopqrstuvwxyz');

test('index covers characters and boundary pairs', () => {
  assert.deepEqual(ctx.index.get('qu').map((i) => words[i]), ['quick', 'quit', 'kumquat', 'equal', 'squid', 'aqua']);
  assert.deepEqual(ctx.index.get(' q').map((i) => words[i]), ['quick', 'quit']);
  assert.deepEqual(ctx.index.get('x ').map((i) => words[i]), ['fox']);
});

test('a weak pair yields words containing it', () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 20; i++) assert.ok(tokenFor(ctx, 'qu', rng, [], false).includes('qu'));
});

test('a unit in too few words falls back to real trigraphs', () => {
  assert.ok(trigraphs(ctx, 'zb').length === 0);
  assert.deepEqual(trigraphs(ctx, 'eb').map(([t]) => t), ['zeb', 'ebr']);
  const tok = tokenFor(ctx, 'eb', mulberry32(2), [], false);
  assert.ok(['zeb', 'ebr'].includes(tok));
});

test('symbols and capitals come from patterns around real words', () => {
  const rng = mulberry32(3);
  for (const u of ['(', 'Q', 'x,', '[', '4', 'Qu']) {
    const tok = decorateFor(ctx, u, rng);
    assert.ok(tok && tok.includes(u), `${u} -> ${tok}`);
  }
  assert.equal(tokenFor(ctx, '(', rng, [], false), null, 'no symbols when disabled');
});

test('lines target the weak unit at about the focus share', () => {
  const big = makeContext(sv, 'abcdefghijklmnopqrstuvwxyzåäöé');
  const rng = mulberry32(4);
  const weak = new Map([['x', 1]]);
  let withX = 0;
  let total = 0;
  const recent = [];
  for (let i = 0; i < 200; i++) {
    const line = buildLine(big, { weak, focus: 0.3, rng, recent, symbols: false });
    assert.ok(line.length <= 60 || !line.includes(' '));
    for (const w of line.split(' ')) {
      total++;
      if (w.includes('x')) withX++;
    }
  }
  const share = withX / total;
  assert.ok(share > 0.25 && share < 0.4, `share ${share}`);
});

test('no word repeats within the recent window', () => {
  const big = makeContext(sv, 'abcdefghijklmnopqrstuvwxyzåäöé');
  const rng = mulberry32(5);
  const recent = [];
  const all = [];
  for (let i = 0; i < 30; i++) all.push(...buildLine(big, { rng, recent, symbols: false, focus: 0 }).split(' '));
  let repeats = 0;
  all.forEach((w, i) => {
    if (all.slice(Math.max(0, i - 30), i).includes(w)) repeats++;
  });
  assert.ok(repeats <= 2, `repeats ${repeats}`);
});

test('never emits repeated-key strings', () => {
  const rng = mulberry32(6);
  const weak = new Map([['q', 5], ['zz', 5]]);
  for (let i = 0; i < 50; i++) assert.doesNotMatch(buildLine(ctx, { weak, focus: 1, rng, symbols: false }), /(.)\1\1/);
});
