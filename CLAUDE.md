# Chordr — AI Agent Guide

Derives chord names and shapes from raw chart data (fret/string positions
for guitar/bass, MIDI key numbers for piano) — a shared capability other
feedBack plugins consume via `window.chordr` rather than each
re-implementing chord identification. See `README.md` for the full
`window.chordr` API and the numbered feature list (#1 generator, #2
auto-generated diagrams, #3 chord/lyrics overlay, #5 audio-based
detection); this file covers integration points and pitfalls an agent
needs that the README doesn't spell out.

## This plugin is a provider other plugins depend on

Chordr isn't just a standalone feature — it's infrastructure two other
plugins in this org call into directly, both as a *hard* dependency for
one specific feature each (not for their base operation):

- **`feedback-plugin-difficulty-ladder`**'s `POST
  /api/plugins/difficulty_ladder/analyze-chords` route (`routes.py:3319`)
  calls `app.state.chordr_analyze_chart_chords_v1` and returns HTTP 503 if
  it's absent — see that repo's `README.md` and issue #130.
- **`feedBack-plugin-feedpakr`**'s optional chord-naming enhancement
  (`build_feedpak(..., chordr_analyzer=..., enhance_chords=True)`) reads
  the same capability and degrades to a warning, not a failure, when it's
  missing — see that repo's `CLAUDE.md`.

Neither consumer gates on a specific Chordr version — both feature-detect
the capability's presence (`getattr(app.state,
"chordr_analyze_chart_chords_v1", None)` / `chordr_analyzer is None`) and
degrade gracefully when it's absent. This plugin's `plugin.json` is
currently at `0.5.1`; the chart-transform block has been declared in its
current canonical shape since `0.2.0` (commit `084e1b2`). If you change
what `chart-transform`/`analyze_chart_chords_v1` returns or how it's
registered, both of those repos' consuming code needs to be checked, not
just this one's tests.

## `chart-transform` capability registration (feedBack#952)

`plugin.json` declares `capabilities.chart-transform` with
`operations: ["chart.transform"]`, `mode: "active"`,
`ownership: "multi-provider"` — this is how #2 (auto-generated chord
diagrams) reaches every renderer automatically: any code reading
`highway.getChordTemplates()` picks up Chordr's fill-ins with zero
per-plugin integration, because core's chart-transform pipeline applies
registered providers before the chart reaches renderers. See
`../feedBack/docs/capability-recipes.md#chart-transform-provider` for the
registration contract this manifest block and `routes.py` implement
against.

## The Node subprocess bridge (`analyze_cli.js`)

`chordr/routes.py` shells out to `chordr/analyze_cli.js` via
`subprocess.run` (bounded to ~20s timeout) rather than re-implementing
chord analysis in Python — this is why `plugin.json` declares
`serverRequires: {"node": ">= 16.6"}` as a real runtime prerequisite, not
decoration. `_node_meets_min_version()` treats a `node` binary that
exists but can't report its version as too old (fails closed, not open).
If `node` isn't on `PATH` or fails the version check, the server-side
analysis path degrades — check the actual gating code in `routes.py`
before assuming a given host can run it.

## Known issues worth knowing before touching related code

- **`minHost: "1.0.0"` is a known-wrong placeholder** (issue #21) — it
  doesn't reflect any real dependency. The org-wide compatibility audit
  (`get-flashbacks/feedBack` issue #102) put the real floor for automatic
  chart enrichment at core commit `05be9eb` (chart-transform capability
  support); analysis-only helpers (`identifyChord`, etc., used standalone)
  work on older hosts. Don't treat `1.0.0` as accurate, and don't "fix" it
  to a single number without checking #21/#102's current state — the
  fix needs to distinguish analysis-only operation from automatic
  enrichment, not just pick one version.
- **A known lyrics-view filename-resolution bug exists** (referenced in
  the last line of issue #21's body: "the known lyrics-view filename bug
  is separate and cannot be fixed by raising minHost"; #21 is still open,
  with no comments). The root cause is in this repo: `_connectLyricsSocket`
  (`chordr/screen.js:593-595`) bails out with `if (!songInfo ||
  !songInfo.filename || ...) return;`, but the real `song_info` WebSocket
  payload carries no `filename` field at all (it has `tuning`,
  `stringCount`, `capo`, `arrangement`, `audio_url`, etc.) — so the guard
  is always true and the lyrics socket never opens against a real host.
  The audio-detection path a few lines down already works around this by
  keying its cache on `songInfo.audio_url` instead (`chordr/screen.js:646`,
  with a comment noting exactly this). The fix is to use the same
  `audio_url`-keyed approach, or `window.feedBack.currentSong.filename`
  (derived by core from the WS URL), not `songInfo.filename`. The unit
  tests don't catch this because they mock `getSongInfo` to return a
  `filename` field the real host never sends. If you're asked to raise
  `minHost` as a fix for a chord/lyrics overlay bug report, check whether
  it's actually this pre-existing, separately-tracked issue first — a
  version bump won't fix it.

## Testing

```bash
node --test tests/*.test.js                                             # 78 pass
python3 -m unittest tests/test_audio_chords.py tests/test_chart_bridge.py  # 18 pass
```

The JS suite has no third-party dependencies. `test_chart_bridge.py`
imports `fastapi` at module top — install it (`python3 -m pip install
fastapi`) if it's missing, since that's a real, documented prerequisite,
not an environment fluke. This repo uses stdlib `unittest`, not pytest —
there's no `pytest.ini`/pytest requirement, so `python3 -m pytest` may
fail outright with `No module named pytest` depending on the sandbox. A
real assertion failure in either suite is always worth reading, not
dismissed as environment noise.

## Versioning

Bump `version` in `plugin.json` whenever a change is user-visible — same
convention as every other plugin in this org (cache-busts the served
JS/CSS URL). `CHANGELOG.md`'s `[Unreleased]` section should be updated
alongside.
