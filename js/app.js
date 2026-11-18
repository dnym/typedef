// Wires the modules to the page.
//
// A keystroke flows input -> session -> stats; picker reads stats to build
// the next line; kle reads stats to colour the board; store saves after each
// exercise.

import { attachInput } from './input.js';
import { Session, itemsFromText } from './session.js';
import { record, weakness, weakest } from './stats.js';
import { makeContext, buildLine } from './picker.js';
import { allChunks, pickChunk, drillLines, buildDrill, chunkText } from './code.js';
import { parseKLE, parseKLEText, renderSVG, findKey, keyChars } from './kle.js';
import * as store from './store.js';

const LETTERS = { sv: 'abcdefghijklmnopqrstuvwxyzåäö', en: 'abcdefghijklmnopqrstuvwxyz' };
const WORD_ALPHABET = { sv: LETTERS.sv + 'é', en: LETTERS.en };
const BUILTIN = { 'iso-sv': 'ISO Swedish (built in)', 'ansi-us': 'ANSI US (built in)' };

const $ = (id) => document.getElementById(id);

let state = store.load();
let session = null;
let exercise = null; // { mode, items, spans }
let nextLine = null; // prose preview { mode, text }
const recentWords = [];
const recentChunks = [];
const recentDrill = [];
const contexts = {};
const layouts = {};
let board = null; // { keys, els }
let hintEls = [];
let chunkCache = null;
let drillCache = null;
let saveTimer = null;

const profile = () => state.profiles[state.active];
const settings = () => state.settings;
const isProse = (mode) => mode === 'sv' || mode === 'en';

function weakMap() {
  const mode = settings().mode;
  return weakness(profile().stats, { lambda: Number(settings().lambda) || 0, explore: isProse(mode) ? LETTERS[mode] : '' });
}

async function wordContext(lang) {
  if (!contexts[lang]) {
    const mod = await import(`../data/words-${lang}.js`);
    contexts[lang] = makeContext(mod.default, WORD_ALPHABET[lang]);
  }
  return contexts[lang];
}

async function layoutFor(id) {
  if (layouts[id]) return layouts[id];
  let data;
  if (BUILTIN[id]) {
    const res = await fetch(new URL(`../data/layouts/${id}.json`, import.meta.url));
    data = await res.json();
  } else if (state.layouts[id]) data = state.layouts[id].kle;
  else return layoutFor('iso-sv');
  return (layouts[id] = parseKLE(data));
}

function persist() {
  clearTimeout(saveTimer);
  const err = store.save(state);
  if (err) setMsg('save-msg', 'Could not save in this browser: ' + (err.message || err) + '. Remove some code files or download a backup.', true);
}
const persistSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
};

function setMsg(id, text, error = false) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('error', error);
}

// ---------- exercises ----------

function codeFiles() {
  return state.code.files;
}

async function makeProseLine(mode) {
  const ctx = await wordContext(mode);
  const s = settings();
  return buildLine(ctx, {
    weak: weakMap(),
    focus: Number(s.focus) / 100,
    recent: recentWords,
    symbols: s.symbols,
  });
}

