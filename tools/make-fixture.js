'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Erzeugt Beispieldaten samt vorberechneter Auswertungen für die
 * Oberflächen-Vorschau (tools/preview.html).
 *
 * Gerechnet wird mit denselben Modulen wie in der App, die Vorschau zeigt also
 * echte Zahlen und nicht ausgedachte. Damit lässt sich die Oberfläche im
 * Browser prüfen, ohne Electron zu starten.
 */

const fs = require('node:fs');
const path = require('node:path');

const entriesDomain = require('../src/domain/entries');
const invoicesDomain = require('../src/domain/invoices');
const assetsDomain = require('../src/domain/assets');
const categories = require('../src/domain/categories');
const { VAT_RATES } = require('../src/domain/tax');
const euer = require('../src/domain/euer');
const vat = require('../src/domain/vat');
const doctypes = require('../src/domain/doctypes');
const recurringDomain = require('../src/domain/recurring');
const recurrenceDomain = require('../src/domain/recurrence');
const dunningDomain = require('../src/domain/dunning');
const deadlinesDomain = require('../src/domain/deadlines');
const bankimport = require('../src/domain/bankimport');
const einvoiceRead = require('../src/import/einvoice');
const xmlread = require('../src/import/xmlread');
const cii = require('../src/export/cii');
const timetracking = require('../src/domain/timetracking');
const thresholdsDomain = require('../src/domain/thresholds');
const spheresDomain = require('../src/domain/spheres');
const donationsDomain = require('../src/domain/donations');
const reservesDomain = require('../src/domain/reserves');
const membersDomain = require('../src/domain/members');
const sepaDomain = require('../src/domain/sepa');
const returnsDomain = require('../src/domain/returns');
const claimsDomain = require('../src/domain/claims');
const travelDomain = require('../src/domain/travel');
const datevExport = require('../src/export/datev');
const analytics = require('../src/domain/analytics');
const ecsales = require('../src/domain/ecsales');
const forecast = require('../src/domain/forecast');
const segmentsDomain = require('../src/domain/segments');
const projectsDomain = require('../src/domain/projects');
const themeLib = require('../src/export/theme');
const { defaultSettings, deepMerge } = require('../src/storage/store');

const YEAR = 2026;
const TODAY = `${YEAR}-09-17`;

/** Ein Datum in deutscher Schreibweise, um Tage verschoben. Für den Auszug. */
function de(iso, offsetDays = 0) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

const settings = deepMerge(defaultSettings(), {
  company: {
    name: 'Beispiel Consulting',
    owner: 'Vorname Nachname',
    street: 'Musterweg 12',
    zip: '10115',
    city: 'Berlin',
    country: 'DE',
    email: 'rechnung@beispiel.de',
    phone: '+49 30 1234567',
    website: 'beispiel.de',
    taxNumber: '12/345/67890',
    vatId: 'DE123456789',
    bankName: 'Beispielbank',
    iban: 'DE02 1203 0000 0000 2020 51',
    bic: 'BYLADEM1001'
  },
  invoice: { counters: { invoice: { '2026': 3 }, quote: { '2026': 4 }, estimate: { '2026': 1 }, creditnote: {} } },
  bankRules: [
    { id: 'rule_1', match: 'IMMOBILIEN VERWALTUNG', type: 'expense', categoryId: 'exp_rent', segmentId: null, counterparty: 'Hausverwaltung Nord' },
    { id: 'rule_2', match: 'STRIPE TECHNOLOGY EUROPE', type: 'income', categoryId: 'inc_license', segmentId: null, counterparty: 'Stripe Payments Europe Ltd' }
  ],
  reserve: { incomeTaxRate: 38, tradeTaxRate: 0, accountBalance: 1240000, accountBalanceDate: '2026-09-01' },
  ui: { lastYear: YEAR }
});

const customers = [
  {
    id: 'kd_1', name: 'Kundenfirma GmbH', contactName: 'Frau Muster', customerNumber: 'K-001',
    street: 'Kundenallee 7', zip: '20095', city: 'Hamburg', country: 'DE',
    email: 'buchhaltung@kunde.de', vatId: 'DE987654321', buyerReference: '', isPublicAuthority: false
  },
  {
    id: 'kd_2', name: 'Stadtverwaltung Musterstadt', contactName: 'Herr Beispiel', customerNumber: 'K-002',
    street: 'Rathausplatz 1', zip: '30159', city: 'Hannover', country: 'DE',
    email: 'rechnung@musterstadt.de', vatId: '', buyerReference: '991-12345-67', isPublicAuthority: true
  },
  {
    id: 'kd_3', name: 'Atelier Wien GmbH', street: 'Ringstraße 4', zip: '1010', city: 'Wien', country: 'AT',
    email: 'office@atelier.at', vatId: 'ATU12345678', buyerReference: '', isPublicAuthority: false
  }
];

const platformCustomer = {
  id: 'kd_platform', name: 'Stripe Payments Europe Ltd', customerNumber: 'P-001',
  street: 'The One Building, 1 Grand Canal Street Lower', zip: 'D02 H210', city: 'Dublin',
  country: 'IE', vatId: 'IE6388047V', buyerReference: '', isPublicAuthority: false,
  note: 'Merchant of Record für die Abo-Erlöse. Verkauft im eigenen Namen an die Endkunden.'
};
customers.push(platformCustomer);

const projects = [
  projectsDomain.normalizeProject({
    id: 'prj_1', name: 'Relaunch Webauftritt', customerId: 'kd_1',
    status: 'active', budgetCents: 900000, startDate: '2026-01-10'
  }),
  projectsDomain.normalizeProject({
    id: 'prj_2', name: 'Migration Stadtportal', customerId: 'kd_2',
    status: 'done', budgetCents: 250000, startDate: '2026-03-01', endDate: '2026-06-30'
  })
];

const rawEntries = [
  { type: 'income', date: '2026-01-20', paidDate: '2026-02-03', amount: 357000, categoryId: 'inc_services', description: 'Rechnung RE-2026-0001', counterparty: 'Kundenfirma GmbH', invoiceId: 're_1' },
  { type: 'income', date: '2026-04-02', paidDate: '2026-04-18', amount: 214200, categoryId: 'inc_services', description: 'Rechnung RE-2026-0002', counterparty: 'Stadtverwaltung Musterstadt', invoiceId: 're_2' },
  { type: 'income', date: '2026-06-11', paidDate: '2026-06-30', amount: 119000, categoryId: 'inc_license', description: 'Wartungspauschale zweites Quartal', counterparty: 'Kundenfirma GmbH' },
  { type: 'income', date: '2026-08-05', paidDate: '2026-08-20', amount: 450000, categoryId: 'inc_services', description: 'Projektabschluss Sommerkampagne', counterparty: 'Kundenfirma GmbH' },
  { type: 'income', date: '2026-09-01', paidDate: null, amount: 178500, categoryId: 'inc_services', description: 'Konzeptphase, noch nicht bezahlt', counterparty: 'Atelier Wien GmbH' },

  { type: 'expense', date: '2026-01-05', paidDate: '2026-01-05', amount: 71400, categoryId: 'exp_rent', description: 'Büromiete Januar', counterparty: 'Hausverwaltung Nord', receiptId: 'beleg_1' },
  { type: 'expense', date: '2026-01-15', paidDate: '2026-01-15', amount: 238000, categoryId: 'exp_other', description: 'Notebook für die Entwicklung', counterparty: 'Technikhandel', assetId: 'anl_1', receiptId: 'beleg_2' },
  { type: 'expense', date: '2026-02-10', paidDate: '2026-02-10', amount: 4760, categoryId: 'exp_software', description: 'Hosting Februar', counterparty: 'Hetzner Online GmbH' },
  { type: 'expense', date: '2026-02-28', paidDate: '2026-03-02', amount: 18900, categoryId: 'exp_entertainment', description: 'Geschäftsessen mit Kundenfirma GmbH', counterparty: 'Restaurant Adler', note: 'Anlass: Projektabstimmung, Teilnehmer: zwei Personen', receiptId: 'beleg_3' },
  { type: 'expense', date: '2026-03-01', paidDate: '2026-03-01', amount: 71400, categoryId: 'exp_rent', description: 'Büromiete März', counterparty: 'Hausverwaltung Nord' },
  { type: 'expense', date: '2026-03-20', paidDate: '2026-03-20', amount: 9520, categoryId: 'exp_telecom', description: 'Telefon und Internet, anteilig', counterparty: 'Telefonanbieter', privateSharePercent: 30 },
  { type: 'expense', date: '2026-04-14', paidDate: '2026-04-14', amount: 24000, categoryId: 'exp_software', description: 'Jahreslizenz Entwurfswerkzeug', counterparty: 'Design Software Ltd', reverseCharge: true, vatRate: 19 },
  { type: 'expense', date: '2026-05-08', paidDate: '2026-05-08', amount: 13780, categoryId: 'exp_education', description: 'Fachbücher', counterparty: 'Buchhandlung', vatRate: 7 },
  { type: 'expense', date: '2026-06-02', paidDate: '2026-06-02', amount: 32500, categoryId: 'exp_insurance', description: 'Betriebshaftpflicht, Halbjahr', counterparty: 'Versicherung', vatRate: 0 },
  { type: 'expense', date: '2026-07-10', paidDate: '2026-07-10', amount: 55000, categoryId: 'exp_vat_payment', description: 'Umsatzsteuer zweites Quartal', counterparty: 'Finanzamt', vatRate: 0 },
  { type: 'expense', date: '2026-08-12', paidDate: '2026-08-12', amount: 8330, categoryId: 'exp_travel', description: 'Bahnfahrt zum Kundentermin', counterparty: 'Bahn', vatRate: 19, receiptId: 'beleg_4' },
  { type: 'expense', date: '2026-09-01', paidDate: '2026-09-01', amount: 71400, categoryId: 'exp_rent', description: 'Büromiete September', counterparty: 'Hausverwaltung Nord' },
  { type: 'expense', date: '2026-09-05', paidDate: null, amount: 47600, categoryId: 'exp_marketing', description: 'Anzeigenkampagne, Rechnung offen', counterparty: 'Werbeagentur' }
];

