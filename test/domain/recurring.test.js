'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const recurrence = require('../../src/domain/recurrence');
const recurring = require('../../src/domain/recurring');
const { defaultSettings } = require('../../src/storage/store');

const SETTINGS = defaultSettings();
const SEG = SETTINGS.segments[0].id;

/* ------------------------------------------------------------------ Regel */

test('Eine Monatsregel behält ihren Stichtag über kurze Monate hinweg', () => {
  const rule = recurrence.normalizeRule({ interval: 'monthly', startDate: '2026-01-31' });
  const dates = recurrence.occurrencesBetween(rule, null, '2026-06-30');

  assert.deepEqual(dates, [
    '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'
  ]);
});

test('Im Schaltjahr rückt der Februar auf den 29.', () => {
  const rule = recurrence.normalizeRule({ interval: 'monthly', startDate: '2028-01-31' });
  assert.equal(recurrence.occurrenceAt(rule, 1), '2028-02-29');
});

test('Vierteljährlich und jährlich springen richtig', () => {
  const quarterly = recurrence.normalizeRule({ interval: 'quarterly', startDate: '2026-02-15' });
  assert.deepEqual(
    recurrence.occurrencesBetween(quarterly, null, '2027-01-01'),
    ['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15']
  );

  const yearly = recurrence.normalizeRule({ interval: 'yearly', startDate: '2026-07-01' });
  assert.deepEqual(
    recurrence.occurrencesBetween(yearly, null, '2029-01-01'),
    ['2026-07-01', '2027-07-01', '2028-07-01']
  );
});

test('Wochenrhythmen rechnen in Tagen, nicht in Monaten', () => {
  const rule = recurrence.normalizeRule({ interval: 'biweekly', startDate: '2026-01-05' });
  assert.deepEqual(
    recurrence.occurrencesBetween(rule, null, '2026-02-20'),
    ['2026-01-05', '2026-01-19', '2026-02-02', '2026-02-16']
  );
});

test('Ein Vielfaches des Rhythmus wird berücksichtigt', () => {
  const rule = recurrence.normalizeRule({ interval: 'monthly', every: 2, startDate: '2026-01-10' });
  assert.deepEqual(
    recurrence.occurrencesBetween(rule, null, '2026-07-31'),
    ['2026-01-10', '2026-03-10', '2026-05-10', '2026-07-10']
  );
});

test('Enddatum und Anzahl begrenzen die Folge', () => {
  const byDate = recurrence.normalizeRule({ interval: 'monthly', startDate: '2026-01-10', endDate: '2026-03-31' });
  assert.equal(recurrence.occurrencesBetween(byDate, null, '2027-12-31').length, 3);

  const byCount = recurrence.normalizeRule({ interval: 'monthly', startDate: '2026-01-10', occurrences: 2 });
  assert.deepEqual(recurrence.occurrencesBetween(byCount, null, '2027-12-31'), ['2026-01-10', '2026-02-10']);
});

test('Eine abgelaufene Regel liefert keinen nächsten Termin mehr', () => {
  const rule = recurrence.normalizeRule({ interval: 'monthly', startDate: '2026-01-10', occurrences: 2 });
  assert.equal(recurrence.nextAfter(rule, '2026-02-10'), null);
  assert.equal(recurrence.isFinished(rule, '2026-03-01'), true);
  assert.equal(recurrence.isFinished(rule, '2026-02-01'), false);
});

test('Die Regel beschreibt sich in einem Satz', () => {
  assert.match(
    recurrence.describe(recurrence.normalizeRule({ interval: 'monthly', startDate: '2026-01-15' })),
    /Monatlich, jeweils am 15\./
  );
  assert.match(
    recurrence.describe(recurrence.normalizeRule({ interval: 'monthly', startDate: '2026-01-31' })),
    /Monatsletzten/
  );
  assert.match(
    recurrence.describe(recurrence.normalizeRule({ interval: 'biweekly', startDate: '2026-01-05' })),
    /Alle 2 Wochen/
  );
});

