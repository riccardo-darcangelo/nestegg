'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const tax = require('../../src/domain/tax');

/**
 * Nacherfassung früherer Jahre.
 *
 * Belege aus abgeschlossenen Jahren sollen die Auswertung bereichern, aber
 * keine Erklärung tragen: die Daten sind unvollständig, und eine EÜR daraus
 * wäre falsch.
 */

function settings(ab) {
  return { tax: { bookkeepingFrom: ab } };
}

test('Ohne Stichjahr zählt jedes Jahr voll', () => {
  assert.equal(tax.isArchiveYear(settings(null), 2019), false);
  assert.equal(tax.isArchiveYear({}, 2019), false);
  assert.equal(tax.isArchiveYear(undefined, 2019), false);
});

test('Jahre vor dem Stichjahr sind Archiv', () => {
  const s = settings(2026);
  assert.equal(tax.isArchiveYear(s, 2024), true);
  assert.equal(tax.isArchiveYear(s, 2025), true);
});

test('Das Stichjahr selbst zählt schon voll', () => {
  const s = settings(2026);
  assert.equal(tax.isArchiveYear(s, 2026), false);
  assert.equal(tax.isArchiveYear(s, 2027), false);
});

test('Das Jahr darf als Zeichenkette kommen', () => {
  // Aus einem Datum geschnitten ist es eine Zeichenkette.
  assert.equal(tax.isArchiveYear(settings(2026), '2024'), true);
  assert.equal(tax.isArchiveYear(settings(2026), '2026'), false);
});

test('Der Hinweis nennt Jahr und Stichjahr', () => {
  const text = tax.archiveNote(2024, settings(2026));

  assert.match(text, /2024 liegt vor dem Beginn/);
  assert.match(text, /ab 2026/);
  assert.match(text, /nicht der Erklärung/);
});