const SEG = settings.segments;
const SEG_SAAS = SEG[0].id;
const SEG_SERVICE = SEG[1].id;
const SEG_PRODUCT = SEG[2].id;

/**
 * Ordnet den Beispielbuchungen die neuen Dimensionen zu, damit die Auswertung
 * in der Vorschau etwas zu zeigen hat.
 */
function withDimensions(raw, i) {
  const text = `${raw.description} ${raw.counterparty || ''}`.toLowerCase();
  let segmentId = SEG_SERVICE;
  let countryCode = 'DE';
  let revenueKind = 'onetime';
  let customerId = null;
  let counterpartyVatId = '';
  let projectId = null;

  if (text.includes('wartung') || text.includes('hosting') || text.includes('server')) {
    segmentId = SEG_SAAS;
    revenueKind = raw.type === 'income' ? 'recurring' : 'onetime';
  }
  if (text.includes('lizenz') || text.includes('entwurfswerkzeug')) segmentId = SEG_PRODUCT;
  if (text.includes('design software')) { countryCode = 'IE'; counterpartyVatId = 'IE9825613N'; }
  if (text.includes('kundenfirma')) { customerId = 'kd_1'; projectId = 'prj_1'; }
  if (text.includes('stadtverwaltung')) { customerId = 'kd_2'; projectId = 'prj_2'; }
  if (text.includes('atelier')) { customerId = 'kd_3'; countryCode = 'AT'; counterpartyVatId = 'ATU12345678'; }

  return { ...raw, segmentId, countryCode, revenueKind, customerId, counterpartyVatId, projectId };
}

// Plattformerlöse über den Merchant of Record, wie sie bei einem Abo-Geschäft
// tatsächlich ankommen: eine Auszahlung im Monat, nicht einzelne Kundenzahlungen.
const platformEntries = [
  { month: '01', amount: 84200 }, { month: '02', amount: 91500 }, { month: '03', amount: 97300 },
  { month: '04', amount: 103800 }, { month: '05', amount: 112400 }, { month: '06', amount: 118900 },
  { month: '07', amount: 124600 }, { month: '08', amount: 131200 }
].map((row) => ({
  type: 'income',
  date: `2026-${row.month}-28`,
  paidDate: `2026-${row.month}-28`,
  amount: row.amount,
  vatRate: 0,
  vatKey: 'eu_service',
  categoryId: 'inc_platform',
  description: 'Auszahlung Plattform, Abo-Erlöse',
  counterparty: 'Stripe Payments Europe Ltd',
  customerId: 'kd_platform',
  countryCode: 'IE',
  counterpartyVatId: 'IE6388047V',
  segmentId: SEG_SAAS,
  revenueKind: 'recurring'
}));

const allRaw = [...rawEntries.map(withDimensions), ...platformEntries];

const entries = allRaw.map((raw, i) => ({
  ...entriesDomain.normalizeEntry(raw),
  id: `buch_${i + 1}`
}));

const assets = [
  assetsDomain.normalizeAsset({
    id: 'anl_1', label: 'Notebook für die Entwicklung', purchaseDate: '2026-01-15',
    netCents: 200000, usefulLifeYears: 3, entryId: 'buch_7'
  })
];

const receipts = [
  { id: 'beleg_1', fileName: '2026-01-05_Hausverwaltung-Nord_714,00.pdf', relativePath: '2026/2026-01-05_Hausverwaltung-Nord.pdf', checksum: 'a'.repeat(64), size: 84211, date: '2026-01-05' },
  { id: 'beleg_2', fileName: '2026-01-15_Technikhandel_2380,00.pdf', relativePath: '2026/2026-01-15_Technikhandel.pdf', checksum: 'b'.repeat(64), size: 122043, date: '2026-01-15' },
  { id: 'beleg_3', fileName: '2026-02-28_Restaurant-Adler_189,00.jpg', relativePath: '2026/2026-02-28_Restaurant-Adler.jpg', checksum: 'c'.repeat(64), size: 640210, date: '2026-02-28' },
  { id: 'beleg_4', fileName: '2026-08-12_Bahn_83,30.pdf', relativePath: '2026/2026-08-12_Bahn.pdf', checksum: 'd'.repeat(64), size: 51233, date: '2026-08-12' }
];

const overdueInvoice = {
  id: 're_5', number: 'RE-2026-0004', documentType: 'invoice', status: 'sent', customerId: 'kd_3',
  issueDate: '2026-05-12', deliveryDate: '2026-05-10', dueDate: '2026-05-26', paymentTermsDays: 14,
  segmentId: settings.segments[1].id,
  items: [{ name: 'Konzeptworkshop', quantity: 8, unit: 'HUR', unitPriceNet: 12000, vatRate: 19 }],
  payments: [], intro: '', outro: '', bodyText: 'Zahlbar bis zum {DUEDATE}.',
  buyerReference: '', currency: 'EUR',
  reminders: [{
    level: 1, levelId: 'reminder', levelLabel: 'Zahlungserinnerung',
    date: '2026-07-01', deadline: '2026-07-11',
    open: 114240, interest: 0, interestDays: 0, interestRate: 0, interestSince: null,
    flatFee: 0, fee: 0, total: 114240,
    intro: '', bodyText: 'Vermutlich ist die Rechnung untergegangen.', outro: ''
  }]
};

const rawOffers = [
  {
    id: 'an_1', number: 'AN-2026-0004', documentType: 'quote', status: 'sent', customerId: 'kd_1',
    issueDate: '2026-09-02', validUntil: '2026-10-02', showSignature: true,
    items: [
      { name: 'Relaunch Webauftritt', description: 'Konzept, Gestaltung und Umsetzung', quantity: 1, unit: 'LS', unitPriceNet: 850000, vatRate: 19 },
      { name: 'Schulung', quantity: 4, unit: 'HUR', unitPriceNet: 12000, vatRate: 19 }
    ],
    payments: [], currency: 'EUR',
    salutation: 'Sehr geehrte Damen und Herren,',
    intro: 'vielen Dank für Ihre Anfrage. Gern unterbreite ich Ihnen folgendes Angebot.',
    bodyText: 'Dieses Angebot ist bis zum {VALIDUNTIL} gültig. Mit Ihrer Zusage kommt der Auftrag zustande.',
    outro: 'Bei Fragen melden Sie sich einfach.'
  },
  {
    id: 'an_2', number: 'AN-2026-0003', documentType: 'quote', status: 'accepted', customerId: 'kd_3',
    issueDate: '2026-07-14', validUntil: '2026-08-13', showSignature: true,
    items: [{ name: 'Beratungspaket', quantity: 20, unit: 'HUR', unitPriceNet: 12000, vatRate: 19 }],
    payments: [], currency: 'EUR', intro: '', bodyText: '', outro: ''
  },
  {
    id: 'kv_1', number: 'KV-2026-0001', documentType: 'estimate', status: 'sent', customerId: 'kd_2',
    issueDate: '2026-08-20', validUntil: '2026-09-19', tolerancePercent: 15, showSignature: false,
    items: [
      { name: 'Aufwandsschätzung Migration', quantity: 35, unit: 'HUR', unitPriceNet: 11000, vatRate: 19 },
      { name: 'Lizenzen, geschätzt', quantity: 1, unit: 'LS', unitPriceNet: 90000, vatRate: 19 }
    ],
    payments: [], currency: 'EUR',
    intro: 'vielen Dank für Ihre Anfrage. Nach heutigem Stand schätze ich den Aufwand wie folgt.',
    bodyText: 'Dies ist ein unverbindlicher Kostenvoranschlag. Die tatsächlichen Kosten können um bis zu {TOLERANCE} Prozent abweichen.',
    outro: ''
  },
  {
    id: 'an_3', number: null, documentType: 'quote', status: 'draft', customerId: 'kd_1',
    issueDate: '2026-09-16', validUntil: '2026-10-16', showSignature: true,
    items: [{ name: 'Wartungsvertrag', quantity: 12, unit: 'MON', unitPriceNet: 25000, vatRate: 19 }],
    payments: [], currency: 'EUR', intro: '', bodyText: '', outro: ''
  }
];

