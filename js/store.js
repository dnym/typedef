// localStorage, link export and import, and the backup file.
//
// The link carries settings, per-character scores, the most relevant pairs
// and recent history, deflated and base64url-encoded in the URL fragment
// (#p=...), which browsers never send to the server. Layouts and code files
// stay out of the link.

import { emptyStats, weakness } from './stats.js';

export const STORAGE_KEY = 'typedef';
export const VERSION = 1;
export const LINK_PAIRS = 400;
export const LINK_DAYS = 60;

export const DEFAULT_SETTINGS = {
  mode: 'sv', // sv | en | code | drill
  focus: 30, // percent of targeted words
  lambda: 3,
  symbols: true,
  skipComments: false,
  showKeyboard: true,
  hint: true,
  heatmap: false,
};

export function newProfile(name = 'Default', layout = 'iso-sv') {
  return { name, layout, stats: emptyStats(), codes: {}, history: {} };
}

export function defaultState() {
  return {
    v: VERSION,
    settings: { ...DEFAULT_SETTINGS },
    active: 'p1',
    profiles: { p1: newProfile() },
    layouts: {}, // id -> { name, kle }
    code: { files: [] }, // { name, text }
  };
}

// Fill in anything missing, so older saves and partial imports keep working.
export function migrate(state) {
  const base = defaultState();
  if (!state || typeof state !== 'object') return base;
  const out = { ...base, ...state, v: VERSION };
  out.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  out.layouts = state.layouts || {};
  out.code = { files: (state.code && state.code.files) || [] };
  out.profiles = {};
  for (const [id, p] of Object.entries(state.profiles || {})) {
    out.profiles[id] = { ...newProfile(), ...p, stats: { ...emptyStats(), ...(p.stats || {}) }, codes: p.codes || {}, history: p.history || {} };
  }
  if (!Object.keys(out.profiles).length) out.profiles = base.profiles;
  if (!out.profiles[out.active]) out.active = Object.keys(out.profiles)[0];
  return out;
}

export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    return migrate(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultState();
  }
}

// Returns null on success, or the error (usually a full quota).
export function save(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return null;
  } catch (e) {
    return e;
  }
}

export function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// history[day] = [activeMs, typed, clean]
export function addHistory(profile, ms, typed, clean, day = today()) {
  const h = profile.history[day] || (profile.history[day] = [0, 0, 0]);
  h[0] += Math.round(ms);
  h[1] += typed;
  h[2] += clean;
}

// ---- link codec ----

const r1 = (x) => Math.round(x);

// The pairs worth keeping in a link: the weakest 100, then the most seen.
export function relevantPairs(stats, n = LINK_PAIRS) {
  const entries = Object.entries(stats.p);
  if (entries.length <= n) return entries;
  const weak = weakness({ c: {}, p: stats.p, x: {} });
  const byWeak = entries.filter(([u]) => weak.has(u)).sort((a, b) => weak.get(b[0]) - weak.get(a[0])).slice(0, Math.min(100, n));
  const keep = new Set(byWeak.map(([u]) => u));
  const bySeen = entries.filter(([u]) => !keep.has(u)).sort((a, b) => b[1][0] - a[1][0]);
  return [...byWeak, ...bySeen.slice(0, n - byWeak.length)];
}

export function compact(state) {
  const P = {};
  for (const [id, p] of Object.entries(state.profiles)) {
    const days = Object.keys(p.history).sort().slice(-LINK_DAYS);
    P[id] = {
      n: p.name,
      l: state.layouts[p.layout] ? null : p.layout,
      c: Object.entries(p.stats.c).map(([u, r]) => [u, r1(r[0]), r1(r[1]), r1(r[2])]),
      p: relevantPairs(p.stats).map(([u, r]) => [u, r1(r[0]), r1(r[1]), r1(r[2])]),
      h: days.map((d) => [d, ...p.history[d]]),
    };
  }
  return { v: VERSION, s: state.settings, a: state.active, P };
}

export function expand(c) {
  if (!c || typeof c !== 'object' || typeof c.v !== 'number') throw new Error('Not a Typedef link.');
  if (c.v > VERSION) throw new Error('This link comes from a newer version of Typedef.');
  const profiles = {};
  for (const [id, p] of Object.entries(c.P || {})) {
    const stats = emptyStats();
    for (const [u, n, ms, e] of p.c || []) stats.c[u] = [n, ms, e];
    for (const [u, n, ms, e] of p.p || []) stats.p[u] = [n, ms, e];
    const history = {};
    for (const [d, ms, t, k] of p.h || []) history[d] = [ms, t, k];
    profiles[id] = { name: p.n || id, layout: p.l || null, stats, codes: {}, history };
  }
  return { settings: { ...DEFAULT_SETTINGS, ...(c.s || {}) }, active: c.a, profiles };
}

function toBase64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str) {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodePayload(obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  return toBase64url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodePayload(str) {
  const bytes = await pipe(fromBase64url(str), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function linkFor(state, base) {
  return `${base}#p=${await encodePayload(compact(state))}`;
}

// Reads #p=... from a hash string. Returns the expanded partial state or null.
export async function readLinkHash(hash) {
  const m = /^#?p=([A-Za-z0-9_-]+)/.exec(hash || '');
  if (!m) return null;
  return expand(await decodePayload(m[1]));
}

// What an import contains, for the confirmation dialog.
export function summarize(partial) {
  const profiles = Object.values(partial.profiles || {}).map((p) => {
    const days = Object.keys(p.history || {});
    const minutes = Object.values(p.history || {}).reduce((s, h) => s + h[0], 0) / 60000;
    return {
      name: p.name,
      chars: Object.keys(p.stats.c).length,
      pairs: Object.keys(p.stats.p).length,
      days: days.length,
      minutes: Math.round(minutes),
      last: days.sort().pop() || null,
    };
  });
  return {
    profiles,
    layouts: Object.keys(partial.layouts || {}).length,
    files: ((partial.code && partial.code.files) || []).length,
  };
}

// Replace local data with an import. A backup replaces everything. A link
// leaves layouts and code files alone, and a profile that exists locally
// keeps its local layout.
export function applyImport(state, partial) {
  const out = migrate({ ...state });
  if (partial.settings) out.settings = { ...DEFAULT_SETTINGS, ...partial.settings };
  if (partial.layouts) out.layouts = partial.layouts;
  if (partial.code) out.code = partial.code;
  if (partial.profiles) {
    const profiles = {};
    for (const [id, p] of Object.entries(partial.profiles)) {
      const local = state.profiles[id];
      const layout = (partial.layouts ? p.layout : local && local.layout) || p.layout || 'iso-sv';
      profiles[id] = { ...newProfile(p.name, layout), ...p, layout, codes: { ...((local && local.codes) || {}), ...(p.codes || {}) } };
    }
    out.profiles = profiles;
  }
  if (partial.active && out.profiles[partial.active]) out.active = partial.active;
  return migrate(out);
}

// ---- backup file ----

export function backupText(state) {
  return JSON.stringify({ typedef: 'backup', ...state }, null, 1);
}

export function parseBackup(text) {
  const obj = JSON.parse(text);
  if (!obj || obj.typedef !== 'backup') throw new Error('Not a Typedef backup file.');
  delete obj.typedef;
  if (obj.v > VERSION) throw new Error('This backup comes from a newer version of Typedef.');
  return migrate(obj);
}
