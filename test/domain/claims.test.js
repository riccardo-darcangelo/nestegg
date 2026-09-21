'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const claims = require('../../src/domain/claims');

function claim(overrides = {}) {
  return claims.normalizeClaim({
    id: 'anp_1',
    memberId: 'mg_1',
    name: 'Erika Musterfrau',
    basis: 'bylaws',
    basisDate: '2020-03-01',
    kind: 'travel',
    date: '2026-05-18',
    description: 'Fahrt zum Turnier nach München',
    kilometers: 180,
    sphereId: 'ideell',
    ...overrides
  });
}

/* ------------------------------------------------------------------ Datensatz */

test('Fahrtkosten rechnet die App aus den Kilometern', () => {
  assert.equal(claim().amount, 5400, '180 km zu 0,30 Euro');
  assert.equal(claims.KILOMETER_RATE, 30);
});

test('Bei allen anderen Arten gilt der erfasste Betrag', () => {
  const material = claim({ kind: 'material', amount: 4250, kilometers: 0 });
  assert.equal(material.amount, 4250);
});

test('Ein Anspruch ohne Grundlagendatum wird abgelehnt', () => {
  const errors = claims.validateClaim(claim({ basisDate: null }));
  assert.match(errors.join(' '), /Anspruchsgrundlage/);
});

test('Ohne Beschreibung und ohne Datum geht es nicht', () => {
  const errors = claims.validateClaim(claim({ description: '', date: null }));
  assert.equal(errors.length, 2);
});

/* ------------------------------------------------------------------ Erste Voraussetzung */

test('Der Anspruch muss vor der Tätigkeit bestanden haben', () => {
  const nachtraeglich = claims.check(claim({ basisDate: '2026-06-01' }), { today: '2026-06-15' });

  assert.equal(nachtraeglich.ok, false);
  assert.match(nachtraeglich.blocking.join(' '), /vor der Tätigkeit/);
});

test('Am selben Tag eingeräumt reicht', () => {
  const result = claims.check(claim({ basisDate: '2026-05-18' }), {
    today: '2026-05-20', fundsAtBasisDate: 500000
  });
  assert.equal(result.ok, true);
});

test('Ein Vorstandsbeschluss allein trägt nicht', () => {
  const ohne = claims.check(claim({ basis: 'board' }), { today: '2026-05-20', fundsAtBasisDate: 500000 });
  assert.equal(ohne.ok, false);
  assert.match(ohne.blocking.join(' '), /Satzung den Vorstand/);

  const mit = claims.check(claim({ basis: 'board', bylawsClause: true }), {
    today: '2026-05-20', fundsAtBasisDate: 500000
  });
  assert.equal(mit.ok, true, 'mit Ermächtigung in der Satzung schon');
});

test('Satzung und Vertrag tragen für sich', () => {
  assert.equal(claims.getBasis('bylaws').sufficient, true);
  assert.equal(claims.getBasis('contract').sufficient, true);
  assert.equal(claims.getBasis('board').sufficient, false);
});

/* ------------------------------------------------------------------ Zweite Voraussetzung */

test('Wer nie zahlen konnte, hat nichts zu erlassen', () => {
  const arm = claims.check(claim(), { today: '2026-05-20', fundsAtBasisDate: 1000 });

  assert.equal(arm.ok, false);
  assert.match(arm.blocking.join(' '), /nie leisten konnte/);
});

test('Ohne gepflegten Kontostand wird nichts unterstellt', () => {
  const unklar = claims.check(claim(), { today: '2026-05-20', fundsAtBasisDate: null });

  assert.equal(unklar.ok, true, 'es blockiert nicht');
  assert.match(unklar.warnings.join(' '), /kann die App nicht belegen/);
});

test('Der Kontostand wird auf den Stichtag fortgeschrieben', () => {
  const data = {
    settings: { reserve: { accountBalance: 100000, accountBalanceDate: '2025-12-31' } },
    entries: [
      { type: 'income', gross: 50000, paidDate: '2026-01-15' },
      { type: 'expense', gross: 20000, paidDate: '2026-02-01' },
      { type: 'expense', gross: 90000, paidDate: '2026-12-01' },
      { type: 'income', gross: 70000, paidDate: null }
    ]
  };

  assert.equal(claims.fundsOn(data, '2026-03-01'), 130000, 'nur was bis dahin geflossen ist');
  assert.equal(claims.fundsOn(data, '2026-12-31'), 40000);
  assert.equal(claims.fundsOn(data, '2025-12-31'), 100000, 'am Stichtag der Stand selbst');
});

test('Ohne hinterlegten Stand gibt es keine Zahl', () => {
  assert.equal(claims.fundsOn({ settings: {}, entries: [] }, '2026-05-01'), null);
});

