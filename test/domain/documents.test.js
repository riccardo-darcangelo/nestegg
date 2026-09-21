'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const doctypes = require('../../src/domain/doctypes');
const invoices = require('../../src/domain/invoices');
const theme = require('../../src/export/theme');
const { buildCss } = require('../../src/export/document-css');
const documentHtml = require('../../src/export/document-html');
const { Store } = require('../../src/storage/store');

const company = {
  name: 'Beispiel Consulting',
  owner: 'Vorname Nachname',
  street: 'Musterweg 12',
  zip: '10115',
  city: 'Berlin',
  taxNumber: '12/345/67890',
  iban: 'DE02 1203 0000 0000 2020 51'
};

const customer = {
  name: 'Kundenfirma GmbH',
  street: 'Kundenallee 7',
  zip: '20095',
  city: 'Hamburg'
};

function doc(overrides) {
  return {
    number: 'AN-2026-0001',
    documentType: 'quote',
    issueDate: '2026-03-01',
    validUntil: '2026-03-31',
    currency: 'EUR',
    payments: [],
    items: [{ name: 'Beratung', quantity: 10, unit: 'HUR', unitPriceNet: 9000, vatRate: 19 }],
    ...overrides
  };
}

/* ------------------------------------------------------------------ Arten */

test('Jede Dokumentart hat Muster, Gruppe und Statusliste', () => {
  for (const [id, type] of Object.entries(doctypes.DOCUMENT_TYPES)) {
    assert.equal(type.id, id);
    assert.ok(type.defaultPattern.includes('{YYYY}'), `${id} braucht ein Jahresmuster`);
    assert.ok(['invoice', 'offer'].includes(type.group));
    assert.ok(Object.keys(doctypes.statusLabels(id)).length > 0);
  }
});

test('Nur Rechnungen und Stornos tragen ein E-Rechnungs-XML', () => {
  assert.equal(doctypes.DOCUMENT_TYPES.invoice.supportsEInvoice, true);
  assert.equal(doctypes.DOCUMENT_TYPES.creditnote.supportsEInvoice, true);
  assert.equal(doctypes.DOCUMENT_TYPES.quote.supportsEInvoice, false);
  assert.equal(doctypes.DOCUMENT_TYPES.estimate.supportsEInvoice, false);
});

test('Nummernkreise unterscheiden sich je Art', () => {
  const patterns = Object.values(doctypes.DOCUMENT_TYPES).map((t) => t.defaultPattern);
  assert.equal(new Set(patterns).size, patterns.length, 'kein Muster doppelt');
});

/* ------------------------------------------------------------------ Angebote */

test('Ein neues Angebot bekommt Bindefrist statt Fälligkeit', () => {
  const settings = { invoice: { paymentTermsDays: 14, quoteValidityDays: 30 }, texts: {} };
  const quote = invoices.emptyDocument(settings, '2026-03-01', 'quote');

  assert.equal(quote.documentType, 'quote');
  assert.equal(quote.validUntil, '2026-03-31');
  assert.equal(quote.dueDate, null);
  assert.equal(quote.deliveryDate, null, 'ein Angebot hat noch keinen Leistungszeitpunkt');
  assert.equal(quote.showSignature, true);
});

test('Ein Kostenvoranschlag trägt eine Toleranz', () => {
  const settings = { invoice: { estimateTolerance: 20 }, texts: {} };
  const estimate = invoices.emptyDocument(settings, '2026-03-01', 'estimate');
  assert.equal(estimate.tolerancePercent, 20);
});

test('Ein Angebot läuft mit der Bindefrist ab', () => {
  const quote = doc({ status: 'sent' });
  assert.equal(invoices.resolveStatus(quote, '2026-03-15'), 'sent');
  assert.equal(invoices.resolveStatus(quote, '2026-04-01'), 'expired');
});

