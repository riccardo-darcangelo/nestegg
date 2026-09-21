'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const vault = require('../../src/security/vault');

/**
 * Verschlüsselung des Datenbestands.
 *
 * Die Ableitung mit den echten Werten dauert rund eine Sekunde. Wo der Test
 * nur die Mechanik prüft und nicht die Härte, werden kleinere Werte
 * mitgegeben: die Prüfung soll den Entwickler nicht zum Warten erziehen.
 */
const SCHNELL = { N: 1024, r: 8, p: 1, keyLength: 32, maxmem: 32 * 1024 * 1024 };

function key() {
  return crypto.randomBytes(32);
}

/* ----------------------------------------------------------- Dateien */

test('Verschlüsselt und wieder entschlüsselt ergibt dasselbe', () => {
  const k = key();
  const klar = Buffer.from('Rechnung 2026-0001 über 1.190,00 Euro', 'utf8');

  const dose = vault.encrypt(klar, k);
  assert.deepEqual(vault.decrypt(dose, k), klar);
});

test('Der Klartext steht nicht in der verschlüsselten Datei', () => {
  const dose = vault.encrypt('Renée Bergström', key());
  assert.equal(dose.includes(Buffer.from('Margarethe', 'utf8')), false);
  assert.equal(dose.includes(Buffer.from('Cruz', 'utf8')), false);
});

test('Zweimal dasselbe ergibt zwei verschiedene Dosen', () => {
  // Gleicher Schlüssel, gleicher Inhalt, aber je ein eigener Zufallswert:
  // sonst verriete schon der Vergleich zweier Dateien, dass sich nichts
  // geändert hat.
  const k = key();
  const a = vault.encrypt('gleich', k);
  const b = vault.encrypt('gleich', k);
  assert.notDeepEqual(a, b);
});

test('Ein falscher Schlüssel entschlüsselt nicht', () => {
  const dose = vault.encrypt('geheim', key());
  assert.throws(() => vault.decrypt(dose, key()));
});

test('Eine veränderte Datei fällt auf', () => {
  const k = key();
  const dose = vault.encrypt('Betrag 100,00', k);

  // Ein einzelnes gekipptes Bit im Inhalt.
  const manipuliert = Buffer.from(dose);
  manipuliert[manipuliert.length - 1] ^= 0x01;
  assert.throws(() => vault.decrypt(manipuliert, k));
});

test('Auch ein veränderter Kopf fällt auf', () => {
  const k = key();
  const dose = vault.encrypt('Inhalt', k, 0);

  const manipuliert = Buffer.from(dose);
  manipuliert[vault.MAGIC.length + 1] = 7; // die Art umschreiben
  assert.throws(() => vault.decrypt(manipuliert, k));
});

test('Etwas anderes als eine NestEgg-Datei wird abgewiesen', () => {
  assert.throws(
    () => vault.decrypt(Buffer.from('{ "buchungen": [] }', 'utf8'), key()),
    /keine NestEgg-Datei/
  );
  assert.throws(() => vault.decrypt(Buffer.alloc(3), key()), /keine NestEgg-Datei/);
});

test('Verschlüsselte Dateien sind als solche erkennbar', () => {
  assert.equal(vault.isEncrypted(vault.encrypt('x', key())), true);
  assert.equal(vault.isEncrypted(Buffer.from('{"a":1}', 'utf8')), false);
  assert.equal(vault.isEncrypted(null), false);
});

test('Ein Schlüssel falscher Länge wird abgewiesen', () => {
  assert.throws(() => vault.encrypt('x', crypto.randomBytes(16)), /32 Bytes/);
});

test('Auch leerer Inhalt und große Inhalte gehen durch', () => {
  const k = key();
  assert.equal(vault.decrypt(vault.encrypt('', k), k).length, 0);

  const gross = crypto.randomBytes(3 * 1024 * 1024);
  assert.deepEqual(vault.decrypt(vault.encrypt(gross, k), k), gross);
});

/* ---------------------------------------------- Wiederherstellung */

