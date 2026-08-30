'use strict';

const { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');

// When the AppImage is launched from a desktop icon, stdout/stderr may be
// dead pipes; an unhandled EPIPE from any stray console write would kill
// the whole app (seen with electron-updater's own logging).
if (process.stdout) process.stdout.on('error', () => {});
if (process.stderr) process.stderr.on('error', () => {});
const {
  probeAudio,
  decodeForAnalysis,
  ExportJob,
  isSupportedMediaFile,
} = require('./ffmpeg');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.oga', '.opus'];

// Plain-language messages for everything that can go wrong.
const ERROR_MESSAGES = {
  'no-audio-stream': 'That file does not seem to contain any audio. Try a different file.',
  'too-long': 'That audio file is longer than 3 hours, which is more than Wave can handle in one go.',
  'decode-failed': 'The audio could not be read. The file may be damaged or in an unusual format.',
  'bad-file': 'That file could not be opened. Check that it still exists and is a supported format.',
  'encoder-stopped': 'The video encoder stopped unexpectedly, so the export could not finish.',
};

function friendly(err) {
  return ERROR_MESSAGES[err.message] || ERROR_MESSAGES['bad-file'];
}

let mainWindow = null;

// ---------------------------------------------------------------------------
// Preferences: one small JSON file in the user data directory. The theme is
// the only thing in it, and a missing or corrupt file simply means defaults.
// ---------------------------------------------------------------------------

const THEMES = ['system', 'light', 'dark'];

function prefsPath() {
  return path.join(app.getPath('userData'), 'prefs.json');
}

function readPrefs() {
  try {
    const parsed = JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
    return { theme: THEMES.includes(parsed.theme) ? parsed.theme : 'system' };
  } catch {
    return { theme: 'system' };
  }
}

function writePrefs(prefs) {
  try {
    fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2));
  } catch {
    // Losing the preference until next time is not worth an error dialog.
  }
}

let prefs = { theme: 'system' };

// One export can run at a time.
let currentExport = null;
let exportCounter = 0;

function resolvedTheme() {
  if (prefs.theme !== 'system') return prefs.theme;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: resolvedTheme() === 'dark' ? '#09090b' : '#ffffff',
    title: 'Castmorphic Wave',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      // The renderer needs the stored theme synchronously, before its
      // first paint, so it travels as an argument rather than over IPC.
      additionalArguments: [`--wf-theme=${prefs.theme}`],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Any link that tries to open a page goes to the system browser,
  // never inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Update checks poll GitHub Releases (the repo in package.json's publish
// block) and nothing else. Nothing downloads until the user asks.
function setupUpdates() {
  if (!app.isPackaged) return;
  // No console logging from the updater: it writes to stdout, which is
  // not safe to assume exists for a desktop-launched AppImage.
  autoUpdater.logger = null;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-state', state);
    }
  };
  autoUpdater.on('update-available', (info) => send({ status: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ status: 'none' }));
  autoUpdater.on('download-progress', (p) => send({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send({ status: 'downloaded', version: info.version }));
  // A failed check (offline, GitHub down) is not worth nagging about;
  // the renderer decides whether the user was mid-download.
  autoUpdater.on('error', () => send({ status: 'error' }));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  prefs = readPrefs();
  nativeTheme.themeSource = prefs.theme;
  createWindow();
  setupUpdates();
});

app.on('window-all-closed', () => {
  if (currentExport) currentExport.cancel();
  app.quit();
});

// ---------------------------------------------------------------------------
// IPC: every handler validates its inputs before touching the filesystem.
// ---------------------------------------------------------------------------

ipcMain.handle('set-theme', (event, theme) => {
  if (!THEMES.includes(theme)) return { error: 'unknown theme' };
  prefs = { ...prefs, theme };
  writePrefs(prefs);
  // Keeps the next launch's window background right, and matches any
  // native chrome to what the page is showing.
  nativeTheme.themeSource = theme;
  return { theme };
});

ipcMain.handle('probe-audio', async (event, filePath) => {
  if (!isSupportedMediaFile(filePath, AUDIO_EXTENSIONS)) {
    return { error: ERROR_MESSAGES['bad-file'] };
  }
  try {
    return await probeAudio(filePath);
  } catch (err) {
    return { error: friendly(err) };
  }
});

ipcMain.handle('decode-audio', async (event, filePath, expectedSeconds) => {
  if (!isSupportedMediaFile(filePath, AUDIO_EXTENSIONS)) {
    return { error: ERROR_MESSAGES['bad-file'] };
  }
  try {
    const seconds = Number.isFinite(expectedSeconds) && expectedSeconds > 0 ? expectedSeconds : 0;
    const { pcm, sampleRate } = await decodeForAnalysis(filePath, {
      expectedSeconds: seconds,
      onProgress: (percent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('analysis-progress', { percent });
        }
      },
    });
    // Transferred to the renderer as an ArrayBuffer.
    return {
      sampleRate,
      pcm: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
    };
  } catch (err) {
    return { error: friendly(err) };
  }
});

