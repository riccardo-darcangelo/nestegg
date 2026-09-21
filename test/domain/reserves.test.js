'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const reserves = require('../../src/domain/reserves');
const entriesDomain = require('../../src/domain/entries');
const assetsDomain = require('../../src/domain/assets');
const invoicesDomain = require('../../src/domain/invoices');
const { typeOf } = require('../../src/domain/doctypes');
const { defaultSettings } = require('../../src/storage/store');

function entry(overrides = {}) {
  return entriesDomain.normalizeEntry({
    type: 'income', date: '2026-03-01', paidDate: '2026-03-01', amount: 100000,
    categoryId: 'cl_inc_donation', description: 'Spende', sphereId: 'ideell', ...overrides
  });
}

function reserve(overrides = {}) {
  return reserves.normalizeReserve({
    id: 'rl_1', type: 'free', label: 'Freie Rücklage',
    movements: [{ year: 2026, date: '2026-12-31', kind: 'add', amount: 50000 }],
    ...overrides
  });
}

/* ------------------------------------------------------------------ Arten */

test('Es gibt die Rücklagenarten des §62 AO', () => {
  const ids = reserves.TYPES.map((type) => type.id);
  assert.deepEqual(ids, ['project', 'operating', 'replacement', 'free', 'shares', 'endowment']);

  assert.equal(reserves.getType('free').law, '§ 62 Abs. 1 Nr. 3 AO');
  assert.equal(reserves.getType('replacement').law, '§ 62 Abs. 1 Nr. 2 AO');
  assert.equal(reserves.getType('endowment').outsideTimelyUse, true);
});

test('Eine zweckgebundene Rücklage braucht Grund und Zeitvorstellung', () => {
  const ohne = reserves.normalizeReserve({ type: 'project', label: 'Hallenbau' });
  const errors = reserves.validateReserve(ohne);

  assert.match(errors.join(' '), /braucht einen konkreten Grund/);
  assert.match(errors.join(' '), /Zeitvorstellung/);
});

test('Die freie Rücklage braucht beides nicht', () => {
  const frei = reserves.normalizeReserve({ type: 'free', label: 'Freie Rücklage' });
  assert.deepEqual(reserves.validateReserve(frei), []);
});

/* ------------------------------------------------------------------ Bestand */

test('Der Bestand ergibt sich aus Zuführungen und Auflösungen', () => {
  const r = reserve({
    movements: [
      { year: 2025, kind: 'add', amount: 100000 },
      { year: 2026, kind: 'add', amount: 50000 },
      { year: 2026, kind: 'release', amount: 30000 }
    ]
  });

  assert.equal(reserves.balanceOf(r), 120000);
  assert.equal(reserves.balanceOf(r, 2025), 100000, 'zum Ende des Vorjahres');
  assert.equal(reserves.addedIn(r, 2026), 50000);
  assert.equal(reserves.releasedIn(r, 2026), 30000);
});

/* ------------------------------------------------------------------ Höchstbetrag */

test('Die freie Rücklage ist ein Drittel aus der Vermögensverwaltung plus zehn Prozent', () => {
  const list = [
    // Vermögensverwaltung: 9.000 Einnahmen, 3.000 Ausgaben, Überschuss 6.000
    entry({ id: 'v1', amount: 900000, sphereId: 'vermoegen', categoryId: 'cl_inc_rent' }),
    entry({ id: 'v2', type: 'expense', amount: 300000, sphereId: 'vermoegen', categoryId: 'cl_exp_property' }),
    // Ideeller Bereich: 20.000 brutto
    entry({ id: 'i1', amount: 2000000, sphereId: 'ideell' }),
    // Zweckbetrieb: 5.000 Gewinn
    entry({ id: 'z1', amount: 800000, sphereId: 'zweckbetrieb', categoryId: 'cl_inc_courses' }),
    entry({ id: 'z2', type: 'expense', amount: 300000, sphereId: 'zweckbetrieb', categoryId: 'cl_exp_sports' })
  ];

  const limit = reserves.freeLimit(list, 2026);

  assert.equal(limit.assetSurplus, 600000);
  assert.equal(limit.third, 200000, 'ein Drittel von 6.000 Euro');
  assert.equal(limit.otherMeans, 2000000 + 500000, 'Bruttoeinnahmen ideell plus Gewinn Zweckbetrieb');
  assert.equal(limit.tenth, 250000);
  assert.equal(limit.limit, 450000);
});

