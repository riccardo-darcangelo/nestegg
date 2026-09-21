'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const gobd = require('../../src/export/gobd');
const doku = require('../../src/export/verfahrensdoku');
const { defaultSettings } = require('../../src/storage/store');
const entriesDomain = require('../../src/domain/entries');

function data(overrides = {}) {
  const settings = defaultSettings();
  settings.company = { name: 'Beispiel Consulting', owner: 'Vorname Nachname', street: 'Musterweg 12', zip: '10115', city: 'Berlin', taxNumber: '12/345/67890', vatId: 'DE123456789' };

  return {
    settings,
    entries: [
      entriesDomain.normalizeEntry({
        id: 'b1', type: 'expense', date: '2026-03-01', paidDate: '2026-03-02', amount: 11900,
        categoryId: 'exp_software', description: 'Hosting; mit Semikolon', counterparty: 'Hetzner "Online" GmbH',
        bankRef: 'abc123'
      }),
      entriesDomain.normalizeEntry({
        id: 'b2', type: 'income', date: '2026-04-01', paidDate: '2026-04-05', amount: 238000,
        categoryId: 'inc_services', description: 'Projekt', counterparty: 'Kundenfirma GmbH'
      })
    ],
    invoices: [{
      id: 're1', documentType: 'invoice', number: 'RE-2026-0001', status: 'paid',
      issueDate: '2026-04-01', dueDate: '2026-04-15', customerId: 'kd1', currency: 'EUR',
      items: [{ name: 'Leistung', quantity: 2, unit: 'HUR', unitPriceNet: 100000, vatRate: 19 }],
      payments: [{ date: '2026-04-05', amount: 238000 }]
    }],
    customers: [{ id: 'kd1', name: 'Kundenfirma GmbH', vatId: 'DE987654321' }],
    projects: [],
    assets: [{
      id: 'an1', label: 'Notebook', purchaseDate: '2026-01-15', netCents: 180000,
      usefulLifeYears: 3, disposalDate: null, entryId: null, note: ''
    }],
    receipts: [{
      id: 'bl1', fileName: 'rechnung.pdf', relativePath: '2026/rechnung.pdf',
      originalName: 'scan_0001.pdf', date: '2026-03-01', checksum: 'a'.repeat(64),
      size: 1234, addedAt: '2026-03-01T10:00:00.000Z'
    }],
    recurrences: [],
    imports: [],
    ...overrides
  };
}

/* ------------------------------------------------------------------ Export */

test('Der Export enthält eine Datei je Tabelle plus Beschreibung', () => {
  const { files } = gobd.buildDataExport(data());
  const names = files.map((f) => f.name);

  assert.ok(names.includes('buchungen.csv'));
  assert.ok(names.includes('dokumente.csv'));
  assert.ok(names.includes('positionen.csv'));
  assert.ok(names.includes('index.xml'), 'ohne Beschreibungsdatei ist der Export wertlos');
  assert.ok(names.includes('liesmich.txt'));
});

test('Texte werden begrenzt, damit ein Semikolon die Spalten nicht zerlegt', () => {
  const { files } = gobd.buildDataExport(data());
  const csv = files.find((f) => f.name === 'buchungen.csv').content;
  const firstLine = csv.split('\r\n')[0];

  assert.ok(firstLine.includes('"Hosting; mit Semikolon"'));
  assert.ok(firstLine.includes('"Hetzner ""Online"" GmbH"'), 'Anführungszeichen werden verdoppelt');
});

test('Beträge stehen mit Komma und ohne Tausenderpunkt', () => {
  const { files } = gobd.buildDataExport(data());
  const csv = files.find((f) => f.name === 'buchungen.csv').content;

  assert.ok(csv.includes(';119,00;'), 'brutto 119,00');
  assert.ok(!/\d\.\d{3},/.test(csv), 'kein Tausenderpunkt, der als Spaltentrenner missverstanden wird');
});

