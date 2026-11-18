// Runs one exercise: cursor, blocking errors, speed and accuracy.
//
// An exercise is a list of items { ch, skip }. Skipped items (indentation,
// untypable characters, comments) are passed over automatically. A wrong
// character leaves the cursor in place until the right one is typed; the miss
// counts once against the expected character and that position yields no
// timing, so pair timings stay clean.
//
// An item may list alternatives in `alt`: the closing keystroke of a line
// is a space or Enter, whichever the hand reaches for.

export const PAUSE_MS = 3000;

export function itemsFromText(text) {
  return [...text].map((ch) => ({ ch, skip: false }));
}

// Finish an exercise with one more keystroke, as typing would continue:
// space or Enter both close it.
export function withEnd(items, ch = ' ') {
  return [...items, { ch, skip: false, alt: ch === ' ' ? ['\n'] : [' '], end: true }];
}

export class Session {
  // prev: { ch, t } of the keystroke before this exercise, so the first
  // character of a line that follows straight on still gets a pair timing.
  constructor(items, { pauseMs = PAUSE_MS, prev = null } = {}) {
    this.items = items;
    this.pauseMs = pauseMs;
    this.pos = 0;
    this.prevCh = prev ? prev.ch : null;
    this.prevT = prev ? prev.t : null;
    this.lastKeyT = prev ? prev.t : null;
    this.miss = false;
    this.wrong = null;
    this.missed = new Set(); // positions that had at least one miss
    this.activeMs = 0;
    this.typed = 0;
    this.clean = 0;
    this.keys = 0;
    this.skipForward();
  }

  skipForward() {
    while (this.pos < this.items.length && this.items[this.pos].skip) this.pos++;
  }

  get done() {
    return this.pos >= this.items.length;
  }

  get expected() {
    return this.done ? null : this.items[this.pos].ch;
  }

  get total() {
    return this.items.filter((it) => !it.skip).length;
  }

  // Feed one typed character at time t (ms). Returns null when done, else
  // { ok, pos, expected, typed } and, when ok, { event, done }.
  feed(ch, t) {
    if (this.done) return null;
    this.keys++;
    if (this.lastKeyT != null) this.activeMs += Math.min(Math.max(0, t - this.lastKeyT), this.pauseMs);
    this.lastKeyT = t;
    const pos = this.pos;
    const item = this.items[pos];
    const expected = item.ch;
    if (ch !== expected && !(item.alt && item.alt.includes(ch))) {
      if (!this.miss) this.wrong = ch;
      this.miss = true;
      this.missed.add(pos);
      return { ok: false, pos, expected, typed: ch };
    }
    let dt = null;
    if (!this.miss && this.prevT != null && this.prevCh != null) {
      dt = t - this.prevT;
      if (dt > this.pauseMs || dt <= 0) dt = null;
    }
    // Stats get the key actually pressed, so an Enter that closes a line is
    // timed as Enter, not as the space it stood in for.
    const event = { ch, prev: this.prevCh, dt, miss: this.miss, wrong: this.wrong };
    this.typed++;
    if (!this.miss) this.clean++;
    this.prevCh = ch;
    this.prevT = t;
    this.miss = false;
    this.wrong = null;
    this.pos++;
    this.skipForward();
    return { ok: true, pos, expected, typed: ch, event, done: this.done };
  }

  get wpm() {
    return this.activeMs > 0 ? this.typed / 5 / (this.activeMs / 60000) : 0;
  }

  get accuracy() {
    return this.typed ? this.clean / this.typed : 1;
  }
}
