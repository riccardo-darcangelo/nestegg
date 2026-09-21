'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const members = require('../../src/domain/members');

const SETTINGS = {
  tiers: [
    { id: 'bk_1', label: 'Erwachsene', amount: 12000, interval: 'yearly' },
    { id: 'bk_2', label: 'Jugend', amount: 6000, interval: 'yearly' },
    { id: 'bk_3', label: 'Monatlich', amount: 1000, interval: 'monthly' },
    { id: 'bk_4', label: 'Quartal', amount: 3000, interval: 'quarterly' }
  ],
  categoryId: 'cl_inc_dues',
  dueMonth: 1,
  dueDay: 15,
  honoraryFree: true
};

function member(overrides = {}) {
  return members.normalizeMember({
    id: 'mg_1', number: '0042', firstName: 'Erika', lastName: 'Musterfrau',
    kind: 'active', tierId: 'bk_1', joinedAt: '2020-03-01',
    street: 'Beispielweg 3', zip: '86150', city: 'Augsburg', ...overrides
  });
}

/* ------------------------------------------------------------------ Stammdaten */

test('Der Name wird aus Vor- und Nachname zusammengesetzt', () => {
  assert.equal(member().name, 'Erika Musterfrau');
  assert.equal(members.normalizeMember({ name: 'Nur ein Name' }).name, 'Nur ein Name');
});

test('Ein Mitglied ohne Eintrittsdatum wird abgelehnt', () => {
  const errors = members.validateMember(members.normalizeMember({ firstName: 'Max' }));
  assert.match(errors.join(' '), /Eintrittsdatum fehlt/);
});

test('Ein Austritt vor dem Eintritt fällt auf', () => {
  const errors = members.validateMember(member({ joinedAt: '2026-01-01', leftAt: '2025-01-01' }));
  assert.match(errors.join(' '), /vor dem Eintritt/);
});

test('Eine unplausible IBAN fällt auf', () => {
  const errors = members.validateMember(member({ payment: 'debit', iban: 'keine IBAN' }));
  assert.match(errors.join(' '), /nicht gültig/);
});

test('Auch eine verdrehte Ziffer in der IBAN fällt auf', () => {
  // Muster und Länge stimmen, nur die Prüfziffer nicht. Ohne echte Prüfung
  // merkt man es erst, wenn die Bank die Lastschrift zurückgibt.
  const gut = members.validateMember(member({ iban: 'DE02120300000000202051' }));
  assert.deepEqual(gut, []);

  const schlecht = members.validateMember(member({ iban: 'DE02120300000000202052' }));
  assert.match(schlecht.join(' '), /Prüfziffer stimmt nicht/);
});

test('Die Mitgliedschaft gilt zwischen Eintritt und Austritt', () => {
  const austritt = member({ joinedAt: '2026-03-01', leftAt: '2026-06-30' });

  assert.equal(members.isMemberOn(austritt, '2026-02-28'), false);
  assert.equal(members.isMemberOn(austritt, '2026-03-01'), true);
  assert.equal(members.isMemberOn(austritt, '2026-06-30'), true);
  assert.equal(members.isMemberOn(austritt, '2026-07-01'), false);
});

test('Der Status folgt den Daten', () => {
  assert.equal(members.statusOf(member(), '2026-09-17'), 'active');
  assert.equal(members.statusOf(member({ leftAt: '2026-06-30' }), '2026-09-17'), 'left');
  assert.equal(members.statusOf(member({ joinedAt: '2027-01-01' }), '2026-09-17'), 'future');
});

/* ------------------------------------------------------------------ Beitrag */

test('Der Beitrag kommt aus der Beitragsklasse', () => {
  assert.equal(members.amountFor(member(), SETTINGS), 12000);
  assert.equal(members.amountFor(member({ tierId: 'bk_2' }), SETTINGS), 6000);
});

test('Ein abweichender Betrag am Mitglied geht vor', () => {
  assert.equal(members.amountFor(member({ customAmount: 5000 }), SETTINGS), 5000);
  assert.equal(members.amountFor(member({ customAmount: 0 }), SETTINGS), 0, 'auch die Null gilt');
});

