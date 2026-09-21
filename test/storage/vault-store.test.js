'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { Store } = require('../../src/storage/store');
const receipts = require('../../src/storage/receipts');
const vault = require('../../src/security/vault');

/**
 * Der verschlüsselte Bestand.
 *
 * Geprüft wird hier nicht die Kryptografie selbst, die steht in vault.test.js,
 * sondern was der Ordner danach enthält: dass wirklich nichts Lesbares
 * übrigbleibt, und dass der Weg hin und zurück nichts verliert.
 */

const abfall = [];

async function tempDir() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nestegg-krypt-'));
  abfall.push(dir);
  return dir;
}

test.after(async () => {
  for (const dir of abfall) await fsp.rm(dir, { recursive: true, force: true });
});

function key() {
  return crypto.randomBytes(32);
}

/** Legt einen Bestand mit etwas Inhalt an. */
async function mitInhalt(dir, k) {
  const store = new Store(dir, k);
  await store.init();
  await store.updateSettings({ company: { name: 'Geheime Firma GmbH', iban: 'DE02120300000000202051' } });
  await store.create('customers', { name: 'Renée Bergström', city: 'Köln' }, 'kd');
  await store.create('entries', {
    type: 'income', date: '2026-03-01', description: 'Beratung Projekt Nordwind', gross: 119000
  }, 'buch');
  return store;
}

/** Alle Dateien unterhalb eines Ordners. */
function alleDateien(dir) {
  const out = [];
  for (const eintrag of fs.readdirSync(dir, { withFileTypes: true })) {
    const voll = path.join(dir, eintrag.name);
    if (eintrag.isDirectory()) out.push(...alleDateien(voll));
    else out.push(voll);
  }
  return out;
}

/* ------------------------------------------------------- Grundlagen */

