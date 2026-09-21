// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import type { Customer, Id } from '../shared/types';

/**
 * Customer numbers are assigned by the user, not generated. Anyone who has
 * invoiced before brings their own numbering, and an automatic scheme would
 * overwrite it. These helpers only cover the two places where numbers handed
 * out manually go wrong: suggesting the next free one, and catching a number
 * given out twice.
 */

type NumberedCustomer = Pick<Customer, 'id' | 'customerNumber'>;

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
}

/** Empty never equals empty, otherwise every blank number would collide. */
export function sameNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalize(a);
  return left !== '' && left === normalize(b);
}

export function findDuplicate<T extends NumberedCustomer>(
  customers: readonly T[] | null | undefined,
  customerNumber: string | null | undefined,
  exceptId?: Id
): T | null {
  if (!normalize(customerNumber)) return null;

  return (customers ?? []).find(
    (customer) => customer.id !== exceptId && sameNumber(customer.customerNumber, customerNumber)
  ) ?? null;
}

/**
 * Keeps the width of the existing numbers, so 0001 and 0005 give 0006 rather
 * than 6 and the list still sorts. Numbers containing letters are ignored,
 * because guessing which part counts up is how you corrupt someone's records.
 */
export function nextNumber(customers: readonly NumberedCustomer[] | null | undefined): string {
  const numeric = (customers ?? [])
    .map((customer) => String(customer.customerNumber ?? '').trim())
    .filter((value) => /^\d+$/.test(value));

  if (numeric.length === 0) return '0001';

  const highest = numeric.reduce((max, value) => Math.max(max, Number(value)), 0);
  const width = Math.max(...numeric.map((value) => value.length));

  return String(highest + 1).padStart(width, '0');
}
