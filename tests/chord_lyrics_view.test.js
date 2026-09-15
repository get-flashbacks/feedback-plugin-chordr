'use strict';
// Coverage for the chord/lyrics view's internals (chordr#3) that
// window.chordr.buildLyricLines/findLineIndex don't already cover:
// chord-to-word assignment, render/update/clear DOM state transitions,
// the view loop's line-change vs. same-line branching, and the
// playSong wrapper's reconnect-on-song-change behavior.
//
// This module has no document/WebSocket/requestAnimationFrame of its
// own (screen.js runs in a real browser), so each test wires up the
// minimal fakes it needs rather than pulling in a DOM library — same
// zero-dependency style as the other test files in this directory.
const test = require('node:test');
const assert = require('node:assert/strict');

class FakeClassList {
  constructor() {
    this._classes = new Set();
    this.toggleCalls = 0;
  }
  toggle(cls, on) {
    this.toggleCalls++;
    if (on) this._classes.add(cls);
    else this._classes.delete(cls);
  }
  contains(cls) {
    return this._classes.has(cls);
  }
}

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.className = '';
    this.textContent = '';
    this.children = [];
    this.classList = new FakeClassList();
  }
  appendChild(child) {
    this.children.push(child);
  }
  set innerHTML(value) {
    if (value === '') this.children = [];
  }
}

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}
FakeWebSocket.instances = [];

function freshPlugin(windowExtras) {
  const player = new FakeElement('div');
  global.document = {
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => (id === 'player' ? player : null),
  };
  global.location = { protocol: 'https:', host: 'example.test' };
  global.requestAnimationFrame = () => 1;
  global.cancelAnimationFrame = () => {};
  global.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];

  global.window = Object.assign({ WebSocket: FakeWebSocket }, windowExtras);
  delete require.cache[require.resolve('../chordr/screen.js')];
  require('../chordr/screen.js');
  return global.window.chordr;
}

// Shared setup for tests that drive _viewLoop/_startView directly: a
// highway stub and a primed viewState, so each test only states what it
// overrides instead of repeating the same object literals.
function mockHighway(overrides) {
  return Object.assign(
    { getTime: () => 0, getChords: () => [], getChordTemplates: () => [] },
    overrides
  );
}

function initViewState(viewState, overrides) {
  Object.assign(
    viewState,
    {
      active: true,
      linesEl: new FakeElement('div'),
      lyricLines: [],
      lastRenderedLine: -1,
      renderedWords: [],
    },
    overrides
  );
}

function fakeAudioResponse(ok = true, blobType = 'audio/mpeg') {
  return { ok, blob: async () => ({ type: blobType }) };
}

