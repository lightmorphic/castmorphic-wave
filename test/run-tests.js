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
    env: { ...process.env, WAVE_EXPORT_PATH: exportPath || '' },
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

// The theme toggle: cycles, repaints, persists, and does not push the
// layout past the bottom of the window at any supported size.
async function themeCase() {
  console.log('\ncase: theme toggle cycles, persists, and keeps the app scroll-free');
  const { app, page } = await launchApp('');
  try {
    const read = () => page.evaluate(() => ({
      preference: window.WFTheme.preference,
      resolved: window.WFTheme.resolved,
      applied: document.documentElement.dataset.theme,
      icon: document.getElementById('theme-toggle').dataset.preference,
    }));

    const start = await read();
    check('starts on the desktop setting', start.preference === 'system', start.preference);
    check('a concrete theme is applied before anything is clicked',
      start.applied === start.resolved && ['light', 'dark'].includes(start.applied),
      JSON.stringify(start));

    await page.click('#theme-toggle');
    const light = await read();
    check('first click gives light', light.preference === 'light' && light.applied === 'light',
      JSON.stringify(light));
    check('the icon follows the preference', light.icon === 'light', light.icon);
    const lightBg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor);
    check('light really repaints the page', lightBg === 'rgb(255, 255, 255)', lightBg);

    await page.click('#theme-toggle');
    const dark = await read();
    check('second click gives dark', dark.preference === 'dark' && dark.applied === 'dark',
      JSON.stringify(dark));
    const darkBg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor);
    check('dark really repaints the page', darkBg === 'rgb(9, 9, 11)', darkBg);

    // The preference reaches disk, which is what makes it survive a restart.
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    const prefsFile = path.join(userData, 'prefs.json');
    await page.waitForTimeout(200);
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch { /* reported below */ }
    check('the preference is written to prefs.json', saved.theme === 'dark', JSON.stringify(saved));

    await page.click('#theme-toggle');
    const back = await read();
    check('third click returns to the desktop setting', back.preference === 'system', back.preference);

    // A new header control changes the header's height, so the no-scroll
    // rule has to be re-checked at every supported size, in both themes.
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => window.WFTheme.set(t), theme);
      for (const [w, h] of [[1440, 940], [1280, 800], [1080, 720]]) {
        await app.evaluate(({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]);
        }, [w, h]);
        await page.waitForTimeout(250);
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollHeight - document.documentElement.clientHeight);
        check(`no scroll bar in ${theme} at ${w}x${h}`, overflow <= 0, `overflow ${overflow}px`);
      }
    }

    // These runs share the real app's preference file, so leave the
    // setting as it was found rather than on whatever was tested last.
    await page.evaluate(() => window.WFTheme.set('system'));
    await page.waitForTimeout(200);
  } finally {
    await app.close();
  }
}

