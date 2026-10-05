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
  ], { lengthSeconds: 5 });

  assert.equal(result.instrument, 'keys');
  assert.deepEqual(result.sourceChords, [{ t: 0, name: 'C' }, { t: 2, name: 'G/B' }]);
  assert.equal(result.notes.filter((n) => n.t === 0 && n.hand === 'rh').length, 3);
  assert.equal(result.notes.find((n) => n.t === 0 && n.hand === 'lh').midi % 12, 0);
  assert.equal(result.notes.find((n) => n.t === 2 && n.hand === 'lh').midi % 12, 11);
  assert.ok(result.notes.filter((n) => n.t === 0).every((n) => n.sus === 2));
  assert.ok(result.notes.filter((n) => n.t === 2).every((n) => n.sus === 3));
});

test('keys voicings stay in the configured ranges and cover the chord', () => {
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

test('the right hand moves minimally into the next chord', () => {
  const chordr = freshPlugin();
  const result = chordr.generateKeysArrangement([
    { t: 0, name: 'Em' },
    { t: 1, name: 'C' },
  ], { rightHandLow: 60, rightHandHigh: 76 });
  const right = result.notes.filter((n) => n.hand === 'rh');
  const first = right.filter((n) => n.t === 0).map((n) => n.midi).sort((a, b) => a - b);
  const second = right.filter((n) => n.t === 1).map((n) => n.midi).sort((a, b) => a - b);

  // Both metrics are the ones _bestRightHandVoicing scores a voicing by:
  // nearest-by-index semitone movement from the previous chord, and the tones
  // carried over. Without the movement term the C drops an octave to
  // [60, 64, 67] — 11 semitones of movement — while still satisfying every
  // range and pitch-class assertion, so pin the motion itself.
  const movement = second.reduce((sum, midi, i) => sum + Math.abs(midi - first[Math.min(i, first.length - 1)]), 0);
  const held = first.filter((midi) => second.includes(midi)).length;
  assert.ok(movement <= 3, `right hand moved ${movement} semitones into the C`);
  assert.ok(held >= 2, `only ${held} tones held over into the C`);
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
    { instrument: 'guitar', lengthSeconds: 4 },
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

test('guitar shapes decode back to the requested chord for a bass part', () => {
  const chordr = freshPlugin();
  // A 4/5-string bass reads fifths (B-E-A-D-G), not the low six guitar
  // strings, so frets chosen against the guitar base decode to a different
  // chord once the host reads them back with `isBass` — C came back as
  // unidentifiable, A as Esus4, G as Dsus4.
  for (const stringCount of [4, 5]) {
    for (const name of ['C', 'Am', 'Dm7', 'G']) {
      const label = `${name} on ${stringCount} strings`;
      const result = chordr.generateGuitarArrangement(
        [{ t: 0, name }],
        { instrument: 'guitar', stringCount, isBass: true },
      );
      assert.equal(result.shapes.length, 1, `${label} produced a shape`);

      const identified = chordr.identifyChord(result.notes, {
        stringCount, isBass: true, tuning: new Array(stringCount).fill(0),
      });
      const wanted = chordr.parseChordName(name);
      assert.ok(identified, `${label} decoded`);
      assert.deepEqual(new Set(identified.pitchClasses), new Set(wanted.pitchClasses), `${label} pitch classes`);
      assert.ok(identified.pitchClasses.includes(wanted.bass), `${label} kept its bass note`);
    }
  }
});

test('a song of wide-tuning guitar chords does not block on the shape search', () => {
  const chordr = freshPlugin();
  const progression = ['C', 'Am', 'F', 'G', 'Cmaj9', 'Dm7'];
  const chords = Array.from({ length: 24 }, (_, i) => ({ t: i * 2, name: progression[i % progression.length] }));
  const started = process.hrtime.bigint();
  const result = chordr.generateGuitarArrangement(chords, { instrument: 'guitar', stringCount: 8, maxFret: 15 });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(result.shapes.length, 24);
  // The unpruned, uncached search cost seconds per chord at this size (~two
  // minutes for this song). The pruned search plus the per-call shape cache
  // finishes in single-digit milliseconds, so the bound is loose on purpose.
  assert.ok(elapsedMs < 2000, `24 chords at 8 strings x 15 frets took ${elapsedMs}ms`);
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
    const result = await chordr.generateArrangementFromAudio('/song.ogg', { lengthSeconds: 2 });
    assert.equal(result.instrument, 'keys');
    assert.deepEqual(result.sourceChords, [{ t: 0, name: 'F' }]);
    // A keys triad is exactly one left-hand bass note plus three right-hand
    // chord tones — an exact count, so a stray extra note fails here.
    assert.equal(result.notes.length, 4);
  } finally {
    global.fetch = originalFetch;
  }
});

test('lengthSeconds holds the trailing chord out to the arrangement length', () => {
  const chordr = freshPlugin();
  const chords = [{ t: 0, name: 'C' }, { t: 10, name: 'F' }, { t: 100, name: 'G' }];
  const trailing = (options) => chordr.generateKeysArrangement(chords, options)
    .notes.filter((n) => n.hand === 'rh' && n.t === 100)
    .map((n) => n.sus)[0];

  // The last chord is held until lengthSeconds — that is how an audio path
  // whose final detected chord is short still fills its track.
  assert.equal(trailing({ lengthSeconds: 180 }), 80);
  assert.equal(trailing({ lengthSeconds: 120 }), 20);
  // A length below the last onset can't shorten the final note below
  // defaultDuration, so it extends nothing rather than vanishing.
  assert.equal(trailing({ lengthSeconds: 4 }), 2);
  assert.equal(trailing({}), 2);
  assert.equal(trailing({ defaultDuration: 6 }), 6);
});