test('Ohne Schlüssel bleibt alles wie bisher', async () => {
  const dir = await tempDir();
  await mitInhalt(dir, null);

  assert.equal(fs.existsSync(path.join(dir, 'buchhaltung.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'buchhaltung.nst')), false);
  // Und die Datei ist wirklich JSON.
  JSON.parse(fs.readFileSync(path.join(dir, 'buchhaltung.json'), 'utf8'));
});

test('Mit Schlüssel liegt der Bestand als .nst und ist nicht lesbar', async () => {
  const dir = await tempDir();
  await mitInhalt(dir, key());

  assert.equal(fs.existsSync(path.join(dir, 'buchhaltung.nst')), true);
  assert.equal(fs.existsSync(path.join(dir, 'buchhaltung.json')), false);

  const roh = fs.readFileSync(path.join(dir, 'buchhaltung.nst'));
  assert.equal(vault.isEncrypted(roh), true);
  assert.equal(roh.includes(Buffer.from('Geheime Firma', 'utf8')), false);
  assert.equal(roh.includes(Buffer.from('Nordwind', 'utf8')), false);
});

test('Ein verschlüsselter Bestand öffnet sich mit demselben Schlüssel wieder', async () => {
  const dir = await tempDir();
  const k = key();
  await mitInhalt(dir, k);

  const wieder = new Store(dir, k);
  await wieder.init();
  assert.equal(wieder.snapshot().settings.company.name, 'Geheime Firma GmbH');
  assert.equal(wieder.list('customers')[0].name, 'Renée Bergström');
});

test('Ohne Schlüssel bleibt der Bestand zu, statt überschrieben zu werden', async () => {
  const dir = await tempDir();
  await mitInhalt(dir, key());

  const ohne = new Store(dir, null);
  await assert.rejects(() => ohne.init(), (err) => err.locked === true);

  // Und zwar unversehrt: das Schlimmste wäre, hier neu anzufangen.
  assert.equal(fs.existsSync(path.join(dir, 'buchhaltung.nst')), true);
  assert.equal(fs.existsSync(path.join(dir, 'buchhaltung.json')), false);
});

test('Der falsche Schlüssel öffnet nichts und zerstört nichts', async () => {
  const dir = await tempDir();
  await mitInhalt(dir, key());

  const falsch = new Store(dir, key());
  await assert.rejects(() => falsch.init());
  assert.equal(fs.existsSync(path.join(dir, 'buchhaltung.nst')), true);
});

/* ------------------------------------------------ Sicherung, Journal */

test('Die tägliche Sicherung ist ebenso verschlüsselt', async () => {
  const dir = await tempDir();
  await mitInhalt(dir, key());

  const sicherungen = fs.readdirSync(path.join(dir, 'backups'));
  assert.equal(sicherungen.length, 1);
  assert.match(sicherungen[0], /\.nst$/);

  const roh = fs.readFileSync(path.join(dir, 'backups', sicherungen[0]));
  assert.equal(vault.isEncrypted(roh), true);
});

test('Das Änderungsprotokoll ist zeilenweise verschlüsselt und bleibt lesbar', async () => {
  const dir = await tempDir();
  const k = key();
  const store = await mitInhalt(dir, k);

  const roh = fs.readFileSync(path.join(dir, 'journal.nstl'), 'utf8');
  assert.equal(roh.includes('Nordwind'), false);
  assert.equal(roh.includes('{'), false);

  const eintraege = await store.readJournal();
  assert.ok(eintraege.length >= 2);
  assert.ok(eintraege.some((e) => e.collection === 'customers' && e.action === 'create'));
});

test('Eine kaputte Protokollzeile verschluckt nicht die übrigen', async () => {
  const dir = await tempDir();
  const k = key();
  const store = await mitInhalt(dir, k);

  await fsp.appendFile(path.join(dir, 'journal.nstl'), 'das ist kein umschlag\n', 'utf8');
  const eintraege = await store.readJournal();
  assert.ok(eintraege.length >= 2);
});

test('Die Sicherung auf Anforderung ist ebenfalls verschlüsselt', async () => {
  const dir = await tempDir();
  const k = key();
  const store = await mitInhalt(dir, k);

  const ziel = path.join(dir, 'export-test.nst');
  await store.backupTo(ziel);
  assert.equal(vault.isEncrypted(fs.readFileSync(ziel)), true);
});

/* ------------------------------------------------------------ Belege */

test('Ein verschlüsselter Beleg verrät weder Inhalt noch Namen', async () => {
  const dir = await tempDir();
  const k = key();
  const store = new Store(dir, k);
  await store.init();

  const quelle = path.join(dir, 'quelle.pdf');
  await fsp.writeFile(quelle, 'Rechnung Nordlicht Handels 119,00 Euro', 'utf8');

  const abgelegt = await receipts.store(store.receiptDir, quelle, {
    date: '2026-09-05', counterparty: 'Nordlicht Handels', amountLabel: '119-00'
  }, k);

  // Der Dateiname sagt nichts.
  assert.match(path.basename(abgelegt.relativePath), /^bel_[0-9a-f]{16}\.nst$/);
  assert.equal(abgelegt.encrypted, true);
  // Der sprechende Name bleibt im Datensatz, und der liegt verschlüsselt.
  assert.match(abgelegt.fileName, /Nordlicht-Handels/);

  const roh = fs.readFileSync(receipts.resolve(store.receiptDir, abgelegt));
  assert.equal(roh.includes(Buffer.from('Nordlicht', 'utf8')), false);

  const klar = await receipts.read(store.receiptDir, abgelegt, k);
  assert.equal(klar.toString('utf8'), 'Rechnung Nordlicht Handels 119,00 Euro');
});

test('Die Prüfsumme meint den Klartext, nicht die verschlüsselte Datei', async () => {
  const dir = await tempDir();
  const k = key();
  const store = new Store(dir, k);
  await store.init();

  const quelle = path.join(dir, 'quelle.pdf');
  await fsp.writeFile(quelle, 'Inhalt', 'utf8');

  const abgelegt = await receipts.store(store.receiptDir, quelle, { date: '2026-01-01' }, k);
  assert.equal(
    abgelegt.checksum,
    crypto.createHash('sha256').update('Inhalt', 'utf8').digest('hex')
  );
  assert.equal((await receipts.verify(store.receiptDir, abgelegt, k)).ok, true);
});

test('Ein veränderter verschlüsselter Beleg fällt bei der Prüfung auf', async () => {
  const dir = await tempDir();
  const k = key();
  const store = new Store(dir, k);
  await store.init();

  const quelle = path.join(dir, 'quelle.pdf');
  await fsp.writeFile(quelle, 'Original', 'utf8');
  const abgelegt = await receipts.store(store.receiptDir, quelle, { date: '2026-01-01' }, k);

  const datei = receipts.resolve(store.receiptDir, abgelegt);
  const roh = await fsp.readFile(datei);
  roh[roh.length - 1] ^= 0x01;
  await fsp.writeFile(datei, roh);

  const pruefung = await receipts.verify(store.receiptDir, abgelegt, k);
  assert.equal(pruefung.ok, false);
});

/* ------------------------------------------------------- Umstellung */

test('Die Umstellung verschlüsselt alles und lässt nichts Lesbares zurück', async () => {
  const dir = await tempDir();
  const store = await mitInhalt(dir, null);

  // Zwei Belege, damit auch die Belegablage etwas zu tun bekommt.
  for (const name of ['a', 'b']) {
    const quelle = path.join(dir, `${name}.pdf`);
    await fsp.writeFile(quelle, `Beleginhalt ${name} Nordwind`, 'utf8');
    const abgelegt = await receipts.store(store.receiptDir, quelle, {
      date: '2026-03-01', counterparty: 'Nordwind'
    }, null);
    await store.create('receipts', abgelegt, 'beleg');
  }

  const k = key();
  const ergebnis = await store.rekey(null, k);
  assert.equal(ergebnis.total, 2);
  assert.deepEqual(ergebnis.failed, []);

  // Kein einziges Byte Klartext mehr im Ordner, außer der eigenen Quelldatei.
  for (const datei of alleDateien(dir)) {
    if (/[\\/][ab]\.pdf$/.test(datei)) continue; // die Quellen von oben
    const roh = fs.readFileSync(datei);
    assert.equal(roh.includes(Buffer.from('Nordwind', 'utf8')), false, `Klartext in ${datei}`);
    assert.equal(roh.includes(Buffer.from('Geheime Firma', 'utf8')), false, `Klartext in ${datei}`);
  }

  assert.equal(fs.existsSync(path.join(dir, 'buchhaltung.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'journal.jsonl')), false);
});

test('Nach der Umstellung sind die Belege über die App noch lesbar', async () => {
  const dir = await tempDir();
  const store = await mitInhalt(dir, null);

  const quelle = path.join(dir, 'q.pdf');
  await fsp.writeFile(quelle, 'Der Beleginhalt', 'utf8');
  const abgelegt = await receipts.store(store.receiptDir, quelle, { date: '2026-03-01' }, null);
  const gespeichert = await store.create('receipts', abgelegt, 'beleg');

  const k = key();
  await store.rekey(null, k);

  const frisch = store.get('receipts', gespeichert.id);
  assert.equal(frisch.encrypted, true);
  const klar = await receipts.read(store.receiptDir, frisch, k);
  assert.equal(klar.toString('utf8'), 'Der Beleginhalt');
  // Die Prüfsumme hat die Umstellung überlebt.
  assert.equal((await receipts.verify(store.receiptDir, frisch, k)).ok, true);
});

test('Der Weg zurück führt zum selben Bestand', async () => {
  const dir = await tempDir();
  const k = key();
  const store = await mitInhalt(dir, k);

  const quelle = path.join(dir, 'q.pdf');
  await fsp.writeFile(quelle, 'Beleg', 'utf8');
  const abgelegt = await receipts.store(store.receiptDir, quelle, { date: '2026-03-01' }, k);
  await store.create('receipts', abgelegt, 'beleg');

  // Nur die eigenen Felder vergleichen: beim Laden ergänzt die
  // Schemamigration Standardwerte, das ist ihre Aufgabe und kein Unterschied.
  const wesentlich = (liste) => liste.map((e) => [e.id, e.date, e.description, e.gross].join('|'));
  const vorher = wesentlich(store.snapshot().entries);
  await store.rekey(k, null);

  assert.equal(fs.existsSync(path.join(dir, 'buchhaltung.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'buchhaltung.nst')), false);

  const offen = new Store(dir, null);
  await offen.init();
  assert.deepEqual(wesentlich(offen.snapshot().entries), vorher);
  assert.equal(offen.snapshot().settings.company.name, 'Geheime Firma GmbH');

  const beleg = offen.list('receipts')[0];
  assert.equal(beleg.encrypted, false);
  assert.equal((await receipts.read(offen.receiptDir, beleg, null)).toString('utf8'), 'Beleg');
});

test('Die Umstellung meldet ihren Fortschritt', async () => {
  const dir = await tempDir();
  const store = await mitInhalt(dir, null);

  const quelle = path.join(dir, 'q.pdf');
  await fsp.writeFile(quelle, 'Beleg', 'utf8');
  await store.create('receipts', await receipts.store(store.receiptDir, quelle, { date: '2026-03-01' }, null), 'beleg');

  const meldungen = [];
  await store.rekey(null, key(), (p) => meldungen.push(p));

  assert.ok(meldungen.length >= 2);
  assert.equal(meldungen[meldungen.length - 1].done, 1);
  assert.equal(meldungen[meldungen.length - 1].total, 1);
});

test('Ein Beleg, der fehlt, hält die Umstellung nicht auf', async () => {
  const dir = await tempDir();
  const store = await mitInhalt(dir, null);

  await store.create('receipts', {
    fileName: 'weg.pdf', relativePath: '2026/weg.pdf', date: '2026-01-01', checksum: 'x'
  }, 'beleg');

  const k = key();
  const ergebnis = await store.rekey(null, k);
  // Fehlende Datei ist kein Fehler, nur nichts zu tun.
  assert.deepEqual(ergebnis.failed, []);
  assert.equal(vault.isEncrypted(fs.readFileSync(path.join(dir, 'buchhaltung.nst'))), true);
});

test('Auch alte Sicherungen werden mit umgestellt', async () => {
  const dir = await tempDir();
  const store = await mitInhalt(dir, null);

  // Eine Sicherung von gestern, wie sie der tägliche Lauf hinterlässt.
  await fsp.writeFile(
    path.join(dir, 'backups', 'buchhaltung-2026-03-01.json'),
    JSON.stringify({ settings: { company: { name: 'Geheime Firma GmbH' } } }),
    'utf8'
  );

  await store.rekey(null, key());

  const dateien = fs.readdirSync(path.join(dir, 'backups'));
  assert.equal(dateien.every((f) => f.endsWith('.nst')), true, dateien.join(', '));
  for (const f of dateien) {
    assert.equal(vault.isEncrypted(fs.readFileSync(path.join(dir, 'backups', f))), true);
  }
});
