'use strict';

(() => {
// Picks a waveform colour that suits the background image: the most
// prominent vivid hue, brightened or deepened so it stands out against
// the image's overall brightness.

const FALLBACK = '#FF5721';

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const dlt = max - min;
  const s = l > 0.5 ? dlt / (2 - max - min) : dlt / (max + min);
  let hue;
  if (max === r) hue = ((g - b) / dlt + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / dlt + 2) / 6;
  else hue = ((r - g) / dlt + 4) / 6;
  return [hue, s, l];
}

function hslToHex(hue, s, l) {
  const f = (n) => {
    const k = (n + hue * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function autoColorFromImage(img) {
  const cw = 80;
  const ch = 45;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Cover-crop the sample the same way the export crops the image.
  const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  const { data } = ctx.getImageData(0, 0, cw, ch);

  const BINS = 24;
  const weight = new Float32Array(BINS);
  const satSum = new Float32Array(BINS);
  let lumSum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [hue, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    lumSum += l;
    count += 1;
    if (l < 0.08 || l > 0.95 || s < 0.15) continue;
    const bin = Math.min(BINS - 1, Math.floor(hue * BINS));
    const wgt = s * (1 - Math.abs(l - 0.5) * 1.4);
    if (wgt <= 0) continue;
    weight[bin] += wgt;
    satSum[bin] += s * wgt;
  }

  const avgLum = count ? lumSum / count : 0.5;
  let best = -1;
  let bestW = 0;
  for (let b = 0; b < BINS; b++) {
    if (weight[b] > bestW) { bestW = weight[b]; best = b; }
  }
  // Mostly grey image: no meaningful hue to match, use brand orange.
  if (best < 0 || bestW < count * 0.01) return FALLBACK;

  const hue = (best + 0.5) / BINS;
  const sat = Math.min(0.92, Math.max(0.6, (satSum[best] / bestW) * 1.2));
  // Bright image gets a deeper tone; dark image gets a lighter one.
  const light = avgLum > 0.6 ? 0.42 : avgLum < 0.35 ? 0.62 : 0.54;
  return hslToHex(hue, sat, light).toUpperCase();
}

window.WFColor = { autoColorFromImage, FALLBACK };
})();
