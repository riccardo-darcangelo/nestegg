'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const dunning = require('../../src/domain/dunning');
const deadlines = require('../../src/domain/deadlines');
const documentHtml = require('../../src/export/document-html');
const { defaultSettings } = require('../../src/storage/store');
const { DEFAULT_THEME } = require('../../src/export/theme');

const SETTINGS = defaultSettings();

function invoice(overrides = {}) {
  return {
    id: 're_1',
    number: 'RE-2026-0007',
    documentType: 'invoice',
    status: 'sent',
    customerId: 'kd_1',
    issueDate: '2026-01-10',
    dueDate: '2026-01-24',
    items: [{ name: 'Leistung', quantity: 1, unit: 'LS', unitPriceNet: 100000, vatRate: 19 }],
    payments: [],
    reminders: [],
    ...overrides
  };
}

const BUSINESS = { id: 'kd_1', name: 'Kundenfirma GmbH', vatId: 'DE123456789' };
const CONSUMER = { id: 'kd_2', name: 'Max Mustermann', isConsumer: true };

/* ------------------------------------------------------------------ Verzug */

test('Ohne Mahnung tritt Verzug dreißig Tage nach Fälligkeit ein', () => {
  const since = dunning.defaultSince(invoice(), SETTINGS);
  // Fällig am 24.01., ab dem 31. Tag danach ist Verzug.
  assert.equal(since, '2026-02-24');
});

test('Eine vorausgegangene Mahnung setzt den Verzug ab dem Folgetag', () => {
  const since = dunning.defaultSince(
    invoice({ reminders: [{ level: 1, date: '2026-02-01' }] }),
    SETTINGS
  );
  assert.equal(since, '2026-02-02');
});

test('Wer die Dreißig-Tage-Regel abschaltet, hat ohne Mahnung keinen Verzug', () => {
  const settings = { ...SETTINGS, dunning: { ...SETTINGS.dunning, useAutomaticDefault: false } };
  assert.equal(dunning.defaultSince(invoice(), settings), null);
});

/* ------------------------------------------------------------------ Zinsen */

test('Verzugszinsen rechnen taggenau auf Basis von 365 Tagen', () => {
  const settings = { ...SETTINGS, dunning: { ...SETTINGS.dunning, baseRate: 2 } };
  // 1.190 Euro, 11 Prozent, 100 Tage: 1190 * 0,11 * 100 / 365 = 35,86 Euro.
  const result = dunning.interestFor(119000, '2026-01-01', '2026-04-11', settings, true);

  assert.equal(result.days, 100);
  assert.equal(result.rate, 11);
  assert.equal(result.amount, 3586);
});

test('Verbraucher zahlen fünf, Unternehmen neun Punkte über dem Basiszins', () => {
  const settings = { ...SETTINGS, dunning: { ...SETTINGS.dunning, baseRate: 3 } };
  assert.equal(dunning.interestFor(100000, '2026-01-01', '2026-02-01', settings, true).rate, 12);
  assert.equal(dunning.interestFor(100000, '2026-01-01', '2026-02-01', settings, false).rate, 8);
});

test('Ohne Verzugsbeginn gibt es keine Zinsen', () => {
  assert.equal(dunning.interestFor(100000, null, '2026-02-01', SETTINGS, true).amount, 0);
});

test('Ein Basiszins von null ergibt trotzdem den gesetzlichen Aufschlag', () => {
  const result = dunning.interestFor(100000, '2026-01-01', '2026-12-31', SETTINGS, true);
  assert.equal(result.rate, 9, 'neun Punkte über null sind neun Prozent');
  assert.ok(result.amount > 0);
});

/* ------------------------------------------------------------------ Unternehmer */

test('Eine USt-IdNr. macht den Kunden zum Unternehmer', () => {
  assert.equal(dunning.isBusinessCustomer(BUSINESS), true);
  assert.equal(dunning.isBusinessCustomer(CONSUMER), false);
  assert.equal(dunning.isBusinessCustomer({ name: 'Ohne Angabe' }), true);
});

/* ------------------------------------------------------------------ Stufen */

test('Die erste Stufe ist die Zahlungserinnerung ohne Kosten', () => {
  const prepared = dunning.prepare(invoice(), BUSINESS, SETTINGS, '2026-03-01');

  assert.equal(prepared.level, 1);
  assert.equal(prepared.levelLabel, 'Zahlungserinnerung');
  assert.equal(prepared.interest.amount, 0, 'die Erinnerung verlangt keine Zinsen');
  assert.equal(prepared.flatFee, 0);
  assert.equal(prepared.total, prepared.open, 'gefordert wird nur die Rechnung selbst');
});

