'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const qr = require('../../src/export/qr');
const jsQR = require('jsqr');

/**
 * Gelesen wird mit jsQR, einem fremden Decoder aus den Entwicklungspaketen.
 * Ein Encoder, den nur sein eigener Decoder versteht, ist wertlos, und im
 * ausgelieferten Programm steckt jsQR nicht.
 */
function lies(text, options = {}) {
  const code = qr.encode(text, options.level);
  const rand = 4;
  const skala = 4;
  const breite = (code.size + rand * 2) * skala;

  // Die Module zu einem RGBA-Bild aufblasen, wie es jsQR erwartet.
  const daten = new Uint8ClampedArray(breite * breite * 4).fill(255);
  for (let y = 0; y < breite; y += 1) {
    for (let x = 0; x < breite; x += 1) {
      const mr = Math.floor(y / skala) - rand;
      const mc = Math.floor(x / skala) - rand;
      const schwarz = mr >= 0 && mr < code.size && mc >= 0 && mc < code.size && code.get(mr, mc);
      if (!schwarz) continue;
      const i = (y * breite + x) * 4;
      daten[i] = 0; daten[i + 1] = 0; daten[i + 2] = 0;
    }
  }

  const ergebnis = jsQR(daten, breite, breite);
  return ergebnis ? ergebnis.data : null;
}

test('Eine kurze URL kommt unverändert zurück', () => {
  assert.equal(lies('https://beispiel.de'), 'https://beispiel.de');
});

test('Auch mit Pfad und Parametern', () => {
  const url = 'https://beispiel.de/kontakt?ref=rechnung&id=42';
  assert.equal(lies(url), url);
});

test('Umlaute überleben als UTF-8', () => {
  const text = 'Grüße aus Musterstadt, Straße 1';
  assert.equal(lies(text), text);
});

test('Jede Fehlerkorrekturstufe ist lesbar', () => {
  for (const level of ['L', 'M', 'Q', 'H']) {
    assert.equal(lies('https://beispiel.de', { level }), 'https://beispiel.de', `Stufe ${level}`);
  }
});

test('Die Version wächst mit der Datenmenge', () => {
  assert.equal(qr.encode('kurz', 'M').version, 1);
  assert.ok(qr.encode('A'.repeat(100), 'M').version >= 5);

  // Und bleibt lesbar, auch wenn mehrere Blöcke verschränkt werden.
  const lang = 'A'.repeat(180);
  assert.equal(lies(lang), lang);
});

test('Auch lange Inhalte bekommen einen Code', () => {
  // Die Bibliothek wählt eine größere Version, statt abzuschneiden.
  const lang = 'A'.repeat(400);
  assert.ok(qr.encode(lang, 'M').version > 10);
  assert.equal(lies(lang), lang);
});

/* ------------------------------------------------------------------ GiroCode */

test('Der GiroCode folgt dem Aufbau des EPC', () => {
  const inhalt = qr.girocode({
    name: 'Musterbetrieb', iban: 'DE02 1203 0000 0000 2020 51', bic: 'BYLADEM1001',
    amount: 12495, text: 'Rechnung R-2609-0101'
  });
  const zeilen = inhalt.split('\n');

  assert.equal(zeilen.length, 12, 'zwölf Zeilen, feste Reihenfolge');
  assert.equal(zeilen[0], 'BCD');
  assert.equal(zeilen[1], '002');
  assert.equal(zeilen[3], 'SCT');
  assert.equal(zeilen[6], 'DE02120300000000202051', 'Leerzeichen raus');
  assert.equal(zeilen[7], 'EUR124.95', 'Punkt als Trennzeichen, zwei Stellen');
  assert.equal(zeilen[10], 'Rechnung R-2609-0101');
});

test('Ohne Betrag bleibt die Betragszeile leer', () => {
  // Zulässig: dann trägt der Zahler ihn selbst ein.
  const zeilen = qr.girocode({ name: 'X', iban: 'DE02120300000000202051' }).split('\n');
  assert.equal(zeilen[7], '');
});

test('Ein GiroCode ist lesbar und kommt unverändert an', () => {
  const inhalt = qr.girocode({
    name: 'Musterbetrieb', iban: 'DE02120300000000202051', bic: 'BYLADEM1001',
    amount: 171360, text: 'Angebot A-2609-0501'
  });
  assert.equal(lies(inhalt), inhalt);
});

/* ------------------------------------------------------------------ Ausgabe */

test('Das SVG hat eine Ruhezone und einen Pfad', () => {
  const svg = qr.svg('test');
  const { size } = qr.encode('test');

  assert.match(svg, new RegExp(`viewBox="0 0 ${size + 8} ${size + 8}"`), 'vier Module Rand');
  assert.match(svg, /<path d="M/);
  assert.match(svg, /shape-rendering="crispEdges"/, 'sonst verwischen die Kanten');
});

test('Die data-URL lässt sich als Bild einbinden', () => {
  const url = qr.dataUrl('https://beispiel.de');
  assert.match(url, /^data:image\/svg\+xml;base64,/);

  const svg = Buffer.from(url.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /^<svg xmlns/);
});

test('Farbe und Hintergrund sind einstellbar', () => {
  const svg = qr.svg('test', { color: '#e8590c', background: 'none' });
  assert.match(svg, /fill="#e8590c"/);
  assert.ok(!svg.includes('<rect'), 'ohne Hintergrund kein Rechteck');
});
