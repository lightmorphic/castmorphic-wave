'use strict';

// End-to-end test: drives the real app with Playwright, exports real
// videos, and verifies each one, including that the audio stream in
// the output is bit-for-bit identical to the source file's.
//
// Run with: npm test

const { _electron: electron } = require('playwright');
const { execFileSync, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const FFMPEG = require('ffmpeg-static');
const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, 'tmp');
const FIX = path.join(__dirname, 'fixtures');

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

function ffmpeg(args) {
  return new Promise((resolve) => {
    execFile(FFMPEG, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout, stderr, code: err ? err.code : 0 });
    });
  });
}

async function audioStreamMd5(file) {
  const { stdout } = await ffmpeg(['-hide_banner', '-i', file, '-map', '0:a:0', '-c', 'copy', '-f', 'md5', '-']);
  const m = stdout.match(/MD5=([0-9a-f]+)/);
  return m ? m[1] : `no-md5:${file}`;
}

async function mediaInfo(file) {
  const { stderr } = await ffmpeg(['-hide_banner', '-i', file]);
  const dur = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  return {
    raw: stderr,
    container: (stderr.match(/Input #0, ([^,\s]+(?:,[^,\s]+)*)/) || [])[1] || '',
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
    video: (stderr.match(/Video: ([^\n]+)/) || [])[1] || '',
    audio: (stderr.match(/Audio: ([^\n]+)/) || [])[1] || '',
  };
}

function makeFixtures() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(FIX, { recursive: true });

  const runs = [
    // A colourful 1440p background and a too-small one.
    ['-f', 'lavfi', '-i', 'gradients=s=2560x1440:n=5:seed=7:d=1', '-frames:v', '1', path.join(FIX, 'bg-good.png')],
    ['-f', 'lavfi', '-i', 'gradients=s=1280x720:n=4:seed=3:d=1', '-frames:v', '1', path.join(FIX, 'bg-small.jpg')],
    // A 6-second test tone with some movement in it, in every format.
    ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-af', 'tremolo=f=4:d=0.7,volume=0.8', '-c:a', 'libmp3lame', '-b:a', '192k', path.join(FIX, 'tone.mp3')],
    ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-af', 'tremolo=f=4:d=0.7,volume=0.8', '-c:a', 'pcm_s16le', path.join(FIX, 'tone.wav')],
    ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-af', 'tremolo=f=4:d=0.7,volume=0.8', '-c:a', 'flac', path.join(FIX, 'tone.flac')],
    ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-af', 'tremolo=f=4:d=0.7,volume=0.8', '-c:a', 'libvorbis', path.join(FIX, 'tone.ogg')],
    ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-af', 'tremolo=f=4:d=0.7,volume=0.8', '-c:a', 'aac', '-b:a', '160k', path.join(FIX, 'tone.m4a')],
  ];
  for (const args of runs) {
    if (fs.existsSync(args[args.length - 1])) continue;
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  }
  console.log('fixtures ready');
}

async function launchApp(exportPath) {
  const app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, WAVEFRAME_EXPORT_PATH: exportPath || '' },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('#style-grid .style-option');
  return { app, page };
}

async function loadFiles(page, imageFile, audioFile) {
  if (imageFile) {
    await page.setInputFiles('#image-input', imageFile);
    await page.waitForFunction(() =>
      document.getElementById('image-name').textContent.includes('✓'));
  }
  if (audioFile) {
    await page.setInputFiles('#audio-input', audioFile);
    await page.waitForFunction(() =>
      document.getElementById('audio-name').textContent.includes('✓'), null, { timeout: 30000 });
  }
}

// One full export through the real UI.
async function exportCase({ label, audioFixture, containerChoice, expectContainer, styleId }) {
  console.log(`\ncase: ${label}`);
  const outBase = path.join(TMP, `out-${path.parse(audioFixture).name}-${containerChoice}`);
  const expectedPath = `${outBase}.${expectContainer}`;
  const { app, page } = await launchApp(outBase);

  try {
    await loadFiles(page, path.join(FIX, 'bg-good.png'), path.join(FIX, audioFixture));

    if (styleId) {
      await page.click(`.style-option[data-style-id="${styleId}"]`);
    }
    if (containerChoice !== 'auto') {
      await page.selectOption('#container-select', containerChoice);
    }

    // The container note must speak plainly when an MP4 choice cannot hold
    // the audio without re-encoding.
    if (containerChoice === 'mp4' && expectContainer === 'mkv') {
      const note = await page.textContent('#container-note');
      check('warns that MP4 would need a re-encode', /never re-encodes|MKV instead/.test(note), note);
    }

    await page.waitForFunction(() => !document.getElementById('export-btn').disabled);
    await page.click('#export-btn');
    await page.waitForSelector('.msg.success', { timeout: 180000 });

    check('output file exists', fs.existsSync(expectedPath), expectedPath);
    if (!fs.existsSync(expectedPath)) return;

    const src = await mediaInfo(path.join(FIX, audioFixture));
    const out = await mediaInfo(expectedPath);

    const wantFormat = expectContainer === 'mp4' ? /mp4/ : /matroska/;
    check(`container is ${expectContainer}`, wantFormat.test(out.container), out.container);
    check('video is 1920x1080 H.264 yuv420p',
      /h264/.test(out.video) && /1920x1080/.test(out.video) && /yuv420p/.test(out.video), out.video);
    check('duration matches audio', Math.abs(out.duration - src.duration) <= 0.15,
      `src ${src.duration}s vs out ${out.duration}s`);

    const srcMd5 = await audioStreamMd5(path.join(FIX, audioFixture));
    const outMd5 = await audioStreamMd5(expectedPath);
    check('audio stream is bit-identical (md5)', srcMd5 === outMd5, `${srcMd5} vs ${outMd5}`);
  } finally {
    await app.close();
  }
}

