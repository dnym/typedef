import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, compact, expand, encodePayload, decodePayload, linkFor, readLinkHash, applyImport, summarize, backupText, parseBackup, relevantPairs, migrate, addHistory } from '../js/store.js';
import { record } from '../js/stats.js';

function sample() {
  const s = defaultState();
  s.layouts.k = { name: 'Mine', kle: [['A']] };
  s.profiles.p1.layout = 'k';
  s.code.files.push({ name: 'a.js', text: 'secret()' });
  const st = s.profiles.p1.stats;
  const letters = 'abcdefghijklmnopqrstuvwxyzåäö';
  for (const a of letters) for (const b of letters) for (let i = 0; i < 3; i++) record(st, { ch: b, prev: a, dt: 100 + ((a.charCodeAt(0) * b.charCodeAt(0)) % 90), miss: i === 0 && a === 'q' });
  for (let d = 1; d <= 90; d++) addHistory(s.profiles.p1, 60000, 300, 290, `2026-${String(1 + Math.floor((d - 1) / 28)).padStart(2, '0')}-${String(1 + ((d - 1) % 28)).padStart(2, '0')}`);
  return s;
}

test('link round trip keeps settings and scores, not layouts or code', async () => {
  const s = sample();
  s.settings.focus = 45;
  const url = await linkFor(s, 'https://x.test/typedef/');
  assert.match(url, /^https:\/\/x\.test\/typedef\/#p=[A-Za-z0-9_-]+$/);
  const back = await readLinkHash(new URL(url).hash);
  assert.equal(back.settings.focus, 45);
  assert.equal(Object.keys(back.profiles.p1.stats.c).length, 29);
  assert.equal(Object.keys(back.profiles.p1.stats.p).length, 400);
  assert.equal(Object.keys(back.profiles.p1.history).length, 60);
  assert.equal(back.profiles.p1.layout, null, 'custom layout id not sent');
  assert.equal(back.layouts, undefined);
  assert.equal(back.code, undefined);
  console.log(`link length for ${Object.keys(s.profiles.p1.stats.p).length} pairs: ${url.length}`);
});

test('relevant pairs keep the weakest', () => {
  const s = sample();
  const kept = new Set(relevantPairs(s.profiles.p1.stats, 50).map(([u]) => u));
  assert.ok(kept.has('qa'), 'error-prone q pairs are kept');
  assert.equal(kept.size, 50);
});

test('payload codec', async () => {
  const obj = { a: 'åäö', n: [1, 2, 3] };
  assert.deepEqual(await decodePayload(await encodePayload(obj)), obj);
  assert.equal(await readLinkHash('#nothing'), null);
  await assert.rejects(readLinkHash('#p=AAAA'));
  assert.throws(() => expand({ v: 99 }));
});

test('import replaces profiles and keeps local layouts and code', async () => {
  const local = sample();
  const remote = defaultState();
  remote.profiles.p1.name = 'Remote';
  remote.settings.mode = 'en';
  const partial = expand(JSON.parse(JSON.stringify(compact(remote))));
  const merged = applyImport(local, partial);
  assert.equal(merged.profiles.p1.name, 'Remote');
  assert.equal(merged.profiles.p1.layout, 'k', 'local layout kept');
  assert.equal(merged.code.files.length, 1);
  assert.equal(merged.settings.mode, 'en');
  assert.equal(summarize(partial).profiles[0].name, 'Remote');
});

test('backup round trip keeps everything', () => {
  const s = sample();
  const back = parseBackup(backupText(s));
  assert.deepEqual(back, migrate(s));
  assert.throws(() => parseBackup('{"v":1}'));
});
