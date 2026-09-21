'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const sepa = require('../../src/domain/sepa');
const builder = require('../../src/export/sepa');

/** Die offizielle Test-Gläubiger-ID der Bundesbank. */
const TEST_CI = 'DE98ZZZ09999999999';

/** Gültige Beispiel-IBANs. */
const IBAN_DE = 'DE02120300000000202051';
const IBAN_AT = 'AT026000000001349870';

const SETTINGS = {
  creditorId: TEST_CI,
  creditorName: 'Turnverein Musterstadt e. V.',
  scheme: 'CORE',
  sequenceType: 'RCUR',
  painVersion: 'pain.008.001.08',
  preNotificationDays: 14,
  batchBooking: true
};

const CREDITOR = {
  name: 'Turnverein Musterstadt e. V.',
  iban: 'DE89370400440532013000',
  bic: ''
};

function member(overrides = {}) {
  return {
    id: 'mg_1', name: 'Erika Musterfrau', iban: IBAN_DE,
    mandateRef: 'TVM-0001', mandateDate: '2014-03-01', ...overrides
  };
}

/* ------------------------------------------------------------------ Prüfziffern */

test('Die Test-Gläubiger-ID der Bundesbank wird als gültig erkannt', () => {
  assert.equal(sepa.validCreditorId(TEST_CI), true);
});

test('Die Geschäftsbereichskennung geht nicht in die Prüfziffer ein', () => {
  // Dieselbe Nummer mit anderer Kennung muss ebenso gültig sein, sonst wäre
  // jede Gläubiger-ID falsch, die nicht auf ZZZ lautet.
  assert.equal(sepa.validCreditorId('DE98ABC09999999999'), true);
  assert.equal(sepa.validCreditorId('DE98A1209999999999'), true);
});

test('Eine verdrehte Gläubiger-ID fällt durch', () => {
  assert.equal(sepa.validCreditorId('DE99ZZZ09999999999'), false, 'falsche Prüfziffer');
  assert.equal(sepa.validCreditorId('DE98ZZZ09999999998'), false, 'falsche Kennung');
  assert.equal(sepa.validCreditorId(''), false);
  assert.equal(sepa.validCreditorId('Unsinn'), false);
});

test('Leerzeichen in der Gläubiger-ID stören nicht', () => {
  assert.equal(sepa.validCreditorId('DE98 ZZZ0 9999 9999 99'), true);
});

test('Die Gläubiger-ID lässt sich zerlegen und anzeigen', () => {
  const parts = sepa.creditorIdParts(TEST_CI);
  assert.equal(parts.country, 'DE');
  assert.equal(parts.checkDigits, '98');
  assert.equal(parts.businessCode, 'ZZZ');
  assert.equal(parts.national, '09999999999');
  assert.equal(sepa.formatCreditorId(TEST_CI), 'DE98 ZZZ0 9999 9999 99');
});

test('Eine IBAN wird über die Prüfziffer geprüft', () => {
  assert.equal(sepa.validIban(IBAN_DE), true);
  assert.equal(sepa.validIban(IBAN_AT), true);
  assert.equal(sepa.validIban('DE02120300000000202052'), false, 'eine Ziffer verdreht');
});

test('Die IBAN-Länge richtet sich nach dem Land', () => {
  assert.equal(sepa.validIban('DE0212030000000020205'), false, 'eine Stelle zu kurz für DE');
  assert.equal(sepa.validIban(`${IBAN_DE}0`), false, 'eine Stelle zu lang');
});

test('Außerhalb des SEPA-Raums gibt es keine Lastschrift', () => {
  // Diese beiden Nummern haben eine gültige Prüfziffer. Ohne Länderprüfung
  // kämen sie durch, und die Bank wiese die Datei zurück.
  for (const iban of ['US64SVBKUS6S3300958879', 'TR330006100519786457841326']) {
    assert.equal(sepa.mod97(sepa.toDigits(iban.slice(4) + iban.slice(0, 4))), 1, `${iban}: Prüfziffer stimmt`);
    assert.equal(sepa.validIban(iban), false, `${iban}: trotzdem nicht einziehbar`);
  }
});

