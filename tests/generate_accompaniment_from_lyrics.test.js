'use strict';
// Melody-to-accompaniment generation, sourced from lyrics_karaoke's
// canonical /playback payload (docs/architecture/vocals-playback-contract.md
// in that plugin). Covers the harmonization path this PR adds on top of the
// existing chart-chord / audio-chord-detection generation paths.
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

function withFetch(handler, fn) {
  const original = global.fetch;
  global.fetch = handler;
  return Promise.resolve(fn()).finally(() => { global.fetch = original; });
}

function tokensFor(pitchClasses, opts) {
  const startAt = (opts && opts.startAt) || 0;
  const dur = (opts && opts.duration) || 0.5;
  return pitchClasses.map((midi, i) => ({
    start: startAt + i * dur, duration: dur, text: 'la', midi,
  }));
}

test('returns null when the lyrics_karaoke route is unavailable', async () => {
  const chordr = freshPlugin();
  await withFetch(async () => ({ ok: false }), async () => {
    const result = await chordr.generateAccompanimentFromLyrics('song.sloppak');
    assert.equal(result, null);
  });
});

test('returns null on a network/decode failure without throwing', async () => {
  const chordr = freshPlugin();
  await withFetch(async () => { throw new Error('offline'); }, async () => {
    const result = await chordr.generateAccompanimentFromLyrics('song.sloppak');
    assert.equal(result, null);
  });
});

test('returns null for a lyrics-only track (no pitched tokens)', async () => {
  const chordr = freshPlugin();
  const payload = {
    schema_version: 1,
    voices: [{ id: 'primary', primary: true, tokens: [
      { start: 0, duration: 0.5, text: 'la' },
      { start: 0.5, duration: 0.5, text: 'la' },
    ] }],
  };
  await withFetch(async () => ({ ok: true, json: async () => payload }), async () => {
    const result = await chordr.generateAccompanimentFromLyrics('song.sloppak');
    assert.equal(result, null);
  });
});

test('returns null for an unrecognized schema_version', async () => {
  const chordr = freshPlugin();
  const payload = { schema_version: 2, voices: [] };
  await withFetch(async () => ({ ok: true, json: async () => payload }), async () => {
    const result = await chordr.generateAccompanimentFromLyrics('song.sloppak');
    assert.equal(result, null);
  });
});

test('requests the primary voice for the given filename and arrangement index', async () => {
  const chordr = freshPlugin();
  let requestedUrl = null;
  const payload = { schema_version: 1, voices: [{ id: 'primary', primary: true, tokens: [] }] };
  await withFetch(async (url) => { requestedUrl = url; return { ok: true, json: async () => payload }; }, async () => {
    await chordr.generateAccompanimentFromLyrics('Song Name.sloppak', { arrangementIndex: 1 });
  });
  assert.ok(requestedUrl.startsWith('/api/plugins/lyrics_karaoke/playback?'));
  const params = new URLSearchParams(requestedUrl.split('?')[1]);
  assert.equal(params.get('filename'), 'Song Name.sloppak');
  assert.equal(params.get('arrangement'), '1');
});

test('harmonizes a C major melody into a diatonic keys accompaniment', async () => {
  const chordr = freshPlugin();
  // Six 1s windows of a C major (I) arpeggio establish an unambiguous
  // tonic for the key-estimation step, then one window each of F-A (IV)
  // and G-B (V) — those two windows carry too little total duration to
  // sway the global key estimate away from C, but should still be enough
  // local pitch-class weight to win their own window's chord choice,
  // demonstrating the per-window harmonization actually varies with the
  // melody instead of only ever reproducing the global key's tonic triad.
  const tokens = [
    ...tokensFor([60, 64, 67, 60, 64, 67], { startAt: 0, duration: 0.5 }),      // windows 0-2: C E G x2
    ...tokensFor([65, 69, 60], { startAt: 6, duration: 0.333 }),                 // window 6: F A C
    ...tokensFor([67, 71, 62], { startAt: 7, duration: 0.333 }),                 // window 7: G B D
  ];
  const payload = { schema_version: 1, voices: [{ id: 'primary', primary: true, tokens }] };

  const result = await withFetch(
    async () => ({ ok: true, json: async () => payload }),
    () => chordr.generateAccompanimentFromLyrics('song.sloppak', { windowSeconds: 1 }),
  );

  assert.ok(result);
  assert.equal(result.instrument, 'keys');
  assert.deepEqual(result.key, { root: 'C', mode: 'major' });
  assert.deepEqual(
    result.sourceChords.map((c) => c.name),
    ['C', 'C', 'C', 'F', 'G'],
  );
  assert.ok(result.notes.length > 0);
});

test('does not sustain a chord across silent windows', async () => {
  const chordr = freshPlugin();
  // The issue's repro: two short pitched notes ten seconds apart. Every
  // window between them is empty, so the first chord must stop at its own
  // window boundary rather than being held until the next onset.
  const tokens = [
    { start: 0, duration: 1, text: 'la', midi: 60 },
    { start: 10, duration: 1, text: 'la', midi: 60 },
  ];
  const payload = { schema_version: 1, voices: [{ id: 'primary', primary: true, tokens }] };

  const result = await withFetch(
    async () => ({ ok: true, json: async () => payload }),
    () => chordr.generateAccompanimentFromLyrics('song.sloppak', { windowSeconds: 2 }),
  );

  assert.ok(result);
  assert.deepEqual(result.sourceChords.map((c) => c.t), [0, 10]);
  const firstSus = [...new Set(result.notes.filter((n) => n.t === 0).map((n) => n.sus))];
  assert.deepEqual(firstSus, [2]); // one window long, not 10
  assert.deepEqual(result.notes.filter((n) => n.t > 0 && n.t < 10), []);
});

test('stops the accompaniment where the melody ends (trailing silence)', async () => {
  const chordr = freshPlugin();
  const tokens = [{ start: 0, duration: 1, text: 'la', midi: 60 }];
  const payload = { schema_version: 1, voices: [{ id: 'primary', primary: true, tokens }] };

  const result = await withFetch(
    async () => ({ ok: true, json: async () => payload }),
    () => chordr.generateAccompanimentFromLyrics('song.sloppak', { windowSeconds: 2 }),
  );

  assert.ok(result);
  // The melody ends at t=1, inside the 2s window — the chord stops there
  // instead of filling the window's trailing silence.
  assert.deepEqual([...new Set(result.notes.map((n) => n.sus))], [1]);
});

test('falls back to the first voice when no voice is marked primary', async () => {
  const chordr = freshPlugin();
  const tokens = tokensFor([60, 64, 67], { startAt: 0, duration: 0.5 });
  const payload = { schema_version: 1, voices: [{ id: 'solo', tokens }] };

  const result = await withFetch(
    async () => ({ ok: true, json: async () => payload }),
    () => chordr.generateAccompanimentFromLyrics('song.sloppak'),
  );

  assert.ok(result);
  assert.equal(result.sourceChords[0].name, 'C');
});

test('instrument option is honored end to end (guitar accompaniment)', async () => {
  const chordr = freshPlugin();
  const tokens = tokensFor([60, 64, 67, 60], { startAt: 0, duration: 0.5 });
  const payload = { schema_version: 1, voices: [{ id: 'primary', primary: true, tokens }] };

  const result = await withFetch(
    async () => ({ ok: true, json: async () => payload }),
    () => chordr.generateAccompanimentFromLyrics('song.sloppak', { instrument: 'guitar' }),
  );

  assert.ok(result);
  assert.equal(result.instrument, 'guitar');
  assert.ok(Array.isArray(result.shapes) && result.shapes.length > 0);
});
