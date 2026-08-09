'use strict';

// Smoke test for the packaged AppImage: launches the real artifact,
// runs one export, and checks the audio came through bit-identical.
//
// Run with: node test/appimage-smoke.js [path-to-AppImage]

const { _electron: electron } = require('playwright');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const FFMPEG = require('ffmpeg-static');
const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const TMP = path.join(__dirname, 'tmp');

const appImage = process.argv[2] ||
  fs.readdirSync(path.join(ROOT, 'dist'))
    .filter((f) => f.endsWith('.AppImage'))
    .map((f) => path.join(ROOT, 'dist', f))[0];

function ffmpeg(args) {
  return new Promise((resolve) => {
    execFile(FFMPEG, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout, stderr, code: err ? err.code : 0 });
    });
  });
}

async function audioStreamMd5(file) {
  const { stdout } = await ffmpeg(['-hide_banner', '-i', file, '-map', '0:a:0', '-c', 'copy', '-f', 'md5', '-']);
  return (stdout.match(/MD5=([0-9a-f]+)/) || [])[1];
}

(async () => {
  if (!appImage || !fs.existsSync(appImage)) {
    console.error('No AppImage found. Run `npm run build` first.');
    process.exit(1);
  }
  fs.mkdirSync(TMP, { recursive: true });
  const outBase = path.join(TMP, 'appimage-smoke');
  fs.rmSync(`${outBase}.mp4`, { force: true });

  console.log(`launching ${path.basename(appImage)}`);
  const app = await electron.launch({
    executablePath: appImage,
    env: { ...process.env, WAVEFRAME_EXPORT_PATH: outBase },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('#style-grid .style-option');
  console.log('app launched, 20 styles present:',
    (await page.$$eval('.style-option', (b) => b.length)) === 20);

  await page.setInputFiles('#image-input', path.join(FIX, 'bg-good.png'));
  await page.waitForFunction(() => document.getElementById('image-name').textContent.includes('✓'));
  await page.setInputFiles('#audio-input', path.join(FIX, 'tone.mp3'));
  await page.waitForFunction(() => document.getElementById('audio-name').textContent.includes('✓'),
    null, { timeout: 30000 });
  await page.waitForFunction(() => !document.getElementById('export-btn').disabled);
  await page.click('#export-btn');
  await page.waitForSelector('.msg.success', { timeout: 180000 });
  await app.close();

  const out = `${outBase}.mp4`;
  const srcMd5 = await audioStreamMd5(path.join(FIX, 'tone.mp3'));
  const outMd5 = await audioStreamMd5(out);
  const ok = fs.existsSync(out) && srcMd5 && srcMd5 === outMd5;
  console.log(`export exists: ${fs.existsSync(out)}`);
  console.log(`audio bit-identical: ${srcMd5 === outMd5} (${srcMd5})`);
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
