'use strict';

// One-off generator for assets/icon.png (512x512).
// Run with: npx electron scripts/make-icon.js

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DRAW = `
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.roundRect(16, 16, 480, 480, 104);
  ctx.fillStyle = '#111827';
  ctx.fill();
  ctx.fillStyle = '#FF5721';
  const bars = [
    [92, 212, 88], [164, 148, 216], [236, 96, 320], [308, 168, 176], [380, 224, 64],
  ];
  for (const [x, y, h] of bars) {
    ctx.beginPath();
    ctx.roundRect(x, y, 40, h, 20);
    ctx.fill();
  }
  c.toDataURL('image/png');
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 100, height: 100 });
  await win.loadURL('data:text/html,<title>icon</title>');
  const dataUrl = await win.webContents.executeJavaScript(DRAW);
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), png);
  console.log(`wrote assets/icon.png (${png.length} bytes)`);
  app.quit();
});