function fakeJsonResponse(ok = true, json = {}) {
  return { ok, json: async () => json };
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

// ── _assignChordsToLine ─────────────────────────────────────────────

test('assignChordsToLine maps a chord to the nearest word at-or-before its time', () => {
  const chordr = freshPlugin();
  const line = {
    startT: 0,
    endT: 10,
    words: [
      { text: 'one', t: 0 },
      { text: 'two', t: 2 },
      { text: 'three', t: 4 },
    ],
  };
  const chords = [{ t: 2.5, id: 0, notes: [] }]; // lands after "two" (t=2), before "three" (t=4)
  const templates = [{ name: 'G' }];
  const marks = chordr._internal.assignChordsToLine(line, chords, templates, null);

  assert.equal(marks.get(1), 'G'); // word index 1 == "two"
  assert.equal(marks.size, 1);
});

test('assignChordsToLine ignores chords outside the line\'s [startT, endT) window', () => {
  const chordr = freshPlugin();
  const line = { startT: 5, endT: 10, words: [{ text: 'word', t: 5 }] };
  const chords = [
    { t: 4.9, notes: [] }, // before startT
    { t: 10, notes: [] }, // at endT (exclusive)
  ];
  const marks = chordr._internal.assignChordsToLine(line, chords, [], null);

  assert.equal(marks.size, 0);
});

test('assignChordsToLine concatenates multiple chords landing on the same word instead of overwriting', () => {
  const chordr = freshPlugin();
  const line = { startT: 0, endT: 10, words: [{ text: 'strum', t: 0 }] };
  const chords = [
    { t: 0, id: 0, notes: [] },
    { t: 0.5, id: 1, notes: [] }, // still nearest to the same (only) word
  ];
  const templates = [{ name: 'C' }, { name: 'G' }];

  const marks = chordr._internal.assignChordsToLine(line, chords, templates, null);

  assert.equal(marks.get(0), 'C G');
});

test('assignChordsToLine falls back to null (no mark) when the chord has no name and can\'t be identified', () => {
  const chordr = freshPlugin();
  const line = { startT: 0, endT: 10, words: [{ text: 'word', t: 0 }] };
  const chords = [{ t: 0, id: 0, notes: [] }];
  // templates[0] has no `name`, and identifyFromHighway(null highway, [] notes) -> null
  const marks = chordr._internal.assignChordsToLine(line, chords, [{}], null);

  assert.equal(marks.size, 0);
});

// ── _renderLine / _updateSungState / _clearLine ─────────────────────

test('renderLine builds one word element per word, with a chord label only on marked words', () => {
  const chordr = freshPlugin();
  const state = { linesEl: new FakeElement('div') };
  const line = { words: [{ text: 'hey', t: 0 }, { text: 'jude', t: 1 }] };
  const marks = new Map([[1, 'C']]);

  chordr._internal.renderLine(state, line, marks);

  assert.equal(state.linesEl.children.length, 2);
  assert.equal(state.renderedWords.length, 2);

  const [wordWrap0, wordWrap1] = state.linesEl.children;
  assert.equal(wordWrap0.children.length, 1); // just the text span, no chord label
  assert.equal(wordWrap1.children.length, 2); // chord label + text span
  assert.equal(wordWrap1.children[0].textContent, 'C');

  assert.deepEqual(
    state.renderedWords.map((w) => [w.t, w.sung]),
    [[0, false], [1, false]]
  );
});

test('renderLine does not add a trailing space to word text (spacing is CSS margin only)', () => {
  const chordr = freshPlugin();
  const state = { linesEl: new FakeElement('div') };
  const line = { words: [{ text: 'hey', t: 0 }] };

  chordr._internal.renderLine(state, line, new Map());

  const textEl = state.linesEl.children[0].children[0];
  assert.equal(textEl.textContent, 'hey');
});

test('updateSungState flips the class only on an actual sung/not-sung transition', () => {
  const chordr = freshPlugin();
  const el = new FakeElement('span');
  const state = { renderedWords: [{ el, t: 5, sung: false }] };

  chordr._internal.updateSungState(state, 4); // before word.t: no transition
  assert.equal(el.classList.toggleCalls, 0);
  assert.equal(state.renderedWords[0].sung, false);

  chordr._internal.updateSungState(state, 5); // crosses word.t: transition to sung
  assert.equal(el.classList.toggleCalls, 1);
  assert.equal(el.classList.contains('chordr-word-sung'), true);
  assert.equal(state.renderedWords[0].sung, true);

  chordr._internal.updateSungState(state, 6); // still sung: no further toggle
  assert.equal(el.classList.toggleCalls, 1);
});

test('clearLine empties the container and drops cached word refs', () => {
  const chordr = freshPlugin();
  const state = {
    linesEl: new FakeElement('div'),
    renderedWords: [{ el: new FakeElement('span'), t: 0, sung: true }],
  };
  state.linesEl.children.push(new FakeElement('span'));

  chordr._internal.clearLine(state);

  assert.equal(state.linesEl.children.length, 0);
  assert.deepEqual(state.renderedWords, []);
});

// ── _viewLoop ────────────────────────────────────────────────────────

test('viewLoop builds the line only on a line-index change, not on every call', () => {
  const chordr = freshPlugin();
  const { viewState } = chordr._internal;

  initViewState(viewState, { lyricLines: [{ startT: 0, endT: 10, words: [{ text: 'hi', t: 0 }] }] });
  global.window.highway = mockHighway({ getTime: () => 1 });

  chordr._internal.viewLoop();
  assert.equal(viewState.lastRenderedLine, 0);
  assert.equal(viewState.linesEl.children.length, 1);
  const builtChildren = viewState.linesEl.children;

  // Same line on the next call: no rebuild (same child array reference/length).
  global.window.highway.getTime = () => 2;
  chordr._internal.viewLoop();
  assert.equal(viewState.linesEl.children, builtChildren);
  assert.equal(viewState.linesEl.children.length, 1);
});

test('viewLoop clears the overlay when playback moves outside every line', () => {
  const chordr = freshPlugin();
  const { viewState } = chordr._internal;

  initViewState(viewState, { lyricLines: [{ startT: 5, endT: 8, words: [{ text: 'hi', t: 5 }] }] });
  // Start inside the line, to actually render something to clear.
  global.window.highway = mockHighway({ getTime: () => 5 });

  chordr._internal.viewLoop();
  assert.equal(viewState.lastRenderedLine, 0);
  assert.equal(viewState.linesEl.children.length, 1, 'sanity: the line was actually rendered first');

  // Now move outside every line's window (the gap after this line's endT).
  global.window.highway.getTime = () => 9;
  chordr._internal.viewLoop();

  assert.equal(viewState.lastRenderedLine, -1);
  assert.equal(viewState.linesEl.children.length, 0);
  assert.deepEqual(viewState.renderedWords, []);
});

// ── _startView ───────────────────────────────────────────────────────

test('startView returns false and does nothing when there is no highway yet', () => {
  const chordr = freshPlugin();
  global.window.highway = undefined;

  const started = chordr._internal.startView();

  assert.equal(started, false);
  assert.equal(chordr._internal.viewState.active, false);
});

test('startView returns false and is a no-op when the view is already active', () => {
  const chordr = freshPlugin();
  global.window.highway = mockHighway();
  const { viewState } = chordr._internal;
  initViewState(viewState); // already active
  const existingWrap = viewState.wrap;

  const started = chordr._internal.startView();

  assert.equal(started, false);
  assert.equal(viewState.wrap, existingWrap, 'must not build a second overlay / second rAF loop');
});

test('startView returns true and activates the view when a highway is present', () => {
  const chordr = freshPlugin();
  global.window.highway = mockHighway();

  const started = chordr._internal.startView();

  assert.equal(started, true);
  assert.equal(chordr._internal.viewState.active, true);
});

// ── playSong wrapper (chordr#3's reconnect-on-song-change) ──────────

test('the wrapped playSong resets lyrics state and opens a new lyrics socket when the view is active', async () => {
  let originalCalled = 0;
  const original = async (...args) => {
    originalCalled++;
    return args;
  };

  const chordr = freshPlugin({
    addEventListener: () => {},
    playSong: original,
    highway: {
      getSongInfo: () => ({ filename: 'song-2.sloppak', arrangement_index: 0 }),
    },
  });

  const { viewState } = chordr._internal;
  const staleSocket = new FakeWebSocket('wss://example.test/stale');
  viewState.active = true;
  viewState.ws = staleSocket;
  viewState.lyricLines = [{ startT: 0, endT: 1, words: [] }];

  assert.notEqual(global.window.playSong, original, 'playSong should have been wrapped at load time');

  await global.window.playSong('song-2.sloppak');

  assert.equal(originalCalled, 1, 'the original playSong must still run');
  assert.equal(staleSocket.closed, true, 'the previous song\'s lyrics socket must be closed');
  assert.deepEqual(viewState.lyricLines, [], 'stale lyrics must be cleared for the new song');
  assert.notEqual(viewState.ws, staleSocket, 'a new socket must replace the stale one');
  assert.equal(FakeWebSocket.instances.at(-1).url.includes('song-2.sloppak'), true);
});

test('the wrapped playSong does not touch the lyrics socket when the view is inactive', async () => {
  const original = async () => 'ok';
  const chordr = freshPlugin({
    addEventListener: () => {},
    playSong: original,
    highway: { getSongInfo: () => ({ filename: 'song.sloppak' }) },
  });

  const { viewState } = chordr._internal;
  viewState.active = false;
  viewState.ws = null;

  const result = await global.window.playSong();

  assert.equal(result, 'ok');
  assert.equal(viewState.ws, null);
  assert.equal(FakeWebSocket.instances.length, 0);
});

test('the wrapped playSong clears stale lyrics BEFORE awaiting the new song, not after', async () => {
  let resolveOriginal;
  const original = () => new Promise((resolve) => { resolveOriginal = resolve; });

  const chordr = freshPlugin({
    addEventListener: () => {},
    playSong: original,
    highway: { getSongInfo: () => ({ filename: 'song-2.sloppak' }) },
  });

  const { viewState } = chordr._internal;
  const staleSocket = new FakeWebSocket('wss://example.test/stale');
  viewState.active = true;
  viewState.ws = staleSocket;
  viewState.lyricLines = [{ startT: 0, endT: 1, words: [] }];

  const playSongPromise = global.window.playSong();

  // The new song's load hasn't resolved yet (original() is still
  // pending) — stale state must already be cleared so the overlay
  // doesn't keep showing the previous song's lyrics during the load.
  assert.equal(staleSocket.closed, true, 'stale socket must close before the new song finishes loading');
  assert.deepEqual(viewState.lyricLines, [], 'stale lyrics must clear before the new song finishes loading');
  assert.equal(FakeWebSocket.instances.length, 1, 'must not reconnect until the new song has actually loaded');

  resolveOriginal('done');
  await playSongPromise;

  assert.equal(FakeWebSocket.instances.length, 2, 'reconnects once the new song has loaded');
});

// ── _startView retries the playSong wrap (install-order race) ───────

test('startView retries wrapping playSong if it wasn\'t available at plugin load', () => {
  // No `playSong` in windowExtras: at load time, window.playSong isn't a
  // function yet, so _wrapPlaySongForView() no-ops (the install-order
  // race a real host can hit if this plugin's script runs before the
  // player binds window.playSong).
  const chordr = freshPlugin({ addEventListener: () => {} });
  assert.equal(typeof global.window.playSong, 'undefined');

  // By the time a user can toggle the view, the app is fully up.
  const original = async () => 'ok';
  global.window.playSong = original;
  global.window.highway = mockHighway();

  chordr._internal.startView();

  assert.notEqual(global.window.playSong, original, 'startView must retry the wrap');
});

// ── detectChordsFromAudio (chordr#5: audio-based fallback source) ──

test('detectChordsFromAudio fetches the audio then posts it, returning the detected chords', async () => {
  const chordr = freshPlugin();
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return calls.length === 1
      ? fakeAudioResponse()
      : fakeJsonResponse(true, { chords: [{ t: 0, name: 'C' }] });
  };

  const chords = await chordr.detectChordsFromAudio('/audio/song.mp3');

  assert.deepEqual(chords, [{ t: 0, name: 'C' }]);
  assert.equal(calls[0].url, '/audio/song.mp3');
  assert.equal(calls[1].url, '/api/plugins/chordr/detect_chords');
  assert.equal(calls[1].opts.method, 'POST');
});

