'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const datev = require('../../src/export/datev');
const { defaultSettings } = require('../../src/storage/store');
const entriesDomain = require('../../src/domain/entries');

function entry(overrides = {}) {
  return entriesDomain.normalizeEntry({
    type: 'expense', date: '2026-03-01', paidDate: '2026-03-02', amount: 11900,
    categoryId: 'exp_software', description: 'Hosting', counterparty: 'Hetzner', ...overrides
  });
}

function data(entries, settingsPatch = {}) {
  const settings = defaultSettings();
  settings.company.name = 'Beispiel Consulting';
  Object.assign(settings, settingsPatch);
  return { settings, entries, invoices: [], customers: [] };
}

test('Der Stapel beginnt mit Kennung, Version und Datenkategorie', () => {
  const result = datev.buildBookingBatch(data([entry()]), 2026, {});
  const [header, columns] = result.content.split('\r\n');

  assert.ok(header.startsWith('"EXTF";700;21;"Buchungsstapel"'));
  assert.ok(columns.startsWith('"Umsatz (ohne Soll/Haben-Kz)";"Soll/Haben-Kennzeichen"'));
  assert.equal(result.count, 1);
});

test('Eine Ausgabe bucht gegen das Bankkonto, eine Einnahme ebenso', () => {
  const result = datev.buildBookingBatch(data([
    entry(),
    entry({ type: 'income', categoryId: 'inc_services', amount: 238000, paidDate: '2026-04-05' })
  ]), 2026, {});

  const lines = result.content.trim().split('\r\n').slice(2);
  const [ausgabe, einnahme] = lines;

  assert.ok(ausgabe.startsWith('119,00;S;'), 'Ausgabe mit Soll-Kennzeichen');
  assert.ok(ausgabe.includes(';4980;1200;'), 'Aufwandskonto gegen Bank, SKR 03');
  assert.ok(einnahme.startsWith('2380,00;H;'), 'Einnahme mit Haben-Kennzeichen');
  assert.ok(einnahme.includes(';8400;1200;'), 'Erlöskonto gegen Bank');
});

test('Beträge tragen Komma und keinen Tausenderpunkt', () => {
  const result = datev.buildBookingBatch(data([entry({ amount: 1234567 })]), 2026, {});
  assert.ok(result.content.includes('12345,67;S;'));
  assert.equal(datev.amount(100000), '1000,00');
});

test('Das Belegdatum steht als Tag und Monat', () => {
  assert.equal(datev.datevDate('2026-03-02'), '0203');
  assert.equal(datev.datevDate(''), '');
});

test('Der Steuerschlüssel folgt Art und Satz', () => {
  assert.equal(datev.buKey({ type: 'expense', vatRate: 19 }), '9');
  assert.equal(datev.buKey({ type: 'expense', vatRate: 7 }), '8');
  assert.equal(datev.buKey({ type: 'income', vatRate: 19 }), '3');
  assert.equal(datev.buKey({ type: 'income', vatRate: 7 }), '2');
  assert.equal(datev.buKey({ type: 'expense', vatRate: 0 }), '');
  assert.equal(datev.buKey({ type: 'expense', vatRate: 19, reverseCharge: true }), '94');
});

test('Ohne Zahlungsdatum gibt es keine Zeile, aber einen Hinweis', () => {
  const result = datev.buildBookingBatch(data([
    entry(),
    entry({ paidDate: null, date: '2026-05-01' })
  ]), 2026, {});

  assert.equal(result.count, 1, 'nur die geflossene Buchung');
  assert.equal(result.skipped, 1, 'die offene wird gemeldet, nicht verschwiegen');
});

test('Nur Zahlungen des gewählten Jahres kommen in den Stapel', () => {
  const result = datev.buildBookingBatch(data([
    entry({ paidDate: '2025-12-30' }),
    entry({ paidDate: '2026-01-02' }),
    entry({ paidDate: '2027-01-02' })
  ]), 2026, {});

  assert.equal(result.count, 1);
});