test('Ehrenmitglieder zahlen nichts, solange die Satzung nichts anderes sagt', () => {
  const ehren = member({ kind: 'honorary' });
  assert.equal(members.amountFor(ehren, SETTINGS), 0);
  assert.equal(members.amountFor(ehren, { ...SETTINGS, honoraryFree: false }), 12000);
});

test('Ohne Beitragsklasse gibt es keinen Beitrag', () => {
  assert.equal(members.amountFor(member({ tierId: null }), SETTINGS), 0);
});

/* ------------------------------------------------------------------ Fälligkeiten */

test('Jährlich ergibt eine Fälligkeit, monatlich zwölf', () => {
  assert.equal(members.periodsOf(member(), SETTINGS, 2026).length, 1);
  assert.equal(members.periodsOf(member({ tierId: 'bk_3' }), SETTINGS, 2026).length, 12);
  assert.equal(members.periodsOf(member({ tierId: 'bk_4' }), SETTINGS, 2026).length, 4);
});

test('Die Fälligkeit liegt auf dem eingestellten Stichtag', () => {
  const periods = members.periodsOf(member({ tierId: 'bk_4' }), SETTINGS, 2026);
  assert.deepEqual(periods.map((period) => period.date), ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
  assert.equal(periods[0].label, '1. Quartal 2026');
});

test('Ein anderer Stichtag verschiebt alle Termine', () => {
  const periods = members.periodsOf(member({ tierId: 'bk_4' }), { ...SETTINGS, dueMonth: 2, dueDay: 1 }, 2026);
  assert.equal(periods[0].date, '2026-02-01');
  assert.equal(periods[1].date, '2026-05-01');
});

test('Perioden vor dem Eintritt entfallen', () => {
  const spaet = member({ tierId: 'bk_4', joinedAt: '2026-08-01' });
  const periods = members.periodsOf(spaet, SETTINGS, 2026);

  assert.equal(periods.length, 2, 'drittes und viertes Quartal');
  assert.equal(periods[0].label, '3. Quartal 2026');
});

test('Perioden nach dem Austritt ebenso', () => {
  const raus = member({ tierId: 'bk_4', leftAt: '2026-05-31' });
  const periods = members.periodsOf(raus, SETTINGS, 2026);

  assert.equal(periods.length, 2, 'erstes und zweites Quartal');
});

test('Wer mitten in einer Periode eintritt, zahlt sie voll', () => {
  // Eintritt im Februar, das erste Quartal läuft schon: es wird nicht geteilt.
  const periods = members.periodsOf(member({ tierId: 'bk_4', joinedAt: '2026-02-10' }), SETTINGS, 2026);
  assert.equal(periods.length, 4);
});

test('Wer das ganze Jahr nicht dabei war, hat keine Fälligkeit', () => {
  assert.equal(members.periodsOf(member({ joinedAt: '2027-01-01' }), SETTINGS, 2026).length, 0);
  assert.equal(members.periodsOf(member({ leftAt: '2025-06-30' }), SETTINGS, 2026).length, 0);
});

/* ------------------------------------------------------------------ Lauf */

test('Der Beitragslauf listet jede Fälligkeit einzeln', () => {
  const list = [member(), member({ id: 'mg_2', firstName: 'Max', lastName: 'Mustermann', tierId: 'bk_4' })];
  const rows = members.plan(list, SETTINGS, 2026, []);

  assert.equal(rows.length, 5, 'einer jährlich, einer vierteljährlich');
  assert.equal(rows.filter((row) => row.memberId === 'mg_2').length, 4);

  const summary = members.summarize(rows);
  assert.equal(summary.open, 5);
  assert.equal(summary.openAmount, 12000 + 4 * 3000);
});

test('Was schon gebucht ist, wird nicht noch einmal angeboten', () => {
  const list = [member()];
  const rows = members.plan(list, SETTINGS, 2026, []);
  const entry = members.toEntry(rows[0], SETTINGS);

  const wieder = members.plan(list, SETTINGS, 2026, [entry]);
  assert.equal(wieder[0].booked, true);
  assert.equal(wieder[0].selected, false);
  assert.equal(members.summarize(wieder).open, 0);
});

test('Ehrenmitglieder stehen in der Liste, aber ohne Betrag', () => {
  const rows = members.plan([member({ kind: 'honorary' })], SETTINGS, 2026, []);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 0);
  assert.equal(rows[0].skip, true);
  assert.equal(rows[0].selected, false);
  assert.equal(members.summarize(rows).free, 1);
});

