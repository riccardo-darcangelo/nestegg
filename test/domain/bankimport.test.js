'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const csv = require('../../src/domain/csv');
const bank = require('../../src/domain/bankimport');
const { defaultSettings } = require('../../src/storage/store');

const SETTINGS = defaultSettings();

function buf(text, encoding = 'utf8') {
  return Buffer.from(text, encoding);
}

function lines(...rows) {
  return rows.join('\r\n');
}

/* ------------------------------------------------------------------ CSV */

test('Anführungszeichen schützen Trennzeichen und Umbrüche im Feld', () => {
  const rows = csv.parse('a;"b;c";"Zeile 1\nZeile 2";d', ';');
  assert.deepEqual(rows, [['a', 'b;c', 'Zeile 1\nZeile 2', 'd']]);
});

test('Zwei Anführungszeichen stehen für eines', () => {
  const rows = csv.parse('"Er sagte ""ja""";x', ';');
  assert.deepEqual(rows, [['Er sagte "ja"', 'x']]);
});

test('Das Trennzeichen wird geraten, auch wenn Kommas im Text stehen', () => {
  const text = lines(
    'Buchungstag;Verwendungszweck;Betrag',
    '01.02.2026;Miete, Nebenkosten, Strom;-500,00',
    '02.02.2026;Rechnung, bezahlt;100,00'
  );
  assert.equal(csv.guessDelimiter(text), ';');
});

test('Komma als Trennzeichen wird ebenso erkannt', () => {
  const text = lines('date,description,amount', '2026-02-01,Hosting,-19.99', '2026-02-02,Payout,250.00');
  assert.equal(csv.guessDelimiter(text), ',');
});

test('Windows-1252 wird erkannt und nicht als UTF-8 zerlegt', () => {
  const { text, encoding } = csv.decode(buf('Müller GmbH;Gebühr;Straße', 'latin1'));
  assert.equal(encoding, 'windows-1252');
  assert.ok(text.includes('Müller GmbH'));
  assert.ok(text.includes('Straße'));
});

test('Eine UTF-8-Datei mit Byte-Order-Mark verliert die Marke', () => {
  const { text, encoding } = csv.decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf('Buchungstag;Betrag')]));
  assert.equal(encoding, 'utf-8');
  assert.equal(text, 'Buchungstag;Betrag');
});

/* ------------------------------------------------------------------ Spalten */

test('Die Kopfzeile wird auch unter einem Vorspann gefunden', () => {
  const file = lines(
    'Umsätze Girokonto;;;',
    'Kontonummer;DE02 1203 0000 0000 2020 51;;',
    'Zeitraum;01.01.2026 - 31.05.2026;;',
    '',
    'Buchungstag;Verwendungszweck;Beguenstigter/Zahlungspflichtiger;Betrag;Waehrung',
    '12.05.2026;Beitrag;Versicherung AG;-120,00;EUR'
  );
  const result = bank.readStatement(buf(file));
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].counterparty, 'Versicherung AG');
});

test('Ohne Kopfzeile sagt die App das, statt etwas zu erfinden', () => {
  const result = bank.readStatement(buf(lines('Hallo;Welt', 'eins;zwei')));
  assert.equal(result.transactions.length, 0);
  assert.match(result.warnings[0], /keine Kopfzeile/);
});

test('Getrennte Spalten für Soll und Haben ergeben ein Vorzeichen', () => {
  const file = lines(
    'Datum;Verwendungszweck;Soll;Haben',
    '03.03.2026;Büromaterial;48,90;',
    '04.03.2026;Zahlungseingang;;1.200,00'
  );
  const { transactions } = bank.readStatement(buf(file));
  assert.equal(transactions[0].amount, -4890);
  assert.equal(transactions[1].amount, 120000);
});

test('Ein Soll-Haben-Kennzeichen kehrt das Vorzeichen um', () => {
  const file = lines(
    'Buchungstag;Verwendungszweck;Umsatz;Soll/Haben-Kennzeichen',
    '05.03.2026;Lastschrift;99,00;S',
    '06.03.2026;Gutschrift;99,00;H'
  );
  const { transactions } = bank.readStatement(buf(file));
  assert.equal(transactions[0].amount, -9900);
  assert.equal(transactions[1].amount, 9900);
});

