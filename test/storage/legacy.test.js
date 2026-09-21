'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const legacy = require('../../src/storage/legacy');
const { DATA_FILE } = require('../../src/storage/store');

/**
 * Umzug von einer früheren Fassung.
 *
 * Der Fehler, den diese Tests festhalten: mit dem Anwendungsnamen wechselt der
 * Ordner für die Konfiguration. Ohne Übernahme startet die App leer, während
 * die Buchhaltung unangetastet daneben liegt.
 */

async function sandbox() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'nestegg-legacy-'));
  const userDataParent = path.join(root, 'Roaming');
  const documents = path.join(root, 'Dokumente');
  await fsp.mkdir(userDataParent, { recursive: true });
  await fsp.mkdir(documents, { recursive: true });
  return { root, userDataParent, documents };
}

async function writeDataDir(dir, content = {}) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, DATA_FILE),
    JSON.stringify({
      schemaVersion: 3,
      settings: {},
      entries: [], invoices: [], customers: [], projects: [], assets: [], receipts: [],
      ...content
    }),
    'utf8'
  );
  return dir;
}

async function writeLegacyConfig(userDataParent, name, dataDir) {
  const dir = path.join(userDataParent, name);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'config.json'), JSON.stringify({ dataDir }), 'utf8');
}

/* ------------------------------------------------------------------ Suche */

test('Der alte Datenordner wird über die frühere Konfiguration gefunden', async () => {
  const s = await sandbox();
  const oldDir = await writeDataDir(path.join(s.root, 'Woanders', 'Buchhaltung'), {
    entries: [{ id: 'buch_1' }]
  });
  await writeLegacyConfig(s.userDataParent, 'Kontor', oldDir);

  assert.equal(legacy.findLegacyDataDir(s), oldDir, 'auch ein verschobener Ordner wird gefunden');
});

test('Ohne frühere Konfiguration wird im damaligen Standardordner gesucht', async () => {
  const s = await sandbox();
  const oldDir = await writeDataDir(path.join(s.documents, 'Kontor'), { entries: [{ id: 'buch_1' }] });

  assert.equal(legacy.findLegacyDataDir(s), oldDir);
});

test('Zeigt die alte Konfiguration ins Leere, greift der Standardordner', async () => {
  const s = await sandbox();
  await writeLegacyConfig(s.userDataParent, 'Kontor', path.join(s.root, 'gibt-es-nicht'));
  const oldDir = await writeDataDir(path.join(s.documents, 'Kontor'));

  assert.equal(legacy.findLegacyDataDir(s), oldDir);
});

test('Ohne Vorgänger wird nichts gefunden', async () => {
  const s = await sandbox();
  assert.equal(legacy.findLegacyDataDir(s), null);
});

/* ------------------------------------------------------------------ Leerprüfung */

test('Ein Ordner mit Buchungen gilt nicht als leer', async () => {
  const s = await sandbox();
  const full = await writeDataDir(path.join(s.documents, 'Voll'), { entries: [{ id: 'buch_1' }] });
  const empty = await writeDataDir(path.join(s.documents, 'Leer'));

  assert.equal(legacy.isEmptyDataDir(full), false);
  assert.equal(legacy.isEmptyDataDir(empty), true);
  assert.equal(legacy.isEmptyDataDir(path.join(s.documents, 'gibt-es-nicht')), false);
});

/* ------------------------------------------------------------------ Übernahme */

test('Ohne vorhandenes Ziel wird der alte Ordner einfach umbenannt', async () => {
  const s = await sandbox();
  const oldDir = await writeDataDir(path.join(s.documents, 'Kontor'), { entries: [{ id: 'buch_1' }] });
  const target = path.join(s.documents, 'NestEgg');

  const result = legacy.adopt(oldDir, target);

  assert.equal(result.error, null);
  assert.equal(result.dir, target);
  assert.equal(result.plan.action, 'rename');
  assert.ok(fs.existsSync(path.join(target, DATA_FILE)));
  assert.ok(!fs.existsSync(oldDir), 'der alte Ordner ist umgezogen, nicht kopiert');

  const data = JSON.parse(fs.readFileSync(path.join(target, DATA_FILE), 'utf8'));
  assert.equal(data.entries.length, 1, 'die Buchung ist mitgekommen');
});

test('Ein leerer Platzhalter am Ziel wird entfernt und der alte Ordner rückt nach', async () => {
  const s = await sandbox();
  const oldDir = await writeDataDir(path.join(s.documents, 'Kontor'), { entries: [{ id: 'buch_1' }] });
  const target = await writeDataDir(path.join(s.documents, 'NestEgg'));

  const plan = legacy.planAdoption(oldDir, target);
  assert.equal(plan.action, 'replace');
  assert.match(plan.description, /entfernt/);

  const result = legacy.adopt(oldDir, target);
  assert.equal(result.dir, target);

  const data = JSON.parse(fs.readFileSync(path.join(target, DATA_FILE), 'utf8'));
  assert.equal(data.entries.length, 1, 'die echten Daten stehen jetzt am Zielort');
});

test('Liegen am Ziel schon Daten, wird nichts überschrieben', async () => {
  const s = await sandbox();
  const oldDir = await writeDataDir(path.join(s.documents, 'Kontor'), { entries: [{ id: 'alt' }] });
  const target = await writeDataDir(path.join(s.documents, 'NestEgg'), { entries: [{ id: 'neu' }] });

  const result = legacy.adopt(oldDir, target);

  assert.equal(result.plan.action, 'link');
  assert.equal(result.dir, oldDir, 'gearbeitet wird mit dem alten Ordner');
  assert.ok(fs.existsSync(path.join(oldDir, DATA_FILE)), 'der alte Ordner bleibt bestehen');

  const kept = JSON.parse(fs.readFileSync(path.join(target, DATA_FILE), 'utf8'));
  assert.equal(kept.entries[0].id, 'neu', 'die Daten am Ziel sind unangetastet');
});

test('Scheitert das Umbenennen, bleibt der alte Ordner gültig', async () => {
  const s = await sandbox();
  const oldDir = await writeDataDir(path.join(s.documents, 'Kontor'), { entries: [{ id: 'buch_1' }] });
  // Ein Ziel, dessen übergeordneter Ordner nicht existiert, lässt sich nicht anlegen.
  const target = path.join(s.root, 'nicht', 'vorhanden', 'NestEgg');

  const result = legacy.adopt(oldDir, target);

  assert.ok(result.error, 'der Fehler wird gemeldet, nicht verschluckt');
  assert.equal(result.dir, oldDir);
  assert.ok(fs.existsSync(path.join(oldDir, DATA_FILE)), 'die Daten sind unversehrt');
});
