'use strict';
// Coverage for chorder#1's chord-identification algorithm (window.chorder).
// screen.js installs itself onto `global.window` with no DOM dependency, so
// tests just stub `window` before requiring and read the API off it.
// Runs under the org reusable CI as `node tests/chord_analysis.test.js`.
//
// String indexing follows lib/song.py / static/js/tuning-display.js's
// _TUNING_BASE_MIDI convention: index 0 = lowest string (low E on a
// standard 6-string), index 5 = highest (high e). Chord shapes below are
// written low-string-to-high-string to match.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshPlugin() {
    global.window = {};
    const file = path.join(__dirname, '..', 'chorder', 'screen.js');
    delete require.cache[require.resolve(file)];
    require(file);
    return global.window.chorder;
}

// Standard 6-string guitar, no tuning offsets / capo.
const STD_TUNING = [0, 0, 0, 0, 0, 0];

test('installs idempotently onto window.chorder', () => {
    // Simulate the Host re-executing screen.js on plugin reload: the same
    // `window` object persists, so __chorder_installed must gate the second
    // run and leave the original API object in place (not a fresh replacement).
    global.window = {};
    const file = path.join(__dirname, '..', 'chorder', 'screen.js');
    delete require.cache[require.resolve(file)];
    require(file);
    const first = global.window.chorder;

    delete require.cache[require.resolve(file)]; // force the file body to actually re-run
    require(file);

    assert.equal(global.window.chorder, first, 'a second install must not replace the API object (guarded by __chorder_installed)');
});