test('Zeilen ohne Datum oder Betrag sind keine Umsätze', () => {
  const file = lines(
    'Buchungstag;Verwendungszweck;Betrag',
    '01.04.2026;Umsatz;-10,00',
    ';Anfangssaldo;',
    ';;0,00'
  );
  const { transactions } = bank.readStatement(buf(file));
  assert.equal(transactions.length, 1);
});

test('Datumsformate: deutsch, kurz, international', () => {
  assert.equal(bank.parseDate('31.12.2026'), '2026-12-31');
  assert.equal(bank.parseDate('01.02.26'), '2026-02-01');
  assert.equal(bank.parseDate('2026-07-04'), '2026-07-04');
  assert.equal(bank.parseDate('4.7.2026'), '2026-07-04');
  assert.equal(bank.parseDate(''), null);
  assert.equal(bank.parseDate('32.13.2026'), null);
});

/* ------------------------------------------------------------------ Doppelte */

test('Dieselbe Zeile zweimal ergibt denselben Fingerabdruck', () => {
  const file = lines('Buchungstag;Verwendungszweck;Betrag', '01.05.2026;Hosting;-19,99');
  const first = bank.readStatement(buf(file)).transactions[0];
  const second = bank.readStatement(buf(file)).transactions[0];
  assert.equal(first.ref, second.ref);
});

test('Zwei gleiche Buchungen am selben Tag bleiben zwei Buchungen', () => {
  const file = lines(
    'Buchungstag;Verwendungszweck;Betrag',
    '01.05.2026;Tanken;-60,00',
    '01.05.2026;Tanken;-60,00'
  );
  const { transactions } = bank.readStatement(buf(file));
  assert.equal(transactions.length, 2);
  assert.notEqual(transactions[0].ref, transactions[1].ref, 'sonst verschwände die zweite als Doppelte');
});

test('Was schon gebucht ist, wird als vorhanden erkannt', () => {
  const file = lines('Buchungstag;Verwendungszweck;Betrag', '01.05.2026;Hosting;-19,99');
  const { transactions } = bank.readStatement(buf(file));

  const data = {
    settings: SETTINGS,
    entries: [{ id: 'b1', type: 'expense', counterparty: 'x', categoryId: 'exp_other', bankRef: transactions[0].ref }],
    invoices: [],
    customers: []
  };

  const rows = bank.plan(transactions, data, '2026-06-01');
  assert.equal(rows[0].duplicate, true);
  assert.equal(rows[0].action, 'skip');
  assert.equal(rows[0].selected, false);
});

test('Eine bereits verbuchte Rechnungszahlung zählt ebenfalls als vorhanden', () => {
  const file = lines('Buchungstag;Verwendungszweck;Betrag', '01.05.2026;Zahlung;1.000,00');
  const { transactions } = bank.readStatement(buf(file));

  const data = {
    settings: SETTINGS,
    entries: [],
    invoices: [{ id: 're1', payments: [{ date: '2026-05-01', amount: 100000, bankRef: transactions[0].ref }] }],
    customers: []
  };

  assert.equal(bank.plan(transactions, data, '2026-06-01')[0].duplicate, true);
});

/* ------------------------------------------------------------------ Rechnungen */

function invoice(overrides = {}) {
  return {
    id: 're_1',
    number: 'RE-2026-0004',
    documentType: 'invoice',
    status: 'sent',
    customerId: 'kd_1',
    issueDate: '2026-04-01',
    dueDate: '2026-04-15',
    items: [{ name: 'Leistung', quantity: 1, unit: 'LS', unitPriceNet: 96000, vatRate: 19 }],
    payments: [],
    ...overrides
  };
}

const CUSTOMERS = [{ id: 'kd_1', name: 'Kundenfirma GmbH' }];

test('Die Rechnungsnummer im Verwendungszweck führt zur Rechnung', () => {
  const tx = { amount: 114240, purpose: 'Zahlung RE-2026-0004 vielen Dank', counterparty: 'Kundenfirma GmbH' };
  const match = bank.matchInvoice(tx, [invoice()], CUSTOMERS, '2026-05-01');
  assert.equal(match.invoiceId, 're_1');
  assert.equal(match.confidence, 'sicher');
});

