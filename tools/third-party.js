'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Sammelt die Lizenzen aller mitgelieferten Fremdpakete.
 * Aufruf: node tools/third-party.js
 *
 * NestEgg steht unter der GPL, die mitgelieferten Bibliotheken nicht. MIT,
 * ISC, BSD und Apache verlangen alle dasselbe: bei der Weitergabe müssen der
 * Urhebervermerk und der Lizenztext beiliegen. Genau dafür ist diese Datei
 * da, und sie wird erzeugt statt gepflegt: eine handgeschriebene Liste ist
 * nach der dritten neuen Abhängigkeit falsch.
 *
 * Aufgenommen wird nur, was wirklich mitgeht, also die Laufzeitabhängigkeiten
 * und ihre eigenen. Was nur zum Bauen und Prüfen gebraucht wird, landet nicht
 * beim Nutzer und gehört deshalb nicht hierher. Electron selbst steht
 * gesondert am Ende: es wird als fertiges Programm mitgeliefert, nicht als
 * Paket im node_modules-Baum des Installers.
 */

const fs = require('node:fs');
const path = require('node:path');

const { ROOT: WURZEL } = require('./paths');
const ZIEL = path.join(WURZEL, 'THIRD-PARTY-NOTICES.md');

/** Liest ein package.json, oder null. */
function paket(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Sucht das Verzeichnis eines Pakets, von innen nach außen. */
function findePaket(name, start) {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    const kandidat = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(kandidat, 'package.json'))) return kandidat;
    const oben = path.dirname(dir);
    if (oben === dir) break;
    dir = oben;
  }
  return null;
}

/** Die Lizenzkennung eines Pakets, in welcher Schreibweise auch immer. */
function lizenzVon(p) {
  if (typeof p.license === 'string') return p.license;
  if (p.license && p.license.type) return p.license.type;
  if (Array.isArray(p.licenses) && p.licenses[0]) return p.licenses[0].type || String(p.licenses[0]);
  return null;
}

/** Der beigelegte Lizenztext, wenn es einen gibt. */
function lizenztext(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (!/^(licen[cs]e|copying)/i.test(name)) continue;
    const voll = path.join(dir, name);
    try {
      if (fs.statSync(voll).isFile()) return fs.readFileSync(voll, 'utf8').trim();
    } catch { /* weiter */ }
  }
  return null;
}

/** Alles, was zur Laufzeit gebraucht wird, rekursiv. */
function sammle() {
  const wurzelPaket = paket(WURZEL);
  const gefunden = new Map();
  const offen = Object.keys(wurzelPaket.dependencies || {}).map((name) => ({ name, von: WURZEL }));

  while (offen.length) {
    const { name, von } = offen.pop();
    if (gefunden.has(name)) continue;

    const dir = findePaket(name, von);
    if (!dir) { gefunden.set(name, { name, fehlt: true }); continue; }

    const p = paket(dir);
    if (!p) continue;

    gefunden.set(name, {
      name,
      version: p.version,
      lizenz: lizenzVon(p),
      text: lizenztext(dir),
      urheber: typeof p.author === 'string' ? p.author : (p.author && p.author.name) || null,
      seite: p.homepage || (p.repository && (p.repository.url || p.repository)) || null
    });

    for (const weiter of Object.keys(p.dependencies || {})) offen.push({ name: weiter, von: dir });
  }

  return [...gefunden.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------- Ausgabe */

const pakete = sammle();
const ohneAngabe = pakete.filter((p) => !p.lizenz && !p.fehlt);
const ohneText = pakete.filter((p) => p.lizenz && !p.text);

const nachLizenz = new Map();
for (const p of pakete) {
  const l = p.lizenz || 'ohne Angabe';
  if (!nachLizenz.has(l)) nachLizenz.set(l, []);
  nachLizenz.get(l).push(p);
}

const zeilen = [];
zeilen.push('# Mitgelieferte Fremdsoftware');
zeilen.push('');
zeilen.push('NestEgg selbst steht unter der GPL-3.0-or-later, siehe `LICENSE`.');
zeilen.push('Die hier aufgeführten Bibliotheken werden mitgeliefert und stehen unter');
zeilen.push('ihren eigenen Lizenzen. Sie bleiben Eigentum ihrer Urheber.');
zeilen.push('');
zeilen.push('Diese Datei wird erzeugt: `node tools/third-party.js`. Nicht von Hand ändern.');
zeilen.push('');
zeilen.push('## Übersicht');
zeilen.push('');
zeilen.push('| Lizenz | Pakete |');
zeilen.push('| --- | --- |');
for (const [lizenz, liste] of [...nachLizenz].sort((a, b) => b[1].length - a[1].length)) {
  zeilen.push(`| ${lizenz} | ${liste.length} |`);
}
zeilen.push('');
zeilen.push('Dazu kommt **Electron** selbst (MIT), das als fertige Laufzeitumgebung');
zeilen.push('mitgeliefert wird, samt Chromium (BSD-3-Clause und weitere) und Node.js (MIT).');
zeilen.push('Ihre vollständigen Lizenztexte liegen der Installation in');
zeilen.push('`LICENSES.chromium.html` und `LICENSE.electron.txt` bei.');
zeilen.push('');

if (ohneAngabe.length) {
  zeilen.push('## Ohne Lizenzangabe');
  zeilen.push('');
  zeilen.push('Diese Pakete führen keine Lizenz in ihrem `package.json` und legen keinen');
  zeilen.push('Lizenztext bei. Das ist bei alten Paketen verbreitet und in aller Regel');
  zeilen.push('ein Versäumnis des Urhebers, streng genommen fehlt aber die Erlaubnis zur');
  zeilen.push('Weitergabe. Wer das sauber haben will, ersetzt die Abhängigkeit, die sie');
  zeilen.push('hereinzieht.');
  zeilen.push('');
  for (const p of ohneAngabe) zeilen.push(`- **${p.name}** ${p.version}${p.seite ? ` (${p.seite})` : ''}`);
  zeilen.push('');
}

zeilen.push('## Einzelne Pakete');
zeilen.push('');
for (const p of pakete) {
  if (p.fehlt) { zeilen.push(`### ${p.name}`, '', 'Nicht installiert, Lizenz nicht ermittelbar.', ''); continue; }
  zeilen.push(`### ${p.name} ${p.version}`);
  zeilen.push('');
  zeilen.push(`Lizenz: ${p.lizenz || 'ohne Angabe'}`);
  if (p.urheber) zeilen.push(`Urheber: ${p.urheber}`);
  if (p.seite) zeilen.push(`Herkunft: ${String(p.seite).replace(/^git\+/, '').replace(/\.git$/, '')}`);
  zeilen.push('');
  if (p.text) {
    zeilen.push('```');
    zeilen.push(p.text);
    zeilen.push('```');
    zeilen.push('');
  }
}

fs.writeFileSync(ZIEL, `${zeilen.join('\n')}\n`, 'utf8');

console.log(`${path.relative(WURZEL, ZIEL)} geschrieben\n`);
console.log(`  Pakete zur Laufzeit: ${pakete.length}`);
for (const [lizenz, liste] of [...nachLizenz].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${String(liste.length).padStart(3)}  ${lizenz}`);
}
if (ohneText.length) {
  console.log(`\n  Ohne beigelegten Lizenztext (Kennung reicht meist): ${ohneText.length}`);
}
if (ohneAngabe.length) {
  console.log('\n  OHNE LIZENZANGABE, bitte ansehen:');
  for (const p of ohneAngabe) console.log(`    ${p.name} ${p.version}`);
}
