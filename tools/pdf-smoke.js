'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Prüft die komplette Rechnungsausgabe im echten Electron:
 * HTML rendern, über printToPDF zu PDF machen, das CII-XML einbetten und das
 * Ergebnis wieder aufmachen. Aufruf: npx electron tools/pdf-smoke.js
 *
 * Diese Kette lässt sich nicht in einem gewöhnlichen Node-Test prüfen, weil
 * printToPDF eine Chromium-Instanz braucht.
 */

const { app, BrowserWindow } = require('electron');

// Das Renderfenster wird nach dem Druck zerstoert. Ohne diesen Handler wuerde
// Electron die App dann sofort beenden und der Test braeche stumm ab.
app.on('window-all-closed', () => {});
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const documentHtml = require('../src/export/document-html');
const cii = require('../src/export/cii');
const ubl = require('../src/export/ubl');
const pdfa = require('../src/export/pdfa');
const themeLib = require('../src/export/theme');
const dunning = require('../src/domain/dunning');
const { DEFAULT_TEXTS } = require('../src/domain/doctypes');
const verfahrensdoku = require('../src/export/verfahrensdoku');
const receiptscan = require('../src/import/receiptscan');
const donations = require('../src/domain/donations');
const donationReceipt = require('../src/export/donation-receipt');
const reserves = require('../src/domain/reserves');
const netassets = require('../src/export/netassets');
const spheresDomain = require('../src/domain/spheres');
const assetsDomain = require('../src/domain/assets');
const invoicesDomain = require('../src/domain/invoices');
const doctypes = require('../src/domain/doctypes');
const sepaDomain = require('../src/domain/sepa');
const sepaExport = require('../src/export/sepa');
const xmlread = require('../src/import/xmlread');
const membersDomain = require('../src/domain/members');
const prenotification = require('../src/export/prenotification');
const { PDFDocument } = require('pdf-lib');

const company = {
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
  bic: 'BYLADEM1001',
  accountHolder: 'Beispiel Consulting',
  social: { instagram: 'beispielconsulting', linkedin: 'vorname-nachname' },
  qr: { mode: 'giro', size: 24 }
};

const customer = {
  name: 'Kundenfirma GmbH',
  contactName: 'Frau Muster',
  customerNumber: 'K-001',
  street: 'Kundenallee 7',
  zip: '20095',
  city: 'Hamburg',
  country: 'DE',
  email: 'buchhaltung@kunde.de',
  vatId: 'DE987654321'
};

const invoice = {
  number: 'RE-2026-0042',
  issueDate: '2026-03-01',
  deliveryDate: '2026-02-28',
  dueDate: '2026-03-15',
  currency: 'EUR',
  buyerReference: '',
  intro: 'vielen Dank für den Auftrag. Wie besprochen stelle ich folgende Leistungen in Rechnung.',
  outro: 'Vielen Dank für die Zusammenarbeit.',
  paymentText: 'Bitte überweise {AMOUNT} bis zum {DUEDATE} unter Angabe der Rechnungsnummer {NUMBER}.',
  payments: [],
  items: [
    { name: 'Konzeption und Beratung', description: 'Workshop, Ausarbeitung und Abstimmung', quantity: 20, unit: 'HUR', unitPriceNet: 12000, vatRate: 19, discountPercent: 0 },
    { name: 'Projektpauschale', quantity: 1, unit: 'LS', unitPriceNet: 60000, vatRate: 19, discountPercent: 10 },
    { name: 'Fachliteratur, weiterberechnet', quantity: 3, unit: 'C62', unitPriceNet: 2500, vatRate: 7, discountPercent: 0 }
  ]
};

async function renderPdf(html) {
  const tmpFile = path.join(os.tmpdir(), `kontor-smoke-${Date.now()}.html`);
  await fs.writeFile(tmpFile, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, contextIsolation: true, nodeIntegration: false }
  });
  try {
    await win.loadFile(tmpFile);
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: true
    });
  } finally {
    win.destroy();
    await fs.unlink(tmpFile).catch(() => {});
  }
}