test('Ab der ersten Mahnung kommen Zinsen und Pauschale dazu', () => {
  const settings = { ...SETTINGS, dunning: { ...SETTINGS.dunning, baseRate: 2 } };
  const prepared = dunning.prepare(
    invoice({ reminders: [{ level: 1, date: '2026-02-01', deadline: '2026-02-11' }] }),
    BUSINESS,
    settings,
    '2026-03-01'
  );

  assert.equal(prepared.level, 2);
  assert.ok(prepared.interest.amount > 0);
  assert.equal(prepared.flatFee, 4000, 'vierzig Euro nach §288 Abs. 5 BGB');
  assert.equal(prepared.total, prepared.open + prepared.interest.amount + prepared.flatFee);
});

test('Gegenüber Verbrauchern entfällt die Pauschale', () => {
  const prepared = dunning.prepare(
    invoice({ reminders: [{ level: 1, date: '2026-02-01' }] }),
    CONSUMER,
    SETTINGS,
    '2026-03-01'
  );

  assert.equal(prepared.flatFee, 0);
  assert.equal(prepared.business, false);
  assert.ok(prepared.warnings.some((w) => w.includes('Verbraucher')));
});

test('Die Stufe steigt mit jeder Mahnung, endet aber bei der letzten', () => {
  assert.equal(dunning.nextLevel(invoice()), 1);
  assert.equal(dunning.nextLevel(invoice({ reminders: [{}] })), 2);
  assert.equal(dunning.nextLevel(invoice({ reminders: [{}, {}] })), 3);
  assert.equal(dunning.nextLevel(invoice({ reminders: [{}, {}, {}] })), 3, 'nach der letzten kommt nichts mehr');
});

test('Vor Eintritt des Verzugs wird gewarnt statt gerechnet', () => {
  const prepared = dunning.prepare(invoice(), BUSINESS, SETTINGS, '2026-02-01', { level: 2 });

  assert.equal(prepared.interest.amount, 0);
  assert.equal(prepared.flatFee, 0);
  assert.ok(prepared.warnings.some((w) => w.includes('Verzug tritt erst')));
});

test('Ein Basiszins von null wird angemahnt, sobald Zinsen berechnet werden', () => {
  const prepared = dunning.prepare(
    invoice({ reminders: [{ level: 1, date: '2026-02-01' }] }),
    BUSINESS,
    SETTINGS,
    '2026-04-01'
  );
  assert.ok(prepared.warnings.some((w) => w.includes('Basiszinssatz')));
});

test('Eine Teilzahlung senkt die Forderung', () => {
  const prepared = dunning.prepare(
    invoice({ payments: [{ date: '2026-02-01', amount: 50000 }] }),
    BUSINESS,
    SETTINGS,
    '2026-03-01'
  );
  assert.equal(prepared.open, 119000 - 50000);
});

test('Eine ausgeglichene Rechnung trägt weder Zinsen noch Pauschale', () => {
  const prepared = dunning.prepare(
    invoice({ payments: [{ date: '2026-02-01', amount: 119000 }] }),
    BUSINESS,
    SETTINGS,
    '2026-03-01',
    // Auch wenn alle Kästchen angekreuzt sind: ohne Hauptforderung keine
    // Nebenforderung.
    { level: 2, includeInterest: true, includeFlatFee: true, includeFee: true }
  );
  assert.equal(prepared.open, 0);
  assert.equal(prepared.interest.amount, 0);
  assert.equal(prepared.flatFee, 0);
  assert.equal(prepared.fee, 0);
  assert.equal(prepared.total, 0);
  assert.ok(prepared.warnings.some((w) => w.includes('ausgeglichen')));
});

/* ------------------------------------------------------------------ Auswahl */

test('Nur überfällige Rechnungen lassen sich mahnen', () => {
  const list = [
    invoice(),
    invoice({ id: 're_2', number: 'RE-2026-0008', dueDate: '2026-12-31' }),
    invoice({ id: 're_3', number: 'RE-2026-0009', payments: [{ date: '2026-01-20', amount: 119000 }] }),
    invoice({ id: 're_4', documentType: 'quote', number: 'AN-2026-0001' }),
    invoice({ id: 're_5', number: null })
  ];

  const rows = dunning.collectOverdue(list, [BUSINESS], SETTINGS, '2026-03-01');
  assert.deepEqual(rows.map((r) => r.invoice.id), ['re_1'], 'nur die offene, überfällige Rechnung');
  assert.ok(rows[0].overdueDays > 30);
  assert.equal(rows[0].ready, true);
});

