// Builds practice lines from real words, biased toward weak units.
//
// The index maps every character and every character pair (including the
// space before and after a word, so " q" means "starts with q") to the words
// that contain it. A weak unit is looked up directly instead of hoping that a
// random sample contains it, which matters for rare letters.

export const RECENT = 30;
export const MIN_WORDS = 3;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const freqWeight = (rank) => 1 / (rank + 30);

// entries: array of [item, weight]
export function weightedPick(entries, rng) {
  let total = 0;
  for (const [, w] of entries) total += w;
  if (!(total > 0)) return entries.length ? entries[Math.floor(rng() * entries.length)][0] : undefined;
  let x = rng() * total;
  for (const [item, w] of entries) {
    x -= w;
    if (x < 0) return item;
  }
  return entries[entries.length - 1][0];
}

export function buildIndex(words) {
  const index = new Map();
  const add = (u, i) => {
    let list = index.get(u);
    if (!list) index.set(u, (list = []));
    if (list[list.length - 1] !== i) list.push(i);
  };
  words.forEach((w, i) => {
    const chars = [...w];
    for (const ch of chars) add(ch, i);
    const padded = [' ', ...chars, ' '];
    for (let k = 1; k < padded.length; k++) add(padded[k - 1] + padded[k], i);
  });
  return index;
}

// Shared context for one word list.
export function makeContext(words, alphabet) {
  const cum = new Float64Array(words.length);
  let s = 0;
  words.forEach((_, i) => (cum[i] = s += freqWeight(i)));
  return { words, wordSet: new Set(words), alphabet, index: buildIndex(words), cum, trigraphCache: new Map() };
}

