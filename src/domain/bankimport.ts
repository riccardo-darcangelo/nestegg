// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { createHash } from 'node:crypto';

import * as csv from './csv';
import { parseAmount } from './money';
import { getCategory } from './categories';
import { totals, resolveStatus } from './invoices';
import { typeOf } from './doctypes';
import * as returns from './returns';
import type { Consequence, DetectedReturn, MemberLike } from './returns';
import type {
  BusinessDocument, Cents, Customer, Entry, EntryType, Id, IsoDate, Settings
} from '../shared/types';

/**
 * Reading a bank statement.
 *
 * What the app does here and what it deliberately does not:
 *
 *   It reads a CSV file, detects the columns itself and proposes a booking for
 *   every line. It books nothing on its own. Every line is confirmed
 *   individually, same as with the recurring templates. Bookkeeping that fills
 *   itself from a file stops being auditable, and a bank statement is no
 *   receipt under GoBD, only proof that money moved.
 *
 * A line can mean two things:
 *
 *   payment on an invoice   no second income arises, the invoice is settled
 *   standalone booking      everything else, expenses as well as income
 *
 * The VAT rate comes from the category, not from the bank line: a statement
 * knows no tax. Without a supplier invoice there is no input tax deduction
 * either, whatever the app proposes.
 */

/* Columns */

export type ColumnField =
  | 'date' | 'valueDate' | 'counterparty' | 'purpose' | 'bookingText'
  | 'amount' | 'currency' | 'debit' | 'credit' | 'sign' | 'iban' | 'balance';

export type ColumnMap = Partial<Record<ColumnField, number>>;

/**
 * Known column headings.
 *
 * Collected from the exports of the common institutions: Sparkasse, DKB,
 * Commerzbank, Deutsche Bank, ING, Volks- und Raiffeisenbanken, N26, Postbank,
 * plus PayPal and Stripe. The list may grow, and its order decides when
 * several headings match.
 */
export const COLUMNS: Record<ColumnField, string[]> = {
  date: [
    'buchungstag', 'buchungsdatum', 'buchung', 'datum', 'belegdatum',
    'valutadatum', 'wertstellung', 'wert', 'valuta', 'date', 'transaktionsdatum',
    'created', 'createdutc'
  ],
  valueDate: ['valutadatum', 'wertstellung', 'wertstellungstag', 'valuta'],
  counterparty: [
    'beguenstigterzahlungspflichtiger', 'auftraggeberbeguenstigter',
    'auftraggeberempfaenger', 'zahlungsbeteiligter', 'empfaengerzahlungspflichtiger',
    'namezahlungsbeteiligter', 'empfaenger', 'auftraggeber', 'name',
    'partnername', 'beguenstigter', 'zahlungspflichtiger', 'kontoinhaber',
    'payeepayer', 'counterparty', 'customerdescription', 'customeremail'
  ],
  purpose: [
    'verwendungszweck', 'vorgangverwendungszweck', 'buchungstextverwendungszweck',
    'beschreibung', 'referenz', 'description', 'kundenreferenz',
    'verwendungszweckzahlungsreferenz', 'zahlungsreferenz', 'betreff'
  ],
  bookingText: ['buchungstext', 'umsatzart', 'vorgang', 'transaktionstyp', 'typ', 'type'],
  amount: ['betrag', 'betrageur', 'umsatz', 'amount', 'betragineur', 'wert', 'net'],
  currency: ['waehrung', 'wkz', 'currency', 'waehrungskennzeichen'],
  debit: ['soll', 'belastung', 'ausgang', 'debit'],
  credit: ['haben', 'gutschrift', 'eingang', 'credit'],
  sign: ['sollhabenkennzeichen', 'shkennzeichen', 'sollhaben'],
  iban: ['kontonummeriban', 'ibanzahlungsbeteiligter', 'iban', 'kontonummer'],
  balance: ['saldonachbuchung', 'saldo', 'kontostand', 'balance']
};

