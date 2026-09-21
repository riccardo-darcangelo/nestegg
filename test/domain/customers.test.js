'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const customers = require('../../src/domain/customers');

const LISTE = [
  { id: 'kd_1', name: 'Nordlicht Handels e.K.', customerNumber: '0001' },
  { id: 'kd_2', name: 'Kranich Gerüstbau GmbH', customerNumber: '0005' }
];

test('Die nächste Nummer behält die Stellenzahl', () => {
  assert.equal(customers.nextNumber(LISTE), '0006');
  assert.equal(customers.nextNumber([{ customerNumber: '7' }]), '8');
  assert.equal(customers.nextNumber([{ customerNumber: '0099' }]), '0100');
});

test('Ohne Kunden beginnt es bei 0001', () => {
  assert.equal(customers.nextNumber([]), '0001');
  assert.equal(customers.nextNumber([{ name: 'ohne Nummer' }]), '0001');
});

test('Nummern mit Buchstaben bleiben außen vor', () => {
  // Was daran der Zähler ist, lässt sich nicht raten.
  assert.equal(customers.nextNumber([{ customerNumber: 'K-001' }]), '0001');
  assert.equal(customers.nextNumber([...LISTE, { customerNumber: 'K-042' }]), '0006');
});

test('Eine doppelte Nummer wird gefunden', () => {
  assert.equal(customers.findDuplicate(LISTE, '0001').name, 'Nordlicht Handels e.K.');
  assert.equal(customers.findDuplicate(LISTE, '0009'), null);
});

test('Der eigene Datensatz zählt beim Bearbeiten nicht als Dublette', () => {
  assert.equal(customers.findDuplicate(LISTE, '0001', 'kd_1'), null);
  assert.equal(customers.findDuplicate(LISTE, '0001', 'kd_2').id, 'kd_1');
});

test('Eine leere Nummer ist nie doppelt', () => {
  // Nicht jeder Kunde braucht eine Nummer.
  assert.equal(customers.findDuplicate(LISTE, ''), null);
  assert.equal(customers.findDuplicate([{ id: 'a', customerNumber: '' }], ''), null);
});

test('Leerzeichen und Groß- und Kleinschreibung trennen keine Nummern', () => {
  assert.equal(customers.sameNumber('0001', ' 0001 '), true);
  assert.equal(customers.sameNumber('k-1', 'K-1'), true);
  assert.equal(customers.sameNumber('0001', '1'), false, '0001 und 1 sind zwei Nummern');
});

/* ------------------------------------------------------------------ Im Nummernkreis */

const invoices = require('../../src/domain/invoices');

test('Die Kundennummer lässt sich in die Belegnummer setzen', () => {
  // Ein Schema aus der Praxis: R-JJMM-<Kunde 2-stellig><Zähler 2-stellig>
  assert.equal(invoices.buildNumber('R-{YY}{MM}-{KK}{##}', 1, '2026-09-05', '0001'), 'R-2609-0101');
  assert.equal(invoices.buildNumber('A-{YY}{MM}-{KK}{##}', 1, '2026-09-09', '0005'), 'A-2609-0501');
});

test('Die Breite bestimmt, wie viele Stellen genommen werden', () => {
  assert.equal(invoices.buildNumber('{K}', 1, '2026-09-05', '0007'), '7');
  assert.equal(invoices.buildNumber('{KK}', 1, '2026-09-05', '0042'), '42');
  assert.equal(invoices.buildNumber('{KKKK}', 1, '2026-09-05', '7'), '0007', 'kurze Nummer wird aufgefüllt');
});

test('Ohne Kundennummer entsteht keine mehrdeutige Belegnummer', () => {
  // Sonst hießen alle Rechnungen an Kunden ohne Nummer gleich.
  assert.throws(
    () => invoices.buildNumber('R-{YY}{MM}-{KK}{##}', 1, '2026-09-05', ''),
    /Kundennummer/
  );
});

test('Muster ohne Kundennummer bleiben unberührt', () => {
  assert.equal(invoices.buildNumber('RE-{YYYY}-{####}', 7, '2026-09-05'), 'RE-2026-0007');
});
