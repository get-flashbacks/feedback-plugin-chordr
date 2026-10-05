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
window.chordr.generateChordArrangement(chords, {
  instrument: "keys", // default; or "guitar"
  duration: 180,
  chordTemplates,
});
await window.chordr.generateArrangementFromAudio(audioUrl, {
  instrument: "keys",
  duration: 180,
});
await window.chordr.generateAccompanimentFromLyrics(filename, {
  instrument: "keys", // default; or "guitar"
  arrangementIndex,   // optional — forwarded to lyrics_karaoke's /playback
  windowSeconds: 2,   // chord-change grid; smaller = more frequent changes
});
window.chordr.identifyFromHighway(chordNotes, highway);
window.chordr.groupChordEvents(chords);
window.chordr.generateChordTemplates(chords, existingTemplates, {
  tuning,
  capo,
  stringCount,
  isBass,
});
window.chordr.getChartTransformStatus(); // "pending" | "active" | "registered" | "unavailable"
```

`identifyChord` accepts the real chart wire shape `[{ s, f }, ...]` and also
tolerates `{ string, fret }` objects. It returns `null` when the pitch-class
set does not match a supported chord quality. See `CHORD_QUALITIES` in
`chordr/screen.js`.

`generateChordArrangement(chords, options)` turns named harmony events such as
`[{t: 0, name: "C"}, {t: 2, name: "G/B"}]` into a playable arrangement. Keys
is the default and primary output: each note is `{t, midi, sus, hand}` with a
compact right-hand voicing, a left-hand root/slash bass, and voice leading
between changes. `{instrument: "guitar"}` instead returns `{t, s, f, sus}`
notes plus the selected fret shapes. Chart chords without an inline `name` can
use `options.chordTemplates` (their `id` indexes that array), so the API works
with authored charts and the audio detector's named events alike. The function
does not mutate its inputs.

The result is deliberately an arrangement payload rather than an automatic
`chart-transform`: the host transform contract can replace notes but cannot
change instrument type or create a new arrangement. An editor/importer should
materialize this payload as a separate Keys or Guitar arrangement, leaving the
song's original part intact.

`generateArrangementFromAudio(audioUrl, options)` is the end-to-end fallback
for a song with no authored piano part: it runs Chordr's existing audio chord
detection and feeds those harmony events into the same keys-first generator.
It returns `null` if audio detection fails.

`generateAccompanimentFromLyrics(filename, options)` is a third generation
path for a song whose only harmonic signal is its sung melody — a Vocals
arrangement with synced lyrics and pitch, but no chord chart and no full-mix
audio worth running chord detection on. It fetches
[lyrics_karaoke's canonical `/playback` payload](https://github.com/get-flashbacks/feedback-plugin-lyrics-karaoke/blob/main/docs/architecture/vocals-playback-contract.md)
for `filename` (`options.arrangementIndex` is forwarded as that endpoint's
`arrangement` query param), takes the primary voice's pitched tokens, and
*harmonizes* them: it estimates a key center from the melody's duration-weighted
pitch-class distribution (a Krumhansl-Schmuckler-style correlation against
major/minor key profiles), then buckets the melody into `options.windowSeconds`
windows (default 2) and picks whichever diatonic triad of that key best
covers each window's notes. The resulting chord sequence is fed straight into
`generateChordArrangement`, so the same `instrument`/voicing options apply,
and the returned arrangement carries an extra `key: {root, mode}` field
describing what was detected. This is melody harmonization, not chord
detection — it invents a plausible backing, it does not recover a chord
progression that was actually played. Returns `null` when there is nothing
to harmonize from: the lyrics_karaoke route is unavailable or 404s, the
track is lyrics-only (no `midi` on any token), or the response's
`schema_version` isn't the one this function understands.
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

## Host compatibility

`minHost` is deliberately unset in `plugin.json` (it was a `1.0.0` placeholder
matching no real dependency — see [chordr#21](https://github.com/get-flashbacks/feedback-plugin-chordr/issues/21)).
Core reads the key and passes it through to `/api/plugins` as `min_host`
("passthrough only in R0 — enforcement is deferred to R4"), and unset is an
explicitly supported state, so leaving it out is a supported way to say "no
tested floor yet" — a made-up value would instead be a claim with no check
behind it. The requirement itself is recorded in the manifest's
`hostRequirements` block, which no host code path reads; this table is the
source of truth. Chordr has two tiers of host dependency, and a host that only
satisfies the first still loads the plugin and works for everything except
automatic diagram enrichment:

| Tier | What it needs | Requirement |
| --- | --- | --- |
| **Analysis-only** — `window.chordr.*` helpers, the chord/lyrics view, audio-based detection, the server `chordr_analyze_chart_chords_v1(...)` callable | `context.load_sibling` (backend), plugin CSS + highway chart getters (frontend), the `song:loaded` event and `window.feedBack.currentSong` (chord/lyrics view), Node.js ≥ 16.6 on the host for server-side chord analysis | No core version floor has been identified — the requirement is in those named core APIs, none of which has been tied to a release yet. Treat this tier as untested against any specific build, not as universally supported |
| **Automatic chart enrichment** — `chart-transform` provider registration so `highway.getChordTemplates()` picks up generated diagrams without any per-plugin integration | Core's chart-transform capability (feedBack#952) | Core commit [`05be9eb`](https://github.com/got-feedBack/feedBack/commit/05be9eb) or later — landed 2026-07-19, after the `v0.3.0-alpha.1` tag (2026-07-03), which is core's only version tag. No tagged core release contains it, so treat the commit hash as the floor until one does |

`window.chordr.getChartTransformStatus()` reports one of four states
(checked against each dispatch's resolved `status` — core's capability
dispatch *resolves* on failure, e.g. `{status: 'no-owner'}` when nothing
owns the capability at all, rather than rejecting, so "the promise chain
completed" is not by itself evidence of success). It's written once at
registration time and never revisited — it reflects how registration/
selection resolved, not live per-song rendering: core stages the transform
onto highway surfaces lazily (on `song:ready`/`highway:created`), and
Chordr's own transform can legitimately return no diagram for a chart it
doesn't need to enrich, so `"active"` is not proof any diagram has actually
rendered:

| Status | Meaning |
| --- | --- |
| `"pending"` | Registration hasn't resolved yet. This is also the **permanent** value on a core with no capabilities framework at all — that tier never calls `_registerChartTransform()` in the first place (it waits forever on an event only the framework emits), so it never reaches the `"unavailable"` branch or logs a warning |
| `"active"` | Core's chart-transform coordinator currently selects **this** provider |
| `"registered"` | Registered successfully, but not currently selected — either a different provider holds the selection (expected under `ownership: "multi-provider"`, not a warning), or this provider's own self-select attempt resolved non-success (also not a warning). Either way, this provider's diagrams are not live |
| `"unavailable"` | The capabilities framework is present but `register-provider`/`inspect`/`select-provider` resolved with a non-success status (typically: no `chart-transform` owner registered on this host) — logs a `console.warn` naming which step failed |

Analysis-only consumers (`window.chordr.*` outside this accessor, the
chord/lyrics view, audio detection) are unaffected by any of these states.

The lyrics-view filename-resolution bug once tracked here (`_connectLyricsSocket`
guarding on the nonexistent `songInfo.filename`) is fixed — see CHANGELOG's
`[Unreleased]` `### Fixed` entry.

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
node tests/generate_arrangement.test.js
node tests/generate_accompaniment_from_lyrics.test.js
node tests/build_lyric_lines.test.js
node tests/chord_lyrics_view.test.js
python3 -m unittest tests/test_audio_chords.py
node --test tests/*.test.js
python3 -m pip install -r tests/requirements.txt
python3 -m unittest discover -s tests -p 'test_*.py'
```

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