/** Makes headings comparable: no umlauts, no decoration. */
function normalizeHeader(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Assigns the columns of a heading row.
 *
 * An exact match wins. Only when none exists does a heading that merely
 * contains a known name count: "Betrag (EUR)" should be the amount column,
 * "Auftraggeber/Empfänger" the counterparty.
 */
export function detectColumns(headerRow: readonly string[]): ColumnMap {
  const heads = headerRow.map(normalizeHeader);
  const columns: ColumnMap = {};
  const taken = new Set<number>();

  for (const pass of ['exact', 'contains'] as const) {
    for (const [field, names] of Object.entries(COLUMNS) as [ColumnField, string[]][]) {
      if (columns[field] !== undefined) continue;

      for (const name of names) {
        const index = heads.findIndex((head, i) => {
          if (taken.has(i) || !head) return false;
          return pass === 'exact' ? head === name : head.includes(name);
        });
        if (index > -1) {
          columns[field] = index;
          taken.add(index);
          break;
        }
      }
    }
  }

  return columns;
}

/** How well a row serves as the heading row. */
function headerScore(row: readonly string[]): number {
  const columns = detectColumns(row);
  let score = 0;
  if (columns.date !== undefined) score += 2;
  if (columns.amount !== undefined || columns.debit !== undefined || columns.credit !== undefined) score += 2;
  if (columns.purpose !== undefined) score += 1;
  if (columns.counterparty !== undefined) score += 1;
  return score;
}

/**
 * Finds the heading row.
 *
 * Sparkassen and Volksbanken put account number, period and blank lines in
 * front, some institutions a line reading "Umsätze Girokonto". So what is
 * sought is the row that looks most like column headings, not simply the
 * first one.
 */
export function findHeaderRow(rows: readonly string[][]): number {
  let best = { index: -1, score: 0 };
  const limit = Math.min(rows.length, 30);

  for (let i = 0; i < limit; i += 1) {
    const score = headerScore(rows[i] ?? []);
    if (score > best.score) best = { index: i, score };
  }
  return best.index > -1 && best.score >= 3 ? best.index : -1;
}

/* Values */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, mär: 3, apr: 4, may: 5, mai: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12
};

function iso(year: number, month: number, day: number): IsoDate {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Reads a date.
 *
 * German exports write 31.12.2026 or 31.12.26, international ones 2026-12-31.
 * For 01/02/2026 the day is assumed first, because a German bank does not
 * write American dates and these files come from German accounts.
 */
export function parseDate(value: unknown): IsoDate | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const isoLike = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoLike) return `${isoLike[1]}-${isoLike[2]}-${isoLike[3]}`;

  const numeric = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return iso(year, month, day);
  }

  const named = text.match(/^(\d{1,2})\.?\s*([A-Za-zäöü]{3})[a-z]*\.?\s*(\d{4})/);
  if (named) {
    const month = MONTHS[(named[2] ?? '').toLowerCase().slice(0, 3)];
    if (month) return iso(Number(named[3]), month, Number(named[1]));
  }

  return null;
}

function cell(row: readonly string[], index: number | undefined): string {
  return index === undefined ? '' : String(row[index] ?? '').trim();
}

/**
 * The amount of a row, in cents, signed.
 *
 * Three layouts occur: one amount column carrying the sign, separate columns
 * for debit and credit, or an amount column plus an "S" or "H" marker as in
 * the statements of the cooperative banks.
 */
export function parseRowAmount(row: readonly string[], columns: ColumnMap): Cents {
  if (columns.amount !== undefined) {
    const cents = parseAmount(cell(row, columns.amount));
    if (columns.sign === undefined) return cents;

    const sign = cell(row, columns.sign).toUpperCase();
    if (sign.startsWith('S') || sign === '-') return -Math.abs(cents);
    if (sign.startsWith('H') || sign === '+') return Math.abs(cents);
    return cents;
  }

  const debit = columns.debit !== undefined ? parseAmount(cell(row, columns.debit)) : 0;
  const credit = columns.credit !== undefined ? parseAmount(cell(row, columns.credit)) : 0;
  if (credit) return Math.abs(credit);
  if (debit) return -Math.abs(debit);
  return 0;
}

