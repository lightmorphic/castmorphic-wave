'use strict';

// Captures the screenshots used in the README and on the website.
// Run with: node scripts/screenshots.js   (after `npm test` has built fixtures)

const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(ROOT, 'test', 'fixtures');
const OUT = path.join(ROOT, 'docs', 'shots');

const { execFileSync } = require('node:child_process');
const FFMPEG = require('ffmpeg-static');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // Nicer-looking demo assets than the plain test fixtures.
  const shotBg = path.join(FIX, 'bg-shot.png');
  const shotAudio = path.join(FIX, 'noise-shot.mp3');
  if (!fs.existsSync(shotBg)) {
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i',
      // A warm, on-brand backdrop: Auto match then lands on Wave's own
      // yellow rather than on a colour borrowed from an unrelated image.
      'gradients=s=2560x1440:n=3:c0=0x0C1220:c1=0x3F2A07:c2=0xB8800C:x0=200:y0=1300:x1=2400:y1=140:d=1',
      '-frames:v', '1', shotBg]);
  }
  if (!fs.existsSync(shotAudio)) {
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=30:seed=42',
      '-af', 'tremolo=f=2:d=0.6,volume=0.7', '-c:a', 'libmp3lame', '-b:a', '192k', shotAudio]);
  }

  const app = await electron.launch({ args: [ROOT] });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.waitForSelector('#style-grid .style-option');

  await page.setInputFiles('#image-input', shotBg);
  await page.waitForFunction(() => document.getElementById('image-name').textContent.includes('✓'));
  await page.setInputFiles('#audio-input', shotAudio);
  await page.waitForFunction(() => document.getElementById('audio-name').textContent.includes('✓'));
  await page.waitForTimeout(1200);

  await page.screenshot({ path: path.join(OUT, 'app-main.png') });

  await page.click('.style-option[data-style-id="line-glow"]');
  await page.waitForTimeout(600);
  await page.locator('.col-main .panel').first().screenshot({ path: path.join(OUT, 'app-preview.png') });

  await page.locator('.col-main .panel').nth(1).screenshot({ path: path.join(OUT, 'app-styles.png') });

  await app.close();
  console.log('screenshots written to docs/shots/');
})();
