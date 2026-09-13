# chorder

Chord names and diagrams generated from chart data, shown over the lyrics —
an Ultimate-Guitar-style chord/lyrics view for feedBack.

## Status

Early scaffold. Tracked work (see the repo's issues):

1. **Chord generator** (#1) — derive chord names from `getChords()` for
   charts that don't already carry named chord templates (GP imports and
   other unnamed sources). Implemented for guitar/bass: `identifyChord()`
   in `screen.js` builds the pitch-class set a chord's fretted notes
   produce (from `songInfo.tuning` + `songInfo.capo`) and matches it
   against a table of chord formulas (triads, 6ths, 7ths, 9ths, sus,
   add9), picking the richest formula fully contained in the played
   notes. Falls back to `"?"` when no formula matches or tuning data is
   unavailable. Piano/keys support is still open — the pitch-class math
   is instrument-agnostic, but nothing currently supplies fretted
   `chord.notes` for non-fretted arrangements.
2. **Auto diagrams** (#2) — the overlay already renders a diagram from
   `template.frets` when present; this issue covers synthesizing frets for
   chords the generator names but the source chart never diagrammed.
3. **Chord/lyrics view** (#3) — the current overlay only shows the current
   chord name + diagram, not the fuller "chords above lyrics" timeline view.
4. **ChordPro export** (#4) — export the resulting chord/lyrics data as a
   `.cho`/`.crd` file.
5. **[Backlog] Audio-based chord detection** (#5) — a fallback chord source
   for charts with no usable note/chord data at all.

## Architecture

- `screen.js` — overlay (not a `setRenderer` viz plugin): its own DOM, own
  rAF loop, reads chart data via the public highway getters
  (`getChords()`, `getChordTemplates()`, `getTime()`). Works regardless of
  which viz renderer is active, so it doesn't need the
  `isDefaultRenderer()` coordinate guard other overlays require.
- `routes.py` — persists display settings only, for now. Chord
  generation/diagram synthesis/ChordPro export run client-side until they
  need shared or heavier processing.

See the plugin spec for the general contract:
[feedback-plugin-spec](https://github.com/get-flashbacks/feedback-plugin-spec/blob/main/spec/plugin-spec-v1.md).

## License

AGPL-3.0-or-later. See the [LICENSE](../LICENSE) file.
