'use strict';

// UI orchestration: file loading, the draggable waveform box, style
// picking, colour handling, live preview, and the export loop.

const { Analyzer, demoFrame } = window.WFAnalysis;
const { STYLES } = window.WFStyles;
const { autoColorFromImage, FALLBACK } = window.WFColor;

const FRAME_W = 1920;
const FRAME_H = 1080;
const FPS = 30;
const MIN_BOX_W = 0.06;
const MIN_BOX_H = 0.05;

const els = {};
[
  'stage', 'bg-canvas', 'stage-empty', 'wavebox', 'wave-canvas', 'audio-player',
  'style-grid', 'image-drop', 'image-input', 'image-name', 'image-warning', 'image-note',
  'audio-drop', 'audio-input', 'audio-name', 'audio-info', 'audio-warning',
  'colour-auto', 'auto-swatch', 'colour-picker', 'colour-hex', 'container-select',
  'container-note', 'export-btn', 'progress-area', 'progress-bar-wrap', 'progress-fill',
  'progress-text', 'cancel-btn', 'status-area',
].forEach((id) => {
  els[id.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = document.getElementById(id);
});

const state = {
  image: null,   // { path, img, width, height, bigEnough }
  audio: null,   // { path, name, probe, analyzer }
  box: { x: 0.1, y: 0.6, w: 0.8, h: 0.3 },
  styleId: 'bars-mirror',
  colorMode: 'auto',
  autoColor: FALLBACK,
  customColor: FALLBACK,
  containerChoice: 'auto',
  exporting: null, // { id, cancelled }
};

const dpr = Math.min(2, window.devicePixelRatio || 1);
const previewAnalysisState = { bands: null, rms: 0 };

function currentColor() {
  return state.colorMode === 'auto' ? state.autoColor : state.customColor;
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setMsg(el, text) {
  el.textContent = text || '';
  el.hidden = !text;
}

function setStatus(kind, text, filePath) {
  els.statusArea.textContent = '';
  if (!text) return;
  const p = document.createElement('p');
  p.className = `msg ${kind}`;
  p.textContent = text;
  if (filePath) {
    const span = document.createElement('span');
    span.className = 'path';
    span.textContent = ` ${filePath}`;
    p.appendChild(span);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary';
    btn.textContent = 'Show in folder';
    btn.addEventListener('click', () => window.waveframe.showInFolder(filePath));
    p.appendChild(btn);
  }
  els.statusArea.appendChild(p);
}

// ---------------------------------------------------------------------------
// Background image
// ---------------------------------------------------------------------------

function drawBackground() {
  const canvas = els.bgCanvas;
  const rect = els.stage.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.image) return;
  const { img } = state.image;
  // Cover-crop, exactly as the export does.
  const scale = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
}

async function loadImageFile(file) {
  if (state.exporting) return;
  const path = window.waveframe.pathForFile(file);
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const bigEnough = img.naturalWidth >= FRAME_W && img.naturalHeight >= FRAME_H;
    if (state.image && state.image.url) URL.revokeObjectURL(state.image.url);
    state.image = { path, img, url, width: img.naturalWidth, height: img.naturalHeight, bigEnough };
    els.imageName.textContent = `✓ ${file.name} (${img.naturalWidth} × ${img.naturalHeight})`;

    if (!bigEnough) {
      setMsg(els.imageWarning,
        `This image is ${img.naturalWidth} × ${img.naturalHeight} pixels, which is smaller than ` +
        'the 1920 × 1080 a sharp 1080p video needs. Making it bigger would only blur it, ' +
        'so please choose a larger image.');
    } else {
      setMsg(els.imageWarning, '');
    }

    const ratio = img.naturalWidth / img.naturalHeight;
    if (bigEnough && Math.abs(ratio - 16 / 9) > 0.02) {
      setMsg(els.imageNote,
        'This image is not 16:9, so its edges will be trimmed evenly to fill the video frame. ' +
        'The preview shows exactly what the video will look like.');
    } else {
      setMsg(els.imageNote, '');
    }

    state.autoColor = autoColorFromImage(img);
    els.autoSwatch.style.background = state.autoColor;
    if (state.colorMode === 'auto') syncColourInputs(state.autoColor);

    els.stageEmpty.hidden = true;
    drawBackground();
    updateExportReadiness();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    setMsg(els.imageWarning, 'That image could not be opened. Try a different JPG or PNG.');
  };
  img.src = url;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

const CODEC_LABELS = {
  mp3: 'MP3', aac: 'AAC', alac: 'Apple Lossless', flac: 'FLAC', vorbis: 'OGG Vorbis',
  opus: 'Opus', pcm_s16le: 'WAV (uncompressed)', pcm_s24le: 'WAV (uncompressed)',
  pcm_s32le: 'WAV (uncompressed)', pcm_f32le: 'WAV (uncompressed)', pcm_u8: 'WAV (uncompressed)',
};

function codecLabel(codec) {
  return CODEC_LABELS[codec] || codec.toUpperCase();
}

async function loadAudioFile(file) {
  if (state.exporting) return;
  const path = window.waveframe.pathForFile(file);
  setMsg(els.audioWarning, '');
  setMsg(els.audioInfo, 'Reading the audio…');
  els.audioName.textContent = '';
  state.audio = null;
  updateExportReadiness();

  const probe = await window.waveframe.probeAudio(path);
  if (probe.error) {
    setMsg(els.audioInfo, '');
    setMsg(els.audioWarning, probe.error);
    return;
  }

  const decoded = await window.waveframe.decodeAudio(path);
  if (decoded.error) {
    setMsg(els.audioInfo, '');
    setMsg(els.audioWarning, decoded.error);
    return;
  }

  const pcm = new Float32Array(decoded.pcm);
  const analyzer = new Analyzer(pcm, decoded.sampleRate);
  previewAnalysisState.bands = null; // reset smoothing for the new track
  state.audio = { path, name: file.name, probe, analyzer };

  els.audioName.textContent = `✓ ${file.name}`;
  let info = `${codecLabel(probe.codec)}, ${formatDuration(analyzer.duration)}.`;
  if (probe.extraAudioStreams > 0) {
    info += ` This file has ${probe.extraAudioStreams + 1} audio tracks — the first one will be used.`;
  }
  setMsg(els.audioInfo, info);

  const audioEl = els.audioPlayer;
  audioEl.src = URL.createObjectURL(file);
  audioEl.hidden = false;

  updateContainerNote();
  updateExportReadiness();
}

// ---------------------------------------------------------------------------
// Waveform box: drag, resize, keyboard
// ---------------------------------------------------------------------------

function layoutBox() {
  const b = state.box;
  els.wavebox.style.left = `${b.x * 100}%`;
  els.wavebox.style.top = `${b.y * 100}%`;
  els.wavebox.style.width = `${b.w * 100}%`;
  els.wavebox.style.height = `${b.h * 100}%`;
  const rect = els.wavebox.getBoundingClientRect();
  els.waveCanvas.width = Math.max(2, Math.round(rect.width * dpr));
  els.waveCanvas.height = Math.max(2, Math.round(rect.height * dpr));
}

function clampBox(b) {
  b.w = Math.min(1, Math.max(MIN_BOX_W, b.w));
  b.h = Math.min(1, Math.max(MIN_BOX_H, b.h));
  b.x = Math.min(1 - b.w, Math.max(0, b.x));
  b.y = Math.min(1 - b.h, Math.max(0, b.y));
  return b;
}

let dragCtx = null;

function onPointerDown(event) {
  const dir = event.target.dataset ? event.target.dataset.dir : null;
  dragCtx = {
    mode: dir ? 'resize' : 'move',
    dir,
    startX: event.clientX,
    startY: event.clientY,
    startBox: { ...state.box },
    stageRect: els.stage.getBoundingClientRect(),
  };
  els.wavebox.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event) {
  if (!dragCtx) return;
  const dx = (event.clientX - dragCtx.startX) / dragCtx.stageRect.width;
  const dy = (event.clientY - dragCtx.startY) / dragCtx.stageRect.height;
  const s = dragCtx.startBox;
  const b = { ...s };
  if (dragCtx.mode === 'move') {
    b.x = s.x + dx;
    b.y = s.y + dy;
  } else {
    const d = dragCtx.dir;
    if (d.includes('e')) b.w = s.w + dx;
    if (d.includes('s')) b.h = s.h + dy;
    if (d.includes('w')) { b.x = s.x + dx; b.w = s.w - dx; }
    if (d.includes('n')) { b.y = s.y + dy; b.h = s.h - dy; }
    // Keep the opposite edge pinned while clamping to minimum size.
    if (b.w < MIN_BOX_W) {
      if (d.includes('w')) b.x = s.x + s.w - MIN_BOX_W;
      b.w = MIN_BOX_W;
    }
    if (b.h < MIN_BOX_H) {
      if (d.includes('n')) b.y = s.y + s.h - MIN_BOX_H;
      b.h = MIN_BOX_H;
    }
  }
  state.box = clampBox(b);
  layoutBox();
}

function onPointerUp(event) {
  if (dragCtx) {
    els.wavebox.releasePointerCapture(event.pointerId);
    dragCtx = null;
  }
}

function onBoxKey(event) {
  const step = 0.01;
  const b = { ...state.box };
  let handled = true;
  const grow = event.shiftKey;
  switch (event.key) {
    case 'ArrowLeft': grow ? (b.w -= step) : (b.x -= step); break;
    case 'ArrowRight': grow ? (b.w += step) : (b.x += step); break;
    case 'ArrowUp': grow ? (b.h -= step) : (b.y -= step); break;
    case 'ArrowDown': grow ? (b.h += step) : (b.y += step); break;
    default: handled = false;
  }
  if (handled) {
    state.box = clampBox(b);
    layoutBox();
    event.preventDefault();
  }
}

// ---------------------------------------------------------------------------
// Style picker
// ---------------------------------------------------------------------------

const thumbCanvases = [];

function buildStyleGrid() {
  STYLES.forEach((style) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'style-option';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(style.id === state.styleId));
    btn.tabIndex = style.id === state.styleId ? 0 : -1;
    btn.dataset.styleId = style.id;

    const canvas = document.createElement('canvas');
    canvas.width = 176;
    canvas.height = 99;
    btn.appendChild(canvas);

    const name = document.createElement('span');
    name.className = 'style-name';
    name.textContent = style.name;
    btn.appendChild(name);

    btn.addEventListener('click', () => selectStyle(style.id));
    els.styleGrid.appendChild(btn);
    thumbCanvases.push({ style, ctx: canvas.getContext('2d'), w: canvas.width, h: canvas.height });
  });

  // Roving focus with arrow keys, as a radio group should.
  els.styleGrid.addEventListener('keydown', (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(event.key)) return;
    const buttons = [...els.styleGrid.querySelectorAll('.style-option')];
    const idx = buttons.indexOf(document.activeElement);
    if (idx < 0) return;
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = buttons[(idx + delta + buttons.length) % buttons.length];
    selectStyle(next.dataset.styleId);
    next.focus();
    event.preventDefault();
  });
}

