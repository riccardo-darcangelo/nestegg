'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Prüft, dass die App nicht nur startet, sondern auch etwas anzeigt.
 * Aufruf: npx electron tools/start-smoke.js
 *
 * Ein laufender Prozess sagt nichts: das Fenster kann leer sein, weil im
 * Renderer eine Ausnahme fliegt. Genau so ist die Navigation einmal
 * verschwunden, nachdem der Snapshot eine Collection nicht mehr mitschickte.
 */

const { app, BrowserWindow } = require('electron');

const problems = [];
const say = (ok, text) => {
  console.log(`${ok ? '  ok  ' : ' FEHL '} ${text}`);
  if (!ok) problems.push(text);
};

/**
 * Der Sperrbildschirm steht vor der Oberfläche.
 *
 * In einem frischen Profil bietet die App zuerst die Verschlüsselung an. Für
 * diesen Prüflauf geht es um die Oberfläche dahinter, also wird der Schritt
 * übersprungen. Ob das Schloss selbst trägt, prüft tools/lock-smoke.js.
 */
async function skipLockScreen(win) {
  if (!win.webContents.getURL().includes('unlock.html')) return false;

  await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Ohne Schutz fortfahren'));
    if (button) button.click();
    return Boolean(button);
  })()`);
  return true;
}

app.on('browser-window-created', (event, win) => {
  win.webContents.on('console-message', (e, level, message, line, source) => {
    // level 3 ist error.
    if (level >= 3) problems.push(`Renderer: ${message} (${String(source).split(/[\\/]/).pop()}:${line})`);
  });
  win.webContents.on('preload-error', (e, file, error) => {
    problems.push(`Preload: ${file}: ${error && error.message}`);
  });

  win.webContents.once('did-finish-load', async () => {
    // Der Oberfläche Zeit lassen: bootstrap und snapshot laufen asynchron.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    if (await skipLockScreen(win)) return;

    const zustand = await win.webContents.executeJavaScript(`({
      navItems: document.querySelectorAll('#nav .nav-item').length,
      mainKinder: document.getElementById('main').children.length,
      titel: (document.querySelector('.page-title') || {}).textContent || '',
      jahre: document.querySelectorAll('#sidebar-foot option').length
    })`);

    console.log('\nStart der Oberfläche\n');
    say(problems.length === 0, problems.length ? `Fehler im Renderer: ${problems[0]}` : 'Keine Ausnahme im Renderer');
    say(zustand.navItems > 5, `Navigation gefüllt: ${zustand.navItems} Punkte`);
    say(zustand.mainKinder > 0, `Hauptbereich gefüllt: ${zustand.mainKinder} Knoten`);
    say(Boolean(zustand.titel), `Seitentitel: ${zustand.titel || 'fehlt'}`);
    say(zustand.jahre > 0, `Jahresauswahl gefüllt: ${zustand.jahre}`);

    // Jede Ansicht einmal öffnen. Eine Ansicht, die nur in der Vorschau lief,
    // kann in der App an einem Feld scheitern, das der Mock mitbringt und der
    // echte Aufruf nicht.
    const namen = await win.webContents.executeJavaScript('Object.keys(window.Views)');
    for (const name of namen) {
      const vorher = problems.length;
      const ok = await win.webContents.executeJavaScript(
        `(() => { try { App.navigate(${JSON.stringify(name)}); return true; } catch (err) { console.error('Ansicht ${name}: ' + err.message); return false; } })()`
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      say(ok && problems.length === vorher, `Ansicht ${name}`);
    }

    console.log(problems.length ? `\n${problems.length} Punkt(e) offen.\n` : '\nAlles in Ordnung.\n');
    app.exit(problems.length ? 1 : 0);
  });
});

require('../src/main/index.js');

// Notbremse, falls did-finish-load nie kommt.
setTimeout(() => {
  console.log('\n FEHL  Die Oberfläche hat nicht geladen.\n');
  app.exit(1);
}, 30000);
