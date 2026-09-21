// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { percentOf, parseAmount } from './money';
import { normalizeAmount } from './tax';
import { getCategory, deductiblePercent, allowsInputVat } from './categories';
import { allowsInputVat as sphereAllowsInputVat } from './spheres';
import type { AmountBasis, Cents, Entry, EntryType, IsoDate, PaymentMethod } from '../shared/types';

/**
 * A booking is the smallest building block, and it carries two dates:
 *
 *   date      when the service happened or the invoice was written, which
 *             drives the input VAT deduction
 *   paidDate  when the money moved, which drives the profit statement and,
 *             under cash accounting, the VAT owed
 *
 * Without paidDate the booking counts as open: it appears in no profit
 * statement and no VAT return, only in the list of open items.
 */

export const PAYMENT_METHODS: Array<{ id: PaymentMethod; label: string }> = [
  { id: 'bank', label: 'Bankkonto' },
  { id: 'cash', label: 'Bar' },
  { id: 'card', label: 'Karte' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'direct_debit', label: 'Lastschrift' },
  { id: 'other', label: 'Sonstiges' }
];

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function todayIso(): IsoDate {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function clampPercent(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

/** The form sends amounts as typed, so parsing happens in exactly one place. */
function toCents(amount: unknown): Cents {
  return typeof amount === 'string' ? parseAmount(amount) : Math.trunc(Number(amount) || 0);
}

/**
 * Under reverse charge and intra-community acquisition the invoice shows no
 * tax, so the amount entered is the net. The tax arises in the VAT return and
 * is deducted again there in the same breath.
 */
function splitAmount(raw: Partial<Entry> & Record<string, unknown>, vatRate: number, basis: AmountBasis) {
  const amount = Math.abs(toCents(raw.amount));
  const selfAssessed = Boolean(raw.reverseCharge) || Boolean(raw.intraCommunityAcquisition);

  return selfAssessed
    ? { gross: amount, net: amount, vat: 0 }
    : normalizeAmount(amount, vatRate, basis);
}

export function normalizeEntry(raw: Partial<Entry> & Record<string, unknown>): Entry {
  const type: EntryType = raw.type === 'income' ? 'income' : 'expense';
  const category = getCategory(raw.categoryId as string);

  const vatRate = Number.isFinite(Number(raw.vatRate)) ? Number(raw.vatRate) : (category?.defaultVatRate ?? 19);
  const basis: AmountBasis = raw.basis === 'net' ? 'net' : 'gross';
  const split = splitAmount(raw, vatRate, basis);
  const now = new Date().toISOString();

  return {
    id: raw.id as string,
    type,
    date: isIsoDate(raw.date) ? raw.date : todayIso(),
    paidDate: isIsoDate(raw.paidDate) ? raw.paidDate : null,
    description: String(raw.description ?? '').trim(),
    counterparty: String(raw.counterparty ?? '').trim(),
    categoryId: (raw.categoryId as string) || (type === 'income' ? 'inc_services' : 'exp_other'),

    vatRate,
    vatKey: raw.vatKey ?? category?.defaultVatKey ?? null,
    basis,
    gross: split.gross,
    net: split.net,
    vat: split.vat,

    paymentMethod: (raw.paymentMethod as PaymentMethod) || 'bank',
    privateSharePercent: clampPercent(raw.privateSharePercent),

    // The country decides where a sale is taxable, so it belongs on the
    // booking and not only on the customer.
    segmentId: raw.segmentId ?? null,
    customerId: raw.customerId ?? null,
    projectId: raw.projectId ?? null,
    countryCode: String(raw.countryCode ?? 'DE').toUpperCase().slice(0, 2),

    sphereId: raw.sphereId ?? null,
    sportsEvent: Boolean(raw.sportsEvent),
    counterpartyVatId: String(raw.counterpartyVatId ?? '').trim().toUpperCase(),
    revenueKind: raw.revenueKind === 'recurring' ? 'recurring' : 'onetime',

    receiptId: raw.receiptId ?? null,
    invoiceId: raw.invoiceId ?? null,
    assetId: raw.assetId ?? null,

    // Where the booking came from. These belong here rather than only in the
    // code that creates them, otherwise editing loses the origin and with it
    // the protection against entering the same thing twice.
    bankRef: raw.bankRef ?? null,
    bankLine: raw.bankLine ?? null,
    eInvoiceRef: raw.eInvoiceRef ?? null,
    eInvoiceNumber: raw.eInvoiceNumber ?? '',

    memberId: raw.memberId ?? null,
    duesRef: raw.duesRef ?? null,
    sepaRef: raw.sepaRef ?? null,
    sepaExportedAt: raw.sepaExportedAt ?? null,
    returnedAt: raw.returnedAt ?? null,
    returnCode: raw.returnCode ?? null,

    claimId: raw.claimId ?? null,
    waiver: Boolean(raw.waiver),

    recurrenceId: raw.recurrenceId ?? null,
    recurrenceDate: raw.recurrenceDate ?? null,

    reverseCharge: Boolean(raw.reverseCharge),
    intraCommunityAcquisition: Boolean(raw.intraCommunityAcquisition),
    // Books into a different tax year, for the ten-day rule of EStG 11 that
    // catches recurring payments around the turn of the year.
    taxYearOverride: raw.taxYearOverride ? Number(raw.taxYearOverride) : null,

    note: String(raw.note ?? '').trim(),
    createdAt: raw.createdAt ?? now,
    updatedAt: now
  };
}

export interface TaxEffect {
  /** Net amount attributable to business use. */
  businessNet: Cents;
  /** What actually lands in the profit statement, after deduction limits. */
  euerAmount: Cents;
  /** VAT owed, on income only. */
  outputVat: Cents;
  /** Input VAT deductible, on expenses only. */
  inputVat: Cents;
  /** Set on the two categories that settle with the tax office. */
  settlement: string | null;
  position: string;
}

export function taxEffect(entry: Entry): TaxEffect {
  const businessPercent = 100 - clampPercent(entry.privateSharePercent);
  const businessNet = percentOf(entry.net, businessPercent);
  const businessVat = percentOf(entry.vat, businessPercent);

  const category = getCategory(entry.categoryId);
  const euerAmount = percentOf(businessNet, deductiblePercent(entry.categoryId));
  const settlement = category?.settlement ?? null;

  if (entry.type === 'income') {
    return {
      businessNet,
      euerAmount,
      outputVat: businessVat,
      inputVat: 0,
      settlement,
      position: category?.position ?? 'Sonstige Betriebseinnahmen'
    };
  }

  // For an association the sphere decides too: the non-profit sphere is not a
  // business activity, so its expenses carry no input VAT deduction. That is
  // the mistake associations make most often.
  const sphereAllows = entry.sphereId ? sphereAllowsInputVat(entry.sphereId) : true;
  const canDeductVat = allowsInputVat(entry.categoryId) && sphereAllows && businessPercent > 0;

  return {
    businessNet,
    euerAmount,
    outputVat: 0,
    inputVat: canDeductVat ? businessVat : 0,
    settlement,
    position: category?.position ?? 'Übrige unbeschränkt abziehbare Betriebsausgaben'
  };
}

export function validateEntry(entry: Entry): string[] {
  const errors: string[] = [];
  const category = getCategory(entry.categoryId);

  if (!entry.description) errors.push('Bitte einen Verwendungszweck angeben.');
  if (!isIsoDate(entry.date)) errors.push('Das Belegdatum fehlt oder ist ungültig.');
  if (entry.paidDate && !isIsoDate(entry.paidDate)) errors.push('Das Zahlungsdatum ist ungültig.');
  if (!entry.gross) errors.push('Der Betrag darf nicht null sein.');
  if (entry.gross < 0) {
    errors.push('Bitte einen positiven Betrag erfassen. Die Richtung ergibt sich aus Einnahme oder Ausgabe.');
  }
  if (!category) errors.push('Die Kategorie ist unbekannt.');
  else if (category.kind !== entry.type) errors.push('Die Kategorie passt nicht zur Buchungsart.');

  return errors;
}

const RECEIPT_REQUIRED_ABOVE: Cents = 25_000;
const GWG_LIMIT: Cents = 80_000;

/** Things worth noticing that are not reason enough to refuse the booking. */
export function warningsFor(entry: Entry): string[] {
  const warnings: string[] = [];

  if (entry.type === 'expense' && entry.gross > RECEIPT_REQUIRED_ABOVE && !entry.receiptId) {
    warnings.push('Ab 250 Euro verlangt das Finanzamt eine vollständige Rechnung. Es ist noch kein Beleg hinterlegt.');
  }
  if (entry.categoryId === 'exp_entertainment') {
    warnings.push('Bewirtung: 70 Prozent wirken als Betriebsausgabe, die Vorsteuer bleibt zu 100 Prozent abziehbar. Anlass und Teilnehmer gehören auf den Beleg.');
  }
  if (entry.categoryId === 'exp_gwg' && taxEffect(entry).businessNet > GWG_LIMIT) {
    warnings.push('Über 800 Euro netto ist kein GWG mehr. Das Wirtschaftsgut gehört ins Anlageverzeichnis und wird abgeschrieben.');
  }
  if (entry.reverseCharge || entry.intraCommunityAcquisition) {
    warnings.push('Die Rechnung weist keine Steuer aus, der Betrag gilt deshalb als Netto. Die Steuer entsteht in der Voranmeldung und wird dort in gleicher Höhe wieder abgezogen.');
  }
  if (entry.privateSharePercent > 0) {
    warnings.push(`Privatanteil ${entry.privateSharePercent} Prozent: nur der betriebliche Rest wirkt sich aus.`);
  }
  if (!entry.paidDate) {
    warnings.push('Ohne Zahlungsdatum gilt die Buchung als offen und fließt weder in die EÜR noch in die Umsatzsteuer ein.');
  }

  return warnings;
}
