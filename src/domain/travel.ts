// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { roundCents } from './money';
import type { Cents, IsoDate } from '../shared/types';

/**
 * Per diem and mileage allowances.
 *
 * Two figures every freelancer needs and nobody remembers, because both hang
 * on conditions. They are flat rates: not evidenced but calculated, which is
 * exactly why they belong in software.
 *
 * Per diem under EStG 9 (4a), domestic travel: 14 euro for more than eight
 * hours away or for the days of arrival and departure, 28 euro for a full
 * day. Meals provided by someone else cut the rate, by 20 percent of the full
 * daily rate for breakfast and 40 percent each for lunch and dinner.
 *
 * Mileage is 0.30 euro per kilometre driven in your own car and covers all
 * vehicle costs, so claiming it rules out claiming fuel as well.
 *
 * Neither carries input VAT. There is no invoice behind a flat rate, so the
 * bookings are created at zero percent.
 */

export type DayKind = 'full' | 'partial' | 'arrival' | 'departure' | 'none';

export interface TravelDay {
  date?: IsoDate;
  kind: DayKind;
  breakfast?: boolean;
  lunch?: boolean;
  dinner?: boolean;
}

export interface DayAllowance {
  base: Cents;
  cut: Cents;
  amount: Cents;
}

export const RATES = {
  // As of 2026, unchanged for years.
  fullDay: 2800 as Cents,
  partialDay: 1400 as Cents,
  arrivalDeparture: 1400 as Cents,
  perKilometer: 30 as Cents,
  /** Cuts as a percentage of the full daily rate. */
  mealCuts: { breakfast: 20, lunch: 40, dinner: 40 }
} as const;

const BASE_BY_KIND: Record<DayKind, Cents> = {
  full: RATES.fullDay,
  partial: RATES.partialDay,
  arrival: RATES.arrivalDeparture,
  departure: RATES.arrivalDeparture,
  none: 0
};

function mealCutPercent(day: TravelDay): number {
  let percent = 0;
  if (day.breakfast) percent += RATES.mealCuts.breakfast;
  if (day.lunch) percent += RATES.mealCuts.lunch;
  if (day.dinner) percent += RATES.mealCuts.dinner;
  return percent;
}

/**
 * The cut always comes off the full daily rate, even on a partial day. That
 * is where most people miscalculate.
 */
export function dayAllowance(day: TravelDay = { kind: 'none' }): DayAllowance {
  const base = BASE_BY_KIND[day.kind] ?? 0;
  if (!base) return { base: 0, cut: 0, amount: 0 };

  const cut = roundCents((RATES.fullDay * mealCutPercent(day)) / 100);
  return { base, cut, amount: Math.max(0, base - cut) };
}

export interface Trip {
  days?: TravelDay[];
  kilometers?: number;
  description?: string;
  from?: IsoDate;
  to?: IsoDate;
  date?: IsoDate;
}

export interface TripResult {
  days: Array<TravelDay & DayAllowance>;
  dayCount: number;
  meals: Cents;
  kilometers: number;
  mileage: Cents;
  total: Cents;
  rates: typeof RATES;
}

export function calculate(trip: Trip = {}): TripResult {
  const days = (trip.days ?? []).map((day) => ({ ...day, ...dayAllowance(day) }));

  const meals = days.reduce((total, day) => total + day.amount, 0);
  const kilometers = Math.max(0, Number(trip.kilometers) || 0);
  const mileage = roundCents(kilometers * RATES.perKilometer);

  return {
    days,
    dayCount: days.filter((day) => day.amount > 0).length,
    meals,
    kilometers,
    mileage,
    total: meals + mileage,
    rates: RATES
  };
}

/**
 * Splits a trip into days.
 *
 * One day longer than eight hours gives the small rate; several days give
 * arrival and departure plus full days between. How long a single day really
 * lasted only the traveller knows, so this is a starting point they can edit.
 */
export function daysBetween(
  from: IsoDate | null | undefined,
  to?: IsoDate | null,
  options: { hoursOver8?: boolean } = {}
): TravelDay[] {
  if (!from) return [];

  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to || from}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const dates: IsoDate[] = [];
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
  }

  if (dates.length === 1) {
    return [{ date: dates[0]!, kind: options.hoursOver8 === false ? 'none' : 'partial' }];
  }

  return dates.map((date, index) => ({
    date,
    kind: index === 0 ? 'arrival' : (index === dates.length - 1 ? 'departure' : 'full')
  }));
}

/** The bookings a trip turns into, ready for normalizeEntry. */
export function toEntries(trip: Trip, result: TripResult): Array<Record<string, unknown>> {
  const description = trip.description || 'Dienstreise';
  const date = trip.from || trip.date;
  const entries: Array<Record<string, unknown>> = [];

  const base = {
    type: 'expense',
    date,
    paidDate: date,
    counterparty: '',
    basis: 'gross',
    vatRate: 0,
    paymentMethod: 'other'
  };

  if (result.meals > 0) {
    entries.push({
      ...base,
      categoryId: 'exp_perdiem',
      description: `Verpflegungsmehraufwand ${description}`,
      amount: result.meals,
      note: `${result.dayCount} ${result.dayCount === 1 ? 'Tag' : 'Tage'} nach §9 Abs. 4a EStG, Pauschale ohne Vorsteuerabzug`
    });
  }

  if (result.mileage > 0) {
    entries.push({
      ...base,
      categoryId: 'exp_mileage',
      description: `Fahrtkosten ${description}`,
      amount: result.mileage,
      note: `${result.kilometers} km zu 0,30 Euro, Pauschale ohne Vorsteuerabzug`
    });
  }

  return entries;
}
