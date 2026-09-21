// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import * as euer from './euer';
import * as vat from './vat';
import { totals, resolveStatus } from './invoices';
import { isOffer } from './doctypes';
import type { Asset } from './assets';
import type { BusinessDocument, Cents, Entry, IsoDate, Settings } from '../shared/types';

/**
 * Tax reserve and cash forecast.
 *
 * Both answer the same question from two directions: how much of the money in
 * the account is not really mine yet, and will it last until the next big
 * date.
 *
 * All of this is an estimate and replaces no tax advice. VAT can be computed
 * exactly, income tax cannot, because it depends on total taxable income. The
 * rate is therefore configurable and reported as an assumption, not a result.
 */

/** 24,500 euro, the trade tax allowance for sole traders. */
const TRADE_TAX_ALLOWANCE: Cents = 2_450_000;
const TRADE_TAX_BASE_RATE = 3.5;

export interface ForecastData {
  entries: Entry[];
  assets?: Asset[];
  invoices?: BusinessDocument[];
  settings?: Settings;
}

function sumOfCategory(entries: readonly Entry[], categoryId: string, year: number): Cents {
  return entries
    .filter((entry) => entry.categoryId === categoryId && euer.taxYearOf(entry) === year)
    .reduce((total, entry) => total + entry.gross, 0);
}

export interface TaxReserve {
  year: number;
  profit: Cents;
  openVat: Cents;
  owedVat: Cents;
  paidVat: Cents;
  incomeTax: Cents;
  incomeTaxRate: number;
  tradeTax: Cents;
  tradeTaxRate: number;
  total: Cents;
  nextVatDue: { label: string; dueDate: IsoDate; amount: Cents } | null;
  assumptions: string[];
}

export function taxReserve(data: ForecastData, year: number, today: IsoDate): TaxReserve {
  const settings = data.settings ?? ({} as Settings);
  const reserve = (settings.reserve ?? {}) as { incomeTaxRate?: number; tradeTaxRate?: number };

  const incomeTaxRate = Number(reserve.incomeTaxRate) || 35;
  const tradeTaxRate = Number(reserve.tradeTaxRate) || 0;

  const result = euer.calculate(data.entries, data.assets, year);
  const profit = Math.max(0, result.profit);

  // VAT: what arose in this year's periods and has not reached the tax office.
  const periods = vat.yearOverview(data.entries, settings, year);
  const owedVat = periods.reduce((total, period) => total + Math.max(0, period.payable), 0);
  const paidVat = sumOfCategory(data.entries, 'exp_vat_payment', year);
  const refundedVat = sumOfCategory(data.entries, 'inc_vat_refund', year);

  const incomeTax = Math.round((profit * incomeTaxRate) / 100);

  // Trade tax only bites above the allowance and is largely credited against
  // income tax for sole traders. Without a municipal rate it stays out.
  const tradeTax = tradeTaxRate
    ? Math.round((Math.max(0, profit - TRADE_TAX_ALLOWANCE) * TRADE_TAX_BASE_RATE * tradeTaxRate) / 10_000)
    : 0;

  const openVat = Math.max(0, owedVat - paidVat + refundedVat);
  const nextPeriod = periods.find((period) => period.dueDate >= today) ?? null;

  return {
    year,
    profit: result.profit,
    openVat,
    owedVat,
    paidVat,
    incomeTax,
    incomeTaxRate,
    tradeTax,
    tradeTaxRate,
    total: openVat + incomeTax + tradeTax,
    nextVatDue: nextPeriod
      ? { label: nextPeriod.label, dueDate: nextPeriod.dueDate, amount: nextPeriod.payable }
      : null,
    assumptions: [
      `Einkommensteuer geschätzt mit ${incomeTaxRate} Prozent auf den Gewinn. Weil der Gewinn zum übrigen Einkommen hinzukommt, zählt dein höchster Steuersatz, nicht der durchschnittliche.`,
      tradeTaxRate
        ? `Gewerbesteuer mit Hebesatz ${tradeTaxRate} Prozent über dem Freibetrag von 24.500 Euro. Bei Einzelunternehmen wird sie weitgehend auf die Einkommensteuer angerechnet, die Rücklage ist daher eher zu hoch als zu niedrig.`
        : 'Gewerbesteuer bleibt unberücksichtigt, weil kein Hebesatz hinterlegt ist.',
      'Die Umsatzsteuer ist exakt gerechnet: es ist die Summe der Zahllasten des Jahres abzüglich dessen, was bereits ans Finanzamt geflossen ist.'
    ]
  };
}

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

