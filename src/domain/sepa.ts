// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import type { Cents, Id, IsoDate } from '../shared/types';

/**
 * SEPA direct debit: checks, deadlines and character set.
 *
 * Everything that makes a debit valid or invalid, but no XML yet. That is
 * built by `export/sepa` from what was checked here.
 *
 * The app collects nothing. It writes a file the user uploads to their online
 * banking, so the job of this module is to prevent a file the bank rejects
 * later: a wrong check digit, a missing mandate or a due date that falls too
 * early or too late costs a day and a phone call.
 *
 * All amounts in cents.
 */

export type SchemeId = 'CORE' | 'B2B';
export type SequenceTypeId = 'RCUR' | 'FRST' | 'OOFF' | 'FNAL';
export type PainVersionId = 'pain.008.001.08' | 'pain.008.001.02';

export interface Scheme {
  id: SchemeId;
  label: string;
  hint: string;
  leadDaysFirst: number;
  leadDaysRecurrent: number;
}

/**
 * The debit schemes.
 *
 * For membership dues CORE is always the right one: the business scheme
 * requires the payer not to be a consumer, and a club member is one.
 */
export const SCHEMES: Scheme[] = [
  {
    id: 'CORE',
    label: 'Basislastschrift',
    hint: 'für Verbraucher, acht Wochen Erstattungsrecht',
    leadDaysFirst: 1,
    leadDaysRecurrent: 1
  },
  {
    id: 'B2B',
    label: 'Firmenlastschrift',
    hint: 'nur zwischen Unternehmen, kein Erstattungsrecht',
    leadDaysFirst: 1,
    leadDaysRecurrent: 1
  }
];

/**
 * Sequence types.
 *
 * Since the rulebook change of November 2016 marking the first debit is no
 * longer mandatory under CORE, and the deadlines are the same for all types.
 * Hence RCUR is the default: one type throughout saves bookkeeping about which
 * mandate has already been used, and that is what most runs stumble over.
 */
export const SEQUENCE_TYPES: { id: SequenceTypeId; label: string; hint: string }[] = [
  { id: 'RCUR', label: 'Folgelastschrift', hint: 'seit 2016 auch für den ersten Einzug zulässig' },
  { id: 'FRST', label: 'Erstlastschrift', hint: 'nur nötig, wenn die Bank es ausdrücklich verlangt' },
  { id: 'OOFF', label: 'Einmallastschrift', hint: 'das Mandat ist danach verbraucht' },
  { id: 'FNAL', label: 'Letztmalige Lastschrift', hint: 'der letzte Einzug aus diesem Mandat' }
];

export interface PainVersion {
  id: PainVersionId;
  label: string;
  hint: string;
  namespace: string;
  /** The element name for the bank identifier, which the 2019 schema renamed. */
  bicTag: 'BICFI' | 'BIC';
}

/**
 * The message formats.
 *
 * pain.008.001.02 has been in force since SEPA started. It is switched off on
 * 14 November 2026, after which banks only accept the ISO 20022 version of
 * 2019. So pain.008.001.08 is the default and the older one only the escape
 * hatch for a bank that has not migrated by then.
 */
export const PAIN_VERSIONS: PainVersion[] = [
  {
    id: 'pain.008.001.08',
    label: 'pain.008.001.08',
    hint: 'ISO 20022 (2019), ab 14.11.2026 die einzige zulässige Fassung',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08',
    bicTag: 'BICFI'
  },
  {
    id: 'pain.008.001.02',
    label: 'pain.008.001.02',
    hint: 'die alte Fassung, wird zum 14.11.2026 abgeschaltet',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.02',
    bicTag: 'BIC'
  }
];

/** From this day on banks only accept pain.008.001.08. */
export const PAIN_CUTOVER: IsoDate = '2026-11-14';

export interface SepaSettings {
  creditorId: string;
  creditorName: string;
  scheme: SchemeId;
  sequenceType: SequenceTypeId;
  painVersion: PainVersionId;
  /** Calendar days the pre-notification has to reach the payer beforehand. */
  preNotificationDays: number;
  /** One booking for the whole file instead of one per debit. */
  batchBooking: boolean;
}