const rawInvoices = [
  {
    id: 're_1', number: 'RE-2026-0001', status: 'sent', customerId: 'kd_1',
    issueDate: '2026-01-20', deliveryDate: '2026-01-15', dueDate: '2026-02-03', paymentTermsDays: 14,
    items: [
      { name: 'Konzeption und Beratung', description: 'Workshop und Ausarbeitung', quantity: 20, unit: 'HUR', unitPriceNet: 12000, vatRate: 19 },
      { name: 'Projektpauschale', quantity: 1, unit: 'LS', unitPriceNet: 60000, vatRate: 19 }
    ],
    payments: [{ date: '2026-02-03', amount: 357000, entryId: 'buch_1' }],
    intro: 'Vielen Dank für den Auftrag.', outro: 'Vielen Dank für die Zusammenarbeit.',
    paymentText: 'Bitte überweise den Betrag bis zum {DUEDATE} auf das unten genannte Konto.',
    buyerReference: '', currency: 'EUR'
  },
  {
    id: 're_2', number: 'RE-2026-0002', status: 'sent', customerId: 'kd_2',
    issueDate: '2026-04-02', deliveryDate: '2026-03-31', dueDate: '2026-04-16', paymentTermsDays: 14,
    items: [{ name: 'Umsetzung Webauftritt', quantity: 15, unit: 'HUR', unitPriceNet: 12000, vatRate: 19 }],
    payments: [{ date: '2026-04-18', amount: 214200, entryId: 'buch_2' }],
    intro: '', outro: '', paymentText: 'Zahlbar bis zum {DUEDATE}.',
    buyerReference: '991-12345-67', currency: 'EUR'
  },
  {
    id: 're_3', number: 'RE-2026-0003', status: 'sent', customerId: 'kd_3',
    issueDate: '2026-09-01', deliveryDate: '2026-08-31', dueDate: '2026-09-15', paymentTermsDays: 14,
    items: [{ name: 'Konzeptphase', quantity: 1, unit: 'LS', unitPriceNet: 150000, vatRate: 19 }],
    payments: [], intro: '', outro: '', paymentText: 'Zahlbar bis zum {DUEDATE}.',
    buyerReference: '', currency: 'EUR'
  },
  {
    id: 're_4', number: null, status: 'draft', customerId: 'kd_1',
    issueDate: '2026-09-16', deliveryDate: '2026-09-16', dueDate: '2026-09-30', paymentTermsDays: 14,
    items: [{ name: 'Betreuungspauschale Oktober', quantity: 1, unit: 'MON', unitPriceNet: 80000, vatRate: 19 }],
    payments: [], intro: '', outro: '', paymentText: 'Zahlbar bis zum {DUEDATE}.',
    buyerReference: '', currency: 'EUR'
  }
];

const invoices = [...rawInvoices, overdueInvoice, ...rawOffers].map((invoice) => ({
  documentType: invoice.documentType || 'invoice',
  ...invoice,
  computed: invoicesDomain.totals(invoice),
  resolvedStatus: invoicesDomain.resolveStatus(invoice, TODAY)
}));

/** Beispielvorlagen: eine Ausgabe per Lastschrift, eine laufende Betreuung. */
const recurrences = [
  recurringDomain.normalize({
    id: 'wdh_1', kind: 'entry', label: 'Büromiete', markPaid: true,
    rule: { interval: 'monthly', startDate: '2026-01-01' },
    template: {
      type: 'expense', amount: 71400, categoryId: 'exp_rent',
      description: 'Büromiete {PERIOD}', counterparty: 'Hausverwaltung Nord',
      paymentMethod: 'direct_debit', segmentId: settings.segments[1].id
    }
  }),
  recurringDomain.normalize({
    id: 'wdh_2', kind: 'entry', label: 'Server und Domains', markPaid: true,
    rule: { interval: 'monthly', startDate: '2026-01-10' },
    template: {
      type: 'expense', amount: 4760, categoryId: 'exp_software',
      description: 'Hosting {PERIOD}', counterparty: 'Serverhaus',
      paymentMethod: 'direct_debit', segmentId: settings.segments[0].id
    }
  }),
  recurringDomain.normalize({
    id: 'wdh_3', kind: 'invoice', label: 'Betreuungspauschale Kundenfirma',
    rule: { interval: 'monthly', startDate: '2026-03-01' },
    template: {
      customerId: 'kd_1', segmentId: settings.segments[1].id, paymentTermsDays: 14,
      items: [{ name: 'Technische Betreuung', description: 'Wartung und Support {PERIOD}', quantity: 1, unit: 'MON', unitPriceNet: 45000, vatRate: 19 }],
      intro: 'Betreuungspauschale für {PERIOD}.',
      bodyText: 'Bitte überweise {AMOUNT} bis zum {DUEDATE}.'
    }
  })
];

/* Zwei frühere Einlesevorgänge, damit die Nachweisliste nicht leer steht. */
const imports = [
  {
    id: 'imp_1', fileName: 'umsaetze_2026-07.csv', importedAt: `${YEAR}-08-02T09:12:00.000Z`,
    rowCount: 24, entries: 19, payments: 4, skipped: 1, from: `${YEAR}-07-01`, to: `${YEAR}-07-31`
  },
  {
    id: 'imp_2', fileName: 'umsaetze_2026-08.csv', importedAt: `${YEAR}-09-01T08:40:00.000Z`,
    rowCount: 21, entries: 16, payments: 5, skipped: 0, from: `${YEAR}-08-01`, to: `${YEAR}-08-31`
  }
];

/* Erfasste Zeiten auf die beiden Projekte, teils schon abgerechnet. */
const times = [
  { id: 'zeit_1', date: `${YEAR}-09-01`, projectId: 'prj_1', description: 'Entwurf Startseite', minutes: 210, rateCents: 9500, billable: true, invoiceId: null, invoicedAt: null, note: '', createdAt: `${YEAR}-09-01T09:00:00.000Z`, updatedAt: `${YEAR}-09-01T12:30:00.000Z` },
  { id: 'zeit_2', date: `${YEAR}-09-03`, projectId: 'prj_1', description: 'Abstimmung mit dem Kunden', minutes: 75, rateCents: 9500, billable: true, invoiceId: null, invoicedAt: null, note: '', createdAt: `${YEAR}-09-03T10:00:00.000Z`, updatedAt: `${YEAR}-09-03T11:15:00.000Z` },
  { id: 'zeit_3', date: `${YEAR}-09-08`, projectId: 'prj_1', description: 'Umsetzung Formulare', minutes: 330, rateCents: 9500, billable: true, invoiceId: null, invoicedAt: null, note: '', createdAt: `${YEAR}-09-08T09:00:00.000Z`, updatedAt: `${YEAR}-09-08T15:30:00.000Z` },
  { id: 'zeit_4', date: `${YEAR}-09-10`, projectId: null, description: 'Buchhaltung und Ablage', minutes: 90, rateCents: 0, billable: false, invoiceId: null, invoicedAt: null, note: '', createdAt: `${YEAR}-09-10T16:00:00.000Z`, updatedAt: `${YEAR}-09-10T17:30:00.000Z` },
  { id: 'zeit_5', date: `${YEAR}-06-15`, projectId: 'prj_2', description: 'Migration der Inhalte', minutes: 480, rateCents: 8500, billable: true, invoiceId: 're_2', invoicedAt: `${YEAR}-06-30T10:00:00.000Z`, note: '', createdAt: `${YEAR}-06-15T08:00:00.000Z`, updatedAt: `${YEAR}-06-15T16:00:00.000Z` }
];

const data = { settings, entries, customers, projects, recurrences, assets, receipts, invoices, imports, times };

/* Vorberechnete Antworten, damit die Vorschau ohne Hauptprozess auskommt. */