test('detectChordsFromAudio returns null when the audio fetch fails', async () => {
  const chordr = freshPlugin();
  global.fetch = async () => fakeAudioResponse(false);

  assert.equal(await chordr.detectChordsFromAudio('/audio/song.mp3'), null);
});

test('detectChordsFromAudio returns null when the detect_chords endpoint fails', async () => {
  const chordr = freshPlugin();
  let n = 0;
  global.fetch = async () => {
    n++;
    return n === 1 ? fakeAudioResponse() : fakeJsonResponse(false);
  };

  assert.equal(await chordr.detectChordsFromAudio('/audio/song.mp3'), null);
});

test('detectChordsFromAudio fails soft on a network error', async () => {
  const chordr = freshPlugin();
  global.fetch = async () => { throw new Error('boom'); };

  assert.equal(await chordr.detectChordsFromAudio('/audio/song.mp3'), null);
});

test('detectChordsFromAudio returns null without an audioUrl', async () => {
  const chordr = freshPlugin();
  global.fetch = async () => { throw new Error('should not be called'); };

  assert.equal(await chordr.detectChordsFromAudio(null), null);
});

// ── maybeDetectChordsFromAudio (wiring into the view) ────────────────

test('maybeDetectChordsFromAudio does nothing when the chart already has chords', () => {
  const chordr = freshPlugin();
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; return fakeAudioResponse(); };
  const { viewState } = chordr._internal;
  initViewState(viewState);

  const highway = mockHighway({
    getChords: () => [{ t: 0, id: 0, notes: [] }],
    getSongInfo: () => ({ filename: 'a.sloppak', audio_url: '/audio/a.mp3' }),
  });

  chordr._internal.maybeDetectChordsFromAudio(highway);

  assert.equal(fetchCalled, false);
  assert.equal(viewState.audioChords, null);
});

