'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const entries = require('../../src/domain/entries');
const analytics = require('../../src/domain/analytics');
const ecsales = require('../../src/domain/ecsales');
const forecast = require('../../src/domain/forecast');
const projects = require('../../src/domain/projects');
const segments = require('../../src/domain/segments');
const { defaultSettings } = require('../../src/storage/store');

const SETTINGS = defaultSettings();
const SEG_SAAS = SETTINGS.segments[0].id;
const SEG_SERVICE = SETTINGS.segments[1].id;

function entry(overrides) {
  return entries.normalizeEntry({
    type: 'income',
    date: '2026-03-01',
    paidDate: '2026-03-10',
    amount: 11900,
    categoryId: 'inc_services',
    description: 'Test',
    segmentId: SEG_SERVICE,
    countryCode: 'DE',
    ...overrides
  });
}

/* ------------------------------------------------------------------ Bereiche */

test('Bereiche haben Vorgaben und einen Vorschlagswert', () => {
  assert.ok(segments.listSegments(SETTINGS).length >= 3);
  assert.equal(segments.defaultSegmentId(SETTINGS), SEG_SAAS);
  assert.equal(segments.segmentLabel(SETTINGS, SEG_SERVICE), 'Dienstleistung');
  assert.equal(segments.segmentLabel(SETTINGS, 'gibt-es-nicht'), 'Ohne Bereich');
});

test('Ein Bereich wird auf gültige Werte gestutzt', () => {
  const s = segments.normalizeSegment({ label: '  Neu  ', kind: 'unfug', color: 'rot' });
  assert.equal(s.label, 'Neu');
  assert.equal(s.kind, 'other');
  assert.equal(s.color, '#8d99ab');
  assert.ok(s.id.startsWith('seg_'));
});

/* ------------------------------------------------------------------ Auswertung */

test('Umsatz und Ergebnis werden je Bereich getrennt', () => {
  const data = {
    settings: SETTINGS,
    entries: [
      entry({ segmentId: SEG_SAAS, amount: 11900 }),
      entry({ segmentId: SEG_SERVICE, amount: 238000 }),
      entry({ type: 'expense', segmentId: SEG_SAAS, amount: 5950, categoryId: 'exp_software' })
    ],
    customers: [],
    invoices: []
  };

  const result = analytics.analyze(data, 2026);
  const saas = result.bySegment.find((r) => r.key === SEG_SAAS);
  const service = result.bySegment.find((r) => r.key === SEG_SERVICE);

  assert.equal(saas.revenue, 10000, 'netto, nicht brutto');
  assert.equal(saas.cost, 5000);
  assert.equal(saas.result, 5000);
  assert.equal(service.revenue, 200000);
  assert.equal(result.totals.revenue, 210000);
  assert.equal(result.totals.result, 205000);
});

test('Anteile ergeben zusammen hundert Prozent', () => {
  const data = {
    settings: SETTINGS,
    entries: [
      entry({ segmentId: SEG_SAAS, amount: 11900 }),
      entry({ segmentId: SEG_SERVICE, amount: 35700 })
    ],
    customers: [], invoices: []
  };
  const result = analytics.analyze(data, 2026);
  const total = result.bySegment.reduce((s, r) => s + r.share, 0);
  assert.ok(Math.abs(total - 100) < 0.2, `Summe der Anteile war ${total}`);
});

test('Länder werden in Inland, EU-Ausland und Drittland eingeteilt', () => {
  assert.equal(analytics.countryZone('DE'), 'Inland');
  assert.equal(analytics.countryZone('IE'), 'EU-Ausland');
  assert.equal(analytics.countryZone('US'), 'Drittland');
  assert.equal(analytics.countryName('IE'), 'Irland');

  const data = {
    settings: SETTINGS,
    entries: [
      entry({ countryCode: 'DE', amount: 11900 }),
      entry({ countryCode: 'IE', amount: 23800, vatKey: 'eu_service', vatRate: 0 }),
      entry({ countryCode: 'US', amount: 10000, vatKey: 'ausland', vatRate: 0 })
    ],
    customers: [], invoices: []
  };

  const result = analytics.analyze(data, 2026);
  assert.deepEqual(
    result.byZone.map((r) => r.label).sort(),
    ['Drittland', 'EU-Ausland', 'Inland']
  );
  assert.equal(result.byCountry.find((r) => r.key === 'IE').revenue, 23800, 'ohne Steuer ist netto gleich brutto');
});

