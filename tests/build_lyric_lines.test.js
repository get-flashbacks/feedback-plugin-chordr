'use strict';
// Coverage for chordr#3's lyrics-view line builder (window.chordr.buildLyricLines).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshPlugin(windowExtras) {
    global.window = Object.assign({}, windowExtras);
    const file = path.join(__dirname, '..', 'chordr', 'screen.js');
    delete require.cache[require.resolve(file)];
    require(file);
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
