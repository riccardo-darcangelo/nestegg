'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Prüft die Oberfläche auf Barrierefreiheit.
 * Aufruf: npx electron tools/a11y-smoke.js
 *
 * Maßstab ist das, worauf das Barrierefreiheitsstärkungsgesetz über die BFSGV
 * verweist: EN 301 549, und die verlangt für Software die Erfolgskriterien der
 * WCAG in Stufe AA. Geprüft wird hier nur, was sich maschinell prüfen lässt.
 * Das ist weniger als die halbe Miete, deckt aber genau die Fehler ab, die
 * sich unbemerkt einschleichen: ein Feld ohne Beschriftung, ein Knopf ohne
 * Namen, ein zu blasser Rand, ein Klickziel, das die Tastatur nicht erreicht.
 *
 * Was ein Mensch prüfen muss und kein Skript: ob die Reihenfolge beim Tabben
 * sinnvoll ist, ob Beschriftungen verständlich sind, ob ein Screenreader die
 * Zusammenhänge richtig vorliest.
 */

const { app, BrowserWindow } = require('electron');

const problems = [];
const say = (ok, text) => {
  console.log(`${ok ? '  ok  ' : ' FEHL '} ${text}`);
  if (!ok) problems.push(text);
};

const MESSUNG = `(() => {
  /* ------------------------------------------------------ Farbrechnen */

  const rgb = (s) => {
    const m = String(s).match(/[\\d.]+/g);
    if (!m) return null;
    return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])];
  };
  const ueber = (vorn, hinten) => {
    const a = vorn[3];
    return [0, 1, 2].map((i) => vorn[i] * a + hinten[i] * (1 - a)).concat(1);
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  // Der tatsächliche Grund unter einem Element: alle getönten Schichten
  // übereinander bis zur ersten deckenden.
  const grundVon = (el, abStart) => {
    const schichten = [];
    for (let n = abStart ? el.parentElement : el; n && n !== document.documentElement; n = n.parentElement) {
      const f = rgb(getComputedStyle(n).backgroundColor);
      if (!f || f[3] === 0) continue;
      schichten.push(f);
      if (f[3] === 1) break;
    }
    let grund = rgb(getComputedStyle(document.body).backgroundColor) || [21, 24, 27, 1];
    if (grund[3] !== 1) grund = [21, 24, 27, 1];
    for (let i = schichten.length - 1; i >= 0; i -= 1) grund = ueber(schichten[i], grund);
    return grund;
  };

  const sichtbar = (el) => {
    if (!el.offsetParent && el.tagName !== 'BODY') return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && Number(cs.opacity) >= 0.3;
  };

  const kurz = (el) => {
    const klasse = String(el.className || '').trim().slice(0, 30);
    const name = klasse ? el.tagName.toLowerCase() + '.' + klasse.split(/\\s+/).join('.') : el.tagName.toLowerCase();
    // Der Weg dorthin, sonst sucht man die Stelle im Quelltext lange.
    const pfad = [];
    for (let n = el.parentElement; n && pfad.length < 3; n = n.parentElement) {
      const k = String(n.className || '').trim().split(/\\s+/)[0];
      if (k) pfad.unshift(k);
    }
    const umgebung = (el.closest('.panel, .modal') || {}).textContent || '';
    return name
      + (el.type ? '[' + el.type + ']' : '')
      + (pfad.length ? '  in ' + pfad.join('>') : '')
      + (umgebung ? '  bei "' + umgebung.trim().replace(/\\s+/g, ' ').slice(0, 30) + '"' : '');
  };

  const funde = [];
  const melde = (kriterium, el, was) => funde.push({ kriterium, wo: kurz(el), was });

  /* --------------------------- 1.4.3 Kontrast von Text (4,5:1 / 3:1) */

  for (const el of document.querySelectorAll('body *')) {
    if (!sichtbar(el)) continue;
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (txt.length < 2) continue;

    const cs = getComputedStyle(el);
    const vorn = rgb(cs.color);
    if (!vorn) continue;
    const grund = grundVon(el);
    const farbe = vorn[3] < 1 ? ueber(vorn, grund) : vorn;

    const groesse = parseFloat(cs.fontSize);
    const staerke = parseInt(cs.fontWeight, 10) || 400;
    const ziel = (groesse >= 24 || (groesse >= 18.66 && staerke >= 700)) ? 3 : 4.5;

    const wert = ratio(farbe, grund);
    if (wert < ziel) melde('1.4.3 Kontrast', el, wert.toFixed(2) + ':1 statt ' + ziel + ', "' + txt.slice(0, 26) + '"');
  }

  /* ------------------ 1.4.11 Kontrast von Bedienelementen (3:1) */

  // Der Rand eines Eingabefeldes ist das, woran man es überhaupt erkennt.
  // Ist er zu blass, sieht man nicht, wo man klicken soll.
  for (const el of document.querySelectorAll('input, select, textarea, .seg, .btn')) {
    if (!sichtbar(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.borderTopStyle === 'none' || parseFloat(cs.borderTopWidth) === 0) continue;

    const rand = rgb(cs.borderTopColor);
    if (!rand || rand[3] === 0) continue;
    const aussen = grundVon(el, true);
    const wert = ratio(rand[3] < 1 ? ueber(rand, aussen) : rand, aussen);
    if (wert < 3) melde('1.4.11 Bedienelement', el, 'Rand ' + wert.toFixed(2) + ':1 statt 3');
  }

  /* --------------------------------- 4.1.2 Name, Rolle, Wert */

  const nameVon = (el) => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const von = el.getAttribute('aria-labelledby');
    if (von) {
      const ziel = document.getElementById(von);
      if (ziel && ziel.textContent.trim()) return ziel.textContent.trim();
    }
    if (el.id) {
      const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab && lab.textContent.trim()) return lab.textContent.trim();
    }
    if (el.closest('label') && el.closest('label').textContent.trim()) return el.closest('label').textContent.trim();
    if (el.title) return el.title;
    return '';
  };

  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!sichtbar(el) || el.type === 'hidden') continue;
    if (!nameVon(el)) {
      melde('4.1.2 ohne Namen', el, 'Feld' + (el.placeholder ? ' (nur Platzhalter: "' + el.placeholder.slice(0, 24) + '")' : ''));
    }
  }

  for (const el of document.querySelectorAll('button, [role="button"], a[href]')) {
    if (!sichtbar(el)) continue;
    if (!el.textContent.trim() && !nameVon(el)) melde('4.1.2 ohne Namen', el, 'Bedienelement ohne Beschriftung');
  }

  /* ------------------------------------------ 2.1.1 Tastatur */

  // Alles, was auf einen Klick reagiert, muss auch die Tastatur erreichen.
  for (const el of document.querySelectorAll('.clickable, [onclick]')) {
    if (!sichtbar(el)) continue;
    // Ein Knopf innerhalb der Zeile zaehlt nicht: er loest etwas anderes aus
    // als der Klick auf die Zeile selbst.
    const bedienbar = /^(a|button|input|select|textarea)$/i.test(el.tagName)
      || el.hasAttribute('tabindex');
    if (!bedienbar) melde('2.1.1 Tastatur', el, 'klickbar, aber nicht anspringbar');
  }

  /* --------------------------------------- 2.5.8 Zielgröße (24px) */

  for (const el of document.querySelectorAll('button, a[href], input[type="checkbox"], input[type="radio"], select')) {
    if (!sichtbar(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Ausgenommen, was im Fließtext steht: dort gilt die Regel nicht.
    if (el.tagName === 'A' && el.closest('p, li')) continue;
    // Ein Kontrollkaestchen in einem Label wird ueber das Label bedient, und
    // das ist das eigentliche Ziel.
    const label = el.closest('label');
    const ziel = label ? label.getBoundingClientRect() : r;
    if (ziel.width < 24 || ziel.height < 24) {
      melde('2.5.8 Zielgröße', el, Math.round(ziel.width) + 'x' + Math.round(ziel.height) + ' statt 24x24');
    }
  }

  /* --------------------------- 1.3.1 Info und Beziehungen */

  // Überschriften dürfen keine Stufe überspringen.
  let vorige = 0;
  for (const el of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (!sichtbar(el)) continue;
    const stufe = Number(el.tagName[1]);
    if (vorige && stufe > vorige + 1) melde('1.3.1 Überschriften', el, 'h' + vorige + ' springt auf h' + stufe);
    vorige = stufe;
  }

  // Doppelte Kennungen brechen jede Zuordnung über id.
  const ids = new Map();
  for (const el of document.querySelectorAll('[id]')) {
    ids.set(el.id, (ids.get(el.id) || 0) + 1);
  }
  for (const [id, anzahl] of ids) {
    if (anzahl > 1) funde.push({ kriterium: '4.1.1 Kennungen', wo: '#' + id, was: anzahl + ' mal vergeben' });
  }

  return funde;
})()`;