/** Collapses runs of whitespace and line breaks into single spaces. */
function tidy(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Reduces a text to what is comparable. */
export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/* Reading */

export interface Transaction {
  /** One based line in the file, so a problem can be pointed at. */
  line: number;
  date: IsoDate;
  valueDate: IsoDate;
  amount: Cents;
  currency: string;
  counterparty: string;
  purpose: string;
  bookingText: string;
  iban: string;
  /** Fingerprint of the line, which carries the duplicate check. */
  ref: string;
}

export interface Statement {
  transactions: Transaction[];
  columns: ColumnMap;
  headerRow: string[];
  delimiter: string;
  encoding: string;
  warnings: string[];
}

function fingerprintBase(transaction: Pick<Transaction, 'date' | 'amount' | 'counterparty' | 'purpose'>): string {
  const { date, amount, counterparty, purpose } = transaction;
  return [date, amount, normalizeText(counterparty), normalizeText(purpose)].join('|');
}

function fingerprint(base: string, seq: number): string {
  return createHash('sha1').update(`${base}|${seq}`).digest('hex').slice(0, 16);
}

/**
 * Turns one row into a transaction, or null when it carries no booking.
 *
 * Without a date or without an amount it is no transaction line. That catches
 * the balance line at the end of the Sparkasse exports, which would otherwise
 * pass as a booking.
 */
function toTransaction(row: readonly string[], line: number, columns: ColumnMap): Omit<Transaction, 'ref'> | null {
  const date = parseDate(cell(row, columns.date));
  const amount = parseRowAmount(row, columns);
  if (!date || !amount) return null;

  return {
    line,
    date,
    valueDate: parseDate(cell(row, columns.valueDate)) ?? date,
    amount,
    currency: (cell(row, columns.currency) || 'EUR').toUpperCase().slice(0, 3),
    counterparty: tidy(cell(row, columns.counterparty)),
    purpose: tidy(cell(row, columns.purpose)),
    bookingText: tidy(cell(row, columns.bookingText)),
    iban: cell(row, columns.iban).replace(/\s/g, '').toUpperCase()
  };
}

/** Reads a bank statement out of the raw file content. */
export function readStatement(
  buffer: Buffer | Uint8Array | string,
  options: { delimiter?: csv.Delimiter } = {}
): Statement {
  const { rows, delimiter, encoding } = csv.read(buffer, options);
  const warnings: string[] = [];

  if (!rows.length) {
    return { transactions: [], columns: {}, headerRow: [], delimiter, encoding, warnings: ['Die Datei ist leer.'] };
  }

  const headerIndex = findHeaderRow(rows);
  if (headerIndex === -1) {
    return {
      transactions: [],
      columns: {},
      headerRow: rows[0] ?? [],
      delimiter,
      encoding,
      warnings: ['In der Datei ist keine Kopfzeile mit Datum und Betrag zu finden. Stammt sie wirklich aus dem Kontoauszug?']
    };
  }

  const headerRow = rows[headerIndex] ?? [];
  const columns = detectColumns(headerRow);

  if (columns.counterparty === undefined && columns.purpose === undefined) {
    warnings.push('Weder Verwendungszweck noch Gegenpartei sind erkennbar. Die Vorschläge bleiben entsprechend dünn.');
  }

  const transactions: Transaction[] = [];
  const seen = new Map<string, number>();

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const parsed = toTransaction(rows[i] ?? [], i + 1, columns);
    if (!parsed) continue;

    const base = fingerprintBase(parsed);
    const seq = (seen.get(base) ?? 0) + 1;
    seen.set(base, seq);

    // The fingerprint allows repetitions on purpose: two identical debits on
    // the same day are two bookings, not one duplicate.
    transactions.push({ ...parsed, ref: fingerprint(base, seq) });
  }

  if (!transactions.length) warnings.push('Die Datei enthält keine Zeile mit Datum und Betrag.');

  const foreign = transactions.filter((transaction) => transaction.currency !== 'EUR');
  if (foreign.length) {
    warnings.push(`${foreign.length} Zeilen lauten nicht auf Euro. Sie werden mit dem Betrag übernommen, wie er in der Datei steht.`);
  }

  return { transactions, columns, headerRow, delimiter, encoding, warnings };
}

