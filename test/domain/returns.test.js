'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const test = require('node:test');
const assert = require('node:assert/strict');

const returns = require('../../src/domain/returns');

/** Wie eine Sparkasse eine Rücklastschrift in den Auszug schreibt. */
function transaction(overrides = {}) {
  return {
    date: '2026-09-25',
    amount: -12000,
    counterparty: 'Erika Musterfrau',
    purpose: 'EREF+mg-1-2026 MREF+TVM-0001 CRED+DE98ZZZ09999999999 SVWZ+RETOURE SEPA-LASTSCHRIFT VOM 18.09.26 MS03',
    bookingText: 'SEPA-RUECKLASTSCHRIFT',
    ...overrides
  };
}

function entry(overrides = {}) {
  return {
    id: 'buch_1', type: 'income', date: '2026-01-15', paidDate: '2026-01-15',
    gross: 12000, counterparty: 'Erika Musterfrau',
    memberId: 'mg_1', duesRef: 'mg_1|2026',
    sepaRef: 'NESTEGG-20260918093000', sepaExportedAt: '2026-09-18T09:30:00.000Z',
    ...overrides
  };
}

const MEMBERS = [
  { id: 'mg_1', name: 'Erika Musterfrau', mandateRef: 'TVM-0001' },
  { id: 'mg_2', name: 'Max Mustermann', mandateRef: 'TVM-0002' }
];

/* ------------------------------------------------------------------ Gründe */

test('Alle siebzehn Rückgabegründe sind erfasst', () => {
  assert.equal(returns.RETURN_REASONS.length, 17);
  for (const code of ['AC01', 'AC04', 'AC06', 'AG01', 'AM04', 'AM05', 'BE05',
    'MD01', 'MD06', 'MD07', 'MS02', 'MS03', 'RR01', 'RR02', 'RR03', 'RR04', 'SL01']) {
    assert.ok(returns.getReason(code), `${code} fehlt`);
  }
});

test('Jeder Grund sagt, ob erneut eingezogen werden darf', () => {
  for (const reason of returns.RETURN_REASONS) {
    assert.equal(typeof reason.retry, 'boolean', `${reason.code} ohne retry`);
    assert.equal(typeof reason.mandateDead, 'boolean', `${reason.code} ohne mandateDead`);
    assert.ok(reason.hint.length > 20, `${reason.code} ohne brauchbaren Hinweis`);
  }
});

test('Nach fehlendem Mandat und Widerspruch wird nicht erneut eingezogen', () => {
  assert.equal(returns.getReason('MD01').retry, false);
  assert.equal(returns.getReason('MD01').mandateDead, true, 'das Mandat ist verbraucht');
  assert.equal(returns.getReason('MD06').retry, false, 'nach einem Widerspruch nicht einfach nochmal');
});

test('Mangels Deckung darf erneut eingezogen werden', () => {
  assert.equal(returns.getReason('MS03').retry, true);
  assert.equal(returns.getReason('AM04').retry, true);
});

/* ------------------------------------------------------------------ Verwendungszweck */

test('Der strukturierte Verwendungszweck wird zerlegt', () => {
  const fields = returns.parsePurpose(transaction().purpose);

  assert.equal(fields.EREF, 'mg-1-2026');
  assert.equal(fields.MREF, 'TVM-0001');
  assert.equal(fields.CRED, 'DE98ZZZ09999999999');
  assert.match(fields.SVWZ, /^RETOURE SEPA-LASTSCHRIFT/);
});

test('Ein Feld endet, wo das nächste beginnt', () => {
  const fields = returns.parsePurpose('EREF+ABC-1 SVWZ+Ein langer Text mit Leerzeichen MREF+M-9');
  assert.equal(fields.EREF, 'ABC-1');
  assert.equal(fields.SVWZ, 'Ein langer Text mit Leerzeichen');
  assert.equal(fields.MREF, 'M-9');
});

test('Ohne Schlüssel bleibt der Verwendungszweck leer', () => {
  assert.deepEqual(returns.parsePurpose('Nur Fließtext ohne Struktur'), {});
});