test('Umsatzsteuerzahlungen verfälschen die Auswertung nicht', () => {
  const data = {
    settings: SETTINGS,
    entries: [
      entry({ amount: 11900 }),
      entry({ type: 'expense', categoryId: 'exp_vat_payment', amount: 50000, vatRate: 0 })
    ],
    customers: [], invoices: []
  };
  const result = analytics.analyze(data, 2026);
  assert.equal(result.totals.cost, 0, 'die Zahlung ans Finanzamt ist keine Betriebsausgabe der Auswertung');
});

test('Kunden werden über die Verknüpfung erkannt, sonst über den Namen', () => {
  const data = {
    settings: SETTINGS,
    customers: [{ id: 'kd_1', name: 'Kundenfirma GmbH', country: 'DE' }],
    entries: [
      entry({ customerId: 'kd_1', amount: 11900 }),
      entry({ customerId: 'kd_1', amount: 11900 }),
      entry({ counterparty: 'Laufkundschaft', amount: 5950 })
    ],
    invoices: []
  };

  const result = analytics.analyze(data, 2026);
  const linked = result.byCustomer.find((r) => r.key === 'kd_1');
  assert.equal(linked.label, 'Kundenfirma GmbH');
  assert.equal(linked.revenue, 20000);
  assert.ok(result.byCustomer.some((r) => r.unlinked && r.label === 'Laufkundschaft'));
});

test('Das Klumpenrisiko wird benannt', () => {
  const data = {
    settings: SETTINGS,
    customers: [{ id: 'kd_1', name: 'Groß' }, { id: 'kd_2', name: 'Klein' }],
    entries: [
      entry({ customerId: 'kd_1', amount: 95200 }),
      entry({ customerId: 'kd_2', amount: 11900 })
    ],
    invoices: []
  };
  const result = analytics.analyze(data, 2026);
  assert.equal(result.concentration.largest, 'Groß');
  assert.ok(result.concentration.top1 > 60);
  assert.equal(result.concentration.risk, 'hoch');
});

test('Wiederkehrender Umsatz wird von Einmalzahlungen getrennt', () => {
  const data = {
    settings: SETTINGS,
    customers: [], invoices: [],
    entries: [
      entry({ revenueKind: 'recurring', amount: 11900, paidDate: '2026-01-15' }),
      entry({ revenueKind: 'recurring', amount: 11900, paidDate: '2026-02-15' }),
      entry({ revenueKind: 'recurring', amount: 17850, paidDate: '2026-03-15' }),
      entry({ revenueKind: 'onetime', amount: 119000, paidDate: '2026-03-20' })
    ]
  };

  const result = analytics.analyze(data, 2026);
  assert.equal(result.recurring.recurring, 10000 + 10000 + 15000);
  assert.equal(result.recurring.onetime, 100000);
  assert.equal(result.recurring.currentMonthly, 15000, 'der zuletzt aktive Monat zählt');
  assert.equal(result.recurring.annualRunRate, 180000);
});

test('Der Vorjahresvergleich rechnet die Veränderung aus', () => {
  const data = {
    settings: SETTINGS, customers: [], invoices: [],
    entries: [
      entry({ amount: 11900, date: '2025-03-01', paidDate: '2025-03-10' }),
      entry({ amount: 23800, date: '2026-03-01', paidDate: '2026-03-10' })
    ]
  };
  const result = analytics.analyze(data, 2026);
  assert.equal(result.totals.previousRevenue, 10000);
  assert.equal(result.totals.revenue, 20000);
  assert.equal(result.totals.revenueChange, 100);
});

