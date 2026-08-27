# SPDX-License-Identifier: AGPL-3.0-or-later
"""Server routes for chorder.

v1 only persists display settings for the chord/lyrics overlay. Chord
generation, diagram synthesis, and ChordPro export are computed client-side
today and will move here once they need shared/heavier processing.
"""

import asyncio
import json
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

PLUGIN_ID = "chorder"
MAX_SETTINGS_BODY_BYTES = 16 * 1024
_DEFAULTS = {
    "show_diagram": True,
}


def _is_valid_setting(name: str, value: object) -> bool:
    if name == "show_diagram":
        return type(value) is bool
    return False


def setup(app: FastAPI, context: dict) -> None:
    config_dir = Path(context["config_dir"])
    log = context.get("log") or logging.getLogger(f"feedBack.plugin.{PLUGIN_ID}")
    config_file = config_dir / f"{PLUGIN_ID}.json"

    def _read() -> dict:
        if not config_file.exists():
            return dict(_DEFAULTS)
        try:
            data = json.loads(config_file.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return dict(_DEFAULTS)
            settings = dict(_DEFAULTS)
            for key, value in data.items():
                if _is_valid_setting(key, value):
                    settings[key] = value
            return settings
        except (OSError, ValueError) as exc:
            log.warning("%s: unreadable config, using defaults: %s", PLUGIN_ID, exc)
            return dict(_DEFAULTS)

    try:
        _read()
        log.info("%s: configuration validated", PLUGIN_ID)
    except Exception as exc:
        log.error("%s: configuration validation failed: %s", PLUGIN_ID, exc)
        raise

    @app.get(f"/api/plugins/{PLUGIN_ID}/settings")
    def get_settings() -> JSONResponse:
        return JSONResponse(_read())

    @app.post(f"/api/plugins/{PLUGIN_ID}/settings")
    async def set_settings(request: Request) -> JSONResponse:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                content_length_value = int(content_length)
                if content_length_value < 0 or content_length_value > MAX_SETTINGS_BODY_BYTES:
                    return JSONResponse(
                        {"error": "invalid or oversized request body"}, status_code=413
                    )
            except ValueError:
                return JSONResponse(
                    {"error": "invalid Content-Length header"}, status_code=400
                )

        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_SETTINGS_BODY_BYTES:
                return JSONResponse({"error": "request body too large"}, status_code=413)
            body.extend(chunk)

        try:
            incoming = json.loads(body)
        except (UnicodeDecodeError, ValueError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        if not isinstance(incoming, dict):
            return JSONResponse({"error": "body must be a JSON object"}, status_code=400)

        unknown_keys = incoming.keys() - _DEFAULTS.keys()
        if unknown_keys:
            return JSONResponse({"error": "body contains unknown settings"}, status_code=400)
        if not all(_is_valid_setting(key, value) for key, value in incoming.items()):
            return JSONResponse(
                {"error": "body contains invalid setting values"}, status_code=400
            )

        def _merge_and_persist() -> dict:
            merged = {**_read(), **incoming}
            config_dir.mkdir(parents=True, exist_ok=True)
            config_file.write_text(json.dumps(merged, indent=2), encoding="utf-8")
            return merged

        try:
            merged = await asyncio.to_thread(_merge_and_persist)
            log.info("%s: settings updated", PLUGIN_ID)
        except Exception as exc:
            log.error("%s: failed to write settings: %s", PLUGIN_ID, exc)
            return JSONResponse(
                {"error": f"failed to save settings: {exc}"}, status_code=500
            )

        return JSONResponse(merged)

    log.info("%s: routes registered", PLUGIN_ID)