test('Der Rückgabecode wird im Text gefunden', () => {
  assert.equal(returns.findReasonCode('RETOURE ... MS03'), 'MS03');
  assert.equal(returns.findReasonCode('Rueckgabegrund: MD06 Widerspruch'), 'MD06');
  assert.equal(returns.findReasonCode('(AC04)'), 'AC04');
  assert.equal(returns.findReasonCode('ohne Code'), null);
});

test('Ein Code mitten in einem Wort zählt nicht', () => {
  // Sonst würde jede Zeichenfolge zum Rückgabegrund, in der zufällig
  // MS03 steckt.
  assert.equal(returns.findReasonCode('XMS03X'), null);
  assert.equal(returns.findReasonCode('RECHNUNGMD01'), null);
});

/* ------------------------------------------------------------------ Erkennen */

test('Eine Rücklastschrift wird erkannt', () => {
  const found = returns.detect(transaction());

  assert.ok(found);
  assert.equal(found.code, 'MS03');
  assert.equal(found.endToEndId, 'mg-1-2026');
  assert.equal(found.mandateRef, 'TVM-0001');
  assert.equal(found.amount, 12000, 'als positiver Betrag');
  assert.equal(found.confidence, 'high', 'Schlüsselwort und Code zusammen');
});

test('Eine Gutschrift ist keine Rücklastschrift', () => {
  // Zurück kommt Geld, das eingezogen wurde: das belastet das Vereinskonto.
  assert.equal(returns.detect(transaction({ amount: 12000 })), null);
});

test('Eine gewöhnliche Belastung ebenso wenig', () => {
  assert.equal(returns.detect(transaction({
    purpose: 'Miete Sporthalle September', bookingText: 'DAUERAUFTRAG'
  })), null);
});

test('Auch ohne Code wird eine Rückbuchung erkannt, nur unsicherer', () => {
  const found = returns.detect(transaction({
    purpose: 'RUECKLASTSCHRIFT Beitrag Musterfrau', bookingText: ''
  }));

  assert.ok(found);
  assert.equal(found.code, null);
  assert.equal(found.confidence, 'medium');
});

test('Umlaute und Schreibweisen der Banken werden erkannt', () => {
  for (const text of ['RÜCKLASTSCHRIFT', 'Retoure', 'RUECKBELASTUNG', 'Lastschriftrückgabe', 'NICHTEINLOESUNG']) {
    assert.ok(returns.detect(transaction({ purpose: text, bookingText: '' })), `${text} nicht erkannt`);
  }
});

/* ------------------------------------------------------------------ Zuordnen */

test('Die Referenz aus der eigenen Datei trifft eindeutig', () => {
  const hit = returns.matchEntry(returns.detect(transaction()), [entry()], MEMBERS);

  assert.ok(hit);
  assert.equal(hit.entry.id, 'buch_1');
  assert.equal(hit.by, 'reference');
  assert.equal(hit.sure, true);
});

test('Der Unterstrich der Kennung stört die Zuordnung nicht', () => {
  // In der Datei steht mg-1-2026, in der Buchung mg_1|2026.
  assert.equal(returns.toEndToEnd('mg_1|2026'), 'mg-1-2026');
});

test('Ohne Referenz hilft die Mandatsreferenz weiter', () => {
  const found = returns.detect(transaction({
    purpose: 'MREF+TVM-0002 SVWZ+RETOURE MS03'
  }));
  const hit = returns.matchEntry(found, [
    entry(),
    entry({ id: 'buch_2', memberId: 'mg_2', duesRef: 'mg_2|2026', gross: 18000 })
  ], MEMBERS);

  assert.ok(hit);
  assert.equal(hit.entry.id, 'buch_2');
  assert.equal(hit.by, 'mandate');
  assert.equal(hit.sure, false, 'ein Vorschlag, keine Gewissheit');
});

test('Bei zwei gleichen Beträgen wird nicht geraten', () => {
  const found = returns.detect(transaction({ purpose: 'RETOURE MS03' }));
  const hit = returns.matchEntry(found, [
    entry(),
    entry({ id: 'buch_2', memberId: 'mg_2', duesRef: 'mg_2|2026' })
  ], MEMBERS);

  assert.equal(hit, null, 'lieber nichts als das Falsche');
});

