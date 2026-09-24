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

<!-- Add entries under Added, Changed, Deprecated, Removed, Fixed, or Security as changes land. -->
