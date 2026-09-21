// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { taxEffect } from './entries';
import { EUER_ORDER } from './categories';
import { totalDepreciation } from './assets';
import type { Asset } from './assets';
import type { Cents, Entry } from '../shared/types';

/**
 * Cash basis profit statement under EStG 4 (3).
 *
 * What counts is when the money moved, not when the invoice was written
 * (EStG 11), so open items stay out entirely.
 *
 * Amounts follow the gross method the official form expects: revenue and
 * expenses appear net, while VAT collected and input VAT paid each get their
 * own line, as do the payments to and from the tax office.
 */

export interface EuerRow {
  position: string;
  amount: Cents;
}

export interface EuerResult {
  year: number;
  income: EuerRow[];
  expense: EuerRow[];
  incomeTotal: Cents;
  expenseTotal: Cents;
  profit: Cents;
  collectedVat: Cents;
  paidInputVat: Cents;
  depreciation: Cents;
  /** Unpaid items, which belong to no year yet. */
  open: { income: Cents; expense: Cents };
}

/** The year a booking counts for, or null while it is still unpaid. */
export function taxYearOf(entry: Entry): number | null {
  if (entry.taxYearOverride) return Number(entry.taxYearOverride);
  if (!entry.paidDate) return null;
  return Number(entry.paidDate.slice(0, 4));
}

function addTo(positions: Map<string, Cents>, position: string, amount: Cents): void {
  if (!amount) return;
  positions.set(position, (positions.get(position) ?? 0) + amount);
}

/** Official form order first, anything unknown alphabetically after it. */
function toSortedRows(positions: Map<string, Cents>): EuerRow[] {
  return [...positions.entries()]
    .map(([position, amount]) => ({ position, amount }))
    .sort((a, b) => {
      const left = EUER_ORDER.indexOf(a.position);
      const right = EUER_ORDER.indexOf(b.position);

      if (left === -1 && right === -1) return a.position.localeCompare(b.position, 'de');
      if (left === -1) return 1;
      if (right === -1) return -1;
      return left - right;
    });
}

export function calculate(
  entries: readonly Entry[],
  assets: readonly Asset[] | null | undefined,
  year: number
): EuerResult {
  const incomePositions = new Map<string, Cents>();
  const expensePositions = new Map<string, Cents>();

  let collectedVat = 0;
  let paidInputVat = 0;
  let openIncome = 0;
  let openExpense = 0;

  for (const entry of entries) {
    const entryYear = taxYearOf(entry);

    if (entryYear === null) {
      if (entry.type === 'income') openIncome += entry.gross;
      else openExpense += entry.gross;
      continue;
    }
    if (entryYear !== year) continue;

    const effect = taxEffect(entry);

    if (entry.type === 'income') {
      if (effect.settlement === 'vat_refund') {
        // A refund from the tax office is itself the business income.
        addTo(incomePositions, effect.position, entry.gross);
      } else {
        addTo(incomePositions, effect.position, effect.euerAmount);
        collectedVat += effect.outputVat;
      }
      continue;
    }

    if (effect.settlement === 'vat_payment') {
      addTo(expensePositions, effect.position, entry.gross);
      continue;
    }

    paidInputVat += effect.inputVat;

    // Buying a fixed asset does not hit the result now, it does so through
    // depreciation over the years.
    if (!entry.assetId) addTo(expensePositions, effect.position, effect.euerAmount);
  }

  addTo(incomePositions, 'Vereinnahmte Umsatzsteuer', collectedVat);
  addTo(expensePositions, 'Gezahlte Vorsteuerbeträge', paidInputVat);

  const depreciation = totalDepreciation(assets ?? [], year);
  addTo(expensePositions, 'Absetzung für Abnutzung', depreciation);

  const income = toSortedRows(incomePositions);
  const expense = toSortedRows(expensePositions);
  const incomeTotal = income.reduce((total, row) => total + row.amount, 0);
  const expenseTotal = expense.reduce((total, row) => total + row.amount, 0);

  return {
    year,
    income,
    expense,
    incomeTotal,
    expenseTotal,
    profit: incomeTotal - expenseTotal,
    collectedVat,
    paidInputVat,
    depreciation,
    open: { income: openIncome, expense: openExpense }
  };
}

export interface MonthTotals {
  month: number;
  income: Cents;
  expense: Cents;
  profit: Cents;
}

/** Gross figures per month, for the dashboard chart. */
export function monthlyTotals(entries: readonly Entry[], year: number): MonthTotals[] {
  const months: MonthTotals[] = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    income: 0,
    expense: 0,
    profit: 0
  }));

  for (const entry of entries) {
    if (taxYearOf(entry) !== year || !entry.paidDate) continue;

    const month = months[Number(entry.paidDate.slice(5, 7)) - 1];
    if (!month) continue;

    const effect = taxEffect(entry);
    if (entry.type === 'income') month.income += effect.euerAmount + effect.outputVat;
    else month.expense += effect.euerAmount + effect.inputVat;
  }

  for (const month of months) month.profit = month.income - month.expense;
  return months;
}