async function smallImageCase() {
  console.log('\ncase: image below 1920x1080 blocks export');
  const { app, page } = await launchApp('');
  try {
    await loadFiles(page, path.join(FIX, 'bg-small.jpg'), path.join(FIX, 'tone.mp3'));
    const warning = await page.textContent('#image-warning');
    check('plain-language size warning shown', /smaller than/.test(warning), warning);
    const disabled = await page.$eval('#export-btn', (el) => el.disabled);
    check('export stays blocked', disabled);
    const reason = await page.textContent('#export-blocked');
    check('the export button says why it is locked',
      /Export is locked/.test(reason) && /1920/.test(reason), reason);
  } finally {
    await app.close();
  }
}

async function boxAndPreviewCase() {
  console.log('\ncase: waveform box moves, resizes and keeps within bounds');
  const { app, page } = await launchApp('');
  try {
    await loadFiles(page, path.join(FIX, 'bg-good.png'), null);

    // Keyboard: nudge right and down, grow with Shift.
    await page.focus('#wavebox');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');

    // Mouse: drag the box around; drag far past the edge to test clamping.
    const box = await page.$('#wavebox');
    const bb = await box.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + 5);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + 3000, bb.y + 3000, { steps: 5 });
    await page.mouse.up();

    const b = await page.evaluate(() => {
      const el = document.getElementById('wavebox');
      return {
        left: parseFloat(el.style.left), top: parseFloat(el.style.top),
        width: parseFloat(el.style.width), height: parseFloat(el.style.height),
      };
    });
    check('box stays inside the frame',
      b.left >= 0 && b.top >= 0 && b.left + b.width <= 100.01 && b.top + b.height <= 100.01,
      JSON.stringify(b));

    // All 20 styles draw without errors while previewing.
    const styleErrors = [];
    page.on('pageerror', (err) => styleErrors.push(String(err)));
    const ids = await page.$$eval('.style-option', (btns) => btns.map((x) => x.dataset.styleId));
    check('20 styles are offered', ids.length === 20, `found ${ids.length}`);
    for (const id of ids) {
      await page.click(`.style-option[data-style-id="${id}"]`);
      await page.waitForTimeout(80);
    }
    check('every style previews without errors', styleErrors.length === 0, styleErrors[0]);

    // Version pill shows the app version.
    await page.waitForFunction(() =>
      /^v\d+\.\d+\.\d+$/.test(document.getElementById('version-label').textContent));
    check('version pill shows the version', true);

    // Colour override via hex field.
    await page.fill('#colour-hex', '#03A8F3');
    await page.press('#colour-hex', 'Enter');
    const pressed = await page.getAttribute('#colour-auto', 'aria-pressed');
    check('hex entry switches colour to custom', pressed === 'false');
  } finally {
    await app.close();
  }
}

(async () => {
  makeFixtures();

  await boxAndPreviewCase();
  await smallImageCase();

  await exportCase({
    label: 'MP3 → auto → MP4',
    audioFixture: 'tone.mp3', containerChoice: 'auto', expectContainer: 'mp4', styleId: 'bars-mirror',
  });
  await exportCase({
    label: 'AAC (m4a) → auto → MP4',
    audioFixture: 'tone.m4a', containerChoice: 'auto', expectContainer: 'mp4', styleId: 'radial-bars',
  });
  await exportCase({
    label: 'WAV → auto → MKV',
    audioFixture: 'tone.wav', containerChoice: 'auto', expectContainer: 'mkv', styleId: 'progress-wave',
  });
  await exportCase({
    label: 'OGG → auto → MKV',
    audioFixture: 'tone.ogg', containerChoice: 'auto', expectContainer: 'mkv', styleId: 'line-glow',
  });
  await exportCase({
    label: 'FLAC → user forces MP4 → warned, saved as MKV',
    audioFixture: 'tone.flac', containerChoice: 'mp4', expectContainer: 'mkv', styleId: 'eq-grid',
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
