'use strict';
// Coverage for chordr#3's lyrics-view line builder (window.chordr.buildLyricLines).
const test = require('node:test');
const assert = require('node:assert/strict');

function freshPlugin(windowExtras) {
    global.window = Object.assign({}, windowExtras);
    delete require.cache[require.resolve('../chordr/screen.js')];
    require('../chordr/screen.js');
    return global.window.chordr;
}

test('buildLyricLines splits on a trailing "+" into separate lines', () => {
    const chordr = freshPlugin();
    const data = [
        { w: 'Hello+', t: 0, d: 0.5 },
        { w: 'world', t: 1, d: 0.5 },
    ];
    const lines = chordr.buildLyricLines(data);

    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0].words.map((w) => w.text), ['Hello']);
    assert.deepEqual(lines[1].words.map((w) => w.text), ['world']);
});

test('buildLyricLines joins a leading "-" word to the previous word with no space', () => {
    const chordr = freshPlugin();
    const data = [
        { w: 'run', t: 0, d: 0.3 },
        { w: '-ning', t: 0.3, d: 0.3 },
    ];
    const lines = chordr.buildLyricLines(data);

    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].words.map((w) => w.text), ['running']);
});

test('buildLyricLines keeps the joined word\'s original onset time, not the suffix\'s', () => {
    const chordr = freshPlugin();
    const data = [
        { w: 'run', t: 1.5, d: 0.3 },
        { w: '-ning', t: 1.8, d: 0.3 },
    ];
    const lines = chordr.buildLyricLines(data);

    assert.equal(lines[0].words[0].t, 1.5);
});

test('buildLyricLines closes a trailing unterminated line (no final "+") with an open-ended endT', () => {
    const chordr = freshPlugin();
    const data = [{ w: 'last', t: 10, d: 0.5 }];
    const lines = chordr.buildLyricLines(data);

    assert.equal(lines.length, 1);
    assert.ok(lines[0].endT > lines[0].startT);
});

test('buildLyricLines returns an empty array for empty/absent input', () => {
    const chordr = freshPlugin();
    assert.deepEqual(chordr.buildLyricLines([]), []);
    assert.deepEqual(chordr.buildLyricLines(null), []);
});

test('buildLyricLines skips malformed entries without a string "w"', () => {
    const chordr = freshPlugin();
    const data = [
        { w: 'ok', t: 0, d: 0.2 },
        { t: 0.2, d: 0.2 },
        null,
    ];
    const lines = chordr.buildLyricLines(data);

    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].words.map((w) => w.text), ['ok']);
});

// Coverage for the chord/lyrics view's line lookup (window.chordr.findLineIndex),
// fixing two real bugs a review caught: showing line 0 before playback ever
// reaches it, and a line staying displayed past its own endT.
test('findLineIndex returns -1 before the first line has started', () => {
    const chordr = freshPlugin();
    const lines = [{ startT: 5, endT: 8 }, { startT: 8, endT: 12 }];

    assert.equal(chordr.findLineIndex(lines, 0), -1);
    assert.equal(chordr.findLineIndex(lines, 4.9), -1);
});

test('findLineIndex returns the line whose [startT, endT) window contains time', () => {
    const chordr = freshPlugin();
    const lines = [{ startT: 5, endT: 8 }, { startT: 8, endT: 12 }];

    assert.equal(chordr.findLineIndex(lines, 5), 0);
    assert.equal(chordr.findLineIndex(lines, 7.9), 0);
    assert.equal(chordr.findLineIndex(lines, 8), 1);
    assert.equal(chordr.findLineIndex(lines, 11.9), 1);
});

test('findLineIndex returns -1 during a gap between two lines, not the previous line', () => {
    const chordr = freshPlugin();
    const lines = [{ startT: 0, endT: 3 }, { startT: 5, endT: 8 }];

    assert.equal(chordr.findLineIndex(lines, 4), -1);
});

test('findLineIndex treats an open-ended (Infinity) endT as covering everything after startT', () => {
    const chordr = freshPlugin();
    const lines = [{ startT: 0, endT: 3 }, { startT: 5, endT: Infinity }];

    assert.equal(chordr.findLineIndex(lines, 1000), 1);
});

test('findLineIndex returns -1 for an empty lines array', () => {
    const chordr = freshPlugin();
    assert.equal(chordr.findLineIndex([], 5), -1);
});
