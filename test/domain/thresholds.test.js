'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const thresholds = require('../../src/domain/thresholds');
const travel = require('../../src/domain/travel');
const { defaultSettings } = require('../../src/storage/store');
const entriesDomain = require('../../src/domain/entries');

function income(amount, paidDate, categoryId = 'inc_services') {
  return entriesDomain.normalizeEntry({
    type: 'income', date: paidDate, paidDate, amount, categoryId, description: 'Umsatz'
  });
}

/* ------------------------------------------------------------------ UStVA */

test('Bis 2.000 Euro Vorjahressteuer ist eine Befreiung möglich', () => {
  const settings = defaultSettings();
  // Bei 19 Prozent aus 10.000 Euro brutto entstehen rund 1.596 Euro Steuer.
  const advice = thresholds.vatPeriodAdvice([income(1000000, '2025-03-01')], settings, 2026);

  assert.equal(advice.recommended, 'exempt');
  assert.match(advice.notes.join(' '), /formloser Antrag/);
});

test('Über 9.000 Euro Vorjahressteuer ist monatlich abzugeben', () => {
  const settings = defaultSettings();
  const advice = thresholds.vatPeriodAdvice([income(10000000, '2025-03-01')], settings, 2026);

  assert.equal(advice.recommended, 'monthly');
  assert.equal(advice.matches, false, 'die App steht auf vierteljährlich');
  assert.match(advice.notes.join(' '), /monatlich abzugeben/);
});

test('Dazwischen bleibt es vierteljährlich', () => {
  const settings = defaultSettings();
  const advice = thresholds.vatPeriodAdvice([income(3000000, '2025-03-01')], settings, 2026);

  assert.equal(advice.recommended, 'quarterly');
  assert.equal(advice.matches, true);
});

test('Die Grenzen sind die ab 2025 geltenden', () => {
  assert.equal(thresholds.VAT_PERIOD_LIMITS.exemption, 200000, '2.000 Euro, vorher 1.000');
  assert.equal(thresholds.VAT_PERIOD_LIMITS.monthly, 900000, '9.000 Euro, vorher 7.500');
});

test('Auf die ersten beiden Jahre nach Gründung wird immer hingewiesen', () => {
  const advice = thresholds.vatPeriodAdvice([], defaultSettings(), 2026);
  assert.match(advice.notes.join(' '), /ersten beiden Jahre/);
});

/* ------------------------------------------------------------------ §19 */

test('Die Kleinunternehmergrenzen sind 25.000 und 100.000 Euro', () => {
  assert.equal(thresholds.SMALL_BUSINESS_LIMITS.previousYear, 2500000);
  assert.equal(thresholds.SMALL_BUSINESS_LIMITS.currentYear, 10000000);
});

test('Wer als Kleinunternehmer die 100.000 reißt, wird sofort gewarnt', () => {
  const watch = thresholds.smallBusinessWatch([income(10500000, '2026-08-01')], 2026, true);

  assert.equal(watch.status, 'exceeded');
  assert.match(watch.warnings.join(' '), /nicht erst ab dem nächsten Jahr/);
});

test('Ab achtzig Prozent der Grenze kommt der Hinweis vorher', () => {
  const watch = thresholds.smallBusinessWatch([income(8500000, '2026-08-01')], 2026, true);

  assert.equal(watch.status, 'close');
  assert.equal(watch.percent, 85);
});

test('Ein zu hoher Vorjahresumsatz beendet die Regelung für dieses Jahr', () => {
  const watch = thresholds.smallBusinessWatch([income(2600000, '2025-08-01')], 2026, true);
  assert.match(watch.warnings.join(' '), /Vorjahresumsatz lag über 25.000/);
});

test('Wer regelbesteuert ist, bekommt keine Kleinunternehmer-Warnungen', () => {
  const watch = thresholds.smallBusinessWatch([income(20000000, '2026-08-01')], 2026, false);
  assert.deepEqual(watch.warnings, []);
  assert.equal(watch.status, 'ok');
});

/* ------------------------------------------------------------------ Reise */

test('Die Pauschalen sind 14 und 28 Euro, der Kilometer 30 Cent', () => {
  assert.equal(travel.RATES.fullDay, 2800);
  assert.equal(travel.RATES.partialDay, 1400);
  assert.equal(travel.RATES.perKilometer, 30);
});

test('Gestellte Mahlzeiten kürzen vom vollen Tagessatz', () => {
  const voll = travel.dayAllowance({ kind: 'full' });
  assert.equal(voll.amount, 2800);

  const mitFruehstueck = travel.dayAllowance({ kind: 'full', breakfast: true });
  assert.equal(mitFruehstueck.cut, 560, 'zwanzig Prozent von 28 Euro');
  assert.equal(mitFruehstueck.amount, 2240);

  const alles = travel.dayAllowance({ kind: 'full', breakfast: true, lunch: true, dinner: true });
  assert.equal(alles.amount, 0, 'voll verpflegt bleibt nichts');
});

test('Auch am Anreisetag wird vom vollen Satz gekürzt', () => {
  const tag = travel.dayAllowance({ kind: 'arrival', breakfast: true });
  // 14 Euro Anreisetag minus 5,60 Euro Kürzung, nicht minus 2,80.
  assert.equal(tag.cut, 560);
  assert.equal(tag.amount, 840);
});

test('Eine mehrtägige Reise ergibt An-, Ab- und volle Tage', () => {
  const days = travel.daysBetween('2026-09-01', '2026-09-04');
  assert.deepEqual(days.map((d) => d.kind), ['arrival', 'full', 'full', 'departure']);
});

test('Ein einzelner Tag über acht Stunden ergibt den kleinen Satz', () => {
  const days = travel.daysBetween('2026-09-01', '2026-09-01');
  assert.deepEqual(days.map((d) => d.kind), ['partial']);
});

test('Eine Reise rechnet Verpflegung und Kilometer zusammen', () => {
  const result = travel.calculate({
    days: travel.daysBetween('2026-09-01', '2026-09-03'),
    kilometers: 240
  });

  assert.equal(result.meals, 1400 + 2800 + 1400);
  assert.equal(result.mileage, 7200, '240 Kilometer zu 30 Cent');
  assert.equal(result.total, 12800);
  assert.equal(result.dayCount, 3);
});

test('Aus einer Reise werden zwei Buchungen ohne Vorsteuer', () => {
  const trip = { from: '2026-09-01', to: '2026-09-03', description: 'Kundentermin Hamburg', kilometers: 240 };
  const result = travel.calculate({ ...trip, days: travel.daysBetween(trip.from, trip.to) });
  const entries = travel.toEntries(trip, result);

  assert.equal(entries.length, 2);
  assert.equal(entries[0].categoryId, 'exp_perdiem');
  assert.equal(entries[0].vatRate, 0, 'aus einer Pauschale gibt es keine Vorsteuer');
  assert.equal(entries[1].categoryId, 'exp_mileage');
  assert.equal(entries[1].amount, 7200);
  assert.match(entries[1].note, /0,30 Euro/);
});

test('Ohne Kilometer und ohne Tage entsteht keine Buchung', () => {
  const result = travel.calculate({ days: [], kilometers: 0 });
  assert.deepEqual(travel.toEntries({ from: '2026-09-01' }, result), []);
});