function selectStyle(styleId) {
  state.styleId = styleId;
  els.styleGrid.querySelectorAll('.style-option').forEach((btn) => {
    const on = btn.dataset.styleId === styleId;
    btn.setAttribute('aria-checked', String(on));
    btn.tabIndex = on ? 0 : -1;
  });
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function syncColourInputs(hex) {
  els.colourPicker.value = hex.toLowerCase();
  els.colourHex.value = hex.toUpperCase();
}

function setColourMode(mode) {
  state.colorMode = mode;
  els.colourAuto.setAttribute('aria-pressed', String(mode === 'auto'));
  if (mode === 'auto') syncColourInputs(state.autoColor);
}

// ---------------------------------------------------------------------------
// Container choice
// ---------------------------------------------------------------------------

function effectiveContainer() {
  const probe = state.audio && state.audio.probe;
  const auto = probe ? probe.autoContainer : 'mp4';
  if (state.containerChoice === 'auto') return auto;
  if (state.containerChoice === 'mp4' && probe && !probe.mp4Compatible) return 'mkv';
  return state.containerChoice;
}

function updateContainerNote() {
  const probe = state.audio && state.audio.probe;
  const note = els.containerNote;
  note.classList.remove('warning');
  note.classList.add('info');
  if (!probe) {
    note.textContent = 'Automatic picks MP4 when your audio fits it (MP3, AAC/M4A) and MKV ' +
      'otherwise. YouTube accepts both, and your audio is copied into the video untouched either way.';
    return;
  }
  const label = codecLabel(probe.codec);
  if (state.containerChoice === 'auto') {
    note.textContent = probe.mp4Compatible
      ? `Will save as MP4 — ${label} audio fits MP4 directly, so it is copied in untouched.`
      : `Will save as MKV — ${label} audio cannot go into an MP4 without re-encoding it, and ` +
        'Waveframe never touches your audio. YouTube accepts MKV uploads.';
  } else if (state.containerChoice === 'mp4' && !probe.mp4Compatible) {
    note.classList.remove('info');
    note.classList.add('warning');
    note.textContent = `${label} audio cannot be put into an MP4 file without re-encoding it, ` +
      'which would change the sound. Waveframe never re-encodes audio, so this will save as ' +
      'MKV instead. YouTube accepts MKV uploads.';
  } else if (state.containerChoice === 'mkv' && probe.mp4Compatible) {
    note.textContent = `Will save as MKV. (MP4 would also work for ${label} audio, ` +
      'and is the more widely supported choice.)';
  } else {
    note.textContent = `Will save as ${effectiveContainer().toUpperCase()}, with the ` +
      `${label} audio copied in untouched.`;
  }
}

// ---------------------------------------------------------------------------
// Export readiness + the export loop
// ---------------------------------------------------------------------------

function updateExportReadiness() {
  const ready = Boolean(
    state.image && state.image.bigEnough && state.audio && !state.exporting,
  );
  els.exportBtn.disabled = !ready;
}

function boxToPixels() {
  // Even numbers keep the video encoder happy.
  const even = (n) => Math.max(2, 2 * Math.round(n / 2));
  const x = even(state.box.x * FRAME_W);
  const y = even(state.box.y * FRAME_H);
  let w = even(state.box.w * FRAME_W);
  let h = even(state.box.h * FRAME_H);
  w = Math.min(w, FRAME_W - x);
  h = Math.min(h, FRAME_H - y);
  return { x, y, w: even(w), h: even(h) };
}

async function runExport() {
  if (!state.image || !state.image.bigEnough || !state.audio || state.exporting) return;

  const container = effectiveContainer();
  const baseName = state.audio.name.replace(/\.[^.]+$/, '') || 'waveframe';
  const chosen = await window.waveframe.chooseExportPath({ baseName, container });
  if (chosen.canceled || !chosen.filePath) return;

  // Make sure the file ends in the right extension for its contents.
  let outPath = chosen.filePath;
  if (!outPath.toLowerCase().endsWith(`.${container}`)) {
    outPath = outPath.replace(/\.(mp4|mkv)$/i, '');
    outPath = `${outPath}.${container}`;
  }

  const box = boxToPixels();
  const analyzer = state.audio.analyzer;
  const totalFrames = Math.ceil(analyzer.duration * FPS) + 2;

  // Capture everything the export uses, so fiddling with the UI while
  // it runs cannot change the result.
  const styleId = state.styleId;
  const color = currentColor();
  const style = STYLES.find((s) => s.id === styleId);

  const started = await window.waveframe.exportStart({
    imagePath: state.image.path,
    audioPath: state.audio.path,
    outPath,
    container,
    box,
    fps: FPS,
    totalFrames,
  });
  if (started.error) {
    setStatus('error', started.error);
    return;
  }

  state.exporting = { id: started.id, cancelled: false };
  els.progressArea.hidden = false;
  els.cancelBtn.disabled = false;
  setStatus('', '');
  updateExportReadiness();
  els.audioPlayer.pause();

  const canvas = document.createElement('canvas');
  canvas.width = box.w;
  canvas.height = box.h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const analysisState = analyzer.newState();
  const startedAt = performance.now();
  let failed = null;

  for (let f = 0; f < totalFrames; f++) {
    if (state.exporting.cancelled) break;
    const t = f / FPS;
    const data = analyzer.frame(Math.min(t, analyzer.duration), analysisState);
    ctx.clearRect(0, 0, box.w, box.h);
    style.draw(ctx, box.w, box.h, data, color, t);
    const pixels = ctx.getImageData(0, 0, box.w, box.h);
    const result = await window.waveframe.exportFrame(
      state.exporting.id, new Uint8Array(pixels.data.buffer),
    );
    if (result.error) {
      failed = result.error;
      break;
    }
    if (f % 10 === 0 || f === totalFrames - 1) {
      const pct = Math.round(((f + 1) / totalFrames) * 100);
      els.progressFill.style.width = `${pct}%`;
      els.progressBarWrap.setAttribute('aria-valuenow', String(pct));
      const elapsed = (performance.now() - startedAt) / 1000;
      const rate = (f + 1) / Math.max(0.1, elapsed);
      const remaining = Math.max(0, Math.round((totalFrames - f - 1) / rate));
      els.progressText.textContent =
        `Drawing frame ${(f + 1).toLocaleString()} of ${totalFrames.toLocaleString()}` +
        (f > 30 ? ` — about ${formatDuration(remaining)} left` : '');
    }
  }

  if (state.exporting.cancelled) {
    await window.waveframe.exportCancel(state.exporting.id);
    finishExport();
    setStatus('info', 'Export cancelled. Nothing was saved.');
    return;
  }
  if (failed) {
    finishExport();
    setStatus('error', failed);
    return;
  }

  els.progressText.textContent = 'Finishing the video file…';
  els.cancelBtn.disabled = true;
  const ended = await window.waveframe.exportEnd(state.exporting.id);
  finishExport();
  if (ended.error) {
    setStatus('error', ended.error);
  } else {
    setStatus('success', 'Done! Your video is saved at', ended.outPath);
  }
}

function finishExport() {
  state.exporting = null;
  els.progressArea.hidden = true;
  els.progressFill.style.width = '0%';
  els.progressText.textContent = '';
  updateExportReadiness();
}

// ---------------------------------------------------------------------------
// Live preview loop
// ---------------------------------------------------------------------------

let demoT = 0;
let lastTick = performance.now();
let thumbTick = 0;

function tick(now) {
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;

  // While exporting, all drawing effort goes to the export itself.
  if (!state.exporting) {
    const ctx = els.waveCanvas.getContext('2d');
    const w = els.waveCanvas.width;
    const h = els.waveCanvas.height;
    ctx.clearRect(0, 0, w, h);

    let data;
    let t;
    if (state.audio) {
      const audioEl = els.audioPlayer;
      if (!audioEl.paused && !audioEl.ended) {
        demoT = audioEl.currentTime;
      } else {
        demoT = (demoT + dt) % state.audio.analyzer.duration;
      }
      t = demoT;
      if (!previewAnalysisState.bands) {
        Object.assign(previewAnalysisState, state.audio.analyzer.newState());
      }
      data = state.audio.analyzer.frame(t, previewAnalysisState);
    } else {
      t = now / 1000;
      data = demoFrame(t);
    }
    const style = STYLES.find((s) => s.id === state.styleId);
    style.draw(ctx, w, h, data, currentColor(), t);

    // Thumbnails animate at half rate; they are only examples.
    thumbTick += 1;
    if (thumbTick % 2 === 0) {
      const demo = demoFrame(now / 1000);
      thumbCanvases.forEach(({ style: s, ctx: tctx, w: tw, h: th }) => {
        tctx.clearRect(0, 0, tw, th);
        s.draw(tctx, tw, th, demo, currentColor(), now / 1000);
      });
    }
  }

  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wireDropzone(zone, input, onFile) {
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      input.click();
      event.preventDefault();
    }
  });
  input.addEventListener('change', () => {
    if (input.files && input.files[0]) onFile(input.files[0]);
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('drag-over');
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      onFile(event.dataTransfer.files[0]);
    }
  });
}