test('Angenommen und abgelehnt überschreiben den Fristablauf', () => {
  assert.equal(invoices.resolveStatus(doc({ status: 'accepted' }), '2026-12-31'), 'accepted');
  assert.equal(invoices.resolveStatus(doc({ status: 'declined' }), '2026-12-31'), 'declined');
  assert.equal(invoices.resolveStatus(doc({ status: 'invoiced' }), '2026-12-31'), 'invoiced');
});

test('Ein Angebot braucht keine Pflichtangaben nach §14 UStG', () => {
  const ohneAlles = invoices.validateInvoice(
    doc({ deliveryDate: null }),
    { name: 'Firma', street: 'Weg 1', zip: '10115', city: 'Berlin' },
    customer
  );
  assert.deepEqual(ohneAlles.errors, [], 'kein Leistungsdatum, keine Steuernummer: trotzdem gültig');
  assert.ok(ohneAlles.warnings.some((w) => w.includes('Steuernummer')), 'aber als Hinweis');
});

test('Eine Rechnung verlangt dieselben Angaben wie bisher', () => {
  const rechnung = invoices.validateInvoice(
    doc({ documentType: 'invoice', number: 'RE-2026-0001', deliveryDate: null, validUntil: null }),
    { name: 'Firma', street: 'Weg 1', zip: '10115', city: 'Berlin' },
    customer
  );
  assert.ok(rechnung.errors.some((e) => e.includes('Leistungszeitpunkt')));
  assert.ok(rechnung.errors.some((e) => e.includes('Steuernummer')));
});

test('Ein Angebot ohne Bindefrist wird angemahnt, aber nicht blockiert', () => {
  const result = invoices.validateInvoice(doc({ validUntil: null }), company, customer);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((w) => w.includes('Bindefrist')));
});

test('Ein Kostenvoranschlag ohne Toleranz bekommt einen Hinweis', () => {
  const result = invoices.validateInvoice(
    doc({ documentType: 'estimate', tolerancePercent: null }),
    company,
    customer
  );
  assert.ok(result.warnings.some((w) => w.includes('Toleranz')));
});

/* ------------------------------------------------------------------ Nummern */

test('Jede Dokumentart zählt ihren eigenen Kreis', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kontor-nr-'));
  const store = new Store(dir);
  await store.init();

  const re1 = await store.reserveNumber('invoice', '2026-03-01');
  const an1 = await store.reserveNumber('quote', '2026-03-01');
  const an2 = await store.reserveNumber('quote', '2026-04-01');
  const re2 = await store.reserveNumber('invoice', '2026-05-01');

  assert.equal(re1.counter, 1);
  assert.equal(an1.counter, 1, 'der Angebotskreis beginnt eigenständig');
  assert.equal(an2.counter, 2);
  assert.equal(re2.counter, 2, 'die Angebote haben den Rechnungskreis nicht weitergezählt');
});

/* ------------------------------------------------------------------ Theme */

test('Unsinnige Werte werden auf sinnvolle Bereiche gestutzt', () => {
  const t = theme.normalizeTheme({
    accentColor: 'javascript:alert(1)',
    fontSize: 900,
    lineHeight: -3,
    margins: { left: 999, top: 0 },
    fontFamily: 'existiert-nicht',
    logoPosition: 'schräg'
  });

  assert.equal(t.accentColor, theme.DEFAULT_THEME.accentColor, 'keine Farbe, also der Standardwert');
  assert.ok(t.fontSize <= 14 && t.fontSize >= 8);
  assert.ok(t.lineHeight >= 1.1);
  assert.ok(t.margins.left <= 45);
  assert.ok(t.margins.top >= 10);
  assert.equal(t.fontFamily, 'sans');
  assert.equal(t.logoPosition, 'right');
});

