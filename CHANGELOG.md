# Changelog

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

<!-- Add entries under Added, Changed, Deprecated, Removed, Fixed, or Security as changes land. -->
