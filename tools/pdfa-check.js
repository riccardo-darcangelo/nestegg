// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
'use strict';

/**
 * Sieht ein PDF auf die Punkte durch, an denen PDF/A-3b üblicherweise
 * scheitert. Aufruf: node tools/pdfa-check.js <datei.pdf>
 *
 * Das ist **keine** Validierung. ISO 19005 hat gut hundert Anforderungen, und
 * ob eine Datei ihnen genügt, sagt nur ein Prüfwerkzeug wie veraPDF. Hier
 * stehen die Punkte, die bei einem aus HTML gerenderten PDF tatsächlich
 * vorkommen, damit ein Fehler auffällt, bevor die Rechnung beim Empfänger
 * liegt.
 */

const fs = require('node:fs');

const file = process.argv[2];
if (!file) {
  console.error('Aufruf: node tools/pdfa-check.js <datei.pdf>');
  process.exit(2);
}

const raw = fs.readFileSync(file).toString('latin1');
const problems = [];

const say = (ok, what, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FEHL '} ${what}${detail ? `: ${detail}` : ''}`);
  if (!ok) problems.push(what);
};

const none = (what, pattern) => {
  const hits = [...raw.matchAll(pattern)].length;
  say(hits === 0, what, hits ? `${hits} Fundstellen` : '');
};

console.log(`\n${file}\n`);

/* Aufbau */
const header = /^%PDF-(\d\.\d)/.exec(raw);
say(Boolean(header) && Number(header[1]) >= 1.7, 'PDF 1.7 oder neuer', header ? header[1] : 'keine Kennung');
say(/\/ID\s*\[/.test(raw), 'Dateikennung im Trailer');
say(!/\/Encrypt\b/.test(raw), 'nicht verschlüsselt');

/* Metadaten */
say(/\/Type\s*\/Metadata/.test(raw), 'XMP-Metadaten');
say(!/\/Type\s*\/Metadata[^>]*\/Filter/.test(raw), 'XMP unkomprimiert');
say(/<pdfaid:part>3</.test(raw), 'pdfaid:part = 3');
say(/<pdfaid:conformance>B</.test(raw), 'pdfaid:conformance = B');

/* Farbe */
say(/\/OutputIntents/.test(raw), 'OutputIntent');
say(/\/DestOutputProfile/.test(raw), 'eingebettetes Farbprofil');

/* Schriften: jede muss eingebettet sein */
const descriptors = [...raw.matchAll(/\/Type\s*\/FontDescriptor/g)].length;
const embedded = [...raw.matchAll(/\/FontFile\d?\b/g)].length;
say(descriptors === 0 || embedded >= descriptors, 'alle Schriften eingebettet', `${embedded} von ${descriptors}`);
say(!/\/BaseFont\s*\/(Helvetica|Times|Courier|Symbol|ZapfDingbats)[^A-Za-z]/.test(raw),
  'keine Standardschrift ohne Einbettung');

/* Was PDF/A nicht erlaubt */
none('kein JavaScript', /\/JavaScript\b/g);
none('keine Launch-Aktion', /\/Launch\b/g);
none('keine Multimedia-Objekte', /\/Movie\b|\/Sound\b/g);
none('kein externer Stream', /\/Ref\b/g);
none('kein PostScript-XObject', /\/Subtype\s*\/PS\b/g);
none('keine Interpolation', /\/Interpolate\s+true/g);
none('keine Transferfunktion', /\/TR2?\s/g);

/* ZUGFeRD */
if (/factur-x\.xml|zugferd/i.test(raw)) {
  say(/\/AFRelationship\s*\/Alternative/.test(raw), 'Anhang als gleichwertige Darstellung');
  say(/\/AF\b/.test(raw), 'Anhang im AF-Eintrag');
  say(/\/EmbeddedFiles/.test(raw), 'Anhang im Namensbaum');
}

console.log(problems.length
  ? `\n${problems.length} Punkt(e) offen. Für die verbindliche Prüfung: veraPDF.\n`
  : '\nKein Punkt offen. Das ersetzt keine Validierung mit veraPDF.\n');

process.exit(problems.length ? 1 : 0);
