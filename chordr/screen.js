// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Chordr: derives chord names/shapes from raw chart data (fret/string or
// piano key positions), for songs whose chart carries no authored chord
// template. This is the foundational piece (chordr#1) that later chordr
// features (auto-generated diagrams #2, the chord/lyrics view #3, ChordPro
// export #4) build on — a shared capability other plugins can consume via
// `window.chordr` instead of re-deriving chord identity themselves.
//
// No screen/UI of its own yet (plugin.json declares no "screen" key) — this
// runs globally as a background library, the same way difficulty_ladder
// exposes `window._ddCapabilities` for other plugins to read.

const PLUGIN_ID = "chordr";

// Guard against re-hydration: the Host may re-execute screen.js on plugin
// reload, so installation must be idempotent (spec best-practice / see
// feedBack-plugin-spec and every sibling plugin's CLAUDE.md for this pattern).
if (!window[`__${PLUGIN_ID}_installed`]) {
  window[`__${PLUGIN_ID}_installed`] = true;

  // ── Pitch tables ──────────────────────────────────────────────────────
  // Mirrors static/js/tuning-display.js's _TUNING_BASE_MIDI /
  // lib/song.py's _TUNING_BASE_MIDI so a derived chord root agrees with the
  // tuner + open-string labels app-wide. Index 0 = lowest string.
  const TUNING_BASE_MIDI = {
    4: [28, 33, 38, 43],
    5: [23, 28, 33, 38, 43],
    6: [40, 45, 50, 55, 59, 64],
    7: [35, 40, 45, 50, 55, 59, 64],
    8: [30, 35, 40, 45, 50, 55, 59, 64],
  };

  const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const NOTE_NAMES_FLAT  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

  // Standard open-string base MIDI list for an arrangement, index 0 = lowest.
  // Mirrors app.js `_tuningOffsetsToFreqs`: a 4/5-string bass uses its own
  // low base; a 4/5-string non-bass (a guitar voicing) borrows the low
  // strings of the 6-string base; 6/7/8 use their own. Unknown counts fall
  // back to the 6-string base.
  function baseOpenStringMidis(stringCount, isBass) {
    const n = Number(stringCount);
    if (n === 4 || n === 5) {
      return isBass ? TUNING_BASE_MIDI[n] : TUNING_BASE_MIDI[6];
    }
    return TUNING_BASE_MIDI[n] || TUNING_BASE_MIDI[6];
  }

  // Absolute sounding MIDI for one string+fret. `tuning` carries per-string
  // OFFSETS from standard (not absolute pitch) — see lib/song.py's
  // pitch_from_base, which this mirrors. Returns null when `string` has no
  // tuning/base entry.
  function pitchFromBase(base, capo, tuning, string, fret) {
    // Number.isInteger(NaN) is false, so a caller passing an undefined/
    // malformed string or fret (e.g. reading the wrong property name off a
    // note object) is rejected here explicitly, rather than `string < 0 ||
    // string >= tuning.length` silently passing — NaN compares false
    // against everything, so that range check alone would vacuously pass
    // and misattribute the note to whatever `base[base.length - 1]` is.
    if (!base || !base.length || !tuning || !Number.isInteger(string) ||
        string < 0 || string >= tuning.length || !Number.isFinite(fret)) {
      return null;
    }
    const root = string < base.length ? base[string] : base[base.length - 1];
    return root + Number(tuning[string] || 0) + Number(capo || 0) + fret;
  }

  function noteName(pitchClass, useFlats) {
    const names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
    return names[((pitchClass % 12) + 12) % 12];
  }

  // ── Chord quality table ──────────────────────────────────────────────
  // Interval sets are semitone offsets from the root, always including 0.
  // Ordered roughly common-to-rare so a tie (same-size interval-set match
  // against more than one quality) prefers the more common reading.
  const CHORD_QUALITIES = [
    { suffix: "",     intervals: [0, 4, 7] },
    { suffix: "m",    intervals: [0, 3, 7] },
    { suffix: "7",    intervals: [0, 4, 7, 10] },
    { suffix: "maj7", intervals: [0, 4, 7, 11] },
    { suffix: "m7",   intervals: [0, 3, 7, 10] },
    { suffix: "sus4", intervals: [0, 5, 7] },
    { suffix: "sus2", intervals: [0, 2, 7] },
    { suffix: "dim",  intervals: [0, 3, 6] },
    { suffix: "aug",  intervals: [0, 4, 8] },
    { suffix: "6",    intervals: [0, 4, 7, 9] },
    { suffix: "m6",   intervals: [0, 3, 7, 9] },
    { suffix: "m7b5", intervals: [0, 3, 6, 10] },
    { suffix: "dim7", intervals: [0, 3, 6, 9] },
    { suffix: "add9", intervals: [0, 2, 4, 7] },
    { suffix: "9",    intervals: [0, 2, 4, 7, 10] },
    { suffix: "maj9", intervals: [0, 2, 4, 7, 11] },
    { suffix: "m9",   intervals: [0, 2, 3, 7, 10] },
    { suffix: "5",    intervals: [0, 7] },
  ];

  function intervalSetKey(intervals) {
    return intervals.join(",");
  }
  const QUALITY_BY_KEY = new Map(
    CHORD_QUALITIES.map((q) => [intervalSetKey(q.intervals), q])
  );

  function identifyFromMidis(midis, opts) {
    const options = opts || {};
    const useFlats = !!options.useFlats;

    const sortedMidis = midis.slice().sort((a, b) => a - b);
    const pcSet = Array.from(new Set(sortedMidis.map((m) => ((m % 12) + 12) % 12)));
    if (pcSet.length < 2) return null;

    const bassPc = ((sortedMidis[0] % 12) + 12) % 12;
    const candidateRoots = [bassPc, ...pcSet.filter((pc) => pc !== bassPc)];

    for (const rootPc of candidateRoots) {
      const intervals = pcSet
        .map((pc) => ((pc - rootPc) % 12 + 12) % 12)
        .sort((a, b) => a - b);
      const quality = QUALITY_BY_KEY.get(intervalSetKey(intervals));
      if (quality) {
        const rootName = noteName(rootPc, useFlats);
        const isSlash = rootPc !== bassPc;
        return {
          root: rootPc,
          rootName,
          quality: quality.suffix,
          name: rootName + quality.suffix,
          bass: isSlash ? noteName(bassPc, useFlats) : null,
          displayName: isSlash ? `${rootName}${quality.suffix}/${noteName(bassPc, useFlats)}` : rootName + quality.suffix,
          pitchClasses: pcSet,
        };
      }
    }
    return null;
  }

  function identifyChord(chordNotes, ctx) {
    const options = ctx || {};
    if (!Array.isArray(chordNotes) || chordNotes.length === 0) return null;
    const capo = options.capo || 0;
    const stringCount = options.stringCount || (options.tuning && options.tuning.length) || 6;
    const tuning = options.tuning && options.tuning.length ? options.tuning : new Array(stringCount).fill(0);
    const base = baseOpenStringMidis(stringCount, !!options.isBass);

    const midis = [];
    for (const n of chordNotes) {
      if (!n || typeof n !== 'object') continue;
      const string = Number(n.s ?? n.string);
      const fret = Number(n.f ?? n.fret);
      const midi = pitchFromBase(base, capo, tuning, string, fret);
      if (midi !== null) midis.push(midi);
    }
    if (midis.length === 0) return null;
    return identifyFromMidis(midis, options);
  }

  function identifyPianoChord(midiNotes, opts) {
    if (!Array.isArray(midiNotes) || midiNotes.length === 0) return null;
    return identifyFromMidis(midiNotes, opts);
  }

  function identifyFromHighway(chordNotes, highway) {
    const hw = highway || window.highway;
    if (!hw || typeof hw.getSongInfo !== "function") {
      return identifyChord(chordNotes, {});
    }
    const songInfo = hw.getSongInfo() || {};
    const stringCount = typeof hw.getStringCount === "function" ? hw.getStringCount() : undefined;
    const isBass = /bass/i.test(`${songInfo.arrangement || ""} ${songInfo.arrangement_smart_name || ""}`);
    return identifyChord(chordNotes, {
      tuning: songInfo.tuning,
      capo: songInfo.capo,
      stringCount,
      isBass,
    });
  }

  window.chordr = {
    identifyChord,
    identifyPianoChord,
    identifyFromHighway,
    baseOpenStringMidis,
    pitchFromBase,
    noteName,
    CHORD_QUALITIES,
  };
}