test('Im ideellen Bereich zählen die Bruttoeinnahmen, nicht der Überschuss', () => {
  const list = [
    entry({ id: 'i1', amount: 1000000, sphereId: 'ideell' }),
    entry({ id: 'i2', type: 'expense', amount: 900000, sphereId: 'ideell', categoryId: 'cl_exp_purpose' })
  ];

  const limit = reserves.freeLimit(list, 2026);
  assert.equal(limit.otherMeans, 1000000, 'die Ausgaben mindern die Grundlage nicht');
  assert.equal(limit.tenth, 100000);
});

test('Bei Zweckbetrieb und wirtschaftlichem Betrieb zählt dagegen der Gewinn', () => {
  const list = [
    entry({ id: 'w1', amount: 1000000, sphereId: 'wirtschaftlich', categoryId: 'cl_inc_catering' }),
    entry({ id: 'w2', type: 'expense', amount: 700000, sphereId: 'wirtschaftlich', categoryId: 'cl_exp_catering' })
  ];

  const limit = reserves.freeLimit(list, 2026);
  assert.equal(limit.otherMeans, 300000, 'nur der Überschuss');
});

test('Ein Verlust mindert die Grundlage nicht unter null', () => {
  const list = [
    entry({ id: 'v1', amount: 100000, sphereId: 'vermoegen', categoryId: 'cl_inc_rent' }),
    entry({ id: 'v2', type: 'expense', amount: 500000, sphereId: 'vermoegen', categoryId: 'cl_exp_property' }),
    entry({ id: 'w1', amount: 100000, sphereId: 'wirtschaftlich', categoryId: 'cl_inc_catering' }),
    entry({ id: 'w2', type: 'expense', amount: 900000, sphereId: 'wirtschaftlich', categoryId: 'cl_exp_catering' })
  ];

  const limit = reserves.freeLimit(list, 2026);
  assert.equal(limit.assetSurplus, 0, 'kein negatives Drittel');
  assert.equal(limit.third, 0);
  assert.equal(limit.otherMeans, 0);
  assert.equal(limit.limit, 0);
});

/* ------------------------------------------------------------------ Nachholung */

test('Ein nicht ausgeschöpfter Höchstbetrag lässt sich zwei Jahre nachholen', () => {
  // In jedem Jahr 10.000 Euro ideelle Einnahmen, also 1.000 Euro Höchstbetrag.
  const list = [
    entry({ id: 'a', amount: 1000000, paidDate: '2024-03-01' }),
    entry({ id: 'b', amount: 1000000, paidDate: '2025-03-01' }),
    entry({ id: 'c', amount: 1000000, paidDate: '2026-03-01' })
  ];

  const nichts = reserves.freeAllowance(list, [], 2026);
  assert.equal(nichts.limit, 100000, 'der Höchstbetrag des Jahres');
  assert.equal(nichts.carryTotal, 200000, 'die beiden Vorjahre wurden nicht genutzt');
  assert.equal(nichts.available, 300000);
});

test('Was in einem Vorjahr genutzt wurde, steht nicht mehr zur Verfügung', () => {
  const list = [
    entry({ id: 'a', amount: 1000000, paidDate: '2024-03-01' }),
    entry({ id: 'b', amount: 1000000, paidDate: '2025-03-01' }),
    entry({ id: 'c', amount: 1000000, paidDate: '2026-03-01' })
  ];
  const genutzt = [reserve({
    movements: [
      { year: 2024, kind: 'add', amount: 100000 },
      { year: 2025, kind: 'add', amount: 60000 }
    ]
  })];

  const result = reserves.freeAllowance(list, genutzt, 2026);
  assert.equal(result.carryTotal, 40000, 'nur der Rest aus 2025');
  assert.equal(result.available, 140000);
});

