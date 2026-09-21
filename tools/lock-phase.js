'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Eine Phase des Schlossprüflaufs. Gestartet von tools/lock-smoke.js.
 *
 * Das Skript lädt die echte main.js und bedient danach das Fenster, das
 * gerade offen ist: entweder den Sperrbildschirm oder die App. Bedient wird
 * über die Oberfläche, nicht über die IPC-Kanäle direkt, damit auch die
 * Verdrahtung dazwischen geprüft ist.
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const PHASE = process.env.NESTEGG_PHASE;
const DATEN = process.env.NESTEGG_TESTDIR;
const PASSWORT = 'ein sehr gutes Testpasswort';
const NEUES_PASSWORT = 'das zweite Testpasswort';

const merker = path.join(DATEN, '..', 'merker.json');
const lies = () => { try { return JSON.parse(fs.readFileSync(merker, 'utf8')); } catch { return {}; } };
const schreib = (obj) => fs.writeFileSync(merker, JSON.stringify({ ...lies(), ...obj }), 'utf8');

let offen = 0;
const say = (ok, text) => {
  console.log(`${ok ? '  ok  ' : ' FEHL '} ${PHASE}: ${text}`);
  if (!ok) offen += 1;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wartet, bis ein Fenster geladen ist, dessen Adresse zu name passt. */
function warteAufFenster(name, timeout = 25000) {
  const bis = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const pruefe = () => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        const url = win.webContents.getURL();
        if (url.includes(name) && !win.webContents.isLoading()) return resolve(win);
      }
      if (Date.now() > bis) return reject(new Error(`Fenster ${name} kam nicht`));
      setTimeout(pruefe, 200);
    };
    pruefe();
  });
}

/** Klickt den Knopf, dessen Beschriftung passt. */
async function klick(win, text) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => ${JSON.stringify(text)}.split('|').some(t => x.textContent.includes(t)));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!ok) throw new Error(`Knopf "${text}" nicht gefunden`);
  await wait(300);
}

/** Füllt ein Eingabefeld anhand seiner Beschriftung. */
async function tippe(win, label, wert) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const feld = [...document.querySelectorAll('.field')].find(f => {
      const l = f.querySelector('label');
      return l && l.textContent.includes(${JSON.stringify(label)});
    });
    if (!feld) return false;
    const input = feld.querySelector('input');
    if (!input) return false;
    input.value = ${JSON.stringify(wert)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`Feld "${label}" nicht gefunden`);
  await wait(120);
}

const text = (win) => win.webContents.executeJavaScript('document.body.innerText');
const titel = (win) => win.webContents.executeJavaScript("(document.querySelector('.lock-title') || {}).textContent || ''");

