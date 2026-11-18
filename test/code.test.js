import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, chunkItems, commentMask, commentSyntax, pickChunk, allChunks, drillLines, buildDrill, normalize } from '../js/code.js';
import { mulberry32 } from '../js/picker.js';

const lines = (n, p = 'x') => Array.from({ length: n }, (_, i) => `${p}${i}`);

test('normalize drops CR and trailing whitespace', () => {
  assert.equal(normalize('a  \r\nb\t\r\n'), 'a\nb\n');
});

test('chunks of 10 to 25 lines split at blank lines', () => {
  const text = [lines(4, 'a'), lines(4, 'b'), lines(4, 'c'), lines(30, 'd'), lines(3, 'e')].map((b) => b.join('\n')).join('\n\n\n');
  const chunks = chunkText(text);
  const counts = chunks.map((c) => c.filter((l) => l !== '').length);
  assert.deepEqual(counts, [12, 15, 15, 3]);
  assert.equal(chunks[0][4], '', 'one blank line between blocks');
  for (const c of chunks) assert.ok(c.length <= 25 + 3);
});

test('indentation is skipped, Enter is typed', () => {
  const items = chunkItems(['if x:', '    y()']);
  const typed = items.filter((i) => !i.skip).map((i) => i.ch).join('');
  assert.equal(typed, 'if x:\ny()');
});

test('untypable characters are skipped', () => {
  const items = chunkItems(['s = "🎉 ok"']);
  assert.equal(items.filter((i) => !i.skip).map((i) => i.ch).join(''), 's = " ok"');
  assert.ok(items.some((i) => i.ch === '🎉' && i.skip), 'emoji is one skipped item');
});

test('comments: line, trailing, block, and strings are not comments', () => {
  const src = ['// header', 'let a = 1; // one', 'let u = "http://x";', '/* a', ' b */ let c;', 'end'];
  const items = chunkItems(src, { name: 'f.js', skipComments: true });
  assert.equal(items.filter((i) => !i.skip).map((i) => i.ch).join(''), 'let a = 1;\nlet u = "http://x";\n let c;\nend');
  const py = chunkItems(['x = 1  # note', '# only', 'y = "#"'], { name: 'a.py', skipComments: true });
  assert.equal(py.filter((i) => !i.skip).map((i) => i.ch).join(''), 'x = 1\ny = "#"');
  assert.deepEqual(commentSyntax('x.unknown'), { line: [], block: null });
  assert.deepEqual(commentMask(['a # b'], commentSyntax('z.sh'))[0], [false, false, true, true, true]);
});

test('chunk picker prefers chunks dense in weak units', () => {
  const files = [{ name: 'a.c', text: [lines(12, 'plain'), lines(12, '{[]}')].map((b) => b.join('\n')).join('\n\n') }];
  const chunks = allChunks(files);
  assert.equal(chunks.length, 2);
  const weak = new Map([['{', 2], ['[', 2]]);
  const rng = mulberry32(7);
  let dense = 0;
  for (let i = 0; i < 100; i++) if (pickChunk(chunks, weak, { rng }).chunk.index === 1) dense++;
  assert.ok(dense > 80, `dense ${dense}`);
});

test('symbol drill returns real lines containing the weak unit', () => {
  const files = [{ name: 'a.js', text: 'const a = arr[i];\nlet b = {};\n    return x;\nfoo(bar);\n' }];
  const lines = drillLines(files);
  assert.ok(lines.includes('return x;'));
  const out = buildDrill(lines, new Map([['[', 3]]), { rng: mulberry32(8), n: 3 });
  assert.equal(out[0], 'const a = arr[i];');
  assert.equal(out.length, 3);
});

test('symbol drill lines drop comments when asked', () => {
  const files = [{ name: 'a.js', text: '// a comment line\nx = f(1); // call\n' }];
  assert.deepEqual(drillLines(files, { skipComments: true }), ['x = f(1);']);
  assert.equal(drillLines(files).length, 2);
});