/* Matching */

export interface InvoiceMatch {
  invoiceId: Id;
  invoice: BusinessDocument;
  reason: string;
  confidence: 'sicher' | 'nummer' | 'betrag';
  /** Whether the amount settles the open claim to the cent. */
  exact: boolean;
}

const COLLECTABLE_STATUS = ['sent', 'overdue', 'partial'];

function openInvoices(invoices: readonly BusinessDocument[] | null | undefined, today: IsoDate | null): BusinessDocument[] {
  return (invoices ?? []).filter((invoice) => {
    if (typeOf(invoice).group !== 'invoice') return false;
    if (!COLLECTABLE_STATUS.includes(resolveStatus(invoice, today))) return false;
    return totals(invoice).openAmount > 0;
  });
}

function matchByNumber(
  transaction: Transaction,
  invoices: readonly BusinessDocument[],
  haystack: string
): InvoiceMatch | null {
  for (const invoice of invoices) {
    const number = normalizeText(invoice.number);
    if (!number || number.length < 4 || !haystack.includes(number)) continue;

    const exact = transaction.amount === totals(invoice).openAmount;
    return {
      invoiceId: invoice.id,
      invoice,
      reason: `Nummer ${invoice.number} steht im Verwendungszweck`,
      confidence: exact ? 'sicher' : 'nummer',
      exact
    };
  }
  return null;
}

function matchByAmount(
  transaction: Transaction,
  invoices: readonly BusinessDocument[],
  customers: readonly Customer[] | null | undefined,
  haystack: string
): InvoiceMatch | null {
  const hits = invoices.filter((invoice) => totals(invoice).openAmount === transaction.amount);
  if (hits.length !== 1) return null;

  const invoice = hits[0]!;
  const customer = (customers ?? []).find((item) => item.id === invoice.customerId);
  const nameFits = Boolean(customer?.name && haystack.includes(normalizeText(customer.name).slice(0, 8)));

  return {
    invoiceId: invoice.id,
    invoice,
    reason: nameFits ? `Betrag und Name passen zu ${invoice.number}` : `Betrag passt genau zu ${invoice.number}`,
    confidence: nameFits ? 'sicher' : 'betrag',
    exact: true
  };
}

/**
 * Looks for the invoice behind a payment.
 *
 * First by the number in the purpose, because that is the only reliable piece
 * of information. The number is stripped down on the way: whoever writes
 * "RE 2026 0004" or "RE20260004" means the same invoice.
 *
 * Without a number the amount is left: if it settles exactly one open claim to
 * the cent that is a usable hint, but a hint is all it is.
 */
export function matchInvoice(
  transaction: Transaction,
  invoices: readonly BusinessDocument[] | null | undefined,
  customers: readonly Customer[] | null | undefined,
  today: IsoDate | null
): InvoiceMatch | null {
  if (transaction.amount <= 0) return null;

  const open = openInvoices(invoices, today);
  if (!open.length) return null;

  const haystack = normalizeText(`${transaction.purpose} ${transaction.counterparty}`);

  return matchByNumber(transaction, open, haystack) ?? matchByAmount(transaction, open, customers, haystack);
}

/* Suggestion */

export interface BankRule {
  match: string;
  type?: EntryType | null;
  categoryId: string;
  segmentId?: Id | null;
  counterparty?: string;
}

export interface ImportData {
  settings: Settings;
  entries?: readonly Entry[];
  invoices?: readonly BusinessDocument[];
  customers?: readonly Customer[];
  members?: readonly MemberLike[];
}