test('Ein Rest aus dem dritten Jahr davor ist verfallen', () => {
  const list = [
    entry({ id: 'a', amount: 1000000, paidDate: '2023-03-01' }),
    entry({ id: 'c', amount: 1000000, paidDate: '2026-03-01' })
  ];

  const result = reserves.freeAllowance(list, [], 2026);
  assert.equal(result.carryTotal, 0, '2023 liegt außerhalb der Nachholfrist');
});

test('Wer zu viel einstellt, wird gewarnt', () => {
  const list = [entry({ amount: 1000000 })];
  const zuviel = [reserve({ movements: [{ year: 2026, kind: 'add', amount: 500000 }] })];

  const result = reserves.overview(zuviel, list, 2026, '2026-12-31');
  assert.equal(result.free.exceeded, true);
  assert.match(result.warnings.join(' '), /zulässig waren/);
});

/* ------------------------------------------------------------------ Prüfungen */

test('Eine abgelaufene Frist fällt auf', () => {
  const projekt = reserve({
    type: 'project', label: 'Hallendach', purpose: 'Sanierung', deadline: '2026-06-30',
    movements: [{ year: 2025, kind: 'add', amount: 500000 }]
  });

  const result = reserves.overview([projekt], [], 2026, '2026-09-17');
  assert.equal(result.reserves[0].overdue, true);
  assert.match(result.warnings.join(' '), /unverzüglich aufzulösen/);
});

test('Eine Rücklage, die drei Jahre unverändert liegt, fällt ebenfalls auf', () => {
  const alt = reserve({
    type: 'operating', label: 'Betriebsmittel', purpose: 'Miete',
    movements: [{ year: 2022, kind: 'add', amount: 300000 }]
  });

  const result = reserves.overview([alt], [], 2026, '2026-09-17');
  assert.match(result.warnings.join(' '), /seit mehr als drei Jahren unverändert/);
});

test('Eine Vermögenszuführung zählt nicht zu den zeitnah gebundenen Mitteln', () => {
  const erbe = reserve({ type: 'endowment', label: 'Erbschaft', purpose: 'Vermögensausstattung',
    movements: [{ year: 2026, kind: 'add', amount: 1000000 }] });
  const frei = reserve({ id: 'rl_2', movements: [{ year: 2026, kind: 'add', amount: 20000 }] });

  const result = reserves.overview([erbe, frei], [entry({ amount: 1000000 })], 2026, '2026-12-31');
  assert.equal(result.total, 1020000);
  assert.equal(result.timelyBound, 20000, 'die Erbschaft bleibt außen vor');
});

/* ------------------------------------------------------------------ Mittelverwendung */

test('Die Mittelverwendungsrechnung zeigt, was übrig bleibt', () => {
  const list = [
    entry({ id: 'i1', amount: 1000000, sphereId: 'ideell' }),
    entry({ id: 'i2', type: 'expense', amount: 600000, sphereId: 'ideell', categoryId: 'cl_exp_purpose' })
  ];
  const ruecklagen = [reserve({ movements: [{ year: 2026, kind: 'add', amount: 100000 }] })];

  const result = reserves.useOfFunds(list, ruecklagen, 2026);

  assert.equal(result.inflow, 1000000);
  assert.equal(result.used, 600000);
  assert.equal(result.toReserves, 100000);
  assert.equal(result.remaining, 300000);
  assert.equal(result.deadline, '2028-12-31');
  assert.match(result.note, /bis zum 31.12.2028 zu verwenden/);
});

test('Aufgelöste Rücklagen erhöhen die zu verwendenden Mittel wieder', () => {
  const list = [entry({ id: 'i1', amount: 500000, sphereId: 'ideell' })];
  const ruecklagen = [reserve({ movements: [{ year: 2026, kind: 'release', amount: 200000 }] })];

  const result = reserves.useOfFunds(list, ruecklagen, 2026);
  assert.equal(result.fromReserves, 200000);
  assert.equal(result.remaining, 700000);
});