/* ------------------------------------------------------------------ Dritte Voraussetzung */

test('Die Frist für den Verzicht läuft drei Monate', () => {
  const result = claims.check(claim(), { today: '2026-05-20', fundsAtBasisDate: 500000 });
  assert.equal(result.deadline, '2026-08-18');
  assert.equal(claims.WAIVER_MONTHS, 3);
});

test('Ein Verzicht innerhalb der Frist geht durch', () => {
  const result = claims.check(claim({ waivedAt: '2026-07-01' }), { today: '2026-07-02', fundsAtBasisDate: 500000 });
  assert.equal(result.ok, true);
  assert.equal(result.waived, true);
});

test('Ein verspäteter Verzicht wird abgelehnt', () => {
  const result = claims.check(claim({ waivedAt: '2026-09-01' }), { today: '2026-09-02', fundsAtBasisDate: 500000 });

  assert.equal(result.ok, false);
  assert.match(result.blocking.join(' '), /binnen drei Monaten/);
});

test('Verzichten lässt sich nur auf einen entstandenen Anspruch', () => {
  const result = claims.check(claim({ waivedAt: '2026-05-01' }), { today: '2026-05-20', fundsAtBasisDate: 500000 });
  assert.match(result.blocking.join(' '), /älter als die Tätigkeit/);
});

test('Eine abgelaufene Frist ohne Verzicht ist nicht zu heilen', () => {
  const result = claims.check(claim(), { today: '2026-09-01', fundsAtBasisDate: 500000 });

  assert.equal(result.ok, false);
  assert.match(result.blocking.join(' '), /Der Anspruch bleibt bestehen/);
});

test('Kurz vor Fristende wird gewarnt', () => {
  const result = claims.check(claim(), { today: '2026-08-05', fundsAtBasisDate: 500000 });

  assert.equal(result.ok, true);
  assert.match(result.warnings.join(' '), /13 Tage/);
});

test('Der Monatssprung trifft auch den 31.', () => {
  assert.equal(claims.addMonths('2026-05-31', 3), '2026-08-31');
  assert.equal(claims.addMonths('2026-11-30', 3), '2027-02-28', 'der Februar hat keinen 30.');
  assert.equal(claims.addMonths('2026-12-15', 3), '2027-03-15');
});

/* ------------------------------------------------------------------ Buchungen */

test('Eine Aufwandsspende sind zwei Buchungen, kein durchlaufender Posten', () => {
  const result = claims.toEntries(claim({ waivedAt: '2026-06-01' }), {
    expenseCategoryId: 'cl_exp_sports', donationCategoryId: 'cl_inc_donation'
  });

  assert.equal(result.expense.type, 'expense');
  assert.equal(result.donation.type, 'income');
  assert.equal(result.expense.amount, result.donation.amount, 'gleicher Betrag');
  assert.equal(result.expense.amount, 5400);
});

test('Beide tragen den Tag des Verzichts als Zahlungsdatum', () => {
  // Der Verzicht bewirkt Zufluss und Abfluss im selben Augenblick.
  const result = claims.toEntries(claim({ waivedAt: '2026-06-01' }), {});

  assert.equal(result.expense.date, '2026-06-01');
  assert.equal(result.expense.paidDate, '2026-06-01');
  assert.equal(result.donation.paidDate, '2026-06-01');
});

test('Die Spende gehört in den ideellen Bereich, der Aufwand nicht zwingend', () => {
  const result = claims.toEntries(claim({ waivedAt: '2026-06-01', sphereId: 'zweckbetrieb' }), {});

  assert.equal(result.expense.sphereId, 'zweckbetrieb', 'wo die Tätigkeit stattfand');
  assert.equal(result.donation.sphereId, 'ideell', 'die Spende immer hier');
});

test('Beide Buchungen sind ohne Umsatzsteuer', () => {
  const result = claims.toEntries(claim({ waivedAt: '2026-06-01' }), {});
  assert.equal(result.expense.vatRate, 0);
  assert.equal(result.donation.vatRate, 0);
});

test('Die Spende trägt das Kennzeichen für die Bestätigung', () => {
  const result = claims.toEntries(claim({ waivedAt: '2026-06-01' }), {});
  assert.equal(result.donation.waiver, true, 'das Kreuz im amtlichen Muster');
});

test('Die Kilometer stehen in der Beschreibung', () => {
  const result = claims.toEntries(claim({ waivedAt: '2026-06-01' }), {});

  assert.match(result.expense.description, /180 km/);
  assert.match(result.expense.description, /Fahrtkosten/);
  assert.match(result.donation.description, /Aufwandsspende Erika Musterfrau/);
});