test('maybeDetectChordsFromAudio populates viewState.audioChords when the chart has none', async () => {
  const chordr = freshPlugin();
  global.fetch = async (url) =>
    url.startsWith('/api/plugins/')
      ? fakeJsonResponse(true, { chords: [{ t: 1, name: 'G' }] })
      : fakeAudioResponse();

  const { viewState } = chordr._internal;
  initViewState(viewState);
  global.window.highway = mockHighway({
    getChords: () => [],
    getSongInfo: () => ({ filename: 'a.sloppak', audio_url: '/audio/a.mp3' }),
  });

  chordr._internal.maybeDetectChordsFromAudio(global.window.highway);
  await flushAsync();

  assert.deepEqual(viewState.audioChords, [{ t: 1, name: 'G' }]);
});

test('maybeDetectChordsFromAudio forces a re-render so the currently-displayed line picks up the newly-attached chords', async () => {
  // Detection resolves asynchronously, seconds in — by then the user is
  // almost always still on whatever line was already showing. Without
  // resetting lastRenderedLine, viewLoop's line-change gate would leave
  // that line rendered chord-less until the next line change.
  const chordr = freshPlugin();
  global.fetch = async (url) =>
    url.startsWith('/api/plugins/')
      ? fakeJsonResponse(true, { chords: [{ t: 1, name: 'G' }] })
      : fakeAudioResponse();

  const { viewState } = chordr._internal;
  initViewState(viewState, { lastRenderedLine: 0 }); // already showing line 0
  global.window.highway = mockHighway({
    getChords: () => [],
    getSongInfo: () => ({ filename: 'a.sloppak', audio_url: '/audio/a.mp3' }),
  });

  chordr._internal.maybeDetectChordsFromAudio(global.window.highway);
  await flushAsync();

  assert.equal(viewState.lastRenderedLine, -1);
});

