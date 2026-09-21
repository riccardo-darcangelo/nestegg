'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Erzeugt aus build/icon.svg die Rasterbilder für den Installer:
 * PNGs in allen üblichen Größen und daraus ein .ico.
 *
 * Aufruf: npx electron tools/make-icon.js
 *
 * Gerendert wird in Chromium, weil das SVG dort genauso aussieht wie in der
 * App. Ein zusätzliches Bildwerkzeug als Abhängigkeit wäre dafür zu viel.
 */

const { app, BrowserWindow, nativeImage } = require('electron');

app.on('window-all-closed', () => {});

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Kleine Groessen bekommen ein vereinfachtes Motiv, sonst laufen die beiden
// Summenstriche zu einem Balken zusammen.
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SMALL_UP_TO = 20;
const RENDER_SIZE = 512;

const buildDir = path.join(require('./paths').ROOT, 'build');

/** Rendert das SVG einmal groß und liefert das Bild. */
async function renderSvg(svgPath) {
  const svg = await fs.readFile(svgPath, 'utf8');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:transparent;width:${RENDER_SIZE}px;height:${RENDER_SIZE}px;overflow:hidden}
      svg{display:block;width:${RENDER_SIZE}px;height:${RENDER_SIZE}px}
    </style></head><body>${svg}</body></html>`;

  const tmpFile = path.join(os.tmpdir(), `nestegg-icon-${Date.now()}.html`);
  await fs.writeFile(tmpFile, html, 'utf8');

  const win = new BrowserWindow({
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    useContentSize: true,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  });

  try {
    await win.loadFile(tmpFile);
    // Ein Wimpernschlag, damit das Bild wirklich gezeichnet ist.
    await new Promise((resolve) => setTimeout(resolve, 250));
    let image = await win.webContents.capturePage();

    // Auf Bildschirmen mit Skalierung liefert capturePage mehr Pixel.
    const size = image.getSize();
    if (size.width !== RENDER_SIZE) {
      image = image.resize({ width: RENDER_SIZE, height: RENDER_SIZE, quality: 'best' });
    }
    return image;
  } finally {
    win.destroy();
    await fs.unlink(tmpFile).catch(() => {});
  }
}

/**
 * Baut eine .ico-Datei aus fertigen PNGs.
 *
 * Aufbau: ein Verzeichniskopf, je Bild ein 16 Byte langer Eintrag, danach die
 * PNG-Daten am Stück. Windows akzeptiert PNG in einer .ico seit Vista.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserviert
  header.writeUInt16LE(1, 2); // Typ 1: Icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;

  images.forEach((entry, i) => {
    const base = i * 16;
    // 256 wird als 0 geschrieben, das Feld ist nur ein Byte breit.
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1);
    directory.writeUInt8(0, base + 2); // Farbpalette: keine
    directory.writeUInt8(0, base + 3); // reserviert
    directory.writeUInt16LE(1, base + 4); // Ebenen
    directory.writeUInt16LE(32, base + 6); // Bit je Bildpunkt
    directory.writeUInt32LE(entry.data.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((e) => e.data)]);
}

app.whenReady().then(async () => {
  try {
    const svgPath = path.join(buildDir, 'icon.svg');
    console.log(`\nIcon wird gebaut aus ${svgPath}\n`);

    const master = await renderSvg(svgPath);
    const smallPath = path.join(buildDir, 'icon-small.svg');
    const small = fs.readFile ? await renderSvg(smallPath).catch(() => null) : null;

    const pngDir = path.join(buildDir, 'icons');
    await fs.mkdir(pngDir, { recursive: true });

    const images = [];
    for (const size of SIZES) {
      const source = (small && size <= SMALL_UP_TO) ? small : master;
      const scaled = size === RENDER_SIZE
        ? source
        : source.resize({ width: size, height: size, quality: 'best' });
      const data = scaled.toPNG();
      await fs.writeFile(path.join(pngDir, `icon-${size}.png`), data);
      images.push({ size, data });
      console.log(`  ok   icon-${size}.png, ${(data.length / 1024).toFixed(1)} KiB`);
    }

    // Das große PNG braucht electron-builder für Linux und als Quelle.
    const bigPng = master.toPNG();
    await fs.writeFile(path.join(buildDir, 'icon.png'), bigPng);
    console.log(`  ok   icon.png, ${RENDER_SIZE} Pixel, ${(bigPng.length / 1024).toFixed(1)} KiB`);

    const ico = buildIco(images);
    await fs.writeFile(path.join(buildDir, 'icon.ico'), ico);
    console.log(`  ok   icon.ico mit ${images.length} Größen, ${(ico.length / 1024).toFixed(1)} KiB`);

    console.log('\nFertig.\n');
    app.exit(0);
  } catch (err) {
    console.error('\nAbbruch:', err);
    app.exit(1);
  }
});
