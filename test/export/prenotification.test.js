'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const members = require('../../src/domain/members');
const prenotification = require('../../src/export/prenotification');

const SETTINGS = {
  tiers: [
    { id: 'bk_1', label: 'Erwachsene', amount: 12000, interval: 'yearly' },
    { id: 'bk_2', label: 'Quartal', amount: 3000, interval: 'quarterly' }
  ],
  categoryId: 'cl_inc_dues',
  dueMonth: 1,
  dueDay: 15,
  honoraryFree: true
};

const COMPANY = {
  name: 'Turnverein Musterstadt e. V.',
  street: 'Sportplatzweg 1',
  zip: '86150',
  city: 'Augsburg'
};

const SEPA = { creditorId: 'DE98ZZZ09999999999', preNotificationDays: 14 };

function member(overrides = {}) {
  return members.normalizeMember({
    id: 'mg_1', number: '0042', firstName: 'Erika', lastName: 'Musterfrau',
    kind: 'active', tierId: 'bk_1', joinedAt: '2020-03-01',
    street: 'Beispielweg 3', zip: '86150', city: 'Augsburg',
    payment: 'debit', iban: 'DE02120300000000202051',
    mandateRef: 'TVM-0001', mandateDate: '2020-03-01', ...overrides
  });
}

/* ------------------------------------------------------------------ Empfänger */

test('Angeschrieben wird, von wem eingezogen wird', () => {
  const plan = members.preNotificationPlan([
    member(),
    member({ id: 'mg_2', payment: 'transfer' })
  ], SETTINGS, 2026);

  assert.equal(plan.items.length, 1, 'wer überweist, bekommt keine Ankündigung');
  assert.equal(plan.count, 1);
  assert.equal(plan.total, 12000);
});

