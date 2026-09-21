// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import * as pdftext from './pdftext';
import type { Cents, IsoDate } from '../shared/types';

/**
 * Reading receipts.
 *
 * Getting the four details out of a PDF that would otherwise be typed by hand:
 * amount, date, invoice number and supplier. What is found is a proposal that
 * appears in the form and can be changed before anything is booked. None of it
 * is taken over silently.
 *
 * Limits that belong stated here:
 *
 *   Scanned receipts hold no text but an image. Optical recognition is not
 *   built in, deliberately: it would be either a large dependency or a service
 *   on the network, and the bookkeeping stays offline.
 *
 *   Every invoice looks different. The recognition works with keywords and
 *   patterns, not with understanding. It is often right and sometimes wrong,
 *   which is why the last decision stays with the human.
 */

/* Patterns */

const AMOUNT_LABELS = [
  'zu zahlen', 'gesamtbetrag', 'rechnungsbetrag', 'endbetrag', 'zahlbetrag',
  'gesamtsumme', 'bruttobetrag', 'summe brutto', 'total', 'gesamt', 'summe'
];

const NUMBER_LABELS = [
  'rechnungsnummer', 'rechnungs-nr', 'rechnung nr', 'rechnungsnr', 'belegnummer',
  'beleg-nr', 'invoice number', 'invoice no', 'rechnung'
];

const DATE_LABELS = [
  'rechnungsdatum', 'belegdatum', 'datum', 'invoice date', 'date'
];

