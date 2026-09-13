// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Chorder — chord name + diagram overlay, sourced from the active highway's
// chart data (getChords() / getChordTemplates()). Renders on its own canvas,
// independent of whichever viz renderer (default 2D, 3D, piano, ...) is
// active, so it does not need the isDefaultRenderer() coordinate guard other
// position-dependent overlays require.

const PLUGIN_ID = "chorder";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Ordered most-specific first: for a given root, the first formula whose
// intervals are all present in the played pitch-class set wins. This
// prefers e.g. "7" over "5" when a dominant 7th chord also happens to
// satisfy the power-chord subset.
const CHORD_FORMULAS = [
  { suffix: "maj9", intervals: [0, 4, 7, 11, 2] },
  { suffix: "m9", intervals: [0, 3, 7, 10, 2] },
  { suffix: "9", intervals: [0, 4, 7, 10, 2] },
  { suffix: "maj7", intervals: [0, 4, 7, 11] },
  { suffix: "m7b5", intervals: [0, 3, 6, 10] },
  { suffix: "dim7", intervals: [0, 3, 6, 9] },
  { suffix: "m7", intervals: [0, 3, 7, 10] },
  { suffix: "7", intervals: [0, 4, 7, 10] },
  { suffix: "6", intervals: [0, 4, 7, 9] },
  { suffix: "m6", intervals: [0, 3, 7, 9] },
  { suffix: "add9", intervals: [0, 4, 7, 2] },
  { suffix: "sus2", intervals: [0, 2, 7] },
  { suffix: "sus4", intervals: [0, 5, 7] },
  { suffix: "aug", intervals: [0, 4, 8] },
  { suffix: "dim", intervals: [0, 3, 6] },
  { suffix: "min", intervals: [0, 3, 7] },
  { suffix: "maj", intervals: [0, 4, 7] },
  { suffix: "5", intervals: [0, 7] },
];

// Pitch classes only (mod 12), so it doesn't matter whether `tuning[s]` is
// stored as an absolute MIDI note or some other octave — the modulo cancels
// octave entirely, as long as it's indexed the same way as `note.s`.
function pitchClassesForChord(chord, tuning, capo) {
  if (!chord || !chord.notes || !tuning) return [];
  const classes = new Set();
  for (const n of chord.notes) {
    const openPitch = tuning[n.s];
    if (openPitch == null) continue;
    classes.add((((openPitch + n.f + (capo || 0)) % 12) + 12) % 12);
  }
  return Array.from(classes);
}

// Derives a chord name (e.g. "Cm7") from the pitch-class set a chord's
// fretted notes produce, when the chart doesn't already carry a named
// chordTemplate (GP imports and other sources with no authored chord
// names). Picks, across all candidate roots, the formula that is fully
// contained in the played set with the fewest leftover (unexplained)
// tones; ties favor the richer (longer) formula.
function identifyChord(chord, tuning, capo) {
  const classes = pitchClassesForChord(chord, tuning, capo);
  if (classes.length === 0) return null;

  let best = null;
  for (const root of classes) {
    const present = new Set(classes.map((c) => (((c - root) % 12) + 12) % 12));
    for (const formula of CHORD_FORMULAS) {
      if (!formula.intervals.every((iv) => present.has(iv))) continue;
      const extra = present.size - formula.intervals.length;
      if (!best || extra < best.extra || (extra === best.extra && formula.intervals.length > best.size)) {
        best = { root, suffix: formula.suffix, extra, size: formula.intervals.length };
      }
      break; // formulas are ordered most-specific first per root
    }
  }
  if (!best) return null;

  const rootName = NOTE_NAMES[best.root];
  if (best.suffix === "maj") return rootName;
  if (best.suffix === "min") return `${rootName}m`;
  return `${rootName}${best.suffix}`;
}

if (!window[`__${PLUGIN_ID}_setup`]) {
  window[`__${PLUGIN_ID}_setup`] = true;
  chorderInit();
}

function chorderInit() {
  const state = {
    active: false,
    rafId: null,
    wrap: null,
    nameEl: null,
    diagramCanvas: null,
    diagramCtx: null,
    lastTime: -1,
    chordCursor: 0,
    lastChord: undefined,
    lastChordName: "—",
    settings: { showDiagram: true },
  };

  loadSettings(state);
  injectToggle(state);
}

