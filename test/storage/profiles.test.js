'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const profiles = require('../../src/storage/profiles');

const ROOT = path.join('C:', 'Daten', 'NestEgg');

function state(...names) {
  let current = { profiles: [], activeProfileId: null };
  for (const name of names) {
    const result = profiles.add(current, { name, root: ROOT });
    current = result.state;
  }
  return current;
}

/* ------------------------------------------------------------------ Namen */

test('Aus einem Namen wird ein brauchbarer Ordnername', () => {
  assert.equal(profiles.slugify('Musterbetrieb'), 'musterbetrieb');
  assert.equal(profiles.slugify('Turnverein Musterstadt e. V.'), 'turnverein-musterstadt-e-v');
  assert.equal(profiles.slugify('Müller & Söhne GbR'), 'mueller-soehne-gbr');
});

test('Umlaute werden ersetzt, nicht entfernt', () => {
  // Erst ersetzen, dann zerlegen: sonst wird aus Müller ein Muller.
  assert.equal(profiles.slugify('Bäckerei Körner'), 'baeckerei-koerner');
});

test('Namen, die Windows als Ordner verweigert, werden entschärft', () => {
  assert.equal(profiles.slugify('con'), 'profil-con');
  assert.equal(profiles.slugify('LPT1'), 'profil-lpt1');
  assert.equal(profiles.slugify('...'), 'profil-neu');
});

test('Gleiche Namen bekommen verschiedene Ordner', () => {
  assert.equal(profiles.freeSlug('Verein', ['verein']), 'verein-2');
  assert.equal(profiles.freeSlug('Verein', ['verein', 'verein-2']), 'verein-3');
});

test('Neue Profile liegen im Unterordner profile', () => {
  const dir = profiles.dirFor(ROOT, 'Turnverein', []);
  assert.equal(dir, path.join(ROOT, 'profile', 'turnverein'));
});

/* ------------------------------------------------------------------ Übernahme */

test('Ohne Profile in der Konfiguration wird der bisherige Ordner zum ersten Profil', () => {
  const result = profiles.fromConfig({ dataDir: ROOT }, { fallbackName: 'Musterbetrieb' });

  assert.equal(result.migrated, true);
  assert.equal(result.profiles.length, 1);
  assert.equal(result.profiles[0].dir, ROOT, 'der Bestand bleibt liegen, wo er ist');
  assert.equal(result.profiles[0].name, 'Musterbetrieb');
  assert.equal(result.activeProfileId, result.profiles[0].id);
});

test('Vorhandene Profile werden übernommen, ohne etwas zu erfinden', () => {
  const config = {
    profiles: [
      { id: 'prf_1', name: 'Betrieb', dir: ROOT },
      { id: 'prf_2', name: 'Verein', dir: path.join(ROOT, 'profile', 'verein') }
    ],
    activeProfileId: 'prf_2'
  };
  const result = profiles.fromConfig(config);

  assert.equal(result.migrated, false);
  assert.equal(result.profiles.length, 2);
  assert.equal(profiles.activeOf(result).name, 'Verein');
});

test('Zeigt das aktive Profil ins Leere, gilt das erste', () => {
  const result = profiles.fromConfig({
    profiles: [{ id: 'prf_1', name: 'Betrieb', dir: ROOT }],
    activeProfileId: 'prf_weg'
  });
  assert.equal(result.activeProfileId, 'prf_1');
});

test('Einträge ohne Ordner werden übergangen', () => {
  const result = profiles.fromConfig({
    profiles: [{ id: 'prf_1', name: 'Kaputt' }, { id: 'prf_2', name: 'Heil', dir: ROOT }]
  });
  assert.equal(result.profiles.length, 1);
  assert.equal(result.profiles[0].name, 'Heil');
});

/* ------------------------------------------------------------------ Pflegen */

test('Ein neues Profil wird gleich das aktive', () => {
  const before = state('Betrieb');
  const { state: after, profile } = profiles.add(before, { name: 'Turnverein', root: ROOT });

  assert.equal(after.profiles.length, 2);
  assert.equal(after.activeProfileId, profile.id);
  assert.equal(profile.dir, path.join(ROOT, 'profile', 'turnverein'));
});

test('Zwei Profile mit demselben Namen gibt es nicht', () => {
  const result = profiles.add(state('Betrieb'), { name: 'betrieb', root: ROOT });
  assert.match(result.error, /gibt es schon/);
});

test('Zwei Profile im selben Ordner gibt es auch nicht', () => {
  const before = state('Betrieb');
  const belegt = before.profiles[0].dir;
  const result = profiles.add(before, { name: 'Anderer Name', dir: belegt, root: ROOT });
  assert.match(result.error, /bereits ein Profil/);
});

test('Ein Profil ohne Namen wird abgelehnt', () => {
  assert.match(profiles.add(state(), { name: '   ', root: ROOT }).error, /Namen/);
});

test('Umbenennen lässt den Ordner in Ruhe', () => {
  const before = state('Betrieb', 'Verein');
  const id = before.profiles[1].id;
  const dir = before.profiles[1].dir;

  const { state: after } = profiles.rename(before, id, 'Turnverein Musterstadt e. V.');
  assert.equal(after.profiles[1].name, 'Turnverein Musterstadt e. V.');
  assert.equal(after.profiles[1].dir, dir, 'der Ordner heißt weiter wie am ersten Tag');
});

test('Das letzte Profil lässt sich nicht entfernen', () => {
  assert.match(profiles.remove(state('Betrieb'), 'prf_1').error, /letzte Profil/);
});

test('Wird das aktive Profil entfernt, rückt das erste nach', () => {
  const before = state('Betrieb', 'Verein');
  const active = before.activeProfileId;
  const { state: after, removed } = profiles.remove(before, active);

  assert.equal(after.profiles.length, 1);
  assert.equal(after.activeProfileId, after.profiles[0].id);
  assert.equal(removed.name, 'Verein');
});

test('Wechseln auf ein unbekanntes Profil schlägt fehl, statt still nichts zu tun', () => {
  assert.match(profiles.activate(state('Betrieb'), 'prf_gibt_es_nicht').error, /gibt es nicht/);
});

test('Pfade vergleichen sich ohne Rücksicht auf Schrägstrich und Schreibweise', () => {
  assert.equal(profiles.samePath('C:\\Daten\\NestEgg', 'c:/daten/nestegg/'), true);
  assert.equal(profiles.samePath('C:\\Daten\\NestEgg', 'C:\\Daten\\NestEgg2'), false);
});
