'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { Store, defaultSettings, SCHEMA_VERSION } = require('../../src/storage/store');
const receipts = require('../../src/storage/receipts');
const { PDFDocument } = require('pdf-lib');
const pdfa = require('../../src/export/pdfa');
const cii = require('../../src/export/cii');

async function tempStore() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kontor-test-'));
  const store = new Store(dir);
  await store.init();
  return store;
}

/* ------------------------------------------------------------------ Store */

test('Neuer Datenordner bekommt Grundgerüst und Unterordner', async () => {
  const store = await tempStore();
  assert.ok(fs.existsSync(path.join(store.dataDir, 'buchhaltung.json')));
  assert.ok(fs.existsSync(store.receiptDir));
  assert.ok(fs.existsSync(store.exportDir));
  assert.deepEqual(store.list('entries'), []);
  assert.equal(store.snapshot().settings.tax.vatMethod, 'ist');
});

test('Anlegen, Ändern und Löschen landet auf der Platte', async () => {
  const store = await tempStore();
  const created = await store.create('entries', { description: 'Test', gross: 1000 }, 'buch');
  assert.ok(created.id.startsWith('buch_'));

  await store.update('entries', created.id, { description: 'Geändert' });
  assert.equal(store.get('entries', created.id).description, 'Geändert');

  const onDisk = JSON.parse(await fsp.readFile(path.join(store.dataDir, 'buchhaltung.json'), 'utf8'));
  assert.equal(onDisk.entries[0].description, 'Geändert');

  await store.remove('entries', created.id);
  assert.equal(store.list('entries').length, 0);
});

test('Jede Änderung steht im Protokoll', async () => {
  const store = await tempStore();
  const created = await store.create('entries', { description: 'Protokolltest', gross: 500 }, 'buch');
  await store.update('entries', created.id, { gross: 700 });
  await store.remove('entries', created.id);

  const journal = await fsp.readFile(path.join(store.dataDir, 'journal.jsonl'), 'utf8');
  const lines = journal.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.action), ['create', 'update', 'delete']);
  assert.equal(lines[1].before.gross, 500);
  assert.equal(lines[1].after.gross, 700);
});

test('Rechnungsnummern laufen lückenlos und je Jahr getrennt', async () => {
  const store = await tempStore();
  const a = await store.reserveInvoiceNumber('2026-03-01');
  const b = await store.reserveInvoiceNumber('2026-11-20');
  const c = await store.reserveInvoiceNumber('2027-01-02');

  assert.equal(a.counter, 1);
  assert.equal(b.counter, 2);
  assert.equal(c.counter, 1, 'im neuen Jahr beginnt der Zähler von vorn');
});

test('Parallele Schreibvorgänge überholen sich nicht', async () => {
  const store = await tempStore();
  await Promise.all(
    Array.from({ length: 25 }, (_, i) => store.create('entries', { description: `Nr ${i}`, gross: i }, 'buch'))
  );
  assert.equal(store.list('entries').length, 25);

  const onDisk = JSON.parse(await fsp.readFile(path.join(store.dataDir, 'buchhaltung.json'), 'utf8'));
  assert.equal(onDisk.entries.length, 25, 'die Datei hat alle Einträge, nicht nur den letzten Stand');
});

test('Einstellungen werden verschmolzen, nicht ersetzt', async () => {
  const store = await tempStore();
  await store.updateSettings({ company: { name: 'Meine Firma' } });
  const settings = store.snapshot().settings;

  assert.equal(settings.company.name, 'Meine Firma');
  assert.equal(settings.company.country, 'DE', 'unberührte Felder bleiben erhalten');
  assert.equal(settings.tax.vatMethod, 'ist', 'andere Bereiche bleiben unberührt');
});

test('Eine unlesbare Datendatei wird beiseitegelegt statt überschrieben', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kontor-kaputt-'));
  await fsp.writeFile(path.join(dir, 'buchhaltung.json'), '{ das ist kein JSON', 'utf8');

  const store = new Store(dir);
  await assert.rejects(() => store.init(), /unlesbar/);

  const files = await fsp.readdir(dir);
  assert.ok(files.some((f) => f.includes('.defekt-')), 'die kaputte Datei bleibt erhalten');
});

test('Ältere Datenstände werden auf das aktuelle Schema gehoben', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kontor-alt-'));
  await fsp.writeFile(
    path.join(dir, 'buchhaltung.json'),
    JSON.stringify({ entries: [{ id: 'x', description: 'alt' }], settings: { company: { name: 'Alt' } } }),
    'utf8'
  );

  const store = new Store(dir);
  await store.init();
  const data = store.snapshot();

  assert.equal(data.entries.length, 1);
  assert.equal(data.settings.company.name, 'Alt');
  assert.ok(Array.isArray(data.invoices), 'fehlende Sammlungen werden ergänzt');
  assert.ok(data.settings.theme, 'neue Bereiche kommen hinzu');
});

