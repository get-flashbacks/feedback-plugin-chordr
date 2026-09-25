// SPDX-License-Identifier: AGPL-3.0-or-later
const { test } = require('node:test');
const assert = require('node:assert/strict');

function chordr() {
  global.window = {};
  const path = require.resolve('../chordr/screen.js');
  delete require.cache[path];
  require(path);
  return global.window.chordr;
}

const event = (...pairs) => ({ notes: pairs.map(([s, f]) => ({ s, f })) });

test('partial voicings keep the full preceding chord as parent', () => {
  const events = [
    event([0, 0], [1, 2], [2, 2]),
    event([0, 0], [1, 2]),
    event([2, 2]),
    event([0, 0], [1, 3]),
  ];
  assert.deepEqual(chordr().groupChordEvents(events), [
    { parentIndex: 0, continuation: false },
    { parentIndex: 0, continuation: true },
    { parentIndex: 0, continuation: true },
    { parentIndex: 3, continuation: false },
  ]);
});

test('empty or malformed events do not inherit a parent', () => {
  assert.deepEqual(chordr().groupChordEvents([event([0, 0]), event(), event([0, 0])]), [
    { parentIndex: 0, continuation: false },
    { parentIndex: 1, continuation: false },
    { parentIndex: 2, continuation: false },
  ]);
  assert.deepEqual(chordr().groupChordEvents(null), []);
});