test('Leerzeichen in der IBAN stören nicht', () => {
  assert.equal(sepa.validIban('DE02 1203 0000 0000 2020 51'), true);
});

/* ------------------------------------------------------------------ Zeichensatz */

test('Umlaute werden umgesetzt, nicht entfernt', () => {
  assert.equal(sepa.sepaText('Müller Schäfer Straße'), 'Mueller Schaefer Strasse');
  assert.equal(sepa.sepaText('Jörg Öztürk'), 'Joerg Oeztuerk');
});

test('Unerlaubte Zeichen werden ersetzt', () => {
  assert.equal(sepa.sepaText('Meier & Söhne'), 'Meier und Soehne');
  assert.equal(sepa.sepaText('Beitrag #42 [Jahr]'), 'Beitrag 42 Jahr');
  assert.equal(sepa.sepaText('5 € für §10'), '5 EUR fuer Par.10');
});

test('Erlaubte Sonderzeichen bleiben stehen', () => {
  assert.equal(sepa.sepaText("Beitrag 2026, 1. Quartal (Jahresbeitrag): 120,00"), "Beitrag 2026, 1. Quartal (Jahresbeitrag): 120,00");
  assert.equal(sepa.sepaText('A/B-C+D?E'), 'A/B-C+D?E');
});

test('Der Text wird auf die zulässige Länge gekürzt', () => {
  assert.equal(sepa.sepaText('Musterfrau', 6), 'Muster');
  assert.equal(sepa.sepaText('Musterfrau').length, 10, 'ohne Grenze wird nicht gekürzt');
});

test('Mehrfache Leerzeichen fallen zusammen', () => {
  assert.equal(sepa.sepaText('Erika   Musterfrau  '), 'Erika Musterfrau');
});

/* ------------------------------------------------------------------ Kalender */

test('Ostersonntag wird richtig gerechnet', () => {
  assert.equal(sepa.easterSunday(2026), '2026-04-05');
  assert.equal(sepa.easterSunday(2027), '2027-03-28');
  assert.equal(sepa.easterSunday(2025), '2025-04-20');
});

test('Die sechs TARGET-Feiertage stehen fest', () => {
  const holidays = sepa.targetHolidays(2026);
  assert.equal(holidays.length, 6);
  assert.ok(holidays.includes('2026-01-01'));
  assert.ok(holidays.includes('2026-04-03'), 'Karfreitag');
  assert.ok(holidays.includes('2026-04-06'), 'Ostermontag');
  assert.ok(holidays.includes('2026-05-01'));
  assert.ok(holidays.includes('2026-12-25'));
  assert.ok(holidays.includes('2026-12-26'));
});

test('Der 3. Oktober ist ein TARGET-Geschäftstag', () => {
  // Deutscher Feiertag, aber TARGET kennt ihn nicht: die Lastschrift läuft.
  assert.equal(sepa.isTargetBusinessDay('2025-10-03'), true, 'ein Freitag');
  assert.equal(sepa.isTargetBusinessDay('2026-05-01'), false, 'der 1. Mai dagegen schon');
});

test('Wochenenden sind keine Geschäftstage', () => {
  assert.equal(sepa.isTargetBusinessDay('2026-09-19'), false, 'Samstag');
  assert.equal(sepa.isTargetBusinessDay('2026-09-20'), false, 'Sonntag');
  assert.equal(sepa.isTargetBusinessDay('2026-09-21'), true, 'Montag');
});

test('Der früheste Einzug liegt einen Geschäftstag voraus', () => {
  assert.equal(sepa.earliestCollectionDate('2026-09-17'), '2026-09-18', 'Donnerstag auf Freitag');
  assert.equal(sepa.earliestCollectionDate('2026-09-18'), '2026-09-21', 'Freitag über das Wochenende');
});