/** Hakt die Bestätigung an und liest den Wiederherstellungsschlüssel. */
async function nimmSchluessel(win) {
  const schluessel = await win.webContents.executeJavaScript(
    "(document.querySelector('.recovery-key') || {}).textContent || ''"
  );
  await win.webContents.executeJavaScript(`(() => {
    const box = [...document.querySelectorAll('input[type=checkbox]')].pop();
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(200);
  return schluessel.trim();
}

/** Liegt im Datenordner noch irgendwo Klartext? */
function pruefeOrdner(erwarteVerschluesselt) {
  const dateien = [];
  const sammle = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const voll = path.join(dir, e.name);
      if (e.isDirectory()) sammle(voll);
      else dateien.push(voll);
    }
  };
  sammle(DATEN);

  const bestand = dateien.find((f) => /buchhaltung\.(json|nst)$/.test(f));
  say(Boolean(bestand), `Bestandsdatei vorhanden (${bestand ? path.basename(bestand) : 'keine'})`);
  if (!bestand) return;

  const verschluesselt = bestand.endsWith('.nst')
    && fs.readFileSync(bestand).subarray(0, 4).toString('ascii') === 'NSTG';
  say(verschluesselt === erwarteVerschluesselt,
    erwarteVerschluesselt ? 'Bestand ist verschlüsselt' : 'Bestand ist offen');

  if (!erwarteVerschluesselt) return;
  // Und wirklich nirgends mehr der Firmenname im Klartext.
  const leck = dateien.filter((f) => {
    if (/schluessel\.json$/.test(f)) return false;
    return fs.readFileSync(f).includes(Buffer.from('Prüffirma Nordwind', 'utf8'));
  });
  say(leck.length === 0, leck.length ? `Klartext in ${leck.map((f) => path.basename(f)).join(', ')}` : 'Kein Klartext im Ordner');
}

/* ------------------------------------------------------------ Phasen */

const phasen = {
  async einrichten() {
    const win = await warteAufFenster('unlock.html');
    say((await titel(win)) === 'Buchhaltung schützen', `Einrichtung wird angeboten: ${await titel(win)}`);

    const gezeigt = await text(win);
    say(gezeigt.includes(DATEN), 'Der Speicherort steht auf dem Bildschirm');
    say(gezeigt.includes('ändern'), 'Der Speicherort lässt sich ändern');

    await tippe(win, 'Passwort', PASSWORT);
    await tippe(win, 'Passwort wiederholen', PASSWORT);
    await klick(win, 'Verschlüsselung einrichten');
    await wait(3500);

    say((await titel(win)) === 'Wiederherstellungsschlüssel', 'Der Schlüssel wird gezeigt');
    const schluessel = await nimmSchluessel(win);
    say(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/.test(schluessel), `Schlüsselform: ${schluessel}`);
    schreib({ schluessel });

    await klick(win, 'Fertig');
    const app1 = await warteAufFenster('index.html');
    await wait(2500);
    say(true, 'Die App öffnet nach dem Einrichten');

    // Etwas erfassen, damit es in der nächsten Phase etwas zu schützen gibt.
    const ok = await app1.webContents.executeJavaScript(
      "window.kontor.settings.update({ company: { name: 'Prüffirma Nordwind' } }).then(r => r.ok)"
    );
    say(ok, 'Es lässt sich arbeiten');
    await wait(600);
    pruefeOrdner(true);
  },

  async 'entsperren-falsch'() {
    const win = await warteAufFenster('unlock.html');
    say((await titel(win)) === 'Entsperren', 'Beim Start wird nach dem Passwort gefragt');

    await tippe(win, 'Passwort', 'das ist das falsche Passwort');
    await klick(win, 'Öffnen');
    await wait(3000);

    const gezeigt = await text(win);
    say(gezeigt.includes('Das Passwort passt nicht'), 'Ein falsches Passwort wird abgewiesen');
    say(BrowserWindow.getAllWindows().every((w) => !w.webContents.getURL().includes('index.html')),
      'Die App bleibt zu');
    pruefeOrdner(true);
  },

  async 'entsperren-richtig'() {
    const win = await warteAufFenster('unlock.html');
    await tippe(win, 'Passwort', PASSWORT);
    await klick(win, 'Öffnen');

    const app1 = await warteAufFenster('index.html');
    await wait(2500);
    const name = await app1.webContents.executeJavaScript(
      'window.kontor.bootstrap().then(r => r.data.settings.company.name)'
    );
    say(name === 'Prüffirma Nordwind', `Die Daten sind wieder da: ${name}`);

    const zustand = await app1.webContents.executeJavaScript(
      'window.kontor.security.state().then(r => r.data)'
    );
    say(zustand.encrypted === true, 'Die App weiß, dass verschlüsselt ist');
    say(zustand.remembered === false, 'Es ist nichts gemerkt');
  },

  async wiederherstellen() {
    const win = await warteAufFenster('unlock.html');
    await klick(win, 'Passwort vergessen');
    say((await titel(win)) === 'Wiederherstellung', 'Der Ersatzweg steht bereit');

    await tippe(win, 'Wiederherstellungsschlüssel', lies().schluessel.toLowerCase());
    await klick(win, 'Weiter');
    await wait(3000);
    say((await titel(win)) === 'Neues Passwort', 'Nach der Rettung wird ein neues Passwort verlangt');

    await tippe(win, 'Neues Passwort', NEUES_PASSWORT);
    await tippe(win, 'Passwort wiederholen', NEUES_PASSWORT);
    await klick(win, 'Passwort setzen');
    await wait(3500);

    say((await titel(win)) === 'Wiederherstellungsschlüssel', 'Es gibt einen neuen Schlüssel');
    const neuer = await nimmSchluessel(win);
    say(neuer !== lies().schluessel, 'Der neue Schlüssel ist ein anderer');
    schreib({ schluessel: neuer, passwort: NEUES_PASSWORT });

    await klick(win, 'Fertig');
    const app1 = await warteAufFenster('index.html');
    await wait(2500);
    const name = await app1.webContents.executeJavaScript(
      'window.kontor.bootstrap().then(r => r.data.settings.company.name)'
    );
    say(name === 'Prüffirma Nordwind', 'Die Daten haben die Rettung überlebt');
  },

  async merken() {
    const win = await warteAufFenster('unlock.html');
    await tippe(win, 'Passwort', NEUES_PASSWORT);
    say(true, 'Das neue Passwort wird eingegeben');

    // Das Merken ankreuzen und öffnen.
    await win.webContents.executeJavaScript(`(() => {
      const box = document.querySelector('.check input[type=checkbox]');
      if (box) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
    })()`);
    await klick(win, 'Öffnen');

    const app1 = await warteAufFenster('index.html');
    await wait(2500);
    const zustand = await app1.webContents.executeJavaScript(
      'window.kontor.security.state().then(r => r.data)'
    );
    say(zustand.remembered === true, 'Der Rechner merkt sich den Zugang');

    // Und das alte Passwort gilt nicht mehr.
    const altGilt = await app1.webContents.executeJavaScript(
      `window.kontor.security.changePassword(${JSON.stringify(PASSWORT)}, 'noch ein Testpasswort').then(r => r.ok)`
    );
    say(altGilt === false, 'Das alte Passwort ist wertlos geworden');
  },

  async aufheben() {
    // Gemerkt: es darf gar kein Sperrfenster mehr kommen.
    const app1 = await warteAufFenster('index.html');
    await wait(2500);
    say(BrowserWindow.getAllWindows().every((w) => !w.webContents.getURL().includes('unlock.html')),
      'Der gemerkte Zugang öffnet ohne Nachfrage');

    const res = await app1.webContents.executeJavaScript(
      `window.kontor.security.disable(${JSON.stringify(NEUES_PASSWORT)}).then(r => r)`
    );
    say(res.ok === true, `Die Verschlüsselung lässt sich aufheben: ${res.error || 'ok'}`);
    await wait(1500);

    pruefeOrdner(false);
    say(!fs.existsSync(path.join(DATEN, 'schluessel.json')), 'Der Schlüsselbund ist weg');

    const name = await app1.webContents.executeJavaScript(
      'window.kontor.bootstrap().then(r => r.data.settings.company.name)'
    );
    say(name === 'Prüffirma Nordwind', 'Die Daten sind weiterhin vollständig');
  }
};

app.on('window-all-closed', () => {});

require('../src/main/index.js');

(async () => {
  try {
    await phasen[PHASE]();
  } catch (err) {
    say(false, `Ausnahme: ${err.message}`);
  }
  app.exit(offen ? 1 : 0);
})();

setTimeout(() => {
  console.log(` FEHL  ${PHASE}: Zeitüberschreitung`);
  app.exit(1);
}, 90000);