/* ------------------------------------------------------------------ Vermögen */

function assetsData() {
  const settings = defaultSettings();
  settings.reserve = { accountBalance: 1500000, accountBalanceDate: '2025-12-31', incomeTaxRate: 0, tradeTaxRate: 0 };

  return {
    settings,
    entries: [
      entriesDomain.normalizeEntry({ type: 'income', date: '2026-02-01', paidDate: '2026-02-01', amount: 300000, categoryId: 'cl_inc_donation', sphereId: 'ideell', description: 'Spende' }),
      entriesDomain.normalizeEntry({ type: 'expense', date: '2026-03-01', paidDate: '2026-03-01', amount: 100000, categoryId: 'cl_exp_purpose', sphereId: 'ideell', description: 'Ausgabe' }),
      entriesDomain.normalizeEntry({ type: 'expense', date: '2026-11-01', paidDate: null, amount: 50000, categoryId: 'cl_exp_purpose', sphereId: 'ideell', description: 'Offene Rechnung' })
    ],
    invoices: [{
      id: 're1', documentType: 'invoice', number: 'RE-2026-0001', status: 'sent',
      issueDate: '2026-05-01', dueDate: '2026-05-15', customerId: 'kd1', currency: 'EUR',
      items: [{ name: 'Leistung', quantity: 1, unit: 'LS', unitPriceNet: 200000, vatRate: 0 }],
      payments: []
    }],
    assets: [assetsDomain.normalizeAsset({
      id: 'anl_1', label: 'Rasenmäher', purchaseDate: '2025-01-15', netCents: 500000, usefulLifeYears: 5
    })],
    reserves: [reserve({ movements: [{ year: 2026, kind: 'add', amount: 400000 }] })]
  };
}

test('Die Vermögensübersicht fasst Aktiva und Passiva zusammen', () => {
  const data = assetsData();
  const result = reserves.netAssets(data, { assetsDomain, invoicesDomain, typeOf }, '2026-12-31');

  // 15.000 Anfangsbestand plus 3.000 minus 1.000
  assert.equal(result.assets.liquid, 1700000);
  assert.equal(result.assets.receivables, 200000, 'die offene Rechnung');
  assert.equal(result.assets.fixedAssets, 300000, 'Rasenmäher nach zwei Jahren Abschreibung');
  assert.equal(result.assets.total, 2200000);

  assert.equal(result.liabilities.payables, 50000, 'die noch nicht gezahlte Ausgabe');
  assert.equal(result.liabilities.reservesTotal, 400000);
  assert.equal(result.equity, 2200000 - 50000 - 400000);
});

test('Ohne gepflegten Kontostand sagt die Übersicht das', () => {
  const data = assetsData();
  data.settings.reserve = { accountBalance: 0, accountBalanceDate: null };

  const result = reserves.netAssets(data, { assetsDomain, invoicesDomain, typeOf }, '2026-12-31');
  assert.equal(result.hasOpeningBalance, false);
  assert.equal(result.assets.liquid, 200000, 'nur die Bewegungen des Jahres');
});

test('Entwürfe und stornierte Rechnungen sind keine Forderung', () => {
  const data = assetsData();
  data.invoices.push({ ...data.invoices[0], id: 're2', status: 'draft', number: '' });
  data.invoices.push({ ...data.invoices[0], id: 're3', status: 'cancelled' });

  const result = reserves.netAssets(data, { assetsDomain, invoicesDomain, typeOf }, '2026-12-31');
  assert.equal(result.assets.receivables, 200000);
});

test('Die Rücklagen erscheinen einzeln auf der Passivseite', () => {
  const data = assetsData();
  const result = reserves.netAssets(data, { assetsDomain, invoicesDomain, typeOf }, '2026-12-31');

  assert.equal(result.liabilities.reserves.length, 1);
  assert.equal(result.liabilities.reserves[0].law, '§ 62 Abs. 1 Nr. 3 AO');
});
