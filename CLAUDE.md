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

- **`feedback-plugin-difficulty-ladder`**'s `/group-chords` route calls
  `app.state.chordr_analyze_chart_chords_v1` and returns HTTP 503 if it's
  absent — see that repo's `CLAUDE.md` and issue #130.
- **`feedBack-plugin-feedpakr`**'s optional chord-naming enhancement
  (`build_feedpak(..., chordr_analyzer=..., enhance_chords=True)`) reads
  the same capability and degrades to a warning, not a failure, when it's
  missing — see that repo's `CLAUDE.md`.

Both consumers gate on Chordr **v0.5.0** as the first auditable version
that registers this capability. If you change what
`chart-transform`/`analyze_chart_chords_v1` returns or how it's
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
  issue #21's closing note: "the known lyrics-view filename bug is
  separate and cannot be fixed by raising minHost"). If you're asked to
  raise `minHost` as a fix for a chord/lyrics overlay bug report, check
  whether it's actually this pre-existing, separately-tracked issue
  first — a version bump won't fix it.

## Testing

```bash
node --test tests/*.test.js                                    # 70 pass
python3 -m pytest tests/test_audio_chords.py tests/test_chart_bridge.py   # 17 pass
```

Both suites run clean in this sandbox with no missing dependencies, unlike
some sibling repos in this org — if either starts failing on setup/import
errors rather than real assertions, suspect the environment before the
code.

## Versioning

Bump `version` in `plugin.json` whenever a change is user-visible — same
convention as every other plugin in this org (cache-busts the served
JS/CSS URL). `CHANGELOG.md`'s `[Unreleased]` section should be updated
alongside.