app.whenReady().then(async () => {
  const outDir = path.join(require('./paths').TOOLS, 'ausgabe');
  await fs.mkdir(outDir, { recursive: true });
  const problems = [];
  const say = (ok, text) => {
    console.log(`${ok ? '  ok  ' : ' FEHL '} ${text}`);
    if (!ok) problems.push(text);
  };

  try {
    console.log('\nRechnungsausgabe im Vollzug\n');

    const html = documentHtml.render(invoice, company, customer, { theme: themeLib.DEFAULT_THEME });
    await fs.writeFile(path.join(outDir, 'rechnung.html'), html, 'utf8');
    say(html.includes('RE-2026-0042'), 'HTML enthält die Rechnungsnummer');
    say(html.includes('540,00'), 'Rabatt von 10 Prozent ist eingerechnet: 600,00 wird zu 540,00');
    say(html.includes('@beispielconsulting') && html.includes('/in/vorname-nachname'), 'Social-Media-Kanäle stehen in der Fußzeile');
    say(/<img class="qr"/.test(html), 'Der GiroCode steckt im Dokumentkopf');

    const plain = await renderPdf(html);
    await fs.writeFile(path.join(outDir, 'rechnung-ohne-xml.pdf'), Buffer.from(plain));
    say(plain.length > 5000, `PDF erzeugt, ${(plain.length / 1024).toFixed(1)} KiB`);
    say(Buffer.from(plain.slice(0, 5)).toString('latin1').startsWith('%PDF-'), 'Datei beginnt mit der PDF-Kennung');

    const xml = cii.build(invoice, company, customer);
    await fs.writeFile(path.join(outDir, 'rechnung-cii.xml'), xml, 'utf8');

    const zugferd = await pdfa.embedInvoiceXml(plain, xml, {
      title: `Rechnung ${invoice.number}`,
      author: company.name,
      subject: `Rechnung ${invoice.number} an ${customer.name}`
    });
    const zugferdFile = path.join(outDir, 'rechnung-zugferd.pdf');
    await fs.writeFile(zugferdFile, Buffer.from(zugferd));
    say(zugferd.length > plain.length, `ZUGFeRD-PDF ist größer als das nackte PDF, ${(zugferd.length / 1024).toFixed(1)} KiB`);

    const text = Buffer.from(zugferd).toString('latin1');
    say(text.includes('factur-x.xml'), 'Anhang heißt factur-x.xml');
    say(text.includes('/AFRelationship') && text.includes('/Alternative'), 'Anhang ist als gleichwertige Darstellung markiert');
    say(text.includes('<pdfaid:part>3</pdfaid:part>'), 'XMP weist PDF/A Teil 3 aus');
    say(text.includes('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>'), 'XMP nennt das Rechnungsprofil');
    say(text.includes('GTS_PDFA1'), 'OutputIntent mit Farbprofil ist gesetzt');

    const reopened = await PDFDocument.load(zugferd);
    say(reopened.getPageCount() >= 1, `PDF lässt sich wieder öffnen, ${reopened.getPageCount()} Seite(n)`);
    say(reopened.getTitle() === `Rechnung ${invoice.number}`, 'Titel steht in den Dokumenteigenschaften');

    // Angebot und Kostenvoranschlag mit einer abweichenden Gestaltung.
    const quote = {
      ...invoice,
      number: 'AN-2026-0007',
      documentType: 'quote',
      validUntil: '2026-03-31',
      deliveryDate: null,
      dueDate: null,
      showSignature: true,
      salutation: 'Sehr geehrte Damen und Herren,',
      intro: 'vielen Dank für Ihre Anfrage. Gern unterbreite ich Ihnen folgendes Angebot.',
      bodyText: 'Dieses Angebot ist bis zum {VALIDUNTIL} gültig. Mit Ihrer Zusage kommt der Auftrag zustande.',
      outro: 'Bei Fragen melden Sie sich einfach.'
    };
    const quoteTheme = themeLib.applyPreset(themeLib.DEFAULT_THEME, 'kontrast');
    const quoteHtml = documentHtml.render(quote, company, customer, { theme: quoteTheme });
    await fs.writeFile(path.join(outDir, 'angebot.html'), quoteHtml, 'utf8');
    const quotePdf = await renderPdf(quoteHtml);
    await fs.writeFile(path.join(outDir, 'angebot.pdf'), Buffer.from(quotePdf));
    say(quotePdf.length > 5000, `Angebots-PDF erzeugt, ${(quotePdf.length / 1024).toFixed(1)} KiB`);
    say(quoteHtml.includes('Gültig bis') && quoteHtml.includes('31.03.2026'), 'Angebot zeigt die Bindefrist');
    say(quoteHtml.includes('Unterschrift Auftraggeber'), 'Angebot hat ein Feld für die Zusage');
    say(!quoteHtml.includes('Fällig am'), 'Angebot nennt keine Fälligkeit');

    const estimate = { ...quote, number: 'KV-2026-0003', documentType: 'estimate', tolerancePercent: 20,
      bodyText: 'Abweichung bis zu {TOLERANCE} Prozent möglich.' };
    const estimateHtml = documentHtml.render(estimate, company, customer, {
      theme: themeLib.applyPreset(themeLib.DEFAULT_THEME, 'werkstatt')
    });
    await fs.writeFile(path.join(outDir, 'kostenvoranschlag.html'), estimateHtml, 'utf8');
    const estimatePdf = await renderPdf(estimateHtml);
    await fs.writeFile(path.join(outDir, 'kostenvoranschlag.pdf'), Buffer.from(estimatePdf));
    say(estimateHtml.includes('Abweichung bis zu 20 Prozent'), 'Kostenvoranschlag nennt die Toleranz');
    say(estimateHtml.includes('Geschätzte Gesamtkosten'), 'Kostenvoranschlag beschriftet die Summe passend');
    say(estimatePdf.length > 5000, 'Kostenvoranschlag-PDF erzeugt');

    // Mahnung: dieselbe Kette, anderes Schreiben. Der Stichtag steht fest,
    // sonst wandern Zinsen und Tage mit jedem Aufruf.
    const mahnTag = '2026-05-01';
    const prepared = dunning.prepare(
      invoice,
      customer,
      { dunning: { baseRate: 1.27 } },
      mahnTag,
      { level: 2 }
    );
    const reminderHtml = documentHtml.renderReminder(
      {
        ...prepared,
        salutation: 'Sehr geehrte Damen und Herren,',
        intro: DEFAULT_TEXTS.reminder.intro,
        outro: DEFAULT_TEXTS.reminder.outro
      },
      invoice,
      company,
      customer,
      { theme: themeLib.DEFAULT_THEME }
    );
    await fs.writeFile(path.join(outDir, 'mahnung.html'), reminderHtml, 'utf8');
    const reminderPdf = await renderPdf(reminderHtml);
    await fs.writeFile(path.join(outDir, 'mahnung.pdf'), Buffer.from(reminderPdf));
    say(reminderHtml.includes('Erste Mahnung'), 'Mahnung nennt ihre Stufe');
    say(reminderHtml.includes('Verzugszinsen, 10,27 Prozent für 16 Tage ab 15.04.2026'),
      'Mahnung rechnet die Zinsen ab dem einunddreißigsten Tag nach Fälligkeit');
    say(reminderHtml.includes('Pauschale nach §288 Abs. 5 BGB'),
      'Mahnung fordert die Pauschale, weil der Kunde eine USt-IdNr. hat');
    say(reminderHtml.indexOf('kein Zahlungseingang') < reminderHtml.indexOf('<table class="items">'),
      'Der Mahntext steht vor der Aufstellung, nicht dahinter');
    say(reminderPdf.length > 5000, `Mahnungs-PDF erzeugt, ${(reminderPdf.length / 1024).toFixed(1)} KiB`);

    // Verfahrensdokumentation: mehrseitiges Dokument mit eigenem Stylesheet.
    const dokuHtml = verfahrensdoku.build({
      settings: {
        company,
        tax: { scheme: 'regel', vatMethod: 'ist', vatPeriod: 'quarterly', inputVatBasis: 'invoice' },
        invoice: { numberPatterns: { invoice: 'RE-{JJJJ}-{NNNN}' }, counters: { invoice: { 2026: 42 } } },
        segments: []
      },
      entries: [], invoices: [], customers: [], receipts: [], assets: [], recurrences: [], imports: []
    }, { dataDir: 'C:\\Daten\\NestEgg', version: '1.0.0', schemaVersion: 6, today: '2026-09-17' });

    await fs.writeFile(path.join(outDir, 'verfahrensdokumentation.html'), dokuHtml, 'utf8');
    const dokuPdf = await renderPdf(dokuHtml);
    await fs.writeFile(path.join(outDir, 'verfahrensdokumentation.pdf'), Buffer.from(dokuPdf));

    const dokuDoc = await PDFDocument.load(dokuPdf);
    say(dokuDoc.getPageCount() >= 3, `Verfahrensdokumentation erzeugt, ${dokuDoc.getPageCount()} Seiten`);
    say(dokuHtml.includes('§147 AO'), 'Verfahrensdokumentation nennt die Aufbewahrungsfristen');
    say(dokuHtml.includes('class="gap"'), 'Sie lässt offen, was die Software nicht wissen kann');

    // Der eigene Beleg-Leser an einem echten, von Chromium erzeugten PDF.
    const scanned = receiptscan.scan(Buffer.from(plain), 'rechnung.pdf');
    say(scanned.ok, 'Das erzeugte PDF lässt sich wieder auslesen');
    say(scanned.fields.number === 'RE-2026-0042', `Rechnungsnummer gelesen: ${scanned.fields.number}`);
    say(scanned.fields.amount === 357885, `Rechnungsbetrag gelesen: ${(scanned.fields.amount / 100).toFixed(2)}`);
    say(scanned.fields.date === '2026-03-01', `Rechnungsdatum gelesen: ${scanned.fields.date}`);

    // Zuwendungsbestätigung nach amtlichem Muster.
    const clubSettings = {
      company: {
        name: 'Turnverein Musterstadt e. V.', street: 'Sportplatzweg 1',
        zip: '86150', city: 'Augsburg', taxNumber: '103/456/78901'
      },
      entity: {
        kind: 'club', charitable: true, purpose: 'des Sports',
        noticeType: 'freistellung', noticeDate: '2025-04-10', noticeOffice: 'Augsburg-Stadt',
        noticeYear: '2024', boardName: 'Vorname Nachname', boardRole: 'Erster Vorstand'
      }
    };
    const spende = {
      id: 'z1', type: 'income', paidDate: '2026-02-03', gross: 50000,
      categoryId: 'cl_inc_donation', description: 'Spende', note: ''
    };
    const zuwendung = donations.prepare([spende], clubSettings, {
      name: 'Erika Musterfrau', street: 'Beispielweg 3', zip: '86150', city: 'Augsburg'
    }, { year: 2026, today: '2026-09-17' });

    const zuwendungHtml = donationReceipt.build(zuwendung);
    await fs.writeFile(path.join(outDir, 'zuwendungsbestaetigung.html'), zuwendungHtml, 'utf8');
    const zuwendungPdf = await renderPdf(zuwendungHtml);
    await fs.writeFile(path.join(outDir, 'zuwendungsbestaetigung.pdf'), Buffer.from(zuwendungPdf));

    say(zuwendungPdf.length > 5000, `Zuwendungsbestätigung erzeugt, ${(zuwendungPdf.length / 1024).toFixed(1)} KiB`);
    say(zuwendung.totalInWords === 'fünfhundert Euro', `Betrag in Buchstaben: ${zuwendung.totalInWords}`);
    say(zuwendungHtml.includes('§ 10b'), 'Die Bestätigung nennt die Rechtsgrundlage');
    say(!zuwendung.warnings.some((w) => /fehlt|fehlen/.test(w)), 'Keine Pflichtangabe fehlt');

    // Vermögensübersicht eines Vereins.
    const clubEntries = [
      { type: 'income', paidDate: '2026-02-01', gross: 800000, net: 800000, vat: 0, categoryId: 'cl_inc_dues', sphereId: 'ideell', description: 'Beiträge' },
      { type: 'income', paidDate: '2026-05-01', gross: 90000, net: 90000, vat: 0, categoryId: 'cl_inc_rent', sphereId: 'vermoegen', description: 'Miete' },
      { type: 'expense', paidDate: '2026-06-01', gross: 300000, net: 300000, vat: 0, categoryId: 'cl_exp_purpose', sphereId: 'ideell', description: 'Sportbetrieb' }
    ];
    const clubReserves = [reserves.normalizeReserve({
      id: 'rl_1', type: 'project', label: 'Sanierung Hallendach', purpose: 'Dachabdichtung',
      deadline: '2028-12-31', movements: [{ year: 2026, date: '2026-12-31', kind: 'add', amount: 200000 }]
    })];
    const clubData = {
      settings: {
        company: { name: 'Turnverein Musterstadt e. V.', city: 'Augsburg', street: 'Sportplatzweg 1', zip: '86150' },
        entity: { kind: 'club', charitable: true, purpose: 'des Sports' },
        reserve: { accountBalance: 1500000, accountBalanceDate: '2025-12-31' }
      },
      entries: clubEntries,
      invoices: [],
      assets: [],
      reserves: clubReserves
    };

    const vermoegenHtml = netassets.build({
      assets: reserves.netAssets(clubData, { assetsDomain, invoicesDomain, typeOf: doctypes.typeOf }, '2026-12-31'),
      useOfFunds: reserves.useOfFunds(clubEntries, clubReserves, 2026),
      reserves: reserves.overview(clubReserves, clubEntries, 2026, '2026-12-31'),
      spheres: spheresDomain.calculate(clubEntries, 2026),
      company: clubData.settings.company,
      entity: clubData.settings.entity,
      date: '2026-12-31'
    });

    await fs.writeFile(path.join(outDir, 'vermoegensuebersicht.html'), vermoegenHtml, 'utf8');
    const vermoegenPdf = await renderPdf(vermoegenHtml);
    await fs.writeFile(path.join(outDir, 'vermoegensuebersicht.pdf'), Buffer.from(vermoegenPdf));

    say(vermoegenPdf.length > 5000, `Vermögensübersicht erzeugt, ${(vermoegenPdf.length / 1024).toFixed(1)} KiB`);
    say(vermoegenHtml.includes('§ 62 Abs. 1 Nr. 3 AO'), 'Sie nennt die Rechtsgrundlage der freien Rücklage');
    say(vermoegenHtml.includes('Vereinsvermögen'), 'Aktiva und Passiva stehen darin');

    const netto = reserves.netAssets(clubData, { assetsDomain, invoicesDomain, typeOf: doctypes.typeOf }, '2026-12-31');
    say(netto.assets.total === netto.liabilities.total + netto.equity, 'Aktiva und Passiva gehen auf');

    const xrechnung = ubl.build(invoice, company, customer);
    await fs.writeFile(path.join(outDir, 'rechnung-xrechnung.xml'), xrechnung, 'utf8');
    say(xrechnung.includes('xrechnung_3.0'), 'XRechnung trägt die CustomizationID');
    say(xrechnung.includes('<cbc:PayableAmount currencyID="EUR">3578.85</cbc:PayableAmount>'),
      'XRechnung-Endbetrag stimmt mit der Positionsrechnung überein');

    /* ---------------------------------------------------- SEPA-Lastschrift */

    // Erzeugen und mit dem eigenen XML-Leser wieder einlesen. Das prüft, was
    // eine Zeichenkettenprüfung nicht kann: dass die Datei wohlgeformt ist und
    // die Werte wirklich dort ankommen, wo die Bank sie sucht.
    const sepaSettings = {
      creditorId: 'DE98ZZZ09999999999', creditorName: '', scheme: 'CORE',
      sequenceType: 'RCUR', painVersion: 'pain.008.001.08',
      preNotificationDays: 14, batchBooking: true
    };
    const sepaCreditor = {
      name: 'Turnverein Musterstadt e. V.',
      iban: 'DE89370400440532013000',
      bic: ''
    };
    const einzug = sepaDomain.collect([
      {
        member: { id: 'mg_1', name: 'Erika Musterfrau', iban: 'DE02120300000000202051', mandateRef: 'TVM-0001', mandateDate: '2024-03-01' },
        amount: 12000, reference: 'Jahresbeitrag 2026, Mitglied 0001', endToEndId: 'mg_1|2026', dueDate: '2026-10-01'
      },
      {
        member: { id: 'mg_2', name: 'Max Müller', iban: 'DE02500105170137075030', mandateRef: 'TVM-0002', mandateDate: '2024-09-01' },
        amount: 18000, reference: 'Jahresbeitrag 2026, Mitglied 0002', endToEndId: 'mg_2|2026', dueDate: '2026-10-01'
      }
    ], { today: '2026-09-17' });

    const lastschrift = sepaExport.build({
      creditor: sepaCreditor, rows: einzug.ready, dueDate: '2026-10-01',
      settings: sepaSettings, now: new Date('2026-09-17T09:30:00Z')
    });
    await fs.writeFile(path.join(outDir, lastschrift.fileName), lastschrift.xml, 'utf8');

    const gelesen = xmlread.parse(lastschrift.xml);
    const sammler = xmlread.find(gelesen, 'CstmrDrctDbtInitn/PmtInf');
    const posten = xmlread.findAll(sammler, 'DrctDbtTxInf');

    say(Boolean(sammler), `SEPA-Lastschriftdatei erzeugt und wieder eingelesen, ${(lastschrift.xml.length / 1024).toFixed(1)} KiB`);
    say(posten.length === 2, `Sie enthält ${posten.length} Lastschriften`);
    say(xmlread.text(sammler, 'ReqdColltnDt') === '2026-10-01', 'Der Fälligkeitstag steht auf der Sammlerebene');
    say(xmlread.text(gelesen, 'CstmrDrctDbtInitn/GrpHdr/CtrlSum') === '300.00', 'Die Kontrollsumme steht auf 300,00');
    say(xmlread.text(sammler, 'PmtTpInf/SeqTp') === 'RCUR', 'Der Sequenztyp ist RCUR');
    say(xmlread.text(sammler, 'PmtTpInf/LclInstrm/Cd') === 'CORE', 'Es ist eine Basislastschrift');
    say(xmlread.text(sammler, 'CdtrSchmeId/Id/PrvtId/Othr/Id') === 'DE98ZZZ09999999999', 'Die Gläubiger-ID steht an der richtigen Stelle');
    say(xmlread.text(sammler, 'CdtrAcct/Id/IBAN') === 'DE89370400440532013000', 'Das Vereinskonto ist das Ziel');

    const summe = posten.reduce((total, posten2) =>
      total + xmlread.amount(posten2, 'InstdAmt'), 0);
    say(summe === lastschrift.total, `Die Einzelbeträge ergeben die Kontrollsumme: ${(summe / 100).toFixed(2)}`);

    const zweiterName = xmlread.text(posten[1], 'Dbtr/Nm');
    say(zweiterName === 'Max Mueller', `Der Umlaut ist umgesetzt: ${zweiterName}`);

    /* ------------------------------------------- Vorabankündigung */

    const beitragsSettings = {
      tiers: [{ id: 'bk_1', label: 'Erwachsene', amount: 12000, interval: 'quarterly' }],
      categoryId: 'cl_inc_dues', dueMonth: 1, dueDay: 15, honoraryFree: true
    };
    const ankuendigungsMitglieder = [
      membersDomain.normalizeMember({
        id: 'mg_1', number: '0001', firstName: 'Erika', lastName: 'Musterfrau',
        tierId: 'bk_1', joinedAt: '2020-03-01', street: 'Beispielweg 3', zip: '86150', city: 'Augsburg',
        payment: 'debit', iban: 'DE02120300000000202051', mandateRef: 'TVM-0001', mandateDate: '2020-03-01'
      }),
      membersDomain.normalizeMember({
        id: 'mg_2', number: '0002', firstName: 'Max', lastName: 'Müller',
        tierId: 'bk_1', joinedAt: '2018-09-01', street: 'Musterstraße 17', zip: '86157', city: 'Augsburg',
        payment: 'debit', iban: 'DE02500105170137075030', mandateRef: 'TVM-0002', mandateDate: '2018-09-01'
      })
    ];

    const ankuendigungsPlan = membersDomain.preNotificationPlan(
      ankuendigungsMitglieder, beitragsSettings, 2026, { noticeDays: 14, today: '2026-09-18' }
    );
    const briefe = prenotification.build({
      items: ankuendigungsPlan.ready,
      company: { name: 'Turnverein Musterstadt e. V.', street: 'Sportplatzweg 1', zip: '86150', city: 'Augsburg' },
      sepa: sepaSettings,
      entity: { boardName: 'Vorname Nachname' },
      year: 2026,
      date: '2026-09-18'
    });

    await fs.writeFile(path.join(outDir, 'vorabankuendigung.html'), briefe, 'utf8');
    const briefePdf = await renderPdf(briefe);
    await fs.writeFile(path.join(outDir, 'vorabankuendigung.pdf'), Buffer.from(briefePdf));

    say(briefePdf.length > 5000, `Vorabankündigung erzeugt, ${(briefePdf.length / 1024).toFixed(1)} KiB`);

    const briefeDoc = await PDFDocument.load(briefePdf);
    say(briefeDoc.getPageCount() === 2, `Ein Blatt je Mitglied: ${briefeDoc.getPageCount()} Seiten`);
    say(briefe.includes('DE98 ZZZ0 9999 9999 99'), 'Die Gläubiger-ID steht im Brief');
    say(briefe.includes('TVM-0001') && briefe.includes('TVM-0002'), 'Jeder Brief nennt seine Mandatsreferenz');
    say(briefe.includes('15.01.2026') && briefe.includes('15.10.2026'), 'Alle vier Quartalstermine stehen darin');
    say(!briefe.includes('DE02120300000000202051'), 'Die Kontonummer steht nur verkürzt im Brief');

    // Der Grenzfall: ein monatlicher Beitrag hat zwölf Termine. Passt die
    // Tabelle dann noch auf das Blatt, passt jeder andere Fall auch.
    const monatlich = membersDomain.preNotificationPlan(
      [ankuendigungsMitglieder[0]],
      { ...beitragsSettings, tiers: [{ id: 'bk_1', label: 'Monatlich', amount: 1000, interval: 'monthly' }] },
      2026, { noticeDays: 14, today: '2026-09-18' }
    );
    const monatsBrief = prenotification.build({
      items: monatlich.ready,
      company: { name: 'Turnverein Musterstadt e. V.', street: 'Sportplatzweg 1', zip: '86150', city: 'Augsburg' },
      sepa: sepaSettings, entity: {}, year: 2026, date: '2026-09-18'
    });
    await fs.writeFile(path.join(outDir, 'vorabankuendigung-monatlich.html'), monatsBrief, 'utf8');
    const monatsPdf = await renderPdf(monatsBrief);
    await fs.writeFile(path.join(outDir, 'vorabankuendigung-monatlich.pdf'), Buffer.from(monatsPdf));

    const monatsDoc = await PDFDocument.load(monatsPdf);
    say(monatsDoc.getPageCount() === 1, `Auch zwölf Monatstermine passen auf ein Blatt: ${monatsDoc.getPageCount()} Seite(n)`);
    say(monatlich.ready[0].periods.length === 12, 'Der Brief nennt alle zwölf Termine');
    say(xmlread.text(posten[0], 'DrctDbtTx/MndtRltdInf/MndtId') === 'TVM-0001', 'Die Mandatsreferenz steht an der Lastschrift');
    say(xmlread.text(posten[0], 'PmtId/EndToEndId') === 'mg-1-2026', 'Die Referenz kommt ohne unerlaubte Zeichen aus');
    say(xmlread.text(posten[0], 'DbtrAcct/Id/IBAN') === 'DE02120300000000202051', 'Die IBAN des Mitglieds steht darin');

    console.log(`\nDateien liegen in ${outDir}`);
    console.log(problems.length ? `\n${problems.length} Punkt(e) offen.\n` : '\nAlles in Ordnung.\n');
  } catch (err) {
    console.error('\nAbbruch:', err);
    problems.push(String(err));
  }

  app.exit(problems.length ? 1 : 0);
});
