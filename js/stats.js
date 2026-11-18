// Moving averages per character and per character pair, and the weakness score.
//
// A unit record is [count, ms, errorsPerThousand]. Both averages are
// exponential with weight 1/min(count, WINDOW), so the first WINDOW samples
// form a plain mean and later ones roughly cover the last WINDOW occurrences.
// ms is 0 until the first clean timing arrives.

export const WINDOW = 50;

export function emptyStats() {
  // c: characters, p: pairs (previous char + this char), x: confusions
  return { c: {}, p: {}, x: {} };
}

function update(map, key, dt, miss) {
  const r = map[key] || (map[key] = [0, 0, 0]);
  r[0] += 1;
  const a = 1 / Math.min(r[0], WINDOW);
  r[2] += a * ((miss ? 1000 : 0) - r[2]);
  if (dt != null) r[1] = r[1] === 0 ? dt : r[1] + a * (dt - r[1]);
}

// ev: { ch, prev, dt, miss, wrong } as produced by Session.feed
export function record(stats, ev) {
  update(stats.c, ev.ch, ev.dt, ev.miss);
  if (ev.prev != null) update(stats.p, ev.prev + ev.ch, ev.dt, ev.miss);
  if (ev.miss && ev.wrong != null && ev.wrong !== ev.ch) {
    const m = stats.x[ev.ch] || (stats.x[ev.ch] = {});
    m[ev.wrong] = (m[ev.wrong] || 0) + 1;
  }
}

export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Returns Map(unit -> weakness), only units with weakness > 0.
//   w(u) = max(0, t_u / t_median - 1) * confidence + lambda * e_u
// Characters are compared with the median character time and pairs with the
// median pair time. Units seen fewer than minN times are left out, except
// letters of `explore`, which get a small score so rare letters get measured.
export function weakness(stats, { lambda = 3, minN = 3, explore = '', exploreScore = 0.4 } = {}) {
  const out = new Map();
  for (const map of [stats.c, stats.p]) {
    const times = Object.values(map).filter((r) => r[0] >= minN && r[1] > 0).map((r) => r[1]);
    const med = median(times);
    for (const [u, r] of Object.entries(map)) {
      if (r[0] < minN) continue;
      const conf = r[0] / (r[0] + 5);
      const slow = med > 0 && r[1] > 0 ? Math.max(0, r[1] / med - 1) * conf : 0;
      const w = slow + lambda * (r[2] / 1000);
      if (w > 0) out.set(u, w);
    }
  }
  for (const ch of explore) {
    const r = stats.c[ch];
    const n = r ? r[0] : 0;
    if (n < 5) out.set(ch, Math.max(out.get(ch) || 0, exploreScore * (1 - n / 5)));
  }
  return out;
}

// The n weakest units, as [unit, weakness] sorted weakest first.
export function weakest(weak, n = 12) {
  return [...weak.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
