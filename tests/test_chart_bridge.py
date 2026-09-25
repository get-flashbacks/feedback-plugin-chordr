# SPDX-License-Identifier: AGPL-3.0-or-later
"""Smoke tests for the fixed-script Node chart-analysis bridge."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "chordr"))

import routes  # noqa: E402


def _service():
    app = FastAPI()
    routes.setup(app, {"load_sibling": lambda _: object()})
    return app.state.chordr_analyze_chart_chords_v1


class ChartBridgeTests(unittest.TestCase):
    def test_chart_analysis_uses_fixed_bridge(self):
        result = _service()([], templates=[])
        self.assertEqual(result, {
            "grouped": [], "identities": [],
            "resolvedIdentities": [], "resolvedNames": [],
        })


def test_chart_analysis_reports_missing_node():
    with patch.object(routes.shutil, "which", return_value=None):
        with pytest.raises(RuntimeError, match="Node.js is required"):
            _service()([])
