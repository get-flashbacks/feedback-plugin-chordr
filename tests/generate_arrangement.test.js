'use strict';
// Chord-symbol to playable keys/guitar arrangement generation.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshPlugin() {
  global.window = {};
  const file = path.join(__dirname, '..', 'chordr', 'screen.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return global.window.chordr;
}

test('defaults to a two-hand keys arrangement', () => {
  const chordr = freshPlugin();
  const result = chordr.generateChordArrangement([
    { t: 0, name: 'C' },
    { t: 2, name: 'G/B' },
  ], { duration: 5 });

  assert.equal(result.instrument, 'keys');
  assert.deepEqual(result.sourceChords, [{ t: 0, name: 'C' }, { t: 2, name: 'G/B' }]);
  assert.equal(result.notes.filter((n) => n.t === 0 && n.hand === 'rh').length, 3);
  assert.equal(result.notes.find((n) => n.t === 0 && n.hand === 'lh').midi % 12, 0);
  assert.equal(result.notes.find((n) => n.t === 2 && n.hand === 'lh').midi % 12, 11);
  assert.ok(result.notes.filter((n) => n.t === 0).every((n) => n.sus === 2));
  assert.ok(result.notes.filter((n) => n.t === 2).every((n) => n.sus === 3));
});

test('keys voicings stay in the configured ranges and use smooth voice leading', () => {
  const chordr = freshPlugin();
  const result = chordr.generateKeysArrangement([
    { t: 0, name: 'Cmaj7' },
    { t: 1, name: 'Am7' },
  ], { rightHandLow: 60, rightHandHigh: 76 });
  const right = result.notes.filter((n) => n.hand === 'rh');

  assert.ok(right.every((n) => n.midi >= 60 && n.midi <= 76));
  assert.deepEqual(new Set(right.filter((n) => n.t === 0).map((n) => n.midi % 12)), new Set([0, 4, 7, 11]));
  assert.deepEqual(new Set(right.filter((n) => n.t === 1).map((n) => n.midi % 12)), new Set([9, 0, 4, 7]));
});

test('uses template names when chart chords do not carry a name', () => {
  const chordr = freshPlugin();
  const result = chordr.generateKeysArrangement(
    [{ t: 1, id: 0 }],
    { chordTemplates: [{ name: 'Dm7' }] },
  );

  assert.equal(result.sourceChords[0].name, 'Dm7');
  assert.deepEqual(new Set(result.notes.map((n) => n.midi % 12)), new Set([2, 5, 9, 0]));
});

test('guitar generation returns playable string/fret notes covering the chord', () => {
  const chordr = freshPlugin();
  const result = chordr.generateChordArrangement(
    [{ t: 0, name: 'C' }, { t: 2, name: 'Am' }],
    { instrument: 'guitar', duration: 4 },
  );

  assert.equal(result.instrument, 'guitar');
  assert.equal(result.shapes.length, 2);
  for (const shape of result.shapes) {
    assert.equal(shape.frets.length, 6);
    assert.ok(shape.frets.every((f) => f >= -1 && f <= 8));
  }
  const cPitches = result.notes.filter((n) => n.t === 0).map((n) => (40 + [0, 5, 10, 15, 19, 24][n.s] + n.f) % 12);
  assert.deepEqual(new Set(cPitches), new Set([0, 4, 7]));
});

test('ignores unsupported chord symbols without throwing', () => {
  const chordr = freshPlugin();
  const result = chordr.generateChordArrangement([{ t: 0, name: 'C13alt' }]);
  assert.deepEqual(result.notes, []);
  assert.deepEqual(result.sourceChords, []);
});

test('generateArrangementFromAudio connects audio detection to keys generation', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (url === '/song.ogg') return { ok: true, blob: async () => ({ type: 'audio/ogg' }) };
    return { ok: true, json: async () => ({ chords: [{ t: 0, name: 'F' }] }) };
  };
  try {
    const chordr = freshPlugin();
    const result = await chordr.generateArrangementFromAudio('/song.ogg', { duration: 2 });
    assert.equal(result.instrument, 'keys');
    assert.deepEqual(result.sourceChords, [{ t: 0, name: 'F' }]);
    assert.ok(result.notes.length >= 4);
  } finally {
    global.fetch = originalFetch;
  }
});
