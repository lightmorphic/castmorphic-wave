'use strict';

(() => {
// Turns decoded mono PCM into the per-frame numbers the waveform styles
// draw with: frequency bands, an oscilloscope slice, loudness, and a
// whole-track peak outline for the scrolling/progress styles.

const FFT_SIZE = 2048;
const BAND_COUNT = 64;
const WAVE_POINTS = 256;
const PEAK_COLUMNS = 1600;

// In-place iterative radix-2 FFT.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

class Analyzer {
  constructor(pcm, sampleRate) {
    this.pcm = pcm;
    this.sampleRate = sampleRate;
    this.duration = pcm.length / sampleRate;

    // Normalise quiet recordings so the visuals still move.
    let peak = 0;
    for (let i = 0; i < pcm.length; i += 16) {
      const a = Math.abs(pcm[i]);
      if (a > peak) peak = a;
    }
    this.gain = peak > 0 ? Math.min(4, 1 / peak) : 1;

    this.hann = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      this.hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
    }
    this.re = new Float32Array(FFT_SIZE);
    this.im = new Float32Array(FFT_SIZE);

    // Log-spaced frequency band edges, 45 Hz up to 10 kHz.
    const minHz = 45;
    const maxHz = Math.min(10000, sampleRate / 2 - 100);
    this.bandEdges = new Float32Array(BAND_COUNT + 1);
    for (let b = 0; b <= BAND_COUNT; b++) {
      const hz = minHz * Math.pow(maxHz / minHz, b / BAND_COUNT);
      this.bandEdges[b] = (hz / sampleRate) * FFT_SIZE;
    }

    this.peaks = this.computePeaks();
  }

  // Whole-track outline: max amplitude per column.
  computePeaks() {
    const peaks = new Float32Array(PEAK_COLUMNS);
    const per = this.pcm.length / PEAK_COLUMNS;
    for (let c = 0; c < PEAK_COLUMNS; c++) {
      const start = Math.floor(c * per);
      const end = Math.min(this.pcm.length, Math.ceil((c + 1) * per));
      let max = 0;
      for (let i = start; i < end; i++) {
        const a = Math.abs(this.pcm[i]);
        if (a > max) max = a;
      }
      peaks[c] = Math.min(1, max * this.gain);
    }
    return peaks;
  }

  // Fresh smoothing state; one per consumer (preview and export each
  // keep their own so they never fight).
  newState() {
    return { bands: new Float32Array(BAND_COUNT), rms: 0 };
  }

  frame(t, state) {
    const center = Math.floor(t * this.sampleRate);

    // Frequency bands from a Hann-windowed FFT around t.
    const start = Math.max(0, Math.min(this.pcm.length - FFT_SIZE, center - FFT_SIZE / 2));
    for (let i = 0; i < FFT_SIZE; i++) {
      this.re[i] = (this.pcm[start + i] || 0) * this.hann[i] * this.gain;
      this.im[i] = 0;
    }
    fft(this.re, this.im);

    const bands = new Float32Array(BAND_COUNT);
    for (let b = 0; b < BAND_COUNT; b++) {
      const lo = Math.max(1, Math.floor(this.bandEdges[b]));
      const hi = Math.max(lo + 1, Math.ceil(this.bandEdges[b + 1]));
      let sum = 0;
      for (let k = lo; k < hi && k < FFT_SIZE / 2; k++) {
        sum += Math.hypot(this.re[k], this.im[k]);
      }
      const mag = sum / (hi - lo) / (FFT_SIZE / 4);
      const db = 20 * Math.log10(mag + 1e-7);
      let v = Math.max(0, Math.min(1, (db + 64) / 60));
      // Fast attack, slow release, so bars snap up and fall gently.
      const prev = state.bands[b];
      v = v > prev ? v : prev * 0.86 + v * 0.14;
      state.bands[b] = v;
      bands[b] = v;
    }

    // Oscilloscope slice: 40 ms window around t.
    const wave = new Float32Array(WAVE_POINTS);
    const winLen = Math.floor(this.sampleRate * 0.04);
    const wStart = Math.max(0, Math.min(this.pcm.length - winLen, center - winLen / 2));
    for (let i = 0; i < WAVE_POINTS; i++) {
      const idx = wStart + Math.floor((i / WAVE_POINTS) * winLen);
      wave[i] = Math.max(-1, Math.min(1, (this.pcm[idx] || 0) * this.gain));
    }

    // Loudness over one frame's worth of samples.
    let sumSq = 0;
    let peakA = 0;
    const rStart = Math.max(0, center - winLen / 2);
    const rEnd = Math.min(this.pcm.length, rStart + winLen);
    for (let i = rStart; i < rEnd; i++) {
      const a = this.pcm[i] * this.gain;
      sumSq += a * a;
      const abs = Math.abs(a);
      if (abs > peakA) peakA = abs;
    }
    let rms = rEnd > rStart ? Math.sqrt(sumSq / (rEnd - rStart)) : 0;
    rms = rms > state.rms ? rms : state.rms * 0.9 + rms * 0.1;
    state.rms = rms;

    return {
      bands,
      wave,
      rms: Math.min(1, rms * 1.4),
      peak: Math.min(1, peakA),
      progress: this.duration > 0 ? Math.min(1, t / this.duration) : 0,
      peaks: this.peaks,
      t,
      duration: this.duration,
    };
  }
}

// Looping synthetic data so style thumbnails animate before any audio
// is loaded (and in the picker at all times).
function demoFrame(t) {
  const bands = new Float32Array(BAND_COUNT);
  for (let b = 0; b < BAND_COUNT; b++) {
    const base = 0.55 - (b / BAND_COUNT) * 0.25;
    bands[b] = Math.max(0.04, Math.min(1,
      base +
      0.35 * Math.sin(t * 2.1 + b * 0.55) * Math.sin(t * 0.7 + b * 0.13) +
      0.18 * Math.sin(t * 5.3 + b * 1.7)));
  }
  const wave = new Float32Array(WAVE_POINTS);
  for (let i = 0; i < WAVE_POINTS; i++) {
    const x = i / WAVE_POINTS;
    wave[i] = 0.5 * Math.sin(x * 14 + t * 6) * Math.sin(x * 3 + t * 1.3) +
              0.25 * Math.sin(x * 47 + t * 11);
  }
  const peaks = new Float32Array(PEAK_COLUMNS);
  for (let c = 0; c < PEAK_COLUMNS; c++) {
    peaks[c] = 0.2 + 0.75 * Math.abs(Math.sin(c * 0.043) * Math.sin(c * 0.011 + 1.3));
  }
  const rms = 0.45 + 0.3 * Math.sin(t * 2.4) * Math.sin(t * 0.9);
  return {
    bands,
    wave,
    rms: Math.abs(rms),
    peak: Math.abs(rms) * 1.2,
    progress: (t % 30) / 30,
    peaks,
    t,
    duration: 30,
  };
}

window.WFAnalysis = { Analyzer, demoFrame, BAND_COUNT, WAVE_POINTS, PEAK_COLUMNS };
})();