test('identifies an open C major chord (x32010)', () => {
    const chorder = freshPlugin();
    // 5th string fret3=C, 4th fret2=E, 3rd open=G, 2nd fret1=C, 1st open=E
    const chord = [
        { string: 1, fret: 3 },
        { string: 2, fret: 2 },
        { string: 3, fret: 0 },
        { string: 4, fret: 1 },
        { string: 5, fret: 0 },
    ];
    const result = chorder.identifyChord(chord, { tuning: STD_TUNING, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'C');
    assert.equal(result.quality, '');
    assert.equal(result.name, 'C');
    assert.equal(result.bass, null);
});

test('identifies an open A minor chord (x02210)', () => {
    const chorder = freshPlugin();
    // 5th open=A, 4th fret2=E, 3rd fret2=A, 2nd fret1=C, 1st open=E
    const chord = [
        { string: 1, fret: 0 },
        { string: 2, fret: 2 },
        { string: 3, fret: 2 },
        { string: 4, fret: 1 },
        { string: 5, fret: 0 },
    ];
    const result = chorder.identifyChord(chord, { tuning: STD_TUNING, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'A');
    assert.equal(result.quality, 'm');
    assert.equal(result.name, 'Am');
});

test('identifies a dominant 7th chord (G7)', () => {
    const chorder = freshPlugin();
    // 6th fret3=G, 5th fret2=B, 4th open=D, 3rd open=G, 1st fret1=F
    const chord = [
        { string: 0, fret: 3 },
        { string: 1, fret: 2 },
        { string: 2, fret: 0 },
        { string: 3, fret: 0 },
        { string: 5, fret: 1 },
    ];
    const result = chorder.identifyChord(chord, { tuning: STD_TUNING, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'G');
    assert.equal(result.quality, '7');
});

test('identifies a slash chord when the bass note is not the triad root', () => {
    const chorder = freshPlugin();
    // C/E: E in the bass (5th string fret7), C major triad above (G, C)
    const chord = [
        { string: 1, fret: 7 },  // E (bass)
        { string: 3, fret: 0 },  // G
        { string: 4, fret: 1 },  // C
    ];
    const result = chorder.identifyChord(chord, { tuning: STD_TUNING, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'C');
    assert.equal(result.bass, 'E');
    assert.equal(result.displayName, 'C/E');
});

test('respects capo offset', () => {
    const chorder = freshPlugin();
    // Open-C shape at capo 2 sounds as D major.
    const chord = [
        { string: 1, fret: 3 },
        { string: 2, fret: 2 },
        { string: 3, fret: 0 },
        { string: 4, fret: 1 },
        { string: 5, fret: 0 },
    ];
    const result = chorder.identifyChord(chord, { tuning: STD_TUNING, capo: 2, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'D');
    assert.equal(result.quality, '');
});

test('respects per-string tuning offsets (drop D)', () => {
    const chorder = freshPlugin();
    const dropD = [-2, 0, 0, 0, 0, 0]; // lowest string down a whole step
    // Open low string (now D) + open A string: a perfect 5th, D power chord.
    const chord = [
        { string: 0, fret: 0 },
        { string: 1, fret: 0 },
    ];
    const result = chorder.identifyChord(chord, { tuning: dropD, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'D');
    assert.equal(result.quality, '5');
});

test('returns null for a single note (no chord)', () => {
    const chorder = freshPlugin();
    const result = chorder.identifyChord([{ string: 0, fret: 0 }], { tuning: STD_TUNING, stringCount: 6 });
    assert.equal(result, null);
});

test('returns null for empty/invalid input', () => {
    const chorder = freshPlugin();
    assert.equal(chorder.identifyChord([], { tuning: STD_TUNING }), null);
    assert.equal(chorder.identifyChord(null, { tuning: STD_TUNING }), null);
});

test('returns null for an unidentifiable dissonant cluster', () => {
    const chorder = freshPlugin();
    // C, C#, D adjacent semitone cluster matches no quality in the table.
    const chord = [
        { string: 1, fret: 3 },  // C
        { string: 1, fret: 4 },  // C# (same string, fine for pure pitch math)
        { string: 1, fret: 5 },  // D
    ];
    const result = chorder.identifyChord(chord, { tuning: STD_TUNING, stringCount: 6 });
    assert.equal(result, null);
});

test('identifyPianoChord identifies chords from raw MIDI numbers', () => {
    const chorder = freshPlugin();
    // C major triad: C4=60, E4=64, G4=67
    const result = chorder.identifyPianoChord([60, 64, 67]);
    assert.ok(result);
    assert.equal(result.rootName, 'C');
    assert.equal(result.quality, '');
});

test('identifyFromHighway falls back to defaults without a highway instance', () => {
    const chorder = freshPlugin();
    delete global.window.highway;
    const chord = [
        { string: 1, fret: 3 },
        { string: 2, fret: 2 },
        { string: 3, fret: 0 },
        { string: 4, fret: 1 },
        { string: 5, fret: 0 },
    ];
    const result = chorder.identifyFromHighway(chord, null);
    assert.ok(result);
    assert.equal(result.rootName, 'C');
});

test('identifyFromHighway reads tuning/capo/stringCount off a live highway', () => {
    const chorder = freshPlugin();
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
    const result = chorder.identifyFromHighway(chord, fakeHighway);
    assert.ok(result);
    assert.equal(result.rootName, 'D'); // capo 2 shifts the open-C shape to D
});

test('baseOpenStringMidis uses the bass base for a 4-string bass but the 6-string base for a 4-string guitar voicing', () => {
    const chorder = freshPlugin();
    const bassBase = chorder.baseOpenStringMidis(4, true);
    const guitarVoicingBase = chorder.baseOpenStringMidis(4, false);
    assert.deepEqual(bassBase, [28, 33, 38, 43]);
    assert.deepEqual(guitarVoicingBase, [40, 45, 50, 55, 59, 64]);
});

// ── Real wire-format input ──────────────────────────────────────────────
// feedpak-spec §6.2/§6.3 and lib/song.py's note_to_wire/chord_note_to_wire
// serialize chord notes as { s, f }, not { string, fret } — the highway
// `chords` WS payload and highway_3d both read cn.s/cn.f. identifyChord
// must accept that real shape, not just the more readable one tests
// elsewhere in this file construct by hand.

test('identifies an open C major chord from real wire-shaped notes ({s, f})', () => {
    const chorder = freshPlugin();
    const chord = [
        { s: 1, f: 3 },
        { s: 2, f: 2 },
        { s: 3, f: 0 },
        { s: 4, f: 1 },
        { s: 5, f: 0 },
    ];
    const result = chorder.identifyChord(chord, { tuning: STD_TUNING, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'C');
    assert.equal(result.quality, '');
});

test('identifyChord tolerates a mix of {s, f} and {string, fret} notes in the same chord', () => {
    const chorder = freshPlugin();
    const chord = [
        { s: 1, f: 3 },
        { string: 2, fret: 2 },
        { s: 3, f: 0 },
        { string: 4, fret: 1 },
        { s: 5, f: 0 },
    ];
    const result = chorder.identifyChord(chord, { tuning: STD_TUNING, capo: 0, stringCount: 6 });
    assert.ok(result);
    assert.equal(result.rootName, 'C');
});

test('pitchFromBase rejects a note missing both s/f and string/fret instead of vacuously passing the range guard', () => {
    const chorder = freshPlugin();
    // NaN compares false against every bound, so a naive `string < 0 ||
    // string >= tuning.length` guard alone would silently let this through
    // and misattribute the note to the highest string's base pitch.
    const base = chorder.baseOpenStringMidis(6, false);
    const result = chorder.pitchFromBase(base, 0, STD_TUNING, undefined, undefined);
    assert.equal(result, null);
});

// ── Bass detection via arrangement_smart_name ───────────────────────────

test('identifyFromHighway detects bass via arrangement_smart_name even when the raw arrangement name omits "bass"', () => {
    const chorder = freshPlugin();
    const fakeHighway = {
        getSongInfo: () => ({
            tuning: [0, 0, 0, 0],
            capo: 0,
            arrangement: 'Low End',              // doesn't literally say "bass"
            arrangement_smart_name: 'Bonus Bass', // host-computed label does
        }),
        getStringCount: () => 4,
    };
    // Open low string (E) + a perfect 5th above (B, 2nd fret of the A
    // string) on a 4-string bass reads as E5; on a guitar-voicing
    // (6-string) base the same string/fret pair would resolve to entirely
    // different pitches.
    const chord = [
        { s: 0, f: 0 },
        { s: 1, f: 2 },
    ];
    const result = chorder.identifyFromHighway(chord, fakeHighway);
    assert.ok(result);
    assert.equal(result.rootName, 'E');
    assert.equal(result.quality, '5');
});
