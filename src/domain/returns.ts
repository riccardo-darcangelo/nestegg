// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import type { Cents, Entry, Id, IsoDate, SphereId } from '../shared/types';

/**
 * Returned direct debits.
 *
 * A collection that bounces is more than a booking: the claim comes back to
 * life, the bank charges a fee, and depending on the reason the mandate may
 * be spent for good. So this module answers three questions: what came back,
 * why, and what follows from it.
 *
 * All amounts in cents.
 */

export type Fault = 'debtor' | 'creditor' | 'none' | 'unknown';

export interface ReturnReason {
  code: string;
  label: string;
  hint: string;
  /** Whether collecting again from the same mandate is allowed and sensible. */
  retry: boolean;
  /** Whether the mandate is spent and a new one is needed. */
  mandateDead: boolean;
  /** Who is answerable, which decides whether the fee may be passed on. */
  fault: Fault;
  /** German banks replace this code before passing it to the creditor. */
  privacyMappedTo?: string;
}

export const RETURN_REASONS: ReturnReason[] = [
  {
    code: 'AC01', label: 'IBAN fehlerhaft',
    hint: 'Die Kontonummer stimmt nicht. Vor dem nächsten Einzug die IBAN am Mitglied berichtigen.',
    retry: false, mandateDead: false, fault: 'unknown'
  },
  {
    code: 'AC04', label: 'Konto erloschen',
    hint: 'Das Konto gibt es nicht mehr. Ohne neue Bankverbindung und neues Mandat geht kein weiterer Einzug.',
    retry: false, mandateDead: true, fault: 'debtor'
  },
  {
    code: 'AC06', label: 'Konto gesperrt',
    hint: 'Das Konto ist gesperrt. Warum, sagt die Bank nicht. Vor einem erneuten Einzug beim Mitglied nachfragen.',
    retry: false, mandateDead: false, fault: 'unknown'
  },
  {
    code: 'AG01', label: 'Lastschrift auf diesem Konto unzulässig',
    hint: 'Von diesem Konto darf nicht eingezogen werden, etwa bei einem Sparkonto. Es braucht eine andere Bankverbindung.',
    retry: false, mandateDead: true, fault: 'debtor'
  },
  {
    // Listed although German banks never pass it on: it still shows up in
    // some bank statements, and the list would be incomplete without it.
    code: 'AM04', label: 'Keine Deckung',
    hint: 'Das Konto war nicht gedeckt. Ein erneuter Einzug ist möglich, am besten nach Rücksprache.',
    retry: true, mandateDead: false, fault: 'debtor',
    privacyMappedTo: 'MS03'
  },
  {
    code: 'AM05', label: 'Doppeleinreichung',
    hint: 'Dieselbe Lastschrift wurde zweimal eingereicht. Das ist ein Fehler auf unserer Seite, die Gebühr bleibt beim Verein.',
    retry: false, mandateDead: false, fault: 'creditor'
  },
  {
    code: 'BE05', label: 'Gläubiger-Identifikationsnummer ungültig',
    hint: 'Die Gläubiger-ID stimmt nicht. Sie gehört geprüft, bevor der nächste Einzug läuft, sonst kommt alles zurück.',
    retry: false, mandateDead: false, fault: 'creditor'
  },
  {
    code: 'MD01', label: 'Kein gültiges Mandat',
    hint: 'Für diesen Einzug liegt kein gültiges Mandat vor. Aus diesem Mandat darf nicht weiter eingezogen werden, es braucht ein neues.',
    retry: false, mandateDead: true, fault: 'creditor'
  },
  {
    code: 'MD06', label: 'Widerspruch des Zahlungspflichtigen',
    hint: 'Das Mitglied hat der Belastung widersprochen. Das ist bei der Basislastschrift acht Wochen lang ohne Begründung möglich. Die Forderung besteht weiter, einziehen lässt sie sich so aber nicht.',
    retry: false, mandateDead: false, fault: 'debtor'
  },
  {
    code: 'MD07', label: 'Kontoinhaber verstorben',
    hint: 'Der Kontoinhaber ist verstorben. Hier geht es nicht um Gebühren, sondern um die Mitgliedschaft.',
    retry: false, mandateDead: true, fault: 'none',
    privacyMappedTo: 'MS03'
  },
  {
    code: 'MS02', label: 'Rückgabe durch den Zahlungspflichtigen, ohne Angabe',
    hint: 'Das Mitglied hat die Rückgabe veranlasst, ohne einen Grund zu nennen. Nachfragen, bevor erneut eingezogen wird.',
    retry: false, mandateDead: false, fault: 'debtor'
  },
  {
    code: 'MS03', label: 'Rückgabe durch die Bank, ohne Angabe',
    hint: 'Der häufigste Fall. Dahinter steckt meist fehlende Deckung, aber ebenso ein gesperrtes Konto oder ein Todesfall: das deutsche Datenschutzrecht verbietet der Bank, es zu sagen. Ein erneuter Einzug ist möglich, die Gebühr weiterzuberechnen aber nur, wenn das Mitglied die Rückgabe zu vertreten hat.',
    retry: true, mandateDead: false, fault: 'unknown'
  },
  {
    code: 'RR01', label: 'Aufsichtsrechtlich: Konto oder Kennung des Zahlers fehlt',
    hint: 'Aufsichtsrechtliche Gründe. Der Einzug ist so nicht durchführbar.',
    retry: false, mandateDead: false, fault: 'unknown'
  },
  {
    code: 'RR02', label: 'Aufsichtsrechtlich: Name oder Anschrift des Zahlers fehlt',
    hint: 'Aufsichtsrechtliche Gründe. Der Einzug ist so nicht durchführbar.',
    retry: false, mandateDead: false, fault: 'unknown'
  },
  {
    code: 'RR03', label: 'Aufsichtsrechtlich: Name oder Anschrift des Gläubigers fehlt',
    hint: 'Die Angaben des Vereins in der Datei reichen der Bank nicht. Das ist auf unserer Seite zu klären.',
    retry: false, mandateDead: false, fault: 'creditor'
  },
  {
    code: 'RR04', label: 'Aufsichtsrechtliche Gründe',
    hint: 'Aufsichtsrechtliche Gründe. Der Einzug ist so nicht durchführbar.',
    retry: false, mandateDead: false, fault: 'unknown',
    privacyMappedTo: 'MS03'
  },
  {
    code: 'SL01', label: 'Besonderer Dienst der Zahlstelle',
    hint: 'Die Bank des Mitglieds führt eine eigene Mandatsverwaltung, etwa eine Sperrliste, und hat den Einzug deshalb abgelehnt.',
    retry: false, mandateDead: false, fault: 'debtor'
  }
];

