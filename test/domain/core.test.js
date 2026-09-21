'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const money = require('../../src/domain/money');
const tax = require('../../src/domain/tax');
const entries = require('../../src/domain/entries');
const euer = require('../../src/domain/euer');
const vat = require('../../src/domain/vat');
const assets = require('../../src/domain/assets');
const invoices = require('../../src/domain/invoices');

/* ------------------------------------------------------------------ Geld */

test('Betragseingabe: deutsche und englische Schreibweise', () => {
  assert.equal(money.parseAmount('1.234,56'), 123456);
  assert.equal(money.parseAmount('1,234.56'), 123456);
  assert.equal(money.parseAmount('1234,56'), 123456);
  assert.equal(money.parseAmount('1234.56'), 123456);
  assert.equal(money.parseAmount('19'), 1900);
  assert.equal(money.parseAmount('-12,50'), -1250);
  assert.equal(money.parseAmount('89,90 €'), 8990);
  assert.equal(money.parseAmount(''), 0);
  assert.equal(money.parseAmount('quatsch'), 0);
});

test('Betragseingabe: Tausendergruppen ohne Dezimalteil', () => {
  assert.equal(money.parseAmount('1,000'), 100000);
  assert.equal(money.parseAmount('1.000'), 100000);
});

/* ------------------------------------------------------------------ Steuer */

test('Brutto wird verlustfrei in Netto und Steuer zerlegt', () => {
  for (const gross of [107, 119, 1, 999, 100000, 123457]) {
    for (const rate of [7, 19]) {
      const split = tax.splitGross(gross, rate);
      assert.equal(split.net + split.vat, gross, `${gross} bei ${rate}%`);
    }
  }
});

test('Netto zu Brutto und zurück bleibt stabil', () => {
  const up = tax.grossFromNet(10000, 19);
  assert.deepEqual(up, { gross: 11900, net: 10000, vat: 1900 });
  const down = tax.splitGross(up.gross, 19);
  assert.equal(down.net, 10000);
});

test('Steuerfreie Umsätze erzeugen keine Steuer', () => {
  const split = tax.splitGross(5000, 0);
  assert.equal(split.vat, 0);
  assert.equal(split.net, 5000);
});

/* ------------------------------------------------------------------ Buchung */

function entry(overrides) {
  return entries.normalizeEntry({
    type: 'expense',
    date: '2026-03-10',
    paidDate: '2026-03-12',
    amount: 11900,
    categoryId: 'exp_office',
    description: 'Test',
    ...overrides
  });
}

test('Buchung rechnet Netto und Steuer aus dem Bruttobetrag', () => {
  const e = entry({});
  assert.equal(e.net, 10000);
  assert.equal(e.vat, 1900);
  assert.equal(e.gross, 11900);
});

test('Buchung nimmt den Betrag auch als getippten Text', () => {
  const e = entry({ amount: '119,00' });
  assert.equal(e.gross, 11900);
});

test('Bewirtung: 70 Prozent Betriebsausgabe, volle Vorsteuer', () => {
  const e = entry({ categoryId: 'exp_entertainment', amount: 11900 });
  const effect = entries.taxEffect(e);
  assert.equal(effect.inputVat, 1900, 'Vorsteuer bleibt voll abziehbar');
  assert.equal(effect.euerAmount, 7000, '70 Prozent von 100 Euro netto');
});

test('Privatanteil kürzt Ausgabe und Vorsteuer gleichermaßen', () => {
  const e = entry({ amount: 11900, privateSharePercent: 40 });
  const effect = entries.taxEffect(e);
  assert.equal(effect.businessNet, 6000);
  assert.equal(effect.inputVat, 1140);
});

test('Kategorien ohne Vorsteuerabzug liefern keine Vorsteuer', () => {
  const e = entry({ categoryId: 'exp_insurance', amount: 5000, vatRate: 0 });
  assert.equal(entries.taxEffect(e).inputVat, 0);
});

test('Buchung ohne Zahlungsdatum gilt als offen', () => {
  const e = entry({ paidDate: null });
  assert.equal(e.paidDate, null);
  assert.equal(euer.taxYearOf(e), null);
  assert.ok(entries.warningsFor(e).some((w) => w.includes('offen')));
});

test('Prüfung meldet fehlenden Zweck und Nullbetrag', () => {
  const errors = entries.validateEntry(entry({ description: '', amount: 0 }));
  assert.ok(errors.length >= 2);
});

