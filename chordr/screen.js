(() => {
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

  // Same pattern feedBack-plugin-piano's matchesArrangement uses to claim an
  // arrangement (KEYS_PATTERNS in that plugin's screen.js) — kept identical
  // so "is this a piano/keys arrangement" agrees across both plugins.
  const KEYS_PATTERNS = /\b(?:keys|piano|keyboard|synth)\b/i;

  // Piano/keys arrangements reuse the guitar wire format's {s, f} fields to
  // carry a MIDI-bucket encoding (`midi = s*24 + f`, see
  // feedBack-plugin-piano's CLAUDE.md) — NOT a real string index + fret
  // number. Decoding it through the guitar tuning-table math in
  // pitchFromBase() silently produces a wrong pitch (chordr#19). `s` and
  // `f` are discrete bucket components, so a non-integer value (e.g. a
  // stray guitar-shaped fret) is rejected rather than producing a pitch
  // that looks valid but isn't.
  const midiFromPianoNote = (s, f) => {
    if (!Number.isInteger(s) || !Number.isInteger(f)) return null;
    return s * 24 + f;
  };

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
  const pitchFromBase = (base, capo, tuning, string, fret) => {
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
    const root = string < base.length ? base.at(string) : base.at(-1);
    return root + Number(tuning.at(string) || 0) + Number(capo || 0) + fret;
  };

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

    // Piano/keys: {s, f} is a MIDI bucket, not string+fret — decode it
    // directly instead of running it through the guitar tuning-table math.
    if (options.isPiano) {
      const midis = [];
      for (const n of chordNotes) {
        if (!n || typeof n !== 'object') continue;
        const s = Number(n.s ?? n.string);
        const f = Number(n.f ?? n.fret);
        const midi = midiFromPianoNote(s, f);
        if (midi !== null) midis.push(midi);
      }
      if (midis.length === 0) return null;
      return identifyFromMidis(midis, options);
    }

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

  // Group consecutive chord events by their played fret/string shape. A
  // voicing containing only notes of the active chord is a continuation of
  // that chord, even when an importer gave the partial its own unnamed
  // template. Keep the full parent shape active across repeated partials;
  // comparing only with the immediately previous partial would incorrectly
  // start a new group when the next strum selects different chord tones.
  // This is deliberately a physical-shape test, not a pitch-class guess:
  // an unfamiliar or inverted shape must remain a separate, reviewable event.
  const groupChordEvents = (chords) => {
    if (!Array.isArray(chords)) return [];
    const result = [];
    let parentIndex = -1;
    let parentShape = new Set();
    chords.forEach((chord, i) => {
      const shape = new Set();
      const notes = Array.isArray(chord?.notes) ? chord.notes : [];
      for (const note of notes) {
        const s = Number(note?.s ?? note?.string);
        const f = Number(note?.f ?? note?.fret);
        if (Number.isInteger(s) && s >= 0 && Number.isInteger(f) && f >= 0) {
          shape.add(`${s}:${f}`);
        }
      }
      const continuation = shape.size > 0 && parentShape.size > 0 &&
        [...shape].every((key) => parentShape.has(key));
      if (!continuation) {
        parentIndex = i;
        parentShape = shape;
      }
      result.push({ parentIndex, continuation });
    });
    return result;
  };

  function identifyPianoChord(midiNotes, opts) {
    if (!Array.isArray(midiNotes) || midiNotes.length === 0) return null;
    return identifyFromMidis(midiNotes, opts);
  }

  // ── Chord-to-arrangement generation ─────────────────────────────────
  // Chord detection tells us the harmony, but a playable keys/guitar part
  // still needs concrete pitches, octaves, durations and (for guitar)
  // string/fret choices. Keep that policy here as pure functions so an
  // editor/importer can materialise a NEW arrangement; chart-transform is
  // intentionally not used because it cannot change an arrangement's
  // instrument kind.

  const CHORD_INTERVALS_BY_SUFFIX = new Map(
    CHORD_QUALITIES.map((q) => [q.suffix.toLowerCase(), q.intervals])
  );

  function parseChordName(value) {
    const text = String(value || "").trim();
    if (!text || /^(n\.?c\.?|no\s*chord)$/i.test(text)) return null;
    const match = text.match(/^([A-Ga-g])([#b]?)([^/]*)?(?:\/([A-Ga-g])([#b]?))?$/);
    if (!match) return null;
    const pitchClass = (letter, accidental) => {
      const natural = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter.toUpperCase()];
      return (natural + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0) + 12) % 12;
    };
    let suffix = (match[3] || "").trim();
    const aliases = {
      min: "m", minor: "m", maj: "", major: "", M: "",
      "Δ": "maj7", "Δ7": "maj7", min7: "m7", "m7♭5": "m7b5",
      "°": "dim", "°7": "dim7", "+": "aug",
    };
    suffix = Object.prototype.hasOwnProperty.call(aliases, suffix) ? aliases[suffix] : suffix;
    const intervals = CHORD_INTERVALS_BY_SUFFIX.get(suffix.toLowerCase());
    if (!intervals) return null;
    const root = pitchClass(match[1], match[2]);
    return {
      name: text,
      root,
      bass: match[4] ? pitchClass(match[4], match[5]) : root,
      quality: suffix,
      intervals: intervals.slice(),
      pitchClasses: intervals.map((iv) => (root + iv) % 12),
    };
  }

  function _normaliseHarmonyEvents(chords, templates) {
    const out = [];
    for (const event of chords || []) {
      if (!event || !Number.isFinite(Number(event.t))) continue;
      const id = Number(event.id);
      const template = Array.isArray(templates) && Number.isInteger(id) ? templates[id] : null;
      const parsed = parseChordName(event.name || (template && template.name));
      if (parsed) out.push({ t: Math.max(0, Number(event.t)), chord: parsed });
    }
    out.sort((a, b) => a.t - b.t);
    // Multiple analysis frames can land at the same rounded onset. The last
    // one is the most recent decision and avoids zero-length generated notes.
    return out.filter((event, i) => i === out.length - 1 || event.t !== out[i + 1].t);
  }

  // Every chord lasts until the next onset; the trailing one lasts until
  // `lengthSeconds` (the arrangement's total length, so an audio path whose
  // last detected chord is short still fills its track). `defaultDuration` is
  // that trailing chord's own length, and is also the floor for it: a
  // `lengthSeconds` below the last onset extends nothing rather than
  // collapsing the final note to a sliver.
  function _eventDuration(events, index, options) {
    const start = events[index].t;
    const next = events[index + 1];
    const fallback = Math.max(0.1, Number(options.defaultDuration) || 2);
    const length = Number(options.lengthSeconds);
    const end = next ? next.t : Math.max(start + fallback, Number.isFinite(length) ? length : 0);
    return Math.max(0.1, end - start);
  }

  function _midiCandidates(pc, low, high) {
    const result = [];
    for (let midi = low; midi <= high; midi++) if (midi % 12 === pc) result.push(midi);
    return result;
  }

  function _bestRightHandVoicing(chord, previous, low, high) {
    const pcs = chord.pitchClasses;
    const candidates = pcs.map((pc) => _midiCandidates(pc, low, high));
    let best = null;
    const visit = (i, chosen) => {
      if (i === candidates.length) {
        const sorted = chosen.slice().sort((a, b) => a - b);
        if (new Set(sorted).size !== sorted.length || sorted.at(-1) - sorted[0] > 12) return;
        let score = sorted.reduce((sum, midi) => sum + Math.abs(midi - 64), 0) * 0.05;
        if (previous && previous.length) {
          score += sorted.reduce((sum, midi, idx) => sum + Math.abs(midi - previous[Math.min(idx, previous.length - 1)]), 0);
        }
        if (!best || score < best.score) best = { notes: sorted, score };
        return;
      }
      for (const midi of candidates[i]) visit(i + 1, [...chosen, midi]);
    };
    visit(0, []);
    return best ? best.notes : pcs.map((pc) => _midiCandidates(pc, low, high)[0]).filter(Number.isFinite);
  }

  function generateKeysArrangement(chords, options) {
    const opts = options || {};
    const events = _normaliseHarmonyEvents(chords, opts.chordTemplates);
    const low = Math.max(36, Math.min(67, Number(opts.rightHandLow) || 55));
    const high = Math.max(low + 12, Math.min(96, Number(opts.rightHandHigh) || 79));
    const leftLow = Math.max(21, Math.min(low - 1, Number(opts.leftHandLow) || 36));
    const leftHigh = Math.max(leftLow, Math.min(low - 1, Number(opts.leftHandHigh) || 52));
    const notes = [];
    let previous = null;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const sus = _eventDuration(events, i, opts);
      const right = _bestRightHandVoicing(event.chord, previous, low, high);
      const bassChoices = _midiCandidates(event.chord.bass, leftLow, leftHigh);
      const bass = bassChoices.length ? bassChoices.at(-1) : null;
      if (bass !== null) notes.push({ t: event.t, midi: bass, sus, hand: "lh" });
      for (const midi of right) notes.push({ t: event.t, midi, sus, hand: "rh" });
      previous = right;
    }
    return { instrument: "keys", notes, sourceChords: events.map((e) => ({ t: e.t, name: e.chord.name })) };
  }

  // Brute-forces the per-string fret combinations that sound the chord, scored
  // on bass note, span, muted strings and fret distance. `shapeCache` (a Map,
  // owned by the caller so it lives exactly as long as one generation call)
  // memoizes the winner per chord + instrument setup: this search dominates
  // the guitar path's cost, and a song repeats each chord symbol many times.
  function _bestGuitarShape(chord, options, shapeCache) {
    const stringCount = Number(options.stringCount) || 6;
    const tuning = options.tuning && options.tuning.length ? options.tuning : new Array(stringCount).fill(0);
    const isBass = !!options.isBass;
    // Search against the base the HOST decodes with (see
    // baseOpenStringMidis): a 4/5-string bass reads fifths, not the low six
    // guitar strings, so frets chosen against the guitar base sound a
    // different chord for a bass part. `capo` is added by the host on top of
    // base+tuning+fret, so the search stays capo-relative.
    const base = baseOpenStringMidis(stringCount, isBass);
    const maxFret = Math.max(3, Math.min(15, Number(options.maxFret) || 8));
    const wanted = new Set(chord.pitchClasses);
    const cacheKey = `${chord.pitchClasses.join(",")}/${chord.bass}/${stringCount}/${isBass}/${maxFret}/${tuning.join(",")}`;
    if (shapeCache && shapeCache.has(cacheKey)) return shapeCache.get(cacheKey);
    const choices = [];
    for (let s = 0; s < stringCount; s++) {
      const open = (base[s] ?? base.at(-1)) + Number(tuning[s] || 0);
      const frets = [-1];
      for (let f = 0; f <= maxFret; f++) if (wanted.has((open + f) % 12)) frets.push(f);
      choices.push(frets);
    }
    let best = null;
    const visit = (s, frets) => {
      const pressed = frets.filter((f) => f > 0);
      const span = pressed.length ? Math.max(...pressed) - Math.min(...pressed) : 0;
      if (span > 4) return;
      // Span, muted strings and fret distance never shrink as strings are
      // added, so their total is a lower bound on any shape reachable from
      // here (the leaf's bass penalty is >= 0). A prefix already scoring at or
      // above the incumbent best cannot beat it, so pruning it leaves the
      // winning shape unchanged while cutting the search from seconds to
      // milliseconds on wide tunings.
      const floor = span * 3 + frets.filter((f) => f < 0).length * 1.5 +
        frets.reduce((n, f) => n + Math.max(0, f), 0) * 0.08;
      if (best && floor >= best.score) return;
      if (s === choices.length) {
        const sounding = frets.map((f, idx) => f < 0 ? null : (base[idx] ?? base.at(-1)) + Number(tuning[idx] || 0) + f).filter(Number.isFinite);
        if (sounding.length < Math.min(3, chord.pitchClasses.length)) return;
        const covered = new Set(sounding.map((m) => m % 12));
        if (!chord.pitchClasses.every((pc) => covered.has(pc))) return;
        const bassPenalty = sounding[0] % 12 === chord.bass ? 0 : 8;
        const score = bassPenalty + floor;
        if (!best || score < best.score) best = { frets: frets.slice(), score };
        return;
      }
      for (const fret of choices[s]) visit(s + 1, [...frets, fret]);
    };
    visit(0, []);
    const frets = best && best.frets;
    if (shapeCache) shapeCache.set(cacheKey, frets);
    return frets;
  }

  function generateGuitarArrangement(chords, options) {
    const opts = options || {};
    const events = _normaliseHarmonyEvents(chords, opts.chordTemplates);
    const notes = [];
    const shapes = [];
    const shapeCache = new Map();
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const frets = _bestGuitarShape(event.chord, opts, shapeCache);
      if (!frets) continue;
      const sus = _eventDuration(events, i, opts);
      frets.forEach((f, s) => { if (f >= 0) notes.push({ t: event.t, s, f, sus }); });
      shapes.push({ t: event.t, name: event.chord.name, frets });
    }
    return { instrument: "guitar", notes, shapes, sourceChords: events.map((e) => ({ t: e.t, name: e.chord.name })) };
  }

  function generateChordArrangement(chords, options) {
    const opts = options || {};
    const instrument = String(opts.instrument || "keys").toLowerCase();
    return /^(guitar|acoustic|electric)$/.test(instrument)
      ? generateGuitarArrangement(chords, opts)
      : generateKeysArrangement(chords, opts);
  }
  // Shared instrument-detection: both identifyFromHighway and the
  // chart-transform provider (_transformInput) need the same isBass/isPiano
  // read off a songInfo-shaped object, so it lives here once rather than
  // being reimplemented at each call site.
  const _getArrangementContext = (songInfo) => {
    const info = songInfo || {};
    const arrangementText = `${info.arrangement || ""} ${info.arrangement_smart_name || ""}`;
    return {
      isBass: /bass/i.test(arrangementText),
      isPiano: KEYS_PATTERNS.test(arrangementText),
    };
  };

  function identifyFromHighway(chordNotes, highway) {
    const hw = highway || window.highway;
    if (!hw || typeof hw.getSongInfo !== "function") {
      return identifyChord(chordNotes, {});
    }
    const songInfo = hw.getSongInfo() || {};
    const stringCount = typeof hw.getStringCount === "function" ? hw.getStringCount() : undefined;
    const { isBass, isPiano } = _getArrangementContext(songInfo);
    return identifyChord(chordNotes, {
      tuning: songInfo.tuning,
      capo: songInfo.capo,
      stringCount,
      isBass,
      isPiano,
    });
  }

  // ── Auto-generated chord diagrams (chordr#2) ─────────────────────────────
  //
  // A chord_templates entry is "no real diagram" (RS2014-import convention,
  // documented in core CLAUDE.md's overlay-contract section) when it's
  // missing outright, or its `frets` are all -1 (the placeholder GP imports
  // already emit when the source has no fingering data). Either case is
  // filled in here from the chord event's OWN {s,f} notes — that's the
  // physical shape actually played, independent of whether identifyChord
  // can name it — plus a best-effort name when it can.

  function _templateNeedsGeneration(tpl) {
    if (!tpl || typeof tpl !== "object") return true;
    if (!Array.isArray(tpl.frets) || tpl.frets.length === 0) return true;
    return tpl.frets.every((f) => Number(f) === -1);
  }

  // Builds the per-string shape straight from the chord's own notes — no
  // chord-quality matching involved, so it's exact even for a shape
  // identifyChord can't name (an unsupported quality, an added tension).
  // `fingers` has no source in raw chart data (same as GP imports, see
  // core CLAUDE.md: "GP imports currently emit all -1 since pre-import
  // sources don't carry finger data") so it's left as the same sentinel.
  // `noDiagram` skips the per-note fret-filling pass and returns just the
  // all -1 sentinel shape — used for piano/keys chords, where {s, f} is a
  // MIDI bucket rather than a string+fret position and a per-string shape
  // has no meaning.
  const _shapeFromChordNotes = (chordNotes, stringCount, noDiagram) => {
    const n = Math.max(1, Number(stringCount) || 6);
    const frets = new Array(n).fill(-1);
    const fingers = new Array(n).fill(-1);
    if (noDiagram) return { frets, fingers };
    for (const note of chordNotes || []) {
      if (!note || typeof note !== "object") continue;
      const s = Number(note.s ?? note.string);
      const f = Number(note.f ?? note.fret);
      if (!Number.isFinite(s) || !Number.isFinite(f) || s < 0 || s >= n) continue;
      frets[s] = f;
    }
    return { frets, fingers };
  };

  // `chords` is the raw wire-format array (`{ t, id, notes: [{s,f,...}] }`,
  // see core's WebSocket protocol reference — `id` indexes `chordTemplates`).
  // `existingTemplates` may be absent/empty (no chord_templates message at
  // all) or present-but-incomplete. `ctx` is the same shape identifyChord
  // takes (tuning, capo, stringCount, isBass). Returns a NEW templates
  // array with only the deficient entries replaced, or null when nothing
  // needed generating — callers (e.g. the chart-transform provider below)
  // use null to mean "leave the chart's chordTemplates alone".
  function generateChordTemplates(chords, existingTemplates, ctx) {
    if (!Array.isArray(chords) || chords.length === 0) return null;
    const options = ctx || {};
    const stringCount = options.stringCount || (options.tuning && options.tuning.length) || 6;
    const templates = Array.isArray(existingTemplates) ? existingTemplates.slice() : [];
    let changed = false;

    for (const chord of chords) {
      if (!chord || typeof chord !== "object") continue;
      const id = Number(chord.id);
      if (!Number.isInteger(id) || id < 0) continue;
      if (!Array.isArray(chord.notes) || chord.notes.length === 0) continue;
      if (!_templateNeedsGeneration(templates[id])) continue;

      const shape = _shapeFromChordNotes(chord.notes, stringCount, options.isPiano);
      const identified = identifyChord(chord.notes, options);
      const existingName = templates[id] && templates[id].name;
      templates[id] = {
        name: (identified && identified.displayName) || existingName || "",
        frets: shape.frets,
        fingers: shape.fingers,
      };
      changed = true;
    }

    return changed ? templates : null;
  }

  // Wires the above into core's chart-transform capability (feedBack#952 —
  // see docs/capability-recipes.md) so generated diagrams actually reach
  // the highway/overlays via getChordTemplates(), instead of sitting in
  // this module unused. transform(input) only ever returns a
  // `chordTemplates` key (or null) — every other chart field is left
  // untouched, so this coexists with whatever else a transform provider
  // might otherwise own.
  function _transformInput(input) {
    const chords = Array.isArray(input.allChords) ? input.allChords : input.chords;
    const songInfo = input.songInfo || {};
    const { isBass, isPiano } = _getArrangementContext(songInfo);
    const merged = generateChordTemplates(chords, input.chordTemplates, {
      tuning: songInfo.tuning,
      capo: songInfo.capo,
      stringCount: input.stringCount,
      isBass,
      isPiano,
    });
    return merged ? { chordTemplates: merged } : null;
  }

  // chordr#21 — automatic chart-transform enrichment (auto-generated chord
  // diagrams) needs a core build with the chart-transform capability
  // (feedBack#952, core commit 05be9eb+); analysis-only use of
  // window.chordr/the server callable does not. dispatch() RESOLVES on
  // failure (e.g. {status:'no-owner'} when no owner is registered for the
  // capability at all) rather than rejecting — core's capabilities.js
  // only rejects on a genuinely unexpected exception — so every dispatch
  // below must be checked against its resolved `status`, not just whether
  // the promise chain completed. _chartTransformStatus makes the outcome
  // introspectable (README's Host compatibility section documents this).
  // Written once at registration time and never revisited afterward — it
  // reflects how registration/selection resolved, NOT live per-song
  // rendering (core stages the transform onto highway surfaces lazily, on
  // song:ready/highway:created, and Chordr's own transform can legitimately
  // return null for a chord it doesn't need to enrich) — a later
  // clear-provider or a transform that throws on every chart still reads
  // whatever this resolved to:
  //   "pending"    — registration hasn't resolved yet (also the permanent
  //                  value on a core with no capabilities framework at
  //                  all — see the no-dispatch guard below)
  //   "active"     — core's chart-transform coordinator currently selects
  //                  THIS provider; not proof any diagram has rendered
  //   "registered" — registered successfully, but not currently selected
  //                  (a different provider holds the selection, or this
  //                  provider's own self-select attempt didn't resolve
  //                  successfully) — this provider's diagrams are not live
  //   "unavailable"— register-provider/inspect/select-provider resolved
  //                  with a non-success status (framework present, no
  //                  chart-transform owner registered for it)
  let _chartTransformStatus = "pending";

  // Dispatch result shape from core's static/capabilities.js `dispatch()`.
  // @typedef {{ status: string, payload?: { active?: string } }} DispatchResult
  //
  // "applied"/"overridden" are the only success statuses _dispatchStatus()
  // can produce; everything else (no-owner, no-handler, unsupported-command,
  // incompatible-version, error, ...) means the command did not do what it
  // asked for, even though the promise resolved rather than rejected.
  // const arrow functions, not function declarations nested in this file's
  // top-level `if` block — matches this repo's existing convention for
  // avoiding block-scoped function-declaration hoisting risk (see
  // midiFromPianoNote / _getArrangementContext / _shapeFromChordNotes above).
  const _isAppliedStatus = (/** @type {DispatchResult} */ result) => {
    const status = result && result.status;
    return status === "applied" || status === "overridden";
  };

  const _describeStatus = (/** @type {DispatchResult} */ result) => (result && result.status) || "no response";

  const _warnChartTransformUnavailable = (reason) => {
    _chartTransformStatus = "unavailable";
    if (typeof console !== "undefined") {
      console.warn(
        `[${PLUGIN_ID}] chart-transform unavailable (${reason}) — ` +
        "auto-generated chord diagrams are disabled (analysis via window.chordr " +
        "still works). Needs feedBack core 05be9eb+ (see chordr#21)."
      );
    }
  };

  const providerId = `${PLUGIN_ID}_diagrams`;

  // Linear register -> inspect -> maybe select-provider flow. async/await
  // here (rather than chained .then()s) keeps each step's status check
  // adjacent to the call it checks; the caller below stays a plain
  // function so this async function's own rejection can't reach
  // addEventListener's listener machinery unhandled.
  const _tryRegisterChartTransform = async (api) => {
    const registerResult = await api.dispatch({
      capability: "chart-transform",
      command: "register-provider",
      source: providerId,
      payload: {
        providerId,
        label: "Chordr — auto-generated chord diagrams",
        transform(input) {
          try {
            return _transformInput(input || {});
          } catch (_) {
            return null; // never let a bad chord shape break rendering
          }
        },
      },
    });
    if (!_isAppliedStatus(registerResult)) {
      _warnChartTransformUnavailable(`register-provider: ${_describeStatus(registerResult)}`);
      return;
    }

    const inspectResult = await api.dispatch({ capability: "chart-transform", command: "inspect", source: providerId });
    if (!_isAppliedStatus(inspectResult)) {
      _warnChartTransformUnavailable(`inspect: ${_describeStatus(inspectResult)}`);
      return;
    }
    const snapshot = (inspectResult && (inspectResult.payload || inspectResult)) || {};
    if (snapshot.active === providerId) {
      _chartTransformStatus = "active";
      return;
    }
    // Never steal an existing selection — only self-select as a sensible
    // default when nothing is active yet (mirrors how register-provider
    // itself only auto-restores a persisted selection for THIS exact
    // provider id, never forces one).
    if (snapshot.active) {
      _chartTransformStatus = "registered"; // another provider holds the selection
      return;
    }

    const selectResult = await api.dispatch({
      capability: "chart-transform", command: "select-provider",
      source: providerId, payload: { providerId },
    });
    // A non-success select (e.g. an unknown provider id) is not a
    // host-compatibility gap — registration itself already succeeded — so
    // this falls back to "registered" without warning, unlike the two
    // checks above.
    _chartTransformStatus = _isAppliedStatus(selectResult) ? "active" : "registered";
  };

  // Not async: passed directly to addEventListener below, and an async
  // function there would leave its rejection unhandled by the listener
  // machinery.
  const _registerChartTransform = () => {
    const api = window.feedBack && window.feedBack.capabilities;
    // Defensive only: on a real feedBack build, capabilities.js publishes
    // window.feedBack.capabilities and fires 'feedBack:capabilities:ready'
    // in the same synchronous block, and v3/index.html loads it before the
    // plugin scripts that would call this function — so this branch isn't
    // actually reachable from the caller below, which instead just waits
    // forever on an event a host with no capabilities framework never
    // fires (status stays "pending", not "unavailable", on that tier).
    if (!api || typeof api.dispatch !== "function") {
      _warnChartTransformUnavailable("no capabilities API on this host");
      return;
    }
    if (window[`__${PLUGIN_ID}_transformRegistered`]) return;
    window[`__${PLUGIN_ID}_transformRegistered`] = true;

    _tryRegisterChartTransform(api).catch(() => {
      _warnChartTransformUnavailable("dispatch threw unexpectedly");
    });
  };

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    if (window.feedBack && window.feedBack.capabilities) _registerChartTransform();
    else window.addEventListener("feedBack:capabilities:ready", _registerChartTransform, { once: true });
  }

  // ── Chord/lyrics view (chordr#3) ─────────────────────────────────────
  // Ultimate-Guitar-style overlay: shows the current line of lyrics with
  // chord names positioned above the word nearest each chord's time.
  // `highway.getChords()`/`getChordTemplates()` already cover chords;
  // lyrics have no highway getter (see core CLAUDE.md's WS protocol
  // reference), so this opens its own short-lived WebSocket just for the
  // `lyrics` message, the same pattern splitscreen's lyrics pane uses.

  // Turns the raw lyrics wire array ([{w,t,d}, ...]) into lines of words,
  // per the WS protocol: a leading `-` on `w` joins to the previous word
  // (no space), a trailing `+` ends the current line. Exposed on
  // `window.chordr` since it's pure and reusable by other lyrics-consuming
  // plugins, not just this view.
  const buildLyricLines = (lyricsData) => {
    const lines = [];
    let current = null;
    for (const entry of lyricsData || []) {
      if (!entry || typeof entry.w !== "string") continue;
      let word = entry.w;
      const joinsPrev = word.startsWith("-");
      const breaksAfter = word.endsWith("+");
      if (joinsPrev) word = word.slice(1);
      if (breaksAfter) word = word.slice(0, -1);

      if (!current) current = { words: [], startT: entry.t };
      if (joinsPrev && current.words.length) {
        current.words.at(-1).text += word;
      } else {
        current.words.push({ text: word, t: entry.t });
      }
      if (breaksAfter) {
        current.endT = entry.t + (entry.d || 0);
        lines.push(current);
        current = null;
      }
    }
    if (current && current.words.length) {
      current.endT = Infinity; // open-ended: no trailing "+" ever closed it
      lines.push(current);
    }
    return lines;
  };

  const _chordDisplayName = (chord, template, highway) => {
    // Audio-detected chords (chordr#5's fallback source) already carry
    // their own name and have no chart notes/template to look up.
    if (chord.name) return chord.name;
    if (template && template.name) return template.name;
    const identified = identifyFromHighway(chord.notes, highway);
    return (identified && identified.displayName) || null;
  };

  // Attaches each chord inside [line.startT, line.endT) to the nearest
  // word at-or-before its time. Returns a Map of word index -> chord name.
  const _assignChordsToLine = (line, chords, templates, highway) => {
    const marks = new Map();
    for (const chord of chords || []) {
      if (chord.t < line.startT || chord.t >= line.endT) continue;
      let idx = 0;
      for (let i = 0; i < line.words.length; i++) {
        if (line.words.at(i).t <= chord.t) idx = i;
      }
      const chordId = Number(chord.id);
      const template =
        templates && Number.isInteger(chordId) && chordId >= 0 ? templates.at(chordId) : null;
      const name = _chordDisplayName(chord, template, highway);
      if (name) {
        // A word can span more than one chord change (rare, but real —
        // dense strumming patterns); concatenate rather than let the
        // later chord silently overwrite the earlier one.
        const existing = marks.get(idx);
        marks.set(idx, existing ? `${existing} ${name}` : name);
      }
    }
    return marks;
  };

  // Only the line whose [startT, endT) window contains `time` — not "the
  // last line that's started", which would keep showing a line after its
  // own endT (inconsistent with chords, which already respect endT via
  // _assignChordsToLine) and would show line 0 before playback ever
  // reaches it.
  const _findLineIndex = (lines, time) => {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines.at(i);
      if (line.startT <= time && time < line.endT) return i;
    }
    return -1;
  };

  // Builds the line's DOM once and caches each word's text element + onset
  // time on `state.renderedWords`, so per-frame work (_updateSungState)
  // never has to touch the DOM tree itself, only toggle a class.
  const _renderLine = (state, line, marks) => {
    const container = state.linesEl;
    container.innerHTML = "";
    const renderedWords = [];
    line.words.forEach((word, i) => {
      const wordWrap = document.createElement("span");
      wordWrap.className = "chordr-word";
      if (marks.has(i)) {
        const chordEl = document.createElement("span");
        chordEl.className = "chordr-chord-label";
        chordEl.textContent = marks.get(i);
        wordWrap.appendChild(chordEl);
      }
      const textEl = document.createElement("span");
      textEl.className = "chordr-lyric-text";
      textEl.textContent = word.text;
      wordWrap.appendChild(textEl);
      container.appendChild(wordWrap);
      renderedWords.push({ el: textEl, t: word.t, sung: false });
    });
    state.renderedWords = renderedWords;
  };

  const _clearLine = (state) => {
    if (state.linesEl) state.linesEl.innerHTML = "";
    state.renderedWords = [];
  };

  // Per-frame cost: a classList toggle per word, only on an actual sung/
  // not-sung transition — no DOM (re)construction.
  const _updateSungState = (state, time) => {
    for (const word of state.renderedWords) {
      const shouldBeSung = time >= word.t;
      if (shouldBeSung !== word.sung) {
        word.sung = shouldBeSung;
        word.el.classList.toggle("chordr-word-sung", shouldBeSung);
      }
    }
  };

  const viewState = {
    active: false,
    rafId: null,
    wrap: null,
    linesEl: null,
    ws: null,
    lyricLines: [],
    lastRenderedLine: -1,
    renderedWords: [],
    audioChords: null, // chordr#5's fallback source, populated lazily by _maybeDetectChordsFromAudio
  };

  const _lineCoversTime = (line, time) => !!line && line.startT <= time && time < line.endT;

  const _viewLoop = () => {
    if (!viewState.active) return;
    viewState.rafId = requestAnimationFrame(_viewLoop);

    const highway = window.highway;
    if (!highway || !highway.getTime || !viewState.lyricLines.length) return;

    const time = highway.getTime();

    // Common case: still inside the same line as last frame — skip the
    // full backward scan _findLineIndex does and just recheck this one
    // line's bounds.
    const currentLine =
      viewState.lastRenderedLine >= 0 ? viewState.lyricLines.at(viewState.lastRenderedLine) : null;
    const idx = _lineCoversTime(currentLine, time)
      ? viewState.lastRenderedLine
      : _findLineIndex(viewState.lyricLines, time);

    // Chord identification + DOM (re)construction only happen when the
    // line actually changes, not on every one of ~60 frames/sec.
    if (idx !== viewState.lastRenderedLine) {
      viewState.lastRenderedLine = idx;
      if (idx < 0) {
        _clearLine(viewState);
      } else {
        const line = viewState.lyricLines.at(idx);
        // Fall back to chordr#5's audio-detected chords only when the
        // chart has none at all — a loose-folder song with no chord
        // data, not merely unnamed chords (#1/#2 already cover that).
        const chartChords = highway.getChords ? highway.getChords() : [];
        const chords =
          chartChords && chartChords.length ? chartChords : viewState.audioChords || [];
        const templates = highway.getChordTemplates ? highway.getChordTemplates() : null;
        const marks = _assignChordsToLine(line, chords, templates, highway);
        _renderLine(viewState, line, marks);
      }
    }

    if (idx >= 0) _updateSungState(viewState, time);
  };

  // `song` is core's `currentSong` object (see _startView and _onSongLoaded).
  // The real `song_info` WebSocket payload carries no `filename` field at all
  // (tuning/stringCount/capo/arrangement/audio_url/... — see core CLAUDE.md's
  // WS protocol reference), so `highway.getSongInfo().filename` is always
  // undefined on a real host. `filename` is core's own copy of the WS URL's
  // path segment, already decoded — so it is encoded exactly once below, never
  // decoded. `arrangementIndex` is copied straight from
  // `song_info.arrangement_index`, i.e. the server-RESOLVED index (always
  // >= 0), not the requested query param (which may be -1 for "smart
  // auto-pick") — so passing it back is safe.
  const _connectLyricsSocket = (song) => {
    // A reconnect replaces the open socket rather than leaking it: the
    // previous song's socket would still deliver its own `lyrics` message and
    // overwrite the new song's lines.
    if (viewState.ws) {
      viewState.ws.close();
      viewState.ws = null;
    }
    if (!song || !song.filename || typeof WebSocket === "undefined") return;

    const name = song.filename;
    const arrIndex = song.arrangementIndex || 0;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const url = `${scheme}://${location.host}/ws/highway/${encodeURIComponent(name)}?arrangement=${arrIndex}`;

    const ws = new WebSocket(url);
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (msg.type === "lyrics") {
        viewState.lyricLines = buildLyricLines(msg.data);
      } else if (msg.type === "ready") {
        ws.close(); // only needed the lyrics message off this connection
      }
    };
    ws.onerror = () => { /* no lyrics for this song, or a dropped connection — view just stays empty */ };
    viewState.ws = ws;
  };

  // chordr#5: audio-based chord detection, a fallback source for songs
  // whose chart carries no note/chord data to derive chords from at all
  // (chordr#1/#2 already cover the common case: chart data present, just
  // unnamed). Fetches the song's audio (same-origin regardless of source
  // format — sloppak/loose-folder/archive all resolve to a playable URL
  // via songInfo.audio_url) and uploads it to the backend's chroma-CQT +
  // template-matching detector. Returns [{ t, name }, ...] or null on any
  // failure — the view just has no chords for this song, same as today.
  const detectChordsFromAudio = async (audioUrl) => {
    if (!audioUrl || typeof fetch === "undefined") return null;
    try {
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) return null;
      const blob = await audioRes.blob();

      const res = await fetch(`/api/plugins/${PLUGIN_ID}/detect_chords`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        body: blob,
      });
      if (!res.ok) return null;

      const data = await res.json();
      return Array.isArray(data.chords) ? data.chords : null;
    } catch (_) {
      return null; // network error, decoding failure, etc. — fail soft
    }
  };

  // One-call path for the core use case: a song has audio but no authored
  // piano/keys part. Detection failures remain soft (matching
  // detectChordsFromAudio); a successful empty detection yields an empty but
  // well-formed arrangement.
  const generateArrangementFromAudio = async (audioUrl, options) => {
    const chords = await detectChordsFromAudio(audioUrl);
    return chords ? generateChordArrangement(chords, options) : null;
  };

  // ── Melody-to-accompaniment (via lyrics_karaoke) ────────────────────────
  // A third generation path alongside chart chords and audio chord
  // detection: for a song whose only harmonic information is its sung
  // melody (a Vocals arrangement with synced lyrics + pitch, no chord
  // chart and no full-mix audio worth running chord detection on), derive
  // a backing accompaniment straight from the melody notes lyrics_karaoke
  // already extracted. This is a monophonic-melody harmonization problem,
  // not a chord-detection one: we pick diatonic chords that best support
  // the sung notes, not chords already sounding in a recording.

  // Krumhansl-Kessler key profiles (rotated per candidate tonic), used only
  // to pick a plausible key center from the melody's own pitch-class
  // durations — this is a coarse heuristic, not music-theoretic ground
  // truth, and is expected to misfire on melodies that modulate or that
  // are modal/pentatonic enough to fit multiple keys equally well.
  const KK_MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  // Diatonic triads by scale degree (root offset in semitones from tonic,
  // quality suffix matching CHORD_QUALITIES). Degree seven is the
  // half-diminished/diminished triad in both modes' natural form.
  const MAJOR_DEGREE_TRIADS = [
    { offset: 0, suffix: "" }, { offset: 2, suffix: "m" }, { offset: 4, suffix: "m" },
    { offset: 5, suffix: "" }, { offset: 7, suffix: "" }, { offset: 9, suffix: "m" },
    { offset: 11, suffix: "dim" },
  ];
  const MINOR_DEGREE_TRIADS = [
    { offset: 0, suffix: "m" }, { offset: 2, suffix: "dim" }, { offset: 3, suffix: "" },
    { offset: 5, suffix: "m" }, { offset: 7, suffix: "m" }, { offset: 8, suffix: "" },
    { offset: 10, suffix: "" },
  ];

  function _pitchClassDurations(tokens) {
    const weights = new Array(12).fill(0);
    for (const tok of tokens) {
      const pc = ((Math.round(tok.midi) % 12) + 12) % 12;
      weights[pc] += Math.max(0.05, Number(tok.duration) || 0.05);
    }
    return weights;
  }

  function _correlate(a, b) {
    const meanA = a.reduce((s, v) => s + v, 0) / a.length;
    const meanB = b.reduce((s, v) => s + v, 0) / b.length;
    let num = 0, denomA = 0, denomB = 0;
    for (let i = 0; i < a.length; i++) {
      const da = a[i] - meanA, db = b[i] - meanB;
      num += da * db; denomA += da * da; denomB += db * db;
    }
    const denom = Math.sqrt(denomA * denomB);
    return denom > 0 ? num / denom : 0;
  }

  function _estimateKey(tokens) {
    const weights = _pitchClassDurations(tokens);
    let best = { root: 0, mode: "major", score: -Infinity };
    for (let root = 0; root < 12; root++) {
      const rotated = weights.slice(root).concat(weights.slice(0, root));
      const majorScore = _correlate(rotated, KK_MAJOR_PROFILE);
      const minorScore = _correlate(rotated, KK_MINOR_PROFILE);
      if (majorScore > best.score) best = { root, mode: "major", score: majorScore };
      if (minorScore > best.score) best = { root, mode: "minor", score: minorScore };
    }
    return { root: best.root, mode: best.mode };
  }

  function _diatonicChords(key) {
    const degrees = key.mode === "minor" ? MINOR_DEGREE_TRIADS : MAJOR_DEGREE_TRIADS;
    return degrees.map((d) => {
      const root = (key.root + d.offset) % 12;
      const intervals = CHORD_INTERVALS_BY_SUFFIX.get(d.suffix.toLowerCase());
      return {
        root, suffix: d.suffix,
        pitchClasses: intervals.map((iv) => (root + iv) % 12),
      };
    });
  }

  // Groups melody tokens into fixed windows and, per window, scores every
  // diatonic triad by how much of the window's (duration-weighted) melody
  // content it covers — the sung notes are treated as the thing the
  // accompaniment must support, not literal chord tones to reproduce.
  // Ties favor the tonic triad, giving unclear windows (a single repeated
  // note, a rest) a harmonically neutral default instead of an arbitrary one.
  function _harmonizeMelody(tokens, windowSeconds, key) {
    const triads = _diatonicChords(key);
    const tonicIndex = 0;
    const lastEnd = tokens.reduce((max, t) => Math.max(max, t.start + t.duration), 0);
    const windowCount = Math.max(1, Math.ceil(lastEnd / windowSeconds));
    const chords = [];
    let lastChosen = -1;
    for (let w = 0; w < windowCount; w++) {
      const winStart = w * windowSeconds;
      const winEnd = winStart + windowSeconds;
      const weights = new Array(12).fill(0);
      let any = false;
      for (const tok of tokens) {
        const overlap = Math.min(tok.start + tok.duration, winEnd) - Math.max(tok.start, winStart);
        if (overlap <= 0) continue;
        const pc = ((Math.round(tok.midi) % 12) + 12) % 12;
        weights[pc] += overlap;
        any = true;
      }
      if (!any) continue;
      let bestIdx = tonicIndex, bestScore = -Infinity;
      triads.forEach((triad, idx) => {
        let score = triad.pitchClasses.reduce((s, pc) => s + weights[pc], 0);
        if (idx === lastChosen) score += 0.001; // gentle stickiness, avoids chord-per-window churn on ties
        if (score > bestScore) { bestScore = score; bestIdx = idx; }
      });
      const chosen = triads[bestIdx];
      const name = (NOTE_NAMES_SHARP[chosen.root] || "C") + chosen.suffix;
      chords.push({ t: winStart, name });
      lastChosen = bestIdx;
    }
    return chords;
  }

  // Fetches the canonical vocal playback payload
  // (docs/architecture/vocals-playback-contract.md in lyrics_karaoke) for
  // `filename`, harmonizes the primary voice's pitched tokens into a
  // diatonic chord sequence, and generates a keys/guitar accompaniment from
  // it via the same generateChordArrangement path chart chords and audio
  // detection already use. Returns null wherever there is nothing to
  // harmonize: no lyrics_karaoke route, no prepared song, an unpitched
  // (lyrics-only) track, or a track too short to estimate a key from.
  async function generateAccompanimentFromLyrics(filename, options) {
    const opts = options || {};
    if (!filename) return null;
    const params = new URLSearchParams({ filename });
    if (Number.isInteger(opts.arrangementIndex)) {
      params.set("arrangement", String(opts.arrangementIndex));
    }
    let payload;
    try {
      const res = await fetch(`/api/plugins/lyrics_karaoke/playback?${params}`);
      if (!res.ok) return null;
      payload = await res.json();
    } catch (_) {
      return null; // network error, decoding failure, host without lyrics_karaoke, etc.
    }
    if (!payload || payload.schema_version !== 1 || !Array.isArray(payload.voices)) return null;
    const voice = payload.voices.find((v) => v && v.primary) || payload.voices[0];
    const tokens = (voice && Array.isArray(voice.tokens) ? voice.tokens : [])
      .filter((t) => Number.isFinite(t.midi) && Number.isFinite(t.start) && Number.isFinite(t.duration) && t.duration >= 0)
      .sort((a, b) => a.start - b.start);
    if (!tokens.length) return null; // lyrics-only track: nothing to harmonize from

    const windowSeconds = Math.max(0.5, Number(opts.windowSeconds) || 2);
    const key = _estimateKey(tokens);
    const chords = _harmonizeMelody(tokens, windowSeconds, key);
    if (!chords.length) return null;
    const arrangement = generateChordArrangement(chords, opts);
    arrangement.key = { root: NOTE_NAMES_SHARP[key.root], mode: key.mode };
    return arrangement;
  }

  // Cache keyed by song audio_url (song_info carries no `filename` field —
  // see the WebSocket protocol reference; audio_url is the identity every
  // format resolves to): always holds the detection Promise — in flight,
  // or already settled (an already-resolved promise's `.then()` behaves
  // the same as a plain value's, so there's no need to unwrap it back to
  // a raw array once it settles). Module-level (not on viewState) so it
  // survives the view being closed and reopened for the same song —
  // without it, every reopen re-downloaded the audio and re-ran a tens-
  // of-seconds CQT analysis from scratch, and closing+reopening while a
  // detection was still running could fire a second, fully concurrent
  // duplicate analysis for the same song.
  const _audioChordsCache = new Map();

  const _attachAudioChordsWhenReady = (promise, requestedFor) => {
    promise.then((chords) => {
      // The user may have switched songs (or the view may have stopped)
      // while this was in flight — don't attach stale results.
      if (!viewState.active) return;
      const currentHighway = window.highway;
      const currentSongInfo = currentHighway && currentHighway.getSongInfo
        ? currentHighway.getSongInfo()
        : null;
      if (!currentSongInfo || currentSongInfo.audio_url !== requestedFor) return;
      viewState.audioChords = chords;
      // Detection resolves asynchronously, seconds in — the user is almost
      // always still on whatever line was already showing, so idx ===
      // lastRenderedLine and _viewLoop's line-change gate would otherwise
      // skip re-rendering it, leaving the current line's chords empty
      // until the next line change. Force one re-render so it picks up
      // the newly-attached chords on the very next frame.
      viewState.lastRenderedLine = -1;
    });
  };

  // Kicks off audio-based detection in the background when (and only
  // when) the chart has no chords to show at all. Never awaited by
  // _startView — chroma analysis of a full song can take real time, and
  // the view should render lyrics-only immediately rather than block on it.
  const _maybeDetectChordsFromAudio = (highway) => {
    const chartChords = highway.getChords ? highway.getChords() : [];
    if (chartChords && chartChords.length) return; // chart already has chords
    const songInfo = highway.getSongInfo ? highway.getSongInfo() : null;
    if (!songInfo || !songInfo.audio_url) return;

    const requestedFor = songInfo.audio_url;

    if (_audioChordsCache.has(requestedFor)) {
      // Already resolved, or still in flight, for this exact song —
      // reuse it instead of starting a duplicate detection.
      _attachAudioChordsWhenReady(_audioChordsCache.get(requestedFor), requestedFor);
      return;
    }

    const promise = detectChordsFromAudio(songInfo.audio_url).then((chords) => {
      // A falsy (failed) result stays out of the cache so a later open
      // retries instead of reusing — and re-`.then()`-ing — a dead
      // result. A successful result needs no action here: the promise
      // itself, already cached below, is what later opens reuse.
      if (!chords) _audioChordsCache.delete(requestedFor);
      return chords;
    });
    _audioChordsCache.set(requestedFor, promise);
    _attachAudioChordsWhenReady(promise, requestedFor);
  };

  // Core's event bus (static/capabilities.js) — an EventTarget with on/off
  // aliases, and the only thing that publishes `song:loaded`.
  const _songLoadedBus = () =>
    window.feedBack && typeof window.feedBack.on === "function" ? window.feedBack : null;

  // Point the view at the song core has just published, for BOTH lyrics and
  // audio detection. This has to be driven by core publishing `currentSong`,
  // not by the playSong wrapper resuming: core's playSong returns as soon as
  // it has opened the WebSocket and never awaits `song_info` (core CLAUDE.md
  // Pitfall #1), so at that instant `currentSong` still describes the song
  // being left behind — reading it there subscribed to the previous song's
  // lyrics, and read `null` on the first song after the view was enabled.
  // `song:loaded`'s detail IS that object, published one round trip later.
  const _onSongLoaded = (event) => {
    if (!viewState.active) return;
    _connectLyricsSocket(event && event.detail);
    const highway = window.highway;
    if (highway) _maybeDetectChordsFromAudio(highway);
  };

  const _buildViewOverlay = () => {
    const player = document.getElementById("player");
    if (!player) return;
    const wrap = document.createElement("div");
    wrap.className = "chordr-view-overlay";
    const linesEl = document.createElement("div");
    linesEl.className = "chordr-view-lines";
    wrap.appendChild(linesEl);
    player.appendChild(wrap);
    viewState.wrap = wrap;
    viewState.linesEl = linesEl;
  };

  // Returns whether the view actually started, so callers (the toggle
  // button) don't show "active" styling for a start that silently
  // no-op'd (no highway yet) or was ignored (already running).
  const _startView = () => {
    if (viewState.active) return false;
    const highway = window.highway;
    if (!highway) return false;
    viewState.active = true;
    viewState.lyricLines = [];
    viewState.lastRenderedLine = -1;
    viewState.renderedWords = [];
    viewState.audioChords = null;
    _buildViewOverlay();
    // Subscribe before snapshotting, and only while the view is active, so
    // toggling can't accumulate listeners and a song that loads with the view
    // closed can't open a lyrics socket behind the user's back.
    const bus = _songLoadedBus();
    if (bus) bus.on("song:loaded", _onSongLoaded);
    // A song is always already loaded by the time a user can toggle the view
    // on, so this path reads core's published copy directly rather than
    // waiting for the next song:loaded.
    _connectLyricsSocket(window.feedBack && window.feedBack.currentSong);
    _maybeDetectChordsFromAudio(highway);
    _viewLoop();
    // _wrapPlaySongForView() already ran once at plugin load, but plugins
    // load asynchronously relative to when core binds window.playSong —
    // if this screen's script ran first, that install permanently no-op'd
    // (it bails if window.playSong isn't a function yet). By the time a
    // user can toggle the view at all, window.highway exists, so the app
    // is fully up and window.playSong is guaranteed to be bound — retry
    // the wrap here (it's idempotent via __chordr_viewPlaySongWrapped).
    _wrapPlaySongForView();
    return true;
  };

  const _stopView = (btn) => {
    viewState.active = false;
    if (btn) btn.classList.remove("chordr-view-active");
    const bus = _songLoadedBus();
    if (bus) bus.off("song:loaded", _onSongLoaded);
    if (viewState.rafId) cancelAnimationFrame(viewState.rafId);
    viewState.rafId = null;
    if (viewState.ws) {
      viewState.ws.close();
      viewState.ws = null;
    }
    if (viewState.wrap) {
      viewState.wrap.remove();
      viewState.wrap = null;
    }
  };

  const _toggleView = (btn) => {
    if (viewState.active) {
      _stopView(btn);
    } else if (_startView() && btn) {
      btn.classList.add("chordr-view-active");
    }
  };

  // Clear the previous song's view state as soon as a new song starts
  // loading (which can take seconds) — otherwise window.highway can already
  // reflect the new song's chords/time while viewState.lyricLines still holds
  // the previous song's lines, showing old lyrics against new playback.
  //
  // The reconnect is NOT done here. Core's playSong returns as soon as it has
  // opened the WebSocket and never awaits song_info, so this wrapper resumes
  // one network round trip before core publishes the new song — see
  // _onSongLoaded, which is driven by that publish instead.
  const _wrapPlaySongForView = () => {
    if (window[`__${PLUGIN_ID}_viewPlaySongWrapped`]) return;
    if (typeof window.playSong !== "function") return;
    window[`__${PLUGIN_ID}_viewPlaySongWrapped`] = true;
    const original = window.playSong;
    window.playSong = async function (...args) {
      if (viewState.active) {
        if (viewState.ws) {
          viewState.ws.close();
          viewState.ws = null;
        }
        viewState.lyricLines = [];
        viewState.audioChords = null;
      }
      // Core's contract for this wrap: always call the original and await it.
      return original.apply(this, args);
    };
  };

  const _injectViewToggle = () => {
    const build = () => {
      const container =
        window.feedBack && window.feedBack.uiVersion === "v3" && window.feedBack.ui
          ? window.feedBack.ui.playerControlSlot()
          : null;
      if (!container) return false;
      if (container.querySelector("[data-chordr-view-toggle]")) return true;

      const btn = document.createElement("button");
      btn.setAttribute("data-chordr-view-toggle", "");
      btn.textContent = "🎤 Chords+Lyrics";
      btn.className = "fb-text";
      btn.addEventListener("click", () => _toggleView(btn));
      container.appendChild(btn);
      return true;
    };

    if (!build()) window.addEventListener("feedBack:ui:ready", build, { once: true });
  };

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    _injectViewToggle();
    _wrapPlaySongForView();
  }

  window.chordr = {
    identifyChord,
    groupChordEvents,
    identifyPianoChord,
    parseChordName,
    generateChordArrangement,
    generateKeysArrangement,
    generateGuitarArrangement,
    generateArrangementFromAudio,
    generateAccompanimentFromLyrics,
    identifyFromHighway,
    generateChordTemplates,
    buildLyricLines,
    findLineIndex: _findLineIndex,
    baseOpenStringMidis,
    pitchFromBase,
    midiFromPianoNote,
    noteName,
    CHORD_QUALITIES,
    KEYS_PATTERNS,
    getArrangementContext: _getArrangementContext,
    detectChordsFromAudio,
    // chordr#21 — "pending" | "active" | "registered" | "unavailable".
    // "active" means core's chart-transform coordinator currently selects
    // THIS provider — not proof any diagram has actually rendered, since
    // core stages the transform onto highway surfaces lazily and Chordr's
    // own transform can return null for a chart it doesn't need to enrich.
    // "registered" means installed but not currently selected (either a
    // different provider holds the selection, or this provider's own
    // self-select attempt didn't resolve successfully). Lets a caller
    // distinguish either from "unavailable" instead of assuming enrichment
    // is live just because window.chordr exists (analysis-only helpers
    // work regardless of this status). See _registerChartTransform's own
    // comment for the full state contract, including its one-time-at-load
    // caveat.
    getChartTransformStatus: () => _chartTransformStatus,
    // Not part of the public API (see README) — exposed only so
    // tests/chord_lyrics_view.test.js can drive the chord/lyrics view's
    // internals directly instead of standing up a full DOM + WebSocket +
    // requestAnimationFrame environment.
    _internal: {
      assignChordsToLine: _assignChordsToLine,
      renderLine: _renderLine,
      updateSungState: _updateSungState,
      clearLine: _clearLine,
      viewLoop: _viewLoop,
      startView: _startView,
      stopView: _stopView,
      toggleView: _toggleView,
      maybeDetectChordsFromAudio: _maybeDetectChordsFromAudio,
      viewState,
    },
  };
  }
})();
