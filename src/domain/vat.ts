// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { taxEffect } from './entries';
import { getCategory } from './categories';
import { findVatRate } from './tax';
import type { Cents, Entry, IsoDate, Settings } from '../shared/types';

/**
 * Advance VAT return.
 *
 * Under cash accounting (UStG 20) the VAT falls due when the money arrives.
 * The input VAT deduction does not depend on payment at all but on the supply
 * and a valid invoice, so the two sides are cut off by different dates:
 * output VAT by paidDate, input VAT by date.
 *
 * Setting inputVatBasis to 'payment' simplifies this at the cost of accuracy.
 * Under accrual accounting the output side follows the invoice date too.
 *
 * The box numbers match the official form and exist to be typed into ELSTER.
 * This program transmits nothing.
 */

export const KZ_LABELS: Record<string, string> = {
  '81': 'Steuerpflichtige Umsätze zum Steuersatz von 19 Prozent',
  '86': 'Steuerpflichtige Umsätze zum Steuersatz von 7 Prozent',
  '41': 'Innergemeinschaftliche Lieferungen an Abnehmer mit USt-IdNr.',
  '21': 'Nicht steuerbare sonstige Leistungen im übrigen Gemeinschaftsgebiet',
  '45': 'Übrige nicht steuerbare Umsätze mit Leistungsort im Ausland',
  '43': 'Weitere steuerfreie Umsätze mit Vorsteuerabzug',
  '48': 'Steuerfreie Umsätze ohne Vorsteuerabzug',
  '60': 'Umsätze, für die der Leistungsempfänger die Steuer schuldet, §13b',
  '89': 'Innergemeinschaftliche Erwerbe zum Steuersatz von 19 Prozent',
  '93': 'Innergemeinschaftliche Erwerbe zum Steuersatz von 7 Prozent',
  '46': 'Leistungen, für die ich als Empfänger die Steuer schulde, §13b',
  '47': 'Darauf entfallende Steuer, §13b',
  '66': 'Vorsteuerbeträge aus Rechnungen anderer Unternehmer',
  '61': 'Vorsteuer aus innergemeinschaftlichem Erwerb',
  '67': 'Vorsteuer aus Leistungen nach §13b',
  '83': 'Verbleibende Umsatzsteuer-Vorauszahlung oder Überschuss'
};

/**
 * Form order, not numeric order: own sales first, then the reverse charge
 * cases, then input VAT, then the balance. Sorted by number, input VAT 66
 * would come before the sales in 81 and 86.
 */
export const KZ_ORDER = [
  '81', '86', '35', '36', '41', '21', '45', '43', '48',
  '60', '89', '93', '46', '47', '66', '61', '67', '83'
];

export type VatMode = 'monthly' | 'quarterly' | 'yearly';
export type VatMethod = 'ist' | 'soll';
export type InputVatBasis = 'invoice' | 'payment';

export interface VatPeriod {
  key: string;
  label: string;
  from: IsoDate;
  to: IsoDate;
  dueDate: IsoDate;
}

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): IsoDate {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Moves a date to the next weekday when it lands on a weekend. */
export function nextBusinessDay(isoDate: IsoDate): IsoDate {
  const date = new Date(`${isoDate}T00:00:00Z`);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

/** Due on the 10th of the following month, a month later with an extension. */
function dueDateFor(year: number, endMonth: number, extension: boolean): IsoDate {
  let dueYear = year;
  let dueMonth = endMonth + 1 + (extension ? 1 : 0);

  while (dueMonth > 12) {
    dueMonth -= 12;
    dueYear += 1;
  }

  return nextBusinessDay(iso(dueYear, dueMonth, 10));
}

export function periodsOf(year: number, mode: VatMode, extension = false): VatPeriod[] {
  if (mode === 'yearly') {
    return [{
      key: `${year}`,
      label: `Jahr ${year}`,
      from: iso(year, 1, 1),
      to: iso(year, 12, 31),
      dueDate: nextBusinessDay(iso(year + 1, 7, 31))
    }];
  }

  if (mode === 'quarterly') {
    return Array.from({ length: 4 }, (_, index) => {
      const quarter = index + 1;
      const endMonth = index * 3 + 3;

      return {
        key: `${year}-Q${quarter}`,
        label: `${quarter}. Quartal ${year}`,
        from: iso(year, index * 3 + 1, 1),
        to: iso(year, endMonth, lastDayOfMonth(year, endMonth)),
        dueDate: dueDateFor(year, endMonth, extension)
      };
    });
  }

  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;

    return {
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: `${MONTH_NAMES[index]} ${year}`,
      from: iso(year, month, 1),
      to: iso(year, month, lastDayOfMonth(year, month)),
      dueDate: dueDateFor(year, month, extension)
    };
  });
}

function inRange(date: IsoDate | null, from: IsoDate, to: IsoDate): boolean {
  return Boolean(date) && date! >= from && date! <= to;
}

export interface VatDetail {
  entry: Entry;
  net: Cents;
  vat: Cents;
  date: IsoDate;
  kind?: 'erwerb' | '13b' | 'vorsteuer';
}

