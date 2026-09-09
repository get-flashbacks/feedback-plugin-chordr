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
runs as a background library only.

## `window.chordr` API

```js
window.chordr.identifyChord(chordNotes, {
  tuning,
  capo,
  stringCount,
  isBass,
});
window.chordr.identifyPianoChord(midiNotes);
window.chordr.identifyFromHighway(chordNotes, highway);
```

`identifyChord` accepts the real chart wire shape `[{ s, f }, ...]` and also
tolerates `{ string, fret }` objects. It returns `null` when the pitch-class
set does not match a supported chord quality. See `CHORD_QUALITIES` in
`chordr/screen.js`.

## Tests

```bash
node tests/chord_analysis.test.js
```

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