test('Auch ohne Bindestriche wird die Nummer erkannt', () => {
  const tx = { amount: 114240, purpose: 'RE 2026 0004', counterparty: '' };
  assert.ok(bank.matchInvoice(tx, [invoice()], CUSTOMERS, '2026-05-01'));
});

test('Ein abweichender Betrag zur richtigen Nummer wird gekennzeichnet', () => {
  const tx = { amount: 50000, purpose: 'Teilzahlung RE-2026-0004', counterparty: '' };
  const match = bank.matchInvoice(tx, [invoice()], CUSTOMERS, '2026-05-01');
  assert.equal(match.confidence, 'nummer');
  assert.equal(match.exact, false);
});

test('Ohne Nummer reicht ein eindeutiger Betrag als Hinweis', () => {
  const tx = { amount: 114240, purpose: 'Ueberweisung', counterparty: 'Kundenfirma GmbH' };
  const match = bank.matchInvoice(tx, [invoice()], CUSTOMERS, '2026-05-01');
  assert.equal(match.invoiceId, 're_1');
  assert.equal(match.confidence, 'sicher', 'Betrag und Name zusammen sind belastbar');
});

test('Passt der Betrag auf zwei offene Rechnungen, wird nichts zugeordnet', () => {
  const zwilling = invoice({ id: 're_2', number: 'RE-2026-0005' });
  const tx = { amount: 114240, purpose: 'Ueberweisung', counterparty: 'Irgendwer' };
  assert.equal(bank.matchInvoice(tx, [invoice(), zwilling], CUSTOMERS, '2026-05-01'), null);
});

test('Eine Ausgabe wird nie einer Ausgangsrechnung zugeordnet', () => {
  const tx = { amount: -114240, purpose: 'RE-2026-0004', counterparty: '' };
  assert.equal(bank.matchInvoice(tx, [invoice()], CUSTOMERS, '2026-05-01'), null);
});

test('Bezahlte Rechnungen kommen für eine Zuordnung nicht mehr in Frage', () => {
  const bezahlt = invoice({ payments: [{ date: '2026-04-20', amount: 114240 }] });
  const tx = { amount: 114240, purpose: 'RE-2026-0004', counterparty: '' };
  assert.equal(bank.matchInvoice(tx, [bezahlt], CUSTOMERS, '2026-05-01'), null);
});

/* ------------------------------------------------------------------ Vorschlag */

function data(overrides = {}) {
  return { settings: SETTINGS, entries: [], invoices: [], customers: [], ...overrides };
}

test('Das Vorzeichen entscheidet über Einnahme und Ausgabe', () => {
  const ausgabe = bank.suggestCategory({ amount: -1000, counterparty: 'Unbekannt', purpose: '' }, data());
  const einnahme = bank.suggestCategory({ amount: 1000, counterparty: 'Unbekannt', purpose: '' }, data());
  assert.equal(ausgabe.type, 'expense');
  assert.equal(einnahme.type, 'income');
});

test('Eine eigene Regel schlägt alles andere', () => {
  const settings = { ...SETTINGS, bankRules: [{ match: 'Hetzner', categoryId: 'exp_it', type: 'expense' }] };
  const result = bank.suggestCategory(
    { amount: -2380, counterparty: 'HETZNER ONLINE GMBH', purpose: 'Rechnung' },
    data({ settings })
  );
  assert.equal(result.categoryId, 'exp_it');
  assert.equal(result.source, 'rule');
});

test('Ohne Regel lernt die App aus früheren Buchungen derselben Gegenpartei', () => {
  const entries = [
    { type: 'expense', counterparty: 'Hetzner Online GmbH', categoryId: 'exp_it', segmentId: 'seg_a', updatedAt: '2026-01-01' },
    { type: 'expense', counterparty: 'Hetzner Online GmbH', categoryId: 'exp_it', segmentId: 'seg_a', updatedAt: '2026-02-01' },
    { type: 'expense', counterparty: 'Telekom', categoryId: 'exp_phone', updatedAt: '2026-02-01' }
  ];
  const result = bank.suggestCategory(
    { amount: -2380, counterparty: 'HETZNER ONLINE GMBH', purpose: 'Rechnung R123' },
    data({ entries })
  );
  assert.equal(result.categoryId, 'exp_it');
  assert.equal(result.segmentId, 'seg_a');
  assert.equal(result.source, 'history');
  assert.match(result.reason, /2 frühere Buchungen/);
});