test('Ein Schreiben nennt alle Termine des Jahres', () => {
  const plan = members.preNotificationPlan([member({ tierId: 'bk_2' })], SETTINGS, 2026);
  const item = plan.items[0];

  assert.equal(item.periods.length, 4, 'ein Brief statt vier');
  assert.deepEqual(item.periods.map((p) => p.date),
    ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
  assert.equal(item.total, 12000, 'vier mal 30 Euro');
});

test('Beitragsfreie Mitglieder bekommen nichts', () => {
  const plan = members.preNotificationPlan([member({ kind: 'honorary' })], SETTINGS, 2026);
  assert.equal(plan.items.length, 0, 'ohne Einzug keine Ankündigung');
});

test('Wer nicht angeschrieben werden kann, verschwindet nicht', () => {
  // Stillschweigend zu übergehen hieße, ohne Ankündigung einzuziehen.
  const plan = members.preNotificationPlan([
    member(),
    member({ id: 'mg_2', firstName: 'Max', street: '', city: '' })
  ], SETTINGS, 2026);

  assert.equal(plan.items.length, 2);
  assert.equal(plan.count, 1);
  assert.equal(plan.blocked.length, 1);
  assert.match(plan.blocked[0].problems.join(' '), /Anschrift/);
});

test('Der früheste Termin bestimmt, wann die Post raus muss', () => {
  const plan = members.preNotificationPlan([
    member({ tierId: 'bk_2' }),
    member({ id: 'mg_2', tierId: 'bk_1', joinedAt: '2026-07-01' })
  ], SETTINGS, 2026);

  assert.equal(plan.firstDue, '2026-01-15');
  assert.equal(plan.noticeDays, 14, 'Regelfrist, wenn nichts anderes übergeben wird');
});

test('Eine verkürzte Frist wird durchgereicht', () => {
  const plan = members.preNotificationPlan([member()], SETTINGS, 2026, { noticeDays: 5 });
  assert.equal(plan.noticeDays, 5);
});

test('Wer das ganze Jahr nicht dabei ist, steht nicht auf der Liste', () => {
  const plan = members.preNotificationPlan([member({ leftAt: '2025-06-30' })], SETTINGS, 2026);
  assert.equal(plan.items.length, 0);
});

/* ------------------------------------------------------------------ Das Schreiben */

function buildLetters(overrides = {}) {
  const list = overrides.members || [member()];
  const plan = members.preNotificationPlan(list, SETTINGS, 2026);

  return prenotification.build({
    items: plan.ready,
    company: COMPANY,
    sepa: { ...SEPA, ...(overrides.sepa || {}) },
    entity: { boardName: 'Vorname Nachname' },
    year: 2026,
    date: '2026-09-18'
  });
}

test('Das Schreiben nennt die vier Pflichtangaben', () => {
  const html = buildLetters();

  assert.match(html, /DE98 ZZZ0 9999 9999 99/, 'Gläubiger-Identifikationsnummer');
  assert.match(html, /TVM-0001/, 'Mandatsreferenz');
  assert.match(html, /120,00/, 'Betrag');
  assert.match(html, /15\.01\.2026/, 'Fälligkeitstag');
});

test('Die Kontonummer steht nur verkürzt darin', () => {
  // Ein Brief kann im Umschlag verloren gehen: Anfang und Ende genügen.
  const html = buildLetters();

  assert.ok(!html.includes('DE02120300000000202051'), 'nicht vollständig');
  assert.match(html, /DE02 1203 •••• •••• 2051/);
});

test('Die Verkürzung lässt Anfang und Ende stehen', () => {
  assert.equal(prenotification.maskIban('DE02120300000000202051'), 'DE02 1203 •••• •••• 2051');
  assert.equal(prenotification.maskIban('DE02 1203 0000 0000 2020 51'), 'DE02 1203 •••• •••• 2051');
  assert.equal(prenotification.maskIban('kurz'), 'kurz', 'zu kurz zum Verkürzen');
});

test('Jedes Mitglied bekommt ein eigenes Blatt', () => {
  const html = buildLetters({
    members: [member(), member({ id: 'mg_2', firstName: 'Max', lastName: 'Mustermann', mandateRef: 'TVM-0002' })]
  });

  assert.equal([...html.matchAll(/<section class="letter">/g)].length, 2);
  assert.match(html, /page-break-after: always/, 'damit gedruckt jeder Brief eigen steht');
  assert.match(html, /Erika Musterfrau/);
  assert.match(html, /Max Mustermann/);
});

test('Bei mehreren Terminen steht eine Summe darunter', () => {
  const einmal = buildLetters();
  const viermal = buildLetters({ members: [member({ tierId: 'bk_2' })] });

  assert.ok(!einmal.includes('Gesamt 2026'), 'bei einem Termin wäre die Summe albern');
  assert.match(viermal, /Gesamt 2026/);
  assert.match(viermal, /120,00/, 'vier mal 30 Euro');
});

test('Das Schreiben nennt das Erstattungsrecht von acht Wochen', () => {
  assert.match(buildLetters(), /acht Wochen ab dem Tag der Belastung/);
});

test('Die Regelfrist steht drin, eine verkürzte wird als solche benannt', () => {
  assert.match(buildLetters(), /mindestens 14 Kalendertage/);

  const kurz = buildLetters({ sepa: { preNotificationDays: 5 } });
  assert.match(kurz, /Nach unserer Satzung/);
  assert.match(kurz, /5 Kalendertage/);
});

test('Der Brief sagt, dass keine weitere Ankündigung kommt', () => {
  // Der Satz ist der Grund, warum ein Schreiben für das ganze Jahr genügt.
  assert.match(buildLetters(), /eine weitere Ankündigung erfolgt dazu nicht/);
});

test('Absender, Anschrift und Datum stehen im Brief', () => {
  const html = buildLetters();

  assert.match(html, /Turnverein Musterstadt e\. V\. · Sportplatzweg 1 · 86150 Augsburg/);
  assert.match(html, /Beispielweg 3/);
  assert.match(html, /86150 Augsburg/);
  assert.match(html, /18\.09\.2026/);
});

test('Die Anrede nimmt den Namen, wenn keine eigene vorgegeben ist', () => {
  assert.equal(prenotification.salutationFor({ name: 'Erika Musterfrau' }), 'Guten Tag Erika Musterfrau,');
  assert.equal(prenotification.salutationFor({ name: '' }), 'Guten Tag,');
  assert.equal(prenotification.salutationFor({ name: 'Erika' }, 'Sehr geehrte Damen und Herren,'),
    'Sehr geehrte Damen und Herren,');
});

test('Sonderzeichen im Namen brechen das Dokument nicht auf', () => {
  const html = buildLetters({
    members: [member({ firstName: 'Anne & Co', lastName: '<Müller>' })]
  });

  assert.ok(!html.includes('<Müller>'), 'spitze Klammern sind maskiert');
  assert.match(html, /&lt;Müller&gt;/);
  assert.match(html, /Anne &amp; Co/);
});