/* ------------------------------------------------------------------ EÜR */

test('EÜR zählt nur bezahlte Buchungen und trennt die Umsatzsteuer ab', () => {
  const list = [
    entry({ type: 'income', categoryId: 'inc_services', amount: 11900, paidDate: '2026-05-02' }),
    entry({ categoryId: 'exp_office', amount: 2380, paidDate: '2026-05-10' }),
    entry({ categoryId: 'exp_office', amount: 5000, paidDate: null })
  ];
  const result = euer.calculate(list, [], 2026);

  assert.equal(result.collectedVat, 1900);
  assert.equal(result.paidInputVat, 380);
  assert.equal(result.incomeTotal, 10000 + 1900);
  assert.equal(result.expenseTotal, 2000 + 380);
  assert.equal(result.profit, 11900 - 2380);
  assert.equal(result.open.expense, 5000, 'die unbezahlte Ausgabe bleibt draußen');
});

test('EÜR ordnet nach Zahlungsjahr, nicht nach Rechnungsdatum', () => {
  const list = [entry({ type: 'income', categoryId: 'inc_services', date: '2025-12-20', paidDate: '2026-01-08', amount: 11900 })];
  assert.equal(euer.calculate(list, [], 2025).incomeTotal, 0);
  assert.equal(euer.calculate(list, [], 2026).incomeTotal, 11900);
});

test('Zehn-Tage-Regel lässt sich über das abweichende Steuerjahr abbilden', () => {
  const list = [entry({ categoryId: 'exp_rent', paidDate: '2026-01-05', taxYearOverride: 2025, amount: 11900 })];
  assert.equal(euer.calculate(list, [], 2025).expenseTotal, 11900);
  assert.equal(euer.calculate(list, [], 2026).expenseTotal, 0);
});

test('Anschaffung eines Anlageguts wirkt nur über die Abschreibung', () => {
  const purchase = entry({ categoryId: 'exp_other', amount: 238000, paidDate: '2026-01-15', assetId: 'anl_1' });
  const asset = assets.normalizeAsset({
    id: 'anl_1', label: 'Notebook', purchaseDate: '2026-01-15', netCents: 200000, usefulLifeYears: 3
  });
  const result = euer.calculate([purchase], [asset], 2026);

  const positions = Object.fromEntries(result.expense.map((r) => [r.position, r.amount]));
  assert.equal(positions['Übrige unbeschränkt abziehbare Betriebsausgaben'], undefined);
  assert.ok(positions['Absetzung für Abnutzung'] > 0);
  assert.equal(positions['Gezahlte Vorsteuerbeträge'], 38000, 'die Vorsteuer wirkt sofort');
});

/* ------------------------------------------------------------------ AfA */

test('Abschreibung startet im Anschaffungsmonat und schreibt vollständig ab', () => {
  const asset = assets.normalizeAsset({
    label: 'Notebook', purchaseDate: '2026-07-01', netCents: 120000, usefulLifeYears: 3
  });
  const plan = assets.schedule(asset);

  assert.equal(plan[0].year, 2026);
  assert.equal(plan[0].amount, 20000, 'sechs von zwölf Monaten eines Jahresbetrags von 400 Euro');
  assert.equal(plan.reduce((s, r) => s + r.amount, 0), 120000, 'am Ende ist alles abgeschrieben');
  assert.equal(plan[plan.length - 1].bookValueEnd, 0);
});

test('Abschreibung im Januar verteilt sich auf volle Jahre', () => {
  const asset = assets.normalizeAsset({
    label: 'Maschine', purchaseDate: '2026-01-10', netCents: 90000, usefulLifeYears: 3
  });
  const plan = assets.schedule(asset);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((r) => r.amount), [30000, 30000, 30000]);
});

/* ------------------------------------------------------------------ Umsatzsteuer */

const istSettings = { tax: { vatMethod: 'ist', inputVatBasis: 'invoice', vatPeriod: 'quarterly' } };

test('Ist-Versteuerung: der Umsatz zählt im Zeitraum der Zahlung', () => {
  const list = [entry({ type: 'income', categoryId: 'inc_services', date: '2026-03-28', paidDate: '2026-04-05', amount: 11900 })];

  const q1 = vat.calculate(list, istSettings, { from: '2026-01-01', to: '2026-03-31' });
  const q2 = vat.calculate(list, istSettings, { from: '2026-04-01', to: '2026-06-30' });

  assert.equal(q1.outputVat, 0);
  assert.equal(q2.kz['81'], 10000);
  assert.equal(q2.outputVat, 1900);
});

