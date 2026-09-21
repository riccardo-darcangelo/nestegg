'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const time = require('../../src/domain/timetracking');

function entry(overrides = {}) {
  return time.normalizeTime({
    id: 't1', date: '2026-09-01', projectId: 'prj_1', description: 'Entwicklung',
    minutes: 90, rateCents: 9000, ...overrides
  });
}

/* ------------------------------------------------------------------ Dauer */

test('Minuten werden als Stunden und Minuten gelesen', () => {
  assert.equal(time.durationText(90), '1:30');
  assert.equal(time.durationText(0), '0:00');
  assert.equal(time.durationText(605), '10:05');
});

test('Für die Rechnung werden Minuten zu Dezimalstunden', () => {
  assert.equal(time.decimalHours(90), 1.5);
  assert.equal(time.decimalHours(20), 0.33);
  assert.equal(time.decimalHours(45), 0.75);
});

test('Der Betrag eines Eintrags ist Dauer mal Satz, auf Cent gerundet', () => {
  assert.equal(time.amountOf(entry({ minutes: 90, rateCents: 9000 })), 13500);
  assert.equal(time.amountOf(entry({ minutes: 20, rateCents: 10000 })), 3333);
  assert.equal(time.amountOf(entry({ billable: false })), 0, 'nicht abrechenbar ist nicht abrechenbar');
  assert.equal(time.amountOf(entry({ rateCents: 0 })), 0);
});

/* ------------------------------------------------------------------ Uhr */

test('Eine laufende Aufnahme ist ein Eintrag ohne Dauer', () => {
  const list = [entry(), entry({ id: 't2', minutes: 0, startedAt: '2026-09-17T09:00:00.000Z' })];
  const laufend = time.running(list);

  assert.equal(laufend.id, 't2');
  assert.equal(time.running([entry()]), null);
});

test('Die laufende Dauer rechnet sich aus der Startzeit', () => {
  const start = new Date('2026-09-17T09:00:00.000Z');
  const jetzt = new Date('2026-09-17T10:37:00.000Z').getTime();
  assert.equal(time.runningMinutes({ startedAt: start.toISOString() }, jetzt), 97);
});

test('Beim Stoppen wird gerundet, während des Laufens nicht', () => {
  const start = '2026-09-17T09:00:00.000Z';
  const jetzt = new Date('2026-09-17T09:17:00.000Z').getTime();
  const laufend = time.normalizeTime({ id: 't1', startedAt: start, minutes: 0, description: 'Arbeit' });

  assert.equal(time.runningMinutes(laufend, jetzt), 17, 'die Uhr zeigt die Wahrheit');

  const gestoppt = time.stop(laufend, { roundToMinutes: 15, roundUp: true }, jetzt);
  assert.equal(gestoppt.minutes, 30, 'angefangene Viertelstunden zählen');
  assert.equal(gestoppt.startedAt, null);
});

test('Eine sehr kurze Aufnahme ergibt mindestens eine Einheit', () => {
  const start = '2026-09-17T09:00:00.000Z';
  const jetzt = new Date('2026-09-17T09:00:30.000Z').getTime();
  const gestoppt = time.stop(time.normalizeTime({ startedAt: start, description: 'x' }), { roundToMinutes: 15 }, jetzt);
  assert.equal(gestoppt.minutes, 15);
});

test('Rundung lässt sich auf kaufmännisch stellen', () => {
  assert.equal(time.roundMinutes(17, { roundToMinutes: 15, roundUp: true }), 30);
  assert.equal(time.roundMinutes(17, { roundToMinutes: 15, roundUp: false }), 15);
  assert.equal(time.roundMinutes(23, { roundToMinutes: 15, roundUp: false }), 30);
  assert.equal(time.roundMinutes(17, { roundToMinutes: 1 }), 17);
});

/* ------------------------------------------------------------------ Summen */

test('Die Zusammenfassung trennt erfasst, abrechenbar und offen', () => {
  const list = [
    entry({ id: 't1', minutes: 60 }),
    entry({ id: 't2', minutes: 120, billable: false }),
    entry({ id: 't3', minutes: 30, invoiceId: 're_1' }),
    entry({ id: 't4', minutes: 0, startedAt: '2026-09-17T09:00:00.000Z' })
  ];
  const summary = time.summarize(list);

  assert.equal(summary.count, 3, 'die laufende Aufnahme zählt noch nicht');
  assert.equal(summary.minutes, 210);
  assert.equal(summary.billableMinutes, 90);
  assert.equal(summary.openMinutes, 60, 'abgerechnetes ist nicht mehr offen');
  assert.equal(summary.openAmount, 9000);
  assert.equal(summary.invoicedAmount, 4500);
});