test('Eine nie eingezogene Forderung kommt nicht zurück', () => {
  const found = returns.detect(transaction());
  const hit = returns.matchEntry(found, [entry({ sepaRef: null, sepaExportedAt: null })], MEMBERS);

  assert.equal(hit, null);
});

/* ------------------------------------------------------------------ Folgen */

test('Der Grund entscheidet über den erneuten Einzug', () => {
  assert.equal(returns.consequences('MS03').retry, true);
  assert.equal(returns.consequences('MD01').retry, false);
  assert.equal(returns.consequences('MD01').mandateDead, true);
});

test('Ein unbekannter Grund führt nicht zum erneuten Einzug', () => {
  const folge = returns.consequences('ZZ99');

  assert.equal(folge.known, false);
  assert.equal(folge.retry, false);
  assert.match(folge.notes.join(' '), /nachfragen/i);
});

test('Bei MS03 ist die Weiterberechnung offen', () => {
  // Das deutsche Datenschutzrecht verbirgt, ob das Konto leer war oder der
  // Kontoinhaber gestorben ist. Beides kommt als MS03 an.
  const folge = returns.consequences('MS03');

  assert.equal(folge.chargeable, 'unknown');
  assert.match(folge.notes.join(' '), /Datenschutzrecht/);
});

test('Eigene Fehler gehen nicht zulasten des Mitglieds', () => {
  assert.equal(returns.consequences('AM05').chargeable, 'no', 'Doppeleinreichung');
  assert.equal(returns.consequences('BE05').chargeable, 'no', 'falsche Gläubiger-ID');
  assert.equal(returns.consequences('MD01').chargeable, 'no', 'kein gültiges Mandat');
});

test('Beim Tod des Kontoinhabers geht es nicht um Gebühren', () => {
  assert.equal(returns.consequences('MD07').chargeable, 'no');
  assert.match(returns.consequences('MD07').notes.join(' '), /nicht mitteilt|nicht mit, er kommt als MS03/);
});

/* ------------------------------------------------------------------ Buchungen */

test('Die Forderung lebt wieder auf, statt storniert zu werden', () => {
  const result = returns.toEntries({
    entry: entry(), member: MEMBERS[0], detected: returns.detect(transaction()),
    date: '2026-09-25'
  });

  assert.equal(result.reopen.paidDate, null, 'wieder offen');
  assert.equal(result.reopen.sepaRef, null, 'darf erneut in eine Datei');
  assert.equal(result.reopen.returnedAt, '2026-09-25');
  assert.equal(result.reopen.returnCode, 'MS03');
  assert.equal(result.reopen.id, 'buch_1');
});

test('Ohne Gebühr entsteht keine Gebührenbuchung', () => {
  const result = returns.toEntries({
    entry: entry(), member: MEMBERS[0], detected: returns.detect(transaction()),
    date: '2026-09-25', feeAmount: 0
  });

  assert.equal(result.fee, null);
  assert.equal(result.claim, null);
});

test('Die Gebühr der Bank wird als Ausgabe gebucht', () => {
  const result = returns.toEntries({
    entry: entry(), member: MEMBERS[0], detected: returns.detect(transaction()),
    date: '2026-09-25', feeAmount: 300, feeCategoryId: 'cl_exp_admin'
  });

  assert.equal(result.fee.type, 'expense');
  assert.equal(result.fee.amount, 300);
  assert.equal(result.fee.vatRate, 0);
  assert.equal(result.fee.paidDate, '2026-09-25', 'die Bank hat sie schon abgebucht');
  assert.equal(result.fee.sphereId, 'ideell');
  assert.match(result.fee.description, /Rücklastschriftgebühr Erika Musterfrau, MS03/);
});

test('Die Weiterberechnung ist eine offene Forderung ohne Umsatzsteuer', () => {
  const result = returns.toEntries({
    entry: entry(), member: MEMBERS[0], detected: returns.detect(transaction()),
    date: '2026-09-25', feeAmount: 300, chargeMember: true,
    feeCategoryId: 'cl_exp_admin', claimCategoryId: 'cl_inc_other'
  });

  assert.equal(result.claim.type, 'income');
  assert.equal(result.claim.amount, 300);
  assert.equal(result.claim.paidDate, null, 'eine Forderung ist noch kein Geld');
  assert.equal(result.claim.vatRate, 0, 'echter Schadensersatz ist nicht steuerbar');
  assert.equal(result.claim.memberId, 'mg_1');
  assert.match(result.claim.description, /Erstattung Rücklastschriftgebühr/);
});