test('Zahlungsverhalten je Kunde wird aus den Rechnungen abgeleitet', () => {
  const data = {
    settings: SETTINGS,
    customers: [{ id: 'kd_1', name: 'Spätzahler' }],
    entries: [],
    invoices: [{
      id: 're_1', documentType: 'invoice', customerId: 'kd_1',
      issueDate: '2026-01-01', dueDate: '2026-01-15',
      items: [{ name: 'x', quantity: 1, unitPriceNet: 10000, vatRate: 19 }],
      payments: [{ date: '2026-02-05', amount: 11900 }]
    }]
  };

  const result = analytics.analyze(data, 2026);
  const row = result.paymentBehaviour.customers[0];
  assert.equal(row.label, 'Spätzahler');
  assert.equal(row.averageDays, 35);
  assert.equal(row.overdue, 1, 'die Zahlung kam nach der Fälligkeit');
});

/* ------------------------------------------------------------------ Zusammenfassende Meldung */

const CUSTOMERS = [
  { id: 'kd_ie', name: 'Plattform Irland', country: 'IE', vatId: 'IE6388047V' },
  { id: 'kd_at', name: 'Agentur Wien', country: 'AT', vatId: 'ATU12345678' },
  { id: 'kd_de', name: 'Kunde Inland', country: 'DE', vatId: 'DE123456789' }
];

test('EU-Dienstleistungen landen in Kennzahl 21 und in der Meldung', () => {
  const list = [entry({
    customerId: 'kd_ie', countryCode: 'IE', counterpartyVatId: 'IE6388047V',
    vatKey: 'eu_service', vatRate: 0, amount: 250000, categoryId: 'inc_platform'
  })];

  const result = ecsales.calculate(list, CUSTOMERS, { from: '2026-01-01', to: '2026-03-31' });
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].vatId, 'IE6388047V');
  assert.equal(result.lines[0].kind, 'service');
  assert.equal(result.services, 250000);
  assert.deepEqual(result.problems, []);
});

test('Die Meldung richtet sich nach dem Rechnungsdatum, nicht nach der Zahlung', () => {
  const list = [entry({
    customerId: 'kd_at', countryCode: 'AT', counterpartyVatId: 'ATU12345678',
    vatKey: 'eu_service', vatRate: 0, amount: 100000,
    date: '2026-03-28', paidDate: '2026-05-02'
  })];

  const q1 = ecsales.calculate(list, CUSTOMERS, { from: '2026-01-01', to: '2026-03-31' });
  const q2 = ecsales.calculate(list, CUSTOMERS, { from: '2026-04-01', to: '2026-06-30' });

  assert.equal(q1.total, 100000, 'gemeldet wird im Quartal der Leistung');
  assert.equal(q2.total, 0);
});

test('Fehlende USt-IdNr. wird als Problem gemeldet, nicht stillschweigend übergangen', () => {
  const list = [entry({
    countryCode: 'AT', vatKey: 'eu_service', vatRate: 0, amount: 100000, counterparty: 'Ohne Nummer'
  })];
  const result = ecsales.calculate(list, CUSTOMERS, { from: '2026-01-01', to: '2026-03-31' });

  assert.equal(result.lines.length, 0);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /USt-IdNr/);
});

test('Inländische Umsätze gehören nicht in die Meldung', () => {
  const list = [entry({
    customerId: 'kd_de', countryCode: 'DE', counterpartyVatId: 'DE123456789',
    vatKey: 'eu_service', vatRate: 0, amount: 100000
  })];
  const result = ecsales.calculate(list, CUSTOMERS, { from: '2026-01-01', to: '2026-03-31' });
  assert.equal(result.lines.length, 0);
  assert.match(result.problems[0], /Deutschland/);
});

