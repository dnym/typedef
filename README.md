# Typedef

A typing trainer that finds your weak characters and character pairs and
drills them with real words and your own code. It is plain HTML and
JavaScript: no build step, no server code, no account.

## Run it

```sh
python3 serve.py        # http://localhost:8000/
```

Browsers refuse ES modules opened from `file://`, so a local web server is
needed; `serve.py` wraps Python's built-in one. Any static host works too,
and the GitHub Actions workflow publishes to GitHub Pages.

## How it works

- **Correctness ignores the layout.** The app compares the character the
  browser delivers with the expected one, so any OS layout, firmware layer or
  remap works. Dead keys (´ ` ^ ~ ¨) count as one character.
- **Errors block.** A wrong character must be corrected before you continue.
  There is no backspace. The miss counts against the expected character.
- **What is measured.** Per character: error rate and what you typed instead.
  Per pair (previous character to this one): the time between the two
  keystrokes. Both are moving averages over about the last 50 occurrences.
- **Weakness** is `max(0, t/t_median − 1) + λ·e`: slower than your own
  typical pair, or often wrong. λ starts at 3.
- **Prose modes** (Swedish, English) build lines from frequency-ranked real
  words. A share of the words (the focus slider, default 30 %) is chosen
  because it contains a weak unit, looked up in an index from every character
  and pair to the words containing it. Units in too few words fall back to
  real trigraphs. Symbols, digits and capitals come from patterns such as
  `(word)`, `Word,` or `word: 42`.
- **Code mode** serves your own files in chunks of about 10 to 25 lines,
  preferring chunks dense in your weak units. Indentation is automatic, so
  you type Enter and never leading spaces. Untypable characters are skipped,
  and comments can be.
- **Symbol drill** pulls single real lines from your files that contain a
  weak non-letter unit, such as `arr[i] = {};`.
- **Keyboards** are drawn from keyboard-layout-editor (KLE) JSON, for the
  next-key hint and the weakness heatmap. The picture never affects
  correctness. Hints follow the legends printed in the file; where a legend
  is missing, the app remembers which physical key (`KeyboardEvent.code`) you
  typed a character with. ISO Swedish and ANSI US are built in.
- **Profiles** keep statistics per keyboard, since two boards train
  different movements.

## Saving

Progress lives in `localStorage`. **Copy link** packs settings, character
scores, the 400 most relevant pairs and the last 60 days of history into the
URL fragment (`#p=…`), deflated and base64url-encoded; the fragment is never
sent to a server. Layouts and code files stay out of the link. **Download
backup** saves everything as JSON. Opening a link or backup always asks
before replacing anything.

## Development

```sh
node --test test/                                   # no dependencies
tools/build-words.py sv path/to/sv_50k.txt          # regenerate data/words-sv.js
```

| File | Job |
| --- | --- |
| `js/input.js` | `beforeinput` and composition events to "character at time t" |
| `js/session.js` | One exercise: cursor, blocking errors, speed, accuracy |
| `js/stats.js` | Moving averages per character and pair, weakness score |
| `js/picker.js` | Pair-to-word index, line building, focus share |
| `js/code.js` | Chunking, auto-indent, comments, chunk picker, symbol drill |
| `js/kle.js` | KLE parser, SVG keyboard, key lookup |
| `js/store.js` | localStorage, link codec, backup file |
| `js/app.js` | Wires the modules to the page |

The word lists come from film subtitles, so the block lists in `tools/`
remove names, fragments and foreign words; they are tuned by hand and will
never be perfect. Adding a language is one run of `tools/build-words.py`
after adding its alphabet there, plus a mode button.

## Licence

Code: BSD-2-Clause-Patent (`LICENSE`). Word lists: CC BY-SA 4.0, derived
from [FrequencyWords](https://github.com/hermitdave/FrequencyWords); see
`data/NOTICE.md`.
