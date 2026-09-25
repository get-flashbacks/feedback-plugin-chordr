# SPDX-License-Identifier: AGPL-3.0-or-later
"""Server routes for chordr.

chordr#5's audio-based chord detection endpoint — a fallback chord
source for songs whose chart has no note/chord data to derive chords
from at all. The browser already has the song's audio (song_info's
audio_url, same-origin regardless of source format — sloppak/loose-
folder/archive all resolve to a playable URL), so it uploads the raw
bytes here rather than this plugin trying to re-resolve format-specific
audio paths itself.
"""

import json
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

PLUGIN_ID = "chordr"
MAX_AUDIO_BODY_BYTES = 64 * 1024 * 1024  # 64 MB — generous for one song's audio
# Bounds decoded PCM duration, independent of MAX_AUDIO_BODY_BYTES: a
# low-bitrate file well under the body-size cap can still decode into
# hours of audio, and librosa.load(duration=None) would materialize all
# of it before CQT adds further CPU/memory pressure. 15 minutes covers
# any real song with headroom.
MAX_AUDIO_DURATION_SECONDS = 900.0

_CONTENT_TYPE_SUFFIX = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-wav": ".wav",
    "audio/flac": ".flac",
}

_NODE_MIN_VERSION = (16, 6)
_NODE_REQUIRED_MESSAGE = "Node.js >= 16.6 is required for chordr chart analysis"


def _node_meets_min_version(node_path: str) -> bool:
    """True when the resolved node binary is at least Node 16.6.

    The bridge's language features (Array.prototype.at, optional
    chaining, nullish coalescing) need that floor, so fail up front with
    a clear message rather than surfacing a SyntaxError at analysis time.
    A node that exists but can't report a version is treated as old.
    """
    out = subprocess.run(
        [node_path, "--version"], text=True, capture_output=True, timeout=20,
        check=False,
    ).stdout.strip()
    try:
        major, minor = (int(part) for part in out.lstrip("v").split(".")[:2])
    except (ValueError, AttributeError):
        return False
    return (major, minor) >= _NODE_MIN_VERSION


def setup(app: FastAPI, context: dict) -> None:
    log = context.get("log") or logging.getLogger(f"feedBack.plugin.{PLUGIN_ID}")
    audio_chords = context["load_sibling"]("audio_chords")

    def analyze_chart_chords(chords: list, *, context: dict | None = None,
                             templates: list | None = None) -> dict:
        """Versioned service for server-side sibling consumers.

        Chordr's browser implementation remains the single source of truth:
        the small Node bridge invokes that implementation in one batch. This
        call runs a blocking Node subprocess (bounded to ~20s by timeout) and
        needs Node.js >= 16.6 on the host, so consumers must invoke it via
        `fastapi.concurrency.run_in_threadpool` (or from a sync `def` route)
        rather than inline in an `async def` handler — same event-loop rule
        detect_chords documents below. This service only analyzes chart data
        and never changes a pack.
        """
        if not isinstance(chords, list) or len(chords) > 100_000:
            raise ValueError("invalid chord list")
        payload = json.dumps({"chords": chords, "context": context or {},
                              "templates": templates or []})
        if len(payload) > 8_000_000:
            raise ValueError("chord analysis input too large")
        node = shutil.which("node")
        if node is None or not _node_meets_min_version(node):
            raise RuntimeError(_NODE_REQUIRED_MESSAGE)
        node_executable = Path(node).resolve(strict=True)
        bridge = Path(__file__).with_name("analyze_cli.js").resolve(strict=True)
        # Both argv paths come from the trusted installation, not chart input.
        # Keep shell=False, bound stdin size, and enforce a timeout: the only
        # untrusted material reaches Node as JSON on stdin, never as a command.
        result = subprocess.run(
            [str(node_executable), str(bridge)],
            input=payload, text=True, capture_output=True, timeout=20, check=False,
        )
        if result.returncode != 0:
            raise RuntimeError("chordr chart analysis failed")
        return json.loads(result.stdout)

    app.state.chordr_analyze_chart_chords_v1 = analyze_chart_chords

    @app.post(f"/api/plugins/{PLUGIN_ID}/detect_chords")
    async def detect_chords(request: Request) -> JSONResponse:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                content_length_value = int(content_length)
            except ValueError:
                return JSONResponse(
                    {"error": "invalid Content-Length header"}, status_code=400
                )
            if content_length_value < 0 or content_length_value > MAX_AUDIO_BODY_BYTES:
                return JSONResponse(
                    {"error": "invalid or oversized request body"}, status_code=413
                )

        try:
            import librosa  # noqa: F401
        except ImportError:
            return JSONResponse(
                {"error": "audio analysis dependencies not installed"},
                status_code=503,
            )

        content_type = (request.headers.get("content-type") or "").split(";")[0].strip()
        suffix = _CONTENT_TYPE_SUFFIX.get(content_type, ".audio")

        tmp_path = None
        total_bytes = 0
        try:
            # Stream chunks straight to disk rather than buffering the
            # whole body (up to MAX_AUDIO_BODY_BYTES) in memory first —
            # matters under concurrent requests.
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp_path = tmp.name
                async for chunk in request.stream():
                    total_bytes += len(chunk)
                    if total_bytes > MAX_AUDIO_BODY_BYTES:
                        return JSONResponse(
                            {"error": "request body too large"}, status_code=413
                        )
                    tmp.write(chunk)

            if total_bytes == 0:
                return JSONResponse({"error": "empty request body"}, status_code=400)

            # detect_chords (chroma-CQT over a full song) can take tens of
            # seconds — run it in FastAPI's threadpool, not inline on the
            # event loop, or it blocks every other request/WebSocket
            # (including this view's own /ws/highway/... lyrics connection)
            # for its whole duration.
            chords = await run_in_threadpool(
                audio_chords.detect_chords, tmp_path, duration=MAX_AUDIO_DURATION_SECONDS
            )
        except Exception:
            # Full exception detail goes to the log only — the response
            # stays generic so it doesn't leak internal paths, library
            # versions, or stack traces to the client.
            log.exception("%s: chord detection failed", PLUGIN_ID)
            return JSONResponse(
                {"error": "chord detection failed"}, status_code=500
            )
        finally:
            if tmp_path:
                Path(tmp_path).unlink(missing_ok=True)

        return JSONResponse({"chords": chords})

    log.info("%s: routes registered", PLUGIN_ID)
