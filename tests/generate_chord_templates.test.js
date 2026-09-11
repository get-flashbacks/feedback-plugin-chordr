'use strict';
// Coverage for chordr#2's auto-generated chord diagrams
// (window.chordr.generateChordTemplates + the chart-transform provider wiring).
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

test('generateChordTemplates fills a missing template with a derived shape and name', () => {
    const chordr = freshPlugin();
    const chords = [
        {
            id: 0,
            notes: [
                { s: 1, f: 3 },
                { s: 2, f: 2 },
                { s: 4, f: 1 },
            ],
        },
    ];
    const result = chordr.generateChordTemplates(chords, [], { tuning: [0, 0, 0, 0, 0, 0] });

    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].frets, [-1, 3, 2, -1, 1, -1]);
    assert.deepEqual(result[0].fingers, [-1, -1, -1, -1, -1, -1]);
    assert.equal(typeof result[0].name, 'string');
});

test('generateChordTemplates skips a chord whose template already has real fret data', () => {
    const chordr = freshPlugin();
    const existing = [{ name: 'C', frets: [-1, 3, 2, 0, 1, 0], fingers: [-1, 3, 2, 0, 1, 0] }];
    const chords = [{ id: 0, notes: [{ s: 1, f: 3 }] }];

    const result = chordr.generateChordTemplates(chords, existing, {});

    assert.equal(result, null, 'no change should be reported when nothing needed generating');
});

test('generateChordTemplates treats an all -1 frets template (GP import placeholder) as needing generation', () => {
    const chordr = freshPlugin();
    const existing = [{ name: 'C', frets: [-1, -1, -1, -1, -1, -1], fingers: [-1, -1, -1, -1, -1, -1] }];
    const chords = [{ id: 0, notes: [{ s: 1, f: 3 }, { s: 2, f: 2 }] }];

    const result = chordr.generateChordTemplates(chords, existing, {});

    assert.notEqual(result, null);
    assert.deepEqual(result[0].frets, [-1, 3, 2, -1, -1, -1]);
});

test('generateChordTemplates returns null for an empty/absent chords array', () => {
    const chordr = freshPlugin();
    assert.equal(chordr.generateChordTemplates([], [], {}), null);
    assert.equal(chordr.generateChordTemplates(null, [], {}), null);
});

test('generateChordTemplates ignores chords with a non-integer or negative id', () => {
    const chordr = freshPlugin();
    const chords = [
        { id: -1, notes: [{ s: 1, f: 3 }] },
        { id: 'x', notes: [{ s: 1, f: 3 }] },
    ];
    assert.equal(chordr.generateChordTemplates(chords, [], {}), null);
});

test('generateChordTemplates sizes shapes to a 4-string bass via stringCount', () => {
    const chordr = freshPlugin();
    const chords = [{ id: 0, notes: [{ s: 0, f: 3 }, { s: 3, f: 5 }] }];
    const result = chordr.generateChordTemplates(chords, [], { stringCount: 4, isBass: true });

    assert.equal(result[0].frets.length, 4);
    assert.deepEqual(result[0].frets, [3, -1, -1, 5]);
});

test('registers a chart-transform provider on load when window.feedBack.capabilities is present', () => {
    const calls = [];
    const capabilities = {
        dispatch(msg) {
            calls.push(msg);
            if (msg.command === 'inspect') {
                return Promise.resolve({ payload: { active: null } });
            }
            return Promise.resolve({ ok: true });
        },
    };
    freshPlugin({
        feedBack: { capabilities },
        addEventListener: () => {},
    });

    return Promise.resolve().then(() => {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }).then(() => {
        const registerCall = calls.find((c) => c.command === 'register-provider');
        assert.ok(registerCall, 'expected a register-provider dispatch');
        assert.equal(registerCall.capability, 'chart-transform');
        assert.equal(typeof registerCall.payload.transform, 'function');

        const selectCall = calls.find((c) => c.command === 'select-provider');
        assert.ok(selectCall, 'expected select-provider once inspect reports no active provider');
    });
});

test('does not select itself as the chart-transform provider when one is already active', () => {
    const calls = [];
    const capabilities = {
        dispatch(msg) {
            calls.push(msg);
            if (msg.command === 'inspect') {
                return Promise.resolve({ payload: { active: 'some_other_provider' } });
            }
            return Promise.resolve({ ok: true });
        },
    };
    freshPlugin({
        feedBack: { capabilities },
        addEventListener: () => {},
    });

    return Promise.resolve().then(() => {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }).then(() => {
        const selectCall = calls.find((c) => c.command === 'select-provider');
        assert.equal(selectCall, undefined, 'must not override an already-active provider');
    });
});
