'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const cii = require('../../src/export/cii');
const ubl = require('../../src/export/ubl');
const { el, document } = require('../../src/export/xml');
const { srgbProfile } = require('../../src/export/icc');

const seller = {
  name: 'Beispiel Consulting',
  owner: 'Vorname Nachname',
  street: 'Musterweg 1',
  zip: '10115',
  city: 'Berlin',
  country: 'DE',
  email: 'rechnung@beispiel.de',
  phone: '+49 30 123456',
  taxNumber: '12/345/67890',
  vatId: 'DE123456789',
  iban: 'DE02 1203 0000 0000 2020 51',
  bic: 'BYLADEM1001',
  accountHolder: 'Beispiel Consulting'
};

const buyer = {
  name: 'Kundenfirma GmbH',
  contactName: 'Frau Muster',
  street: 'Kundenallee 7',
  zip: '20095',
  city: 'Hamburg',
  country: 'DE',
  email: 'buchhaltung@kunde.de',
  vatId: 'DE987654321'
};

const invoice = {
  number: 'RE-2026-0042',
  issueDate: '2026-03-01',
  deliveryDate: '2026-02-28',
  dueDate: '2026-03-15',
  currency: 'EUR',
  buyerReference: '991-12345-67',
  payments: [],
  intro: 'Vielen Dank für den Auftrag.',
  paymentText: 'Zahlbar bis zum 15.03.2026 ohne Abzug.',
  items: [
    { name: 'Beratung', description: 'Konzeption und Umsetzung', quantity: 10, unit: 'HUR', unitPriceNet: 9000, vatRate: 19, discountPercent: 0 },
    { name: 'Fachbuch', quantity: 2, unit: 'C62', unitPriceNet: 2500, vatRate: 7, discountPercent: 0 }
  ]
};

/* ------------------------------------------------------------------ XML-Baukasten */

test('XML maskiert Sonderzeichen in Text und Attributen', () => {
  const out = document(el('a', { t: 'x"y' }, 'Meier & Söhne <GmbH>'));
  assert.ok(out.includes('Meier &amp; Söhne &lt;GmbH&gt;'));
  assert.ok(out.includes('t="x&quot;y"'));
});

/**
 * Ein leeres Element hat in einer E-Rechnung nichts zu suchen:
 * PEPPOL-EN16931-R008 verbietet es, und ein Datenfeld, das leer geblieben ist,
 * sieht genauso aus wie ein absichtlich geleertes. Deshalb fällt beides weg.
 */
test('Leere Elemente fallen weg', () => {
  const out = document(el('root', [el('leer', null), el('leerString', ''), el('voll', 'x')]));
  assert.ok(!out.includes('<leer'));
  assert.ok(!out.includes('<leerString'));
  assert.ok(out.includes('<voll>x</voll>'));
});

/**
 * Ein Validator hat genau das gemeldet: <ram:LineTwo/> stand im Dokument,
 * weil die zweite Adresszeile des Kunden leer war. PEPPOL-EN16931-R008
 * verbietet leere Elemente, und ein leeres Datenfeld darf keines erzeugen.
 */
test('Das erzeugte XML enthält kein leeres Element', () => {
  const leer = (xml) => [...xml.matchAll(/<([\w:]+)([^>]*)\/>/g)].map((m) => m[1]);

  const kunde = { ...buyer, street2: '', email: '', phone: '', contactName: '' };
  assert.deepEqual(leer(cii.build(invoice, seller, kunde, {})), []);
  assert.deepEqual(leer(ubl.build(invoice, seller, kunde, {})), []);
});

/**
 * Für die Kleinunternehmerregelung gibt es keinen VATEX-Code: die Liste deckt
 * die Befreiungen der Mehrwertsteuerrichtlinie ab, nicht die nationalen
 * Schwellenregelungen. VATEX-EU-D stand hier einmal und bedeutet den
 * innergemeinschaftlichen Erwerb eines Gebrauchtfahrzeugs.
 */