test('Ein Schemawechsel wird geschrieben und der Vorzustand gesichert', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kontor-schema-'));
  await fsp.writeFile(
    path.join(dir, 'buchhaltung.json'),
    JSON.stringify({
      schemaVersion: 1,
      settings: { invoice: { numberPattern: 'R-{YYYY}-{###}', counters: { 2026: 5 }, paymentText: 'Zahl bis {DUEDATE}' } },
      invoices: [{ id: 're_1', number: 'R-2026-005' }],
      entries: []
    }),
    'utf8'
  );

  const store = new Store(dir);
  await store.init();

  const onDisk = JSON.parse(await fsp.readFile(path.join(dir, 'buchhaltung.json'), 'utf8'));
  assert.equal(onDisk.schemaVersion, SCHEMA_VERSION, 'die Datei liegt danach in der neuen Form vor');
  assert.equal(onDisk.settings.invoice.numberPatterns.invoice, 'R-{YYYY}-{###}', 'das alte Muster wandert mit');
  assert.deepEqual(onDisk.settings.invoice.counters.invoice, { 2026: 5 }, 'der Zähler bleibt erhalten');
  assert.equal(onDisk.settings.texts.invoice.body, 'Zahl bis {DUEDATE}', 'der alte Zahlungstext wandert mit');
  assert.equal(onDisk.invoices[0].documentType, 'invoice', 'Dokumente ohne Art gelten als Rechnung');

  const backups = await fsp.readdir(path.join(dir, 'backups'));
  assert.ok(backups.some((f) => f.startsWith('vor-schema-1-')), 'der alte Stand liegt als Sicherung daneben');
});

test('Vorhandene Buchungen bekommen die neuen Dimensionen', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kontor-dim-'));
  await fsp.writeFile(
    path.join(dir, 'buchhaltung.json'),
    JSON.stringify({
      schemaVersion: 2,
      settings: {},
      entries: [
        { id: 'buch_1', type: 'income', categoryId: 'inc_services', date: '2026-01-01', gross: 11900 },
        { id: 'buch_2', type: 'income', categoryId: 'inc_license', date: '2026-02-01', gross: 5950 }
      ],
      invoices: [{ id: 're_1', documentType: 'invoice', number: 'RE-1' }]
    }),
    'utf8'
  );

  const store = new Store(dir);
  await store.init();
  const data = store.snapshot();

  assert.ok(data.settings.segments.length > 0, 'Bereiche werden angelegt');
  assert.ok(data.settings.reserve, 'die Annahmen für die Rücklage kommen dazu');
  assert.ok(Array.isArray(data.projects), 'die Projektsammlung kommt dazu');

  const first = data.settings.segments[0].id;
  assert.equal(data.entries[0].segmentId, first, 'jede Buchung bekommt einen Bereich');
  assert.equal(data.entries[0].countryCode, 'DE');
  assert.equal(data.entries[0].revenueKind, 'onetime');
  assert.equal(data.entries[1].revenueKind, 'recurring', 'Lizenzerlöse gelten als wiederkehrend');
  assert.equal(data.invoices[0].segmentId, first);
});

/* ------------------------------------------------------------------ Belege */

test('Beleg wird kopiert, umbenannt und mit Prüfsumme abgelegt', async () => {
  const store = await tempStore();
  const source = path.join(store.dataDir, 'quelle.pdf');
  await fsp.writeFile(source, 'PDF-Inhalt zum Testen', 'utf8');

  const stored = await receipts.store(store.receiptDir, source, {
    date: '2026-04-15',
    counterparty: 'Büro Müller GmbH'
  });

  assert.ok(stored.fileName.startsWith('2026-04-15_Buero-Mueller-GmbH'));
  assert.ok(stored.relativePath.startsWith('2026/'));
  assert.equal(stored.checksum.length, 64);
  assert.ok(fs.existsSync(receipts.resolve(store.receiptDir, stored)));
  assert.ok(fs.existsSync(source), 'das Original bleibt liegen');

  assert.deepEqual(await receipts.verify(store.receiptDir, stored), { ok: true });
});