test('Beide Buchungen bleiben am Anspruch hängen', () => {
  const result = claims.toEntries(claim({ waivedAt: '2026-06-01' }), {});

  assert.equal(result.expense.claimId, 'anp_1');
  assert.equal(result.donation.claimId, 'anp_1');
  assert.equal(result.expense.memberId, 'mg_1');
});

/* ------------------------------------------------------------------ Übersicht */

test('Die Übersicht trennt offene von erklärten Verzichten', () => {
  const list = [
    claim({ id: 'a' }),
    claim({ id: 'b', waivedAt: '2026-06-01' }),
    claim({ id: 'c', date: '2025-05-18' })
  ];

  const result = claims.overview(list, 2026, { today: '2026-06-15' });

  assert.equal(result.rows.length, 2, 'das Vorjahr bleibt draußen');
  assert.equal(result.open.length, 1);
  assert.equal(result.waived.length, 1);
  assert.equal(result.total, 5400, 'nur der erklärte Verzicht zählt');
  assert.equal(result.openTotal, 5400);
});

test('Was bald abläuft, steht vorn', () => {
  const list = [
    claim({ id: 'a', date: '2026-05-18' }),
    claim({ id: 'b', date: '2026-04-01' }),
    claim({ id: 'c', date: '2026-06-01' })
  ];

  const result = claims.overview(list, 2026, { today: '2026-06-15' });
  assert.deepEqual(result.dueSoon.map((row) => row.id), ['b', 'a', 'c']);
});

test('Die Übersicht rechnet die Leistungsfähigkeit je Anspruch', () => {
  const result = claims.overview([claim()], 2026, {
    today: '2026-06-15',
    fundsFor: () => 100
  });

  assert.equal(result.blocked.length, 1);
  assert.match(result.rows[0].check.blocking.join(' '), /nie leisten konnte/);
});

/* ------------------------------------------------------------------ Bis zur Bestätigung */

const donations = require('../../src/domain/donations');

function clubSettings() {
  return {
    entity: {
      kind: 'club', charitable: true, purpose: 'des Sports',
      noticeType: 'freistellung', noticeDate: '2025-04-10',
      noticeOffice: 'Augsburg-Stadt', noticeYear: '2024',
      boardName: 'Vorname Nachname', boardRole: 'Erster Vorstand'
    },
    company: { name: 'Turnverein Musterstadt e. V.', street: 'Weg 1', zip: '86150', city: 'Augsburg', taxNumber: '103/456/78901' }
  };
}

const DONOR = { name: 'Erika Musterfrau', street: 'Beispielweg 3', zip: '86150', city: 'Augsburg' };

function donationEntry(overrides = {}) {
  return {
    id: 'b1', type: 'income', paidDate: '2026-06-02', gross: 5400,
    categoryId: 'cl_inc_donation', description: 'Spende', ...overrides
  };
}

test('Die Bestätigung kreuzt den Verzicht von selbst an', () => {
  // Wer das Kreuz von Hand setzen müsste, vergisst es.
  const aus = donations.prepare([donationEntry()], clubSettings(), DONOR, { year: 2026 });
  assert.equal(aus.waiver, false);

  const an = donations.prepare([donationEntry({ waiver: true })], clubSettings(), DONOR, { year: 2026 });
  assert.equal(an.waiver, true);
});

test('Aufwandsspende und Geldspende gehören nicht in dieselbe Bestätigung', () => {
  // Das amtliche Muster kennt nur ein Kreuz für die ganze Bestätigung.
  const gemischt = donations.prepare([
    donationEntry({ id: 'b1', waiver: true }),
    donationEntry({ id: 'b2', gross: 10000 })
  ], clubSettings(), DONOR, { year: 2026 });

  assert.match(gemischt.warnings.join(' '), /getrennte Bestätigungen/);
});

test('Lauter Aufwandsspenden zusammen sind in Ordnung', () => {
  const rein = donations.prepare([
    donationEntry({ id: 'b1', waiver: true }),
    donationEntry({ id: 'b2', gross: 10000, waiver: true })
  ], clubSettings(), DONOR, { year: 2026 });

  assert.equal(rein.waiver, true);
  assert.ok(!rein.warnings.join(' ').includes('getrennte Bestätigungen'));
});

test('Die Übersicht zählt Aufwandsspenden gesondert', () => {
  const result = donations.overview([
    donationEntry({ id: 'b1', memberId: 'mg_1', counterparty: 'Erika Musterfrau', waiver: true }),
    donationEntry({ id: 'b2', memberId: 'mg_1', counterparty: 'Erika Musterfrau', gross: 10000 })
  ], [{ id: 'mg_1', name: 'Erika Musterfrau', street: 'Weg 3', city: 'Augsburg' }], 2026);

  assert.equal(result.donors.length, 1);
  assert.equal(result.donors[0].total, 15400);
  assert.equal(result.donors[0].waiver, 5400, 'davon aus einem Verzicht');
});
