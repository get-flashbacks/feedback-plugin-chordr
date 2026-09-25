# chordr

Derives chord names and shapes from raw chart data (fret/string positions for
guitar/bass, MIDI key numbers for piano), for songs whose chart carries no
authored chord template. A shared capability other feedBack plugins consume
via `window.chordr`, rather than each re-implementing chord identification
on its own.

Scope of this plugin (tracked as separate issues, roughly in dependency order):

1. **Chord generator** (#1) — derive chord names/shapes from chart data
   (`getNotes()`/`getChords()`).
2. **Auto-generate chord diagrams** (#2, implemented) — fills in missing
   `chord_templates` entries (GP imports emit placeholder all -1 `frets`)
   by deriving a fret/string shape directly from the chord's chart notes
   and naming it via #1's identification. Registers as a
   [`chart-transform`](../feedBack/docs/capability-recipes.md#chart-transform-provider)
   provider so any renderer reading `highway.getChordTemplates()` picks up
   the generated diagrams automatically — no per-plugin integration needed.
3. **Ultimate-Guitar-style chord/lyrics view** (#3, implemented) — a player
   overlay ("🎤 Chords+Lyrics" in the v3 player control slot) showing the
   current lyrics line with chord names positioned above the nearest word.
   Opens its own short-lived WebSocket for the `lyrics` message (the one
   chart field with no highway getter); chords/templates come from
   `highway.getChords()`/`getChordTemplates()` as usual.
5. **Audio-based chord detection** (#5, implemented) — a fallback chord
   source for songs whose chart has no note/chord data at all (a
   loose-folder song, say). Server-side chroma-CQT + template matching
   (`chordr/audio_chords.py`, `librosa`), the same general approach as
   [Allensy/chord-matcher](https://github.com/Allensy/chord-matcher). The
   chord/lyrics view triggers it automatically — in the background, only
   when `highway.getChords()` is empty — by uploading the song's audio
   (fetched client-side from `songInfo.audio_url`, so it works uniformly
   across sloppak/loose-folder/archive sources without this plugin having
   to resolve format-specific audio paths itself) to
   `POST /api/plugins/chordr/detect_chords`.

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
window.chordr.groupChordEvents(chords);
window.chordr.generateChordTemplates(chords, existingTemplates, {
  tuning,
  capo,
  stringCount,
  isBass,
});
```

`identifyChord` accepts the real chart wire shape `[{ s, f }, ...]` and also
tolerates `{ string, fret }` objects. It returns `null` when the pitch-class
set does not match a supported chord quality. See `CHORD_QUALITIES` in
`chordr/screen.js`.

`groupChordEvents` returns a `{ parentIndex, continuation }` entry for every
chord event. A nonempty event whose played `{s,f}` notes are a subset of the
active preceding full chord retains that full chord's parent index, including
across several different partial strums. Other shapes start a new group;
unknown shapes are not guessed from pitch classes. The same analysis is
available to server-side plugins through the versioned
`app.state.chordr_analyze_chart_chords_v1(chords, context=...)` callable when
Chordr is active; it runs Chordr's JavaScript implementation in one Node
batch and returns `grouped` plus `identities` without modifying chart data.
That call is synchronous and blocking (a Node subprocess, bounded to ~20s),
so server consumers must invoke it via
`fastapi.concurrency.run_in_threadpool` or from a sync `def` route — not
inline in an `async def` handler — and the host needs Node.js >= 16.6.
`resolvedIdentities` inherits the parent chord's identity for otherwise
unnamed partial strums; a shape that is not a subset remains unresolved.
`resolvedNames` also uses an authored template name where one exists, so
Chordr need not support every unusual chord quality to retain that label.

`generateChordTemplates(chords, existingTemplates, ctx)` takes the wire-shape
`chords` array (`[{ id, notes: [{s,f}, ...] }, ...]`) and the current
`chord_templates` array, and returns a **new** array with any entry that
looks ungenerated (missing, or every `frets` value is the GP-import
placeholder `-1`) filled in with a derived `{ name, frets, fingers }` shape,
or `null` if nothing needed generating. This is also what the plugin's
`chart-transform` provider runs automatically on `song_info`/`chords` —
see below.

`buildLyricLines(lyricsData)` turns the raw `lyrics` WS message array
(`[{ w, t, d }, ...]`) into lines of words, honoring the wire format's
`-` (join to previous word) and `+` (line break) markers. Used internally
by the chord/lyrics view; exposed since any lyrics-consuming plugin needs
the same parsing.

`detectChordsFromAudio(audioUrl)` fetches the audio at `audioUrl` and
POSTs it to this plugin's own `/api/plugins/chordr/detect_chords` route
for chroma-based detection, returning `[{ t, name }, ...]` or `null` on
any failure (network error, no audio, detection failed — the caller just
has no chords for that song, same as a chart with none). The chord/lyrics
view calls it automatically as a fallback; exposed for any other
lyrics/chord-consuming plugin that wants the same source.

## Server routes

`POST /api/plugins/chordr/detect_chords` — body is the raw audio bytes
(any format `librosa`/`soundfile` can decode: mp3, ogg, wav, flac).
Returns `{"chords": [{"t": <seconds>, "name": <chord name>}, ...]}`, or
a 4xx/5xx with `{"error": "..."}` on a bad/oversized body, missing
`librosa`, or a decode/analysis failure. Detection
(`chordr/audio_chords.py`): `librosa.feature.chroma_cqt` per ~0.2s
analysis frame, each frame matched against a binary chord-quality
template table by cosine similarity (gated by both a minimum confidence
*and* a minimum coverage — cosine similarity alone doesn't penalize
energy outside the matched template, so a dense/noisy frame can still
score deceptively high against some small template), then run-length
smoothed (a single misclassified frame gets absorbed into its
neighbors) into chord segments.

## Tests

```bash
node tests/chord_analysis.test.js
node tests/generate_chord_templates.test.js
node tests/build_lyric_lines.test.js
node tests/chord_lyrics_view.test.js
node tests/group_chord_events.test.js
python3 -m unittest tests/test_audio_chords.py
python3 -m unittest tests/test_chart_bridge.py
```

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
