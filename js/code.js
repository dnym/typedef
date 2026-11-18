// Code mode: chunking, auto-indent, comment skipping, chunk picker and the
// symbol drill.

import { weightedPick } from './picker.js';

export const MIN_LINES = 10;
export const MAX_LINES = 25;

// Characters the trainer expects a keyboard to produce. Everything else is
// shown dimmed and passed over.
const TYPABLE = /^[\x20-\x7e\n]$|^[åäöÅÄÖéÉüÜ§½¤£€µ´¨]$/;
export const isTypable = (ch) => TYPABLE.test(ch);

export function normalize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n');
}

// Split a file into chunks of about MIN_LINES to MAX_LINES lines at blank
// lines. Runs of blank lines collapse to one. Returns arrays of lines.
export function chunkText(text, { min = MIN_LINES, max = MAX_LINES } = {}) {
  const lines = normalize(text).split('\n');
  const blocks = [];
  let cur = [];
  for (const l of lines) {
    if (l.trim() === '') {
      if (cur.length) blocks.push(cur);
      cur = [];
    } else cur.push(l);
  }
  if (cur.length) blocks.push(cur);

  const chunks = [];
  let acc = [];
  let count = 0;
  const flush = () => {
    if (acc.length) chunks.push(acc);
    acc = [];
    count = 0;
  };
  for (const b of blocks) {
    if (b.length > max) {
      // Split a long block into even pieces of at most max lines.
      flush();
      const parts = Math.ceil(b.length / max);
      const size = Math.ceil(b.length / parts);
      for (let k = 0; k < b.length; k += size) chunks.push(b.slice(k, k + size));
      continue;
    }
    if (count && count + b.length > max) flush();
    if (acc.length) acc.push('');
    acc.push(...b);
    count += b.length;
    if (count >= min) flush();
  }
  flush();
  return chunks;
}

const HASH = new Set('py sh bash zsh fish rb pl pm r yaml yml toml conf cfg mk cmake nix ps1 jl ex exs tcl dockerfile makefile gitignore'.split(' '));
const SLASH = new Set('c h cpp hpp cc hh cxx cs java js mjs cjs ts tsx jsx go rs swift kt kts scala dart php zig v groovy json5 jsonc proto glsl hlsl sol'.split(' '));
const BLOCK_ONLY = new Set('css'.split(' '));
const SLASH_BLOCK = new Set([...SLASH, 'scss', 'less']);
const DASH = new Set('sql lua hs elm ada'.split(' '));
const SEMI = new Set('lisp clj cljs el scm asm s ini'.split(' '));

export function commentSyntax(name = '') {
  const base = name.toLowerCase().split('/').pop();
  const ext = base.includes('.') ? base.split('.').pop() : base;
  if (HASH.has(ext)) return { line: ['#'], block: null };
  if (SLASH.has(ext) || ext === 'scss' || ext === 'less') return { line: ['//'], block: SLASH_BLOCK.has(ext) ? ['/*', '*/'] : null };
  if (BLOCK_ONLY.has(ext)) return { line: [], block: ['/*', '*/'] };
  if (DASH.has(ext)) return { line: ['--'], block: null };
  if (SEMI.has(ext)) return { line: [';'], block: null };
  if (ext === 'html' || ext === 'xml' || ext === 'svg' || ext === 'md') return { line: [], block: ['<!--', '-->'] };
  return { line: [], block: null };
}

