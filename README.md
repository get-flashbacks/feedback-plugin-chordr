# chordr

Derives chord names and shapes from raw chart data (fret/string positions for
guitar/bass, MIDI key numbers for piano), for songs whose chart carries no
authored chord template. A shared capability other feedBack plugins consume
via `window.chordr`, rather than each re-implementing chord identification
on its own.

Scope of this plugin (tracked as separate issues, roughly in dependency order):

1. **Chord generator** (#1, this is the piece implemented so far) — derive
   chord names/shapes from chart data (`getNotes()`/`getChords()`).
2. **Auto-generate chord diagrams** (#2) for songs/arrangements that don't
   have existing diagram data, built on top of #1's identification.
3. **Ultimate-Guitar-style chord/lyrics view** (#3).
4. **ChordPro export** (#4) for that chord/lyrics view.
5. **Audio-based chord detection** (#5, backlog) as a fallback source when
   there's no chart data to read at all.

No screen/UI yet — `plugin.json` declares no `screen`, so this currently
runs as a background library only (same pattern as `difficulty_ladder`
exposing `window._ddCapabilities`).

## `window.chordr` API

```js
// From chart-shaped chord notes — accepts the real wire format's
// chord.notes ([{ s, f }, ...], feedpak-spec §6.2/§6.3), and also
// tolerates the more readable { string, fret } shape:
window.chordr.identifyChord(chordNotes, {
  tuning,       // per-string OFFSET array, same shape as songInfo.tuning
  capo,         // fret count
  stringCount,  // bundle.stringCount (feedBack#93) — prefer this over tuning.length
  isBass,       // bool
});
// => { root, rootName, quality, name, bass, displayName, pitchClasses } | null

// From raw piano MIDI note numbers:
window.chordr.identifyPianoChord(midiNotes);

// Convenience: pulls tuning/capo/stringCount off a live highway instance
// (defaults to `window.highway` if none is passed).
window.chordr.identifyFromHighway(chordNotes, highway);
```

`identifyChord`/`identifyPianoChord` return `null` when there are fewer than
2 distinct pitch classes, or the pitch-class set doesn't exactly match any
entry in the internal chord-quality table (major/minor/7th/sus/dim/aug/6/9/
etc. — see `CHORD_QUALITIES` in `chordr/screen.js`) from any candidate root.
The bass note is tried as the root first (the common case); if no quality
matches with the bass as root but one does with another chord tone as root,
the result carries `bass` + a slash-chord `displayName` (e.g. `"C/E"`).

Pitch math (`baseOpenStringMidis`/`pitchFromBase`) mirrors
`lib/song.py`'s `base_open_string_midis`/`pitch_from_base` and
`static/js/tuning-display.js`'s `_TUNING_BASE_MIDI` in feedBack core, so a
derived chord root always agrees with the tuner and open-string labels
elsewhere in the app.

## Tests

```bash
node tests/chord_analysis.test.js
```

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