test('Der Wiederherstellungsschlüssel hat sechs Vierergruppen', () => {
  const schluessel = vault.makeRecoveryKey();
  assert.match(schluessel, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
  assert.equal(vault.looksLikeRecoveryKey(schluessel), true);
});

test('Zwei Wiederherstellungsschlüssel sind nie gleich', () => {
  const gesehen = new Set();
  for (let i = 0; i < 200; i += 1) gesehen.add(vault.makeRecoveryKey());
  assert.equal(gesehen.size, 200);
});

test('Beim Abtippen verziehene Zeichen', () => {
  // Wer O statt 0 oder l statt 1 liest, meinte das Zeichen, das es gibt.
  assert.equal(vault.normalizeRecoveryKey('o1lI'), '0111');
  assert.equal(vault.normalizeRecoveryKey('U'), 'V');
  assert.equal(vault.normalizeRecoveryKey('abcd efgh'), 'ABCDEFGH');
  assert.equal(vault.normalizeRecoveryKey('ABCD-EFGH'), 'ABCDEFGH');
});

test('Ein unvollständiger Schlüssel wird nicht angenommen', () => {
  assert.equal(vault.looksLikeRecoveryKey('ABCD-EFGH'), false);
  assert.equal(vault.looksLikeRecoveryKey(''), false);
  assert.equal(vault.looksLikeRecoveryKey(null), false);
});

test('Formatiert wird wieder in Vierergruppen', () => {
  assert.equal(vault.formatRecoveryKey('abcdefghjkmnpqrstvwxyz23'), 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ23');
});

/* ----------------------------------------------------- Schlüsselbund */

test('Ein neuer Bund öffnet sich mit Passwort und mit Wiederherstellung', async () => {
  const { keyring, dataKey, recoveryKey } = await vault.createKeyring('ein gutes Passwort');

  assert.equal(dataKey.length, 32);
  assert.deepEqual(await vault.openWithPassword(keyring, 'ein gutes Passwort'), dataKey);
  assert.deepEqual(await vault.openWithRecoveryKey(keyring, recoveryKey), dataKey);
});

test('Der Datenschlüssel steht nirgends im Bund', async () => {
  const { keyring, dataKey, recoveryKey } = await vault.createKeyring('ein gutes Passwort');
  const text = JSON.stringify(keyring);

  assert.equal(text.includes(dataKey.toString('base64')), false);
  assert.equal(text.includes(dataKey.toString('hex')), false);
  // Und auch das Passwort und der Wiederherstellungsschlüssel nicht.
  assert.equal(text.includes('ein gutes Passwort'), false);
  assert.equal(text.includes(vault.normalizeRecoveryKey(recoveryKey)), false);
});

test('Das falsche Passwort öffnet nichts und verrät nichts', async () => {
  const { keyring } = await vault.createKeyring('ein gutes Passwort');
  await assert.rejects(
    () => vault.openWithPassword(keyring, 'ein anderes Passwort'),
    /Das Passwort passt nicht\.$/
  );
});

test('Der Wiederherstellungsschlüssel wird auch abgetippt angenommen', async () => {
  const { keyring, dataKey, recoveryKey } = await vault.createKeyring('ein gutes Passwort');

  const abgetippt = recoveryKey.toLowerCase().replace(/-/g, ' ');
  assert.deepEqual(await vault.openWithRecoveryKey(keyring, abgetippt), dataKey);
});

test('Ein falscher Wiederherstellungsschlüssel öffnet nichts', async () => {
  const { keyring } = await vault.createKeyring('ein gutes Passwort');
  await assert.rejects(
    () => vault.openWithRecoveryKey(keyring, vault.makeRecoveryKey()),
    /passt nicht/
  );
  await assert.rejects(() => vault.openWithRecoveryKey(keyring, 'zu kurz'), /sechs Vierergruppen/);
});

test('Ein neues Passwort lässt die Daten unberührt', async () => {
  const { keyring, dataKey, recoveryKey } = await vault.createKeyring('das alte Passwort');
  const neu = await vault.withNewPassword(keyring, dataKey, 'das neue Passwort');

  // Derselbe Datenschlüssel: nichts muss neu verschlüsselt werden.
  assert.deepEqual(await vault.openWithPassword(neu, 'das neue Passwort'), dataKey);
  // Das alte Passwort ist weg, die Wiederherstellung bleibt.
  await assert.rejects(() => vault.openWithPassword(neu, 'das alte Passwort'));
  assert.deepEqual(await vault.openWithRecoveryKey(neu, recoveryKey), dataKey);
});

test('Ein neuer Wiederherstellungsschlüssel entwertet den alten', async () => {
  const { keyring, dataKey, recoveryKey } = await vault.createKeyring('ein gutes Passwort');
  const erneuert = await vault.withNewRecoveryKey(keyring, dataKey);

  assert.notEqual(erneuert.recoveryKey, recoveryKey);
  assert.deepEqual(await vault.openWithRecoveryKey(erneuert.keyring, erneuert.recoveryKey), dataKey);
  await assert.rejects(() => vault.openWithRecoveryKey(erneuert.keyring, recoveryKey));
  // Das Passwort gilt weiter.
  assert.deepEqual(await vault.openWithPassword(erneuert.keyring, 'ein gutes Passwort'), dataKey);
});

test('Der Geräteumschlag braucht keine Ableitung', () => {
  const dataKey = crypto.randomBytes(32);
  const geraeteschluessel = key();

  const umschlag = vault.sealWithKey(dataKey, geraeteschluessel);
  assert.deepEqual(vault.unsealWithKey(umschlag, geraeteschluessel), dataKey);
  assert.throws(() => vault.unsealWithKey(umschlag, key()));
});

test('Der Bund merkt sich seine Ableitungswerte', async () => {
  const { keyring } = await vault.createKeyring('ein gutes Passwort');
  // Sonst ließe sich ein Bestand nach einer Änderung der Vorgabewerte nicht
  // mehr öffnen.
  assert.equal(keyring.kdf.name, 'scrypt');
  assert.equal(keyring.kdf.N, vault.KDF.N);
  assert.equal(keyring.kdf.r, 8);
});

test('Umschlag und Ableitung vertragen eigene Werte', async () => {
  const dataKey = crypto.randomBytes(32);
  const umschlag = await vault.seal(dataKey, 'geheimnis', SCHNELL);
  assert.deepEqual(await vault.unseal(umschlag, 'geheimnis', SCHNELL), dataKey);
  await assert.rejects(() => vault.unseal(umschlag, 'anders', SCHNELL));
});

/* ------------------------------------------------------- Passwortgüte */

test('Zu kurze Passwörter werden abgewiesen', () => {
  assert.match(vault.passwordProblem('kurz'), /zwölf Zeichen/);
  assert.match(vault.passwordProblem('elfzeichen!'), /zwölf Zeichen/);
  assert.equal(vault.passwordProblem('zwoelfzeiche'), null);
});

test('Geläufige und stumpfe Passwörter werden abgewiesen', () => {
  assert.match(vault.passwordProblem('Passwort123'), /zwölf Zeichen/);
  assert.match(vault.passwordProblem('passwort123 '), /Leerzeichen/);
  assert.match(vault.passwordProblem('aaaaaaaaaaaaaa'), /wiederholtes Zeichen/);
  assert.match(vault.passwordProblem('administrator'), /geläufig/);
});

test('Ein leeres Passwort ist ein Problem, kein Absturz', () => {
  assert.match(vault.passwordProblem(''), /zwölf Zeichen/);
  assert.match(vault.passwordProblem(null), /zwölf Zeichen/);
  assert.match(vault.passwordProblem(undefined), /zwölf Zeichen/);
});

test('Ein Bund mit schwachem Passwort entsteht gar nicht erst', async () => {
  await assert.rejects(() => vault.createKeyring('kurz'), /zwölf Zeichen/);
});

test('Die Einschätzung wächst mit Länge und Vielfalt', () => {
  assert.equal(vault.passwordStrength('').level, 'empty');
  assert.equal(vault.passwordStrength('aaaaaaaaaaaa').level, 'weak');

  const kurz = vault.passwordStrength('Sommer2026!x');
  const lang = vault.passwordStrength('Sommer2026!x im Garten hinterm Haus');
  assert.ok(lang.bits > kurz.bits);
  assert.equal(lang.level, 'strong');
});
