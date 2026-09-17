# SPDX-License-Identifier: AGPL-3.0-or-later
"""Coverage for chordr#5's chroma template-matching/smoothing logic
(chordr/audio_chords.py). classify_chroma_frame and
detect_chords_from_chroma are pure Python (no numpy/librosa), so these
tests use synthetic chroma vectors directly — no real audio needed.
Only detect_chords() itself (untested here) touches librosa.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "chordr"))

import audio_chords  # noqa: E402


def chroma_for(*pitch_classes):
    """A clean chroma vector with 1.0 at each given pitch class (0=C..11=B)."""
    vec = [0.0] * 12
    for pc in pitch_classes:
        vec[pc] = 1.0
    return vec


class ClassifyChromaFrameTests(unittest.TestCase):
    def test_identifies_a_clean_c_major_triad(self):
        name, score = audio_chords.classify_chroma_frame(chroma_for(0, 4, 7))
        self.assertEqual(name, "C")
        self.assertGreater(score, 0.9)

    def test_identifies_a_minor_triad(self):
        name, _ = audio_chords.classify_chroma_frame(chroma_for(9, 0, 4))  # Am (A, C, E)
        self.assertEqual(name, "Am")

    def test_identifies_a_dominant_7th(self):
        name, _ = audio_chords.classify_chroma_frame(chroma_for(7, 11, 2, 5))  # G7
        self.assertEqual(name, "G7")

    def test_returns_none_for_a_silent_frame(self):
        name, score = audio_chords.classify_chroma_frame([0.0] * 12)
        self.assertIsNone(name)
        self.assertEqual(score, 0.0)

    def test_returns_none_for_a_low_energy_frame_even_if_shaped_like_a_chord(self):
        vec = [x * 0.01 for x in chroma_for(0, 4, 7)]
        name, _ = audio_chords.classify_chroma_frame(vec, min_energy=0.05)
        self.assertIsNone(name)

    def test_returns_none_for_a_fully_dense_cluster_despite_high_cosine_similarity(self):
        # All 12 pitch classes active: plain cosine similarity alone
        # actually scores this above min_confidence against some
        # template (it doesn't penalize the vector's own unmatched
        # energy) — the min_coverage gate is what correctly rejects it.
        name, score = audio_chords.classify_chroma_frame(chroma_for(*range(12)))
        self.assertIsNone(name)
        self.assertGreaterEqual(score, 0.55, "sanity: this frame is a coverage rejection, not a confidence one")

    def test_matches_the_dense_bin0to11_summation_order_for_a_wrapping_root(self):
        # A root whose intervals wrap past bin 11 (e.g. root=10: bins
        # 10, 2, 6) sums those bins in a different order than the dense
        # 0..11 zip used to, unless _build_templates sorts the active
        # bins ascending — floating-point addition isn't associative, so
        # an unsorted sum can differ by a ULP and, with the strict `>`
        # tie-break, flip which of two near-tied templates wins. This
        # exact vector (C/E/G# aug, near-tied against another root's aug
        # template) regressed to "Eaug" instead of "Caug" before the fix.
        vec = [0.0] * 12
        vec[0] = 0.8806605959099073   # C
        vec[4] = 0.7897293341937999   # E
        vec[8] = 0.83418962891688     # G#
        name, _ = audio_chords.classify_chroma_frame(vec)
        self.assertEqual(name, "Caug")


class DetectChordsFromChromaTests(unittest.TestCase):
    def test_returns_one_event_per_stable_chord_segment(self):
        c_major = chroma_for(0, 4, 7)
        g_major = chroma_for(7, 11, 2)
        chroma = [c_major] * 5 + [g_major] * 5
        times = [i * 0.2 for i in range(10)]

        events = audio_chords.detect_chords_from_chroma(chroma, times, min_run_seconds=0.5)

        self.assertEqual([e["name"] for e in events], ["C", "G"])
        self.assertEqual(events[0]["t"], 0.0)
        self.assertEqual(events[1]["t"], times[5])

    def test_drops_a_single_frame_misclassification_blip(self):
        c_major = chroma_for(0, 4, 7)
        noise = chroma_for(*range(12))  # one dissonant frame in the middle
        chroma = [c_major] * 4 + [noise] + [c_major] * 4
        times = [i * 0.2 for i in range(9)]

        events = audio_chords.detect_chords_from_chroma(chroma, times, min_run_seconds=0.5)

        # The blip run is shorter than min_run_frames, so it's absorbed
        # into the surrounding C run rather than producing a spurious
        # second event (or a gap).
        self.assertEqual([e["name"] for e in events], ["C"])

    def test_omits_silence_from_the_output(self):
        c_major = chroma_for(0, 4, 7)
        silence = [0.0] * 12
        chroma = [silence] * 5 + [c_major] * 5
        times = [i * 0.2 for i in range(10)]

        events = audio_chords.detect_chords_from_chroma(chroma, times, min_run_seconds=0.5)

        self.assertEqual([e["name"] for e in events], ["C"])
        self.assertEqual(events[0]["t"], times[5])

    def test_returns_empty_list_for_empty_input(self):
        self.assertEqual(audio_chords.detect_chords_from_chroma([], []), [])

    def test_returns_empty_list_when_chroma_and_times_lengths_mismatch(self):
        self.assertEqual(
            audio_chords.detect_chords_from_chroma([chroma_for(0)], [0.0, 0.1]), []
        )


if __name__ == "__main__":
    unittest.main()