test('Nach einer Mahnung läuft erst deren Frist, bevor die nächste ansteht', () => {
  const list = [invoice({ reminders: [{ level: 1, date: '2026-03-01', deadline: '2026-03-11' }] })];

  const zuFrueh = dunning.collectOverdue(list, [BUSINESS], SETTINGS, '2026-03-05');
  assert.equal(zuFrueh[0].ready, false, 'die gesetzte Frist läuft noch');

  const danach = dunning.collectOverdue(list, [BUSINESS], SETTINGS, '2026-03-12');
  assert.equal(danach[0].ready, true);
  assert.equal(danach[0].nextLevel, 2);
});

/* ------------------------------------------------------------------ Schreiben */

const COMPANY = {
  name: 'Beispiel Consulting', street: 'Musterweg 12', zip: '10115', city: 'Berlin',
  taxNumber: '12/345/67890', iban: 'DE02 1203 0000 0000 2020 51'
};
const CUSTOMER = { name: 'Kundenfirma GmbH', street: 'Kundenallee 7', zip: '20095', city: 'Hamburg' };

test('Das Mahnschreiben nennt Forderung, Zinsen und Pauschale', () => {
  const reminder = {
    levelLabel: 'Erste Mahnung',
    date: '2026-03-01',
    deadline: '2026-03-08',
    open: 119000,
    overdueDays: 36,
    interest: { amount: 1180, days: 36, rate: 11, since: '2026-01-25' },
    flatFee: 4000,
    fee: 0,
    total: 124180,
    bodyText: 'Bitte zahle bis zum 08.03.2026.',
    salutation: 'Sehr geehrte Damen und Herren,'
  };

  const html = documentHtml.renderReminder(
    reminder,
    invoice(),
    COMPANY,
    CUSTOMER,
    { theme: DEFAULT_THEME }
  );

  assert.ok(html.includes('Erste Mahnung'));
  assert.ok(html.includes('RE-2026-0007'));
  assert.ok(html.includes('1.190,00'), 'die offene Forderung');
  assert.ok(html.includes('Verzugszinsen'));
  assert.ok(html.includes('11,8'), 'die Zinsen in Euro');
  assert.ok(html.includes('§288 Abs. 5 BGB'));
  assert.ok(html.includes('1.241,80'), 'die Gesamtforderung');
  assert.ok(html.includes('Zu zahlen'));
});

test('Ohne Zinsen und Pauschale bleibt das Schreiben schlicht', () => {
  const html = documentHtml.renderReminder(
    {
      levelLabel: 'Zahlungserinnerung',
      date: '2026-02-10', deadline: '2026-02-20',
      open: 119000, overdueDays: 17,
      interest: { amount: 0, days: 0, rate: 0, since: null },
      flatFee: 0, fee: 0, total: 119000,
      bodyText: 'Bitte gleiche die Rechnung aus.'
    },
    invoice(), COMPANY, CUSTOMER, { theme: DEFAULT_THEME }
  );

  assert.ok(html.includes('Zahlungserinnerung'));
  assert.ok(!html.includes('Verzugszinsen'));
  assert.ok(!html.includes('§288'));
});

/* ------------------------------------------------------------------ Fristen */

function data(overrides = {}) {
  return {
    settings: SETTINGS,
    entries: [],
    invoices: [],
    customers: [BUSINESS],
    projects: [],
    recurrences: [],
    assets: [],
    receipts: [],
    ...overrides
  };
}

test('Der Kalender sammelt Voranmeldungen und Jahreserklärungen', () => {
  const result = deadlines.collect(data(), 2026, '2026-05-15');
  const kinds = new Set(result.items.map((i) => i.kind));

  assert.ok(kinds.has('vat'), 'Voranmeldungen sind dabei');
  assert.ok(kinds.has('annual'), 'Jahreserklärungen auch');
  assert.ok(result.items.every((i) => i.date <= '2026-11-11'), 'nichts jenseits des Horizonts');
});

test('Termine sind nach Datum sortiert und tragen ihre Dringlichkeit', () => {
  const result = deadlines.collect(data(), 2026, '2026-05-15');
  const dates = result.items.map((i) => i.date);
  assert.deepEqual(dates, [...dates].sort(), 'aufsteigend nach Datum');

  for (const item of result.items) {
    if (item.days < 0) assert.equal(item.urgency, 'overdue');
    else if (item.days <= 3) assert.equal(item.urgency, 'today');
    else if (item.days <= 14) assert.equal(item.urgency, 'soon');
    else assert.equal(item.urgency, 'later');
  }
});

