// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import type {
  IntervalId,
  IsoDate,
  RecurrenceRule
} from '../shared/types';

export type { IntervalId, RecurrenceRule } from '../shared/types';

/**
 * Recurrence rules.
 *
 * A rule describes a sequence of dates, not a state. Every date is computed
 * from the start, never from the one generated before it. Otherwise a monthly
 * rule anchored on the 31st slides to the 28th after one February and never
 * comes back.
 *
 * The anchor day is therefore stored and clamped to the length of each month
 * as it comes.
 */

interface IntervalSpec {
  label: string;
  months: number;
  weeks?: number;
}

export const INTERVALS: Record<IntervalId, IntervalSpec> = {
  weekly: { label: 'Wöchentlich', months: 0, weeks: 1 },
  biweekly: { label: 'Alle zwei Wochen', months: 0, weeks: 2 },
  monthly: { label: 'Monatlich', months: 1 },
  quarterly: { label: 'Vierteljährlich', months: 3 },
  halfyearly: { label: 'Halbjährlich', months: 6 },
  yearly: { label: 'Jährlich', months: 12 }
};

/** Guards against endless loops when a rule is broken. */
const MAX_OCCURRENCES = 500;

function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parse(iso: IsoDate): { year: number; month: number; day: number } {
  const [year, month, day] = String(iso).split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

function format(year: number, month: number, day: number): IsoDate {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isIntervalId(value: unknown): value is IntervalId {
  return typeof value === 'string' && value in INTERVALS;
}

export function normalizeRule(raw: Partial<RecurrenceRule> | null | undefined): RecurrenceRule {
  const startDate = isIsoDate(raw?.startDate) ? raw.startDate : null;

  // Without an explicit anchor the day of the start date is it.
  let anchorDay = Number(raw?.anchorDay);
  if (!Number.isFinite(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    anchorDay = startDate ? parse(startDate).day : 1;
  }

  const occurrences = Number(raw?.occurrences);

  return {
    interval: isIntervalId(raw?.interval) ? raw.interval : 'monthly',
    every: Math.min(24, Math.max(1, Math.round(Number(raw?.every) || 1))),
    anchorDay,
    startDate,
    endDate: isIsoDate(raw?.endDate) ? raw.endDate : null,
    occurrences: Number.isFinite(occurrences) && occurrences > 0 ? Math.round(occurrences) : null
  };
}

export function validateRule(rule: RecurrenceRule): string[] {
  const errors: string[] = [];

  if (!rule.startDate) errors.push('Die Wiederholung braucht ein Startdatum.');
  if (rule.endDate && rule.startDate && rule.endDate < rule.startDate) {
    errors.push('Das Ende der Wiederholung liegt vor ihrem Beginn.');
  }
  if (!INTERVALS[rule.interval]) errors.push('Unbekannter Rhythmus.');

  return errors;
}

/** The nth date of a rule, counted from zero, or null once it has ended. */
export function occurrenceAt(rule: RecurrenceRule, index: number): IsoDate | null {
  if (!rule.startDate || index < 0) return null;
  if (rule.occurrences && index >= rule.occurrences) return null;

  const spec = INTERVALS[rule.interval];
  let date: IsoDate;

  if (spec.weeks) {
    // On a weekly rhythm the day of month plays no part.
    date = addDays(rule.startDate, spec.weeks * rule.every * index * 7);
  } else {
    const start = parse(rule.startDate);
    const totalMonths = (start.month - 1) + spec.months * rule.every * index;
    const year = start.year + Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;

    date = format(year, month, Math.min(rule.anchorDay, lastDayOfMonth(year, month)));
  }

  if (rule.endDate && date > rule.endDate) return null;
  return date;
}

/** Walks the sequence until the callback says to stop. */
function walk(rule: RecurrenceRule, visit: (date: IsoDate) => boolean | void): void {
  for (let index = 0; index < MAX_OCCURRENCES; index += 1) {
    const date = occurrenceAt(rule, index);
    if (date === null) return;
    if (visit(date) === false) return;
  }
}

/** All dates in the range, both bounds included. */
export function occurrencesBetween(
  rule: RecurrenceRule,
  from: IsoDate | null | undefined,
  to: IsoDate | null | undefined
): IsoDate[] {
  const dates: IsoDate[] = [];
  if (!rule.startDate || !to) return dates;

  walk(rule, (date) => {
    if (date > to) return false;
    if (!from || date >= from) dates.push(date);
    return true;
  });

  return dates;
}

/** The next date strictly after the given one. */
export function nextAfter(rule: RecurrenceRule, date: IsoDate | null | undefined): IsoDate | null {
  let found: IsoDate | null = null;

  walk(rule, (candidate) => {
    if (!date || candidate > date) {
      found = candidate;
      return false;
    }
    return true;
  });

  return found;
}

/** The first date on or after the given one. */
export function firstFrom(rule: RecurrenceRule, date: IsoDate | null | undefined): IsoDate | null {
  let found: IsoDate | null = null;

  walk(rule, (candidate) => {
    if (!date || candidate >= date) {
      found = candidate;
      return false;
    }
    return true;
  });

  return found;
}

export function isFinished(rule: RecurrenceRule, today: IsoDate): boolean {
  return nextAfter(rule, addDays(today, -1)) === null;
}

function rhythmText(rule: RecurrenceRule, spec: IntervalSpec): string {
  if (spec.weeks) {
    const weeks = spec.weeks * rule.every;
    return weeks === 1 ? 'Jede Woche' : `Alle ${weeks} Wochen`;
  }
  if (rule.every === 1) return spec.label;
  return `Alle ${spec.months * rule.every} Monate`;
}

function limitText(rule: RecurrenceRule): string {
  if (rule.occurrences) return `, ${rule.occurrences} mal`;
  if (!rule.endDate) return '';

  const [year, month, day] = rule.endDate.split('-');
  return `, bis ${day}.${month}.${year}`;
}

/** The rule in one sentence, for the interface. */
export function describe(rule: RecurrenceRule): string {
  const spec = INTERVALS[rule.interval];
  if (!spec || !rule.startDate) return 'Ohne Rhythmus';

  let text = rhythmText(rule, spec);

  if (!spec.weeks) {
    text += rule.anchorDay >= 29
      ? `, am ${rule.anchorDay}. oder am Monatsletzten`
      : `, jeweils am ${rule.anchorDay}.`;
  }

  return text + limitText(rule);
}