/* ------------------------------------------------------------------ Grenzen */

test('Der Bearbeitungsaufwand darf nicht mitberechnet werden', () => {
  const warnungen = returns.checkClaim({
    feeAmount: 300, chargeMember: true, consequence: returns.consequences('MS03')
  });

  assert.match(warnungen.join(' '), /Xa ZR 40\/08/);
  assert.match(warnungen.join(' '), /Bearbeitungsaufwand/);
});

test('Ohne Weiterberechnung gibt es nichts zu warnen', () => {
  assert.deepEqual(returns.checkClaim({
    feeAmount: 300, chargeMember: false, consequence: returns.consequences('MS03')
  }), []);
});

test('Wo das Mitglied nichts zu vertreten hat, wird es gesagt', () => {
  const warnungen = returns.checkClaim({
    feeAmount: 300, chargeMember: true, consequence: returns.consequences('AM05')
  });

  assert.match(warnungen.join(' '), /nicht zu vertreten/);
});

/* ------------------------------------------------------------------ Im Kontoauszug */

const bank = require('../../src/domain/bankimport');
const { defaultSettings } = require('../../src/storage/store');

function statement(...rows) {
  return Buffer.from(['Buchungstag;Beguenstigter/Zahlungspflichtiger;Verwendungszweck;Buchungstext;Betrag', ...rows].join('\r\n'), 'utf8');
}

test('Eine Rücklastschrift im Kontoauszug findet ihre Forderung', () => {
  const file = statement(
    '25.09.2026;Erika Musterfrau;EREF+mg-1-2026 MREF+TVM-0001 SVWZ+RETOURE MS03;SEPA-RUECKLASTSCHRIFT;-120,00'
  );
  const { transactions } = bank.readStatement(file);

  const rows = bank.plan(transactions, {
    settings: defaultSettings(),
    entries: [entry()],
    members: MEMBERS,
    invoices: [],
    customers: []
  }, '2026-09-26');

  assert.equal(rows[0].action, 'return', 'keine gewöhnliche Ausgabe');
  assert.ok(rows[0].returned);
  assert.equal(rows[0].returned.code, 'MS03');
  assert.equal(rows[0].returnMatch.entryId, 'buch_1');
  assert.equal(rows[0].returnMatch.sure, true);
  assert.equal(rows[0].consequence.retry, true);
});

test('Eine Rücklastschrift wird nicht als Rechnungszahlung verbucht', () => {
  // Sonst wäre eine Rückbuchung plötzlich eine bezahlte Rechnung.
  const file = statement(
    '25.09.2026;Erika Musterfrau;RUECKLASTSCHRIFT Rechnung RE-2026-0042;RETOURE;-120,00'
  );
  const { transactions } = bank.readStatement(file);

  const rows = bank.plan(transactions, {
    settings: defaultSettings(),
    entries: [],
    members: [],
    invoices: [{
      id: 're1', number: 'RE-2026-0042', issueDate: '2026-09-01', documentType: 'invoice',
      status: 'sent', items: [{ quantity: 1, unitPriceNet: 10084, vatRate: 19, discountPercent: 0 }], payments: []
    }],
    customers: []
  }, '2026-09-26');

  assert.equal(rows[0].action, 'return');
  assert.equal(rows[0].match, null);
});

test('Eine gewöhnliche Ausgabe bleibt eine gewöhnliche Ausgabe', () => {
  const file = statement('25.09.2026;Stadtwerke;Strom September;LASTSCHRIFT;-89,00');
  const { transactions } = bank.readStatement(file);

  const rows = bank.plan(transactions, {
    settings: defaultSettings(), entries: [], members: [], invoices: [], customers: []
  }, '2026-09-26');

  assert.equal(rows[0].action, 'entry');
  assert.equal(rows[0].returned, null);
});