test('Eine nachträglich veränderte Belegdatei fällt auf', async () => {
  const store = await tempStore();
  const source = path.join(store.dataDir, 'quelle.pdf');
  await fsp.writeFile(source, 'Original', 'utf8');
  const stored = await receipts.store(store.receiptDir, source, { date: '2026-01-02', counterparty: 'Test' });

  await fsp.writeFile(receipts.resolve(store.receiptDir, stored), 'Manipuliert', 'utf8');
  const check = await receipts.verify(store.receiptDir, stored);
  assert.equal(check.ok, false);
  assert.match(check.reason, /verändert/);
});

test('Gleichnamige Belege überschreiben einander nicht', async () => {
  const store = await tempStore();
  const source = path.join(store.dataDir, 'quelle.pdf');
  await fsp.writeFile(source, 'A', 'utf8');

  const first = await receipts.store(store.receiptDir, source, { date: '2026-01-02', counterparty: 'Gleich' });
  const second = await receipts.store(store.receiptDir, source, { date: '2026-01-02', counterparty: 'Gleich' });
  assert.notEqual(first.fileName, second.fileName);
});

test('Fremde Dateitypen werden als Beleg abgelehnt', async () => {
  const store = await tempStore();
  const source = path.join(store.dataDir, 'programm.exe');
  await fsp.writeFile(source, 'egal', 'utf8');
  await assert.rejects(() => receipts.store(store.receiptDir, source, {}), /nicht als Beleg/);
});

/* ------------------------------------------------------------------ ZUGFeRD-PDF */

async function minimalPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText('Rechnung');
  return doc.save();
}

test('Das CII-XML landet als factur-x.xml im PDF', async () => {
  const xml = cii.build(
    {
      number: 'RE-2026-0001', issueDate: '2026-03-01', deliveryDate: '2026-03-01', currency: 'EUR', payments: [],
      items: [{ name: 'Leistung', quantity: 1, unitPriceNet: 10000, vatRate: 19 }]
    },
    { name: 'Firma', street: 'Weg 1', zip: '10115', city: 'Berlin', taxNumber: '12/345/67890' },
    { name: 'Kunde', street: 'Platz 2', zip: '20095', city: 'Hamburg' }
  );

  const result = await pdfa.embedInvoiceXml(await minimalPdf(), xml, { title: 'Rechnung RE-2026-0001', author: 'Firma' });
  const text = Buffer.from(result).toString('latin1');

  assert.ok(text.includes('factur-x.xml'), 'der Anhang trägt den vorgeschriebenen Namen');
  assert.ok(text.includes('/AFRelationship'), 'die Beziehung des Anhangs ist gesetzt');
  assert.ok(text.includes('/Alternative'), 'das XML gilt als gleichwertige Darstellung');
  assert.ok(text.includes('/EmbeddedFiles'), 'der Anhang hängt im Namensbaum');

  // Das PDF bleibt lesbar und der Anhang ist wieder auffindbar.
  const reloaded = await PDFDocument.load(result);
  assert.equal(reloaded.getPageCount(), 1);
  assert.equal(reloaded.getTitle(), 'Rechnung RE-2026-0001');
});

test('Die PDF/A- und ZUGFeRD-Metadaten stehen im Dokument', async () => {
  const result = await pdfa.embedInvoiceXml(await minimalPdf(), '<xml/>', { title: 'Test', author: 'Firma' });
  const text = Buffer.from(result).toString('latin1');

  assert.ok(text.includes('<pdfaid:part>3</pdfaid:part>'));
  assert.ok(text.includes('<pdfaid:conformance>B</pdfaid:conformance>'));
  assert.ok(text.includes('<fx:DocumentType>INVOICE</fx:DocumentType>'));
  assert.ok(text.includes('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>'));
  assert.ok(text.includes('urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#'));
  assert.ok(text.includes('pdfaExtension:schemas'), 'das eigene Namensschema ist deklariert');
  assert.ok(text.includes('/OutputIntent'), 'PDF/A verlangt einen OutputIntent');
  assert.ok(text.includes('GTS_PDFA1'));
  assert.ok(text.includes('/Metadata'));
});

test('Das XMP-Gerüst maskiert Sonderzeichen aus den Firmendaten', () => {
  const xmp = pdfa.buildXmp({
    title: 'Rechnung <RE-1>',
    author: 'Meier & Söhne',
    subject: 'Test',
    createdAt: new Date('2026-03-01T10:00:00Z'),
    conformanceLevel: 'EN 16931',
    attachmentName: 'factur-x.xml'
  });

  assert.ok(xmp.includes('Rechnung &lt;RE-1&gt;'));
  assert.ok(xmp.includes('Meier &amp; Söhne'));
  assert.ok(xmp.includes('2026-03-01T10:00:00Z'));
});
