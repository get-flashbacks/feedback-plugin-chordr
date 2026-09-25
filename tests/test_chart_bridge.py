# SPDX-License-Identifier: AGPL-3.0-or-later
"""Smoke tests for the fixed-script Node chart-analysis bridge."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "chordr"))

import routes  # noqa: E402


def _service():
    app = FastAPI()
    routes.setup(app, {"load_sibling": lambda _: object()})
    return app.state.chordr_analyze_chart_chords_v1


# A full power-chord shape followed by a single-note subset partial: the
# partial has no identity of its own (a one-note voicing is unidentifiable),
# so the resolved outputs must inherit from the parent's slot. Standard
# tuning: {s0,f0}/{s1,f2}/{s2,f2} = E2/B2/E3, which identifies as E5.
_FULL_CHORD = {"id": 0, "notes": [{"s": 0, "f": 0}, {"s": 1, "f": 2}, {"s": 2, "f": 2}]}
_PARTIAL = {"id": 1, "notes": [{"s": 0, "f": 0}]}
_TEMPLATES = [{"name": "Open E5", "frets": [0, 2, 2, -1, -1, -1]}]


class ChartBridgeTests(unittest.TestCase):
    def test_chart_analysis_uses_fixed_bridge(self):
        result = _service()([], templates=[])
        self.assertEqual(result, {
            "grouped": [], "identities": [],
            "resolvedIdentities": [], "resolvedNames": [],
        })

    def test_partial_voicing_inherits_parent_identity_and_name(self):
        result = _service()([_FULL_CHORD, _PARTIAL], templates=_TEMPLATES)
        self.assertEqual(result["grouped"], [
            {"parentIndex": 0, "continuation": False},
            {"parentIndex": 0, "continuation": True},
        ])
        self.assertEqual(result["identities"][0]["displayName"], "E5")
        self.assertIsNone(result["identities"][1])
        # The partial resolves to the parent's identity and authored name,
        # even though it can't be named on its own.
        self.assertEqual(result["resolvedIdentities"][1], result["identities"][0])
        self.assertEqual(result["resolvedNames"], ["Open E5", "Open E5"])

    def test_piano_arrangement_derives_isPiano_without_explicit_context_flag(self):
        # chordr#19 follow-up: the fixed-script bridge is a separate entry
        # point from the browser's identifyFromHighway and must derive
        # isPiano from `arrangement` itself rather than requiring every
        # server-side caller to already know and pass chordr's isPiano
        # option. C major (MIDI 60, 64, 67) encoded as piano wire notes
        # (s=floor(midi/24), f=midi%24) must resolve to C, not the guitar
        # string+fret misread of D.
        piano_chord = {
            "id": 0,
            "notes": [{"s": 2, "f": 12}, {"s": 2, "f": 16}, {"s": 2, "f": 19}],
        }
        result = _service()([piano_chord], context={"arrangement": "Piano"}, templates=[])
        self.assertEqual(result["identities"][0]["rootName"], "C")
        self.assertEqual(result["identities"][0]["displayName"], "C")

    def test_chart_analysis_reports_missing_node(self):
        with patch.object(routes.shutil, "which", return_value=None):
            with self.assertRaises(RuntimeError) as ctx:
                _service()([])
        self.assertIn("Node.js >= 16.6 is required", str(ctx.exception))

    def test_chart_analysis_reports_old_node_version(self):
        class _FakeResult:
            stdout = "v14.0.0\n"
            returncode = 0

        with patch.object(routes.subprocess, "run", return_value=_FakeResult()):
            with self.assertRaises(RuntimeError) as ctx:
                _service()([])
        self.assertIn("Node.js >= 16.6 is required", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
