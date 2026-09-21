'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const xml = require('../../src/import/xmlread');
const einvoice = require('../../src/import/einvoice');
const cii = require('../../src/export/cii');
const ubl = require('../../src/export/ubl');

/* ------------------------------------------------------------------ Parser */

test('Namensräume werden abgeschnitten, Attribute bleiben', () => {
  const root = xml.parse('<rsm:Invoice xmlns:rsm="x"><ram:ID schemeID="VA">DE123</ram:ID></rsm:Invoice>');
  assert.equal(root.name, 'Invoice');
  assert.equal(xml.text(root, 'ID'), 'DE123');
  assert.equal(root.child('ID').attrs.schemeID, 'VA');
});

test('Entities und CDATA werden aufgelöst', () => {
  const root = xml.parse('<a><b>M&#252;ller &amp; S&#246;hne</b><c><![CDATA[<roh> & frei]]></c></a>');
  assert.equal(xml.text(root, 'b'), 'Müller & Söhne');
  assert.equal(xml.text(root, 'c'), '<roh> & frei');
});

test('Leere Elemente und Kommentare stören nicht', () => {
  const root = xml.parse('<a><!-- Hinweis --><b/><c>1</c></a>');
  assert.equal(root.children.length, 2);
  assert.equal(xml.text(root, 'c'), '1');
});

test('Ein Punkt im XML ist immer das Dezimaltrennzeichen', () => {
  const root = xml.parse('<a><x>1.000</x><y>1234.56</y><z>1000</z></a>');
  // Die Eingabe-Heuristik aus money.js läse hier tausend. Im XML ist es eins.
  assert.equal(xml.amount(root, 'x'), 100);
  assert.equal(xml.amount(root, 'y'), 123456);
  assert.equal(xml.amount(root, 'z'), 100000);
});

test('findAll findet alle Wiederholungen, find nur die erste', () => {
  const root = xml.parse('<a><p><n>1</n></p><p><n>2</n></p></a>');
  assert.equal(xml.findAll(root, 'p/n').length, 2);
  assert.equal(xml.text(root, 'p/n'), '1');
});

/* ------------------------------------------------------------------ Rundlauf */

const COMPANY = {
  name: 'Beispiel Consulting', owner: 'Vorname Nachname', street: 'Musterweg 12',
  zip: '10115', city: 'Berlin', country: 'DE', email: 'rechnung@beispiel.de',
  taxNumber: '12/345/67890', vatId: 'DE123456789',
  bankName: 'Beispielbank', iban: 'DE02120300000000202051', bic: 'BYLADEM1001'
};

const CUSTOMER = {
  name: 'Kundenfirma GmbH', street: 'Kundenallee 7', zip: '20095', city: 'Hamburg',
  country: 'DE', email: 'buchhaltung@kunde.de', vatId: 'DE987654321', customerNumber: 'K-001'
};

function invoice(overrides = {}) {
  return {
    number: 'RE-2026-0042',
    issueDate: '2026-03-01',
    deliveryDate: '2026-02-28',
    dueDate: '2026-03-15',
    currency: 'EUR',
    payments: [],
    items: [
      { name: 'Beratung', description: 'Workshop', quantity: 10, unit: 'HUR', unitPriceNet: 12000, vatRate: 19 },
      { name: 'Fachliteratur', quantity: 2, unit: 'C62', unitPriceNet: 2500, vatRate: 7 }
    ],
    ...overrides
  };
}

test('Eine selbst erzeugte ZUGFeRD-Rechnung liest sich vollständig zurück', async () => {
  const doc = invoice();
  const result = await einvoice.read(Buffer.from(cii.build(doc, COMPANY, CUSTOMER), 'utf8'), 'factur-x.xml');
  assert.ok(!result.error, result.error);

  const read = result.invoice;
  assert.equal(read.flavour, 'cii');
  assert.equal(read.number, 'RE-2026-0042');
  assert.equal(read.issueDate, '2026-03-01');
  assert.equal(read.dueDate, '2026-03-15');
  assert.equal(read.seller.name, 'Beispiel Consulting');
  assert.equal(read.seller.vatId, 'DE123456789');
  assert.equal(read.buyer.name, 'Kundenfirma GmbH');
  assert.equal(read.currency, 'EUR');

  // 10 x 120,00 zu 19 Prozent, 2 x 25,00 zu 7 Prozent
  assert.equal(read.netTotal, 125000);
  assert.equal(read.vatTotal, 22800 + 350);
  assert.equal(read.grossTotal, 125000 + 23150);
  assert.equal(read.taxes.length, 2, 'zwei Steuergruppen');
  assert.equal(read.lines.length, 2);
  assert.equal(read.lines[0].name, 'Beratung');
});

test('Auch eine XRechnung liest sich zurück', async () => {
  const doc = invoice();
  const result = await einvoice.read(Buffer.from(ubl.build(doc, COMPANY, CUSTOMER), 'utf8'), 'xrechnung.xml');
  assert.ok(!result.error, result.error);

  const read = result.invoice;
  assert.equal(read.flavour, 'ubl');
  assert.equal(read.number, 'RE-2026-0042');
  assert.equal(read.issueDate, '2026-03-01');
  assert.equal(read.seller.name, 'Beispiel Consulting');
  assert.equal(read.seller.vatId, 'DE123456789');
  assert.equal(read.grossTotal, 148150);
  assert.equal(read.payable, 148150);
  assert.equal(read.lines.length, 2);
});

