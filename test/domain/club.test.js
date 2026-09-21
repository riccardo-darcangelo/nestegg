'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const spheres = require('../../src/domain/spheres');
const donations = require('../../src/domain/donations');
const receipt = require('../../src/export/donation-receipt');
const entriesDomain = require('../../src/domain/entries');
const categories = require('../../src/domain/categories');
const { defaultSettings } = require('../../src/storage/store');

function entry(overrides = {}) {
  return entriesDomain.normalizeEntry({
    type: 'income', date: '2026-03-01', paidDate: '2026-03-01', amount: 10000,
    categoryId: 'cl_inc_donation', description: 'Spende', sphereId: 'ideell', ...overrides
  });
}

/* ------------------------------------------------------------------ Sphären */

test('Es gibt genau vier Sphären, in fester Reihenfolge', () => {
  assert.deepEqual(spheres.SPHERES.map((s) => s.id), ['ideell', 'vermoegen', 'zweckbetrieb', 'wirtschaftlich']);
});

test('Der ideelle Bereich ist nicht unternehmerisch', () => {
  assert.equal(spheres.allowsInputVat('ideell'), false, 'kein Vorsteuerabzug');
  assert.equal(spheres.allowsInputVat('zweckbetrieb'), true);
  assert.equal(spheres.allowsInputVat('wirtschaftlich'), true);
  assert.equal(spheres.allowsInputVat(null), false, 'ohne Zuordnung wird nichts gezogen');
});

test('Aus einer Ausgabe im ideellen Bereich gibt es keine Vorsteuer', () => {
  const ideell = entriesDomain.normalizeEntry({
    type: 'expense', date: '2026-03-01', paidDate: '2026-03-01', amount: 11900,
    categoryId: 'cl_exp_admin', description: 'Software', sphereId: 'ideell'
  });
  const wirtschaftlich = entriesDomain.normalizeEntry({
    type: 'expense', date: '2026-03-01', paidDate: '2026-03-01', amount: 11900,
    categoryId: 'cl_exp_catering', description: 'Ware', sphereId: 'wirtschaftlich'
  });

  assert.equal(entriesDomain.taxEffect(ideell).inputVat, 0);
  assert.equal(entriesDomain.taxEffect(wirtschaftlich).inputVat, 1900);
});

test('Ein Einzelunternehmen ohne Sphäre behält seinen Vorsteuerabzug', () => {
  const buchung = entriesDomain.normalizeEntry({
    type: 'expense', date: '2026-03-01', paidDate: '2026-03-01', amount: 11900,
    categoryId: 'exp_software', description: 'Hosting'
  });
  assert.equal(buchung.sphereId, null);
  assert.equal(entriesDomain.taxEffect(buchung).inputVat, 1900);
});

test('Die Sphäre schlägt den Steuersatz vor', () => {
  assert.equal(spheres.defaultVatRate('ideell'), 0);
  assert.equal(spheres.defaultVatRate('zweckbetrieb'), 7, 'ermäßigt nach §12 Abs. 2 Nr. 8a UStG');
  assert.equal(spheres.defaultVatRate('wirtschaftlich'), 19);
});

/* ------------------------------------------------------------------ Grenzen */

test('Die Grenzen sind die ab 2026 geltenden', () => {
  assert.equal(spheres.LIMITS.taxation, 5000000, '50.000 Euro, vorher 45.000');
  assert.equal(spheres.LIMITS.sportsEvents, 5000000, '50.000 Euro nach §67a AO');
  assert.equal(spheres.LIMITS.timelyUse, 10000000, '100.000 Euro, vorher 45.000');
  assert.equal(spheres.LIMITS.corporateTaxAllowance, 500000, '5.000 Euro nach §24 KStG');
  assert.equal(spheres.LIMITS.trainerAllowance, 330000, '3.300 Euro Übungsleiterpauschale');
  assert.equal(spheres.LIMITS.volunteerAllowance, 96000, '960 Euro Ehrenamtspauschale');
});

test('Die Sphärenrechnung trennt Einnahmen und Ausgaben je Bereich', () => {
  const list = [
    entry({ id: 'a', amount: 240000, sphereId: 'ideell', categoryId: 'cl_inc_dues' }),
    entry({ id: 'b', amount: 50000, sphereId: 'ideell' }),
    entry({ id: 'c', amount: 120000, sphereId: 'zweckbetrieb', categoryId: 'cl_inc_events' }),
    entry({ id: 'd', amount: 80000, sphereId: 'wirtschaftlich', categoryId: 'cl_inc_catering' }),
    entry({ id: 'e', type: 'expense', amount: 30000, sphereId: 'wirtschaftlich', categoryId: 'cl_exp_catering' })
  ];

  const result = spheres.calculate(list, 2026);
  const byId = Object.fromEntries(result.spheres.map((s) => [s.id, s]));

  assert.equal(byId.ideell.income, 290000);
  assert.equal(byId.zweckbetrieb.income, 120000);
  assert.equal(byId.wirtschaftlich.income, 80000);
  assert.equal(byId.wirtschaftlich.expense, 30000);
  assert.equal(byId.wirtschaftlich.result, 50000);
  assert.equal(result.totals.income, 490000);
});