test('Eine unbekannte Gegenpartei bekommt die Vorgabe mit Hinweis', () => {
  const result = bank.suggestCategory({ amount: -500, counterparty: 'Neuer Laden', purpose: '' }, data());
  assert.equal(result.categoryId, 'exp_other');
  assert.equal(result.source, 'default');
  assert.match(result.reason, /prüfen/);
});

/* ------------------------------------------------------------------ Plan */

test('Der Plan trennt Zahlungen, Buchungen und Doppelte', () => {
  const file = lines(
    'Buchungstag;Verwendungszweck;Beguenstigter/Zahlungspflichtiger;Betrag',
    '20.04.2026;Zahlung RE-2026-0004;Kundenfirma GmbH;1.142,40',
    '21.04.2026;Serverkosten;Hetzner Online GmbH;-23,80'
  );
  const { transactions } = bank.readStatement(buf(file));
  const rows = bank.plan(transactions, data({ invoices: [invoice()], customers: CUSTOMERS }), '2026-05-01');

  assert.equal(rows[0].action, 'payment');
  assert.equal(rows[0].draft.invoiceId, 're_1');
  assert.equal(rows[1].action, 'entry');
  assert.equal(rows[1].draft.type, 'expense');

  const summary = bank.summarize(rows);
  assert.equal(summary.total, 2);
  assert.equal(summary.payments, 1);
  assert.equal(summary.entries, 1);
  assert.equal(summary.income, 114240);
  assert.equal(summary.expense, -2380);
  assert.equal(summary.from, '2026-04-20');
  assert.equal(summary.to, '2026-04-21');
});

test('Aus einer Zeile wird eine Buchung mit Brutto und Herkunft', () => {
  const file = lines('Buchungstag;Verwendungszweck;Beguenstigter/Zahlungspflichtiger;Betrag',
    '21.04.2026;Serverkosten Mai;Hetzner Online GmbH;-23,80');
  const { transactions } = bank.readStatement(buf(file));
  const row = bank.plan(transactions, data(), '2026-05-01')[0];
  const entry = bank.toEntry(row, { categoryId: 'exp_it' });

  assert.equal(entry.type, 'expense');
  assert.equal(entry.amount, 2380, 'der Betrag wird positiv geführt, die Art macht das Vorzeichen');
  assert.equal(entry.basis, 'gross');
  assert.equal(entry.date, '2026-04-21');
  assert.equal(entry.paidDate, '2026-04-21', 'die Bankzeile ist der Zahlungsnachweis');
  assert.equal(entry.paymentMethod, 'bank');
  assert.equal(entry.bankRef, row.ref);
  assert.equal(entry.counterparty, 'Hetzner Online GmbH');
});

test('Aus einer bestätigten Zuordnung wird eine Regel für das nächste Mal', () => {
  const row = {
    counterparty: 'HETZNER ONLINE GMBH',
    purpose: 'Rechnung',
    draft: { type: 'expense', categoryId: 'exp_it', segmentId: null, counterparty: 'Hetzner Online GmbH' }
  };
  const rule = bank.ruleFrom(row, {});
  assert.equal(rule.match, 'HETZNER ONLINE GMBH');
  assert.equal(rule.categoryId, 'exp_it');
  assert.equal(rule.counterparty, 'Hetzner Online GmbH');
});

test('Fremde Währungen werden übernommen, aber angesagt', () => {
  const file = lines(
    'Buchungstag;Verwendungszweck;Betrag;Waehrung',
    '01.05.2026;Stripe Payout;250,00;USD'
  );
  const result = bank.readStatement(buf(file));
  assert.equal(result.transactions[0].currency, 'USD');
  assert.match(result.warnings.join(' '), /nicht auf Euro/);
});