test('Ein Datum im Format 102 wird zu einem ISO-Datum', () => {
  assert.equal(einvoice.ciiDate('20260317'), '2026-03-17');
  assert.equal(einvoice.ciiDate('2026-03-17T00:00:00'), '2026-03-17');
  assert.equal(einvoice.ciiDate(''), null);
});

/* ------------------------------------------------------------------ Prüfung */

test('Fehlende Pflichtangaben werden benannt', async () => {
  const doc = invoice({ number: '' });
  const result = await einvoice.read(Buffer.from(cii.build(doc, { ...COMPANY, vatId: '', taxNumber: '' }, CUSTOMER), 'utf8'), 'x.xml');

  const text = result.warnings.join(' ');
  assert.match(text, /keine Rechnungsnummer/);
  assert.match(text, /weder Steuernummer noch USt-IdNr/);
});

test('Reverse Charge wird erkannt und nicht als Vorsteuer behandelt', async () => {
  const doc = invoice({
    items: [{ name: 'Lizenz', quantity: 1, unit: 'C62', unitPriceNet: 50000, vatRate: 0, vatKey: 'eu_service' }],
    reverseCharge: true
  });
  const result = await einvoice.read(Buffer.from(cii.build(doc, COMPANY, { ...CUSTOMER, country: 'AT', vatId: 'ATU12345678' }), 'utf8'), 'x.xml');
  assert.ok(!result.error, result.error);

  assert.match(result.warnings.join(' '), /Reverse Charge/);

  const entry = einvoice.toEntry(result.invoice, {});
  assert.equal(entry.reverseCharge, true);
  assert.equal(entry.amount, 50000, 'der Rechnungsbetrag ist das Netto');
});

test('Aus der Rechnung wird eine Ausgabenbuchung mit Rechnungsdatum', async () => {
  const result = await einvoice.read(Buffer.from(cii.build(invoice(), COMPANY, CUSTOMER), 'utf8'), 'x.xml');
  const entry = einvoice.toEntry(result.invoice, { categoryId: 'exp_it' });

  assert.equal(entry.type, 'expense');
  assert.equal(entry.date, '2026-03-01', 'das Rechnungsdatum steuert den Vorsteuerabzug');
  assert.equal(entry.paidDate, null, 'gezahlt ist noch nichts');
  assert.equal(entry.amount, 148150);
  assert.equal(entry.basis, 'gross');
  assert.equal(entry.vatRate, 19, 'der Satz der größten Steuergruppe');
  assert.equal(entry.counterparty, 'Beispiel Consulting');
  assert.equal(entry.counterpartyVatId, 'DE123456789');
});

test('Dieselbe Rechnung zweimal fällt auf', async () => {
  const result = await einvoice.read(Buffer.from(cii.build(invoice(), COMPANY, CUSTOMER), 'utf8'), 'x.xml');
  const entry = einvoice.toEntry(result.invoice, {});

  assert.ok(einvoice.findExisting(result.invoice, [entry]));
  assert.equal(einvoice.findExisting(result.invoice, [{ eInvoiceRef: 'anders|1' }]), null);
});

/* ------------------------------------------------------------------ Formate */

test('Das Format wird am Inhalt erkannt, nicht an der Endung', () => {
  assert.equal(einvoice.sniff(Buffer.from('%PDF-1.7\n...')), 'pdf');
  assert.equal(einvoice.sniff(Buffer.from('<?xml version="1.0"?><rsm:CrossIndustryInvoice>')), 'cii');
  assert.equal(einvoice.sniff(Buffer.from('<?xml version="1.0"?><ubl:Invoice xmlns=""><a/>')), 'ubl');
  assert.equal(einvoice.sniff(Buffer.from('Hallo Welt')), null);
});

test('Ein PDF ohne XML wird als Sichtbeleg erkannt, nicht als E-Rechnung', async () => {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage();
  const bytes = await doc.save();

  const result = await einvoice.read(Buffer.from(bytes), 'rechnung.pdf');
  assert.match(result.error, /kein Rechnungs-XML/);
});

test('Aus einem ZUGFeRD-PDF wird das eingebettete XML geholt', async () => {
  const { PDFDocument } = require('pdf-lib');
  const pdfa = require('../../src/export/pdfa');

  const doc = await PDFDocument.create();
  doc.addPage();
  const plain = await doc.save();

  const xmlText = cii.build(invoice(), COMPANY, CUSTOMER);
  const zugferd = await pdfa.embedInvoiceXml(plain, xmlText, {
    title: 'Rechnung RE-2026-0042', author: COMPANY.name, subject: 'Rechnung'
  });

  const result = await einvoice.read(Buffer.from(zugferd), 'rechnung.pdf');
  assert.ok(!result.error, result.error);
  assert.equal(result.invoice.source, 'zugferd');
  assert.equal(result.invoice.number, 'RE-2026-0042');
  assert.equal(result.invoice.grossTotal, 148150);
});