test('Buchungen ohne Sphäre fallen auf und werden gezählt', () => {
  const result = spheres.calculate([entry({ sphereId: null })], 2026);
  assert.equal(result.unassigned, 1);
  assert.ok(result.spheres.some((s) => s.id === 'offen'));

  const review = spheres.review([entry({ sphereId: null })], 2026);
  assert.match(review.warnings.join(' '), /keiner Sphäre zugeordnet/);
});

test('Die Besteuerungsgrenze stellt auf Einnahmen ab, nicht auf den Gewinn', () => {
  // 60.000 Euro Einnahmen, 59.000 Euro Ausgaben: die Grenze ist gerissen,
  // obwohl fast nichts übrig bleibt.
  const list = [
    entry({ amount: 6000000, sphereId: 'wirtschaftlich', categoryId: 'cl_inc_catering' }),
    entry({ type: 'expense', amount: 5900000, sphereId: 'wirtschaftlich', categoryId: 'cl_exp_catering' })
  ];

  const result = spheres.calculate(list, 2026);
  assert.equal(result.taxation.exceeded, true);
  assert.match(result.taxation.notes.join(' '), /Besteuerungsgrenze von 50.000 Euro ist überschritten/);
  assert.match(result.taxation.notes.join(' '), /unter dem Freibetrag/);
});

test('Unter der Grenze wird auf die Erleichterung von 2026 hingewiesen', () => {
  const result = spheres.calculate([entry({ amount: 100000, sphereId: 'wirtschaftlich' })], 2026);
  assert.equal(result.taxation.exceeded, false);
  assert.match(result.taxation.notes.join(' '), /nicht mehr abgegrenzt werden/);
});

test('Ab achtzig Prozent der Besteuerungsgrenze kommt der Hinweis vorher', () => {
  const result = spheres.calculate([entry({ amount: 4200000, sphereId: 'wirtschaftlich' })], 2026);
  assert.equal(result.taxation.percent, 84);
  assert.match(result.taxation.notes.join(' '), /nicht nur der übersteigende Teil/);
});

test('Die Freibeträge greifen erst über 5.000 Euro Überschuss', () => {
  const list = [
    entry({ amount: 6000000, sphereId: 'wirtschaftlich' }),
    entry({ type: 'expense', amount: 5200000, sphereId: 'wirtschaftlich', categoryId: 'cl_exp_catering' })
  ];
  const result = spheres.calculate(list, 2026);

  assert.equal(result.allowances.result, 800000);
  assert.equal(result.allowances.corporateTax.taxable, 300000, '8.000 minus 5.000 Euro');
  assert.equal(result.allowances.tradeTax.taxable, 300000);
});

test('Sportliche Veranstaltungen bleiben bis 50.000 Euro Zweckbetrieb', () => {
  const unter = spheres.sportsCheck([entry({ amount: 4000000, sphereId: 'zweckbetrieb', sportsEvent: true })], 2026);
  const ueber = spheres.sportsCheck([entry({ amount: 5500000, sphereId: 'zweckbetrieb', sportsEvent: true })], 2026);

  assert.equal(unter.exceeded, false);
  assert.equal(ueber.exceeded, true);
  assert.match(ueber.note, /einzeln zu prüfen/);
});

test('Die zeitnahe Mittelverwendung greift erst ab 100.000 Euro', () => {
  const klein = spheres.timelyUseCheck([entry({ amount: 5000000 })], 2026);
  const gross = spheres.timelyUseCheck([entry({ amount: 12000000 })], 2026);

  assert.equal(klein.applies, false);
  assert.match(klein.note, /keine Pflicht zur zeitnahen Mittelverwendung/);
  assert.equal(gross.applies, true);
  assert.equal(gross.deadline, '2028-12-31', 'bis zum Ende des übernächsten Jahres');
});

/* ------------------------------------------------------------------ Kategorien */

test('Verein und Einzelunternehmen haben getrennte Kategorien', () => {
  const business = categories.categoriesFor('income', 'business').map((c) => c.id);
  const club = categories.categoriesFor('income', 'club').map((c) => c.id);

  assert.ok(business.includes('inc_services'));
  assert.ok(!business.includes('cl_inc_dues'));
  assert.ok(club.includes('cl_inc_dues'));
  assert.ok(!club.includes('inc_services'));
});