test('Feiertage verschieben den frühesten Einzug', () => {
  // Gründonnerstag 2026 ist der 2. April, danach Karfreitag und Ostermontag.
  assert.equal(sepa.earliestCollectionDate('2026-04-02'), '2026-04-07');
});

test('Mehr als 14 Kalendertage Vorlauf sind zu viel', () => {
  assert.equal(sepa.latestCollectionDate('2026-09-17'), '2026-10-01');
});

/* ------------------------------------------------------------------ Mandat */

test('Ein vollständiges Mandat wird nicht beanstandet', () => {
  const result = sepa.checkMandate(member({ mandateDate: '2025-03-01' }), '2026-10-01', '2026-09-17');
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.notes, []);
});

test('Fehlende Angaben werden einzeln benannt', () => {
  const { problems } = sepa.checkMandate(
    member({ iban: '', mandateRef: '', mandateDate: null }), '2026-10-01', '2026-09-17'
  );
  assert.equal(problems.length, 3);
  assert.match(problems.join(' '), /keine IBAN/);
  assert.match(problems.join(' '), /Mandatsreferenz fehlt/);
  assert.match(problems.join(' '), /Datum des Mandats fehlt/);
});

test('Eine falsche IBAN fällt am Mandat auf', () => {
  const { problems } = sepa.checkMandate(member({ iban: 'DE02120300000000202052' }), '2026-10-01', '2026-09-17');
  assert.match(problems.join(' '), /Prüfziffer stimmt nicht/);
});

test('Ein Mandat kann nicht nach dem Einzug unterschrieben sein', () => {
  const { problems } = sepa.checkMandate(member({ mandateDate: '2026-12-01' }), '2026-10-01', '2026-09-17');
  assert.match(problems.join(' '), /später unterschrieben/);
});

test('Ein altes Mandatsdatum allein ist kein Grund für einen Hinweis', () => {
  // Ein Mandat von 2014, aus dem seit Jahren Beiträge laufen, ist in Ordnung.
  // Ohne einen bekannten letzten Einzug kann die App darüber nichts sagen,
  // und eine Vermutung an jede Zeile zu schreiben wäre Lärm.
  const alt = sepa.checkMandate(member({ mandateDate: '2014-03-01' }), '2026-10-01', '2026-09-17');
  assert.deepEqual(alt.problems, [], 'der Einzug läuft');
  assert.deepEqual(alt.notes, [], 'und wird nicht kommentiert');
});

test('Ein zu lange zurückliegender Einzug ist ein Hinweis, keine Sperre', () => {
  const frisch = sepa.checkMandate(member({ mandateDate: '2014-03-01' }), '2026-10-01', '2026-09-17', '2026-01-15');
  assert.deepEqual(frisch.notes, []);

  const alt = sepa.checkMandate(member({ mandateDate: '2014-03-01' }), '2026-10-01', '2026-09-17', '2020-01-15');
  assert.deepEqual(alt.problems, [], 'blockiert wird nicht');
  assert.match(alt.notes.join(' '), /letzte bekannte Einzug war am 2020-01-15/);
});

/* ------------------------------------------------------------------ Zusammenstellen */

test('Der Einzug trennt Einziehbares von Beanstandetem', () => {
  const result = sepa.collect([
    { member: member(), amount: 12000, reference: 'Jahresbeitrag 2026', endToEndId: 'mg_1|2026', dueDate: '2026-10-01' },
    { member: member({ id: 'mg_2', name: 'Max Mustermann', iban: '' }), amount: 18000, reference: 'Jahresbeitrag 2026', dueDate: '2026-10-01' }
  ], { today: '2026-09-17' });

  assert.equal(result.count, 1);
  assert.equal(result.total, 12000);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].name, 'Max Mustermann');
  assert.equal(result.rows.length, 2, 'beanstandete Zeilen verschwinden nicht');
});

