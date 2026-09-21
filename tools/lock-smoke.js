'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Prüft die Verschlüsselung in der echten App.
 * Aufruf: node tools/lock-smoke.js
 *
 * Nicht als Unit-Test: hier geht es um das Zusammenspiel aus Sperrfenster,
 * Hauptprozess und Datenordner über mehrere Programmläufe hinweg. Genau dort
 * entstehen die Fehler, die eine Buchführung unlesbar machen, und die sieht
 * man erst, wenn die App wirklich zweimal gestartet wurde.
 *
 * Jede Phase läuft in einem eigenen Electron-Prozess mit einem eigenen
 * Datenordner unter dem Temp-Verzeichnis. Der echte Bestand wird nie berührt.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PHASEN = [
  'einrichten',
  'entsperren-falsch',
  'entsperren-richtig',
  'wiederherstellen',
  'merken',
  'aufheben'
];

const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'nestegg-schloss-'));
const userData = path.join(wurzel, 'userdata');
const datenDir = path.join(wurzel, 'daten');
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(datenDir, { recursive: true });
fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ dataDir: datenDir }), 'utf8');

const electron = path.join(
  require('./paths').ROOT, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
);

function laufe(phase) {
  return new Promise((resolve) => {
    const kind = spawn(electron, [path.join(__dirname, 'lock-phase.js'), `--user-data-dir=${userData}`], {
      env: { ...process.env, NESTEGG_PHASE: phase, NESTEGG_TESTDIR: datenDir },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let aus = '';
    kind.stdout.on('data', (d) => { aus += d; });
    kind.stderr.on('data', (d) => { aus += d; });
    kind.on('close', (code) => resolve({ code, aus }));
  });
}

(async () => {
  console.log(`Prüfordner: ${wurzel}\n`);
  let offen = 0;

  for (const phase of PHASEN) {
    const { code, aus } = await laufe(phase);
    for (const zeile of aus.split('\n')) {
      if (!zeile.trim()) continue;
      if (/^\s*(ok|FEHL)\s/.test(zeile)) console.log(zeile);
      else if (/Error|error/.test(zeile) && !/ERROR:gpu|GPU|gles|dxdiag|Autofill|cache/i.test(zeile)) {
        console.log(`  ?    ${zeile.trim().slice(0, 140)}`);
      }
    }
    if (code !== 0) { console.log(` FEHL  Phase ${phase} endete mit ${code}`); offen += 1; }
    offen += (aus.match(/ FEHL /g) || []).length;
  }

  console.log(offen ? `\n${offen} Punkt(e) offen.\n` : '\nAlles in Ordnung.\n');
  fs.rmSync(wurzel, { recursive: true, force: true });
  process.exit(offen ? 1 : 0);
})();