async function newExercise({ fresh = false } = {}) {
  if (session && session.typed) finishHistory();
  const mode = settings().mode;
  const textEl = $('text');
  textEl.className = 'text' + (isProse(mode) ? '' : ' code');
  let items = null;
  let preview = null;

  if (isProse(mode)) {
    if (fresh || !nextLine || nextLine.mode !== mode) nextLine = { mode, text: await makeProseLine(mode) };
    items = itemsFromText(nextLine.text);
    nextLine = { mode, text: await makeProseLine(mode) };
    preview = nextLine.text;
  } else if (!codeFiles().length) {
    showEmpty('Add some of your own source files under <b>Settings → Code files</b> to practise code.');
    return;
  } else if (mode === 'code') {
    if (!chunkCache) chunkCache = allChunks(codeFiles());
    const pick = pickChunk(chunkCache, weakMap(), { recent: recentChunks, skipComments: settings().skipComments });
    if (!pick) {
      showEmpty('No typable code found in your files.');
      return;
    }
    recentChunks.push(pick.key);
    while (recentChunks.length > Math.min(5, chunkCache.length - 1)) recentChunks.shift();
    items = pick.items;
  } else {
    if (!drillCache) drillCache = drillLines(codeFiles(), { skipComments: settings().skipComments });
    const lines = buildDrill(drillCache, weakMap(), { recent: recentDrill });
    if (!lines.length) {
      showEmpty('No lines with symbols found in your code files.');
      return;
    }
    items = itemsFromText(lines.join('\n'));
  }

  session = new Session(items);
  exercise = { mode, items, spans: [] };
  renderExercise(preview);
  updateCursor();
  updateLive();
}

function showEmpty(html) {
  session = null;
  exercise = null;
  $('text').innerHTML = `<p class="empty">${html}</p>`;
  setHint(null);
}

function renderExercise(preview) {
  const textEl = $('text');
  textEl.textContent = '';
  const line = document.createElement('div');
  line.className = 'line current';
  const spans = exercise.items.map((it) => {
    const sp = document.createElement('span');
    if (it.ch === '\n') {
      sp.className = 'nl';
      sp.textContent = '↵\n';
    } else sp.textContent = it.ch;
    if (it.skip) sp.classList.add('skip');
    line.appendChild(sp);
    return sp;
  });
  textEl.appendChild(line);
  if (preview) {
    const next = document.createElement('div');
    next.className = 'line next';
    next.textContent = preview;
    textEl.appendChild(next);
  }
  textEl.scrollTop = 0;
  exercise.spans = spans;
}

function updateCursor() {
  if (!session) return;
  const cur = exercise.spans[session.pos];
  if (cur) {
    cur.classList.add('cur');
    if (exercise.mode !== 'sv' && exercise.mode !== 'en') cur.scrollIntoView({ block: 'nearest' });
  }
  setHint(session.expected);
}

function onChar({ ch, t, code }) {
  if (!session || session.done) return;
  const res = session.feed(ch, t);
  if (!res) return;
  const span = exercise.spans[res.pos];
  if (!res.ok) {
    span.classList.add('err');
    const textEl = $('text');
    textEl.classList.remove('shake');
    void textEl.offsetWidth;
    textEl.classList.add('shake');
    updateLive();
    return;
  }
  record(profile().stats, res.event);
  if (code && ch !== '\n') profile().codes[ch] = code;
  span.classList.remove('cur', 'err');
  span.classList.add('done');
  if (session.missed.has(res.pos)) span.classList.add('missed');
  for (let i = res.pos + 1; i < session.pos; i++) exercise.spans[i].classList.add('done');
  if (res.done) {
    finishExercise();
    return;
  }
  updateCursor();
  updateLive();
}

function finishHistory() {
  store.addHistory(profile(), session.activeMs, session.typed, session.clean);
}

function finishExercise() {
  const s = session;
  finishHistory();
  session = null;
  $('s-last').textContent = `${Math.round(s.wpm)} · ${pct(s.accuracy)}`;
  persist();
  refreshStats();
  newExercise();
}

function pct(x) {
  return `${Math.round(x * 1000) / 10}%`;
}

function updateLive() {
  if (!session) return;
  $('s-wpm').textContent = session.typed > 3 ? Math.round(session.wpm) : '–';
  $('s-acc').textContent = session.typed ? pct(session.accuracy) : '–';
}

// ---------- statistics display ----------

function showUnit(u) {
  return u.replace(/ /g, '␣').replace(/\n/g, '↵');
}