test('Der Kleinunternehmer bekommt einen Befreiungstext ohne Code', () => {
  const klein = {
    ...invoice,
    items: [{ name: 'Leistung', quantity: 1, unit: 'C62', unitPriceNet: 10000, vatRate: 0, vatKey: 'kleinunternehmer', discountPercent: 0 }]
  };
  const xml = cii.build(klein, seller, buyer, {});

  assert.ok(xml.includes('<ram:CategoryCode>E</ram:CategoryCode>'));
  assert.ok(/<ram:ExemptionReason>[^<]+<\/ram:ExemptionReason>/.test(xml), 'der Befreiungstext fehlt');
  assert.ok(!xml.includes('VATEX'), 'für §19 UStG gibt es keinen VATEX-Code');
});

/* ------------------------------------------------------------------ CII */

test('CII trägt Profil, Nummer und Dokumenttyp', () => {
  const xml = cii.build(invoice, seller, buyer);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>'));
  assert.ok(xml.includes('<ram:ID>RE-2026-0042</ram:ID>'));
  assert.ok(xml.includes('<ram:TypeCode>380</ram:TypeCode>'));
  assert.ok(xml.includes('<udt:DateTimeString format="102">20260301</udt:DateTimeString>'));
});

test('CII enthält beide Parteien mit Anschrift und Steuernummern', () => {
  const xml = cii.build(invoice, seller, buyer);
  assert.ok(xml.includes('<ram:Name>Beispiel Consulting</ram:Name>'));
  assert.ok(xml.includes('<ram:Name>Kundenfirma GmbH</ram:Name>'));
  assert.ok(xml.includes('<ram:ID schemeID="VA">DE123456789</ram:ID>'));
  assert.ok(xml.includes('<ram:ID schemeID="FC">12/345/67890</ram:ID>'), 'Steuernummer nur beim Verkäufer');
  assert.ok(xml.includes('<ram:ID schemeID="VA">DE987654321</ram:ID>'));
  assert.ok(xml.includes('<ram:CountryID>DE</ram:CountryID>'));
});

test('CII weist jede Steuergruppe getrennt aus', () => {
  const xml = cii.build(invoice, seller, buyer);
  assert.ok(xml.includes('<ram:RateApplicablePercent>19.00</ram:RateApplicablePercent>'));
  assert.ok(xml.includes('<ram:RateApplicablePercent>7.00</ram:RateApplicablePercent>'));
  assert.ok(xml.includes('<ram:BasisAmount>900.00</ram:BasisAmount>'));
  assert.ok(xml.includes('<ram:BasisAmount>50.00</ram:BasisAmount>'));
  assert.ok(xml.includes('<ram:CalculatedAmount>171.00</ram:CalculatedAmount>'));
  assert.ok(xml.includes('<ram:CalculatedAmount>3.50</ram:CalculatedAmount>'));
});

test('CII-Endsummen passen zusammen', () => {
  const xml = cii.build(invoice, seller, buyer);
  assert.ok(xml.includes('<ram:LineTotalAmount>950.00</ram:LineTotalAmount>'));
  assert.ok(xml.includes('<ram:TaxBasisTotalAmount>950.00</ram:TaxBasisTotalAmount>'));
  assert.ok(xml.includes('<ram:TaxTotalAmount currencyID="EUR">174.50</ram:TaxTotalAmount>'));
  assert.ok(xml.includes('<ram:GrandTotalAmount>1124.50</ram:GrandTotalAmount>'));
  assert.ok(xml.includes('<ram:DuePayableAmount>1124.50</ram:DuePayableAmount>'));
});

test('CII nennt die Bankverbindung ohne Leerzeichen in der IBAN', () => {
  const xml = cii.build(invoice, seller, buyer);
  assert.ok(xml.includes('<ram:IBANID>DE02120300000000202051</ram:IBANID>'));
  assert.ok(xml.includes('<ram:TypeCode>58</ram:TypeCode>'), 'SEPA-Überweisung');
});

test('CII setzt bei Reverse Charge Kategoriecode und Befreiungsgrund', () => {
  const xml = cii.build(
    { ...invoice, items: [{ name: 'Leistung', quantity: 1, unitPriceNet: 100000, vatRate: 0, vatKey: 'reverse' }] },
    seller,
    buyer
  );
  assert.ok(xml.includes('<ram:CategoryCode>AE</ram:CategoryCode>'));
  assert.ok(xml.includes('<ram:ExemptionReasonCode>VATEX-EU-AE</ram:ExemptionReasonCode>'));
  assert.ok(xml.includes('§13b'));
});