test('Soll-Versteuerung: der Umsatz zählt im Zeitraum der Rechnung', () => {
  const sollSettings = { tax: { vatMethod: 'soll', inputVatBasis: 'invoice', vatPeriod: 'quarterly' } };
  const list = [entry({ type: 'income', categoryId: 'inc_services', date: '2026-03-28', paidDate: '2026-04-05', amount: 11900 })];

  const q1 = vat.calculate(list, sollSettings, { from: '2026-01-01', to: '2026-03-31' });
  assert.equal(q1.outputVat, 1900);
});

test('Vorsteuer hängt am Rechnungsdatum, nicht an der Zahlung', () => {
  const list = [entry({ date: '2026-03-20', paidDate: '2026-05-02', amount: 11900 })];
  const q1 = vat.calculate(list, istSettings, { from: '2026-01-01', to: '2026-03-31' });
  assert.equal(q1.kz['66'], 1900);
});

test('Reverse Charge als Empfänger: Steuer geschuldet und zugleich abziehbar', () => {
  const list = [entry({ date: '2026-02-10', paidDate: '2026-02-10', amount: 10000, vatRate: 19, reverseCharge: true })];
  const q1 = vat.calculate(list, istSettings, { from: '2026-01-01', to: '2026-03-31' });

  assert.equal(q1.kz['46'], 10000);
  assert.equal(q1.kz['47'], 1900);
  assert.equal(q1.kz['67'], 1900);
  assert.equal(q1.payable, 0, 'unterm Strich ein Nullsummenspiel');
});

test('Innergemeinschaftliche Lieferung landet in Kennzahl 41 ohne Steuer', () => {
  const list = [entry({
    type: 'income', categoryId: 'inc_eu', vatRate: 0, vatKey: 'igl',
    date: '2026-02-01', paidDate: '2026-02-01', amount: 50000
  })];
  const q1 = vat.calculate(list, istSettings, { from: '2026-01-01', to: '2026-03-31' });
  assert.equal(q1.kz['41'], 50000);
  assert.equal(q1.outputVat, 0);
});

test('Zahlungen an das Finanzamt sind selbst kein Umsatz', () => {
  const list = [entry({ categoryId: 'exp_vat_payment', amount: 50000, vatRate: 0, paidDate: '2026-02-10' })];
  const q1 = vat.calculate(list, istSettings, { from: '2026-01-01', to: '2026-03-31' });
  assert.equal(q1.inputVat, 0);
  assert.equal(q1.outputVat, 0);
});

test('Abgabefristen: zehnter Folgetag, verschoben über das Wochenende', () => {
  const quarters = vat.periodsOf(2026, 'quarterly', false);
  assert.equal(quarters.length, 4);
  assert.equal(quarters[0].from, '2026-01-01');
  assert.equal(quarters[0].to, '2026-03-31');
  assert.ok(quarters[0].dueDate.startsWith('2026-04-1'));

  const withExtension = vat.periodsOf(2026, 'quarterly', true);
  assert.ok(withExtension[0].dueDate > quarters[0].dueDate, 'Dauerfristverlängerung schiebt nach hinten');
});

test('Monatszeiträume decken das ganze Jahr ab', () => {
  const months = vat.periodsOf(2026, 'monthly', false);
  assert.equal(months.length, 12);
  assert.equal(months[1].to, '2026-02-28');
  assert.equal(vat.periodsOf(2028, 'monthly', false)[1].to, '2028-02-29', 'Schaltjahr');
});

/* ------------------------------------------------------------------ Rechnung */

function invoice(overrides) {
  return {
    number: 'RE-2026-0001',
    issueDate: '2026-03-01',
    deliveryDate: '2026-02-28',
    dueDate: '2026-03-15',
    currency: 'EUR',
    payments: [],
    items: [
      { name: 'Beratung', quantity: 10, unit: 'HUR', unitPriceNet: 9000, vatRate: 19, discountPercent: 0 }
    ],
    ...overrides
  };
}

test('Rechnungssummen: Position, Steuer und Endbetrag', () => {
  const t = invoices.totals(invoice({}));
  assert.equal(t.netTotal, 90000);
  assert.equal(t.vatTotal, 17100);
  assert.equal(t.grossTotal, 107100);
});

