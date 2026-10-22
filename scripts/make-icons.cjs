// Regenerates the app icon, favicon and in-app logo pieces from the white logo artwork
// (build/logo-source.webp).
// Run with: npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
// Bounds of the M mark and the wordmark inside logo-source.webp (the wordmark sits below the mark).
const MARK = { x: 372, y: 163, w: 792, h: 537 };
const WORD = { x: 117, y: 733, w: 1317, h: 223 };

// White-on-transparent crops used in the app (as CSS masks), scaled for crisp Retina display.
const CROPS = [
  { file: 'public/logo-mark.png', box: MARK, width: 400 },
  { file: 'public/logo-word.png', box: WORD, width: 600 },
];

const OUTPUTS = [
  // macOS icon: the standard 824px rounded tile inside a 1024px canvas, with a soft shadow.
  { file: 'build/icon.png', size: 1024, tile: [100, 100, 824, 824], radius: 185, markWidth: 0.68, shadow: true },
  // Browser tab icon: full-bleed tile.
  { file: 'public/favicon.png', size: 256, tile: [0, 0, 256, 256], radius: 56, markWidth: 0.76, shadow: false },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const src = 'data:image/webp;base64,' + fs.readFileSync(path.join(root, 'build/logo-source.webp')).toString('base64');
  const images = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode();
    const mark = ${JSON.stringify(MARK)};
    const crops = ${JSON.stringify(CROPS)}.map((o) => {
      const { x, y, w, h } = o.box;
      const c = document.createElement('canvas');
      c.width = o.width; c.height = Math.round(o.width * h / w);
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    });
    const icons = ${JSON.stringify(OUTPUTS)}.map((o) => {
      const c = document.createElement('canvas'); c.width = c.height = o.size;
      const ctx = c.getContext('2d');
      const [x, y, w, h] = o.tile;
      ctx.save();
      if (o.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 36; ctx.shadowOffsetY = 12; }
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.roundRect(x, y, w, h, o.radius); ctx.fill();
      ctx.restore();
      const dw = w * o.markWidth, dh = dw * mark.h / mark.w;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, mark.x, mark.y, mark.w, mark.h, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      return c.toDataURL('image/png');
    });
    return [...icons, ...crops];
  })()`);
  [...OUTPUTS, ...CROPS].forEach((o, i) => {
    fs.writeFileSync(path.join(root, o.file), Buffer.from(images[i].split(',')[1], 'base64'));
    console.log('wrote', o.file);
  });
  app.quit();
});
