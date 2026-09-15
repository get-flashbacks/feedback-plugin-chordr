# SPDX-License-Identifier: AGPL-3.0-or-later
"""Audio-based chord detection (chordr#5): chroma-CQT + template matching,
the same general approach as https://github.com/Allensy/chord-matcher —
a fallback chord source for songs whose chart carries no note/chord data
to derive chords from at all (chordr#1/#2 already cover the common case:
chart data present, just unnamed).

The template-matching/smoothing logic (`classify_chroma_frame`,
`detect_chords_from_chroma`) is pure Python — no numpy/librosa — so it's
directly unit-testable against synthetic chroma vectors without needing
real audio fixtures. Only `detect_chords()`, the end-to-end entry point,
touches librosa.
"""

from __future__ import annotations

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Mirrors chordr/screen.js's CHORD_QUALITIES (ordered common-to-rare so a
# tie prefers the more common reading). Intervals are semitone offsets
# from the root; root (0) is always included.
CHORD_QUALITIES = [
    ("", [0, 4, 7]),
    ("m", [0, 3, 7]),
    ("7", [0, 4, 7, 10]),
    ("maj7", [0, 4, 7, 11]),
    ("m7", [0, 3, 7, 10]),
    ("sus4", [0, 5, 7]),
    ("sus2", [0, 2, 7]),
    ("dim", [0, 3, 6]),
    ("aug", [0, 4, 8]),
    ("6", [0, 4, 7, 9]),
    ("m6", [0, 3, 7, 9]),
    ("m7b5", [0, 3, 6, 10]),
    ("dim7", [0, 3, 6, 9]),
    ("add9", [0, 2, 4, 7]),
    ("9", [0, 2, 4, 7, 10]),
    ("maj9", [0, 2, 4, 7, 11]),
    ("m9", [0, 2, 3, 7, 10]),
    ("5", [0, 7]),
]


def _build_templates():
    """Precompute a 12-bin binary template vector + its Euclidean norm per
    (root, quality). A binary template's norm is just sqrt(popcount), no
    need to sum-of-squares it repeatedly at match time.
    """
    templates = []
    for root in range(12):
        for suffix, intervals in CHORD_QUALITIES:
            vec = [0.0] * 12
            for iv in intervals:
                vec[(root + iv) % 12] = 1.0
            templates.append((NOTE_NAMES[root] + suffix, vec, len(intervals) ** 0.5))
    return templates


_TEMPLATES = _build_templates()


def classify_chroma_frame(chroma_vec, min_energy=0.05, min_confidence=0.55, min_coverage=0.6):
    """Match one 12-bin chroma vector (e.g. one column of librosa's
    chroma_cqt output) against the chord template table.

    Returns (name, confidence), or (None, <score>) when the frame is
    silent (total energy below `min_energy`), doesn't match any template
    with at least `min_confidence` cosine similarity, or — plain cosine
    similarity alone doesn't penalize energy outside the matched
    template, so a dense/noisy frame (e.g. a drum hit) can still score
    deceptively high against some small template — when less than
    `min_coverage` of the frame's total energy actually falls within the
    best-matching template's own pitch classes.
    """
    total_energy = sum(chroma_vec)
    if total_energy < min_energy:
        return None, 0.0

    query_norm = sum(x * x for x in chroma_vec) ** 0.5
    if query_norm == 0:
        return None, 0.0

    best_name, best_score, best_dot = None, -1.0, 0.0
    for name, template, template_norm in _TEMPLATES:
        dot = sum(x * y for x, y in zip(chroma_vec, template))
        score = dot / (query_norm * template_norm) if template_norm else 0.0
        if score > best_score:
            best_name, best_score, best_dot = name, score, dot
    if best_score < min_confidence:
        return None, best_score

    # For a binary {0,1} template, the dot product IS the matched energy
    # (sum of chroma_vec's own values at the template's active bins) —
    # no need to walk the vector a second time to recompute it.
    if best_dot / total_energy < min_coverage:
        return None, best_score
    return best_name, best_score


def _smooth_labels(labels, min_run_frames):
    """Run-length-encode `labels` (one per frame; None = silence/
    unidentified), merging any run shorter than `min_run_frames` into the
    run before it (or dropping it if it's the first run) — a chord
    change shouldn't flicker every single frame, so an isolated
    misclassified frame is noise, not a real chord change.

    Returns a list of [label, start_frame_index, end_frame_index)] runs.
    """
    if not labels:
        return []
    runs = []
    for i, label in enumerate(labels):
        if runs and runs[-1][0] == label:
            runs[-1][2] = i + 1
        else:
            runs.append([label, i, i + 1])

    merged = []
    for run in runs:
        length = run[2] - run[1]
        if length < min_run_frames and merged:
            merged[-1][2] = run[2]
        elif length < min_run_frames:
            pass  # leading short blip with nothing to merge into — drop it.
        elif merged and merged[-1][0] == run[0]:
            # Absorbing a short blip can leave the run before it and the
            # run after it sharing the same label (e.g. C, [blip], C) —
            # coalesce them into one run rather than emitting a spurious
            # duplicate event for the "same" chord.
            merged[-1][2] = run[2]
        else:
            merged.append(list(run))
    return merged


def detect_chords_from_chroma(chroma, times, min_run_seconds=0.5):
    """chroma: a sequence of 12-length chroma vectors, one per analysis
    frame, time-ordered. times: parallel list of frame onset times in
    seconds (same length as chroma).

    Returns [{"t": float, "name": str}, ...] — one entry per detected
    chord segment. Silence/unidentified stretches are omitted entirely,
    the same convention the chart's own `chords` array uses (it only
    lists actual chord events).
    """
    if not chroma or len(chroma) != len(times):
        return []

    labels = [classify_chroma_frame(frame)[0] for frame in chroma]

    if len(times) >= 2:
        avg_frame_dur = (times[-1] - times[0]) / (len(times) - 1)
    else:
        avg_frame_dur = 0.0
    min_run_frames = (
        max(1, round(min_run_seconds / avg_frame_dur)) if avg_frame_dur > 0 else 1
    )

    runs = _smooth_labels(labels, min_run_frames)

    events = []
    for label, start_idx, _end_idx in runs:
        if label is None:
            continue
        events.append({"t": times[start_idx], "name": label})
    return events


def detect_chords(
    audio_path: str,
    sr: int = 22050,
    hop_length: int = 4096,
    duration: float | None = None,
):
    """Load `audio_path` and run chroma-CQT + template-matching chord
    detection end-to-end. Raises ImportError if librosa/numpy aren't
    importable (requirements.txt declares them; this only fires if the
    plugin's dependency install failed or hasn't completed yet).
    """
    import librosa
    import numpy as np

    y, _ = librosa.load(audio_path, sr=sr, mono=True, duration=duration)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
    times = librosa.frames_to_time(
        np.arange(chroma.shape[1]), sr=sr, hop_length=hop_length
    )

    # chroma is (12, n_frames); classify_chroma_frame wants one 12-vector
    # per frame, so transpose to (n_frames, 12).
    return detect_chords_from_chroma(chroma.T.tolist(), times.tolist())