function refreshStats() {
  const weak = weakMap();
  const list = $('weak-list');
  list.textContent = '';
  const top = weakest(weak, 12);
  if (!top.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = 'Type a few lines to find out.';
    list.appendChild(li);
  }
  for (const [u, w] of top) {
    const li = document.createElement('li');
    li.style.setProperty('--p', `${Math.min(70, Math.round((w / 1.5) * 70))}%`);
    li.textContent = showUnit(u);
    const small = document.createElement('small');
    small.textContent = w.toFixed(2);
    li.appendChild(small);
    li.title = unitTitle(u);
    list.appendChild(li);
  }
  const h = profile().history[store.today()];
  $('s-today').textContent = h && h[0] ? `${Math.round(h[0] / 60000)} min · ${Math.round(h[1] / 5 / (h[0] / 60000))}` : '–';
  renderHistory();
  applyHeat(weak);
}

function unitTitle(u) {
  const st = profile().stats;
  const r = (u.length === 1 ? st.c : st.p)[u];
  if (!r) return 'Not typed yet';
  let t = `${Math.round(r[0])} times, ${Math.round(r[1])} ms, ${Math.round(r[2] / 10)}% wrong`;
  const conf = st.x[u];
  if (conf) {
    const top = Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 3);
    t += `; typed instead: ${top.map(([c, n]) => `${showUnit(c)} ×${n}`).join(', ')}`;
  }
  return t;
}

