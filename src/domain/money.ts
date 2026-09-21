// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import type { Cents } from '../shared/types';

/**
 * Money is handled in whole cents. Floating point appears only at the edges,
 * when reading input, formatting output or writing an export, and never in
 * intermediate results. That is what keeps VAT from drifting by a cent.
 */

/** Rounds half away from zero, so -0.5 becomes -1 rather than 0. */
export function roundCents(value: number): Cents {
  if (!Number.isFinite(value)) throw new TypeError('roundCents: kein endlicher Wert');

  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}

function stripNoise(input: string): string {
  return input.replace(/[\s ]/g, '').replace(/(EUR|eur|€)/g, '');
}

function isNegative(input: string): boolean {
  return /^[-(]/.test(input) || /\)$/.test(input);
}

/**
 * Decides which separator is the decimal point.
 *
 * With both present the later one wins. A lone comma is decimal unless the
 * string looks like thousands groups. A lone dot is decimal too, because
 * "19.99" is what people type on a German keyboard, unless the digits form
 * exact groups of three.
 */
function toMachineDecimal(input: string): string {
  const lastComma = input.lastIndexOf(',');
  const lastDot = input.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    return lastComma > lastDot
      ? input.replace(/\./g, '').replace(',', '.')
      : input.replace(/,/g, '');
  }

  if (lastComma > -1) {
    return /^\d{1,3}(,\d{3})+$/.test(input) ? input.replace(/,/g, '') : input.replace(',', '.');
  }

  if (lastDot > -1 && /^\d{1,3}(\.\d{3})+$/.test(input)) {
    return input.replace(/\./g, '');
  }

  return input;
}

/** Accepts "1.234,56", "1234.56", "1234,56", "-12" and "12 EUR". */
export function parseAmount(input: string | number | null | undefined): Cents {
  if (typeof input === 'number') return roundCents(input * 100);
  if (input === null || input === undefined) return 0;

  const trimmed = String(input).trim();
  if (!trimmed) return 0;

  const cleaned = stripNoise(trimmed);
  const negative = isNegative(cleaned);
  const digits = toMachineDecimal(cleaned.replace(/[()-]/g, ''));

  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return 0;

  return roundCents(value * 100) * (negative ? -1 : 1);
}

/** Cents to "1.234,56", without a currency sign. */
export function formatAmount(cents: Cents): string {
  const value = Number.isFinite(cents) ? cents : 0;
  return (value / 100).toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatEuro(cents: Cents): string {
  return `${formatAmount(cents)} €`;
}

/** Cents to "1234.56" for XML and CSV: dot separator, no grouping. */
export function decimalString(cents: Cents, digits = 2): string {
  const value = Number.isFinite(cents) ? cents : 0;
  return (value / 100).toFixed(digits);
}

export function sum(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const value of values) total += Number.isFinite(value) ? value : 0;
  return total;
}

export function percentOf(cents: Cents, percent: number): Cents {
  return roundCents((cents * percent) / 100);
}