test('Eine Regel ohne Startdatum wird abgelehnt', () => {
  const errors = recurrence.validateRule(recurrence.normalizeRule({ interval: 'monthly' }));
  assert.ok(errors.some((e) => e.includes('Startdatum')));
});

/* ------------------------------------------------------------------ Vorlagen */

function entryTemplate(overrides = {}) {
  return recurring.normalize({
    id: 'wdh_1',
    kind: 'entry',
    label: 'Büromiete',
    rule: { interval: 'monthly', startDate: '2026-01-01' },
    markPaid: true,
    template: {
      type: 'expense',
      amount: 71400,
      categoryId: 'exp_rent',
      description: 'Büromiete {PERIOD}',
      counterparty: 'Hausverwaltung Nord',
      segmentId: SEG
    },
    ...overrides
  });
}

function invoiceTemplate(overrides = {}) {
  return recurring.normalize({
    id: 'wdh_2',
    kind: 'invoice',
    label: 'Betreuung Nordlicht',
    rule: { interval: 'monthly', startDate: '2026-01-01' },
    template: {
      customerId: 'kd_1',
      segmentId: SEG,
      paymentTermsDays: 14,
      items: [{ name: 'Technische Betreuung {PERIOD}', quantity: 1, unit: 'MON', unitPriceNet: 25000, vatRate: 19 }],
      intro: 'Betreuungspauschale für {PERIOD}.',
      bodyText: 'Zahlbar bis {DUEDATE}.'
    },
    ...overrides
  });
}

test('Aus einer Buchungsvorlage entsteht eine vollständige Buchung', () => {
  const entry = recurring.materialize(entryTemplate(), '2026-03-01');

  assert.equal(entry.date, '2026-03-01');
  assert.equal(entry.paidDate, '2026-03-01', 'als bezahlt markiert, weil Dauerauftrag');
  assert.equal(entry.gross, 71400);
  assert.equal(entry.net, 60000);
  assert.equal(entry.categoryId, 'exp_rent');
  assert.equal(entry.segmentId, SEG);
  assert.equal(entry.recurrenceId, 'wdh_1');
  assert.equal(entry.recurrenceDate, '2026-03-01');
});

test('Der Platzhalter für den Zeitraum wird gesetzt', () => {
  assert.equal(recurring.materialize(entryTemplate(), '2026-03-01').description, 'Büromiete März 2026');
  const invoice = recurring.materialize(invoiceTemplate(), '2026-07-01');
  assert.equal(invoice.items[0].name, 'Technische Betreuung {PERIOD}', 'die Bezeichnung bleibt, nur Beschreibungen werden gefüllt');
  assert.equal(invoice.intro, 'Betreuungspauschale für Juli 2026.');
});

test('Ohne Zahlungsvermerk bleibt die Buchung offen', () => {
  const entry = recurring.materialize(entryTemplate({ markPaid: false }), '2026-03-01');
  assert.equal(entry.paidDate, null);
});

test('Aus einer Rechnungsvorlage entsteht ein Entwurf mit Leistungszeitraum', () => {
  const invoice = recurring.materialize(invoiceTemplate(), '2026-03-01');

  assert.equal(invoice.status, 'draft');
  assert.equal(invoice.number, null, 'die Nummer fällt erst beim Festschreiben');
  assert.equal(invoice.issueDate, '2026-03-01');
  assert.equal(invoice.dueDate, '2026-03-15');
  assert.deepEqual(invoice.deliveryPeriod, { from: '2026-03-01', to: '2026-03-31' });
  assert.equal(invoice.recurrenceDate, '2026-03-01');
});

test('Ohne Leistungszeitraum wird ein Leistungsdatum gesetzt', () => {
  const template = invoiceTemplate();
  template.template.servicePeriod = false;
  const invoice = recurring.materialize(template, '2026-03-01');

  assert.equal(invoice.deliveryDate, '2026-03-01');
  assert.equal(invoice.deliveryPeriod, null);
});

/* ------------------------------------------------------------------ Fälligkeit */

test('Fällig ist alles bis heute, was noch nicht erzeugt wurde', () => {
  const template = entryTemplate();
  const dates = recurring.pendingDates(template, [], '2026-03-15');
  assert.deepEqual(dates, ['2026-01-01', '2026-02-01', '2026-03-01']);
});