test('SKR 04 verwendet andere Konten', () => {
  const result = datev.buildBookingBatch(data([entry()]), 2026, { chart: 'skr04' });
  assert.ok(result.content.includes(';6837;1800;'), 'Software gegen Bank im SKR 04');
  assert.equal(result.chart, 'SKR 04');
});

test('Eigene Konten aus den Einstellungen schlagen den Vorschlag', () => {
  const result = datev.buildBookingBatch(
    data([entry()], { datev: { chart: 'skr03', accounts: { exp_software: '4999' } } }),
    2026, {}
  );
  assert.ok(result.content.includes(';4999;1200;'));
});

test('Die Zahlungsart entscheidet über das Gegenkonto', () => {
  const result = datev.buildBookingBatch(data([
    entry({ paymentMethod: 'cash' }),
    entry({ paymentMethod: 'paypal', paidDate: '2026-03-03' })
  ]), 2026, {});

  const lines = result.content.trim().split('\r\n').slice(2);
  assert.ok(lines[0].includes(';4980;1000;'), 'Kasse');
  assert.ok(lines[1].includes(';4980;1210;'), 'PayPal');
});

test('Semikolon und Anführungszeichen im Text zerlegen die Zeile nicht', () => {
  const result = datev.buildBookingBatch(data([
    entry({ description: 'Hosting; "Server"', counterparty: 'Firma' })
  ]), 2026, {});

  const line = result.content.trim().split('\r\n')[2];
  assert.ok(line.includes('"Firma Hosting   Server"'), 'Sonderzeichen werden entschärft');
  assert.equal(line.split(';').length, datev.COLUMNS.length, 'die Spaltenzahl stimmt');
});

test('Die Kontenzuordnung lässt sich vollständig nachsehen', () => {
  const map = datev.accountMap(defaultSettings(), 'skr03');
  assert.ok(map.length > 30);
  assert.ok(map.every((row) => row.account), 'jede Kategorie hat ein Konto');
  assert.equal(map.find((row) => row.id === 'exp_rent').account, '4210');
});

test('Eigene Konten sind als solche erkennbar', () => {
  const settings = defaultSettings();
  settings.datev = { chart: 'skr03', accounts: { exp_rent: '4211' } };
  const row = datev.accountMap(settings).find((item) => item.id === 'exp_rent');

  assert.equal(row.account, '4211');
  assert.equal(row.isCustom, true);
});

/* ------------------------------------------------------------------ Verein */

function clubData(entries, settingsPatch = {}) {
  const settings = defaultSettings();
  settings.company.name = 'Turnverein Musterstadt e. V.';
  settings.entity = { ...settings.entity, kind: 'club', charitable: true };
  Object.assign(settings, settingsPatch);
  return { settings, entries, invoices: [], customers: [] };
}

function clubEntry(overrides = {}) {
  return entriesDomain.normalizeEntry({
    type: 'income', date: '2026-03-01', paidDate: '2026-03-01', amount: 48000,
    categoryId: 'cl_inc_dues', sphereId: 'ideell', description: 'Beiträge', ...overrides
  });
}

test('Ein Verein bekommt den SKR 42, nicht den SKR 03', () => {
  const result = datev.buildBookingBatch(clubData([clubEntry()]), 2026, {});
  assert.equal(result.chart, 'SKR 42');
  assert.ok(result.content.includes(';40000;18000;'), 'Mitgliedsbeiträge gegen Bank');
});

test('Der Rahmen für Unternehmen lässt sich im Verein nicht wählen', () => {
  // Auch wenn aus einem früheren Profil noch SKR 03 in den Einstellungen steht.
  const result = datev.buildBookingBatch(
    clubData([clubEntry()], { datev: { chart: 'skr03', accounts: {} } }),
    2026, { chart: 'skr03' }
  );
  assert.equal(result.chart, 'SKR 42');
});

