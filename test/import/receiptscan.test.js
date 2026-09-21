'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const pdftext = require('../../src/import/pdftext');
const scan = require('../../src/import/receiptscan');

/* ------------------------------------------------------------------ PDF */

test('Ein PDF mit Standardschrift wird im Klartext gelesen', async () => {
  const { PDFDocument, StandardFonts } = require('pdf-lib');

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const lines = [
    'Hetzner Online GmbH',
    'Industriestr. 25, 91710 Gunzenhausen',
    'Rechnungsnummer R0089123',
    'Rechnungsdatum 01.09.2026',
    'Umsatzsteuer 19 %',
    'Rechnungsbetrag 23,80'
  ];
  lines.forEach((line, index) => {
    page.drawText(line, { x: 50, y: 780 - index * 20, size: 11, font });
  });

  const bytes = Buffer.from(await doc.save());
  const result = pdftext.extract(bytes);

  assert.ok(result.text.includes('Hetzner Online GmbH'));
  assert.ok(result.text.includes('R0089123'));
  assert.equal(result.pages, 1);
});

test('Eine ToUnicode-Tabelle wird aus bfchar und bfrange gelesen', () => {
  const cmap = `
    8 beginbfchar
    <0003> <0020>
    <002A> <0047>
    endbfchar
    2 beginbfrange
    <000E> <001C> <002B>
    <0044> <0046> [<0061> <0062> <0063>]
    endbfrange
  `;
  const map = pdftext.parseToUnicode(cmap);

  assert.equal(map.get(0x03), ' ');
  assert.equal(map.get(0x2a), 'G');
  assert.equal(map.get(0x0e), '+', 'Anfang des Bereichs');
  assert.equal(map.get(0x13), '0', 'die Null liegt fünf Stellen weiter');
  assert.equal(map.get(0x14), '1');
  assert.equal(map.get(0x45), 'b', 'Bereich mit ausdrücklicher Liste');
});

test('ActualText schlägt die gemalten Glyphen', () => {
  const tokens = pdftext.tokenize('/Span<</ActualText (1) >> BDC 7 0 Td <11C4> Tj EMC');
  const kinds = tokens.map((token) => token.type);

  assert.ok(kinds.includes('actual'));
  assert.ok(kinds.includes('endmarked'));
  assert.equal(tokens.find((t) => t.type === 'actual').value, '1');
});

test('Sprünge in der Höhe werden zu Zeilenumbrüchen', () => {
  const tokens = pdftext.tokenize('1 0 0 -1 100 200 Tm (a) Tj 0 -14 Td (b) Tj 7 0 Td (c) Tj');
  const moves = tokens.filter((token) => token.type === 'move');

  assert.equal(moves.length, 3);
  assert.equal(moves[0].relative, false);
  assert.equal(moves[1].y, -14, 'eine neue Zeile');
  assert.equal(moves[2].y, 0, 'nur weiter nach rechts');
});

test('Ohne lesbaren Text wird das gesagt, statt Zeichensalat zu liefern', () => {
  const result = pdftext.extract(Buffer.from('%PDF-1.4\n1 0 obj\n<</Type /Page>>\nendobj\n'));
  assert.equal(result.text, '');
  assert.match(result.warning, /kein auslesbarer Text|Scan/);
});

/* ------------------------------------------------------------------ Werte */

test('Beträge werden in beiden Schreibweisen gelesen', () => {
  assert.equal(scan.toCents('1.234,56'), 123456);
  assert.equal(scan.toCents('1,234.56'), 123456);
  assert.equal(scan.toCents('23,80'), 2380);
  assert.equal(scan.toCents('1000'), 100000);
  assert.equal(scan.toCents('keine Zahl'), null);
});

test('Daten werden in beiden Schreibweisen gelesen', () => {
  assert.equal(scan.toIso('01.09.2026'), '2026-09-01');
  assert.equal(scan.toIso('1.9.26'), '2026-09-01');
  assert.equal(scan.toIso('2026-09-01'), '2026-09-01');
  assert.equal(scan.toIso('99.99.9999'), null);
});

const BELEG = [
  'Hetzner Online GmbH',
  'Industriestr. 25',
  '91710 Gunzenhausen',
  'USt-IdNr. DE812871812',
  'Rechnungsnummer R0089123',
  'Rechnungsdatum 01.09.2026',
  'Cloud Server CX41 16,00',
  'Speicher 4,00',
  'Umsatzsteuer 19 % 3,80',
  'Rechnungsbetrag 23,80',
  'IBAN DE24 7604 0061 0327 1909 00'
].join('\n');

test('Aus einem Belegtext werden Betrag, Datum, Nummer und Lieferant gelesen', () => {
  const result = scan.analyse(BELEG);

  assert.equal(result.fields.amount, 2380, 'der Rechnungsbetrag, nicht eine Position');
  assert.equal(result.fields.date, '2026-09-01');
  assert.equal(result.fields.number, 'R0089123');
  assert.equal(result.fields.vatRate, 19);
  assert.equal(result.fields.counterparty, 'Hetzner Online GmbH');
  assert.equal(result.fields.counterpartyVatId, 'DE812871812');
  assert.equal(result.fields.iban, 'DE24760400610327190900');
});

test('Jeder Vorschlag sagt, worauf er beruht', () => {
  const result = scan.analyse(BELEG);
  const hints = result.hints.join(' ');

  assert.match(hints, /Betrag aus "rechnungsbetrag"/);
  assert.match(hints, /Lieferant geraten/);
});

test('Ohne Schlüsselwort wird der größte Betrag genommen und das gesagt', () => {
  const result = scan.analyse('Irgendein Laden\n12,00\n144,90\n7,50');

  assert.equal(result.fields.amount, 14490);
  assert.match(result.hints.join(' '), /geraten/);
});

test('Eine Großbuchstabenfolge ist keine Steuernummer', () => {
  const result = scan.analyse('VORGANG DATUM BETRAG\nSumme 10,00');
  assert.equal(result.fields.counterpartyVatId, undefined);
});

test('Ein Bild statt Text wird als solches benannt', () => {
  const result = scan.scan(Buffer.from('nicht einmal ein PDF'), 'foto.jpg');
  assert.equal(result.ok, false);
  assert.match(result.warning, /nur bei PDF/);
});