/** Prüfungen, die einmal für das ganze Dokument gelten. */
const DOKUMENT = `(() => {
  const funde = [];
  if (!document.documentElement.lang) funde.push({ kriterium: '3.1.1 Sprache', wo: 'html', was: 'lang fehlt' });

  const toasts = document.getElementById('toasts');
  if (toasts && toasts.getAttribute('role') !== 'status' && toasts.getAttribute('aria-live') !== 'polite') {
    funde.push({ kriterium: '4.1.3 Statusmeldungen', wo: '#toasts', was: 'ohne aria-live, Meldungen werden nicht angesagt' });
  }

  const nav = document.getElementById('nav');
  if (nav && nav.tagName !== 'NAV' && !nav.getAttribute('role')) {
    funde.push({ kriterium: '1.3.6 Bereiche', wo: '#nav', was: 'kein Navigationsbereich' });
  }
  const main = document.getElementById('main');
  if (main && main.tagName !== 'MAIN' && !main.getAttribute('role')) {
    funde.push({ kriterium: '1.3.6 Bereiche', wo: '#main', was: 'kein Hauptbereich' });
  }
  return funde;
})()`;

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
    if (level >= 3) problems.push(`Renderer: ${message} (${String(source).split(/[\\/]/).pop()}:${line})`);
  });

  win.webContents.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 2500));

    if (await skipLockScreen(win)) return;
    const run = (code) => win.webContents.executeJavaScript(code);

    console.log('\nBarrierefreiheit nach EN 301 549, WCAG 2.1 AA\n');

    const gesamt = new Map();
    const merke = (fall, ansicht) => {
      const schluessel = `${fall.kriterium}|${fall.wo}|${fall.was}`;
      if (!gesamt.has(schluessel)) gesamt.set(schluessel, { ...fall, ansicht });
    };

    for (const fall of await run(DOKUMENT)) merke(fall, 'Dokument');

    const namen = await run('Object.keys(window.Views)');
    for (const name of namen) {
      await run(`App.navigate(${JSON.stringify(name)})`);
      await new Promise((r) => setTimeout(r, 320));

      const funde = await run(MESSUNG);
      for (const fall of funde) merke(fall, name);
      say(funde.length === 0, `Ansicht ${name}${funde.length ? `: ${funde.length} Fund(e)` : ''}`);
    }

    /* ----------------------------------- 2.4.1 Blöcke umgehen */

    // Der Sprunglink muss beim Fokus wirklich ins Bild kommen. Gemessen wird
    // die Lage des Elements, nicht das Vorhandensein einer CSS-Regel: nur so
    // fällt auf, wenn etwas anderes ihn festhält.
    win.focus();
    await new Promise((r) => setTimeout(r, 200));
    const sprung = await run(`(() => {
      const link = document.querySelector('.skip-link');
      if (!link) return { fehlt: true };
      link.focus();
      const r = link.getBoundingClientRect();
      const ziel = document.querySelector(link.getAttribute('href'));
      return {
        imBild: r.top >= 0 && r.left >= 0 && r.height > 0,
        oben: Math.round(r.top),
        zielVorhanden: Boolean(ziel),
        zielAnspringbar: Boolean(ziel && ziel.hasAttribute('tabindex'))
      };
    })()`);

    say(!sprung.fehlt, 'Ein Sprunglink zum Inhalt ist da');
    if (!sprung.fehlt) {
      say(sprung.imBild, `Der Sprunglink erscheint beim Fokus (oben: ${sprung.oben}px)`);
      say(sprung.zielVorhanden && sprung.zielAnspringbar, 'Sein Ziel lässt sich anspringen');
    }

    /* --------------------------------------------------- Dialoge */

    // Ein Dialog ist der Ort, an dem Tastaturbedienung am ehesten bricht:
    // Fokus, der nicht hineinspringt, herausfällt oder nicht zurückkehrt.
    await run("App.navigate('entries')");
    await new Promise((r) => setTimeout(r, 400));
    await run(`[...document.querySelectorAll('.page-actions button')].find((b) => /Ausgabe|Einnahme/.test(b.textContent)).focus()`);
    await run(`document.activeElement.click()`);
    await new Promise((r) => setTimeout(r, 700));

    const dialog = await run(`(() => {
      const modal = document.querySelector('#modal-root .modal');
      if (!modal) return { fehlt: true };
      const ziele = [...modal.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.offsetParent !== null);
      return {
        rolle: modal.getAttribute('role'),
        modalAttr: modal.getAttribute('aria-modal'),
        titelVerweis: Boolean(modal.getAttribute('aria-labelledby')
          && document.getElementById(modal.getAttribute('aria-labelledby'))),
        fokusDrin: modal.contains(document.activeElement),
        anzahlZiele: ziele.length,
        schliessenBenannt: Boolean((modal.querySelector('.close-x') || {}).getAttribute
          && modal.querySelector('.close-x').getAttribute('aria-label'))
      };
    })()`);

    say(!dialog.fehlt, 'Dialog öffnet sich');
    if (!dialog.fehlt) {
      say(dialog.rolle === 'dialog', `Dialog ist als Dialog ausgezeichnet (role=${dialog.rolle})`);
      say(dialog.modalAttr === 'true', 'Dialog sperrt den Rest der Seite (aria-modal)');
      say(dialog.titelVerweis, 'Dialog nennt seinen Titel (aria-labelledby)');
      say(dialog.fokusDrin, 'Fokus springt beim Öffnen in den Dialog');
      say(dialog.schliessenBenannt, 'Das Schließkreuz hat einen Namen');

      // Vom letzten Ziel weiter muss wieder das erste kommen, statt aus dem
      // Dialog heraus in die gesperrte Seite dahinter.
      const umlauf = await run(`(() => {
        const modal = document.querySelector('#modal-root .modal');
        const ziele = [...modal.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
          .filter((el) => el.offsetParent !== null);
        ziele[ziele.length - 1].focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        return { landetAufErstem: document.activeElement === ziele[0] };
      })()`);
      say(umlauf.landetAufErstem, 'Tab am Ende führt zurück an den Anfang des Dialogs');

      const zurueck = await run(`(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return {
          zu: !document.querySelector('#modal-root .modal'),
          fokusZurueck: document.activeElement && document.activeElement.closest('.page-actions') !== null
        };
      })()`);
      say(zurueck.zu, 'Escape schließt den Dialog');
      say(zurueck.fokusZurueck, 'Der Fokus kehrt zum auslösenden Knopf zurück');
    }

    if (gesamt.size) {
      console.log('\nBefunde\n');
      const nachKriterium = new Map();
      for (const f of gesamt.values()) {
        if (!nachKriterium.has(f.kriterium)) nachKriterium.set(f.kriterium, []);
        nachKriterium.get(f.kriterium).push(f);
      }
      for (const [kriterium, liste] of [...nachKriterium].sort()) {
        console.log(`  ${kriterium}  (${liste.length})`);
        for (const f of liste.slice(0, 8)) console.log(`      ${f.wo.padEnd(34)} ${f.was}   [${f.ansicht}]`);
        if (liste.length > 8) console.log(`      … und ${liste.length - 8} weitere`);
      }
      problems.push(`${gesamt.size} Befund(e)`);
    }

    console.log(problems.length ? `\n${problems.length} Punkt(e) offen.\n` : '\nKeine maschinell prüfbaren Verstöße.\n');
    app.exit(problems.length ? 1 : 0);
  });
});

require('../src/main/index.js');

setTimeout(() => {
  console.log('\n FEHL  Die Oberfläche hat nicht geladen.\n');
  app.exit(1);
}, 90000);