test('CII bildet einen Leistungszeitraum ab', () => {
  const xml = cii.build(
    { ...invoice, deliveryDate: null, deliveryPeriod: { from: '2026-02-01', to: '2026-02-28' } },
    seller,
    buyer
  );
  assert.ok(xml.includes('<ram:BillingSpecifiedPeriod>'));
  assert.ok(xml.includes('20260201'));
  assert.ok(xml.includes('20260228'));
});

/* ------------------------------------------------------------------ UBL */

test('XRechnung trägt die geforderte CustomizationID', () => {
  const xml = ubl.build(invoice, seller, buyer);
  assert.ok(xml.includes('urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0'));
  assert.ok(xml.includes('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>'));
});

test('XRechnung füllt die Käuferreferenz, notfalls mit der Rechnungsnummer', () => {
  assert.ok(ubl.build(invoice, seller, buyer).includes('<cbc:BuyerReference>991-12345-67</cbc:BuyerReference>'));
  const ohne = ubl.build({ ...invoice, buyerReference: '' }, seller, buyer);
  assert.ok(ohne.includes('<cbc:BuyerReference>RE-2026-0042</cbc:BuyerReference>'));
});

test('XRechnung-Summen stimmen mit den Positionen überein', () => {
  const xml = ubl.build(invoice, seller, buyer);
  assert.ok(xml.includes('<cbc:LineExtensionAmount currencyID="EUR">950.00</cbc:LineExtensionAmount>'));
  assert.ok(xml.includes('<cbc:TaxInclusiveAmount currencyID="EUR">1124.50</cbc:TaxInclusiveAmount>'));
  assert.ok(xml.includes('<cbc:PayableAmount currencyID="EUR">1124.50</cbc:PayableAmount>'));
  assert.ok(xml.includes('<cbc:TaxAmount currencyID="EUR">174.50</cbc:TaxAmount>'));
});

test('XRechnung enthält je Steuersatz ein TaxSubtotal', () => {
  const xml = ubl.build(invoice, seller, buyer);
  const subtotals = xml.match(/<cac:TaxSubtotal>/g) || [];
  assert.equal(subtotals.length, 2);
  assert.ok(xml.includes('<cbc:Percent>19.00</cbc:Percent>'));
  assert.ok(xml.includes('<cbc:Percent>7.00</cbc:Percent>'));
});

test('XRechnung listet jede Position mit Menge und Einheit', () => {
  const xml = ubl.build(invoice, seller, buyer);
  const lines = xml.match(/<cac:InvoiceLine>/g) || [];
  assert.equal(lines.length, 2);
  assert.ok(xml.includes('unitCode="HUR"'));
  assert.ok(xml.includes('unitCode="C62"'));
});

test('XRechnung nennt die Zahlungsdaten', () => {
  const xml = ubl.build(invoice, seller, buyer);
  assert.ok(xml.includes('<cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>'));
  assert.ok(xml.includes('<cbc:ID>DE02120300000000202051</cbc:ID>'));
  assert.ok(xml.includes('<cbc:ID>BYLADEM1001</cbc:ID>'));
});

/* ------------------------------------------------------------------ Farbprofil */

test('Das erzeugte sRGB-Profil ist strukturell gültig', () => {
  const profile = srgbProfile();
  assert.equal(profile.readUInt32BE(0), profile.length, 'Groessenangabe im Kopf stimmt');
  assert.equal(profile.toString('ascii', 36, 40), 'acsp', 'Dateikennung');
  assert.equal(profile.toString('ascii', 12, 16), 'mntr');
  assert.equal(profile.toString('ascii', 16, 20), 'RGB ');

  const tagCount = profile.readUInt32BE(128);
  const signatures = [];
  for (let i = 0; i < tagCount; i += 1) {
    const base = 132 + i * 12;
    const offset = profile.readUInt32BE(base + 4);
    const size = profile.readUInt32BE(base + 8);
    signatures.push(profile.toString('ascii', base, base + 4));
    assert.ok(offset % 4 === 0, 'Tags liegen auf Vierbyte-Grenzen');
    assert.ok(offset + size <= profile.length, 'kein Tag zeigt über das Profilende hinaus');
  }
  for (const required of ['desc', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC', 'cprt']) {
    assert.ok(signatures.includes(required), `Pflicht-Tag ${required} fehlt`);
  }
});