test('Jede Vereinskategorie schlägt eine Sphäre vor', () => {
  const all = [...categories.categoriesFor('income', 'club'), ...categories.categoriesFor('expense', 'club')];
  for (const category of all) {
    assert.ok(spheres.getSphere(category.sphere), `${category.id} ohne gültige Sphäre`);
  }
});

test('Sponsoring gibt es in beiden Ausprägungen', () => {
  const passiv = categories.getCategory('cl_inc_sponsor_passive');
  const aktiv = categories.getCategory('cl_inc_ads');

  assert.equal(passiv.sphere, 'vermoegen');
  assert.equal(aktiv.sphere, 'wirtschaftlich');
});

/* ------------------------------------------------------------------ Zahlwort */

test('Zahlen werden nach deutscher Schreibweise ausgeschrieben', () => {
  assert.equal(donations.inWords(1), 'eins');
  assert.equal(donations.inWords(21), 'einundzwanzig');
  assert.equal(donations.inWords(101), 'einhunderteins');
  assert.equal(donations.inWords(111), 'einhundertelf');
  assert.equal(donations.inWords(1234), 'eintausendzweihundertvierunddreißig');
  assert.equal(donations.inWords(1000000), 'eine Million');
});

test('Vor der Einheit heißt die Eins ein', () => {
  assert.equal(donations.amountInWords(100), 'ein Euro');
  assert.equal(donations.amountInWords(101), 'ein Euro und ein Cent');
  assert.equal(donations.amountInWords(25000), 'zweihundertfünfzig Euro');
  assert.equal(donations.amountInWords(12345), 'einhundertdreiundzwanzig Euro und fünfundvierzig Cent');
});

/* ------------------------------------------------------------------ Bestätigung */

function clubSettings(overrides = {}) {
  const settings = defaultSettings();
  settings.company = { name: 'Turnverein Musterstadt e. V.', street: 'Sportplatzweg 1', zip: '86150', city: 'Augsburg', taxNumber: '103/456/78901' };
  settings.entity = {
    kind: 'club', charitable: true, purpose: 'des Sports',
    noticeType: 'freistellung', noticeDate: '2025-04-10', noticeOffice: 'Augsburg-Stadt',
    noticeYear: '2024', boardName: 'Anna Hartwig', boardRole: 'Vorstand',
    ...overrides
  };
  return settings;
}

const DONOR = { name: 'Erika Musterfrau', street: 'Beispielweg 3', zip: '86150', city: 'Augsburg' };

test('Eine Bestätigung nennt Betrag, Zahlwort und Bescheid', () => {
  const list = [entry({ amount: 25000, paidDate: '2026-05-04' })];
  const prepared = donations.prepare(list, clubSettings(), DONOR, { year: 2026, today: '2026-09-17' });

  assert.equal(prepared.total, 25000);
  assert.equal(prepared.totalInWords, 'zweihundertfünfzig Euro');
  assert.equal(prepared.notice.office, 'Augsburg-Stadt');
  assert.deepEqual(prepared.warnings.filter((w) => w.includes('fehlt')), []);
});

test('Fehlende Pflichtangaben werden benannt, statt gedruckt zu werden', () => {
  const settings = clubSettings({ purpose: '', noticeDate: '', noticeOffice: '' });
  const prepared = donations.prepare([entry({ amount: 50000 })], settings, { name: 'Max' }, {});

  const text = prepared.warnings.join(' ');
  assert.match(text, /begünstigte Zweck fehlt/);
  assert.match(text, /Datum und Finanzamt des Freistellungsbescheids fehlen/);
  assert.match(text, /Anschrift des Zuwendenden fehlt/);
});

test('Ohne Gemeinnützigkeit gibt es keine Bestätigung', () => {
  const settings = clubSettings({ charitable: false });
  const prepared = donations.prepare([entry()], settings, DONOR, {});
  assert.match(prepared.warnings.join(' '), /Ohne Gemeinnützigkeit darf keine Zuwendungsbestätigung/);
});

test('Ein Bescheid, der älter als fünf Jahre ist, trägt keine Bestätigung mehr', () => {
  const settings = clubSettings({ noticeDate: '2018-01-10' });
  const prepared = donations.prepare([entry()], settings, DONOR, {});
  assert.match(prepared.warnings.join(' '), /nicht länger als fünf Jahre/);
});

test('Bis 300 Euro wird auf den vereinfachten Nachweis hingewiesen', () => {
  const prepared = donations.prepare([entry({ amount: 20000 })], clubSettings(), DONOR, {});
  assert.match(prepared.warnings.join(' '), /genügt dem Spender der Kontoauszug/);
});

