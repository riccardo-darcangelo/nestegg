// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { roundCents } from './money';
import type { Asset, Cents, Id, IsoDate, IsoTimestamp } from '../shared/types';
export type { Asset } from '../shared/types';

/**
 * Fixed assets and straight-line depreciation.
 *
 * In the year of purchase only the months from the purchase month count
 * (EStG 7 (1) 4), which stretches depreciation across the useful life plus
 * one partial year. Whatever is left goes into the final year, so the total
 * matches the acquisition cost exactly.
 */

export interface DepreciationRow {
  year: number;
  amount: Cents;
  bookValueEnd: Cents;
}

/** Common useful lives from the official tables, offered as suggestions. */
export const USEFUL_LIFE_SUGGESTIONS = [
  { label: 'Computer, Notebook, Peripherie', years: 1 },
  { label: 'Software', years: 1 },
  { label: 'Smartphone, Tablet', years: 3 },
  { label: 'Büromöbel', years: 13 },
  { label: 'Werkzeuge, Maschinen', years: 8 },
  { label: 'Pkw', years: 6 },
  { label: 'Fahrrad, Lastenrad', years: 7 }
] as const;

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function parseIsoDate(iso: string | null | undefined): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!match) return null;

  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function normalizeAsset(raw: Partial<Asset> & Record<string, unknown>): Asset {
  const now = new Date().toISOString();

  return {
    id: raw.id as Id,
    label: String(raw.label ?? '').trim(),
    purchaseDate: raw.purchaseDate as IsoDate,
    netCents: Math.max(0, Math.trunc(Number(raw.netCents) || 0)),
    usefulLifeYears: Math.max(1, Math.round(Number(raw.usefulLifeYears) || 1)),
    disposalDate: raw.disposalDate ?? null,
    entryId: raw.entryId ?? null,
    note: String(raw.note ?? '').trim(),
    createdAt: raw.createdAt ?? now,
    updatedAt: now
  };
}

/** The full plan, one row per year that carries depreciation. */
export function schedule(asset: Asset): DepreciationRow[] {
  const start = parseIsoDate(asset.purchaseDate);
  if (!start || !asset.netCents) return [];

  const years = asset.usefulLifeYears;
  const annual = asset.netCents / years;
  const monthsInFirstYear = 13 - start.month;

  const rows: DepreciationRow[] = [];
  let remaining = asset.netCents;
  let year = start.year;
  let amount = roundCents((annual * monthsInFirstYear) / 12);

  // Runs while value is left, which is at most the useful life plus one year.
  for (let index = 0; index <= years && remaining > 0; index += 1) {
    if (index > 0) amount = roundCents(annual);
    if (index === years || amount >= remaining) amount = remaining;

    remaining -= amount;
    rows.push({ year, amount, bookValueEnd: remaining });
    year += 1;
  }

  return rows;
}

export function depreciationForYear(asset: Asset, year: number): Cents {
  return schedule(asset).find((row) => row.year === year)?.amount ?? 0;
}

export function bookValueAtEndOf(asset: Asset, year: number): Cents {
  const rows = schedule(asset);
  if (rows.length === 0) return 0;

  const past = rows.filter((row) => row.year <= year);
  return past.at(-1)?.bookValueEnd ?? asset.netCents;
}

export function totalDepreciation(assets: readonly Asset[], year: number): Cents {
  return assets.reduce((total, asset) => total + depreciationForYear(asset, year), 0);
}