test('Mehrere Umsätze an denselben Kunden werden zusammengefasst', () => {
  const list = [
    entry({ customerId: 'kd_at', countryCode: 'AT', counterpartyVatId: 'ATU12345678', vatKey: 'eu_service', vatRate: 0, amount: 100000, date: '2026-01-10' }),
    entry({ customerId: 'kd_at', countryCode: 'AT', counterpartyVatId: 'ATU12345678', vatKey: 'eu_service', vatRate: 0, amount: 50000, date: '2026-02-10' })
  ];
  const result = ecsales.calculate(list, CUSTOMERS, { from: '2026-01-01', to: '2026-03-31' });
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].amount, 150000);
  assert.equal(result.lines[0].count, 2);
});

test('Lieferungen und Leistungen werden getrennt gemeldet', () => {
  const list = [
    entry({ customerId: 'kd_at', countryCode: 'AT', counterpartyVatId: 'ATU12345678', vatKey: 'eu_service', vatRate: 0, amount: 100000 }),
    entry({ customerId: 'kd_at', countryCode: 'AT', counterpartyVatId: 'ATU12345678', vatKey: 'igl', vatRate: 0, amount: 70000 })
  ];
  const result = ecsales.calculate(list, CUSTOMERS, { from: '2026-01-01', to: '2026-03-31' });
  assert.equal(result.lines.length, 2);
  assert.equal(result.services, 100000);
  assert.equal(result.goods, 70000);
});

test('Meldezeiträume tragen ihre Frist zum 25.', () => {
  const quarters = ecsales.periodsOf(2026, 'quarterly');
  assert.equal(quarters.length, 4);
  assert.equal(quarters[0].dueDate, '2026-04-25');
  assert.equal(quarters[3].dueDate, '2027-01-25');
  assert.equal(ecsales.periodsOf(2026, 'monthly').length, 12);
});

/* ------------------------------------------------------------------ Rücklage */

test('Die Steuerrücklage umfasst offene Umsatzsteuer und geschätzte Einkommensteuer', () => {
  const data = {
    settings: { ...SETTINGS, reserve: { incomeTaxRate: 40, tradeTaxRate: 0 } },
    assets: [],
    entries: [
      entry({ amount: 119000, paidDate: '2026-02-10' }),
      entry({ type: 'expense', amount: 23800, categoryId: 'exp_software', paidDate: '2026-02-11' })
    ]
  };

  const result = forecast.taxReserve(data, 2026, '2026-09-17');
  // 1.190 Euro brutto ergeben 190 Euro Umsatzsteuer, 238 Euro brutto 38 Euro
  // Vorsteuer. Bleibt eine Zahllast von 152 Euro.
  assert.equal(result.openVat, 15200);
  // Gewinn: 100.000 Einnahme netto minus 20.000 Ausgabe netto, plus USt-Effekte.
  assert.ok(result.incomeTax > 0);
  assert.equal(result.incomeTax, Math.round((result.profit * 40) / 100));
  assert.equal(result.total, result.openVat + result.incomeTax + result.tradeTax);
});

test('Bereits gezahlte Umsatzsteuer senkt die Rücklage', () => {
  const base = [
    entry({ amount: 119000, paidDate: '2026-02-10' }),
    entry({ type: 'expense', categoryId: 'exp_vat_payment', amount: 10000, vatRate: 0, paidDate: '2026-04-10' })
  ];
  const result = forecast.taxReserve(
    { settings: SETTINGS, assets: [], entries: base },
    2026,
    '2026-09-17'
  );
  assert.equal(result.paidVat, 10000, '100 Euro sind bereits geflossen');
  assert.equal(result.openVat, 19000 - 10000, 'so viel Umsatzsteuer steht noch aus');
});

test('Ohne Hebesatz bleibt die Gewerbesteuer außen vor', () => {
  const data = { settings: SETTINGS, assets: [], entries: [entry({ amount: 5950000, paidDate: '2026-02-10' })] };
  assert.equal(forecast.taxReserve(data, 2026, '2026-09-17').tradeTax, 0);

  const withRate = {
    ...data,
    settings: { ...SETTINGS, reserve: { incomeTaxRate: 35, tradeTaxRate: 400 } }
  };
  assert.ok(forecast.taxReserve(withRate, 2026, '2026-09-17').tradeTax > 0);
});

