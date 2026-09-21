// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { findVatRate, isEuCountry } from './tax';
import { taxEffect } from './entries';
import type { Cents, CountryCode, Customer, Entry, IsoDate } from '../shared/types';

/**
 * Recapitulative statement under UStG 18a.
 *
 * Supplying a service to a business elsewhere in the EU and shifting the tax
 * liability to them has to be reported to the federal tax office: per
 * customer, with their VAT ID and the total for the period. The same applies
 * to intra-community supplies of goods.
 *
 * Unlike the VAT return, what counts here is the date of supply or invoice,
 * not the payment. Cash accounting makes no difference, because no German tax
 * arises in the first place.
 *
 * The period is quarterly by default. Once intra-community supplies of goods
 * pass 50,000 euro in a quarter it becomes monthly; services alone never
 * trigger that.
 */

export const MONTHLY_THRESHOLD_GOODS: Cents = 5_000_000;

export type ReportKind = 'service' | 'goods';
export type ReportMode = 'quarterly' | 'monthly';

export interface ReportPeriod {
  key: string;
  label: string;
  from: IsoDate;
  to: IsoDate;
  dueDate: IsoDate;
}

export interface ReportLine {
  vatId: string;
  country: CountryCode;
  name: string;
  kind: ReportKind;
  amount: Cents;
  count: number;
}

export interface ReportResult {
  period: ReportPeriod;
  lines: ReportLine[];
  services: Cents;
  goods: Cents;
  total: Cents;
  problems: string[];
  required: boolean;
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

/** Filing is due on the 25th of the following month. */
function dueAfter(year: number, month: number): IsoDate {
  return month === 12 ? iso(year + 1, 1, 25) : iso(year, month + 1, 25);
}

export function periodsOf(year: number, mode: ReportMode = 'quarterly'): ReportPeriod[] {
  if (mode === 'monthly') {
    return Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return {
        key: `${year}-${String(month).padStart(2, '0')}`,
        label: `${MONTH_NAMES[index]} ${year}`,
        from: iso(year, month, 1),
        to: iso(year, month, lastDayOfMonth(year, month)),
        dueDate: dueAfter(year, month)
      };
    });
  }

  return Array.from({ length: 4 }, (_, index) => {
    const quarter = index + 1;
    const endMonth = index * 3 + 3;

    return {
      key: `${year}-Q${quarter}`,
      label: `${quarter}. Quartal ${year}`,
      from: iso(year, index * 3 + 1, 1),
      to: iso(year, endMonth, lastDayOfMonth(year, endMonth)),
      dueDate: dueAfter(year, endMonth)
    };
  });
}

/** Null when the booking does not have to be reported at all. */
export function reportableKind(entry: Entry): ReportKind | null {
  if (entry.type !== 'income') return null;
  return findVatRate(entry.vatKey, entry.vatRate).ecSales ?? null;
}

function euro(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

export function calculate(
  entries: readonly Entry[],
  customers: readonly Customer[] | null | undefined,
  period: ReportPeriod
): ReportResult {
  const byCustomer = new Map<string, ReportLine>();
  const problems: string[] = [];
  const customerById = new Map((customers ?? []).map((customer) => [customer.id, customer]));

  for (const entry of entries) {
    const kind = reportableKind(entry);
    if (!kind) continue;
    if (!entry.date || entry.date < period.from || entry.date > period.to) continue;

    const customer = entry.customerId ? customerById.get(entry.customerId) : undefined;
    const vatId = (entry.counterpartyVatId || customer?.vatId || '').replace(/\s/g, '').toUpperCase();
    const country = (entry.countryCode || customer?.country || '').toUpperCase();
    const name = entry.counterparty || customer?.name || 'Ohne Namen';
    const net = taxEffect(entry).businessNet;

    if (!vatId) {
      problems.push(`${entry.date}: ${name} über ${euro(net)} Euro hat keine USt-IdNr. Ohne sie ist die Meldung nicht möglich und der Umsatz womöglich steuerpflichtig.`);
      continue;
    }
    if (!isEuCountry(country)) {
      problems.push(`${entry.date}: ${name} ist mit Land ${country || 'unbekannt'} erfasst, gemeldet werden dürfen nur Umsätze ins übrige Gemeinschaftsgebiet.`);
      continue;
    }
    if (country === 'DE') {
      problems.push(`${entry.date}: ${name} sitzt in Deutschland. Ein inländischer Umsatz gehört nicht in die Zusammenfassende Meldung.`);
      continue;
    }
    if (!vatId.startsWith(country)) {
      problems.push(`${entry.date}: Die USt-IdNr. ${vatId} passt nicht zum Land ${country}.`);
    }

    const key = `${vatId}|${kind}`;
    const line = byCustomer.get(key) ?? { vatId, country, name, kind, amount: 0, count: 0 };
    line.amount += net;
    line.count += 1;
    byCustomer.set(key, line);
  }

  const lines = [...byCustomer.values()].sort((a, b) => b.amount - a.amount);
  const totalOf = (kind: ReportKind): Cents =>
    lines.filter((line) => line.kind === kind).reduce((total, line) => total + line.amount, 0);

  const services = totalOf('service');
  const goods = totalOf('goods');

  return {
    period,
    lines,
    services,
    goods,
    total: services + goods,
    problems,
    required: lines.length > 0
  };
}

/** True once goods pass the threshold in any quarter of the year. */
export function needsMonthly(
  entries: readonly Entry[],
  customers: readonly Customer[] | null | undefined,
  year: number
): boolean {
  return periodsOf(year, 'quarterly').some(
    (period) => calculate(entries, customers, period).goods > MONTHLY_THRESHOLD_GOODS
  );
}

export interface PeriodSummary extends ReportPeriod {
  services: Cents;
  goods: Cents;
  total: Cents;
  lineCount: number;
  problemCount: number;
}

export function yearOverview(
  entries: readonly Entry[],
  customers: readonly Customer[] | null | undefined,
  year: number,
  mode: ReportMode = 'quarterly'
): PeriodSummary[] {
  return periodsOf(year, mode).map((period) => {
    const result = calculate(entries, customers, period);

    return {
      ...period,
      services: result.services,
      goods: result.goods,
      total: result.total,
      lineCount: result.lines.length,
      problemCount: result.problems.length
    };
  });
}
