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

import logging
import tempfile
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

PLUGIN_ID = "chordr"
MAX_AUDIO_BODY_BYTES = 64 * 1024 * 1024  # 64 MB — generous for one song's audio

_CONTENT_TYPE_SUFFIX = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-wav": ".wav",
    "audio/flac": ".flac",
}


def setup(app: FastAPI, context: dict) -> None:
    log = context.get("log") or logging.getLogger(f"feedBack.plugin.{PLUGIN_ID}")
    audio_chords = context["load_sibling"]("audio_chords")

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

        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_AUDIO_BODY_BYTES:
                return JSONResponse(
                    {"error": "request body too large"}, status_code=413
                )
            body.extend(chunk)

        if not body:
            return JSONResponse({"error": "empty request body"}, status_code=400)

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
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(body)
                tmp_path = tmp.name
            # detect_chords (chroma-CQT over a full song) can take tens of
            # seconds — run it in FastAPI's threadpool, not inline on the
            # event loop, or it blocks every other request/WebSocket
            # (including this view's own /ws/highway/... lyrics connection)
            # for its whole duration.
            chords = await run_in_threadpool(audio_chords.detect_chords, tmp_path)
        except Exception as exc:
            log.exception("%s: chord detection failed", PLUGIN_ID)
            return JSONResponse(
                {"error": f"chord detection failed: {exc}"}, status_code=500
            )
        finally:
            if tmp_path:
                Path(tmp_path).unlink(missing_ok=True)

        return JSONResponse({"chords": chords})

    log.info("%s: routes registered", PLUGIN_ID)