/** A number with a German or an English decimal separator, in cents. */
export function toCents(raw: string): Cents | null {
  const clean = String(raw).replace(/[\s ]/g, '');
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');

  let normalized = clean;
  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot
      ? clean.replace(/\./g, '').replace(',', '.')
      : clean.replace(/,/g, '');
  } else if (lastComma > -1) {
    normalized = clean.replace(',', '.');
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export function toIso(raw: string): IsoDate | null {
  const german = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/.exec(raw);
  if (german) {
    let year = Number(german[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    const month = Number(german[2]);
    const day = Number(german[1]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return iso ? raw : null;
}

export interface LabelHit {
  value: string;
  label: string;
  /** Where the label sat in the text, for ranking several hits. */
  at: number;
}

/**
 * Looks for the value behind a keyword.
 *
 * The text is searched for the word and then the piece right after it. On an
 * invoice the value almost always sits directly behind it or to its right on
 * the same line, and out of a PDF both arrive as a sequence.
 */
export function afterLabel(
  text: string,
  labels: readonly string[],
  pattern: RegExp,
  window = 40
): LabelHit | null {
  const lower = text.toLowerCase();

  for (const label of labels) {
    let from = 0;
    while (from < lower.length) {
      const index = lower.indexOf(label, from);
      if (index === -1) break;

      const slice = text.slice(index + label.length, index + label.length + window);
      const match = pattern.exec(slice);
      pattern.lastIndex = 0;
      if (match) return { value: match[0].trim(), label, at: index };

      from = index + label.length;
    }
  }
  return null;
}

/* Reading */

const AMOUNT_PATTERN = /-?\d{1,3}(?:[.\s]\d{3})*[,.]\d{2}|-?\d+[,.]\d{2}/;
const DATE_PATTERN = /\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}|\d{4}-\d{2}-\d{2}/;
const NUMBER_PATTERN = /[A-Z0-9][A-Z0-9\/-]{2,24}/;

/** What a scan can propose, all of it optional. */
export interface ScannedFields {
  amount?: Cents | null;
  vatRate?: number;
  date?: IsoDate;
  number?: string;
  counterpartyVatId?: string;
  iban?: string;
  counterparty?: string;
}

export interface Analysis {
  fields: ScannedFields;
  /** What each proposal rests on, so a wrong one can be recognised. */
  hints: string[];
}

/** Evaluates the text of a receipt. */
export function analyse(text: string): Analysis {
  const found: Analysis = { fields: {}, hints: [] };
  if (!text) return found;

  // The amount: by keyword first, otherwise the largest one in the document.
  const labelled = afterLabel(text, AMOUNT_LABELS, AMOUNT_PATTERN, 30);
  const amounts = [...text.matchAll(new RegExp(AMOUNT_PATTERN.source, 'g'))]
    .map((match) => toCents(match[0]))
    .filter((value): value is Cents => value !== null && value > 0);

  if (labelled) {
    found.fields.amount = toCents(labelled.value);
    found.hints.push(`Betrag aus "${labelled.label}"`);
  } else if (amounts.length) {
    found.fields.amount = Math.max(...amounts);
    found.hints.push('Betrag geraten: der größte Betrag im Dokument');
  }

  // The VAT rate, where one stands in the text.
  const rate = /(\d{1,2})\s*(?:,\d+)?\s*%/.exec(text);
  if (rate) {
    const value = Number(rate[1]);
    if ([0, 7, 19].includes(value)) found.fields.vatRate = value;
  }

  const dateHit = afterLabel(text, DATE_LABELS, DATE_PATTERN, 24);
  const anyDate = DATE_PATTERN.exec(text);
  const date = toIso(dateHit ? dateHit.value : (anyDate ? anyDate[0] : ''));
  if (date) {
    found.fields.date = date;
    found.hints.push(dateHit ? `Datum aus "${dateHit.label}"` : 'Datum geraten: das erste im Dokument');
  }

  const numberHit = afterLabel(text, NUMBER_LABELS, NUMBER_PATTERN, 30);
  if (numberHit && /\d/.test(numberHit.value)) {
    found.fields.number = numberHit.value;
    found.hints.push(`Nummer aus "${numberHit.label}"`);
  }

  // A VAT id has to carry digits and start with one of the country codes.
  // Without that restriction every run of capitals in a table heading turns
  // into a tax number.
  const EU = 'AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI';
  const vatId = new RegExp(`\\b(?:${EU})\\s?[A-Z0-9]*\\d[A-Z0-9]*\\b`).exec(text);
  if (vatId && /\d{4}/.test(vatId[0])) found.fields.counterpartyVatId = vatId[0].replace(/\s/g, '');

  // A German IBAN has exactly 22 characters. Without pinning that down the
  // pattern swallows the BIC as well where the text runs together.
  const iban = /\bDE\d{2}[\s]?(?:\d{4}[\s]?){4}\d{2}\b/.exec(text)
    || new RegExp(`\\b(?:${EU})\\d{2}[A-Z0-9]{11,28}\\b`).exec(text);
  if (iban) found.fields.iban = iban[0].replace(/\s/g, '');

  // The supplier as a rule stands at the very top, in the letterhead.
  const firstLine = text.split('\n').map((line) => line.trim())
    .find((line) => line.length > 3 && /[A-Za-zÄÖÜäöüß]{3}/.test(line));
  if (firstLine) {
    found.fields.counterparty = firstLine.slice(0, 60);
    found.hints.push('Lieferant geraten: die erste Zeile des Dokuments');
  }

  return found;
}

export interface ScanResult extends Analysis {
  ok: boolean;
  warning?: string | undefined;
  pages?: number | undefined;
  fileName?: string | undefined;
  /** The raw text, kept so a reader can check what the app read. */
  text?: string;
}

/** Reads a receipt file. */
export function scan(buffer: Buffer | null, fileName = ''): ScanResult {
  if (!buffer || buffer.subarray(0, 4).toString('latin1') !== '%PDF') {
    return {
      ok: false,
      fields: {},
      hints: [],
      warning: 'Auslesen geht nur bei PDF-Dateien. Ein Foto oder ein Scan enthält keinen Text.'
    };
  }

  const extracted = pdftext.extract(buffer);
  if (!extracted.text) {
    return { ok: false, fields: {}, hints: [], warning: extracted.warning, pages: extracted.pages };
  }

  const result = analyse(extracted.text);
  return {
    ok: Object.keys(result.fields).length > 0,
    fields: result.fields,
    hints: result.hints,
    pages: extracted.pages,
    fileName,
    // The raw text travels along: whoever wants to check what the app read
    // should be able to see it instead of having to trust the result.
    text: extracted.text.slice(0, 4000)
  };
}
