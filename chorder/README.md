# chorder

Chord names and diagrams generated from chart data, shown over the lyrics —
an Ultimate-Guitar-style chord/lyrics view for feedBack.

## Status

Early scaffold. Tracked work (see the repo's issues):

1. **Chord generator** (#1) — derive chord names/shapes from `getNotes()` /
   `getChords()` for charts that don't already carry named chord templates
   (piano + guitar). The overlay in `chorder/screen.js` already reads
   `getChordTemplates()` for songs that *do* have named templates; this is
   the gap-filler for songs that don't.
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