test('maybeDetectChordsFromAudio discards a stale result if the song changed while detection was in flight', async () => {
  const chordr = freshPlugin();
  let resolveAudioFetch;
  global.fetch = async (url) => {
    if (url.startsWith('/api/plugins/')) return fakeJsonResponse(true, { chords: [{ t: 1, name: 'G' }] });
    return new Promise((resolve) => { resolveAudioFetch = () => resolve(fakeAudioResponse()); });
  };

  const { viewState } = chordr._internal;
  initViewState(viewState);
  const songA = mockHighway({
    getChords: () => [],
    getSongInfo: () => ({ filename: 'a.sloppak', audio_url: '/audio/a.mp3' }),
  });
  global.window.highway = songA;

  chordr._internal.maybeDetectChordsFromAudio(songA);

  // Song changes before the in-flight audio fetch resolves.
  global.window.highway = mockHighway({
    getChords: () => [],
    getSongInfo: () => ({ filename: 'b.sloppak', audio_url: '/audio/b.mp3' }),
  });

  resolveAudioFetch();
  await flushAsync();
  await flushAsync();

  assert.equal(viewState.audioChords, null, "must not attach song A's result once song B is active");
});

test('maybeDetectChordsFromAudio does not re-fetch for a song whose detection is already resolved', async () => {
  const chordr = freshPlugin();
  let fetchCalls = 0;
  global.fetch = async (url) => {
    fetchCalls++;
    return url.startsWith('/api/plugins/')
      ? fakeJsonResponse(true, { chords: [{ t: 1, name: 'G' }] })
      : fakeAudioResponse();
  };

  const { viewState } = chordr._internal;
  initViewState(viewState);
  const highway = mockHighway({
    getChords: () => [],
    getSongInfo: () => ({ filename: 'a.sloppak', audio_url: '/audio/a.mp3' }),
  });
  global.window.highway = highway;

  // First open: real detection runs (2 fetches — audio, then detect_chords).
  chordr._internal.maybeDetectChordsFromAudio(highway);
  await flushAsync();
  assert.equal(fetchCalls, 2);
  assert.deepEqual(viewState.audioChords, [{ t: 1, name: 'G' }]);

  // Simulate closing and reopening the view for the same song.
  viewState.audioChords = null;
  chordr._internal.maybeDetectChordsFromAudio(highway);
  await flushAsync();

  assert.equal(fetchCalls, 2, 'reopening the same song must reuse the cached result, not re-fetch');
  assert.deepEqual(viewState.audioChords, [{ t: 1, name: 'G' }]);
});