test('Die Herkunft jeder Buchung wird ausgewiesen', () => {
  assert.equal(gobd.herkunft({ bankRef: 'x' }), 'Kontoauszug');
  assert.equal(gobd.herkunft({ eInvoiceRef: 'x' }), 'E-Rechnung');
  assert.equal(gobd.herkunft({ recurrenceId: 'x' }), 'Wiederkehrende Vorlage');
  assert.equal(gobd.herkunft({}), 'Erfassung von Hand');

  const { files } = gobd.buildDataExport(data());
  const csv = files.find((f) => f.name === 'buchungen.csv').content;
  assert.ok(csv.includes('"Kontoauszug"'));
});

test('Die Beschreibungsdatei nennt jede Spalte jeder Tabelle', () => {
  const xml = gobd.buildIndexXml(data(), { from: '2026-01-01', to: '2026-12-31' });

  assert.ok(xml.includes('<!DOCTYPE DataSet SYSTEM "gdpdu-01-08-2002.dtd">'));
  assert.ok(xml.includes('<URL>buchungen.csv</URL>'));
  assert.ok(xml.includes('<Name>Zahlungsdatum</Name>'));
  assert.ok(xml.includes('<DecimalSymbol>,</DecimalSymbol>'));
  assert.ok(xml.includes('<ColumnDelimiter>;</ColumnDelimiter>'));

  for (const table of gobd.TABLES) {
    assert.ok(xml.includes(`<URL>${table.file}</URL>`), `${table.file} fehlt in der Beschreibung`);
    for (const column of table.columns) {
      assert.ok(xml.includes(`<Name>${column.name}</Name>`), `Spalte ${column.name} fehlt`);
    }
  }
});

test('Positionen werden je Dokument aufgeschlüsselt', () => {
  const { files } = gobd.buildDataExport(data());
  const csv = files.find((f) => f.name === 'positionen.csv').content;

  assert.ok(csv.includes('"RE-2026-0001"'));
  assert.ok(csv.includes('"Leistung"'));
});

test('Ein leerer Bestand ergibt leere Dateien, aber eine vollständige Beschreibung', () => {
  const leer = { settings: defaultSettings(), entries: [], invoices: [], customers: [], projects: [], assets: [], receipts: [] };
  const { files } = gobd.buildDataExport(leer);

  assert.equal(files.find((f) => f.name === 'buchungen.csv').content, '');
  assert.ok(files.find((f) => f.name === 'index.xml').content.includes('<URL>buchungen.csv</URL>'));
});

/**
 * Die Spalten wurden aus Feldnamen gelesen, die es an Beleg und Anlage nie
 * gab, und blieben deshalb leer. Gegenüber einer Prüfung ist das schlimmer
 * als eine fehlende Spalte: die Beschreibungsdatei sagt zu, dass dort etwas
 * steht.
 */
test('Jeder Beleg trägt Ablage, Prüfsumme und Ablagezeitpunkt', () => {
  const { files } = gobd.buildDataExport(data());
  const zeile = files.find((f) => f.name === 'belege.csv').content.split('\r\n')[0];

  assert.match(zeile, /2026\/rechnung\.pdf/, 'die Ablage fehlt');
  assert.match(zeile, /a{64}/, 'die Prüfsumme fehlt');
  assert.match(zeile, /2026-03-01T10:00:00/, 'der Ablagezeitpunkt fehlt');
});

test('Jede Anlage trägt Bezeichnung und Anschaffungskosten', () => {
  const { files } = gobd.buildDataExport(data());
  const zeile = files.find((f) => f.name === 'anlagen.csv').content.split('\r\n')[0];

  assert.match(zeile, /Notebook/, 'die Bezeichnung fehlt');
  assert.match(zeile, /1800,00/, 'die Anschaffungskosten fehlen');
  assert.match(zeile, /linear/, 'die Abschreibungsmethode fehlt');
});