export const DEFAULT_SETTINGS: SepaSettings = {
  creditorId: '',
  creditorName: '',
  scheme: 'CORE',
  sequenceType: 'RCUR',
  painVersion: 'pain.008.001.08',
  // Fourteen calendar days is the deadline that applies without an agreement
  // of its own. Clubs often shorten it to five in their bylaws, so it is
  // configurable.
  preNotificationDays: 14,
  // Batch booking keeps the bank statement tidy for a club, but makes matching
  // the individual dues harder.
  batchBooking: true
};

/** The ceiling a single direct debit must not exceed. */
export const MAX_AMOUNT: Cents = 99999999999;

/** A mandate expires once it has gone unused for 36 months. */
export const MANDATE_EXPIRY_MONTHS = 36;

/* Check digits */

/**
 * Modulo 97 over a long digit string.
 *
 * Computed piecewise because the number would otherwise exceed the precision
 * of Number: an IBAN becomes up to 36 digits, a creditor id even more.
 */
export function mod97(digits: string | number): number {
  let rest = 0;
  for (const ch of String(digits)) {
    const value = Number(ch);
    if (!Number.isFinite(value)) return NaN;
    rest = (rest * 10 + value) % 97;
  }
  return rest;
}

/** Letters to numbers, A = 10 through Z = 35. */
export function toDigits(text: string): string {
  return String(text).toUpperCase().replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
}

/** Spaces out, upper case in. */
export function normalizeIban(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

/**
 * IBAN length per country of the SEPA area.
 *
 * The list doubles as the country check: a debit can only be collected within
 * SEPA, so a country code outside it is always a typo. Letting it through
 * would mean getting it back from the bank instead.
 */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28,
  IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31,
  NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  VA: 22
};

/** Checks an IBAN by shape, country length and check digit. */
export function validIban(value: string | null | undefined): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (!expected || iban.length !== expected) return false;

  return mod97(toDigits(iban.slice(4) + iban.slice(0, 4))) === 1;
}

export interface CreditorIdParts {
  id: string;
  country: string;
  checkDigits: string;
  businessCode: string;
  national: string;
}

/**
 * Splits a creditor identifier.
 *
 * German layout: DE, two check digits, three characters of business code (ZZZ
 * unless something else was applied for) and eleven characters of national id.
 */
export function creditorIdParts(value: string | null | undefined): CreditorIdParts | null {
  const id = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  if (id.length < 8) return null;

  return {
    id,
    country: id.slice(0, 2),
    checkDigits: id.slice(2, 4),
    businessCode: id.slice(4, 7),
    national: id.slice(7)
  };
}

/**
 * Checks the creditor identifier.
 *
 * The business code in positions five to seven is explicitly left out of the
 * check digit calculation. Including it declares every valid identifier wrong
 * as soon as it is not ZZZ.
 */
export function validCreditorId(value: string | null | undefined): boolean {
  const parts = creditorIdParts(value);
  if (!parts) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(parts.id)) return false;

  return mod97(toDigits(parts.national + parts.country + parts.checkDigits)) === 1;
}

/** The creditor id in groups of four, for display only. */
export function formatCreditorId(value: string | null | undefined): string {
  const parts = creditorIdParts(value);
  if (!parts) return String(value ?? '');
  return parts.id.replace(/(.{4})/g, '$1 ').trim();
}

/* Character set */

/**
 * Replacements for characters the SEPA character set does not carry.
 *
 * Module level so it is not rebuilt on every call: a dues run passes several
 * hundred strings through here.
 */
const TRANSLITERATIONS: Record<string, string> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss',
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'å': 'a', 'æ': 'ae',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ø': 'o',
  'ù': 'u', 'ú': 'u', 'û': 'u',
  'ç': 'c', 'ñ': 'n', 'ý': 'y',
  'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'Å': 'A', 'Æ': 'Ae',
  'È': 'E', 'É': 'E', 'Ê': 'E', 'Ë': 'E',
  'Ì': 'I', 'Í': 'I', 'Î': 'I', 'Ï': 'I',
  'Ò': 'O', 'Ó': 'O', 'Ô': 'O', 'Õ': 'O', 'Ø': 'O',
  'Ù': 'U', 'Ú': 'U', 'Û': 'U',
  'Ç': 'C', 'Ñ': 'N', 'Ý': 'Y',
  '&': 'und', '"': "'", '„': "'", '“': "'", '”': "'", '’': "'", '‘': "'",
  '–': '-', '—': '-', '€': 'EUR', '§': 'Par.'
};