export interface Suggestion {
  type: EntryType;
  categoryId: string;
  segmentId: Id | null;
  projectId: Id | null;
  counterparty: string;
  vatRate: number | null;
  source: 'rule' | 'history' | 'default';
  reason: string;
}

function fromRule(transaction: Transaction, rules: readonly BankRule[], type: EntryType): Suggestion | null {
  const text = normalizeText(`${transaction.counterparty} ${transaction.purpose} ${transaction.bookingText}`);

  for (const rule of rules) {
    if (!rule.match) continue;
    const needle = normalizeText(rule.match);
    if (!needle || !text.includes(needle)) continue;
    if (rule.type && rule.type !== type) continue;

    return {
      type: rule.type ?? type,
      categoryId: rule.categoryId,
      segmentId: rule.segmentId ?? null,
      projectId: null,
      counterparty: rule.counterparty || transaction.counterparty,
      vatRate: null,
      source: 'rule',
      reason: `Regel "${rule.match}"`
    };
  }
  return null;
}

interface HistoryHit {
  count: number;
  entry: Entry;
}

/** Groups past bookings by category, keeping the most recent one per group. */
function countByCategory(entries: readonly Entry[]): Map<string, HistoryHit> {
  const counts = new Map<string, HistoryHit>();

  for (const entry of entries) {
    const current = counts.get(entry.categoryId);
    if (!current) {
      counts.set(entry.categoryId, { count: 1, entry });
      continue;
    }
    current.count += 1;
    // On a tie the most recent booking wins, it is the fresher judgement.
    if (String(entry.updatedAt) > String(current.entry.updatedAt)) current.entry = entry;
  }

  return counts;
}

/**
 * Learns from what has been booked before.
 *
 * Compared is the counterparty, not the purpose: that changes with every
 * invoice number, the supplier name stays. Where the counterparty is empty the
 * purpose serves as a stopgap.
 */
function fromHistory(transaction: Transaction, entries: readonly Entry[], type: EntryType): Suggestion | null {
  const key = normalizeText(transaction.counterparty) || normalizeText(transaction.purpose).slice(0, 20);
  if (key.length < 4) return null;

  const matches = entries.filter((entry) => {
    if (entry.type !== type) return false;
    const name = normalizeText(entry.counterparty);
    if (!name) return false;
    return name === key || key.includes(name) || name.includes(key);
  });
  if (!matches.length) return null;

  const ranked = [...countByCategory(matches).entries()].sort((a, b) => b[1].count - a[1].count);
  const [categoryId, best] = ranked[0]!;
  const category = getCategory(categoryId);
  const times = best.count === 1 ? 'Buchung' : 'Buchungen';

  return {
    type,
    categoryId,
    segmentId: best.entry.segmentId ?? null,
    projectId: best.entry.projectId ?? null,
    counterparty: best.entry.counterparty || transaction.counterparty,
    vatRate: best.entry.vatRate,
    source: 'history',
    reason: `wie ${best.count} frühere ${times}${category ? ` (${category.label})` : ''}`
  };
}

/**
 * Proposes a category.
 *
 * Three sources, in this order:
 *
 *   1. a rule the user set up
 *   2. earlier bookings with the same counterparty, the strongest source
 *      because it reflects the user's own habits and improves without upkeep
 *   3. the default by sign
 */
export function suggestCategory(transaction: Transaction, data: ImportData): Suggestion {
  const type: EntryType = transaction.amount < 0 ? 'expense' : 'income';
  const rules = (data.settings.bankRules as BankRule[] | undefined) ?? [];

  return fromRule(transaction, rules, type)
    ?? fromHistory(transaction, data.entries ?? [], type)
    ?? {
      type,
      categoryId: type === 'income' ? 'inc_services' : 'exp_other',
      segmentId: null,
      projectId: null,
      counterparty: transaction.counterparty,
      vatRate: null,
      source: 'default',
      reason: 'Vorgabe, bitte prüfen'
    };
}

/* Plan */

