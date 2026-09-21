// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import * as vat from './vat';
import type { Cents, Entry, Settings } from '../shared/types';

/**
 * The limits that are easy to miss.
 *
 * Three numbers decide every year how often you file and whether you owe VAT
 * at all. They live in the law, not in this software, and all of them went up
 * on 1 January 2025. The app recalculates them from the books and says so
 * instead of waiting for the tax office to.
 *
 * All amounts in cents.
 */

/** UStG 18 (2), as of 2025. */
export const VAT_PERIOD_LIMITS = {
  /** Below this much tax last year the office may waive advance returns. */
  exemption: 200_000,
  /** Above this much tax last year filing is monthly. */
  monthly: 900_000
} as const;

/** UStG 19, as of 2025. */
export const SMALL_BUSINESS_LIMITS = {
  previousYear: 2_500_000,
  currentYear: 10_000_000
} as const;

export type VatPeriod = 'monthly' | 'quarterly' | 'exempt' | 'yearly';

export interface VatPeriodAdvice {
  year: number;
  previousYear: number;
  payable: Cents;
  recommended: VatPeriod;
  current: VatPeriod;
  matches: boolean;
  label: string;
  limits: typeof VAT_PERIOD_LIMITS;
  notes: string[];
}

const PERIOD_LABELS: Record<VatPeriod, string> = {
  monthly: 'monatlich',
  quarterly: 'vierteljährlich',
  exempt: 'befreit',
  yearly: 'jährlich'
};

function recommendPeriod(payable: Cents): VatPeriod {
  if (payable > VAT_PERIOD_LIMITS.monthly) return 'monthly';
  if (payable <= VAT_PERIOD_LIMITS.exemption) return 'exempt';
  return 'quarterly';
}

function periodNotes(recommended: VatPeriod, current: VatPeriod): string[] {
  const notes: string[] = [];

  if (recommended === 'exempt') {
    notes.push('Das Finanzamt kann dich von der Abgabe der Voranmeldungen befreien. Es tut das nicht von selbst: ein formloser Antrag genügt.');
  }
  if (recommended === 'monthly' && current !== 'monthly') {
    notes.push('Nach der Vorjahressteuer ist monatlich abzugeben. Prüfe den Bescheid des Finanzamts.');
  }
  if (recommended === 'quarterly' && current === 'monthly') {
    notes.push('Vierteljährlich würde reichen. Ein Wechsel spart acht Abgaben im Jahr, das Finanzamt muss ihn aber mitmachen.');
  }
  notes.push('In den ersten beiden Jahren nach der Gründung gilt unabhängig davon die monatliche Abgabe.');

  return notes;
}

/**
 * What counts is last year's tax, not turnover. Founding years are always
 * monthly, which the app cannot know and therefore just mentions.
 */
export function vatPeriodAdvice(
  entries: readonly Entry[],
  settings: Settings,
  year: number
): VatPeriodAdvice {
  const previousYear = year - 1;
  const payable = vat
    .yearOverview(entries, settings, previousYear)
    .reduce((total: Cents, period: { payable: Cents }) => total + Math.max(0, period.payable), 0);

  const recommended = recommendPeriod(payable);
  const current = (settings.tax as { vatPeriod: VatPeriod }).vatPeriod;

  return {
    year,
    previousYear,
    payable,
    recommended,
    current,
    // An exemption still allows quarterly filing, so that is not a mismatch.
    matches: recommended === current || (recommended === 'exempt' && current === 'quarterly'),
    label: PERIOD_LABELS[recommended],
    limits: VAT_PERIOD_LIMITS,
    notes: periodNotes(recommended, current)
  };
}

export type SmallBusinessStatus = 'ok' | 'close' | 'exceeded';

export interface SmallBusinessWatch {
  year: number;
  current: Cents;
  previous: Cents;
  limits: typeof SMALL_BUSINESS_LIMITS;
  percent: number;
  status: SmallBusinessStatus;
  warnings: string[];
}

function revenueOfYear(entries: readonly Entry[], year: number): Cents {
  return entries
    .filter((entry) => entry.type === 'income' && String(entry.paidDate ?? '').slice(0, 4) === String(year))
    .reduce((total, entry) => total + entry.gross, 0);
}

/**
 * How close turnover is to the limits of UStG 19.
 *
 * Since 2025 that means 25,000 euro last year and 100,000 this year. The
 * second one bites immediately: the very sale that crosses it is already
 * taxable, so invoicing without VAT afterwards still leaves you owing it.
 */
export function smallBusinessWatch(
  entries: readonly Entry[],
  year: number,
  isSmallBusiness: boolean
): SmallBusinessWatch {
  const current = revenueOfYear(entries, year);
  const previous = revenueOfYear(entries, year - 1);

  const warnings: string[] = [];
  let status: SmallBusinessStatus = 'ok';

  if (isSmallBusiness) {
    if (current > SMALL_BUSINESS_LIMITS.currentYear) {
      status = 'exceeded';
      warnings.push('Die Grenze von 100.000 Euro ist überschritten. Ab dem Umsatz, der sie gerissen hat, ist Umsatzsteuer auszuweisen, nicht erst ab dem nächsten Jahr.');
    } else if (current > SMALL_BUSINESS_LIMITS.currentYear * 0.8) {
      status = 'close';
      warnings.push('Die Grenze von 100.000 Euro rückt näher. Sie wirkt sofort: der überschreitende Umsatz ist schon steuerpflichtig.');
    }

    if (previous > SMALL_BUSINESS_LIMITS.previousYear) {
      if (status === 'ok') status = 'exceeded';
      warnings.push(`Der Vorjahresumsatz lag über 25.000 Euro. Damit ist die Kleinunternehmerregelung für ${year} entfallen.`);
    }
  }

  return {
    year,
    current,
    previous,
    limits: SMALL_BUSINESS_LIMITS,
    percent: Math.min(200, Math.round((current / SMALL_BUSINESS_LIMITS.currentYear) * 100)),
    status,
    warnings
  };
}
