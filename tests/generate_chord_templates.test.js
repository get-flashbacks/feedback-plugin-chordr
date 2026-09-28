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

// chordr#21/#24 — core's capabilities.js dispatch() RESOLVES on failure
// (e.g. {status:'no-owner'}), it does not reject, so these mocks return the
// real resolved shape (status + payload) rather than a bare {ok:true} —
// a mock that always "succeeds" by resolving would pass regardless of the
// status-checking logic under test.
function settle() {
    return Promise.resolve().then(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

test('registers a chart-transform provider on load when window.feedBack.capabilities is present', () => {
    const calls = [];
    const capabilities = {
        dispatch(msg) {
            calls.push(msg);
            if (msg.command === 'inspect') {
                return Promise.resolve({ status: 'applied', payload: { active: null } });
            }
            return Promise.resolve({ status: 'applied' });
        },
    };
    const chordr = freshPlugin({
        feedBack: { capabilities },
        addEventListener: () => {},
    });

    return settle().then(() => {
        const registerCall = calls.find((c) => c.command === 'register-provider');
        assert.ok(registerCall, 'expected a register-provider dispatch');
        assert.equal(registerCall.capability, 'chart-transform');
        assert.equal(typeof registerCall.payload.transform, 'function');

        const selectCall = calls.find((c) => c.command === 'select-provider');
        assert.ok(selectCall, 'expected select-provider once inspect reports no active provider');
        assert.equal(chordr.getChartTransformStatus(), 'active');
    });
});

test('does not select itself, and reports "registered", when another provider is already active', () => {
    const calls = [];
    const capabilities = {
        dispatch(msg) {
            calls.push(msg);
            if (msg.command === 'inspect') {
                return Promise.resolve({ status: 'applied', payload: { active: 'some_other_provider' } });
            }
            return Promise.resolve({ status: 'applied' });
        },
    };
    const chordr = freshPlugin({
        feedBack: { capabilities },
        addEventListener: () => {},
    });

    return settle().then(() => {
        const selectCall = calls.find((c) => c.command === 'select-provider');
        assert.equal(selectCall, undefined, 'must not override an already-active provider');
        assert.equal(chordr.getChartTransformStatus(), 'registered');
    });
});

test('getChartTransformStatus is "unavailable" (with a console.warn) when window.feedBack.capabilities has no dispatch', () => {
    // window.feedBack.capabilities being present (but non-functional) is what
    // makes _registerChartTransform() run synchronously at load instead of
    // waiting on the 'feedBack:capabilities:ready' event (a host with no
    // window.feedBack.capabilities at all never fires that event, so this
    // is the reachable "unavailable" case, not an untested one).
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);
    try {
        const chordr = freshPlugin({
            feedBack: { capabilities: {} },
            addEventListener: () => {},
        });
        assert.equal(chordr.getChartTransformStatus(), 'unavailable');
        assert.equal(warnings.length, 1, 'expected exactly one console.warn');
    } finally {
        console.warn = originalWarn;
    }
});

test('getChartTransformStatus is "unavailable", not "active", when dispatch resolves {status:"no-owner"}', () => {
    // Reproduces the pre-fix bug: a host with the capabilities framework
    // but no chart-transform owner registered (everything before core
    // 05be9eb) resolves every dispatch with a failure status rather than
    // rejecting the promise.
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);
    const capabilities = {
        dispatch() {
            return Promise.resolve({ status: 'no-owner' });
        },
    };
    const chordr = freshPlugin({
        feedBack: { capabilities },
        addEventListener: () => {},
    });
    return settle().then(() => {
        assert.equal(chordr.getChartTransformStatus(), 'unavailable');
        assert.ok(warnings.length >= 1, 'expected at least one console.warn');
    }).finally(() => {
        console.warn = originalWarn;
    });
});