ipcMain.handle('choose-export-path', async (event, opts) => {
  const container = opts && opts.container === 'mp4' ? 'mp4' : 'mkv';
  const baseName = (opts && typeof opts.baseName === 'string' ? opts.baseName : 'wave')
    .replace(/[^\w\s.-]/g, '')
    .trim() || 'wave';

  // Test hook: automated tests point exports at a fixed path so no
  // dialog needs clicking. Ignored in normal use.
  if (process.env.WAVE_EXPORT_PATH) {
    return { filePath: process.env.WAVE_EXPORT_PATH };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save video',
    defaultPath: path.join(app.getPath('videos'), `${baseName}.${container}`),
    filters: [
      container === 'mp4'
        ? { name: 'MP4 video', extensions: ['mp4'] }
        : { name: 'MKV video', extensions: ['mkv'] },
    ],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  return { filePath: result.filePath };
});

ipcMain.handle('export-start', async (event, opts) => {
  if (currentExport) {
    return { error: 'An export is already running. Cancel it first or wait for it to finish.' };
  }
  if (!opts || typeof opts !== 'object') return { error: ERROR_MESSAGES['bad-file'] };

  const { imagePath, audioPath, outPath, container, box, fps, totalFrames } = opts;

  if (!isSupportedMediaFile(imagePath, IMAGE_EXTENSIONS)) {
    return { error: 'The background image could not be opened. Try choosing it again.' };
  }
  if (!isSupportedMediaFile(audioPath, AUDIO_EXTENSIONS)) {
    return { error: 'The audio file could not be opened. Try choosing it again.' };
  }
  if (typeof outPath !== 'string' || !path.isAbsolute(outPath)) {
    return { error: 'The save location does not look right. Choose where to save again.' };
  }
  if (container !== 'mp4' && container !== 'mkv') {
    return { error: 'Unknown output format requested.' };
  }
  const nums = [box && box.x, box && box.y, box && box.w, box && box.h, fps, totalFrames];
  if (!nums.every((n) => Number.isInteger(n) && n >= 0)) {
    return { error: 'The waveform box position does not look right. Move the box and try again.' };
  }
  if (box.w < 2 || box.h < 2 || box.x + box.w > 1920 || box.y + box.h > 1080) {
    return { error: 'The waveform box must sit fully inside the video frame.' };
  }
  if (fps < 1 || fps > 60 || totalFrames < 1 || totalFrames > 60 * 60 * 60 * 3) {
    return { error: 'The export settings do not look right. Reload the audio and try again.' };
  }

  exportCounter += 1;
  const id = exportCounter;
  currentExport = new ExportJob({ imagePath, audioPath, outPath, container, box, fps, totalFrames });
  currentExport.id = id;
  currentExport.outPath = outPath;
  return { id, frameBytes: box.w * box.h * 4 };
});

ipcMain.handle('export-frame', async (event, id, frame) => {
  const job = currentExport;
  if (!job || job.id !== id) return { error: 'This export is no longer running.' };
  if (!(frame instanceof Uint8Array)) return { error: 'Bad frame data.' };
  try {
    await job.writeFrame(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
    return { ok: true };
  } catch (err) {
    const tail = job.stderr.slice(-2000);
    currentExport = null;
    return { error: friendly(err), detail: tail };
  }
});

ipcMain.handle('export-end', async (event, id) => {
  const job = currentExport;
  if (!job || job.id !== id) return { error: 'This export is no longer running.' };
  const { code, stderr } = await job.end();
  currentExport = null;
  if (code !== 0) {
    return {
      error: 'The video could not be finished. The save location may be full or read-only.',
      detail: stderr,
    };
  }
  return { ok: true, outPath: job.outPath };
});

ipcMain.handle('export-cancel', async (event, id) => {
  const job = currentExport;
  if (job && job.id === id) {
    job.cancel();
    await job.done;
    currentExport = null;
    // A cancelled export leaves a useless part-written file behind.
    fs.rm(job.outPath, { force: true }, () => {});
  }
  return { ok: true };
});

ipcMain.handle('app-info', async () => ({
  version: app.getVersion(),
  packaged: app.isPackaged,
}));

// The dot's own click asks for this; the timer in setupUpdates() asks for
// the same thing on its own schedule. Either way the answer comes back as
// an 'update-state' push, so this only reports whether the check ran.
ipcMain.handle('update-check', async () => {
  if (!app.isPackaged) return { error: 'not packaged' };
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch {
    return { error: 'check failed' };
  }
});

ipcMain.handle('update-download', async () => {
  if (!app.isPackaged) return { ok: false };
  autoUpdater.downloadUpdate().catch(() => {});
  return { ok: true };
});

ipcMain.handle('update-install', async () => {
  if (!app.isPackaged) return { ok: false };
  if (currentExport) {
    return { error: 'An export is running. Let it finish (or cancel it) before restarting to update.' };
  }
  autoUpdater.quitAndInstall();
  return { ok: true };
});

ipcMain.handle('show-in-folder', async (event, filePath) => {
  if (typeof filePath === 'string' && path.isAbsolute(filePath)) {
    shell.showItemInFolder(filePath);
  }
  return { ok: true };
});
