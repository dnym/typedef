// keyboard-layout-editor (KLE) parser and SVG keyboard with hint and heatmap.
//
// A KLE file describes geometry and legend text only. The keyboard is a
// picture: correctness never depends on it. Legend slots follow KLE's
// 12-position order: 0-8 is a 3x3 grid on the key top (row by row) and 9-11
// is the front face.

const LABEL_MAP = [
  [0, 6, 2, 8, 9, 11, 3, 5, 1, 4, 7, 10],
  [1, 7, -1, -1, 9, 11, 4, -1, -1, -1, -1, 10],
  [3, -1, 5, -1, 9, 11, -1, -1, 4, -1, -1, 10],
  [4, -1, -1, -1, 9, 11, -1, -1, -1, -1, -1, 10],
  [0, 6, 2, 8, 10, -1, 3, 5, 1, 4, 7, -1],
  [1, 7, -1, -1, 10, -1, 4, -1, -1, -1, -1, -1],
  [3, -1, 5, -1, 10, -1, -1, -1, 4, -1, -1, -1],
  [4, -1, -1, -1, 10, -1, -1, -1, -1, -1, -1, -1],
];

// Legend text without HTML. <br> becomes a space; icon tags disappear.
export function cleanLegend(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// Accepts a downloaded KLE .json file or the site's "Raw data" text, which
// has unquoted keys and may lack the outer brackets.
export function parseKLEText(text) {
  const raw = text.trim();
  const attempts = [raw, `[${raw}]`];
  const quoted = raw.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  attempts.push(quoted, `[${quoted}]`);
  for (const a of attempts) {
    try {
      const data = JSON.parse(a);
      if (Array.isArray(data) && data.some(Array.isArray)) return data;
    } catch {
      // try the next form
    }
  }
  throw new Error('Not keyboard-layout-editor JSON.');
}

export function parseKLE(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(data)) throw new Error('A KLE layout is a JSON array of rows.');
  const meta = {};
  const keys = [];
  const cur = { x: 0, y: 0, w: 1, h: 1, x2: 0, y2: 0, w2: 0, h2: 0, r: 0, rx: 0, ry: 0, a: 4, c: '#cccccc', t: '#000000', ghost: false, decal: false };
  const cluster = { x: 0, y: 0 };
  data.forEach((row, ri) => {
    if (!Array.isArray(row)) {
      if (ri === 0 && row && typeof row === 'object') Object.assign(meta, row);
      return;
    }
    row.forEach((item, ki) => {
      if (typeof item === 'string') {
        const labels = new Array(12).fill('');
        const map = LABEL_MAP[cur.a] || LABEL_MAP[4];
        item.split('\n').forEach((text, i) => {
          if (i < 12 && map[i] >= 0) labels[map[i]] = text;
        });
        keys.push({
          x: cur.x, y: cur.y, w: cur.w, h: cur.h,
          x2: cur.x2, y2: cur.y2, w2: cur.w2 || cur.w, h2: cur.h2 || cur.h,
          r: cur.r, rx: cur.rx, ry: cur.ry,
          color: cur.c, text: cur.t.split('\n')[0] || '#000000',
          ghost: cur.ghost, decal: cur.decal,
          labels, legends: labels.map(cleanLegend),
        });
        cur.x += cur.w;
        cur.w = cur.h = 1;
        cur.x2 = cur.y2 = cur.w2 = cur.h2 = 0;
        cur.decal = cur.ghost = false;
        return;
      }
      if (!item || typeof item !== 'object') return;
      if (item.r != null) {
        if (ki !== 0) throw new Error('Rotation can only be set at the start of a row.');
        cur.r = item.r;
      }
      if (item.rx != null) {
        cur.rx = cluster.x = item.rx;
        cur.x = cluster.x;
        cur.y = cluster.y;
      }
      if (item.ry != null) {
        cur.ry = cluster.y = item.ry;
        cur.x = cluster.x;
        cur.y = cluster.y;
      }
      if (item.a != null) cur.a = item.a;
      if (item.c != null) cur.c = item.c;
      if (item.t != null) cur.t = item.t;
      if (item.x != null) cur.x += item.x;
      if (item.y != null) cur.y += item.y;
      if (item.w != null) cur.w = cur.w2 = item.w;
      if (item.h != null) cur.h = cur.h2 = item.h;
      if (item.x2 != null) cur.x2 = item.x2;
      if (item.y2 != null) cur.y2 = item.y2;
      if (item.w2 != null) cur.w2 = item.w2;
      if (item.h2 != null) cur.h2 = item.h2;
      if (item.g != null) cur.ghost = item.g;
      if (item.d != null) cur.decal = item.d;
    });
    cur.y += 1;
    cur.x = cur.rx;
  });
  return { meta, keys: keys.filter((k) => !k.decal) };
}