// Mark which characters of each line are inside a comment. Quotes are
// tracked naively (', ", ` with backslash escapes) so "http://x" in a string
// is not a comment.
export function commentMask(lines, syntax) {
  let inBlock = false;
  return lines.map((line) => {
    const mask = new Array(line.length).fill(false);
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      if (inBlock) {
        mask[i] = true;
        if (line.startsWith(syntax.block[1], i)) {
          for (let k = 0; k < syntax.block[1].length; k++) mask[i + k] = true;
          i += syntax.block[1].length - 1;
          inBlock = false;
        }
        continue;
      }
      const ch = line[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (syntax.block && line.startsWith(syntax.block[0], i)) {
        inBlock = true;
        for (let k = 0; k < syntax.block[0].length; k++) mask[i + k] = true;
        i += syntax.block[0].length - 1;
        continue;
      }
      if (syntax.line.some((m) => line.startsWith(m, i))) {
        for (let k = i; k < line.length; k++) mask[k] = true;
        break;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    }
    return mask;
  });
}

// Turn chunk lines into exercise items. Leading whitespace is skipped (the
// cursor jumps there after Enter, as in an editor). With skipComments,
// comment text is skipped, and so is the newline of a line that holds only
// a comment.
export function chunkItems(lines, { name = '', skipComments = false } = {}) {
  const masks = skipComments ? commentMask(lines, commentSyntax(name)) : lines.map((l) => new Array(l.length).fill(false));
  const items = [];
  lines.forEach((line, li) => {
    const mask = masks[li];
    const indent = line.length - line.trimStart().length;
    const body = line.slice(indent);
    const onlyComment = body.length > 0 && mask.slice(indent).every(Boolean);
    // Trailing whitespace before a trailing comment is skipped too.
    let cut = line.length;
    if (skipComments && !onlyComment) {
      const first = mask.indexOf(true, indent);
      if (first >= 0 && mask.slice(first).every(Boolean)) {
        cut = first;
        while (cut > indent && line[cut - 1] === ' ') cut--;
      }
    }
    // Walk by code point so an emoji stays one (skipped) item; i is the
    // UTF-16 offset that the mask and cut use.
    let i = 0;
    for (const raw of line) {
      const ch = raw === '\t' ? ' ' : raw;
      const skip = i < indent || onlyComment || i >= cut || mask[i] || !isTypable(ch);
      items.push({ ch, skip });
      i += raw.length;
    }
    if (li < lines.length - 1) items.push({ ch: '\n', skip: onlyComment });
  });
  // A trailing newline with nothing typable after it is not needed.
  let last = items.length - 1;
  while (last >= 0 && items[last].skip) last--;
  if (last >= 0 && items[last].ch === '\n') items[last].skip = true;
  return items;
}

// All chunks of all files: [{ file, index, lines }]
export function allChunks(files) {
  const out = [];
  for (const f of files) chunkText(f.text).forEach((lines, index) => out.push({ file: f.name, index, lines }));
  return out;
}

// Mean weakness of a chunk's typable characters and pairs.
export function chunkDensity(items, weak) {
  let sum = 0;
  let n = 0;
  let prev = null;
  for (const it of items) {
    if (it.skip) continue;
    sum += (weak.get(it.ch) || 0) + (prev != null ? weak.get(prev + it.ch) || 0 : 0);
    n++;
    prev = it.ch;
  }
  return n ? sum / n : 0;
}

// Pick a chunk, preferring ones dense in weak units; avoids recent keys.
export function pickChunk(chunks, weak, { rng = Math.random, recent = [], skipComments = false } = {}) {
  const entries = [];
  for (const c of chunks) {
    const key = c.file + '#' + c.index;
    if (recent.includes(key) && chunks.length > recent.length) continue;
    const items = chunkItems(c.lines, { name: c.file, skipComments });
    if (!items.some((it) => !it.skip)) continue;
    entries.push([{ chunk: c, key, items }, 0.05 + chunkDensity(items, weak)]);
  }
  // Square the density so dense chunks are clearly preferred.
  return weightedPick(entries.map(([e, w]) => [e, w * w]), rng) || null;
}

// Every distinct trimmed line of the files, for the symbol drill. With
// skipComments, comments are cut from the lines first.
export function drillLines(files, { skipComments = false } = {}) {
  const seen = new Set();
  for (const f of files) {
    const lines = normalize(f.text).split('\n');
    const masks = skipComments ? commentMask(lines, commentSyntax(f.name)) : null;
    lines.forEach((l, i) => {
      if (masks) l = l.split('').filter((_, k) => !masks[i][k]).join('');
      const t = l.trim().replace(/\t/g, ' ');
      if (t.length >= 4 && t.length <= 80 && [...t].every(isTypable)) seen.add(t);
    });
  }
  return [...seen];
}

// Build a drill of up to n real lines, each containing a weak unit. Units
// made only of letters are left to the prose modes; the drill is for the
// symbols that word lists lack.
export function buildDrill(lines, weak, { rng = Math.random, n = 5, recent = [] } = {}) {
  const units = [...weak.entries()].filter(([u]) => /[^\p{L} ]/u.test(u) && !u.includes('\t'));
  const out = [];
  for (let guard = 0; guard < n * 6 && out.length < n; guard++) {
    const u = weightedPick(units, rng);
    if (u == null) break;
    const cands = lines.filter((l) => (u.startsWith('\n') ? l.startsWith(u.slice(1)) : l.includes(u.replace(/\n$/, ''))) && !out.includes(l));
    if (!cands.length) {
      units.splice(units.findIndex(([x]) => x === u), 1);
      if (!units.length) break;
      continue;
    }
    const fresh = cands.filter((l) => !recent.includes(l));
    const pool = fresh.length ? fresh : cands;
    out.push(pool[Math.floor(rng() * pool.length)]);
  }
  // Fill up with random symbol-rich lines if the weak units ran out.
  const rich = lines.filter((l) => /[^\p{L}\p{N} ]/u.test(l) && !out.includes(l));
  while (out.length < n && rich.length) out.push(rich.splice(Math.floor(rng() * rich.length), 1)[0]);
  for (const l of out) {
    recent.push(l);
    while (recent.length > 30) recent.shift();
  }
  return out;
}