/**
 * What German banks do not disclose.
 *
 * Three reasons are replaced by MS03 before reaching the creditor, and MD02
 * by MD01 because MD02 is not permitted in the XML at all. Reading the code
 * to learn whether the debtor is answerable therefore leads nowhere: that is
 * precisely what MS03 leaves out.
 */
export const PRIVACY_REPLACED = ['AM04', 'MD07', 'RR04'];

/** Words that give away a returned debit in a bank statement. */
export const KEYWORDS = [
  'ruecklastschrift', 'rucklastschrift', 'retoure', 'rueckbelastung',
  'rueckgabe', 'lastschriftrueckgabe', 'ruecklastschr', 'returned',
  'sepa retoure', 'nichteinloesung', 'unbezahlt'
];

/**
 * Words that mark a fee line.
 *
 * Banks often book the charge for a return as a line of its own, and it
 * carries the same words. That line is the fee, not the returned debit, and
 * trying to match it to a claim leads astray. The difference is that a return
 * always comes with a reference or a reason code, and a fee line never does.
 */
const FEE_WORDS = ['entgelt', 'gebuehr', 'provision', 'kosten', 'abschluss'];

/**
 * The keys banks use to structure a payment reference, standardised by the
 * German banking industry. EREF is the reference this app wrote into the
 * direct debit file, which is how a return finds its claim again without
 * anyone comparing names.
 */