// Base legends that KeyboardEvent.code values carry on US and Swedish
// boards, used to place characters whose legend is missing from a file.
const CODE_LEGENDS = {
  Backquote: ['`', '§', '~', '½'], Minus: ['-', '+', '_', '?'], Equal: ['=', '´', '+', '`'],
  BracketLeft: ['[', 'å', '{'], BracketRight: [']', '¨', '}', '^'], Backslash: ['\\', "'", '|', '*'],
  Semicolon: [';', 'ö', ':'], Quote: ["'", 'ä', '"'], Comma: [',', '<', ';'], Period: ['.', '>', ':'],
  Slash: ['/', '-', '?', '_'], IntlBackslash: ['<', '>', '|'], Space: [' '], Enter: ['\n'],
};
for (let i = 0; i < 26; i++) CODE_LEGENDS['Key' + String.fromCharCode(65 + i)] = [String.fromCharCode(97 + i)];
for (let i = 0; i < 10; i++) CODE_LEGENDS['Digit' + i] = [String(i)];

const ENTER = /^(enter|return|⏎|↵|↩|⌤)$/i;

function legendMatches(legend, ch) {
  if (!legend) return false;
  if (ch === '\n') return ENTER.test(legend);
  if (legend === ch) return true;
  return [...legend].length === 1 && legend.toLowerCase() === ch.toLowerCase();
}

function isSpaceBar(k) {
  if (k.legends.some((l) => /^space( ?bar)?$/i.test(l))) return true;
  return k.w >= 3.5 && k.legends.every((l) => l === '');
}

const keysShowing = (keys, ch) =>
  ch === ' ' ? keys.flatMap((k, i) => (isSpaceBar(k) ? [i] : [])) : keys.flatMap((k, i) => (k.legends.some((l) => legendMatches(l, ch)) ? [i] : []));

const typingLegends = (k) => k.legends.filter((l) => [...l].length === 1).length;

// Legends on the key top beat legends on the front face (often a keypad
// layer), then more single-character legends beat fewer.
const rank = (k, ch) => (k.legends.slice(0, 9).some((l) => legendMatches(l, ch)) || isSpaceBar(k) ? 100 : 0) + typingLegends(k);

// Index of the key for ch, or -1. `codes` maps characters to the
// KeyboardEvent.code they were last typed with. When several keys show ch
// (a symbol layer printed on letter keys, or a numpad), the learned code
// decides; otherwise the key with the most single-character legends wins,
// which prefers typing keys over the numpad. When no key shows ch, the
// learned code finds the key by its usual base legend.
export function findKey(keys, ch, codes = {}) {
  if (ch == null) return -1;
  const alts = (codes[ch] && CODE_LEGENDS[codes[ch]]) || [];
  const others = alts.filter((alt) => alt !== ch);
  const byCode = new Set(others.flatMap((alt) => keysShowing(keys, alt)));
  const cands = keysShowing(keys, ch);
  if (cands.length) {
    const hit = cands.find((i) => byCode.has(i));
    if (hit != null) return hit;
    return cands.reduce((best, i) => (rank(keys[i], ch) > rank(keys[best], ch) ? i : best), cands[0]);
  }
  for (const alt of alts) {
    const found = keysShowing(keys, alt);
    if (found.length) return found.reduce((best, i) => (rank(keys[i], alt) > rank(keys[best], alt) ? i : best), found[0]);
  }
  return -1;
}

// Single characters printed on a key, lowercased, for the heatmap.
export function keyChars(k) {
  const set = new Set();
  for (const l of k.legends) if ([...l].length === 1) set.add(l.toLowerCase());
  if (isSpaceBar(k)) set.add(' ');
  return [...set];
}

const U = 54; // pixels per key unit
const PAD = 4;

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Bounding box of all keys after rotation, in key units.
function bounds(keys) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const k of keys) {
    const rad = (k.r * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const corners = [
      [k.x, k.y], [k.x + k.w, k.y], [k.x, k.y + k.h], [k.x + k.w, k.y + k.h],
      [k.x + k.x2, k.y + k.y2], [k.x + k.x2 + k.w2, k.y + k.y2 + k.h2],
    ];
    for (const [px, py] of corners) {
      const dx = px - k.rx;
      const dy = py - k.ry;
      const X = k.rx + dx * cos - dy * sin;
      const Y = k.ry + dx * sin + dy * cos;
      minX = Math.min(minX, X);
      minY = Math.min(minY, Y);
      maxX = Math.max(maxX, X);
      maxY = Math.max(maxY, Y);
    }
  }
  return keys.length ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
}