test('Nach Projekt gruppiert steht das Offenste oben', () => {
  const projects = [
    { id: 'prj_1', name: 'Relaunch', customerId: 'kd_1' },
    { id: 'prj_2', name: 'Wartung', customerId: 'kd_2' }
  ];
  const list = [
    entry({ id: 't1', projectId: 'prj_1', minutes: 60 }),
    entry({ id: 't2', projectId: 'prj_2', minutes: 300 }),
    entry({ id: 't3', projectId: null, minutes: 30 })
  ];

  const groups = time.byProject(list, projects);
  assert.equal(groups[0].name, 'Wartung');
  assert.equal(groups[0].openMinutes, 300);
  assert.ok(groups.some((group) => group.name === 'ohne Projekt'));
});

test('Der Monatsverlauf hat immer zwölf Monate', () => {
  const months = time.byMonth([entry({ date: '2026-03-04', minutes: 120 })], 2026);
  assert.equal(months.length, 12);
  assert.equal(months[2].minutes, 120);
  assert.equal(months[0].minutes, 0);
});

/* ------------------------------------------------------------------ Rechnung */

test('Zusammengefasst ergibt eine Zeile je Stundensatz', () => {
  const items = time.toInvoiceItems([
    entry({ id: 't1', date: '2026-09-01', minutes: 90, rateCents: 9000, description: 'Entwicklung' }),
    entry({ id: 't2', date: '2026-09-05', minutes: 150, rateCents: 9000, description: 'Abstimmung' }),
    entry({ id: 't3', date: '2026-09-06', minutes: 60, rateCents: 12000, description: 'Notdienst' })
  ], {});

  assert.equal(items.length, 2);
  assert.equal(items[0].quantity, 4, '90 plus 150 Minuten sind vier Stunden');
  assert.equal(items[0].unitPriceNet, 9000);
  assert.equal(items[0].unit, 'HUR');
  assert.match(items[0].description, /01\.09\.2026 bis 05\.09\.2026/);
  assert.match(items[0].description, /Entwicklung, Abstimmung/);
});

test('Tagesweise ergibt eine Zeile je Tag', () => {
  const items = time.toInvoiceItems([
    entry({ id: 't1', date: '2026-09-01', minutes: 90 }),
    entry({ id: 't2', date: '2026-09-01', minutes: 30 }),
    entry({ id: 't3', date: '2026-09-02', minutes: 60 })
  ], { mode: 'daily' });

  assert.equal(items.length, 2);
  assert.equal(items[0].quantity, 2, 'der erste Tag hat zwei Stunden');
  assert.match(items[0].name, /01\.09\.2026/);
});

test('Einzeln ergibt eine Zeile je Eintrag', () => {
  const items = time.toInvoiceItems([entry({ id: 't1' }), entry({ id: 't2' })], { mode: 'single' });
  assert.equal(items.length, 2);
  assert.equal(items[0].quantity, 1.5);
});

test('Abgerechnetes und nicht Abrechenbares bleibt draußen', () => {
  const items = time.toInvoiceItems([
    entry({ id: 't1', invoiceId: 're_1' }),
    entry({ id: 't2', billable: false }),
    entry({ id: 't3', startedAt: '2026-09-17T09:00:00.000Z', minutes: 0 })
  ], {});

  assert.deepEqual(items, [], 'nichts Offenes, also keine Positionen');
});

/* ------------------------------------------------------------------ Satz */

test('Der Stundensatz kommt vom Projekt, sonst aus den Einstellungen', () => {
  const projects = [{ id: 'prj_1', name: 'X', hourlyRateCents: 11000 }];
  const settings = { time: { defaultRateCents: 8000 } };

  assert.equal(time.rateFor('prj_1', projects, settings), 11000);
  assert.equal(time.rateFor(null, projects, settings), 8000);
  assert.equal(time.rateFor('prj_1', [{ id: 'prj_1', name: 'X' }], settings), 8000, 'ohne eigenen Satz die Vorgabe');
});

test('Ein Eintrag hält seinen Satz fest, auch wenn das Projekt sich ändert', () => {
  const gebucht = entry({ rateCents: 9000 });
  // Der Satz steht am Eintrag: eine spätere Erhöhung am Projekt darf
  // Vergangenes nicht teurer machen.
  assert.equal(gebucht.rateCents, 9000);
});

/* ------------------------------------------------------------------ Prüfung */

test('Ein Eintrag ohne Dauer und ohne laufende Uhr wird abgelehnt', () => {
  const errors = time.validateTime(time.normalizeTime({ description: 'x', minutes: 0 }));
  assert.match(errors.join(' '), /Dauer ist null/);
});

test('Mehr als ein Tag Arbeit an einem Tag ist ein Tippfehler', () => {
  const errors = time.validateTime(time.normalizeTime({ description: 'x', minutes: 2000 }));
  assert.match(errors.join(' '), /vierundzwanzig Stunden/);
});
