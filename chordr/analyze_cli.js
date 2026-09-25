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
    // Mirror the browser path (identifyFromHighway): derive isBass/isPiano
    // from arrangement/arrangement_smart_name in `context` rather than
    // requiring every server-side caller to already know chordr's isPiano
    // option and pass it explicitly (chordr#19 follow-up — the fixed-script
    // bridge is a separate entry point from identifyFromHighway and was
    // still silently defaulting piano/keys chords onto the guitar decode
    // path). An explicit isBass/isPiano in `context` still wins.
    const arrangementContext = window.chordr.getArrangementContext(context);
    const resolvedContext = { ...arrangementContext, ...context };
    const templates = Array.isArray(payload.templates) ? payload.templates : [];
    const grouped = window.chordr.groupChordEvents(chords);
    const identities = chords.map((chord) =>
      window.chordr.identifyChord(chord?.notes, resolvedContext));
    const resolvedIdentities = grouped.map((group, index) =>
      identities.at(group.continuation ? group.parentIndex : index) || null);
    const names = chords.map((chord, index) => {
      const templateIndex = Number(chord?.id);
      const authored = Number.isSafeInteger(templateIndex) && templateIndex >= 0
        ? templates.at(templateIndex)?.name : null;
      return (typeof authored === 'string' && authored.trim()) ||
        identities.at(index)?.displayName || null;
    });
    const resolvedNames = grouped.map((group, index) =>
      names.at(group.continuation ? group.parentIndex : index) || null);
    process.stdout.write(JSON.stringify({ grouped, identities, resolvedIdentities, resolvedNames }));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
});
