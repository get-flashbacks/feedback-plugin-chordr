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

  // Group consecutive chord events by their played fret/string shape. A
  // voicing containing only notes of the active chord is a continuation of
  // that chord, even when an importer gave the partial its own unnamed
  // template. Keep the full parent shape active across repeated partials;
  // comparing only with the immediately previous partial would incorrectly
  // start a new group when the next strum selects different chord tones.
  // This is deliberately a physical-shape test, not a pitch-class guess:
  // an unfamiliar or inverted shape must remain a separate, reviewable event.
  function groupChordEvents(chords) {
    if (!Array.isArray(chords)) return [];
    const result = [];
    let parentIndex = -1;
    let parentShape = new Set();
    for (let i = 0; i < chords.length; i++) {
      const shape = new Set();
      for (const note of chords[i]?.notes || []) {
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
    }
    return result;
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
  function _shapeFromChordNotes(chordNotes, stringCount) {
    const n = Math.max(1, Number(stringCount) || 6);
    const frets = new Array(n).fill(-1);
    const fingers = new Array(n).fill(-1);
    for (const note of chordNotes || []) {
      if (!note || typeof note !== "object") continue;
      const s = Number(note.s ?? note.string);
      const f = Number(note.f ?? note.fret);
      if (!Number.isFinite(s) || !Number.isFinite(f) || s < 0 || s >= n) continue;
      frets[s] = f;
    }
    return { frets, fingers };
  }

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

      const shape = _shapeFromChordNotes(chord.notes, stringCount);
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
    const isBass = /bass/i.test(`${songInfo.arrangement || ""} ${songInfo.arrangement_smart_name || ""}`);
    const merged = generateChordTemplates(chords, input.chordTemplates, {
      tuning: songInfo.tuning,
      capo: songInfo.capo,
      stringCount: input.stringCount,
      isBass,
    });
    return merged ? { chordTemplates: merged } : null;
  }

  function _registerChartTransform() {
    const api = window.feedBack && window.feedBack.capabilities;
    if (!api || typeof api.dispatch !== "function") return;
    if (window[`__${PLUGIN_ID}_transformRegistered`]) return;
    window[`__${PLUGIN_ID}_transformRegistered`] = true;

    const providerId = `${PLUGIN_ID}_diagrams`;
    api.dispatch({
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
    }).then(() => api.dispatch({ capability: "chart-transform", command: "inspect", source: providerId }))
      .then((result) => {
        // Never steal an existing selection — only self-select as a
        // sensible default when nothing is active yet (mirrors how
        // register-provider itself only auto-restores a persisted
        // selection for THIS exact provider id, never forces one).
        const snapshot = (result && (result.payload || result)) || {};
        if (!snapshot.active) {
          return api.dispatch({
            capability: "chart-transform", command: "select-provider",
            source: providerId, payload: { providerId },
          });
        }
      })
      .catch(() => { /* capability graph unavailable — diagrams just won't auto-generate */ });
  }

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

  const _connectLyricsSocket = (highway) => {
    const songInfo = highway.getSongInfo ? highway.getSongInfo() : null;
    if (!songInfo || !songInfo.filename || typeof WebSocket === "undefined") return;

    let name = songInfo.filename;
    try { name = decodeURIComponent(name); } catch (_) { /* already decoded */ }
    const arrIndex = songInfo.arrangement_index || 0;
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
    _connectLyricsSocket(highway);
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

  // Reconnect the lyrics socket on every new song while the view is active
  // — the WS the view opened for the previous song is for the previous
  // filename/arrangement and won't emit again.
  const _wrapPlaySongForView = () => {
    if (window[`__${PLUGIN_ID}_viewPlaySongWrapped`]) return;
    if (typeof window.playSong !== "function") return;
    window[`__${PLUGIN_ID}_viewPlaySongWrapped`] = true;
    const original = window.playSong;
    window.playSong = async function (...args) {
      // Clear stale lyrics BEFORE awaiting the new song's load (which can
      // take seconds) — otherwise window.highway can already reflect the
      // new song's chords/time while viewState.lyricLines still holds the
      // previous song's lines, showing old lyrics against new playback.
      if (viewState.active) {
        if (viewState.ws) {
          viewState.ws.close();
          viewState.ws = null;
        }
        viewState.lyricLines = [];
        viewState.audioChords = null;
      }
      const result = await original.apply(this, args);
      // Reconnect/re-detect only after the new song has loaded, so
      // getSongInfo()/getChords() reflect it, not the previous song.
      if (viewState.active && window.highway) {
        _connectLyricsSocket(window.highway);
        _maybeDetectChordsFromAudio(window.highway);
      }
      return result;
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
    identifyFromHighway,
    generateChordTemplates,
    buildLyricLines,
    findLineIndex: _findLineIndex,
    baseOpenStringMidis,
    pitchFromBase,
    noteName,
    CHORD_QUALITIES,
    detectChordsFromAudio,
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