test('Der senkrechte Strich der Beitragskennung wird ersetzt', () => {
  const result = sepa.collect([
    { member: member(), amount: 12000, reference: 'Beitrag', endToEndId: 'mg_1|2026-1', dueDate: '2026-10-01' }
  ], { today: '2026-09-17' });

  assert.equal(result.rows[0].endToEndId, 'mg-1-2026-1', 'Unterstrich und Strich werden zu Bindestrichen');
});

test('Ein Betrag von null ist keine Lastschrift', () => {
  const result = sepa.collect([
    { member: member(), amount: 0, reference: 'Beitrag', dueDate: '2026-10-01' }
  ], { today: '2026-09-17' });

  assert.equal(result.count, 0);
  assert.match(result.blocked[0].problems.join(' '), /Betrag ist null/);
});

/* ------------------------------------------------------------------ Prüfung des Laufs */

test('Ein vollständiger Lauf wird durchgelassen', () => {
  const result = sepa.validateRun({
    creditor: CREDITOR, dueDate: '2026-10-01',
    rows: [{ amount: 12000 }], today: '2026-09-17', settings: SETTINGS
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('Ohne Gläubiger-ID geht nichts', () => {
  const result = sepa.validateRun({
    creditor: CREDITOR, dueDate: '2026-10-01',
    rows: [{ amount: 12000 }], today: '2026-09-17',
    settings: { ...SETTINGS, creditorId: '' }
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /Deutschen Bundesbank/);
});

test('Ein zu früher Fälligkeitstag wird abgelehnt', () => {
  const result = sepa.validateRun({
    creditor: CREDITOR, dueDate: '2026-09-17',
    rows: [{ amount: 12000 }], today: '2026-09-17', settings: SETTINGS
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /TARGET-Geschäftstag/);
});

test('Ein zu später Fälligkeitstag ebenso', () => {
  const result = sepa.validateRun({
    creditor: CREDITOR, dueDate: '2026-10-15',
    rows: [{ amount: 12000 }], today: '2026-09-17', settings: SETTINGS
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /14 Kalendertage/);
});

test('Eine knappe Vorabankündigung ist ein Hinweis, kein Fehler', () => {
  const result = sepa.validateRun({
    creditor: CREDITOR, dueDate: '2026-09-21',
    rows: [{ amount: 12000 }], today: '2026-09-17', settings: SETTINGS
  });

  assert.equal(result.ok, true, 'die Datei entsteht trotzdem');
  assert.match(result.warnings.join(' '), /Vorabankündigung/);
});

test('Die alte Formatfassung wird nach dem Stichtag angemahnt', () => {
  const result = sepa.validateRun({
    creditor: CREDITOR, dueDate: '2026-12-01',
    rows: [{ amount: 12000 }], today: '2026-11-20',
    settings: { ...SETTINGS, painVersion: 'pain.008.001.02' }
  });

  assert.match(result.warnings.join(' '), /nicht mehr angenommen/);
});

/* ------------------------------------------------------------------ Die Datei */

function buildFile(overrides = {}) {
  const collected = sepa.collect([
    { member: member(), amount: 12000, reference: 'Jahresbeitrag 2026, Mitglied 0001', endToEndId: 'mg_1|2026', dueDate: '2026-10-01' },
    { member: member({ id: 'mg_2', name: 'Max Müller', mandateRef: 'TVM-0002' }), amount: 18000, reference: 'Jahresbeitrag 2026, Mitglied 0002', endToEndId: 'mg_2|2026', dueDate: '2026-10-01' }
  ], { today: '2026-09-17' });

  return builder.build({
    creditor: CREDITOR,
    rows: collected.ready,
    dueDate: '2026-10-01',
    settings: { ...SETTINGS, ...overrides },
    now: new Date('2026-09-17T09:30:00Z')
  });
}

test('Die Datei trägt den richtigen Namensraum', () => {
  assert.match(buildFile().xml, /urn:iso:std:iso:20022:tech:xsd:pain\.008\.001\.08/);
  assert.match(buildFile({ painVersion: 'pain.008.001.02' }).xml, /urn:iso:std:iso:20022:tech:xsd:pain\.008\.001\.02/);
});

test('Die Wurzel heißt CstmrDrctDbtInitn und nicht wie bei der Überweisung', () => {
  const xml = buildFile().xml;
  assert.match(xml, /<CstmrDrctDbtInitn>/);
  assert.ok(!xml.includes('CstmrCdtTrfInitn'), 'das wäre pain.001');
});

test('Anzahl und Summe stehen auf beiden Ebenen und stimmen', () => {
  const file = buildFile();
  const anzahl = [...file.xml.matchAll(/<NbOfTxs>(\d+)<\/NbOfTxs>/g)].map((m) => m[1]);
  const summen = [...file.xml.matchAll(/<CtrlSum>([\d.]+)<\/CtrlSum>/g)].map((m) => m[1]);

  assert.deepEqual(anzahl, ['2', '2'], 'Datei- und Sammlerebene');
  assert.deepEqual(summen, ['300.00', '300.00']);
  assert.equal(file.count, 2);
  assert.equal(file.total, 30000);
});

test('Der Betrag steht mit Währung und zwei Nachkommastellen', () => {
  assert.match(buildFile().xml, /<InstdAmt Ccy="EUR">120\.00<\/InstdAmt>/);
});

test('Die Lastschrift trägt Art, Sequenz und Kostenregel', () => {
  const xml = buildFile().xml;
  assert.match(xml, /<PmtMtd>DD<\/PmtMtd>/);
  assert.match(xml, /<Cd>SEPA<\/Cd>/);
  assert.match(xml, /<Cd>CORE<\/Cd>/);
  assert.match(xml, /<SeqTp>RCUR<\/SeqTp>/);
  assert.match(xml, /<ChrgBr>SLEV<\/ChrgBr>/, 'etwas anderes ist in SEPA nicht zulässig');
});

test('Die Gläubiger-ID steht genau einmal in der Datei', () => {
  // Sie darf nicht gleichzeitig auf Sammler- und Transaktionsebene stehen,
  // sonst weist die Bundesbank die Transaktion zurück.
  const treffer = [...buildFile().xml.matchAll(/<CdtrSchmeId>/g)];
  assert.equal(treffer.length, 1);
});

test('Das Mandat steht an jeder Lastschrift', () => {
  const xml = buildFile().xml;
  assert.match(xml, /<MndtId>TVM-0001<\/MndtId>/);
  assert.match(xml, /<DtOfSgntr>2014-03-01<\/DtOfSgntr>/);
  assert.equal([...xml.matchAll(/<MndtRltdInf>/g)].length, 2);
});

test('Der Name des Zahlungspflichtigen kommt ohne Umlaut in die Datei', () => {
  assert.match(buildFile().xml, /<Nm>Max Mueller<\/Nm>/);
});

test('Das Fälligkeitsdatum steht auf der Sammlerebene', () => {
  const xml = buildFile().xml;
  assert.equal([...xml.matchAll(/<ReqdColltnDt>/g)].length, 1);
  assert.match(xml, /<ReqdColltnDt>2026-10-01<\/ReqdColltnDt>/);
});

test('Die Bank des Zahlungspflichtigen bleibt offen', () => {
  // IBAN-only seit Februar 2016: einen BIC zu raten wäre schlimmer.
  assert.match(buildFile().xml, /<DbtrAgt>\s*<FinInstnId>\s*<Othr>\s*<Id>NOTPROVIDED<\/Id>/);
});

test('Ein hinterlegter BIC des Gläubigers landet im richtigen Element', () => {
  const mitBic = builder.build({
    creditor: { ...CREDITOR, bic: 'COBADEFFXXX' },
    rows: sepa.collect([{ member: member(), amount: 12000, reference: 'B', dueDate: '2026-10-01' }], { today: '2026-09-17' }).ready,
    dueDate: '2026-10-01', settings: SETTINGS, now: new Date('2026-09-17T09:30:00Z')
  });
  assert.match(mitBic.xml, /<BICFI>COBADEFFXXX<\/BICFI>/);

  const alt = builder.build({
    creditor: { ...CREDITOR, bic: 'COBADEFFXXX' },
    rows: sepa.collect([{ member: member(), amount: 12000, reference: 'B', dueDate: '2026-10-01' }], { today: '2026-09-17' }).ready,
    dueDate: '2026-10-01', settings: { ...SETTINGS, painVersion: 'pain.008.001.02' }, now: new Date('2026-09-17T09:30:00Z')
  });
  assert.match(alt.xml, /<BIC>COBADEFFXXX<\/BIC>/, 'die alte Fassung nennt es anders');
});

test('Die Nachrichtenkennung enthält die Uhrzeit', () => {
  // Gegen die Doppeleinreichungskontrolle: zwei Läufe an einem Tag dürfen
  // nicht dieselbe Kennung tragen.
  const a = builder.messageId(new Date('2026-09-17T09:30:00Z'));
  const b = builder.messageId(new Date('2026-09-17T14:05:00Z'));

  assert.notEqual(a, b);
  assert.ok(a.length <= 35);
  assert.match(a, /^NESTEGG-20260917/);
});

test('Der Dateiname nennt den Fälligkeitstag', () => {
  assert.equal(buildFile().fileName, 'sepa-lastschrift-2026-10-01-0930.xml');
});

test('Die Reihenfolge der Elemente folgt dem Schema', () => {
  const xml = buildFile().xml;
  const order = ['<GrpHdr>', '<MsgId>', '<CreDtTm>', '<NbOfTxs>', '<CtrlSum>', '<InitgPty>',
    '<PmtInf>', '<PmtInfId>', '<PmtMtd>', '<BtchBookg>', '<PmtTpInf>', '<ReqdColltnDt>',
    '<Cdtr>', '<CdtrAcct>', '<CdtrAgt>', '<ChrgBr>', '<CdtrSchmeId>', '<DrctDbtTxInf>'];

  let last = -1;
  for (const tag of order) {
    const at = xml.indexOf(tag);
    assert.ok(at > last, `${tag} steht an der falschen Stelle`);
    last = at;
  }
});

test('Innerhalb einer Lastschrift ebenso', () => {
  const xml = buildFile().xml;
  const block = xml.slice(xml.indexOf('<DrctDbtTxInf>'), xml.indexOf('</DrctDbtTxInf>'));
  const order = ['<PmtId>', '<EndToEndId>', '<InstdAmt', '<DrctDbtTx>', '<MndtRltdInf>',
    '<MndtId>', '<DtOfSgntr>', '<DbtrAgt>', '<Dbtr>', '<DbtrAcct>', '<RmtInf>'];

  let last = -1;
  for (const tag of order) {
    const at = block.indexOf(tag);
    assert.ok(at > last, `${tag} steht an der falschen Stelle`);
    last = at;
  }
});

test('Die Datei ist wohlgeformtes XML mit Kopfzeile', () => {
  const xml = buildFile().xml;
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);

  // Grobprüfung auf Ausgeglichenheit: jedes geöffnete Element wird geschlossen.
  const offen = [...xml.matchAll(/<([A-Za-z]+)(?:\s[^>]*)?>/g)].map((m) => m[1]);
  const zu = [...xml.matchAll(/<\/([A-Za-z]+)>/g)].map((m) => m[1]);
  assert.deepEqual(offen.length, zu.length);
  assert.deepEqual([...offen].sort(), [...zu].sort());
});