/** What the user may change in the dialog, prepared. */
export interface Draft {
  type: EntryType;
  categoryId: string;
  segmentId: Id | null;
  projectId: Id | null;
  counterparty: string;
  description: string;
  invoiceId: Id | null;
  vatRate: number | null;
  rememberRule: boolean;
  customerId?: Id | null;
  note?: string;
  /** Only set for a returned debit, whose fee is booked apart. */
  feeAmount?: Cents;
  chargeMember?: boolean;
  feeCategoryId?: string | null;
}

export interface ReturnMatch {
  entryId: Id;
  by: 'reference' | 'mandate' | 'amount';
  sure: boolean;
  memberId: Id | null;
  description: string;
  gross: Cents;
}

export type PlannedAction = 'skip' | 'return' | 'payment' | 'entry';

export interface PlannedRow extends Transaction {
  duplicate: boolean;
  returned: DetectedReturn | null;
  returnMatch: ReturnMatch | null;
  consequence: Consequence | null;
  action: PlannedAction;
  selected: boolean;
  match: InvoiceMatch | null;
  suggestion: Suggestion | null;
  draft: Draft | null;
}

/**
 * The account for bank charges.
 *
 * A club and a business keep it under different ids. Where neither exists the
 * field stays empty and is picked in the dialog.
 */
function feeCategoryFor(data: ImportData): string | null {
  const kind = (data.settings.entity as { kind?: string } | undefined)?.kind ?? 'business';
  const wanted = kind === 'club' ? 'cl_exp_bank' : 'exp_fees';
  return getCategory(wanted) ? wanted : null;
}

/** Every bank reference already booked, as an entry or as a payment. */
function bookedRefs(data: ImportData): Set<string> {
  const refs = new Set<string>();

  for (const entry of data.entries ?? []) {
    if (entry.bankRef) refs.add(entry.bankRef);
  }
  for (const invoice of data.invoices ?? []) {
    for (const payment of invoice.payments ?? []) {
      if (payment.bankRef) refs.add(payment.bankRef);
    }
  }

  return refs;
}

function toReturnMatch(detected: DetectedReturn, data: ImportData): ReturnMatch | null {
  const hit = returns.matchEntry(detected, data.entries, data.members);
  if (!hit) return null;

  return {
    entryId: hit.entry.id,
    by: hit.by,
    sure: hit.sure,
    memberId: hit.entry.memberId ?? null,
    description: hit.entry.description,
    gross: hit.entry.gross
  };
}

function toDraft(
  transaction: Transaction,
  suggestion: Suggestion,
  match: InvoiceMatch | null,
  returned: DetectedReturn | null,
  data: ImportData
): Draft {
  return {
    type: suggestion.type,
    categoryId: suggestion.categoryId,
    segmentId: suggestion.segmentId,
    projectId: suggestion.projectId,
    counterparty: suggestion.counterparty || transaction.counterparty,
    description: transaction.purpose || transaction.bookingText || 'Kontoumsatz',
    invoiceId: match ? match.invoiceId : null,
    vatRate: suggestion.vatRate,
    rememberRule: false,
    // The fee of a returned debit belongs on the charges account, not on the
    // category guessed for an ordinary expense.
    ...(returned ? { feeAmount: 0, chargeMember: false, feeCategoryId: feeCategoryFor(data) } : {})
  };
}

function planRow(transaction: Transaction, data: ImportData, today: IsoDate | null, booked: Set<string>): PlannedRow {
  if (booked.has(transaction.ref)) {
    return {
      ...transaction,
      duplicate: true,
      returned: null,
      returnMatch: null,
      consequence: null,
      action: 'skip',
      selected: false,
      match: null,
      suggestion: null,
      draft: null
    };
  }

  // A returned debit is no ordinary expense: it reopens a claim. So it is
  // checked before anything else, otherwise it lands in the accounts as an
  // expense while the claim still counts as paid.
  const returned = returns.detect(transaction);
  const match = returned ? null : matchInvoice(transaction, data.invoices, data.customers, today);
  const suggestion = suggestCategory(transaction, data);

  return {
    ...transaction,
    duplicate: false,
    returned,
    returnMatch: returned ? toReturnMatch(returned, data) : null,
    consequence: returned ? returns.consequences(returned.code) : null,
    action: returned ? 'return' : (match ? 'payment' : 'entry'),
    selected: true,
    match,
    suggestion,
    draft: toDraft(transaction, suggestion, match, returned, data)
  };
}

