'use strict';

(() => {
// The 20 waveform styles. Every style is a pure draw function:
// (ctx, w, h, d, color, t), where d is one frame of analysis data.
// Styles draw on a transparent canvas; the caller clears first.
// No randomness: the same audio frame always draws the same picture,
// so exports are reproducible.

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xff5721;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// Resample an array (bands or peaks) to n values.
function pick(arr, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = arr[Math.floor((i / n) * arr.length)];
  return out;
}

function wavePath(ctx, wave, w, h, amp) {
  const c = h / 2;
  ctx.beginPath();
  for (let i = 0; i < wave.length; i++) {
    const x = (i / (wave.length - 1)) * w;
    const y = c - wave[i] * amp;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
}

function smoothCurve(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2;
    const my = (points[i][1] + points[i + 1][1]) / 2;
    ctx.quadraticCurveTo(points[i][0], points[i][1], mx, my);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last[0], last[1]);
}

const STYLES = [
  {
    id: 'bars',
    name: 'Spectrum Bars',
    draw(ctx, w, h, d, color) {
      const n = 48;
      const v = pick(d.bands, n);
      const slot = w / n;
      const bw = slot * 0.68;
      ctx.fillStyle = color;
      for (let i = 0; i < n; i++) {
        const bh = Math.max(2, v[i] * h * 0.96);
        ctx.fillRect(i * slot + (slot - bw) / 2, h - bh, bw, bh);
      }
    },
  },
  {
    id: 'bars-mirror',
    name: 'Mirrored Bars',
    draw(ctx, w, h, d, color) {
      const n = 56;
      const v = pick(d.bands, n);
      const slot = w / n;
      const bw = slot * 0.62;
      const c = h / 2;
      for (let i = 0; i < n; i++) {
        const bh = Math.max(1.5, v[i] * c * 0.94);
        ctx.fillStyle = color;
        ctx.fillRect(i * slot + (slot - bw) / 2, c - bh, bw, bh);
        ctx.fillStyle = rgba(color, 0.55);
        ctx.fillRect(i * slot + (slot - bw) / 2, c, bw, bh);
      }
    },
  },
  {
    id: 'bars-round',
    name: 'Rounded Bars',
    draw(ctx, w, h, d, color) {
      const n = 32;
      const v = pick(d.bands, n);
      const slot = w / n;
      const c = h / 2;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineWidth = slot * 0.5;
      for (let i = 0; i < n; i++) {
        const x = i * slot + slot / 2;
        const bh = Math.max(ctx.lineWidth / 2, v[i] * c * 0.85);
        ctx.beginPath();
        ctx.moveTo(x, c - bh);
        ctx.lineTo(x, c + bh);
        ctx.stroke();
      }
    },
  },
  {
    id: 'bars-led',
    name: 'LED Blocks',
    draw(ctx, w, h, d, color) {
      const cols = 26;
      const rows = 14;
      const v = pick(d.bands, cols);
      const slotX = w / cols;
      const slotY = h / rows;
      const cw = slotX * 0.72;
      const ch = slotY * 0.62;
      for (let i = 0; i < cols; i++) {
        const lit = Math.round(v[i] * rows);
        for (let r = 0; r < lit; r++) {
          const top = r >= lit - 1 && lit > 2;
          ctx.fillStyle = top ? rgba(color, 1) : rgba(color, 0.32 + (0.55 * r) / rows);
          ctx.fillRect(i * slotX + (slotX - cw) / 2, h - (r + 1) * slotY + (slotY - ch) / 2, cw, ch);
        }
      }
    },
  },
  {
    id: 'line-scope',
    name: 'Oscilloscope',
    draw(ctx, w, h, d, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, h / 90);
      ctx.lineJoin = 'round';
      wavePath(ctx, d.wave, w, h, h * 0.44);
      ctx.stroke();
    },
  },
  {
    id: 'line-glow',
    name: 'Neon Scope',
    draw(ctx, w, h, d, color) {
      ctx.lineJoin = 'round';
      ctx.shadowColor = color;
      ctx.shadowBlur = Math.max(8, h / 14);
      ctx.strokeStyle = rgba(color, 0.85);
      ctx.lineWidth = Math.max(3, h / 60);
      wavePath(ctx, d.wave, w, h, h * 0.42);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, h / 220);
      wavePath(ctx, d.wave, w, h, h * 0.42);
      ctx.stroke();
    },
  },
  {
    id: 'area-wave',
    name: 'Filled Waveform',
    draw(ctx, w, h, d, color) {
      const c = h / 2;
      const amp = h * 0.44;
      wavePath(ctx, d.wave, w, h, amp);
      ctx.lineTo(w, c);
      ctx.lineTo(0, c);
      ctx.closePath();
      ctx.fillStyle = rgba(color, 0.85);
      ctx.fill();
      // Soft reflection below the centre line.
      ctx.save();
      ctx.translate(0, h);
      ctx.scale(1, -1);
      wavePath(ctx, d.wave, w, h, amp);
      ctx.lineTo(w, c);
      ctx.lineTo(0, c);
      ctx.closePath();
      ctx.fillStyle = rgba(color, 0.3);
      ctx.fill();
      ctx.restore();
    },
  },
  {
    id: 'ribbon',
    name: 'Ribbon Wave',
    draw(ctx, w, h, d, color) {
      const cols = 90;
      const c = h / 2;
      const per = d.wave.length / cols;
      const env = new Float32Array(cols);
      for (let i = 0; i < cols; i++) {
        let max = 0;
        for (let k = Math.floor(i * per); k < (i + 1) * per; k++) {
          const a = Math.abs(d.wave[k] || 0);
          if (a > max) max = a;
        }
        env[i] = max;
      }
      const top = [];
      const bottom = [];
      for (let i = 0; i < cols; i++) {
        const x = (i / (cols - 1)) * w;
        const e = Math.max(0.02, env[i]) * h * 0.46;
        top.push([x, c - e]);
        bottom.push([x, c + e]);
      }
      smoothCurve(ctx, top);
      for (let i = bottom.length - 1; i >= 0; i--) ctx.lineTo(bottom[i][0], bottom[i][1]);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgba(color, 0.9));
      grad.addColorStop(0.5, rgba(color, 0.45));
      grad.addColorStop(1, rgba(color, 0.9));
      ctx.fillStyle = grad;
      ctx.fill();
    },
  },
  {
    id: 'dots-wave',
    name: 'Wave Dots',
    draw(ctx, w, h, d, color) {
      const n = 72;
      const c = h / 2;
      const r = Math.max(1.6, h / 60);
      ctx.fillStyle = color;
      for (let i = 0; i < n; i++) {
        const s = d.wave[Math.floor((i / n) * d.wave.length)];
        ctx.beginPath();
        ctx.arc((i / (n - 1)) * w, c - s * h * 0.42, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'spectrum-line',
    name: 'Spectrum Curve',
    draw(ctx, w, h, d, color) {
      const n = 40;
      const v = pick(d.bands, n);
      const pts = [];
      for (let i = 0; i < n; i++) {
        pts.push([(i / (n - 1)) * w, h - Math.max(2, v[i] * h * 0.92)]);
      }
      smoothCurve(ctx, pts);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2.5, h / 70);
      ctx.lineJoin = 'round';
      ctx.stroke();
    },
  },
  {
    id: 'spectrum-area',
    name: 'Filled Spectrum',
    draw(ctx, w, h, d, color) {
      const n = 40;
      const v = pick(d.bands, n);
      const pts = [];
      for (let i = 0; i < n; i++) {
        pts.push([(i / (n - 1)) * w, h - Math.max(2, v[i] * h * 0.92)]);
      }
      smoothCurve(ctx, pts);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgba(color, 0.85));
      grad.addColorStop(1, rgba(color, 0.25));
      ctx.fillStyle = grad;
      ctx.fill();
      smoothCurve(ctx, pts);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, h / 90);
      ctx.stroke();
    },
  },
  {
    id: 'radial-bars',
    name: 'Circular Spectrum',
    draw(ctx, w, h, d, color) {
      const cx = w / 2;
      const cy = h / 2;
      const r0 = Math.min(w, h) * 0.22;
      const n = 72;
      const v = pick(d.bands, n);
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, (2 * Math.PI * r0) / n * 0.45);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        const len = Math.max(2, v[i] * Math.min(w, h) * 0.26);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        ctx.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r0 * 0.82, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, h / 160);
      ctx.strokeStyle = rgba(color, 0.6);
      ctx.stroke();
    },
  },
  {
    id: 'radial-wave',
    name: 'Waveform Ring',
    draw(ctx, w, h, d, color) {
      const cx = w / 2;
      const cy = h / 2;
      const r0 = Math.min(w, h) * 0.3;
      const n = d.wave.length;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const s = d.wave[i % n];
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        const r = r0 + s * r0 * 0.55;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, h / 110);
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.fillStyle = rgba(color, 0.12);
      ctx.fill();
    },
  },
  {
    id: 'starburst',
    name: 'Starburst',
    draw(ctx, w, h, d, color, t) {
      const cx = w / 2;
      const cy = h / 2;
      const n = 96;
      const v = pick(d.bands, n);
      const inner = Math.min(w, h) * 0.06;
      const reach = Math.min(w, h) * 0.42;
      const rot = t * 0.25;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, h / 200);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + rot;
        const len = inner + Math.max(2, v[i] * reach);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
        ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
        ctx.stroke();
      }
    },
  },
  {
    id: 'pulse',
    name: 'Pulse Circle',
    draw(ctx, w, h, d, color, t) {
      const cx = w / 2;
      const cy = h / 2;
      const rMax = Math.min(w, h) * 0.46;
      const r = rMax * (0.35 + d.rms * 0.5);
      // Two expanding, fading rings.
      for (let k = 0; k < 2; k++) {
        const phase = (t * 0.55 + k * 0.5) % 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.8 + phase * rMax * 0.9, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(color, (1 - phase) * 0.5 * (0.4 + d.rms));
        ctx.lineWidth = Math.max(1.5, h / 140);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(color, 0.35);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2.5, h / 90);
      ctx.stroke();
    },
  },
  {
    id: 'scroll-wave',
    name: 'Scrolling Waveform',
    draw(ctx, w, h, d, color) {
      const windowSec = 8;
      const cols = 110;
      const slot = w / cols;
      const bw = slot * 0.6;
      const c = h / 2;
      const colsPerSec = d.peaks.length / d.duration;
      for (let i = 0; i < cols; i++) {
        const sec = d.t + ((i - cols / 2) / cols) * windowSec;
        const idx = Math.floor(sec * colsPerSec);
        const p = idx >= 0 && idx < d.peaks.length ? d.peaks[idx] : 0;
        const bh = Math.max(1.5, p * c * 0.92);
        const isPast = i <= cols / 2;
        ctx.fillStyle = rgba(color, isPast ? 1 : 0.4);
        ctx.fillRect(i * slot + (slot - bw) / 2, c - bh, bw, bh * 2);
      }
      // Playhead marker.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(w / 2 - Math.max(1, w / 600), h * 0.06, Math.max(2, w / 300), h * 0.88);
    },
  },
  {
    id: 'progress-wave',
    name: 'Progress Waveform',
    draw(ctx, w, h, d, color) {
      const cols = 140;
      const v = pick(d.peaks, cols);
      const slot = w / cols;
      const bw = slot * 0.62;
      const c = h / 2;
      const playedCols = d.progress * cols;
      for (let i = 0; i < cols; i++) {
        const bh = Math.max(1.5, v[i] * c * 0.94);
        ctx.fillStyle = rgba(color, i < playedCols ? 1 : 0.35);
        ctx.fillRect(i * slot + (slot - bw) / 2, c - bh, bw, bh * 2);
      }
    },
  },
  {
    id: 'candles',
    name: 'Peak Candles',
    draw(ctx, w, h, d, color) {
      const n = 56;
      const c = h / 2;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, w / 220);
      for (let i = 0; i < n; i++) {
        let max = 0;
        const from = Math.floor((i / n) * d.wave.length);
        const to = Math.floor(((i + 1) / n) * d.wave.length);
        for (let k = from; k < to; k++) {
          const a = Math.abs(d.wave[k]);
          if (a > max) max = a;
        }
        const bh = Math.max(ctx.lineWidth, max * c * 0.9);
        const x = ((i + 0.5) / n) * w;
        ctx.beginPath();
        ctx.moveTo(x, c - bh);
        ctx.lineTo(x, c + bh);
        ctx.stroke();
      }
    },
  },
  {
    id: 'eq-grid',
    name: 'Equalizer Grid',
    draw(ctx, w, h, d, color) {
      const cols = 20;
      const rows = 10;
      const v = pick(d.bands, cols);
      const slotX = w / cols;
      const slotY = h / rows;
      const cw = slotX * 0.78;
      const ch = slotY * 0.72;
      const rad = Math.min(cw, ch) * 0.2;
      for (let i = 0; i < cols; i++) {
        const lit = Math.round(v[i] * rows);
        for (let r = 0; r < rows; r++) {
          const on = r < lit;
          ctx.fillStyle = rgba(color, on ? 0.45 + (0.55 * r) / rows : 0.1);
          ctx.beginPath();
          ctx.roundRect(i * slotX + (slotX - cw) / 2, h - (r + 1) * slotY + (slotY - ch) / 2, cw, ch, rad);
          ctx.fill();
        }
      }
    },
  },
  {
    id: 'particles',
    name: 'Bouncing Dots',
    draw(ctx, w, h, d, color) {
      const n = 36;
      const v = pick(d.bands, n);
      const r = Math.max(2, h / 46);
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * w;
        const y = h - Math.max(r, v[i] * h * 0.9);
        // Fading trail beneath each dot.
        for (let k = 2; k >= 0; k--) {
          ctx.fillStyle = rgba(color, k === 0 ? 1 : 0.25 / k);
          ctx.beginPath();
          ctx.arc(x, Math.min(h - r, y + k * r * 2.6), r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
];

window.WFStyles = { STYLES };
})();