const euerResult = euer.calculate(entries, assets, YEAR);
const months = euer.monthlyTotals(entries, YEAR);
const vatOverview = vat.yearOverview(entries, settings, YEAR);
const vatPeriods = {};
for (const period of vat.periodsOf(YEAR, settings.tax.vatPeriod, settings.tax.dauerfristverlaengerung)) {
  vatPeriods[period.key] = vat.calculate(entries, settings, period);
}

const openInvoices = invoices
  .filter((inv) => {
    // Wie in der App: nur echte Rechnungen sind Forderungen.
    const type = doctypes.DOCUMENT_TYPES[inv.documentType || 'invoice'];
    if (!type || type.group !== 'invoice' || type.id === 'creditnote') return false;
    return ['sent', 'overdue', 'partial'].includes(inv.resolvedStatus);
  })
  .map((inv) => ({
    id: inv.id, number: inv.number, dueDate: inv.dueDate, customerId: inv.customerId,
    open: inv.computed.openAmount, status: inv.resolvedStatus
  }));

const dashboard = {
  year: YEAR,
  profit: euerResult.profit,
  incomeTotal: euerResult.incomeTotal,
  expenseTotal: euerResult.expenseTotal,
  collectedVat: euerResult.collectedVat,
  paidInputVat: euerResult.paidInputVat,
  months,
  openInvoices,
  openTotals: euerResult.open,
  nextPeriod: vatOverview.find((p) => p.dueDate >= TODAY) || null,
  turnover: entries.filter((e) => e.type === 'income' && euer.taxYearOf(e) === YEAR).reduce((s, e) => s + e.gross, 0),
  entriesCount: entries.filter((e) => euer.taxYearOf(e) === YEAR).length,
  missingReceipts: entries.filter((e) => euer.taxYearOf(e) === YEAR && e.type === 'expense' && !e.receiptId && e.gross > 25000).length
};

const boot = {
  settings,
  dataDir: 'C:\\Users\\Beispiel\\Dokumente\\NestEgg',
  today: TODAY,
  categories: { income: categories.categoriesFor('income'), expense: categories.categoriesFor('expense') },
  vatRates: VAT_RATES,
  paymentMethods: entriesDomain.PAYMENT_METHODS,
  units: invoicesDomain.UNITS,
  usefulLives: assetsDomain.USEFUL_LIFE_SUGGESTIONS,
  invoiceStatus: doctypes.ALL_STATUS,
  documentTypes: doctypes.DOCUMENT_TYPES,
  segments: segmentsDomain.listSegments(settings),
  segmentKinds: segmentsDomain.SEGMENT_KINDS,
  projectStatus: projectsDomain.PROJECT_STATUS,
  recurrenceIntervals: recurrenceDomain.INTERVALS,
  recurringKinds: recurringDomain.KINDS,
  dunningLevels: dunningDomain.LEVELS,
  deadlineKinds: deadlinesDomain.KINDS,
  profiles: {
    profiles: [
      { id: 'prf_1', name: 'Beispiel Consulting', dir: 'C:\\Users\\Beispiel\\Dokumente\\NestEgg', active: true, exists: true, createdAt: '2026-01-02T10:00:00.000Z' },
      { id: 'prf_2', name: 'Turnverein Musterstadt e. V.', dir: 'C:\\Users\\Beispiel\\Dokumente\\NestEgg\\profile\\turnverein-musterstadt-e-v', active: false, exists: true, createdAt: '2026-09-17T09:00:00.000Z' }
    ],
    activeProfileId: 'prf_1',
    root: 'C:\\Users\\Beispiel\\Dokumente\\NestEgg\\profile'
  },
  countries: analytics.countryOptions(),
  defaultTexts: doctypes.DEFAULT_TEXTS,
  themePresets: Object.entries(themeLib.PRESETS).map(([id, p]) => ({ id, label: p.label, hint: p.hint })),
  themeFonts: themeLib.FONT_LABELS,
  defaultTheme: themeLib.DEFAULT_THEME,
  version: '1.0.0 (Vorschau)'
};

const TODAY_ISO = TODAY;