wireDropzone(els.imageDrop, els.imageInput, loadImageFile);
wireDropzone(els.audioDrop, els.audioInput, loadAudioFile);

els.wavebox.addEventListener('pointerdown', onPointerDown);
els.wavebox.addEventListener('pointermove', onPointerMove);
els.wavebox.addEventListener('pointerup', onPointerUp);
els.wavebox.addEventListener('pointercancel', onPointerUp);
els.wavebox.addEventListener('keydown', onBoxKey);

els.colourAuto.addEventListener('click', () => setColourMode('auto'));
els.colourPicker.addEventListener('input', () => {
  state.customColor = els.colourPicker.value.toUpperCase();
  setColourMode('custom');
  els.colourHex.value = state.customColor;
});
els.colourHex.addEventListener('change', () => {
  let v = els.colourHex.value.trim();
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
    state.customColor = v.toUpperCase();
    setColourMode('custom');
    syncColourInputs(v);
  } else {
    syncColourInputs(currentColor());
  }
});

els.containerSelect.addEventListener('change', () => {
  state.containerChoice = els.containerSelect.value;
  updateContainerNote();
});

els.exportBtn.addEventListener('click', runExport);
els.cancelBtn.addEventListener('click', () => {
  if (state.exporting) {
    state.exporting.cancelled = true;
    els.cancelBtn.disabled = true;
  }
});

// Drops anywhere outside the two dropzones must not make Chromium
// navigate away to the dropped file.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

new ResizeObserver(() => {
  drawBackground();
  layoutBox();
}).observe(els.stage);

buildStyleGrid();
setColourMode('auto');
els.autoSwatch.style.background = state.autoColor;
layoutBox();
updateContainerNote();
requestAnimationFrame(tick);