/* ------------------------------------------------------------------ Liquidität */

test('Die Vorschau summiert offene Rechnungen und Steuertermine', () => {
  const data = {
    settings: { ...SETTINGS, reserve: { accountBalance: 500000, accountBalanceDate: '2026-09-01' } },
    entries: [entry({ amount: 119000, paidDate: '2026-02-10' })],
    invoices: [{
      id: 're_1', documentType: 'invoice', status: 'sent', customerId: 'kd_1',
      issueDate: '2026-09-10', dueDate: '2026-10-10',
      items: [{ name: 'x', quantity: 1, unitPriceNet: 200000, vatRate: 19 }],
      payments: []
    }]
  };

  const result = forecast.liquidity(data, '2026-09-17', 3);
  assert.equal(result.startBalance, 500000);
  assert.equal(result.rows.length, 3);

  const october = result.rows.find((r) => r.key === '2026-10');
  assert.equal(october.incoming, 238000, 'die offene Rechnung wird zum Fälligkeitstag erwartet');
  assert.ok(october.items.some((i) => i.kind === 'invoice'));
  assert.equal(result.endBalance, result.rows[result.rows.length - 1].closing);
});

test('Eine überfällige Rechnung wird sofort erwartet, nicht in der Vergangenheit', () => {
  const data = {
    settings: SETTINGS,
    entries: [],
    invoices: [{
      id: 're_1', documentType: 'invoice', status: 'sent',
      issueDate: '2026-06-01', dueDate: '2026-06-15',
      items: [{ name: 'x', quantity: 1, unitPriceNet: 100000, vatRate: 19 }],
      payments: []
    }]
  };

  const result = forecast.liquidity(data, '2026-09-17', 3);
  const current = result.rows[0];
  assert.equal(current.key, '2026-09');
  assert.equal(current.incoming, 119000);
  assert.ok(current.items[0].overdue, 'sie ist als überfällig gekennzeichnet');
});

test('Ein negativer Tiefpunkt wird ausdrücklich gemeldet', () => {
  const data = {
    settings: { ...SETTINGS, reserve: { accountBalance: 10000 } },
    entries: [entries.normalizeEntry({
      type: 'expense', date: '2026-10-05', paidDate: null, amount: 500000,
      categoryId: 'exp_rent', description: 'Große Rechnung'
    })],
    invoices: []
  };

  const result = forecast.liquidity(data, '2026-09-17', 3);
  assert.ok(result.warning, 'es gibt eine Warnung');
  assert.ok(result.lowest.closing < 0);
});

/* ------------------------------------------------------------------ Projekte */

test('Ein Projekt rechnet Erlös, Kosten und Marge zusammen', () => {
  const project = projects.normalizeProject({ id: 'prj_1', name: 'Relaunch', budgetCents: 500000 });
  const invoiceList = [{
    id: 're_1', documentType: 'invoice', projectId: 'prj_1',
    computed: { netTotal: 400000, grossTotal: 476000, openAmount: 0 }
  }];
  const entryList = [
    entry({ projectId: 'prj_1', amount: 476000 }),
    entry({ projectId: 'prj_1', type: 'expense', amount: 119000, categoryId: 'exp_subcontract' })
  ];

  const result = projects.projectTotals(project, invoiceList, entryList, entries.taxEffect);
  assert.equal(result.revenueNet, 400000);
  assert.equal(result.costNet, 100000);
  assert.equal(result.marginNet, 300000);
  assert.equal(result.marginPercent, 75);
  assert.equal(result.budgetUsedPercent, 80);
});

test('Ein Projekt ohne Namen wird abgelehnt', () => {
  const errors = projects.validateProject(projects.normalizeProject({ name: '  ' }));
  assert.ok(errors.length);
});

test('Ein Ende vor dem Anfang fällt auf', () => {
  const errors = projects.validateProject(
    projects.normalizeProject({ name: 'X', startDate: '2026-05-01', endDate: '2026-01-01' })
  );
  assert.ok(errors.some((e) => e.includes('Ende')));
});