test('Eine Vorlage lässt Ränder, Logo und Fußnote unangetastet', () => {
  const eigenes = theme.normalizeTheme({
    margins: { top: 30, right: 15, bottom: 20, left: 40 },
    logoHeight: 35,
    footerNote: 'Gerichtsstand Berlin'
  });
  const mitVorlage = theme.applyPreset(eigenes, 'klassisch');

  assert.equal(mitVorlage.fontFamily, 'serif', 'die Vorlage wirkt');
  assert.deepEqual(mitVorlage.margins, eigenes.margins, 'die Ränder bleiben');
  assert.equal(mitVorlage.logoHeight, 35);
  assert.equal(mitVorlage.footerNote, 'Gerichtsstand Berlin');
});

test('Eine unveränderte Vorlage wird wiedererkannt', () => {
  const klar = theme.applyPreset(theme.DEFAULT_THEME, 'klar');
  assert.equal(theme.detectPreset(klar), 'klar');

  const geaendert = { ...klar, accentColor: '#ff0000' };
  assert.equal(theme.detectPreset(geaendert), 'eigen');
});

test('Die Schriftfarbe auf der Akzentfläche bleibt lesbar', () => {
  assert.equal(theme.readableOn('#0f3d63'), '#ffffff', 'dunkler Grund, helle Schrift');
  assert.equal(theme.readableOn('#f2d98c'), '#1a1a1a', 'heller Grund, dunkle Schrift');
});

/* ------------------------------------------------------------------ CSS */

test('Das CSS übernimmt die eingestellten Werte', () => {
  const css = buildCss({ accentColor: '#aa3311', fontSize: 12, margins: { left: 33 }, fontFamily: 'serif' });
  assert.ok(css.includes('#aa3311'));
  assert.ok(css.includes('font-size: 12pt'));
  assert.ok(css.includes('padding: 20mm 20mm 16mm 33mm'));
  assert.ok(css.includes('Georgia'));
});

test('Abschaltbare Teile verschwinden auch wirklich', () => {
  const ohne = buildCss({ showFooter: false, logoPosition: 'none', senderLineStyle: 'none' });
  assert.ok(ohne.includes('display: none'), 'die Fußzeile ist ausgeblendet');
  assert.ok(ohne.includes('.logo { max-height'), 'die Logoregel existiert');
  assert.ok(/\.logo \{[^}]*display: none/.test(ohne), 'das Logo ist ausgeblendet');
});

test('Die Vorschau lässt die Seite mitwachsen, das PDF nicht', () => {
  assert.ok(buildCss({}, { preview: true }).includes('min-height: 297mm'));
  assert.ok(buildCss({}).includes('height: 297mm'));
  assert.ok(!buildCss({}).includes('min-height: 297mm'));
});

test('Der Zebrastreifen erscheint nur im passenden Tabellenstil', () => {
  assert.ok(buildCss({ tableStyle: 'zebra' }).includes('nth-child(even)'));
  assert.ok(!buildCss({ tableStyle: 'lines' }).includes('nth-child(even)'));
});

/* ------------------------------------------------------------------ Layout */

test('Das Angebot zeigt Bindefrist statt Fälligkeit', () => {
  const html = documentHtml.render(doc({}), company, customer, { theme: theme.DEFAULT_THEME });
  assert.ok(html.includes('Angebotsnummer'));
  assert.ok(html.includes('Gültig bis'));
  assert.ok(html.includes('31.03.2026'));
  assert.ok(!html.includes('Fällig am'));
  assert.ok(html.includes('Angebotssumme'));
});

test('Die Rechnung zeigt Leistungsdatum und Fälligkeit', () => {
  const html = documentHtml.render(
    doc({ documentType: 'invoice', number: 'RE-2026-0001', deliveryDate: '2026-02-28', dueDate: '2026-03-15' }),
    company, customer, { theme: theme.DEFAULT_THEME }
  );
  assert.ok(html.includes('Rechnungsnummer'));
  assert.ok(html.includes('Leistungsdatum'));
  assert.ok(html.includes('Fällig am'));
  assert.ok(html.includes('Rechnungsbetrag'));
});