function addMonths(isoDate: IsoDate, months: number): IsoDate {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function monthKey(isoDate: IsoDate): string {
  return String(isoDate).slice(0, 7);
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

export interface CashItem {
  kind: 'invoice' | 'entry' | 'vat';
  label: string;
  date: IsoDate;
  /** Negative for money going out. */
  amount: Cents;
  overdue?: boolean;
}

export interface CashMonth {
  key: string;
  label: string;
  incoming: Cents;
  outgoing: Cents;
  items: CashItem[];
  opening: Cents;
  change: Cents;
  closing: Cents;
}

export interface Liquidity {
  startBalance: Cents;
  balanceDate: IsoDate;
  hasBalance: boolean;
  rows: CashMonth[];
  endBalance: Cents;
  lowest: { label: string; closing: Cents } | null;
  warning: string | null;
}

/**
 * Cash forecast over the coming months.
 *
 * It starts from an opening balance the program cannot know, which is why it
 * lives in the settings. On top of that come expected receipts from open
 * invoices, unpaid expenses and the VAT falling due.
 *
 * Deliberately without assumptions about future work: a forecast that invents
 * revenue only soothes.
 */
export function liquidity(data: ForecastData, today: IsoDate, months = 6): Liquidity {
  const settings = data.settings ?? ({} as Settings);
  const opening = (settings.reserve ?? {}) as { accountBalance?: number; accountBalanceDate?: IsoDate };
  const startBalance = Math.trunc(Number(opening.accountBalance) || 0);

  const buckets = new Map<string, CashMonth>();
  const bucketFor = (key: string): CashMonth => {
    const existing = buckets.get(key);
    if (existing) return existing;

    const created: CashMonth = {
      key,
      label: monthLabel(key),
      incoming: 0,
      outgoing: 0,
      items: [],
      opening: 0,
      change: 0,
      closing: 0
    };
    buckets.set(key, created);
    return created;
  };

  for (let index = 0; index < months; index += 1) bucketFor(monthKey(addMonths(today, index)));
  const horizon = monthKey(addMonths(today, months - 1));

  const inRange = (date: IsoDate): boolean => {
    const key = monthKey(date);
    return key >= monthKey(today) && key <= horizon;
  };

  // Open invoices: expected on their due date, overdue ones right away.
  for (const invoice of data.invoices ?? []) {
    if (isOffer(invoice)) continue;

    const status = resolveStatus(invoice, today);
    if (!['sent', 'overdue', 'partial'].includes(status)) continue;

    const open = totals(invoice).openAmount;
    if (open <= 0) continue;

    const due = invoice.dueDate && invoice.dueDate > today ? invoice.dueDate : today;
    if (!inRange(due)) continue;

    const bucket = bucketFor(monthKey(due));
    bucket.incoming += open;
    bucket.items.push({
      kind: 'invoice',
      label: `Rechnung ${invoice.number || 'Entwurf'}`,
      date: due,
      amount: open,
      overdue: status === 'overdue'
    });
  }

  for (const entry of data.entries ?? []) {
    if (entry.paidDate) continue;

    const due = entry.date > today ? entry.date : today;
    if (!inRange(due)) continue;

    const bucket = bucketFor(monthKey(due));

    if (entry.type === 'income') {
      // Income from invoices is already covered by the loop above.
      if (entry.invoiceId) continue;
      bucket.incoming += entry.gross;
      bucket.items.push({ kind: 'entry', label: entry.description, date: due, amount: entry.gross });
    } else {
      bucket.outgoing += entry.gross;
      bucket.items.push({ kind: 'entry', label: entry.description, date: due, amount: -entry.gross });
    }
  }

  const year = Number(today.slice(0, 4));
  for (const forYear of [year, year + 1]) {
    for (const period of vat.yearOverview(data.entries, settings, forYear)) {
      if (period.payable <= 0) continue;
      if (period.dueDate < today || !inRange(period.dueDate)) continue;

      const bucket = bucketFor(monthKey(period.dueDate));
      bucket.outgoing += period.payable;
      bucket.items.push({
        kind: 'vat',
        label: `Umsatzsteuer ${period.label}`,
        date: period.dueDate,
        amount: -period.payable
      });
    }
  }

  const rows = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  let balance = startBalance;

  for (const row of rows) {
    row.opening = balance;
    row.change = row.incoming - row.outgoing;
    balance += row.change;
    row.closing = balance;
    row.items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  const lowest = rows.reduce<CashMonth | null>(
    (min, row) => (min === null || row.closing < min.closing ? row : min),
    null
  );

  return {
    startBalance,
    balanceDate: opening.accountBalanceDate || today,
    hasBalance: Boolean(opening.accountBalance),
    rows,
    endBalance: balance,
    lowest: lowest ? { label: lowest.label, closing: lowest.closing } : null,
    warning: lowest && lowest.closing < 0
      ? `Im ${lowest.label} reicht es nach dieser Rechnung nicht: ${(lowest.closing / 100).toFixed(2)} Euro.`
      : null
  };
}

export { TRADE_TAX_ALLOWANCE as GEWERBESTEUER_FREIBETRAG };