export const SEPA_KEYS = ['EREF', 'KREF', 'MREF', 'CRED', 'SVWZ', 'ABWA', 'ABWE', 'COAM', 'OAMT', 'DEBT'];

export function getReason(code: string | null | undefined): ReturnReason | null {
  const wanted = String(code ?? '').toUpperCase();
  return RETURN_REASONS.find((reason) => reason.code === wanted) ?? null;
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Splits a structured payment reference.
 *
 * "EREF+mg-1-2026 MREF+TVM-0001 CRED+DE98ZZZ... SVWZ+RETOURE..." becomes an
 * object of fields. Without these keys only free text remains, and then the
 * search falls back to patterns.
 */
export function parsePurpose(purpose: string | null | undefined): Record<string, string> {
  const text = String(purpose ?? '');
  const found: Record<string, string> = {};

  // Keys appear as KEY+ in the text, and a field runs until the next one
  // starts, so the split happens on the list of all known keys.
  const marks = [...text.matchAll(new RegExp(`\\b(${SEPA_KEYS.join('|')})\\+`, 'g'))];

  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index]!;
    const from = mark.index! + mark[0].length;
    const to = index + 1 < marks.length ? marks[index + 1]!.index! : text.length;
    found[mark[1]!] = text.slice(from, to).trim();
  }

  return found;
}

/**
 * Only the known codes count, so that not every four letter sequence passes
 * as a reason.
 */
export function findReasonCode(text: string | null | undefined): string | null {
  const upper = String(text ?? '').toUpperCase();

  for (const reason of RETURN_REASONS) {
    if (new RegExp(`(^|[^A-Z0-9])${reason.code}([^A-Z0-9]|$)`).test(upper)) return reason.code;
  }

  return null;
}

export interface BankTransaction {
  amount: Cents;
  purpose?: string;
  bookingText?: string;
  counterparty?: string;
}

export interface DetectedReturn {
  code: string | null;
  reason: ReturnReason | null;
  endToEndId: string | null;
  mandateRef: string | null;
  creditorId: string | null;
  text: string;
  amount: Cents;
  /** High only when keyword and code agree. */
  confidence: 'high' | 'medium';
}

/**
 * A credit can never be the return of a direct debit: what comes back is
 * money that was collected, and that debits the account.
 */
export function detect(transaction: BankTransaction | null | undefined): DetectedReturn | null {
  if (!transaction || transaction.amount >= 0) return null;

  const haystack = normalize(`${transaction.purpose} ${transaction.bookingText} ${transaction.counterparty}`);
  const code = findReasonCode(`${transaction.purpose} ${transaction.bookingText}`);
  const byKeyword = KEYWORDS.some((word) => haystack.includes(normalize(word)));

  if (!byKeyword && !code) return null;

  const fields = parsePurpose(transaction.purpose);
  const hasReference = Boolean(fields.EREF || fields.MREF);

  // The fee for a return carries the same words but neither a reference nor a
  // code. It stays an ordinary expense.
  if (!hasReference && !code && FEE_WORDS.some((word) => haystack.includes(word))) return null;

  return {
    code,
    reason: code ? getReason(code) : null,
    endToEndId: fields.EREF ?? null,
    mandateRef: fields.MREF ?? null,
    creditorId: fields.CRED ?? null,
    text: fields.SVWZ ?? String(transaction.purpose ?? ''),
    amount: Math.abs(transaction.amount),
    confidence: byKeyword && code ? 'high' : 'medium'
  };
}

/** The same transformation as when writing the file: separators to hyphens. */
export function toEndToEnd(duesRef: string | null | undefined): string {
  return String(duesRef ?? '').replace(/[|_]/g, '-');
}

export interface MemberLike {
  id: Id;
  name?: string;
  mandateRef?: string;
}

