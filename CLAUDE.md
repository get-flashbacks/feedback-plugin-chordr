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

Neither consumer gates on a specific Chordr version — both detect the
capability's presence at call time (`getattr(app.state,
"chordr_analyze_chart_chords_v1", None)` / `chordr_analyzer is None`) and
handle its absence: `difficulty_ladder` returns HTTP 503 (see above),
`feedpakr` degrades to a warning and no-ops rather than failing the
build. This plugin's `plugin.json` is
currently at `0.5.4`; the chart-transform block has been declared in its
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

`_registerChartTransform()` in `screen.js` checks the resolved `status` of
each `dispatch()` call rather than only its resolve/reject outcome — core's
`static/capabilities.js` `dispatch()` resolves on failure (e.g.
`{status: 'no-owner'}` when nothing owns the capability), it does not
reject — and exposes the result via `window.chordr.getChartTransformStatus()`
(`"pending"` / `"active"` / `"registered"` / `"unavailable"`; see README's
Host compatibility section and chordr#21/#24). Any change to this
registration flow should preserve that status-checking, not just the
resolve/reject shape.

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

- **`minHost` is deliberately unset** (issue #21) — it used to carry a `1.0.0`
  placeholder matching no real dependency. Core does read the key and pass it
  through to `/api/plugins` as `min_host` (core's `plugins/__init__.py`:
  "passthrough only in R0 — enforcement is deferred to R4"), and unset is
  explicitly supported there, so absent means "no tested floor yet" — which is
  the honest state. Don't fill it in with a guess. `plugin.json`'s
  `hostRequirements` records the two tiers instead, and README's Host
  compatibility section is the source of truth: **analysis-only** operation
  (`window.chordr.*` helpers, the chord/lyrics view, audio detection, the
  server callable) has no core version floor identified — it needs
  `context.load_sibling`, plugin CSS, the highway chart getters, the
  `song:loaded` event, and `window.feedBack.currentSong`, none of which has been
  tied to a release, so it is untested rather than universally supported —
  while **automatic chart enrichment** needs core's chart-transform capability
  (feedBack#952), which landed in core commit `05be9eb` (2026-07-19, after the
  `v0.3.0-alpha.1` tag, which is core's only version tag).
  `hostRequirements` is documentation-only: no host code path reads it. When a
  tagged core release does identify a floor, add `minHost` back with that
  version and update both docs. Node.js ≥ 16.6 is a separate requirement,
  declared in `serverRequires` and enforced per-call in `routes.py`, not a core
  version concern.
- **The lyrics-view filename-resolution bug is fixed** (was referenced in
  the last line of issue #21's body: "the known lyrics-view filename bug
  is separate and cannot be fixed by raising minHost"). Two defects, one
  chain: `_connectLyricsSocket` bailed with `if (!songInfo ||
  !songInfo.filename || ...) return;`, but the real `song_info` WebSocket
  payload carries no `filename` field at all (it has `tuning`, `stringCount`,
  `capo`, `arrangement`, `audio_url`, etc.) — so the guard was always true
  and the lyrics socket never opened against a real host. Switching to
  `window.feedBack.currentSong.filename`/`.arrangementIndex` fixed the
  open, but NOT the reconnect: core assigns `currentSong` inside its
  `song_info` handler, one WebSocket round trip *after* `playSong` returns
  (core's CLAUDE.md Pitfall #1), so a read in the `playSong` wrapper
  subscribed to the song being left behind, or to nothing on the first song
  after the view was enabled. The reconnect is now driven by core's own
  `song:loaded` event — its `detail` *is* the `currentSong` object —
  subscribed while the view is active and removed on close; the `playSong`
  wrap keeps only its stale-state clear, since a `getSongInfo()` read there
  is stale in exactly the same way (the audio-detection path hid this by
  re-checking `audio_url` before attaching). If a future chord/lyrics
  overlay bug report looks similar, check it's not a regression of this fix
  before assuming it's a new issue or a `minHost` problem. The unit tests
  cover it by stubbing core's event bus and publishing `currentSong` only
  when a fake `song_info` lands — a suite that pre-seeds the field passes
  against a reconnect that reads it too early.

## Testing

```bash
node --test tests/*.test.js                                             # 81 pass
python3 -m pip install -r tests/requirements.txt
python3 -m unittest discover -s tests -p 'test_*.py'                    # 18 pass
```

The JS suite has no third-party dependencies. `test_chart_bridge.py`
imports `fastapi` at module top, so `python3 -m pip install -r
tests/requirements.txt` is a real, documented prerequisite, not an
environment fluke. `fastapi` is deliberately absent from
`chordr/requirements.txt`: `chordr/routes.py` imports it at module
scope, but every feedBack host already runs FastAPI and installs the
plugin's requirements file on top of its own environment, so the host
supplies the package. This repo uses stdlib `unittest`, not pytest —
there's no `pytest.ini`/pytest requirement, so `python3 -m pytest` may
fail outright with `No module named pytest` depending on the sandbox. A
real assertion failure in either suite is always worth reading, not
dismissed as environment noise.

## Versioning

Bump `version` in `plugin.json` whenever a change is user-visible — same
convention as every other plugin in this org (cache-busts the served
JS/CSS URL). `CHANGELOG.md`'s `[Unreleased]` section should be updated
alongside.
