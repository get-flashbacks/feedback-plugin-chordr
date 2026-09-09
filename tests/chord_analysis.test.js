'use strict';
// Coverage for chordr#1's chord-identification algorithm (window.chordr).
// screen.js installs itself onto `global.window` with no DOM dependency, so
// tests just stub `window` before requiring and read the API off it.
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

const STD_TUNING = [0, 0, 0, 0, 0, 0];

test('installs idempotently onto window.chordr', () => {
    global.window = {};
    const file = path.join(__dirname, '..', 'chordr', 'screen.js');
    delete require.cache[require.resolve(file)];
    require(file);
    const first = global.window.chordr;

    delete require.cache[require.resolve(file)];
    require(file);

    assert.equal(global.window.chordr, first, 'a second install must not replace the API object');
});

test('identifies an open C major chord (x32010)', () => {
    const chordr = freshPlugin();
    const chord = [
        { string: 1, fret: 3 },
        { string: 2, fret: 2 },
        { string: 3, fret: 0 },
        { string: 4, fret: 1 },
        { string: 5, fret: 0 },
    ];
    const result = chordr.identifyChord(chord, { tuning: STD_TUNING, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'C');
    assert.equal(result.quality, '');
    assert.equal(result.name, 'C');
    assert.equal(result.bass, null);
});

test('identifies an open A minor chord (x02210)', () => {
    const chordr = freshPlugin();
    const chord = [
        { string: 1, fret: 0 },
        { string: 2, fret: 2 },
        { string: 3, fret: 2 },
        { string: 4, fret: 1 },
        { string: 5, fret: 0 },
    ];
    const result = chordr.identifyChord(chord, { tuning: STD_TUNING, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'A');
    assert.equal(result.quality, 'm');
    assert.equal(result.name, 'Am');
});

test('identifies a dominant 7th chord (G7)', () => {
    const chordr = freshPlugin();
    const chord = [
        { string: 0, fret: 3 },
        { string: 1, fret: 2 },
        { string: 2, fret: 0 },
        { string: 3, fret: 0 },
        { string: 5, fret: 1 },
    ];
    const result = chordr.identifyChord(chord, { tuning: STD_TUNING, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'G');
    assert.equal(result.quality, '7');
});

test('identifies a slash chord when the bass note is not the triad root', () => {
    const chordr = freshPlugin();
    const chord = [
        { string: 1, fret: 7 },
        { string: 3, fret: 0 },
        { string: 4, fret: 1 },
    ];
    const result = chordr.identifyChord(chord, { tuning: STD_TUNING, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'C');
    assert.equal(result.bass, 'E');
    assert.equal(result.displayName, 'C/E');
});

test('respects capo offset', () => {
    const chordr = freshPlugin();
    const chord = [
        { string: 1, fret: 3 },
        { string: 2, fret: 2 },
        { string: 3, fret: 0 },
        { string: 4, fret: 1 },
        { string: 5, fret: 0 },
    ];
    const result = chordr.identifyChord(chord, { tuning: STD_TUNING, capo: 2, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'D');
    assert.equal(result.quality, '');
});

test('respects per-string tuning offsets (drop D)', () => {
    const chordr = freshPlugin();
    const dropD = [-2, 0, 0, 0, 0, 0];
    const chord = [
        { string: 0, fret: 0 },
        { string: 1, fret: 0 },
    ];
    const result = chordr.identifyChord(chord, { tuning: dropD, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'D');
    assert.equal(result.quality, '5');
});

test('returns null for a single note (no chord)', () => {
    const chordr = freshPlugin();
    assert.equal(chordr.identifyChord([{ string: 0, fret: 0 }], { tuning: STD_TUNING, stringCount: 6 }), null);
});

test('returns null for empty/invalid input', () => {
    const chordr = freshPlugin();
    assert.equal(chordr.identifyChord([], { tuning: STD_TUNING }), null);
    assert.equal(chordr.identifyChord(null, { tuning: STD_TUNING }), null);
});

test('returns null for an unidentifiable dissonant cluster', () => {
    const chordr = freshPlugin();
    const chord = [
        { string: 1, fret: 3 },
        { string: 1, fret: 4 },
        { string: 1, fret: 5 },
    ];
    assert.equal(chordr.identifyChord(chord, { tuning: STD_TUNING, stringCount: 6 }), null);
});

test('identifyPianoChord identifies chords from raw MIDI numbers', () => {
    const chordr = freshPlugin();
    const result = chordr.identifyPianoChord([60, 64, 67]);
    assert.ok(result);
    assert.equal(result.rootName, 'C');
    assert.equal(result.quality, '');
});

test('identifyFromHighway falls back to defaults without a highway instance', () => {
    const chordr = freshPlugin();
    delete global.window.highway;
    const chord = [
        { string: 1, fret: 3 },
        { string: 2, fret: 2 },
        { string: 3, fret: 0 },
        { string: 4, fret: 1 },
        { string: 5, fret: 0 },
    ];
    const result = chordr.identifyFromHighway(chord, null);
    assert.ok(result);
    assert.equal(result.rootName, 'C');
});

test('identifyFromHighway reads tuning/capo/stringCount off a live highway', () => {
    const chordr = freshPlugin();
    const fakeHighway = {
        getSongInfo: () => ({ tuning: [0, 0, 0, 0, 0, 0], capo: 2, arrangement: 'Lead' }),
        getStringCount: () => 6,
    };
    const chord = [
        { string: 1, fret: 3 },
        { string: 2, fret: 2 },
        { string: 3, fret: 0 },
        { string: 4, fret: 1 },
        { string: 5, fret: 0 },
    ];
    const result = chordr.identifyFromHighway(chord, fakeHighway);
    assert.ok(result);
    assert.equal(result.rootName, 'D');
});

test('baseOpenStringMidis uses the bass base for a 4-string bass but the 6-string base for a 4-string guitar voicing', () => {
    const chordr = freshPlugin();
    assert.deepEqual(chordr.baseOpenStringMidis(4, true), [28, 33, 38, 43]);
    assert.deepEqual(chordr.baseOpenStringMidis(4, false), [40, 45, 50, 55, 59, 64]);
});

test('identifies an open C major chord from real wire-shaped notes ({s, f})', () => {
    const chordr = freshPlugin();
    const chord = [
        { s: 1, f: 3 },
        { s: 2, f: 2 },
        { s: 3, f: 0 },
        { s: 4, f: 1 },
        { s: 5, f: 0 },
    ];
    const result = chordr.identifyChord(chord, { tuning: STD_TUNING, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'C');
    assert.equal(result.quality, '');
});

test('identifyChord tolerates a mix of {s, f} and {string, fret} notes in the same chord', () => {
    const chordr = freshPlugin();
    const chord = [
        { s: 1, f: 3 },
        { string: 2, fret: 2 },
        { s: 3, f: 0 },
        { string: 4, fret: 1 },
        { s: 5, f: 0 },
    ];
    const result = chordr.identifyChord(chord, { tuning: STD_TUNING, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'C');
});

test('pitchFromBase rejects a note missing both s/f and string/fret instead of vacuously passing the range guard', () => {
    const chordr = freshPlugin();
    const base = chordr.baseOpenStringMidis(6, false);
    assert.equal(chordr.pitchFromBase(base, 0, STD_TUNING, undefined, undefined), null);
});

test('identifyFromHighway detects bass via arrangement_smart_name even when the raw arrangement name omits "bass"', () => {
    const chordr = freshPlugin();
    const fakeHighway = {
        getSongInfo: () => ({
            tuning: [0, 0, 0, 0],
            capo: 0,
            arrangement: 'Low End',
            arrangement_smart_name: 'Bonus Bass',
        }),
        getStringCount: () => 4,
    };
    const chord = [
        { s: 0, f: 0 },
        { s: 1, f: 2 },
    ];
    const result = chordr.identifyFromHighway(chord, fakeHighway);
    assert.ok(result);
    assert.equal(result.rootName, 'E');
    assert.equal(result.quality, '5');
});
