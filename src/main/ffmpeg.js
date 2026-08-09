'use strict';

// Everything that talks to the bundled FFmpeg binary lives here.
// FFmpeg is always spawned with an argument array, never a shell string,
// so file names containing spaces, quotes or shell metacharacters are safe.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// ffmpeg-static resolves to a real file in development. Inside a packaged
// app the module lives in app.asar but the binary is unpacked next to it.
function ffmpegPath() {
  const p = require('ffmpeg-static');
  return p.includes('app.asar')
    ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    : p;
}

// Audio codecs that can be stream-copied into an MP4 container.
// Everything else goes into MKV (which accepts any codec, and YouTube
// accepts MKV uploads).
const MP4_SAFE_CODECS = new Set(['mp3', 'aac', 'alac']);

// Analysis decode settings. 22050 Hz mono float is plenty for drawing
// waveforms and spectra, and keeps memory reasonable for long tracks.
const ANALYSIS_RATE = 22050;
const MAX_ANALYSIS_BYTES = 950 * 1024 * 1024; // ~3 hours of audio

function run(args, { collectStdout = false, maxStdout = Infinity, onStdoutBytes = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, {
      stdio: ['ignore', collectStdout ? 'pipe' : 'ignore', 'pipe'],
    });
    const stdoutChunks = [];
    let stdoutBytes = 0;
    let stderr = '';
    let failed = false;
    if (collectStdout) {
      child.stdout.on('data', (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxStdout) {
          failed = true;
          child.kill('SIGKILL');
          return;
        }
        stdoutChunks.push(chunk);
        if (onStdoutBytes) onStdoutBytes(stdoutBytes);
      });
    }
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 512 * 1024) stderr = stderr.slice(-256 * 1024);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (failed) {
        reject(new Error('too-long'));
      } else {
        resolve({ code, stderr, stdout: collectStdout ? Buffer.concat(stdoutChunks) : null });
      }
    });
  });
}

// Read the audio stream details out of FFmpeg's own file report.
// (We deliberately avoid a separate ffprobe binary to keep the bundle lean.)
async function probeAudio(filePath) {
  const { stderr } = await run(['-hide_banner', '-i', filePath]);

  const streamMatch = stderr.match(/Stream #0:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio: ([A-Za-z0-9_]+)/);
  if (!streamMatch) {
    throw new Error('no-audio-stream');
  }
  const codec = streamMatch[1].toLowerCase();

  let duration = null;
  const durMatch = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  if (durMatch) {
    duration = Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]);
  }

  const audioStreamCount = (stderr.match(/: Audio: /g) || []).length;

  return {
    codec,
    duration,
    autoContainer: MP4_SAFE_CODECS.has(codec) ? 'mp4' : 'mkv',
    mp4Compatible: MP4_SAFE_CODECS.has(codec),
    extraAudioStreams: audioStreamCount - 1,
  };
}

// Decode the audio to mono float PCM for waveform analysis.
// This decoded copy is only ever used for drawing; the export always
// stream-copies the original file untouched.
async function decodeForAnalysis(filePath, { expectedSeconds = 0, onProgress = null } = {}) {
  // Known duration means real percentages while decoding.
  const expectedBytes = expectedSeconds > 0 ? expectedSeconds * ANALYSIS_RATE * 4 : 0;
  let lastPercent = -1;
  const { code, stdout, stderr } = await run(
    ['-hide_banner', '-i', filePath, '-vn', '-sn', '-map', '0:a:0',
     '-ac', '1', '-ar', String(ANALYSIS_RATE), '-f', 'f32le', '-'],
    {
      collectStdout: true,
      maxStdout: MAX_ANALYSIS_BYTES,
      onStdoutBytes: (bytes) => {
        if (!onProgress || !expectedBytes) return;
        const percent = Math.min(99, Math.floor((bytes / expectedBytes) * 100));
        if (percent > lastPercent) {
          lastPercent = percent;
          onProgress(percent);
        }
      },
    },
  );
  if (code !== 0 || !stdout || stdout.length === 0) {
    const err = new Error('decode-failed');
    err.detail = stderr.slice(-2000);
    throw err;
  }
  return { pcm: stdout, sampleRate: ANALYSIS_RATE };
}

// A running export: one FFmpeg process fed raw RGBA frames on stdin.
class ExportJob {
  constructor({ imagePath, audioPath, outPath, container, box, fps, totalFrames }) {
    this.totalFrames = totalFrames;
    this.framesWritten = 0;
    this.stderr = '';
    this.finished = null;

    const args = [
      '-y', '-hide_banner', '-nostats',
      // Input 0: the still background image, looped for the whole video.
      '-loop', '1', '-i', imagePath,
      // Input 1: the animated waveform frames, raw RGBA on stdin.
      '-f', 'rawvideo', '-pix_fmt', 'rgba',
      '-video_size', `${box.w}x${box.h}`, '-framerate', String(fps),
      '-i', 'pipe:0',
      // Input 2: the original audio file, copied bit-for-bit.
      '-i', audioPath,
      // Fill 1920x1080 with the image (centre-cropping if it is not 16:9),
      // then lay the waveform frames on top at the user's box position.
      // shortest=1 ends the video track when the piped frames stop.
      '-filter_complex',
      '[0:v]scale=1920:1080:force_original_aspect_ratio=increase,' +
      `crop=1920:1080[bg];[bg][1:v]overlay=${box.x}:${box.y}:shortest=1,` +
      'format=yuv420p[out]',
      '-map', '[out]', '-map', '2:a:0',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(fps),
      '-c:a', 'copy',
      // We always send slightly more video frames than the audio needs,
      // so -shortest trims the output to exactly the audio's length.
      '-shortest',
    ];
    if (container === 'mp4') args.push('-movflags', '+faststart');
    args.push(outPath);

    this.child = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk;
      if (this.stderr.length > 512 * 1024) this.stderr = this.stderr.slice(-256 * 1024);
    });
    this.done = new Promise((resolve) => {
      this.child.on('close', (code) => {
        this.finished = { code };
        resolve(code);
      });
      this.child.on('error', (err) => {
        this.stderr += `\n${err.message}`;
        this.finished = { code: -1 };
        resolve(-1);
      });
    });
    // Prevent a crash if FFmpeg exits while we are still writing frames;
    // the write callbacks receive the error instead.
    this.child.stdin.on('error', () => {});
  }

  // Write one frame, respecting stdin backpressure.
  writeFrame(buffer) {
    return new Promise((resolve, reject) => {
      if (this.finished) {
        reject(new Error('encoder-stopped'));
        return;
      }
      const ok = this.child.stdin.write(buffer, (err) => {
        if (err) reject(new Error('encoder-stopped'));
      });
      this.framesWritten += 1;
      if (ok) {
        resolve();
      } else {
        this.child.stdin.once('drain', resolve);
      }
    });
  }

  async end() {
    this.child.stdin.end();
    const code = await this.done;
    return { code, stderr: this.stderr.slice(-4000) };
  }

  cancel() {
    this.child.stdin.destroy();
    this.child.kill('SIGKILL');
  }
}

function isSupportedMediaFile(filePath, extensions) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  return extensions.includes(path.extname(filePath).toLowerCase());
}

module.exports = {
  ffmpegPath,
  probeAudio,
  decodeForAnalysis,
  ExportJob,
  isSupportedMediaFile,
  MP4_SAFE_CODECS,
};