test('Umgekehrt bekommt ein Einzelunternehmen den SKR 42 nicht', () => {
  const charts = datev.chartsFor(defaultSettings()).map((chart) => chart.id);
  assert.deepEqual(charts, ['skr03', 'skr04']);

  const settings = defaultSettings();
  settings.entity = { ...settings.entity, kind: 'club' };
  assert.deepEqual(datev.chartsFor(settings).map((chart) => chart.id), ['skr42']);
});

test('Die Sphäre steht als Kostenstelle in der Zeile', () => {
  const result = datev.buildBookingBatch(clubData([
    clubEntry({ sphereId: 'ideell' }),
    clubEntry({ sphereId: 'vermoegen', categoryId: 'cl_inc_rent', paidDate: '2026-03-02' }),
    clubEntry({ sphereId: 'zweckbetrieb', categoryId: 'cl_inc_courses', paidDate: '2026-03-03' }),
    clubEntry({ sphereId: 'wirtschaftlich', categoryId: 'cl_inc_catering', paidDate: '2026-03-04' })
  ]), 2026, {});

  const cost = result.content.trim().split('\r\n').slice(2)
    .map((line) => line.split(';')[24]);

  assert.deepEqual(cost, ['"1"', '"2"', '"3"', '"4"']);
});

test('Ohne Sphäre geht die Buchung in den Sammelposten, nicht in den ideellen Bereich', () => {
  const result = datev.buildBookingBatch(clubData([clubEntry({ sphereId: null })]), 2026, {});
  assert.equal(result.content.trim().split('\r\n')[2].split(';')[24], '"9"');
  assert.equal(datev.SPHERE_COST_CENTERS.unassigned, '9');
});

test('Im Unternehmen bleibt die Kostenstelle der Geschäftsbereich', () => {
  const settings = defaultSettings();
  const bereich = settings.segments[0];
  const entry = entriesDomain.normalizeEntry({
    type: 'expense', date: '2026-03-01', paidDate: '2026-03-01', amount: 11900,
    categoryId: 'exp_software', description: 'Hosting', segmentId: bereich.id
  });

  const result = datev.buildBookingBatch({ settings, entries: [entry], invoices: [], customers: [] }, 2026, {});
  assert.equal(result.content.trim().split('\r\n')[2].split(';')[24], `"${bereich.label}"`);
});

test('Eine Kategorie ohne Konto bleibt leer und wird gemeldet', () => {
  // Für Schiedsrichterkosten ist im SKR 42 kein Konto hinterlegt.
  const result = datev.buildBookingBatch(clubData([
    clubEntry({ type: 'expense', categoryId: 'cl_exp_referee', sphereId: 'zweckbetrieb' })
  ]), 2026, {});

  const line = result.content.trim().split('\r\n')[2];
  assert.equal(line.split(';')[6], '', 'kein erfundenes Sammelkonto');
  assert.ok(result.unmapped.length, 'dafür ein Hinweis');
  assert.match(result.unmapped.join(' '), /Schiedsrichter/);
});

test('Die Kontenzuordnung des Vereins zeigt nur Vereinskategorien', () => {
  const settings = defaultSettings();
  settings.entity = { ...settings.entity, kind: 'club' };
  const map = datev.accountMap(settings, 'skr42');

  assert.ok(map.every((row) => row.id.startsWith('cl_')));
  assert.equal(map.find((row) => row.id === 'cl_inc_dues').account, '40000');
  assert.equal(map.find((row) => row.id === 'cl_exp_trainer').account, '60040');
});

test('Die Geldkonten des SKR 42 sind fünfstellig', () => {
  const result = datev.buildBookingBatch(clubData([
    clubEntry({ paymentMethod: 'cash' })
  ]), 2026, {});
  assert.ok(result.content.includes(';40000;16000;'), 'Kasse');
});