test('Mehrere Zuwendungen ergeben eine Sammelbestätigung', () => {
  const list = [
    entry({ id: 'a', amount: 10000, paidDate: '2026-02-01' }),
    entry({ id: 'b', amount: 15000, paidDate: '2026-07-01' })
  ];
  const prepared = donations.prepare(list, clubSettings(), DONOR, { year: 2026 });

  assert.equal(prepared.collective, true);
  assert.equal(prepared.total, 25000);

  const html = receipt.build(prepared);
  assert.ok(html.includes('Sammelbestätigung'));
  assert.ok(html.includes('keine weiteren Bestätigungen'), 'die Erklärung gehört ins Muster');
});

test('Das Schreiben folgt dem amtlichen Muster', () => {
  const prepared = donations.prepare([entry({ amount: 50000 })], clubSettings(), DONOR, { year: 2026, today: '2026-09-17' });
  // Zeilenumbrüche im Quelltext sind fürs Dokument bedeutungslos, für ein
  // includes() aber nicht.
  const html = receipt.build(prepared).replace(/\s+/g, ' ');

  assert.ok(html.includes('§ 10b des Einkommensteuergesetzes'));
  assert.ok(html.includes('§ 5 Absatz 1 Nummer 9 des Körperschaftsteuergesetzes'));
  assert.ok(html.includes('Verzicht auf Erstattung von Aufwendungen'));
  assert.ok(html.includes('haftet für'), 'der Haftungshinweis ist Pflicht');
  assert.ok(html.includes('länger als 5 Jahre'), 'der Hinweis auf die Gültigkeit des Bescheids');
  assert.ok(html.includes('fünfhundert Euro'), 'der Betrag in Buchstaben');
  assert.ok(html.includes('Erika Musterfrau'));
  assert.ok(html.includes('Augsburg-Stadt'));
});

test('Eine Sachzuwendung verlangt Angaben zur Wertermittlung', () => {
  const sach = entry({ categoryId: 'cl_inc_donation_kind', amount: 80000, note: '' });
  const prepared = donations.prepare([sach], clubSettings(), DONOR, {});

  assert.equal(prepared.type, 'kind');
  assert.match(prepared.warnings.join(' '), /genaue Bezeichnung der Sache/);
  assert.ok(receipt.build(prepared).includes('Unterlagen, die zur Wertermittlung gedient haben'));
});

test('Die Übersicht gruppiert die Zuwendungen nach Spender', () => {
  const list = [
    entry({ id: 'a', amount: 10000, customerId: 'kd_1', counterparty: 'Erika' }),
    entry({ id: 'b', amount: 5000, customerId: 'kd_1', counterparty: 'Erika' }),
    entry({ id: 'c', amount: 30000, customerId: 'kd_2', counterparty: 'Max', categoryId: 'cl_inc_dues' }),
    entry({ id: 'd', amount: 99900, categoryId: 'cl_inc_catering', sphereId: 'wirtschaftlich' })
  ];
  const customers = [{ id: 'kd_1', name: 'Erika Musterfrau', street: 'Weg 1', city: 'Augsburg' }, { id: 'kd_2', name: 'Max Muster' }];

  const result = donations.overview(list, customers, 2026);

  assert.equal(result.donors.length, 2, 'die Gaststätteneinnahme ist keine Spende');
  assert.equal(result.donors[0].name, 'Max Muster');
  assert.equal(result.donors[0].dues, 30000);
  assert.equal(result.donors[1].total, 15000);
  assert.equal(result.donors[1].hasAddress, true);
  assert.equal(result.total, 45000);
});

test('Auch ein Mitglied kann Zuwendender sein', () => {
  const list = [
    entry({ id: 'a', amount: 40000, memberId: 'mg_5', counterparty: 'Petra Schuster' }),
    entry({ id: 'b', amount: 10000, memberId: 'mg_5', counterparty: 'Petra Schuster' })
  ];
  const people = [{ id: 'mg_5', name: 'Petra Schuster', street: 'Ulmer Straße 42', zip: '86154', city: 'Augsburg' }];

  const result = donations.overview(list, people, 2026);

  assert.equal(result.donors.length, 1, 'beide Zuwendungen gehören zusammen');
  assert.equal(result.donors[0].memberId, 'mg_5');
  assert.equal(result.donors[0].customerId, null);
  assert.equal(result.donors[0].name, 'Petra Schuster');
  assert.equal(result.donors[0].hasAddress, true, 'die Anschrift steht am Mitglied');
  assert.equal(result.donors[0].total, 50000);
});