export interface EntryMatch {
  entry: Entry;
  by: 'reference' | 'mandate' | 'amount';
  /** Only a reference match is certain, the rest are suggestions. */
  sure: boolean;
  member?: MemberLike;
}

function matchByMandate(
  detected: DetectedReturn,
  candidates: readonly Entry[],
  members: readonly MemberLike[] | null | undefined
): EntryMatch | null {
  const member = (members ?? []).find(
    (item) => normalize(item.mandateRef) === normalize(detected.mandateRef)
  );
  if (!member) return null;

  const ofMember = candidates.filter((entry) => entry.memberId === member.id);
  const exact = ofMember.filter((entry) => entry.gross === detected.amount);

  // Only one claim of this member matching the amount is usable. With two it
  // would be a guess.
  if (exact.length === 1) return { entry: exact[0]!, by: 'mandate', sure: false, member };
  if (ofMember.length === 1) return { entry: ofMember[0]!, by: 'mandate', sure: false, member };

  return null;
}

/**
 * Matches a detected return to its claim: first by the reference this app
 * wrote into the file, then by the member's mandate, last by amount alone.
 */
export function matchEntry(
  detected: DetectedReturn,
  entries: readonly Entry[] | null | undefined,
  members: readonly MemberLike[] | null | undefined
): EntryMatch | null {
  const candidates = (entries ?? []).filter((entry) => entry.sepaRef && entry.duesRef);
  if (!candidates.length) return null;

  if (detected.endToEndId) {
    const wanted = normalize(detected.endToEndId);
    const hit = candidates.find((entry) => normalize(toEndToEnd(entry.duesRef)) === wanted);
    if (hit) return { entry: hit, by: 'reference', sure: true };
  }

  if (detected.mandateRef) {
    const byMandate = matchByMandate(detected, candidates, members);
    if (byMandate) return byMandate;
  }

  const byAmount = candidates.filter((entry) => entry.gross === detected.amount);
  if (byAmount.length === 1) return { entry: byAmount[0]!, by: 'amount', sure: false };

  return null;
}

export interface Consequence {
  code: string | null;
  known: boolean;
  label?: string;
  retry: boolean;
  mandateDead: boolean;
  fault: Fault;
  /** Whether the fee may be passed on to the member. */
  chargeable: 'yes' | 'no' | 'unknown';
  notes: string[];
}

/**
 * The claim always comes back to life. Whether it may be collected again and
 * whether the fee can be passed on depends on the reason, and for the most
 * common one nobody knows: MS03 does not say whether the account was empty or
 * the holder had died.
 */
export function consequences(code: string | null | undefined): Consequence {
  const reason = getReason(code);

  if (!reason) {
    return {
      code: code ?? null,
      known: false,
      retry: false,
      mandateDead: false,
      fault: 'unknown',
      chargeable: 'unknown',
      notes: ['Der Rückgabegrund ist nicht bekannt. Vor einem erneuten Einzug beim Mitglied oder bei der Bank nachfragen.']
    };
  }

  const notes = [reason.hint];
  if (reason.mandateDead) {
    notes.push('Das Mandat ist damit verbraucht. Ein neues ist einzuholen, bevor wieder eingezogen wird.');
  }
  if (PRIVACY_REPLACED.includes(reason.code)) {
    notes.push('Diesen Grund teilt die Bank dem Gläubiger in Deutschland nicht mit, er kommt als MS03 an.');
  }

  return {
    code: reason.code,
    known: true,
    label: reason.label,
    retry: reason.retry,
    mandateDead: reason.mandateDead,
    fault: reason.fault,
    // Passing the fee on requires the member to be answerable (BGB 280 (1)).
    // With MS03 that is exactly what cannot be told, so it stays a decision
    // of the board rather than a default of the app.
    chargeable: reason.fault === 'debtor' ? 'yes' : (reason.fault === 'unknown' ? 'unknown' : 'no'),
    notes
  };
}

