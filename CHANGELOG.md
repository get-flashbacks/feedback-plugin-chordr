# Changelog

## 0.5.0

- Add keys-first chord arrangement generation with two-hand MIDI voicings,
  slash-bass support, durations, and voice leading.
- Add guitar arrangement generation with tuning-aware playable fret shapes.
- Accept both audio detector `{t, name}` events and chart chord/template pairs.
- Add `generateAccompanimentFromLyrics(filename, options)`: a third
  arrangement-generation path that harmonizes a song's sung melody (read
  from lyrics_karaoke's canonical `/playback` payload) into a backing chord
  sequence — key estimation via a Krumhansl-Schmuckler-style pitch-class
  correlation, then a windowed best-fit diatonic triad per chord change —
  and feeds it into the existing keys/guitar generator. Covers a song whose
  only harmonic information is its vocal line: no chord chart, no full-mix
  audio worth chord-detecting.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `window.chordr.getChartTransformStatus()` reports whether the
  `chart-transform` provider is registered and currently selected on this
  host (`"pending"` / `"active"` / `"registered"` / `"unavailable"`).
  On a core that has the capabilities framework but no `chart-transform`
  owner registered (any build before `05be9eb`), every dispatch resolves
  a failure status (e.g. `{status: 'no-owner'}`) rather than rejecting,
  and this is now checked explicitly — the accessor reports
  `"unavailable"` and a single `console.warn` fires, instead of silently
  looking fully enabled. (A core with no capabilities framework at all
  never calls into this path in the first place — see README's Host
  compatibility section for that tier's `"pending"` floor.) README
  documents the resulting two-tier host-compatibility requirement
  (analysis-only vs. automatic enrichment) and the four-state status
  contract. (#21)
- Expose conservative chord-event grouping in `window.chordr.groupChordEvents`
  and a server-side analysis callable. Partial fret/string shapes remain
  attached to the preceding full chord, including across successive partial
  strums; unrelated or unknown shapes start a new group.
- Auto-generate chord diagrams for chords whose chart data carries no
  usable template (missing, or GP-import placeholder all `-1` frets) —
  `window.chordr.generateChordTemplates()` derives a fret/string shape
  from the chord's chart notes and a name via chord identification.
  Registered as a `chart-transform` provider (feedBack#952) so any
  renderer reading `highway.getChordTemplates()` picks up the generated
  diagrams automatically. (#2)
- Ultimate-Guitar-style chord/lyrics view: a player overlay ("🎤
  Chords+Lyrics" in the v3 player control slot) showing the current
  lyrics line with chord names positioned above the nearest word, and the
  already-sung words highlighted. Adds `window.chordr.buildLyricLines()`
  for parsing the `lyrics` WS message's `-`/`+` word-join/line-break
  markers. (#3)
- Audio-based chord detection: a fallback chord source for songs whose
  chart has no note/chord data at all. New `POST
  /api/plugins/chordr/detect_chords` route runs chroma-CQT + template
  matching (`librosa`) on uploaded audio; the chord/lyrics view triggers
  it automatically, client-side, only when the chart has no chords.
  Adds `window.chordr.detectChordsFromAudio()`. (#5)

### Changed

- `minHost` is now unset in `plugin.json` instead of carrying the `1.0.0`
  placeholder, which matched no real dependency (#21). Core reads the key and
  passes it through to `/api/plugins` as `min_host` (passthrough in the
  current release, enforcement deferred) and treats unset as a supported
  value, so absent is the honest "no tested floor yet" state — a version
  number here would be a guess. The requirement is recorded in a new
  `hostRequirements` block, splitting the two tiers: **analysis-only**
  operation — `window.chordr.*` helpers, the chord/lyrics view, audio
  detection, the server `chordr_analyze_chart_chords_v1(...)` callable — has
  no core version floor identified (it needs `context.load_sibling`, plugin
  CSS, the highway chart getters and the `song:loaded` event, none yet tied to
  a release, so it is untested rather than universally supported), while
  **automatic chart enrichment** additionally needs core's `chart-transform`
  capability (feedBack#952), which landed in core commit `05be9eb` (2026-07-19)
  — after `v0.3.0-alpha.1`, core's only version tag. `hostRequirements` is
  documentation-only (no host code path reads it); README's Host compatibility
  section is the source of truth. Node.js ≥ 16.6 stays a separate requirement
  in `serverRequires`. Add `minHost` back with a real version when a tagged
  core release identifies the floor.

### Fixed

- The chord/lyrics view (chordr#3) now actually opens its lyrics WebSocket
  on a real host, and reopens it for the right song. Two bugs, one root
  cause chain: `_connectLyricsSocket` guarded on
  `highway.getSongInfo().filename`, but the real `song_info` WS payload never
  carries a `filename` field, so the guard was always true and the socket
  never opened — the view silently never showed lyrics. Switching to
  `window.feedBack.currentSong.filename`/`.arrangementIndex` (core's own copy,
  the same source the audio-detection path already keys its cache on via
  `songInfo.audio_url`) fixed the open, but core publishes `currentSong` in
  its `song_info` handler — one WebSocket round trip *after* `playSong`
  returns — so a read in the `playSong` wrapper subscribed to the previous
  song's lyrics, or to nothing on the first song after the view was enabled.
  The reconnect is now driven by core's own `song:loaded` event (whose
  `detail` is that object), subscribed while the view is active; the
  `playSong` wrap keeps only its stale-state clear. Audio detection moved to
  the same event, off the stale read it happened to self-heal from. This
  defect never had an issue of its own: it was a paragraph in #21's body, and
  raising `minHost` never fixed it.
- Chord identification on piano/keys arrangements no longer misreads their
  MIDI-bucket-encoded `{s, f}` wire notes as guitar string+fret positions.
  Piano/keys arrangements (detected the same way `feedBack-plugin-piano`
  does) now decode `midi = s*24 + f` directly, and auto-generated chord
  templates for them no longer write a nonsense guitar fret diagram. Fixes
  a bug where an unnamed C major piano voicing was auto-named "D". (#19)

<!-- Add entries under Added, Changed, Deprecated, Removed, Fixed, or Security as changes land. -->