function pickByFrequency(ctx, rng) {
  const x = rng() * ctx.cum[ctx.cum.length - 1];
  let lo = 0;
  let hi = ctx.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.cum[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return ctx.words[lo];
}

function pickFromList(ctx, list, rng, recent) {
  const fresh = list.filter((i) => !recent.includes(ctx.words[i]));
  const use = fresh.length ? fresh : list;
  return ctx.words[weightedPick(use.map((i) => [i, freqWeight(i)]), rng)];
}

// Real three-letter sequences containing u, weighted by word frequency.
export function trigraphs(ctx, u) {
  if (ctx.trigraphCache.has(u)) return ctx.trigraphCache.get(u);
  const score = new Map();
  ctx.words.forEach((w, i) => {
    const chars = [...w];
    for (let k = 0; k + 3 <= chars.length; k++) {
      const t = chars.slice(k, k + 3).join('');
      if (t.includes(u)) score.set(t, (score.get(t) || 0) + freqWeight(i));
    }
  });
  const list = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  ctx.trigraphCache.set(u, list);
  return list;
}

const num = (rng) => String(Math.floor(rng() * (rng() < 0.6 ? 100 : 10000)));
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// Patterns taken from real text and code. Each gets (word, rng, word2).
export const PATTERNS = [
  (w) => w + ',',
  (w) => w + '.',
  (w) => w + ':',
  (w) => w + ';',
  (w) => w + '!',
  (w) => w + '?',
  (w) => w + '...',
  (w) => '(' + w + ')',
  (w) => '"' + w + '"',
  (w) => "'" + w + "'",
  (w) => '`' + w + '`',
  (w) => '[' + w + ']',
  (w) => '{' + w + '}',
  (w) => '<' + w + '>',
  (w) => '*' + w + '*',
  (w) => '#' + w,
  (w) => '@' + w,
  (w) => '_' + w,
  (w) => '~/' + w,
  (w, r) => w + ': ' + num(r),
  (w, r) => w + '=' + num(r),
  (w, r) => w + '[' + num(r) + ']',
  (w, r) => w + '^' + num(r),
  (w, r) => num(r),
  (w, r) => num(r) + '%',
  (w, r) => '$' + num(r),
  (w, r) => num(r) + '.' + num(r),
  (w, r, w2) => w + '-' + w2,
  (w, r, w2) => w + '/' + w2,
  (w, r, w2) => w + '_' + w2,
  (w, r, w2) => w + '\\' + w2,
  (w, r, w2) => w + '|' + w2,
  (w, r, w2) => w + '&' + w2,
  (w, r, w2) => w + '+' + w2,
  (w, r, w2) => w + '.' + w2 + '()',
];

export function decorate(w, rng, w2) {
  if (rng() < 0.4) return cap(w);
  const p = PATTERNS[Math.floor(rng() * PATTERNS.length)];
  const out = p(w, rng, w2);
  return rng() < 0.25 ? cap(out) : out;
}

// A token from a real word plus a pattern, chosen so that it contains u.
export function decorateFor(ctx, u, rng, recent = []) {
  const lower = u.toLowerCase();
  const letters = [...lower].filter((c) => ctx.alphabet.includes(c));
  const pools = [];
  if (letters.length) {
    const key = letters.join('');
    for (const k of [key, ' ' + letters[0], letters[letters.length - 1] + ' ']) {
      const list = ctx.index.get(k);
      if (list) pools.push(list);
    }
  }
  const sample = [];
  for (const pool of pools) for (let k = 0; k < 15; k++) sample.push(pickFromList(ctx, pool, rng, recent));
  if (!pools.length) for (let k = 0; k < 15; k++) sample.push(pickByFrequency(ctx, rng));
  const found = [];
  for (const w of sample) {
    const w2 = pickByFrequency(ctx, rng);
    for (const p of PATTERNS) {
      for (const c of [false, true]) {
        const out = p(c ? cap(w) : w, rng, w2);
        if (out.includes(u)) found.push(out);
      }
    }
    if (cap(w).includes(u)) found.push(cap(w));
  }
  return found.length ? found[Math.floor(rng() * found.length)] : null;
}

function isPlain(ctx, u) {
  return [...u].every((c) => c === ' ' || ctx.alphabet.includes(c)) && u.trim() !== '';
}

// Units the prose builder can serve, from a weakness map.
export function targetable(ctx, weak, symbols) {
  const out = [];
  for (const [u, w] of weak) {
    if (u.includes('\n') || u.includes('\t') || u.trim() === '') continue;
    if (u.includes('  ')) continue;
    if (isPlain(ctx, u) || symbols) out.push([u, w]);
  }
  return out;
}

// One targeted token for unit u, or null when nothing real contains it.
export function tokenFor(ctx, u, rng, recent, symbols) {
  if (isPlain(ctx, u)) {
    const list = ctx.index.get(u);
    if (list && (list.length >= MIN_WORDS || u.includes(' '))) return pickFromList(ctx, list, rng, recent);
    const tri = trigraphs(ctx, u.replace(/ /g, ''));
    if (tri.length) return weightedPick(tri, rng);
    if (list && list.length) return pickFromList(ctx, list, rng, recent);
    return null;
  }
  return symbols ? decorateFor(ctx, u, rng, recent) : null;
}

// Build one line of about maxLen characters.
//   focus: share of words that are targeted (0..1)
//   symbolRate: share of other words that get a random pattern (when symbols)
export function buildLine(ctx, { weak = new Map(), focus = 0.3, rng = Math.random, recent = [], maxLen = 60, symbols = true, symbolRate = 0.1 } = {}) {
  const units = targetable(ctx, weak, symbols);
  const tokens = [];
  let len = 0;
  for (let guard = 0; guard < 200; guard++) {
    let tok = null;
    let base = null;
    if (units.length && rng() < focus) {
      for (let tries = 0; tries < 4 && tok == null; tries++) {
        const u = weightedPick(units, rng);
        tok = tokenFor(ctx, u, rng, recent, symbols);
      }
    }
    if (tok == null) {
      base = pickByFrequency(ctx, rng);
      for (let k = 0; k < 10 && recent.includes(base); k++) base = pickByFrequency(ctx, rng);
      tok = symbols && rng() < symbolRate ? decorate(base, rng, pickByFrequency(ctx, rng)) : base;
    } else if (ctx.wordSet.has(tok)) {
      base = tok;
    }
    if (tokens.length && len + 1 + tok.length > maxLen) break;
    tokens.push(tok);
    len += (tokens.length > 1 ? 1 : 0) + tok.length;
    if (base) {
      recent.push(base);
      while (recent.length > RECENT) recent.shift();
    }
    if (len >= maxLen) break;
  }
  return tokens.join(' ');
}