test('Die Gebührenzeile ist nicht die Rücklastschrift selbst', () => {
  // Die Bank bucht das Entgelt als eigene Zeile, und darin steht ebenfalls
  // "Rückgabe". Ihr eine Forderung zuordnen zu wollen führt in die Irre.
  const gebuehr = returns.detect({
    amount: -300, counterparty: 'Stadtsparkasse',
    purpose: 'Entgelt Rueckgabe Lastschrift', bookingText: 'ENTGELTABSCHLUSS'
  });
  assert.equal(gebuehr, null);
});

test('Mit Referenz oder Code bleibt es die Rücklastschrift, auch mit Gebührenwort', () => {
  // Manche Banken schreiben beides in eine Zeile.
  const zusammen = returns.detect({
    amount: -12300, counterparty: 'Erika Musterfrau',
    purpose: 'EREF+mg-1-2026 SVWZ+RUECKLASTSCHRIFT INKL ENTGELT', bookingText: 'RETOURE'
  });
  assert.ok(zusammen);
  assert.equal(zusammen.endToEndId, 'mg-1-2026');

  const mitCode = returns.detect({
    amount: -300, counterparty: 'Bank',
    purpose: 'Entgelt Rueckgabe MS03', bookingText: ''
  });
  assert.ok(mitCode, 'der Code ist das stärkere Signal');
});

test('Die Gebühr wird auf das Gebührenkonto vorbelegt', () => {
  const file = statement(
    '25.09.2026;Erika Musterfrau;EREF+mg-1-2026 SVWZ+RETOURE MS03;SEPA-RUECKLASTSCHRIFT;-120,00'
  );
  const { transactions } = bank.readStatement(file);
  const settings = defaultSettings();
  settings.entity = { ...settings.entity, kind: 'club' };

  const rows = bank.plan(transactions, {
    settings, entries: [entry()], members: MEMBERS, invoices: [], customers: []
  }, '2026-09-26');

  assert.equal(rows[0].draft.feeCategoryId, 'cl_exp_bank');
  assert.equal(rows[0].draft.chargeMember, false, 'nie voreingestellt');
  assert.equal(rows[0].draft.feeAmount, 0);
});

/* ------------------------------------------------------------------ Der ganze Weg */

test('Von der Auszugszeile bis zu den drei Buchungen', () => {
  const file = statement(
    '25.09.2026;Erika Musterfrau;EREF+mg-1-2026 MREF+TVM-0001 SVWZ+RETOURE MS03;SEPA-RUECKLASTSCHRIFT;-120,00'
  );
  const { transactions } = bank.readStatement(file);
  const forderung = entry();

  const row = bank.plan(transactions, {
    settings: defaultSettings(), entries: [forderung], members: MEMBERS, invoices: [], customers: []
  }, '2026-09-26')[0];

  const result = returns.toEntries({
    entry: forderung,
    member: MEMBERS[0],
    detected: row.returned,
    date: row.date,
    feeAmount: 300,
    chargeMember: true,
    feeCategoryId: 'cl_exp_bank',
    claimCategoryId: 'cl_inc_other',
    sphereId: 'ideell'
  });

  // Die Forderung lebt wieder auf und darf erneut eingezogen werden.
  assert.equal(result.reopen.paidDate, null);
  assert.equal(result.reopen.sepaRef, null);
  assert.equal(result.reopen.returnCode, 'MS03');

  // Die Gebühr ist gezahlt, die Weiterberechnung noch offen.
  assert.equal(result.fee.paidDate, '2026-09-25');
  assert.equal(result.claim.paidDate, null);

  // Beide ohne Umsatzsteuer, beide am selben Mitglied.
  assert.equal(result.fee.vatRate, 0);
  assert.equal(result.claim.vatRate, 0);
  assert.equal(result.fee.memberId, 'mg_1');
  assert.equal(result.claim.memberId, 'mg_1');

  // Unter dem Strich kostet die Rückgabe den Verein nichts, wenn das Mitglied
  // zahlt: drei Euro raus, drei Euro Forderung.
  assert.equal(result.claim.amount, result.fee.amount);
});