// The update dot, driven exactly as the real updater drives it: by
// pushing 'update-state' from the main process into the window.
async function updateDotCase() {
  console.log('\ncase: update dot cycles green → yellow → ring → blue');
  const { app, page } = await launchApp('');
  try {
    const push = (state) => app.evaluate(({ BrowserWindow }, s2) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update-state', s2);
    }, state);

    const dot = () => page.evaluate(() => {
      const el = document.getElementById('update-dot');
      const style = getComputedStyle(el);
      return {
        state: el.dataset.state,
        cursor: style.cursor,
        ariaDisabled: el.getAttribute('aria-disabled'),
        title: el.title,
        fill: getComputedStyle(el, '::before').backgroundColor,
        pulse: getComputedStyle(el, '::after').animationName,
        ringShown: getComputedStyle(document.querySelector('.update-dot-ring')).display,
        restartShown: getComputedStyle(document.getElementById('update-dot-icon-restart')).display,
        downloadShown: getComputedStyle(document.getElementById('update-dot-icon-download')).display,
      };
    });

    const seenCursors = [];
    const note = (d) => { seenCursors.push(`${d.state}:${d.cursor}`); return d; };

    await push({ status: 'none' });
    await page.waitForFunction(() => !document.getElementById('update-widget').hidden);
    const green = note(await dot());
    check('up to date is the Lightmorphic green', green.fill === 'rgb(75, 174, 79)', green.fill);
    check('green invites a click', green.cursor === 'pointer' && green.ariaDisabled === 'false',
      JSON.stringify(green));
    check('green says a click re-checks', /check again/.test(green.title), green.title);

    // Clicking green checks: two pulses, and the answer waits for them.
    await page.click('#update-dot');
    const checking = note(await dot());
    check('clicking green starts a check', checking.state === 'checking', checking.state);
    check('the check double-pulses', checking.pulse === 'update-dot-pulse', checking.pulse);
    check('the pulse runs exactly twice', await page.evaluate(() =>
      getComputedStyle(document.getElementById('update-dot'), '::after').animationIterationCount === '2'));
    check('mid-check the dot takes no clicks', checking.ariaDisabled === 'true' && checking.cursor === 'default',
      JSON.stringify(checking));

    // An answer arriving mid-pulse is held until the pulses finish.
    await push({ status: 'available' });
    const midPulse = await dot();
    check('an early answer waits for the pulses', midPulse.state === 'checking', midPulse.state);

    await page.waitForFunction(() =>
      document.getElementById('update-dot').dataset.state === 'available', null, { timeout: 4000 });
    const amber = note(await dot());
    check('an update turns the dot amber', amber.fill === 'rgb(255, 192, 6)', amber.fill);
    check('amber shows the download icon', amber.downloadShown === 'block', amber.downloadShown);

    // Clicking amber downloads: hollow dot, ring tracing round the edge.
    await page.click('#update-dot');
    const downloading = note(await dot());
    check('clicking amber starts the download', downloading.state === 'downloading', downloading.state);
    check('the dot hollows out for the ring',
      downloading.fill === 'rgba(0, 0, 0, 0)', downloading.fill);
    check('the ring is showing', downloading.ringShown === 'block', downloading.ringShown);

    await push({ status: 'downloading', percent: 40 });
    const offset = await page.evaluate(() =>
      Number(document.getElementById('update-dot-ring-fill').style.strokeDashoffset));
    const circumference = 2 * Math.PI * 8;
    check('the ring traces round to 40%',
      Math.abs(offset - circumference * 0.6) < 0.1, `offset ${offset}`);

    // A full ring becomes blue, and blue is the restart.
    await push({ status: 'downloaded' });
    const blue = note(await dot());
    check('a finished download turns the dot blue', blue.fill === 'rgb(34, 149, 241)', blue.fill);
    check('blue shows the restart icon', blue.restartShown === 'block', blue.restartShown);
    check('blue invites a click', blue.cursor === 'pointer' && blue.ariaDisabled === 'false',
      JSON.stringify(blue));
    check('blue says it restarts', /restart/.test(blue.title), blue.title);

    await push({ status: 'error' });
    const red = note(await dot());
    check('a failed check is the Lightmorphic red', red.fill === 'rgb(243, 66, 54)', red.fill);
    check('red offers another try', red.cursor === 'pointer', red.cursor);

    // The whole point of dropping `disabled`: no no-entry sign anywhere.
    check('no state ever shows a no-entry cursor',
      !seenCursors.some((c) => c.includes('not-allowed')), seenCursors.join(' '));
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

    // Update widget's version label is wired up (the widget itself stays
    // hidden in this dev run: no packaged app means no update checks).
    await page.waitForFunction(() =>
      /^v\d+\.\d+\.\d+$/.test(document.getElementById('update-widget-version').textContent));
    check('update widget shows the running version', true);
    const widgetHiddenInDev = await page.$eval('#update-widget', (el) => el.hidden);
    check('update widget stays hidden with no update check to report', widgetHiddenInDev);

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

  await themeCase();
  await updateDotCase();
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
