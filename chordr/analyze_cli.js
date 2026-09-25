// SPDX-License-Identifier: AGPL-3.0-or-later
// One-shot server bridge to the same chord logic used by the browser.
// Input/output are JSON on stdin/stdout; no chart files are read or written.
global.window = {};
require('./screen.js');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const chords = payload.chords;
    if (!Array.isArray(chords)) throw new Error('chords must be an array');
    const context = payload.context || {};
    const templates = Array.isArray(payload.templates) ? payload.templates : [];
    const grouped = window.chordr.groupChordEvents(chords);
    const identities = chords.map((chord) =>
      window.chordr.identifyChord(chord?.notes, context));
    const resolvedIdentities = grouped.map((group, index) =>
      identities[group.continuation ? group.parentIndex : index] || null);
    const names = chords.map((chord, index) => {
      const authored = templates[Number(chord?.id)]?.name;
      return (typeof authored === 'string' && authored.trim()) ||
        identities[index]?.displayName || null;
    });
    const resolvedNames = grouped.map((group, index) =>
      names[group.continuation ? group.parentIndex : index] || null);
    process.stdout.write(JSON.stringify({ grouped, identities, resolvedIdentities, resolvedNames }));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
});