test('Bereits erzeugte Termine kommen kein zweites Mal', () => {
  const template = entryTemplate();
  const existing = [
    { recurrenceId: 'wdh_1', recurrenceDate: '2026-01-01' },
    { recurrenceId: 'wdh_1', recurrenceDate: '2026-02-01' }
  ];
  assert.deepEqual(recurring.pendingDates(template, existing, '2026-03-15'), ['2026-03-01']);
});

test('Ein gelöschter Datensatz darf wieder entstehen', () => {
  const template = entryTemplate();
  const existing = [{ recurrenceId: 'wdh_1', recurrenceDate: '2026-02-01' }];
  const dates = recurring.pendingDates(template, existing, '2026-03-15');

  assert.ok(dates.includes('2026-01-01'), 'der fehlende Januar steht wieder an');
  assert.ok(!dates.includes('2026-02-01'));
});

test('Termine anderer Vorlagen zählen nicht', () => {
  const template = entryTemplate();
  const existing = [{ recurrenceId: 'wdh_fremd', recurrenceDate: '2026-01-01' }];
  assert.ok(recurring.pendingDates(template, existing, '2026-01-31').includes('2026-01-01'));
});

test('Übersprungene Termine bleiben übersprungen', () => {
  const template = entryTemplate({ skipped: ['2026-01-01', '2026-02-01'] });
  assert.deepEqual(recurring.pendingDates(template, [], '2026-03-15'), ['2026-03-01']);
});

test('Eine stillgelegte Vorlage erzeugt nichts', () => {
  assert.deepEqual(recurring.pendingDates(entryTemplate({ active: false }), [], '2026-12-31'), []);
});

test('Künftige Termine sind noch nicht fällig', () => {
  const template = entryTemplate();
  const dates = recurring.pendingDates(template, [], '2026-02-15');
  assert.ok(!dates.includes('2026-03-01'), 'der März kommt erst im März');
});

test('Alle Vorlagen zusammen ergeben die Liste des Anstehenden', () => {
  const data = {
    entries: [{ recurrenceId: 'wdh_1', recurrenceDate: '2026-01-01' }],
    invoices: []
  };
  const due = recurring.collectDue([entryTemplate(), invoiceTemplate()], data, '2026-02-10');

  assert.equal(due.length, 2);
  const miete = due.find((g) => g.template.id === 'wdh_1');
  assert.deepEqual(miete.dates, ['2026-02-01'], 'der Januar ist schon gebucht');
  assert.equal(due.find((g) => g.template.id === 'wdh_2').dates.length, 2);
  assert.ok(miete.items[0].preview.description.includes('Februar'));
});

test('Der nächste Termin wird auch nach dem Aufholen genannt', () => {
  const template = entryTemplate();
  const existing = [
    { recurrenceId: 'wdh_1', recurrenceDate: '2026-01-01' },
    { recurrenceId: 'wdh_1', recurrenceDate: '2026-02-01' }
  ];
  assert.equal(recurring.nextDate(template, existing), '2026-03-01');
});

/* ------------------------------------------------------------------ Prüfung */

test('Eine Buchungsvorlage ohne Betrag wird abgelehnt', () => {
  const template = entryTemplate();
  template.template.gross = 0;
  assert.ok(recurring.validate(template).some((e) => e.includes('Betrag')));
});

test('Eine Rechnungsvorlage ohne Kunde oder Position wird abgelehnt', () => {
  const ohneKunde = invoiceTemplate();
  ohneKunde.template.customerId = null;
  assert.ok(recurring.validate(ohneKunde).some((e) => e.includes('Kunden')));

  const ohnePosition = invoiceTemplate();
  ohnePosition.template.items = [];
  assert.ok(recurring.validate(ohnePosition).some((e) => e.includes('Position')));
});

test('Eine Vorlage ohne Namen wird abgelehnt', () => {
  assert.ok(recurring.validate(entryTemplate({ label: '  ' })).some((e) => e.includes('Namen')));
});