async function loadSettings(state) {
  try {
    const res = await fetch(`/api/plugins/${PLUGIN_ID}/settings`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const settings = await res.json();
    state.settings.showDiagram = settings.show_diagram !== false;
  } catch (err) {
    console.warn(`${PLUGIN_ID}: could not load settings, using defaults`, err);
  }
}

function injectToggle(state) {
  const build = () => {
    const container =
      window.feedBack && window.feedBack.uiVersion === "v3" && window.feedBack.ui
        ? window.feedBack.ui.playerControlSlot()
        : null;
    if (!container) return false;
    if (container.querySelector(`[data-${PLUGIN_ID}-toggle]`)) return true;

    const btn = document.createElement("button");
    btn.setAttribute(`data-${PLUGIN_ID}-toggle`, "");
    btn.textContent = "🎸 Chords";
    btn.className = "fb-text";
    btn.addEventListener("click", () => toggle(state, btn));
    container.appendChild(btn);
    return true;
  };

  if (!build()) {
    window.addEventListener("feedBack:ui:ready", build, { once: true });
  }
}

function toggle(state, btn) {
  state.active ? stop(state, btn) : start(state, btn);
}

function start(state, btn) {
  const highway = window.highway;
  if (!highway) return;

  state.active = true;
  if (btn) btn.classList.add("chorder-active");
  buildOverlay(state);
  state.chordCursor = 0;
  state.lastTime = -1;
  state.lastChord = undefined;
  loop(state);

  window.feedBack &&
    window.feedBack.on &&
    window.feedBack.on("highway:visibility", (event) => {
      if (!state.active) return;
      state.wrap.style.display = event.detail.visible ? "" : "none";
    });
}

function stop(state, btn) {
  state.active = false;
  if (btn) btn.classList.remove("chorder-active");
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  if (state.wrap) {
    state.wrap.remove();
    state.wrap = null;
  }
}

function buildOverlay(state) {
  const player = document.getElementById("player");
  if (!player) return;

  const wrap = document.createElement("div");
  wrap.className = "chorder-overlay";

  const nameEl = document.createElement("div");
  nameEl.className = "chorder-name";
  nameEl.textContent = "—";
  wrap.appendChild(nameEl);

  const diagramCanvas = document.createElement("canvas");
  diagramCanvas.className = "chorder-diagram";
  diagramCanvas.width = 96;
  diagramCanvas.height = 120;
  wrap.appendChild(diagramCanvas);

  player.appendChild(wrap);

  state.wrap = wrap;
  state.nameEl = nameEl;
  state.diagramCanvas = diagramCanvas;
  state.diagramCtx = diagramCanvas.getContext("2d");
}

function loop(state) {
  if (!state.active) return;
  state.rafId = requestAnimationFrame(() => loop(state));

  const highway = window.highway;
  if (!highway || !highway.getTime) return;

  const time = highway.getTime();
  if (time === state.lastTime) return;

  // A seek can move time backward; a linear cursor only ever advances, so
  // reset it whenever time isn't monotonically increasing.
  if (time < state.lastTime) state.chordCursor = 0;
  state.lastTime = time;

  const chords = highway.getChords ? highway.getChords() : null;
  if (!chords || chords.length === 0) {
    if (state.lastChord !== null) {
      state.lastChord = null;
      state.lastChordName = "—";
      setChord(state, "—", null);
    }
    return;
  }

  let i = state.chordCursor;
  while (i + 1 < chords.length && chords[i + 1].t <= time) i++;
  state.chordCursor = i;

  const chord = chords[i].t <= time ? chords[i] : null;
  const templates = highway.getChordTemplates ? highway.getChordTemplates() : null;
  const template = chord && templates ? templates[chord.id] : null;

  // Chord identity only changes when the cursor advances (or resets on a
  // seek), not every frame — resolve the name/diagram once per chord, not
  // once per rAF tick.
  if (chord !== state.lastChord) {
    state.lastChord = chord;
    state.lastChordName = resolveChordName(chord, template, highway);
    setChord(state, state.lastChordName, template);
  }
}

function resolveChordName(chord, template, highway) {
  if (!chord) return "—";
  if (template && template.name) return template.name;

  const songInfo = highway.getSongInfo ? highway.getSongInfo() : null;
  const generated = songInfo && songInfo.tuning ? identifyChord(chord, songInfo.tuning, songInfo.capo) : null;
  return generated || "?";
}

function setChord(state, name, template) {
  if (!state.nameEl) return;
  state.nameEl.textContent = name;

  if (!state.settings.showDiagram || !state.diagramCtx) return;
  drawDiagram(state.diagramCtx, template);
}

function drawDiagram(ctx, template) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (!template || !template.frets) return;

  const strings = template.frets.length;
  const frets = 5;
  const marginX = 12;
  const marginY = 10;
  const stepX = (width - marginX * 2) / (strings - 1);
  const stepY = (height - marginY * 2) / frets;

  ctx.strokeStyle = "#9ca3af";
  ctx.lineWidth = 1;
  for (let f = 0; f <= frets; f++) {
    const y = marginY + f * stepY;
    ctx.beginPath();
    ctx.moveTo(marginX, y);
    ctx.lineTo(width - marginX, y);
    ctx.stroke();
  }
  for (let s = 0; s < strings; s++) {
    const x = marginX + s * stepX;
    ctx.beginPath();
    ctx.moveTo(x, marginY);
    ctx.lineTo(x, height - marginY);
    ctx.stroke();
  }

  ctx.fillStyle = "#4080e0";
  for (let s = 0; s < strings; s++) {
    const fret = template.frets[s];
    const x = marginX + s * stepX;
    if (fret === -1) continue;
    if (fret === 0) {
      ctx.strokeStyle = "#4080e0";
      ctx.beginPath();
      ctx.arc(x, marginY - 5, 3, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    if (fret > frets) continue;
    const y = marginY + (fret - 0.5) * stepY;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