function renderHistory() {
  const body = $('history');
  body.textContent = '';
  const days = Object.keys(profile().history).sort().reverse().slice(0, 30);
  for (const d of days) {
    const [ms, typed, clean] = profile().history[d];
    const tr = document.createElement('tr');
    const min = ms / 60000;
    for (const v of [d, Math.round(min), min ? Math.round(typed / 5 / min) : '–', typed ? pct(clean / typed) : '–']) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

// ---------- keyboard ----------

async function renderBoard() {
  const wrap = $('board-wrap');
  wrap.hidden = !settings().showKeyboard;
  if (!settings().showKeyboard) {
    board = null;
    return;
  }
  const layout = await layoutFor(profile().layout);
  $('board').innerHTML = renderSVG(layout);
  const els = [];
  $('board').querySelectorAll('g.key').forEach((g) => (els[Number(g.dataset.i)] = g));
  board = { keys: layout.keys, els };
  hintEls = [];
  applyHeat(weakMap());
  if (session) setHint(session.expected);
}

function applyHeat(weak) {
  if (!board) return;
  const on = settings().heatmap;
  board.keys.forEach((k, i) => {
    const el = board.els[i];
    if (!el) return;
    const cap = el.querySelectorAll('.cap');
    let w = 0;
    if (on) for (const ch of keyChars(k)) w = Math.max(w, weak.get(ch) || 0);
    const p = Math.min(100, Math.round((w / 1.5) * 100));
    cap.forEach((c) => (c.style.fill = p ? `color-mix(in oklab, var(--heat) ${p}%, var(--cap))` : ''));
    el.classList.toggle('hot', p > 0);
  });
}

function setHint(ch) {
  for (const el of hintEls) el.classList.remove('hint', 'mod');
  hintEls = [];
  if (!board || !settings().hint || ch == null) return;
  const i = findKey(board.keys, ch, profile().codes);
  if (i >= 0 && board.els[i]) {
    board.els[i].classList.add('hint');
    hintEls.push(board.els[i]);
  }
  // Mark Shift for capitals; other modifiers depend on the layout.
  if (/\p{Lu}/u.test(ch)) {
    board.keys.forEach((k, j) => {
      if (k.legends.some((l) => /^(shift|⇧)$/i.test(l)) && board.els[j]) {
        board.els[j].classList.add('mod');
        hintEls.push(board.els[j]);
      }
    });
  }
}

// ---------- settings panel ----------

function fillProfiles() {
  const sel = $('profile-select');
  sel.textContent = '';
  for (const [id, p] of Object.entries(state.profiles)) sel.add(new Option(p.name, id, false, id === state.active));
  $('profile-pill').textContent = profile().name;
  fillLayouts();
}

function fillLayouts() {
  const sel = $('layout-select');
  sel.textContent = '';
  for (const [id, name] of Object.entries(BUILTIN)) sel.add(new Option(name, id));
  for (const [id, l] of Object.entries(state.layouts)) sel.add(new Option(l.name, id));
  sel.value = BUILTIN[profile().layout] || state.layouts[profile().layout] ? profile().layout : 'iso-sv';
}

function fillCodeFiles() {
  const ul = $('code-files');
  ul.textContent = '';
  codeFiles().forEach((f, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = f.name;
    const info = document.createElement('small');
    info.textContent = `${f.text.split('\n').length} lines, ${chunkText(f.text).length} chunks`;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = 'Remove';
    rm.addEventListener('click', () => {
      state.code.files.splice(i, 1);
      codeChanged();
    });
    li.append(name, info, rm);
    ul.appendChild(li);
  });
}

function codeChanged() {
  chunkCache = null;
  drillCache = null;
  persist();
  fillCodeFiles();
  if (!isProse(settings().mode)) newExercise({ fresh: true });
}

function addCodeFile(name, text) {
  if (!text.trim()) return;
  const existing = state.code.files.findIndex((f) => f.name === name);
  if (existing >= 0) state.code.files[existing].text = text;
  else state.code.files.push({ name, text });
}

async function readFiles(fileList) {
  for (const f of fileList) {
    if (f.size > 2_000_000) continue;
    addCodeFile(f.name, await f.text());
  }
  codeChanged();
}

function fillSettings() {
  const s = settings();
  $('opt-focus').value = s.focus;
  $('focus-out').textContent = `${s.focus}%`;
  $('opt-lambda').value = s.lambda;
  $('opt-symbols').checked = s.symbols;
  $('opt-comments').checked = s.skipComments;
  $('opt-keyboard').checked = s.showKeyboard;
  $('opt-hint').checked = s.hint;
  $('opt-heatmap').checked = s.heatmap;
  document.querySelectorAll('#modes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode)));
  fillProfiles();
  fillCodeFiles();
}

function openSettings(open) {
  $('settings').hidden = !open;
  $('open-settings').setAttribute('aria-expanded', String(open));
  if (!open) focusInput();
}

function focusInput() {
  $('input').focus({ preventScroll: true });
}

function bindSettings() {
  $('open-settings').addEventListener('click', () => openSettings($('settings').hidden));
  $('close-settings').addEventListener('click', () => openSettings(false));

  document.querySelectorAll('#modes button').forEach((b) =>
    b.addEventListener('click', () => {
      settings().mode = b.dataset.mode;
      persistSoon();
      fillSettings();
      refreshStats();
      newExercise({ fresh: true });
      focusInput();
    }),
  );

  const bindCheck = (id, key, after) =>
    $(id).addEventListener('change', (e) => {
      settings()[key] = e.target.checked;
      persistSoon();
      if (after) after();
    });
  bindCheck('opt-symbols', 'symbols', () => (nextLine = null));
  bindCheck('opt-comments', 'skipComments', () => (drillCache = null));
  bindCheck('opt-keyboard', 'showKeyboard', renderBoard);
  bindCheck('opt-hint', 'hint', () => {
    setHint(session && session.expected);
    focusInput();
  });
  bindCheck('opt-heatmap', 'heatmap', () => {
    applyHeat(weakMap());
    focusInput();
  });
  $('opt-focus').addEventListener('input', (e) => {
    settings().focus = Number(e.target.value);
    $('focus-out').textContent = `${e.target.value}%`;
    persistSoon();
  });
  $('opt-lambda').addEventListener('change', (e) => {
    settings().lambda = Math.max(0, Number(e.target.value) || 0);
    persistSoon();
    refreshStats();
  });

  $('profile-select').addEventListener('change', (e) => switchProfile(e.target.value));
  $('profile-new').addEventListener('click', () => {
    const name = prompt('Name of the new keyboard profile:', 'Keyboard ' + (Object.keys(state.profiles).length + 1));
    if (!name) return;
    const id = 'p' + Date.now().toString(36);
    state.profiles[id] = store.newProfile(name.trim(), profile().layout);
    switchProfile(id);
  });
  $('profile-rename').addEventListener('click', () => {
    const name = prompt('New name:', profile().name);
    if (!name) return;
    profile().name = name.trim();
    persist();
    fillProfiles();
  });
  $('profile-delete').addEventListener('click', () => {
    if (Object.keys(state.profiles).length < 2) {
      alert('This is the only profile.');
      return;
    }
    if (!confirm(`Delete the profile "${profile().name}" and its statistics?`)) return;
    delete state.profiles[state.active];
    switchProfile(Object.keys(state.profiles)[0]);
  });
  $('reset-stats').addEventListener('click', () => {
    if (!confirm(`Reset all statistics and history of "${profile().name}"?`)) return;
    const p = profile();
    state.profiles[state.active] = store.newProfile(p.name, p.layout);
    persist();
    refreshStats();
    newExercise({ fresh: true });
  });

  $('layout-select').addEventListener('change', (e) => {
    profile().layout = e.target.value;
    persist();
    renderBoard();
  });
  $('kle-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $('kle-text').value = await f.text();
    if (!$('kle-name').value) $('kle-name').value = f.name.replace(/\.json$/i, '').replace(/^keyboard-layout-?/, '') || 'Imported';
  });
  $('kle-add').addEventListener('click', () => {
    const raw = $('kle-text').value.trim();
    if (!raw) return setMsg('kle-msg', 'Choose a file or paste layout data first.', true);
    let data;
    let parsed;
    try {
      data = parseKLEText(raw);
      parsed = parseKLE(data);
    } catch (err) {
      return setMsg('kle-msg', 'Could not read the layout: ' + err.message, true);
    }
    if (!parsed.keys.length) return setMsg('kle-msg', 'The layout has no keys.', true);
    const id = 'k' + Date.now().toString(36);
    const name = $('kle-name').value.trim() || (parsed.meta.name ? String(parsed.meta.name) : 'Imported layout');
    state.layouts[id] = { name, kle: data };
    profile().layout = id;
    persist();
    fillLayouts();
    renderBoard();
    $('kle-text').value = '';
    $('kle-name').value = '';
    $('kle-file').value = '';
    setMsg('kle-msg', `Added "${name}" with ${parsed.keys.length} keys and selected it for this profile.`);
  });
  $('kle-remove').addEventListener('click', () => {
    const id = $('layout-select').value;
    if (BUILTIN[id]) return setMsg('kle-msg', 'Built-in layouts cannot be removed.', true);
    if (!confirm(`Remove the layout "${state.layouts[id].name}"?`)) return;
    delete state.layouts[id];
    delete layouts[id];
    for (const p of Object.values(state.profiles)) if (p.layout === id) p.layout = 'iso-sv';
    persist();
    fillLayouts();
    renderBoard();
    setMsg('kle-msg', 'Layout removed.');
  });

  $('code-add').addEventListener('click', () => {
    const text = $('code-text').value;
    if (!text.trim()) return;
    addCodeFile($('code-name').value.trim() || `pasted-${codeFiles().length + 1}.txt`, text);
    $('code-text').value = '';
    $('code-name').value = '';
    codeChanged();
  });
  $('code-file').addEventListener('change', (e) => readFiles(e.target.files));
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    readFiles(e.dataTransfer.files);
  });
  // Dropping anywhere on the page in a code mode adds files too.
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    if (e.defaultPrevented || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    readFiles(e.dataTransfer.files);
  });

  $('copy-link').addEventListener('click', async () => {
    persist();
    const url = await store.linkFor(state, location.origin + location.pathname);
    try {
      await navigator.clipboard.writeText(url);
      setMsg('save-msg', `Link copied: ${url.length.toLocaleString()} characters.`);
    } catch {
      prompt('Copy this link:', url);
      setMsg('save-msg', `Link is ${url.length.toLocaleString()} characters.`);
    }
  });
  $('download-backup').addEventListener('click', () => {
    persist();
    const blob = new Blob([store.backupText(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `typedef-backup-${store.today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('load-backup').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let partial;
    try {
      partial = store.parseBackup(await f.text());
    } catch (err) {
      return setMsg('save-msg', 'Could not read the backup: ' + err.message, true);
    }
    if (await confirmImport(partial, 'Load this backup?')) {
      applyPartial(partial);
      setMsg('save-msg', 'Backup loaded.');
    }
  });
}

function switchProfile(id) {
  if (session && session.typed) finishHistory();
  session = null;
  state.active = id;
  persist();
  fillProfiles();
  renderBoard();
  refreshStats();
  newExercise({ fresh: true });
}

// ---------- import ----------

function confirmImport(partial, title) {
  const sum = store.summarize(partial);
  $('import-title').textContent = title;
  const box = $('import-summary');
  box.textContent = '';
  const ul = document.createElement('ul');
  for (const p of sum.profiles) {
    const li = document.createElement('li');
    li.textContent = `${p.name}: ${p.chars} characters, ${p.pairs} pairs, ${p.days} days of history (${p.minutes} min)${p.last ? `, last ${p.last}` : ''}`;
    ul.appendChild(li);
  }
  box.appendChild(ul);
  if (sum.layouts || sum.files) {
    const p = document.createElement('p');
    p.textContent = `Also ${sum.layouts} layouts and ${sum.files} code files.`;
    box.appendChild(p);
  }
  const dlg = $('import-dialog');
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'replace'), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
  });
}

function applyPartial(partial) {
  state = store.applyImport(state, partial);
  for (const k of Object.keys(layouts)) if (!BUILTIN[k]) delete layouts[k];
  chunkCache = null;
  drillCache = null;
  nextLine = null;
  session = null;
  persist();
  fillSettings();
  renderBoard();
  refreshStats();
  newExercise({ fresh: true });
}

async function checkLink() {
  if (!/^#p=/.test(location.hash)) return;
  let partial = null;
  try {
    partial = await store.readLinkHash(location.hash);
  } catch (err) {
    alert('This link could not be read: ' + err.message);
  }
  history.replaceState(null, '', location.pathname + location.search);
  if (partial && (await confirmImport(partial, 'Import progress from this link?'))) applyPartial(partial);
}

// ---------- start ----------

function bindTyping() {
  const input = $('input');
  const typing = $('typing');
  attachInput(input, {
    onChar,
    onCommand: (cmd) => {
      if (cmd === 'skip') newExercise();
    },
  });
  input.addEventListener('focus', () => typing.classList.add('focused'));
  input.addEventListener('blur', () => typing.classList.remove('focused'));
  typing.addEventListener('mousedown', (e) => {
    e.preventDefault();
    focusInput();
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t === input || e.ctrlKey || e.metaKey || e.altKey) return;
    if (t.closest && t.closest('input, textarea, select, button, dialog, summary, a, [contenteditable]')) return;
    if (!$('settings').hidden && $('settings').contains(t)) return;
    focusInput();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });
  window.addEventListener('pagehide', persist);
  // A link pasted into a tab that already runs the app only changes the hash.
  window.addEventListener('hashchange', checkLink);
}

async function main() {
  bindSettings();
  bindTyping();
  fillSettings();
  await checkLink();
  await renderBoard();
  refreshStats();
  await newExercise({ fresh: true });
  focusInput();
}

main();