export interface ToEntriesInput {
  entry?: Entry | null;
  member?: MemberLike | null;
  detected?: DetectedReturn | null;
  date: IsoDate;
  feeAmount?: Cents;
  chargeMember?: boolean;
  feeCategoryId?: string | null;
  claimCategoryId?: string | null;
  sphereId?: SphereId;
}

/**
 * The bookings a return produces. Three of them, of which only the first
 * always applies:
 *
 * 1. The collected claim becomes open again. It is not cancelled and not
 *    deleted: the claim still exists, only the money is gone, and deleting
 *    would erase the trace of the collection too.
 * 2. The bank fee as an expense.
 * 3. Passing that fee on to the member, when they are answerable. That is
 *    damages under BGB 280 (1) and therefore carries no VAT: without an
 *    exchange of services it is out of scope (UStAE 1.3).
 */
export function toEntries(input: ToEntriesInput) {
  const {
    entry, member, detected, date, feeAmount = 0, chargeMember = false,
    feeCategoryId, claimCategoryId, sphereId = 'ideell'
  } = input;

  const name = member?.name ?? entry?.counterparty ?? '';
  const reason = detected?.code ? getReason(detected.code) : null;
  const reasonText = reason ? `${reason.code}, ${reason.label}` : 'ohne Angabe des Grundes';

  const result: {
    reopen: Record<string, unknown> | null;
    fee: Record<string, unknown> | null;
    claim: Record<string, unknown> | null;
  } = { reopen: null, fee: null, claim: null };

  if (entry) {
    result.reopen = {
      id: entry.id,
      paidDate: null,
      // The collection failed, so the claim may enter a new file. Whether
      // that is wise is what `retry` says.
      sepaRef: null,
      sepaExportedAt: null,
      returnedAt: date,
      returnCode: detected?.code ?? null
    };
  }

  if (feeAmount > 0) {
    result.fee = {
      type: 'expense',
      date,
      paidDate: date,
      amount: feeAmount,
      vatRate: 0,
      categoryId: feeCategoryId ?? null,
      sphereId,
      description: `Rücklastschriftgebühr ${name}, ${reasonText}`,
      counterparty: 'Bank',
      memberId: member?.id ?? null
    };
  }

  if (chargeMember && feeAmount > 0) {
    result.claim = {
      type: 'income',
      date,
      // Open until the member pays. A claim is not money yet.
      paidDate: null,
      amount: feeAmount,
      vatRate: 0,
      categoryId: claimCategoryId ?? null,
      sphereId,
      description: `Erstattung Rücklastschriftgebühr ${name}, ${reasonText}`,
      counterparty: name,
      memberId: member?.id ?? null
    };
  }

  return result;
}

/**
 * What stands in the way of passing the fee on.
 *
 * The Federal Court of Justice (17 September 2009, Xa ZR 40/08) allows only
 * the actual loss. Own handling effort is expressly not part of it, so a flat
 * fee that includes it is void.
 */
export function checkClaim(input: {
  feeAmount: Cents;
  chargeMember: boolean;
  consequence: Consequence;
}): string[] {
  const { feeAmount, chargeMember, consequence } = input;
  if (!chargeMember) return [];

  const warnings: string[] = [];

  if (consequence.chargeable === 'no') {
    warnings.push(`Bei ${consequence.code} hat das Mitglied die Rückgabe nicht zu vertreten. Eine Weiterberechnung ist dann nicht begründet.`);
  } else if (consequence.chargeable === 'unknown') {
    warnings.push('Der Grund lässt nicht erkennen, ob das Mitglied die Rückgabe zu vertreten hat. Weiterberechnet werden darf nur, wenn es das tut.');
  }

  if (feeAmount > 0) {
    warnings.push('Weitergegeben werden darf nur die tatsächliche Gebühr der Bank. Eigener Bearbeitungsaufwand gehört nicht dazu, eine Pauschale mit Bearbeitungsanteil ist unwirksam (BGH, Xa ZR 40/08).');
  }

  return warnings;
}