/** Everything outside ASCII, plus the two ASCII characters SEPA forbids. */
const NEEDS_TRANSLITERATION = /[^\x00-\x7F]|["&]/g;

/** What survives after transliteration. */
const OUTSIDE_SEPA_CHARSET = /[^A-Za-z0-9/?:().,'+\- ]/g;

/**
 * Maps a text onto the SEPA character set.
 *
 * The German rulebook now allows umlauts and ß, the EPC rulebook does not. It
 * is mapped anyway, because every bank accepts a file saying "Mueller" and not
 * every bank one saying "Müller". Whatever remains outside the allowed set
 * becomes a space, since a lost character beats a rejected file.
 */
export function sepaText(value: unknown, maxLength = 0): string {
  // The underscore is not in the allowed set but sits in every id this app
  // generates. A hyphen keeps the reference readable, a space would tear it
  // apart.
  let text = String(value ?? '').replace(/_/g, '-');

  text = text.replace(NEEDS_TRANSLITERATION, (ch) => TRANSLITERATIONS[ch] ?? ' ');
  text = text.replace(OUTSIDE_SEPA_CHARSET, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

/* Calendar */

export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (Number(days) || 0));
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86400000);
}

function monthsBetween(from: IsoDate, to: IsoDate): number {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/**
 * Easter Sunday by the Meeus/Jones/Butcher algorithm.
 *
 * Needed because Good Friday and Easter Monday are TARGET holidays and thus
 * shift the lead time. Without it every debit in spring lands just beside.
 */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The holidays of the TARGET system.
 *
 * Only six, and they are the same across Europe: on them the payment system
 * settles nothing, no matter which region has a holiday. The third of October
 * is therefore a banking day.
 */
export function targetHolidays(year: number): IsoDate[] {
  const easter = easterSunday(year);
  return [
    `${year}-01-01`,
    addDays(easter, -2),
    addDays(easter, 1),
    `${year}-05-01`,
    `${year}-12-25`,
    `${year}-12-26`
  ];
}

export function isTargetBusinessDay(iso: IsoDate): boolean {
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !targetHolidays(Number(iso.slice(0, 4))).includes(iso);
}

/** Moves a date onto the next TARGET business day. */
export function nextTargetBusinessDay(iso: IsoDate): IsoDate {
  let date = iso;
  let guard = 0;
  while (!isTargetBusinessDay(date) && guard < 30) {
    date = addDays(date, 1);
    guard += 1;
  }
  return date;
}

/** Counts TARGET business days forward. */
export function addTargetBusinessDays(iso: IsoDate, count: number): IsoDate {
  let date = iso;
  let left = Number(count) || 0;
  let guard = 0;
  while (left > 0 && guard < 120) {
    date = nextTargetBusinessDay(addDays(date, 1));
    left -= 1;
    guard += 1;
  }
  return date;
}

/**
 * The earliest due date for a file submitted today.
 *
 * The Bundesbank requires at least one TARGET business day of lead time in the
 * first submission window and two in the second. One is the default, and
 * whoever submits in the afternoon has the buffer the interface recommends
 * anyway.
 */
export function earliestCollectionDate(submissionDate: IsoDate, leadDays = 1): IsoDate {
  return addTargetBusinessDays(submissionDate, Math.max(1, Number(leadDays) || 1));
}

/** The latest: more than 14 calendar days of lead time and the bank refuses. */
export function latestCollectionDate(submissionDate: IsoDate): IsoDate {
  return addDays(submissionDate, 14);
}

/* Mandate */

/** What a debit needs to know about the payer. */
export interface MandateHolder {
  id?: Id | null;
  name?: string;
  iban?: string;
  mandateRef?: string;
  mandateDate?: IsoDate | null;
  /** Last known collection from this mandate, which resets the expiry clock. */
  mandateUsedAt?: IsoDate | null;
}

export interface MandateCheck {
  /** What makes the debit impossible. */
  problems: string[];
  /** What is worth saying but does not stop it. */
  notes: string[];
}

/**
 * Checks a mandate against a due date.
 *
 * Split into problems and notes: whoever cannot collect a debit wants to know
 * why, and often it is just a missing date.
 */
export function checkMandate(
  member: MandateHolder,
  dueDate?: IsoDate | null,
  today?: IsoDate | null,
  lastUsed?: IsoDate | null
): MandateCheck {
  const problems: string[] = [];
  const notes: string[] = [];

  if (!member.iban) problems.push('Es ist keine IBAN hinterlegt.');
  else if (!validIban(member.iban)) problems.push('Die IBAN ist nicht gültig, die Prüfziffer stimmt nicht.');

  if (!member.mandateRef) problems.push('Die Mandatsreferenz fehlt.');
  if (!member.mandateDate) problems.push('Das Datum des Mandats fehlt.');

  if (member.mandateDate && dueDate && member.mandateDate > dueDate) {
    problems.push('Das Mandat ist später unterschrieben als der Einzug fällig wird.');
  }

  // A mandate nothing was collected from for 36 months expires and has to be
  // granted again. That stays a note, not a block.
  //
  // Reported only when a last collection is known and too long ago. Without
  // that knowledge an old mandate date says nothing: one from 2012 that dues
  // have been running off for years is perfectly fine. Writing the note onto
  // every row would be noise, and noise nobody reads after the third time.
  const seen = lastUsed ?? member.mandateUsedAt;
  if (seen && today && monthsBetween(seen, today) > MANDATE_EXPIRY_MONTHS) {
    notes.push(`Der letzte bekannte Einzug war am ${seen}. Nach 36 Monaten ohne Einzug verfällt das Mandat.`);
  }

  return { problems, notes };
}

/* Assembling a run */

/**
 * A reference that survives the SEPA character set.
 *
 * The id of a dues run separates member and period with a vertical bar, which
 * SEPA does not allow. A hyphen does the same and bothers nobody.
 */
export function endToEndId(value: unknown, fallback?: unknown): string {
  const clean = sepaText(String(value ?? '').replace(/\|/g, '-'), 35);
  return clean || sepaText(fallback ?? 'NOTPROVIDED', 35);
}

export interface DebitRequest {
  member: MandateHolder;
  amount: Cents;
  reference: string;
  endToEndId?: string;
  dueDate: IsoDate;
  lastUsed?: IsoDate | null;
}

export interface Debit {
  memberId: Id | null;
  name: string;
  sepaName: string;
  iban: string;
  mandateRef: string;
  mandateDate: IsoDate | null;
  amount: Cents;
  reference: string;
  endToEndId: string;
  dueDate: IsoDate;
  problems: string[];
  notes: string[];
  ready: boolean;
}

export interface Collection {
  rows: Debit[];
  ready: Debit[];
  blocked: Debit[];
  count: number;
  total: Cents;
}

function amountProblems(amount: Cents): string[] {
  if (!Number.isFinite(amount) || amount <= 0) return ['Der Betrag ist null.'];
  if (amount > MAX_AMOUNT) return ['Der Betrag übersteigt die für eine Lastschrift zulässige Höhe.'];
  return [];
}

function toDebit(row: DebitRequest, today?: IsoDate | null): Debit {
  const member = row.member ?? {};
  const { problems, notes } = checkMandate(member, row.dueDate, today, row.lastUsed);

  problems.push(...amountProblems(row.amount));
  if (!member.name) problems.push('Das Mitglied hat keinen Namen.');

  return {
    memberId: member.id ?? null,
    name: member.name ?? '',
    sepaName: sepaText(member.name, 70),
    iban: normalizeIban(member.iban),
    mandateRef: sepaText(member.mandateRef, 35),
    mandateDate: member.mandateDate ?? null,
    amount: Number.isFinite(row.amount) ? row.amount : 0,
    reference: sepaText(row.reference, 140),
    endToEndId: endToEndId(row.endToEndId, row.reference),
    dueDate: row.dueDate,
    problems,
    notes,
    ready: problems.length === 0
  };
}

/**
 * Assembles the debits of one due date.
 *
 * Expects one member, one amount and one reference per row. Every row is
 * checked on its own: what cannot be collected is not dropped but keeps its
 * reason and stays visible. Otherwise a member quietly disappears from the run
 * and nobody notices until the money is missing.
 */
export function collect(rows: DebitRequest[], options: { today?: IsoDate | null } = {}): Collection {
  const list = (rows ?? []).map((row) => toDebit(row, options.today));
  const ready = list.filter((item) => item.ready);

  return {
    rows: list,
    ready,
    blocked: list.filter((item) => !item.ready),
    count: ready.length,
    total: ready.reduce((sum, item) => sum + item.amount, 0)
  };
}

export interface Creditor {
  name?: string;
  iban?: string;
  /** Optional: within SEPA the IBAN is enough, so it is often absent. */
  bic?: string;
}

function creditorErrors(creditor: Creditor | null | undefined, creditorId: string): string[] {
  const errors: string[] = [];

  if (!creditor?.name) {
    errors.push('Der Name des Gläubigers fehlt. Er steht in den Firmendaten.');
  }
  if (!creditor?.iban) {
    errors.push('Für den Gläubiger ist keine IBAN hinterlegt. Ohne Konto gibt es kein Ziel für den Einzug.');
  } else if (!validIban(creditor.iban)) {
    errors.push('Die IBAN des Gläubigers ist nicht gültig, die Prüfziffer stimmt nicht.');
  }

  if (!creditorId) {
    errors.push('Die Gläubiger-Identifikationsnummer fehlt. Sie wird kostenlos bei der Deutschen Bundesbank beantragt und ist Voraussetzung für jeden Einzug.');
  } else if (!validCreditorId(creditorId)) {
    errors.push('Die Gläubiger-Identifikationsnummer ist nicht gültig, die Prüfziffer stimmt nicht.');
  }

  return errors;
}

function dueDateCheck(dueDate: IsoDate, today: IsoDate, preNotificationDays: number): MandateCheck {
  const problems: string[] = [];
  const notes: string[] = [];
  const earliest = earliestCollectionDate(today, 1);
  const latest = latestCollectionDate(today);

  if (dueDate < earliest) {
    problems.push(`Der Fälligkeitstag ${dueDate} liegt zu früh. Frühestens möglich ist ${earliest}, denn zwischen Einreichung und Einzug muss mindestens ein TARGET-Geschäftstag liegen.`);
  } else if (dueDate > latest) {
    problems.push(`Der Fälligkeitstag ${dueDate} liegt zu weit voraus. Mehr als 14 Kalendertage vor Fälligkeit nimmt die Bank die Datei nicht an, spätestens ${latest}.`);
  } else if (!isTargetBusinessDay(dueDate)) {
    notes.push(`Der ${dueDate} ist kein TARGET-Geschäftstag. Die Bank zieht dann am nächsten ein, hier am ${nextTargetBusinessDay(dueDate)}.`);
  }

  // The pre-notification is the duty most easily forgotten: without it the
  // member can object to the charge even though the mandate is valid.
  const notice = daysBetween(today, dueDate);
  if (notice < preNotificationDays) {
    const span = notice === 1 ? 'ist es ein Tag' : `sind es ${notice} Tage`;
    notes.push(`Bis zur Fälligkeit ${span}. Die Vorabankündigung muss ${preNotificationDays} Tage vorher vorliegen, sonst ist die Frist nur gewahrt, wenn die Satzung sie verkürzt.`);
  }

  return { problems, notes };
}

export interface RunCheck {
  errors: string[];
  warnings: string[];
  ok: boolean;
}

export interface RunInput {
  creditor?: Creditor | null;
  dueDate?: IsoDate | null;
  rows?: unknown[] | null;
  today?: IsoDate | null;
  settings?: Partial<SepaSettings> | null;
}

/**
 * Checks the file as a whole before it comes into being.
 *
 * Separate from the per row check, because this is where the reasons live that
 * stop the entire run: no creditor id, no club account, a date that does not
 * work.
 */
export function validateRun({ creditor, dueDate, rows, today, settings }: RunInput): RunCheck {
  const config: SepaSettings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  const errors = creditorErrors(creditor, config.creditorId);
  const warnings: string[] = [];

  if (!rows || !rows.length) {
    errors.push('Es ist keine einziehbare Lastschrift dabei.');
  }

  if (!dueDate) {
    errors.push('Es fehlt der Fälligkeitstag.');
  } else if (today) {
    const timing = dueDateCheck(dueDate, today, config.preNotificationDays);
    errors.push(...timing.problems);
    warnings.push(...timing.notes);
  }

  if (config.painVersion === 'pain.008.001.02' && today && today >= PAIN_CUTOVER) {
    warnings.push('pain.008.001.02 wird seit dem 14. November 2026 nicht mehr angenommen. Stelle in den Einstellungen auf pain.008.001.08 um.');
  }

  return { errors, warnings, ok: errors.length === 0 };
}

export function getScheme(id: string | null | undefined): Scheme {
  return SCHEMES.find((item) => item.id === id) ?? SCHEMES[0]!;
}

export function getPainVersion(id: string | null | undefined): PainVersion {
  return PAIN_VERSIONS.find((item) => item.id === id) ?? PAIN_VERSIONS[0]!;
}