test('maybeDetectChordsFromAudio does not start a second detection while one is already in flight for the same song', async () => {
  const chordr = freshPlugin();
  let audioFetchCalls = 0;
  let resolveAudioFetch;
  global.fetch = async (url) => {
    if (url.startsWith('/api/plugins/')) return fakeJsonResponse(true, { chords: [{ t: 1, name: 'G' }] });
    audioFetchCalls++;
    return new Promise((resolve) => { resolveAudioFetch = () => resolve(fakeAudioResponse()); });
  };

  const { viewState } = chordr._internal;
  initViewState(viewState);
  const highway = mockHighway({
    getChords: () => [],
    getSongInfo: () => ({ filename: 'a.sloppak', audio_url: '/audio/a.mp3' }),
  });
  global.window.highway = highway;

  // Simulate closing and reopening the view before the first detection resolves.
  chordr._internal.maybeDetectChordsFromAudio(highway);
  chordr._internal.maybeDetectChordsFromAudio(highway);

  assert.equal(audioFetchCalls, 1, 'a second call while detection is in flight must not start a duplicate analysis');

  resolveAudioFetch();
  await flushAsync();
  await flushAsync();

  assert.deepEqual(viewState.audioChords, [{ t: 1, name: 'G' }]);
});

// ── viewLoop falls back to audioChords ───────────────────────────────

test('viewLoop falls back to audioChords when the chart has no chords', () => {
  const chordr = freshPlugin();
  const { viewState } = chordr._internal;
  initViewState(viewState, {
    lyricLines: [{ startT: 0, endT: 10, words: [{ text: 'hi', t: 0 }] }],
  });
  viewState.audioChords = [{ t: 0, name: 'Dm' }];

  global.window.highway = mockHighway({ getTime: () => 1, getChords: () => [] });

  chordr._internal.viewLoop();

  const wordWrap = viewState.linesEl.children[0];
  const chordLabel = wordWrap.children.find((c) => c.className === 'chordr-chord-label');
  assert.ok(chordLabel, 'expected a chord label built from the audio-detected chord');
  assert.equal(chordLabel.textContent, 'Dm');
});