/**
 * Builds the list of proposals from the lines read.
 *
 * Every line gets one of four intents:
 *
 *   payment   settles an open invoice
 *   return    a returned debit, which reopens a claim
 *   entry     a new booking
 *   skip      already booked
 */
export function plan(transactions: readonly Transaction[], data: ImportData, today: IsoDate | null): PlannedRow[] {
  const booked = bookedRefs(data);
  return transactions.map((transaction) => planRow(transaction, data, today, booked));
}

export interface PlanSummary {
  total: number;
  duplicates: number;
  payments: number;
  entries: number;
  selected: number;
  income: Cents;
  expense: Cents;
  from: IsoDate | null;
  to: IsoDate | null;
}

/** The numbers for the head of the view. */
export function summarize(rows: readonly PlannedRow[]): PlanSummary {
  const counted = (predicate: (row: PlannedRow) => boolean) => rows.filter(predicate).length;
  const selected = rows.filter((row) => row.selected && !row.duplicate);
  const dates = rows.map((row) => row.date).sort();

  return {
    total: rows.length,
    duplicates: counted((row) => row.duplicate),
    payments: counted((row) => !row.duplicate && row.action === 'payment'),
    entries: counted((row) => !row.duplicate && row.action === 'entry'),
    selected: selected.length,
    income: selected.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0),
    expense: selected.filter((row) => row.amount < 0).reduce((sum, row) => sum + row.amount, 0),
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null
  };
}

export interface EntryDraft {
  type: EntryType;
  date: IsoDate;
  paidDate: IsoDate;
  description: string;
  counterparty: string;
  categoryId: string;
  vatRate: number;
  basis: 'gross';
  amount: Cents;
  paymentMethod: 'bank';
  segmentId: Id | null;
  projectId: Id | null;
  customerId: Id | null;
  note: string;
  /** Trail back to the file, without which the duplicate check would be guesswork. */
  bankRef: string;
  bankLine: number;
}

/**
 * Turns a row into the raw booking.
 *
 * Date and payment date are both the booking day: the statement knows nothing
 * about the invoice date. Whoever needs the input tax in the right month
 * changes the document date on the booking afterwards.
 */
export function toEntry(row: PlannedRow, draft: Partial<Draft> = {}): EntryDraft {
  const merged = { ...row.draft, ...draft } as Draft;
  const category = getCategory(merged.categoryId);

  return {
    type: merged.type,
    date: row.date,
    paidDate: row.date,
    description: tidy(merged.description) || 'Kontoumsatz',
    counterparty: tidy(merged.counterparty),
    categoryId: merged.categoryId,
    vatRate: merged.vatRate ?? category?.defaultVatRate ?? 19,
    basis: 'gross',
    amount: Math.abs(row.amount),
    paymentMethod: 'bank',
    segmentId: merged.segmentId ?? null,
    projectId: merged.projectId ?? null,
    customerId: merged.customerId ?? null,
    note: merged.note ?? '',
    bankRef: row.ref,
    bankLine: row.line
  };
}

/** A rule distilled from a confirmed assignment. */
export function ruleFrom(row: PlannedRow, draft: Partial<Draft> = {}): BankRule | null {
  const merged = { ...row.draft, ...draft } as Draft;
  const match = tidy(row.counterparty) || tidy(row.purpose).slice(0, 24);
  if (!match) return null;

  return {
    match,
    type: merged.type,
    categoryId: merged.categoryId,
    segmentId: merged.segmentId ?? null,
    counterparty: tidy(merged.counterparty) || match
  };
}