test('Bei Lastschrift gilt der Beitrag als eingegangen, bei Überweisung nicht', () => {
  const lastschrift = members.plan([member({ payment: 'debit' })], SETTINGS, 2026, [])[0];
  const ueberweisung = members.plan([member({ payment: 'transfer' })], SETTINGS, 2026, [])[0];

  assert.equal(members.toEntry(lastschrift, SETTINGS).paidDate, '2026-01-15');
  assert.equal(members.toEntry(ueberweisung, SETTINGS).paidDate, null, 'offen, bis das Geld da ist');
});

test('Eine Beitragsbuchung landet im ideellen Bereich und ohne Umsatzsteuer', () => {
  const row = members.plan([member()], SETTINGS, 2026, [])[0];
  const entry = members.toEntry(row, SETTINGS);

  assert.equal(entry.sphereId, 'ideell');
  assert.equal(entry.categoryId, 'cl_inc_dues');
  assert.equal(entry.vatRate, 0);
  assert.equal(entry.amount, 12000);
  assert.equal(entry.counterparty, 'Erika Musterfrau');
  assert.match(entry.description, /Jahresbeitrag 2026, Mitglied 0042/);
  assert.equal(entry.duesRef, 'mg_1|2026');
});

test('Der Fingerabdruck unterscheidet Mitglied und Zeitraum', () => {
  const rows = members.plan([member({ tierId: 'bk_4' })], SETTINGS, 2026, []);
  const refs = rows.map((row) => row.ref);

  assert.deepEqual(refs, ['mg_1|2026-1', 'mg_1|2026-2', 'mg_1|2026-3', 'mg_1|2026-4']);
  assert.equal(new Set(refs).size, 4);
});

/* ------------------------------------------------------------------ Bestand */

test('Die Statistik zählt Bestand, Eintritte und Austritte', () => {
  const list = [
    member({ id: 'a', joinedAt: '2020-01-01' }),
    member({ id: 'b', joinedAt: '2026-03-01' }),
    member({ id: 'c', joinedAt: '2019-01-01', leftAt: '2026-06-30' }),
    member({ id: 'd', joinedAt: '2018-01-01', leftAt: '2024-12-31' })
  ];

  const stats = members.statistics(list, 2026);
  assert.equal(stats.count, 2, 'am Jahresende dabei');
  assert.equal(stats.joined, 1);
  assert.equal(stats.left, 1);
  assert.equal(stats.change, 0);
});

test('Die Statistik teilt nach Art und Zahlweise auf', () => {
  const list = [
    member({ id: 'a', kind: 'active', payment: 'debit' }),
    member({ id: 'b', kind: 'youth', payment: 'debit' }),
    member({ id: 'c', kind: 'honorary', payment: 'transfer' })
  ];

  const stats = members.statistics(list, 2026);
  assert.equal(stats.byKind.find((kind) => kind.id === 'youth').count, 1);
  assert.equal(stats.byPayment.debit, 2);
  assert.equal(stats.byPayment.transfer, 1);
});

test('Das Durchschnittsalter zählt nur die mit bekanntem Geburtsdatum', () => {
  const list = [
    member({ id: 'a', birthDate: '1990-05-01' }),
    member({ id: 'b', birthDate: '2010-05-01' }),
    member({ id: 'c' })
  ];

  const stats = members.statistics(list, 2026);
  assert.equal(stats.withBirthDate, 2);
  assert.equal(stats.averageAge, 26, '36 und 16 Jahre');
  assert.equal(stats.under18, 1);
});

test('Das erwartete Beitragsaufkommen rechnet über alle Fälligkeiten', () => {
  const list = [member(), member({ id: 'mg_2', tierId: 'bk_3' })];
  const expected = members.expectedDues(list, SETTINGS, 2026);

  assert.equal(expected.total, 12000 + 12 * 1000);
  assert.equal(expected.count, 13);
});