const SLOT_POS = [
  [0, 0, 'start'], [0.5, 0, 'middle'], [1, 0, 'end'],
  [0, 0.5, 'start'], [0.5, 0.5, 'middle'], [1, 0.5, 'end'],
  [0, 1, 'start'], [0.5, 1, 'middle'], [1, 1, 'end'],
];

// SVG markup for the board. Each key is a <g class="key" data-i="n">.
export function renderSVG(layout) {
  const { keys } = layout;
  const b = bounds(keys);
  const vw = (b.maxX - b.minX) * U + PAD * 2;
  const vh = (b.maxY - b.minY) * U + PAD * 2;
  const ox = -b.minX * U + PAD;
  const oy = -b.minY * U + PAD;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw.toFixed(1)} ${vh.toFixed(1)}" class="kbd" role="img" aria-label="Keyboard">`];
  keys.forEach((k, i) => {
    if (k.ghost) return;
    const tr = k.r ? ` transform="rotate(${k.r} ${(k.rx * U + ox).toFixed(1)} ${(k.ry * U + oy).toFixed(1)})"` : '';
    const x = k.x * U + ox;
    const y = k.y * U + oy;
    const g = 2;
    const rect = (rx, ry, rw, rh) => `<rect class="cap" x="${(rx + g).toFixed(1)}" y="${(ry + g).toFixed(1)}" width="${(rw - g * 2).toFixed(1)}" height="${(rh - g * 2).toFixed(1)}" rx="5"/>`;
    let shapes = rect(x, y, k.w * U, k.h * U);
    const stepped = k.x2 !== 0 || k.y2 !== 0 || k.w2 !== k.w || k.h2 !== k.h;
    if (stepped) {
      // Two outlined rectangles, then both fills again without outline so
      // the seams inside the union disappear (ISO Enter, stepped keys).
      const r2 = [x + k.x2 * U, y + k.y2 * U, k.w2 * U, k.h2 * U];
      const fill = (rx, ry, rw, rh) => `<rect class="cap capfill" x="${(rx + g + 1).toFixed(1)}" y="${(ry + g + 1).toFixed(1)}" width="${(rw - g * 2 - 2).toFixed(1)}" height="${(rh - g * 2 - 2).toFixed(1)}" rx="4"/>`;
      shapes = rect(...r2) + shapes + fill(...r2) + fill(x, y, k.w * U, k.h * U);
    }
    // Legends sit inside the main rectangle, or the union for stepped keys.
    const lx = stepped ? Math.min(k.x, k.x + k.x2) * U + ox : x;
    const ly = stepped ? Math.min(k.y, k.y + k.y2) * U + oy : y;
    const lw = stepped ? (Math.max(k.x + k.w, k.x + k.x2 + k.w2) - Math.min(k.x, k.x + k.x2)) * U : k.w * U;
    const lh = stepped ? (Math.max(k.y + k.h, k.y + k.y2 + k.h2) - Math.min(k.y, k.y + k.y2)) * U : k.h * U;
    const m = 8;
    let text = '';
    k.legends.forEach((l, s) => {
      if (!l) return;
      let tx;
      let ty;
      let anchor;
      let cls = 'lg';
      if (s < 9) {
        const [fx, fy, a] = SLOT_POS[s];
        tx = lx + m + fx * (lw - m * 2);
        ty = ly + m + 4 + fy * (lh - m * 2 - 6);
        anchor = a;
      } else {
        const fx = (s - 9) / 2;
        tx = lx + m + fx * (lw - m * 2);
        ty = ly + lh - 4;
        anchor = ['start', 'middle', 'end'][s - 9];
        cls = 'lg front';
      }
      const n = [...l].length;
      const long = n > 2;
      // Squeeze legends wider than the key (monospace, ~0.6em per glyph).
      const small = long || cls !== 'lg';
      const avail = lw - m * 2 + 4;
      const fit = n * (small ? 9 : 13) * 0.6 > avail ? ` textLength="${avail.toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : '';
      text += `<text class="${cls}${long ? ' small' : ''}" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle"${fit}>${esc(l)}</text>`;
    });
    parts.push(`<g class="key" data-i="${i}"${tr}>${shapes}${text}</g>`);
  });
  parts.push('</svg>');
  return parts.join('');
}