test('Der Kostenvoranschlag nennt die Toleranz im Text', () => {
  const html = documentHtml.render(
    doc({
      documentType: 'estimate',
      number: 'KV-2026-0001',
      tolerancePercent: 20,
      bodyText: 'Abweichung bis zu {TOLERANCE} Prozent möglich.'
    }),
    company, customer, { theme: theme.DEFAULT_THEME }
  );
  assert.ok(html.includes('Abweichung bis zu 20 Prozent möglich.'));
  assert.ok(html.includes('Geschätzte Gesamtkosten'));
});

test('Platzhalter werden in allen Texten ersetzt', () => {
  const html = documentHtml.render(
    doc({
      documentType: 'invoice',
      number: 'RE-2026-0077',
      dueDate: '2026-03-15',
      deliveryDate: '2026-03-01',
      bodyText: 'Bitte {AMOUNT} bis {DUEDATE} zu {NUMBER} überweisen. Danke, {CUSTOMER}.'
    }),
    company, customer, { theme: theme.DEFAULT_THEME }
  );
  assert.ok(html.includes('1.071,00 Euro'));
  assert.ok(html.includes('15.03.2026'));
  assert.ok(html.includes('RE-2026-0077'));
  assert.ok(html.includes('Kundenfirma GmbH.'));
  // Geschweifte Klammern stehen auch im CSS, gesucht ist das Platzhaltermuster.
  const body = html.slice(html.indexOf('</style>'));
  assert.ok(!/\{[A-Z]+\}/.test(body), 'kein Platzhalter bleibt im Dokument stehen');
});

test('Das Unterschriftsfeld erscheint nur bei Angeboten und nur auf Wunsch', () => {
  const mit = documentHtml.render(doc({ showSignature: true }), company, customer, { theme: theme.DEFAULT_THEME });
  const ohne = documentHtml.render(doc({ showSignature: false }), company, customer, { theme: theme.DEFAULT_THEME });
  assert.ok(mit.includes('Unterschrift Auftraggeber'));
  assert.ok(!ohne.includes('Unterschrift Auftraggeber'));

  const rechnung = documentHtml.render(
    doc({ documentType: 'invoice', showSignature: true, deliveryDate: '2026-03-01' }),
    company, customer, { theme: theme.DEFAULT_THEME }
  );
  assert.ok(!rechnung.includes('Unterschrift Auftraggeber'), 'eine Rechnung unterschreibt niemand');
});

test('Kundentexte landen maskiert im Dokument', () => {
  const html = documentHtml.render(
    doc({ intro: 'Meier & Söhne <script>alert(1)</script>' }),
    company,
    { ...customer, name: 'Müller & Co <b>GmbH</b>' },
    { theme: theme.DEFAULT_THEME }
  );
  assert.ok(html.includes('Meier &amp; Söhne &lt;script&gt;'));
  assert.ok(html.includes('Müller &amp; Co &lt;b&gt;GmbH&lt;/b&gt;'));
  assert.ok(!html.includes('<script>alert'));
});

test('Das Theme wirkt sich auf das erzeugte Dokument aus', () => {
  const html = documentHtml.render(doc({}), company, customer, {
    theme: { accentColor: '#118844', fontFamily: 'serif', accentBar: true }
  });
  assert.ok(html.includes('#118844'));
  assert.ok(html.includes('Georgia'));
  assert.ok(html.includes('.sheet::before'), 'der Akzentbalken ist im CSS');
});

test('Der Storno verweist auf die aufgehobene Rechnung', () => {
  const html = documentHtml.render(
    doc({
      documentType: 'creditnote',
      number: 'ST-2026-0001',
      cancelsInvoiceNumber: 'RE-2026-0042',
      deliveryDate: '2026-02-01',
      validUntil: null
    }),
    company, customer, { theme: theme.DEFAULT_THEME }
  );
  assert.ok(html.includes('Stornonummer'));
  assert.ok(html.includes('Storno zu'));
  assert.ok(html.includes('RE-2026-0042'));
  assert.ok(html.includes('Stornobetrag'));
});