test('Mehrere Steuersätze werden getrennt ausgewiesen', () => {
  const t = invoices.totals(invoice({
    items: [
      { name: 'Beratung', quantity: 1, unitPriceNet: 10000, vatRate: 19 },
      { name: 'Buch', quantity: 2, unitPriceNet: 1000, vatRate: 7 }
    ]
  }));
  assert.equal(t.vatBreakdown.length, 2);
  assert.equal(t.vatBreakdown[0].tax, 1900);
  assert.equal(t.vatBreakdown[1].tax, 140);
  assert.equal(t.grossTotal, 10000 + 2000 + 1900 + 140);
});

test('Rabatt wirkt auf die Position', () => {
  const t = invoices.totals(invoice({
    items: [{ name: 'Leistung', quantity: 1, unitPriceNet: 10000, vatRate: 19, discountPercent: 10 }]
  }));
  assert.equal(t.netTotal, 9000);
});

test('Teilzahlung führt zum Status teilweise bezahlt', () => {
  const inv = invoice({ status: 'sent', payments: [{ date: '2026-03-10', amount: 50000 }] });
  assert.equal(invoices.resolveStatus(inv, '2026-03-12'), 'partial');
  assert.equal(invoices.totals(inv).openAmount, 57100);
});

test('Nach Fälligkeit ohne Zahlung gilt überfällig', () => {
  const inv = invoice({ status: 'sent' });
  assert.equal(invoices.resolveStatus(inv, '2026-03-20'), 'overdue');
  assert.equal(invoices.resolveStatus(inv, '2026-03-10'), 'sent');
});

test('Vollzahlung setzt den Status auf bezahlt', () => {
  const inv = invoice({ status: 'sent', payments: [{ date: '2026-03-10', amount: 107100 }] });
  assert.equal(invoices.resolveStatus(inv, '2026-03-20'), 'paid');
});

test('Eine Stornorechnung gilt nie als offene Forderung', () => {
  const storno = invoice({ status: 'sent', documentType: 'creditnote', dueDate: '2026-03-01' });
  assert.equal(invoices.resolveStatus(storno, '2026-12-31'), 'sent', 'auch lange nach der Fälligkeit nicht überfällig');
});

test('Eine stornierte Rechnung behält ihren Status', () => {
  const original = invoice({ status: 'cancelled', payments: [{ date: '2026-03-10', amount: 107100 }] });
  assert.equal(invoices.resolveStatus(original, '2026-04-01'), 'cancelled');
});

test('Nummernmuster füllt Jahr und laufende Nummer', () => {
  assert.equal(invoices.buildNumber('RE-{YYYY}-{####}', 7, '2026-03-01'), 'RE-2026-0007');
  assert.equal(invoices.buildNumber('{YY}{MM}-{###}', 42, '2026-11-02'), '2611-042');
});

test('Pflichtangaben nach §14 UStG werden geprüft', () => {
  const company = { name: 'Firma', street: 'Weg 1', zip: '10115', city: 'Berlin', taxNumber: '12/345/67890' };
  const customer = { name: 'Kunde', street: 'Platz 2', zip: '20095', city: 'Hamburg' };

  const ok = invoices.validateInvoice(invoice({}), company, customer);
  assert.deepEqual(ok.errors, []);

  const ohneLeistungsdatum = invoices.validateInvoice(
    invoice({ deliveryDate: null, deliveryPeriod: null }), company, customer
  );
  assert.ok(ohneLeistungsdatum.errors.some((e) => e.includes('Leistungszeitpunkt')));

  const ohneSteuernummer = invoices.validateInvoice(invoice({}), { ...company, taxNumber: '' }, customer);
  assert.ok(ohneSteuernummer.errors.some((e) => e.includes('Steuernummer')));
});

test('Reverse Charge verlangt eine USt-IdNr. auf beiden Seiten', () => {
  const company = { name: 'Firma', street: 'Weg 1', zip: '10115', city: 'Berlin', taxNumber: '12/345/67890' };
  const customer = { name: 'Kunde', street: 'Rue 2', zip: '1000', city: 'Brüssel', country: 'BE' };
  const result = invoices.validateInvoice(
    invoice({ items: [{ name: 'Leistung', quantity: 1, unitPriceNet: 10000, vatRate: 0, vatKey: 'reverse' }] }),
    company,
    customer
  );
  assert.ok(result.errors.some((e) => e.includes('Reverse Charge')));
});