test('Der bezahlte Betrag steht am Dokument', () => {
  const { files } = gobd.buildDataExport(data());
  const zeile = files.find((f) => f.name === 'dokumente.csv').content.split('\r\n')[0];
  const spalten = zeile.split(';');

  // Netto, Umsatzsteuer, Brutto, Bezahlt, Offen stehen hintereinander.
  const brutto = spalten.indexOf('2380,00');
  assert.ok(brutto > -1, 'der Bruttobetrag fehlt');
  assert.equal(spalten[brutto + 1], '2380,00', 'der bezahlte Betrag fehlt');
  assert.equal(spalten[brutto + 2], '0,00');
});

/* ------------------------------------------------------------------ Doku */

test('Die Verfahrensdokumentation beschreibt den tatsächlichen Stand', () => {
  const html = doku.build(data(), { dataDir: 'C:\\Daten\\NestEgg', version: '1.0.0', schemaVersion: 5, today: '2026-09-17' });

  assert.ok(html.includes('Beispiel Consulting'));
  assert.ok(html.includes('C:\\Daten\\NestEgg'));
  assert.ok(html.includes('Ist-Versteuerung'), 'die eingestellte Besteuerungsart');
  assert.ok(html.includes('Version 5'));
  assert.ok(html.includes('17.09.2026'));
  assert.ok(html.includes('RE-'), 'das Nummernmuster der Rechnungen');
});

test('Was die Software nicht wissen kann, steht als Lücke darin', () => {
  const html = doku.build(data(), {});
  const luecken = (html.match(/class="gap"/g) || []).length;
  assert.ok(luecken >= 8, `es sollten mehrere auszufüllende Stellen bleiben, gefunden: ${luecken}`);
  assert.ok(html.includes('Geschäftstätigkeit'));
  assert.ok(html.includes('Wiederherstellung wurde zuletzt geprüft'));
});

test('Die Doku nennt beide Aufbewahrungsfristen getrennt', () => {
  const html = doku.build(data(), {});
  assert.ok(html.includes('acht\n  Jahre') || html.includes('acht Jahre'), 'Buchungsbelege acht Jahre');
  assert.ok(html.includes('zehn Jahre'), 'Aufzeichnungen zehn Jahre');
  assert.ok(html.includes('§147 AO'));
});

test('Fehlende Firmendaten werden als Lücke gezeigt, nicht erfunden', () => {
  const ohne = data();
  ohne.settings.company = { name: '', owner: '' };
  const html = doku.build(ohne, {});

  assert.ok(html.includes('Firmenname fehlt in den Einstellungen'));
  assert.ok(!html.includes('Beispiel Consulting'));
});

/**
 * Die Besteuerungsart stand als fester Satz darin, weil das Feld unter einem
 * Namen gelesen wurde, den es nie gab. Gegenüber einer Prüfung ist eine
 * falsche Aussage schlimmer als eine fehlende.
 */
test('Die Doku nennt die eingestellte Besteuerungsart', () => {
  const soll = data();
  soll.settings.tax.vatMethod = 'soll';
  assert.match(doku.build(soll), /Soll-Versteuerung/);

  const ist = data();
  ist.settings.tax.vatMethod = 'ist';
  assert.match(doku.build(ist), /Ist-Versteuerung nach §20 UStG/);
});

test('Die Doku nennt die steuerliche Stellung', () => {
  const klein = data();
  klein.settings.tax.scheme = 'klein';
  assert.match(doku.build(klein), /Kleinunternehmer nach §19 UStG/);

  const regel = data();
  regel.settings.tax.scheme = 'regel';
  assert.match(doku.build(regel), /Steuerliche Stellung: Regelbesteuerung/);
});

test('Die Kurzfassung zählt, was im Bestand liegt', () => {
  const summary = doku.summarize(data());
  assert.equal(summary.entries, 2);
  assert.equal(summary.receipts, 1);
  assert.equal(summary.invoices, 1);
});