const fixture = {
  boot,
  data,
  analytics: analytics.analyze(data, YEAR),
  reserve: forecast.taxReserve(data, YEAR, TODAY_ISO),
  liquidity: forecast.liquidity(data, TODAY_ISO, 6),
  ecSales: {
    overview: ecsales.yearOverview(entries, customers, YEAR, 'quarterly'),
    periods: Object.fromEntries(
      ecsales.periodsOf(YEAR, 'quarterly').map((p) => [p.key, ecsales.calculate(entries, customers, p)])
    ),
    needsMonthly: ecsales.needsMonthly(entries, customers, YEAR)
  },
  dunningOverdue: dunningDomain
    .collectOverdue(invoices, customers, settings, TODAY)
    .map((row) => ({
      invoiceId: row.invoice.id, number: row.invoice.number, issueDate: row.invoice.issueDate,
      dueDate: row.invoice.dueDate, customerId: row.invoice.customerId,
      customerName: row.customer.name || '', open: row.open, overdueDays: row.overdueDays,
      sentCount: row.sentCount, lastReminder: row.lastReminder, nextLevel: row.nextLevel,
      nextLevelLabel: dunningDomain.getLevel(row.nextLevel).label, ready: row.ready
    })),
  dunningPrepared: (() => {
    const invoice = invoices.find((i) => i.id === 're_5');
    const customer = customers.find((c) => c.id === 'kd_3');
    const prepared = dunningDomain.prepare(invoice, customer, settings, TODAY);
    return {
      ...prepared,
      customerName: customer.name,
      levels: dunningDomain.LEVELS,
      salutation: settings.invoice.salutation,
      texts: settings.texts.reminder || {}
    };
  })(),
  deadlines: (() => {
    const full = { settings, entries, customers, projects, recurrences, assets, receipts, invoices };
    const result = deadlinesDomain.collect(full, YEAR, TODAY, { horizonDays: 180 });
    return { ...result, months: deadlinesDomain.groupByMonth(result.items), kinds: deadlinesDomain.KINDS };
  })(),
  recurringDue: (() => {
    const groups = recurringDomain.collectDue(recurrences, { entries, invoices }, TODAY);
    return {
      count: groups.reduce((sum, g) => sum + g.dates.length, 0),
      groups: groups.map((group) => ({
        templateId: group.template.id,
        label: group.template.label,
        kind: group.template.kind,
        dates: group.dates,
        items: group.items.map((item) => ({
          date: item.date,
          summary: group.template.kind === 'entry'
            ? {
                description: item.preview.description,
                counterparty: item.preview.counterparty,
                gross: item.preview.gross,
                type: item.preview.type,
                paid: Boolean(item.preview.paidDate)
              }
            : {
                description: 'Rechnung an Kundenfirma GmbH',
                counterparty: 'Kundenfirma GmbH',
                gross: invoicesDomain.totals(item.preview).grossTotal,
                type: 'income',
                paid: false
              }
        }))
      }))
    };
  })(),
  /**
   * Ein Kontoauszug, wie ihn eine Sparkasse ausgibt.
   *
   * Er wird hier wirklich durch den Leser geschickt, nicht von Hand
   * zusammengestellt: die Vorschau zeigt damit dasselbe Ergebnis wie die App.
   */
  bankStatement: (() => {
    const offen = invoices.find((i) => {
      const status = invoicesDomain.resolveStatus(i, TODAY);
      return ['sent', 'overdue'].includes(status) && invoicesDomain.totals(i).openAmount > 0;
    });
    const offenerBetrag = offen ? (invoicesDomain.totals(offen).openAmount / 100).toFixed(2).replace('.', ',') : '1.142,40';

    const csvLines = [
      'Auszug;Girokonto;;;;;;;;;',
      'Kontonummer;DE02 1203 0000 0000 2020 51;;;;;;;;;',
      '',
      'Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;BIC;Betrag;Waehrung;Info',
      `${de(TODAY, -3)};${de(TODAY, -3)};GUTSCHRIFT;Zahlung ${offen ? offen.number : 'RE-2026-0004'} vielen Dank;Kundenfirma GmbH;DE44100110012620001111;NTSBDEB1;${offenerBetrag};EUR;Umsatz gebucht`,
      `${de(TODAY, -5)};${de(TODAY, -5)};LASTSCHRIFT;Hetzner Online GmbH Rechnung R0089123 Server;HETZNER ONLINE GMBH;DE24760400610327190900;COBADEFF;-23,80;EUR;Umsatz gebucht`,
      `${de(TODAY, -6)};${de(TODAY, -6)};LASTSCHRIFT;Telekom Deutschland Mobilfunk 09/2026;TELEKOM DEUTSCHLAND GMBH;DE13500700100175526303;DEUTDEFF;-49,99;EUR;Umsatz gebucht`,
      `${de(TODAY, -8)};${de(TODAY, -8)};KARTENZAHLUNG;REWE SAGT DANKE Einkauf;REWE MARKT GMBH;DE89370400440532013000;COBADEFF;-64,32;EUR;Umsatz gebucht`,
      `${de(TODAY, -11)};${de(TODAY, -11)};DAUERAUFTRAG;Miete Büro Musterweg 12 September;IMMOBILIEN VERWALTUNG KG;DE02300209000106531065;CMCIDEDD;-680,00;EUR;Umsatz gebucht`,
      `${de(TODAY, -12)};${de(TODAY, -12)};GUTSCHRIFT;STRIPE PAYOUT GuildNest Abos August;STRIPE TECHNOLOGY EUROPE LTD;IE29AIBK93115212345678;AIBKIE2D;2.481,17;EUR;Umsatz gebucht`,
      `${de(TODAY, -15)};${de(TODAY, -15)};UEBERWEISUNG;Finanzamt Umsatzsteuer-Vorauszahlung;FINANZAMT BERLIN;DE38100500000350000000;BELADEBE;-612,00;EUR;Umsatz gebucht`,
      `${de(TODAY, -18)};${de(TODAY, -18)};LASTSCHRIFT;Hetzner Online GmbH Rechnung R0088004 Server;HETZNER ONLINE GMBH;DE24760400610327190900;COBADEFF;-23,80;EUR;Umsatz gebucht`,
      '',
      'Anfangssaldo;;;;;;;12.400,00;EUR;'
    ];

    const statement = bankimport.readStatement(Buffer.from(csvLines.join('\r\n'), 'utf8'));
    const rows = bankimport.plan(statement.transactions, data, TODAY);

    return {
      file: 'C:\\Users\\Beispiel\\Downloads\\umsaetze_2026-09.csv',
      fileName: 'umsaetze_2026-09.csv',
      encoding: statement.encoding,
      delimiter: statement.delimiter,
      headerRow: statement.headerRow,
      columns: statement.columns,
      warnings: statement.warnings,
      rows,
      summary: bankimport.summarize(rows)
    };
  })(),
  /**
   * Eine empfangene E-Rechnung, wirklich durch den Leser geschickt.
   *
   * Erzeugt wird sie mit demselben CII-Baukasten, mit dem die App ihre eigenen
   * Rechnungen schreibt: so zeigt die Vorschau echte gelesene Werte.
   */
  eInvoice: (() => {
    const lieferant = {
      name: 'Hetzner Online GmbH', street: 'Industriestr. 25', zip: '91710', city: 'Gunzenhausen',
      country: 'DE', email: 'info@hetzner.com', taxNumber: '203/123/40000', vatId: 'DE812871812',
      bankName: 'Sparkasse', iban: 'DE24760400610327190900', bic: 'COBADEFF'
    };
    const empfaenger = {
      name: settings.company.name, street: settings.company.street, zip: settings.company.zip,
      city: settings.company.city, country: 'DE', vatId: settings.company.vatId
    };
    const doc = {
      number: 'R0089123',
      issueDate: `${YEAR}-09-01`,
      deliveryDate: `${YEAR}-08-31`,
      dueDate: `${YEAR}-09-15`,
      currency: 'EUR',
      payments: [],
      items: [
        { name: 'Cloud Server CX41', description: 'Abrechnungszeitraum August 2026', quantity: 1, unit: 'C62', unitPriceNet: 1600, vatRate: 19 },
        { name: 'Zusätzlicher Speicher 100 GB', quantity: 1, unit: 'C62', unitPriceNet: 400, vatRate: 19 }
      ]
    };

    const parsed = einvoiceRead.readCii(xmlread.parse(cii.build(doc, lieferant, empfaenger)));
    parsed.source = 'zugferd';
    parsed.fileName = 'R0089123.pdf';

    return {
      file: 'C:\\Users\\Beispiel\\Downloads\\R0089123.pdf',
      fileName: 'R0089123.pdf',
      invoice: parsed,
      warnings: einvoiceRead.checkInvoice(parsed),
      entry: einvoiceRead.toEntry(parsed, {}),
      existingEntryId: null
    };
  })(),
  /**
   * Ein zweites, vollständiges Beispiel: der Verein.
   *
   * Die Vorschau schaltet beim Profilwechsel darauf um. So lässt sich prüfen,
   * dass Kategorien, Navigation und Auswertung wirklich der Körperschaft
   * folgen und nicht nur anders beschriftet sind.
   */
  club: (() => {
    const clubSettings = deepMerge(defaultSettings(), {
      company: {
        name: 'Turnverein Musterstadt e. V.', owner: 'Vorstand',
        street: 'Sportplatzweg 1', zip: '86150', city: 'Augsburg', country: 'DE',
        email: 'kasse@turnverein-musterstadt.de', taxNumber: '103/456/78901',
        bankName: 'Stadtsparkasse', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFF'
      },
      entity: {
        kind: 'club', charitable: true, purpose: 'des Sports',
        noticeType: 'freistellung', noticeDate: `${YEAR - 1}-04-10`,
        noticeOffice: 'Augsburg-Stadt', noticeYear: String(YEAR - 2),
        boardName: 'Vorname Nachname', boardRole: 'Erster Vorstand'
      },
      tax: { vatPeriod: 'quarterly' },
      membership: {
        tiers: [
          { id: 'bk_erw', label: 'Erwachsene', amount: 12000, interval: 'yearly' },
          { id: 'bk_jug', label: 'Jugend und Studierende', amount: 6000, interval: 'yearly' },
          { id: 'bk_fam', label: 'Familie', amount: 18000, interval: 'yearly' },
          { id: 'bk_foerder', label: 'Fördernd', amount: 1500, interval: 'quarterly' }
        ],
        categoryId: 'cl_inc_dues', dueMonth: 1, dueDay: 15, honoraryFree: true
      },
      sepa: {
        // Die offizielle Test-Gläubiger-ID der Bundesbank.
        creditorId: 'DE98ZZZ09999999999',
        creditorName: '', scheme: 'CORE', sequenceType: 'RCUR',
        painVersion: 'pain.008.001.08', preNotificationDays: 14, batchBooking: true
      },
      reserve: { incomeTaxRate: 0, tradeTaxRate: 0, accountBalance: 1800000, accountBalanceDate: `${YEAR - 1}-12-31` },
      ui: { lastYear: YEAR }
    });

    const members = [
      { id: 'kd_m1', name: 'Erika Musterfrau', street: 'Beispielweg 3', zip: '86150', city: 'Augsburg', country: 'DE', vatId: '', buyerReference: '', isPublicAuthority: false },
      { id: 'kd_m2', name: 'Max Mustermann', street: 'Musterstraße 17', zip: '86157', city: 'Augsburg', country: 'DE', vatId: '', buyerReference: '', isPublicAuthority: false },
      { id: 'kd_m3', name: 'Sportbedarf Süd GmbH', street: 'Industriestraße 4', zip: '86167', city: 'Augsburg', country: 'DE', vatId: 'DE111222333', buyerReference: '', isPublicAuthority: false }
    ];

    const raw = [
      { type: 'income', date: `${YEAR}-02-03`, paidDate: `${YEAR}-02-03`, amount: 50000, categoryId: 'cl_inc_donation', sphereId: 'ideell', description: 'Spende', counterparty: 'Erika Musterfrau', memberId: 'mg_1' },
      { type: 'income', date: `${YEAR}-06-20`, paidDate: `${YEAR}-06-20`, amount: 25000, categoryId: 'cl_inc_donation', sphereId: 'ideell', description: 'Spende Sommerfest', counterparty: 'Erika Musterfrau', memberId: 'mg_1' },
      { type: 'income', date: `${YEAR}-04-12`, paidDate: `${YEAR}-04-12`, amount: 150000, categoryId: 'cl_inc_grant', sphereId: 'ideell', description: 'Zuschuss Stadt Augsburg', counterparty: 'Stadt Augsburg' },
      // Eine Spende, die von einem Mitglied kommt und nicht von einem Kunden.
      { type: 'income', date: `${YEAR}-07-02`, paidDate: `${YEAR}-07-02`, amount: 40000, categoryId: 'cl_inc_donation', sphereId: 'ideell', description: 'Spende Jugendabteilung', counterparty: 'Petra Schuster', memberId: 'mg_5' },

      { type: 'income', date: `${YEAR}-05-02`, paidDate: `${YEAR}-05-02`, amount: 90000, categoryId: 'cl_inc_sponsor_passive', sphereId: 'vermoegen', description: 'Banner am Sportplatz, nur Duldung', counterparty: 'Sportbedarf Süd GmbH', customerId: 'kd_m3' },
      { type: 'income', date: `${YEAR}-06-30`, paidDate: `${YEAR}-06-30`, amount: 4200, categoryId: 'cl_inc_interest', sphereId: 'vermoegen', description: 'Zinsen Tagesgeld', counterparty: 'Stadtsparkasse' },

      { type: 'income', date: `${YEAR}-05-18`, paidDate: `${YEAR}-05-18`, amount: 320000, categoryId: 'cl_inc_events', sphereId: 'zweckbetrieb', description: 'Eintritt Frühjahrsturnier', counterparty: 'Tageskasse', sportsEvent: true },
      { type: 'income', date: `${YEAR}-09-06`, paidDate: `${YEAR}-09-06`, amount: 145000, categoryId: 'cl_inc_courses', sphereId: 'zweckbetrieb', description: 'Kursgebühren Herbstkurs', counterparty: 'Teilnehmer' },

      { type: 'income', date: `${YEAR}-05-18`, paidDate: `${YEAR}-05-18`, amount: 610000, categoryId: 'cl_inc_catering', sphereId: 'wirtschaftlich', description: 'Bewirtung Frühjahrsturnier', counterparty: 'Tageskasse' },
      { type: 'income', date: `${YEAR}-07-11`, paidDate: `${YEAR}-07-11`, amount: 280000, categoryId: 'cl_inc_ads', sphereId: 'wirtschaftlich', description: 'Trikotwerbung, aktive Bewerbung', counterparty: 'Sportbedarf Süd GmbH', customerId: 'kd_m3' },
      { type: 'income', date: `${YEAR}-08-24`, paidDate: `${YEAR}-08-24`, amount: 95000, categoryId: 'cl_inc_sales', sphereId: 'wirtschaftlich', description: 'Verkauf Vereinskleidung', counterparty: 'Mitglieder' },

      { type: 'expense', date: `${YEAR}-01-05`, paidDate: `${YEAR}-01-05`, amount: 96000, categoryId: 'cl_exp_volunteer', sphereId: 'ideell', description: 'Ehrenamtspauschale Kassenwart', counterparty: 'Kassenwart' },
      { type: 'expense', date: `${YEAR}-01-20`, paidDate: `${YEAR}-01-20`, amount: 180000, categoryId: 'cl_exp_fees_assoc', sphereId: 'ideell', description: 'Beitrag Landessportverband', counterparty: 'BLSV' },
      { type: 'expense', date: `${YEAR}-02-01`, paidDate: `${YEAR}-02-01`, amount: 71400, categoryId: 'cl_exp_insurance', sphereId: 'ideell', description: 'Vereinshaftpflicht', counterparty: 'Versicherung' },
      { type: 'expense', date: `${YEAR}-03-15`, paidDate: `${YEAR}-03-15`, amount: 23800, categoryId: 'cl_exp_admin', sphereId: 'ideell', description: 'Vereinssoftware Jahreslizenz', counterparty: 'Software GmbH' },
      { type: 'expense', date: `${YEAR}-04-01`, paidDate: `${YEAR}-04-01`, amount: 330000, categoryId: 'cl_exp_trainer', sphereId: 'ideell', description: 'Übungsleiterpauschale Jahresbetrag', counterparty: 'Übungsleiterin' },

      { type: 'expense', date: `${YEAR}-05-10`, paidDate: `${YEAR}-05-10`, amount: 214200, categoryId: 'cl_exp_sports', sphereId: 'zweckbetrieb', description: 'Hallenmiete erstes Halbjahr', counterparty: 'Stadt Augsburg' },
      { type: 'expense', date: `${YEAR}-05-18`, paidDate: `${YEAR}-05-18`, amount: 88000, categoryId: 'cl_exp_events', sphereId: 'zweckbetrieb', description: 'Kosten Frühjahrsturnier', counterparty: 'Diverse', sportsEvent: true },
      { type: 'expense', date: `${YEAR}-06-05`, paidDate: `${YEAR}-06-05`, amount: 45000, categoryId: 'cl_exp_referee', sphereId: 'zweckbetrieb', description: 'Schiedsrichter und Startgelder', counterparty: 'Verband' },

      { type: 'expense', date: `${YEAR}-05-16`, paidDate: `${YEAR}-05-16`, amount: 310000, categoryId: 'cl_exp_catering', sphereId: 'wirtschaftlich', description: 'Wareneinkauf Turnier', counterparty: 'Getränkehandel' },
      { type: 'expense', date: `${YEAR}-08-20`, paidDate: `${YEAR}-08-20`, amount: 62000, categoryId: 'cl_exp_catering', sphereId: 'wirtschaftlich', description: 'Einkauf Vereinskleidung', counterparty: 'Sportbedarf Süd GmbH' },
      { type: 'expense', date: `${YEAR}-09-10`, paidDate: `${YEAR}-09-10`, amount: 41000, categoryId: 'cl_exp_ads', sphereId: 'wirtschaftlich', description: 'Druck Bandenwerbung', counterparty: 'Druckerei' }
    ];

    // Ein kleiner Bestand mit allem, was in der Ansicht auseinandergehalten
    // werden muss: Beitragsklassen, Zahlweisen, ein Eintritt und ein Austritt
    // im laufenden Jahr, ein Ehrenmitglied und ein abweichender Beitrag.
    const clubMembers = [
      { number: '0001', firstName: 'Erika', lastName: 'Musterfrau', kind: 'active', tierId: 'bk_erw', birthDate: '1984-04-12', joinedAt: '2014-03-01', street: 'Beispielweg 3', zip: '86150', city: 'Augsburg', email: 'erika@example.org', payment: 'debit', iban: 'DE02120300000000202051', mandateRef: 'TVM-0001', mandateDate: '2014-03-01' },
      { number: '0002', firstName: 'Max', lastName: 'Mustermann', kind: 'active', tierId: 'bk_fam', birthDate: '1979-11-02', joinedAt: '2012-09-01', street: 'Musterstraße 17', zip: '86157', city: 'Augsburg', payment: 'debit', iban: 'DE02500105170137075030', mandateRef: 'TVM-0002', mandateDate: '2012-09-01' },
      { number: '0003', firstName: 'Lena', lastName: 'Bauer', kind: 'youth', tierId: 'bk_jug', birthDate: '2011-06-23', joinedAt: `${YEAR}-03-01`, street: 'Lindenweg 8', zip: '86150', city: 'Augsburg', payment: 'debit', iban: 'DE02300209000106531065', mandateRef: 'TVM-0003', mandateDate: `${YEAR}-03-01` },
      { number: '0004', firstName: 'Jonas', lastName: 'Bauer', kind: 'youth', tierId: 'bk_jug', birthDate: '2009-02-14', joinedAt: '2019-09-01', street: 'Lindenweg 8', zip: '86150', city: 'Augsburg', payment: 'debit', iban: 'DE02300209000106531065', mandateRef: 'TVM-0004', mandateDate: '2019-09-01', customAmount: 3000, note: 'Geschwisterermäßigung' },
      { number: '0005', firstName: 'Petra', lastName: 'Schuster', kind: 'passive', tierId: 'bk_foerder', birthDate: '1966-08-30', joinedAt: '2008-01-01', street: 'Ulmer Straße 42', zip: '86154', city: 'Augsburg', payment: 'transfer' },
      { number: '0006', firstName: 'Heinrich', lastName: 'Vogel', kind: 'honorary', tierId: 'bk_erw', birthDate: '1948-01-19', joinedAt: '1972-05-01', street: 'Am Sportplatz 2', zip: '86150', city: 'Augsburg', payment: 'transfer', note: 'Ehrenmitglied seit 2004' },
      { number: '0007', firstName: 'Sofia', lastName: 'Keller', kind: 'active', tierId: 'bk_erw', birthDate: '1995-12-05', joinedAt: '2021-01-01', leftAt: `${YEAR}-06-30`, street: 'Bahnhofstraße 11', zip: '86150', city: 'Augsburg', payment: 'debit', iban: 'DE02100500000054540402', mandateRef: 'TVM-0007', mandateDate: '2021-01-01' }
    ].map((member, index) => membersDomain.normalizeMember({ id: `mg_${index + 1}`, ...member }));

    // Die Beiträge entstehen aus dem Beitragslauf und nicht als Pauschalzeile.
    // So passen Mitgliederliste, Beitragsaufkommen und Buchungen zusammen, und
    // der Lastschrifteinzug hat etwas zu ziehen.
    const duesEntries = membersDomain
      .plan(clubMembers, clubSettings.membership, YEAR, [])
      .filter((row) => !row.skip)
      .map((row, index) => entriesDomain.normalizeEntry({
        id: `cbeitrag_${index + 1}`,
        segmentId: null,
        ...membersDomain.toEntry(row, clubSettings.membership)
      }));

    // Zwei Beiträge gelten als schon eingezogen. Damit hat die Vorschau einen
    // gelaufenen Einzug, und die Rücklastschrift weiter unten findet eine
    // Forderung, zu der sie gehört.
    const EINZUG_REF = 'NESTEGG-20260901103000';
    for (const entry of duesEntries) {
      if (!['mg_1', 'mg_2'].includes(entry.memberId)) continue;
      entry.sepaRef = EINZUG_REF;
      entry.sepaExportedAt = `${YEAR}-09-01T10:30:00.000Z`;
    }

    /**
     * Drei Aufwendungsersatzansprüche, die zusammen den ganzen Ablauf zeigen:
     * einer ist schon verzichtet und gebucht, einer wartet auf den Verzicht,
     * und einer ist nachträglich vereinbart und deshalb keine Aufwandsspende.
     */
    const clubClaims = [
      claimsDomain.normalizeClaim({
        id: 'anp_1', memberId: 'mg_1', name: 'Erika Musterfrau',
        basis: 'bylaws', basisDate: '2019-04-12', basisNote: '§12 Abs. 3 der Satzung',
        kind: 'travel', date: `${YEAR}-05-18`, kilometers: 180,
        description: 'Fahrt zum Frühjahrsturnier und zurück',
        sphereId: 'zweckbetrieb',
        waivedAt: `${YEAR}-06-02`,
        expenseEntryId: 'cbuch_aufwand_1', donationEntryId: 'cbuch_spende_1'
      }),
      claimsDomain.normalizeClaim({
        id: 'anp_2', memberId: 'mg_2', name: 'Max Mustermann',
        basis: 'contract', basisDate: `${YEAR}-06-01`, basisNote: 'Vereinbarung vom 01.06.',
        kind: 'material', date: `${YEAR}-07-20`, amount: 8740,
        description: 'Farbe und Pinsel für die Kabinen',
        sphereId: 'ideell'
      }),
      claimsDomain.normalizeClaim({
        id: 'anp_3', name: 'Heinrich Vogel', memberId: 'mg_6',
        basis: 'board', basisDate: `${YEAR}-08-10`, basisNote: 'Beschluss vom 10.08.',
        kind: 'phone', date: `${YEAR}-07-01`, amount: 4500,
        description: 'Telefonkosten der Geschäftsstelle',
        sphereId: 'ideell'
      })
    ];

    // Die Buchungen des schon erklärten Verzichts. Zwei Stück, wie im
    // Rechenkern: der Aufwand und die Spende.
    const verzichtet = clubClaims[0];
    const verzichtBuchungen = (() => {
      const plan = claimsDomain.toEntries(verzichtet, {
        expenseCategoryId: 'cl_exp_events', donationCategoryId: 'cl_inc_donation'
      });
      return [
        entriesDomain.normalizeEntry({ id: 'cbuch_aufwand_1', segmentId: null, ...plan.expense }),
        entriesDomain.normalizeEntry({ id: 'cbuch_spende_1', segmentId: null, ...plan.donation })
      ];
    })();

    const clubEntries = raw
      .map((entry, index) => entriesDomain.normalizeEntry({ id: `cbuch_${index + 1}`, segmentId: null, ...entry }))
      .concat(duesEntries)
      .concat(verzichtBuchungen)
      .sort((a, b) => a.date.localeCompare(b.date));

    // Ein Anlagegut und drei Rücklagen, damit die Vermögensübersicht etwas
    // zu zeigen hat.
    const clubAssets = [assetsDomain.normalizeAsset({
      id: 'canl_1', label: 'Rasenmäher', purchaseDate: `${YEAR - 1}-04-15`,
      netCents: 480000, usefulLifeYears: 7, note: 'Pflege des Sportplatzes'
    })];

    const clubReserves = [
      reservesDomain.normalizeReserve({
        id: 'crl_1', type: 'project', label: 'Sanierung Hallendach',
        purpose: 'Erneuerung der Dachabdichtung nach Beschluss der Mitgliederversammlung',
        deadline: `${YEAR + 2}-12-31`,
        movements: [
          { id: 'b1', year: YEAR - 1, date: `${YEAR - 1}-12-31`, kind: 'add', amount: 800000, note: 'Beschluss vom 12.11.' },
          { id: 'b2', year: YEAR, date: `${YEAR}-06-30`, kind: 'add', amount: 400000, note: '' }
        ]
      }),
      reservesDomain.normalizeReserve({
        id: 'crl_2', type: 'replacement', label: 'Wiederbeschaffung Rasenmäher',
        purpose: 'Ersatz nach Ablauf der Nutzungsdauer', assetId: 'canl_1',
        movements: [{ id: 'b1', year: YEAR, date: `${YEAR}-12-31`, kind: 'add', amount: 68571, note: 'in Höhe der Abschreibung' }]
      }),
      reservesDomain.normalizeReserve({
        id: 'crl_3', type: 'free', label: 'Freie Rücklage',
        movements: [{ id: 'b1', year: YEAR, date: `${YEAR}-12-31`, kind: 'add', amount: 120000, note: '' }]
      })
    ];

    const clubData = {
      settings: clubSettings,
      entries: clubEntries,
      customers: members,
      projects: [],
      recurrences: [],
      assets: clubAssets,
      receipts: [],
      invoices: [],
      imports: [],
      times: [],
      donations: [],
      reserves: clubReserves,
      members: clubMembers,
      claims: clubClaims
    };

    const review = spheresDomain.review(clubEntries, YEAR);
    const donationOverview = donationsDomain.overview(clubEntries, [...members, ...clubMembers], YEAR);
    const erika = donationOverview.donors.find((donor) => donor.customerId === 'kd_m1');

    return {
      settings: clubSettings,
      data: clubData,
      boot: {
        settings: clubSettings,
        entity: clubSettings.entity,
        categories: {
          income: categories.categoriesFor('income', 'club'),
          expense: categories.categoriesFor('expense', 'club')
        },
        spheres: spheresDomain.SPHERES,
        sphereLimits: spheresDomain.LIMITS,
        reserveTypes: reservesDomain.TYPES,
        memberKinds: membersDomain.KINDS,
        memberIntervals: membersDomain.INTERVALS,
        sepaSchemes: sepaDomain.SCHEMES,
        sepaSequenceTypes: sepaDomain.SEQUENCE_TYPES,
        painVersions: sepaDomain.PAIN_VERSIONS
      },
      datev: (() => {
        const result = datevExport.buildBookingBatch(clubData, YEAR, {});
        return {
          count: result.count, skipped: result.skipped, chart: result.chart,
          unmapped: result.unmapped, fileName: result.fileName,
          accounts: datevExport.accountMap(clubSettings, 'skr42'),
          charts: datevExport.chartsFor(clubSettings).map((item) => ({ id: item.id, label: item.label, hint: item.hint })),
          entity: 'club',
          sphereCostCenters: datevExport.SPHERE_COST_CENTERS
        };
      })(),
      reserves: {
        overview: reservesDomain.overview(clubReserves, clubEntries, YEAR, TODAY),
        useOfFunds: reservesDomain.useOfFunds(clubEntries, clubReserves, YEAR),
        netAssets: reservesDomain.netAssets(clubData, {
          assetsDomain, invoicesDomain, typeOf: doctypes.typeOf
        }, `${YEAR}-12-31`),
        date: `${YEAR}-12-31`
      },
      spheres: { ...review, definitions: spheresDomain.SPHERES },
      claims: (() => {
        const plan = claimsDomain.overview(clubClaims, YEAR, {
          today: TODAY,
          fundsFor: (claim) => (claim.basisDate ? claimsDomain.fundsOn(clubData, claim.basisDate) : null)
        });
        return {
          ...plan,
          bases: claimsDomain.BASES,
          kinds: claimsDomain.KINDS,
          kilometerRate: claimsDomain.KILOMETER_RATE,
          waiverMonths: claimsDomain.WAIVER_MONTHS,
          today: TODAY,
          knowsFunds: claimsDomain.fundsOn(clubData, TODAY) !== null
        };
      })(),
      /**
       * Der Kontoauszug des Vereins, mit einer Rücklastschrift.
       *
       * Die Zeile ist so gebaut, wie eine Bank sie wirklich schreibt: mit den
       * Schlüsseln EREF, MREF und CRED im Verwendungszweck. Über EREF findet
       * die Rückbuchung die Forderung wieder, die diese App selbst eingezogen
       * hat.
       */
      bankStatement: (() => {
        const erika = duesEntries.find((entry) => entry.memberId === 'mg_1');
        const eref = erika ? returnsDomain.toEndToEnd(erika.duesRef) : 'mg-1-2026';
        const betrag = erika ? (erika.gross / 100).toFixed(2).replace('.', ',') : '120,00';

        const csvLines = [
          'Auszug;Vereinskonto;;;;;;;;;',
          'Kontonummer;DE89 3704 0044 0532 0130 00;;;;;;;;;',
          '',
          'Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;BIC;Betrag;Waehrung;Info',
          `${de(TODAY, -2)};${de(TODAY, -2)};SEPA-RUECKLASTSCHRIFT;EREF+${eref} MREF+TVM-0001 CRED+DE98ZZZ09999999999 SVWZ+RETOURE SEPA-LASTSCHRIFT VOM ${de(TODAY, -16)} MS03;Erika Musterfrau;DE02120300000000202051;BYLADEM1001;-${betrag};EUR;Umsatz gebucht`,
          `${de(TODAY, -2)};${de(TODAY, -2)};ENTGELTABSCHLUSS;Entgelt Rueckgabe Lastschrift;STADTSPARKASSE;;;-3,00;EUR;Umsatz gebucht`,
          `${de(TODAY, -4)};${de(TODAY, -4)};GUTSCHRIFT;Spende Jugendabteilung;Petra Schuster;DE02300209000106531065;CMCIDEDD;400,00;EUR;Umsatz gebucht`,
          `${de(TODAY, -9)};${de(TODAY, -9)};LASTSCHRIFT;Hallenmiete zweites Halbjahr;STADT AUGSBURG;DE38100500000350000000;BELADEBE;-2.142,00;EUR;Umsatz gebucht`,
          '',
          'Anfangssaldo;;;;;;;18.000,00;EUR;'
        ];

        const statement = bankimport.readStatement(Buffer.from(csvLines.join('\r\n'), 'utf8'));
        const rows = bankimport.plan(statement.transactions, clubData, TODAY);

        return {
          file: 'C:\\Users\\Beispiel\\Downloads\\vereinskonto_2026-09.csv',
          fileName: 'vereinskonto_2026-09.csv',
          encoding: statement.encoding,
          delimiter: statement.delimiter,
          headerRow: statement.headerRow,
          columns: statement.columns,
          warnings: statement.warnings,
          rows,
          summary: bankimport.summarize(rows)
        };
      })(),
      members: {
        members: clubMembers,
        statistics: membersDomain.statistics(clubMembers, YEAR),
        expected: membersDomain.expectedDues(clubMembers, clubSettings.membership, YEAR),
        tiers: clubSettings.membership.tiers,
        intervals: membersDomain.INTERVALS,
        kinds: membersDomain.KINDS,
        today: TODAY
      },
      duesPlan: (() => {
        const rows = membersDomain.plan(clubMembers, clubSettings.membership, YEAR, clubEntries);
        return { year: YEAR, rows, summary: membersDomain.summarize(rows) };
      })(),
      preNotification: (() => {
        const plan = membersDomain.preNotificationPlan(clubMembers, clubSettings.membership, YEAR, {
          noticeDays: clubSettings.sepa.preNotificationDays, today: TODAY
        });
        return {
          ...plan,
          creditorId: clubSettings.sepa.creditorId,
          deadline: plan.firstDue
            ? sepaDomain.addDays(plan.firstDue, -clubSettings.sepa.preNotificationDays)
            : null
        };
      })(),
      sepa: (() => {
        const creditor = {
          name: clubSettings.company.name,
          iban: clubSettings.company.iban.replace(/\s/g, ''),
          bic: clubSettings.company.bic
        };
        const byId = new Map(clubMembers.map((member) => [member.id, member]));

        const groups = new Map();
        for (const entry of clubEntries) {
          if (!entry.duesRef || !entry.memberId) continue;
          const member = byId.get(entry.memberId);
          if (!member || member.payment !== 'debit') continue;
          if (!groups.has(entry.date)) groups.set(entry.date, []);
          groups.get(entry.date).push({ entry, member });
        }

        const earliest = sepaDomain.earliestCollectionDate(TODAY, 1);
        const latest = sepaDomain.latestCollectionDate(TODAY);

        const collections = [...groups.keys()].sort().map((dueDate) => {
          const items = groups.get(dueDate);
          // Wie in der App: geprüft wird gegen den Tag, an dem eingezogen
          // wird, nicht gegen den Fälligkeitstag der Buchung.
          const planned = dueDate >= earliest && dueDate <= latest ? dueDate : earliest;

          const collected = sepaDomain.collect(items.map(({ entry, member }) => ({
            member, amount: entry.gross, reference: entry.description,
            endToEndId: entry.duesRef, dueDate: planned
          })), { today: TODAY });

          // Wie in der App: was schon in einer Datei war, wird nicht erneut
          // angeboten. Zwei Beiträge sind im Fixture bereits eingezogen.
          const rows = collected.rows.map((row, index) => ({
            ...row,
            entryId: items[index].entry.id,
            exported: Boolean(items[index].entry.sepaExportedAt),
            exportedAt: items[index].entry.sepaExportedAt || null,
            sepaRef: items[index].entry.sepaRef || null
          }));
          const open = rows.filter((row) => row.ready && !row.exported);

          return {
            dueDate, plannedDate: planned, rows,
            count: open.length,
            total: open.reduce((sum, row) => sum + row.amount, 0),
            exported: rows.filter((row) => row.exported).length,
            blocked: rows.filter((row) => !row.ready).length,
            check: sepaDomain.validateRun({
              creditor, dueDate: planned, rows: open, today: TODAY, settings: clubSettings.sepa
            })
          };
        });

        return {
          year: YEAR, today: TODAY, collections, creditor,
          settings: clubSettings.sepa,
          everExported: duesEntries.some((entry) => entry.sepaExportedAt),
          schemes: sepaDomain.SCHEMES,
          sequenceTypes: sepaDomain.SEQUENCE_TYPES,
          painVersions: sepaDomain.PAIN_VERSIONS,
          earliest,
          latest
        };
      })(),
      donations: donationOverview,
      issued: { receipts: [], confirmedEntryIds: [] },
      prepared: erika
        ? donationsDomain.prepare(erika.entries, clubSettings, members[0], { year: YEAR, today: TODAY })
        : null
    };
  })(),
  thresholds: {
    vatPeriod: thresholdsDomain.vatPeriodAdvice(entries, settings, YEAR),
    smallBusiness: thresholdsDomain.smallBusinessWatch(entries, YEAR, false)
  },
  travel: (() => {
    const from = `${YEAR}-09-01`;
    const to = `${YEAR}-09-03`;
    const days = travelDomain.daysBetween(from, to);
    const result = travelDomain.calculate({ days, kilometers: 240 });
    return { ...result, entries: travelDomain.toEntries({ from, description: 'Kundentermin Hamburg' }, result) };
  })(),
  times: {
    summary: timetracking.summarize(times),
    projects: timetracking.byProject(times, projects),
    months: timetracking.byMonth(times, YEAR),
    running: null,
    rounding: timetracking.ROUNDING
  },
  datev: (() => {
    const result = datevExport.buildBookingBatch(data, YEAR, {});
    return {
      count: result.count, skipped: result.skipped, chart: result.chart,
      unmapped: result.unmapped, fileName: result.fileName,
      accounts: datevExport.accountMap(settings, 'skr03'),
      charts: datevExport.chartsFor(settings).map((item) => ({ id: item.id, label: item.label, hint: item.hint })),
    entity: 'business',
    sphereCostCenters: datevExport.SPHERE_COST_CENTERS
    };
  })(),
  projectTotals: Object.fromEntries(
    projects.map((p) => [
      p.id,
      projectsDomain.projectTotals(p, invoices, entries, entriesDomain.taxEffect)
    ])
  ),
  reports: { euer: euerResult, dashboard, vatYear: { overview: vatOverview, special: null, mode: settings.tax.vatPeriod }, vatPeriods },
  schedules: Object.fromEntries(assets.map((a) => [a.id, assetsDomain.schedule(a)]))
};

const target = path.join(require('./paths').TOOLS, 'fixture.json');
fs.writeFileSync(target, JSON.stringify(fixture, null, 2), 'utf8');

console.log(`Vorschaudaten geschrieben: ${target}`);
const a = fixture.analytics;
console.log(`Gewinn ${(euerResult.profit / 100).toFixed(2)} Euro, ${entries.length} Buchungen, ${invoices.length} Dokumente, ${projects.length} Projekte.`);
console.log(`Umsatz netto ${(a.totals.revenue / 100).toFixed(2)} Euro, davon ${a.recurring.share} Prozent wiederkehrend.`);
console.log('Bereiche: ' + a.bySegment.map((r) => `${r.label} ${(r.revenue / 100).toFixed(0)}`).join(', '));
console.log('Meldung EU: ' + (fixture.ecSales.overview.reduce((s2, p) => s2 + p.total, 0) / 100).toFixed(2) + ' Euro');