export interface VatReturn {
  period: VatPeriod;
  /** Box number to amount, in cents. */
  kz: Record<string, Cents>;
  labels: typeof KZ_LABELS;
  order: string[];
  outputVat: Cents;
  inputVat: Cents;
  payable: Cents;
  method: VatMethod;
  inputBasis: InputVatBasis;
  details: { outputs: VatDetail[]; inputs: VatDetail[] };
}

function taxSettings(settings: Settings | null | undefined) {
  const tax = (settings?.tax ?? {}) as {
    vatMethod?: VatMethod;
    inputVatBasis?: InputVatBasis;
    vatPeriod?: VatMode;
    dauerfristverlaengerung?: boolean;
  };

  return {
    method: tax.vatMethod ?? 'ist',
    inputBasis: tax.inputVatBasis ?? 'invoice',
    mode: tax.vatPeriod ?? 'quarterly',
    extension: Boolean(tax.dauerfristverlaengerung)
  };
}

function taxOn(net: Cents, rate: number): Cents {
  return Math.round((net * rate) / 100);
}

export function calculate(
  entries: readonly Entry[],
  settings: Settings | null | undefined,
  period: VatPeriod
): VatReturn {
  const { method, inputBasis } = taxSettings(settings);

  const kz: Record<string, Cents> = {};
  const add = (box: string, cents: Cents): void => {
    if (cents) kz[box] = (kz[box] ?? 0) + cents;
  };

  const details: VatReturn['details'] = { outputs: [], inputs: [] };

  for (const entry of entries) {
    // Payments to the tax office are not a sale of their own.
    if (getCategory(entry.categoryId)?.settlement) continue;

    const effect = taxEffect(entry);

    if (entry.type === 'income') {
      const date = method === 'soll' ? entry.date : entry.paidDate;
      if (!inRange(date, period.from, period.to)) continue;

      const net = effect.businessNet;
      const rateInfo = findVatRate(entry.vatKey, entry.vatRate);

      if (entry.vatRate === 19) add('81', net);
      else if (entry.vatRate === 7) add('86', net);
      else if (rateInfo.vatKz) add(rateInfo.vatKz, net);
      else add('48', net);

      details.outputs.push({ entry, net, vat: effect.outputVat, date: date! });
      continue;
    }

    const date = inputBasis === 'payment' ? entry.paidDate : entry.date;
    if (!inRange(date, period.from, period.to)) continue;

    const net = effect.businessNet;

    if (entry.intraCommunityAcquisition) {
      // Acquisition tax: owed and deducted again in the same return.
      const tax = taxOn(net, entry.vatRate);
      add(entry.vatRate === 7 ? '93' : '89', net);
      add('61', tax);
      details.inputs.push({ entry, net, vat: tax, date: date!, kind: 'erwerb' });
      continue;
    }

    if (entry.reverseCharge) {
      const tax = taxOn(net, entry.vatRate || 19);
      add('46', net);
      add('47', tax);
      add('67', tax);
      details.inputs.push({ entry, net, vat: tax, date: date!, kind: '13b' });
      continue;
    }

    if (effect.inputVat) {
      add('66', effect.inputVat);
      details.inputs.push({ entry, net, vat: effect.inputVat, date: date!, kind: 'vorsteuer' });
    }
  }

  const outputVat = taxOn(kz['81'] ?? 0, 19)
    + taxOn(kz['86'] ?? 0, 7)
    + taxOn(kz['89'] ?? 0, 19)
    + taxOn(kz['93'] ?? 0, 7)
    + (kz['47'] ?? 0);

  const inputVat = (kz['66'] ?? 0) + (kz['61'] ?? 0) + (kz['67'] ?? 0);
  const payable = outputVat - inputVat;
  add('83', payable);

  return {
    period,
    kz,
    labels: KZ_LABELS,
    order: KZ_ORDER,
    outputVat,
    inputVat,
    payable,
    method,
    inputBasis,
    details
  };
}

export interface PeriodSummary extends VatPeriod {
  outputVat: Cents;
  inputVat: Cents;
  payable: Cents;
}

export function yearOverview(
  entries: readonly Entry[],
  settings: Settings | null | undefined,
  year: number
): PeriodSummary[] {
  const { mode, extension } = taxSettings(settings);

  return periodsOf(year, mode, extension).map((period) => {
    const result = calculate(entries, settings, period);
    return { ...period, outputVat: result.outputVat, inputVat: result.inputVat, payable: result.payable };
  });
}

/**
 * With a filing extension one eleventh of last year's advance payments is due
 * up front, on 10 February.
 */
export function specialPrepayment(
  entries: readonly Entry[],
  settings: Settings | null | undefined,
  previousYear: number
): { basis: Cents; amount: Cents; dueDate: IsoDate } {
  const basis = periodsOf(previousYear, 'monthly', false)
    .reduce((total, period) => total + calculate(entries, settings, period).payable, 0);

  return {
    basis,
    amount: Math.round(basis / 11),
    dueDate: nextBusinessDay(iso(previousYear + 1, 2, 10))
  };
}
