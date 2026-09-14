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
  global.document = { createElement: (tag) => new FakeElement(tag) };
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

  viewState.active = true;
  viewState.linesEl = new FakeElement('div');
  viewState.lyricLines = [{ startT: 0, endT: 10, words: [{ text: 'hi', t: 0 }] }];
  viewState.lastRenderedLine = -1;
  viewState.renderedWords = [];

  global.window.highway = {
    getTime: () => 1,
    getChords: () => [],
    getChordTemplates: () => [],
  };

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

  viewState.active = true;
  viewState.linesEl = new FakeElement('div');
  viewState.lyricLines = [{ startT: 5, endT: 8, words: [{ text: 'hi', t: 5 }] }];
  viewState.renderedWords = [];

  global.window.highway = {
    getTime: () => 5, // inside the line first, to actually render something to clear
    getChords: () => [],
    getChordTemplates: () => [],
  };

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