test('Offene Rechnungen und ablaufende Angebote stehen im Kalender', () => {
  const result = deadlines.collect(
    data({
      invoices: [
        invoice({ dueDate: '2026-06-01' }),
        {
          id: 'an_1', number: 'AN-2026-0001', documentType: 'quote', status: 'sent',
          issueDate: '2026-05-01', validUntil: '2026-06-10',
          items: [{ name: 'x', quantity: 1, unitPriceNet: 50000, vatRate: 19 }], payments: []
        }
      ]
    }),
    2026,
    '2026-05-15'
  );

  assert.ok(result.items.some((i) => i.title.includes('Zahlungseingang RE-2026-0007')));
  assert.ok(result.items.some((i) => i.title.includes('Bindefrist AN-2026-0001')));
});

test('Eine mahnfähige Rechnung erscheint als Mahntermin für heute', () => {
  const result = deadlines.collect(
    data({ invoices: [invoice()] }),
    2026,
    '2026-03-01'
  );
  const reminder = result.items.find((i) => i.kind === 'dunning');

  assert.ok(reminder, 'der Mahntermin ist da');
  assert.equal(reminder.date, '2026-03-01', 'er steht auf heute');
  assert.match(reminder.title, /Zahlungserinnerung/);
});

test('Überfälliges und Heutiges ergeben die dringende Zahl', () => {
  const result = deadlines.collect(data({ invoices: [invoice()] }), 2026, '2026-03-01');
  assert.equal(result.pressing, result.counts.overdue + result.counts.today);
  assert.ok(result.pressing >= 1);
});

test('Nach Monaten gruppiert bleibt die Reihenfolge erhalten', () => {
  const result = deadlines.collect(data(), 2026, '2026-05-15');
  const groups = deadlines.groupByMonth(result.items);

  assert.ok(groups.length > 0);
  assert.deepEqual(groups.map((g) => g.key), [...groups.map((g) => g.key)].sort());
  assert.equal(
    groups.reduce((sum, g) => sum + g.items.length, 0),
    result.items.length,
    'kein Termin geht beim Gruppieren verloren'
  );
});

test('Nachholtermine einer Vorlage werden zu einer Zeile zusammengefasst', () => {
  const recurring = require('../../src/domain/recurring');
  const template = recurring.normalize({
    id: 'wdh_1', kind: 'entry', label: 'Büromiete', markPaid: true,
    rule: { interval: 'monthly', startDate: '2026-01-01' },
    template: { type: 'expense', amount: 71400, categoryId: 'exp_rent', description: 'Miete' }
  });

  const result = deadlines.collect(data({ recurrences: [template] }), 2026, '2026-05-15');
  const rows = result.items.filter((i) => i.kind === 'recurring');

  // Fünf offene Termine von Januar bis Mai, aber nur eine Zeile dafür.
  const catchUp = rows.filter((r) => r.date === '2026-05-15');
  assert.equal(catchUp.length, 1, 'der Nachholbedarf steht in einer einzigen Zeile');
  assert.match(catchUp[0].detail, /5 Termine nachzuholen/);
  assert.equal(catchUp[0].amount, 71400 * 5, 'die Summe aller offenen Termine');

  const future = rows.filter((r) => r.date > '2026-05-15');
  assert.equal(future.length, 1, 'dazu der nächste künftige Termin');
  assert.equal(future[0].date, '2026-06-01');
});

test('Ein einzelner Nachholtermin wird als solcher benannt', () => {
  const recurring = require('../../src/domain/recurring');
  const template = recurring.normalize({
    id: 'wdh_2', kind: 'entry', label: 'Versicherung',
    rule: { interval: 'yearly', startDate: '2026-03-01' },
    template: { type: 'expense', amount: 32500, categoryId: 'exp_insurance', description: 'Beitrag' }
  });

  const result = deadlines.collect(data({ recurrences: [template] }), 2026, '2026-05-15');
  const row = result.items.find((i) => i.kind === 'recurring');
  assert.match(row.detail, /Termin vom 01.03.2026/);
});

test('Ein Filter auf Arten blendet die übrigen aus', () => {
  const result = deadlines.collect(data({ invoices: [invoice()] }), 2026, '2026-03-01', { kinds: ['dunning'] });
  assert.ok(result.items.length > 0);
  assert.ok(result.items.every((i) => i.kind === 'dunning'));
});

test('Die Abgabefrist der Jahreserklärung fällt nie auf ein Wochenende', () => {
  for (const year of [2026, 2027, 2028, 2029, 2030]) {
    const result = deadlines.collect(data(), year, `${year}-01-05`);
    const annual = result.items.filter((i) => i.kind === 'annual');
    for (const item of annual) {
      const day = new Date(`${item.date}T00:00:00Z`).getUTCDay();
      assert.ok(day !== 0 && day !== 6, `${item.date} ist ein Wochenende`);
    }
  }
});
