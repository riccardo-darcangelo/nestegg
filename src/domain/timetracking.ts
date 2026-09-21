// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { roundCents } from './money';
import type { Project } from './projects';
import type { Cents, Id, IsoDate, IsoTimestamp, Settings } from '../shared/types';

/**
 * Time tracking.
 *
 * Built for the question that matters at the end of the month: what has been
 * done and not yet billed? Hours become invoice lines, and only through an
 * invoice does an hour touch the books. A tracked hour on its own is not a
 * business transaction.
 *
 * Two decisions shape everything else. Minutes are stored, not hours, because
 * anything else ends in 0.3333 hours and totals that do not add up; the
 * conversion happens once, on the invoice. And a running timer is simply an
 * entry without an end, so there is no second place for it to live and a
 * crash cannot lose it.
 */

export const ROUNDING = [
  { value: 1, label: 'minutengenau' },
  { value: 5, label: 'auf 5 Minuten' },
  { value: 15, label: 'auf 15 Minuten' },
  { value: 30, label: 'auf 30 Minuten' }
] as const;

export interface TimeSettings {
  defaultRateCents: Cents;
  roundToMinutes: number;
  /** Started quarter hours usually count, so rounding goes up by default. */
  roundUp: boolean;
  unit: string;
}

export const DEFAULT_SETTINGS: TimeSettings = {
  defaultRateCents: 0,
  roundToMinutes: 15,
  roundUp: true,
  unit: 'HUR'
};

export interface TimeEntry {
  id: Id | null;
  date: IsoDate;
  projectId: Id | null;
  customerId: Id | null;
  description: string;
  minutes: number;
  /** Held on the entry, not just on the project, so past work keeps its rate. */
  rateCents: Cents;
  billable: boolean;
  /** Set while the timer runs, cleared when it stops. */
  startedAt: IsoTimestamp | null;
  invoiceId: Id | null;
  invoicedAt: IsoTimestamp | null;
  note: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayIso(): IsoDate {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function normalizeTime(raw: Partial<TimeEntry>): TimeEntry {
  const now = new Date().toISOString();

  return {
    id: raw.id ?? null,
    date: isIsoDate(raw.date) ? raw.date : todayIso(),
    projectId: raw.projectId ?? null,
    customerId: raw.customerId ?? null,
    description: String(raw.description ?? '').trim(),
    minutes: Math.max(0, Math.round(Number(raw.minutes) || 0)),
    rateCents: Math.max(0, Math.trunc(Number(raw.rateCents) || 0)),
    billable: raw.billable !== false,
    startedAt: raw.startedAt ?? null,
    invoiceId: raw.invoiceId ?? null,
    invoicedAt: raw.invoicedAt ?? null,
    note: String(raw.note ?? '').trim(),
    createdAt: raw.createdAt ?? now,
    updatedAt: now
  };
}

const MINUTES_PER_DAY = 24 * 60;

export function validateTime(entry: TimeEntry): string[] {
  const errors: string[] = [];

  if (!entry.description && !entry.projectId) {
    errors.push('Ohne Projekt braucht der Eintrag wenigstens eine Beschreibung.');
  }
  if (!entry.startedAt && entry.minutes <= 0) errors.push('Die Dauer ist null.');
  if (entry.minutes > MINUTES_PER_DAY) {
    errors.push('Mehr als vierundzwanzig Stunden an einem Tag sind nicht plausibel.');
  }

  return errors;
}

export function running(times: readonly TimeEntry[] | null | undefined): TimeEntry | null {
  return (times ?? []).find((entry) => entry.startedAt && !entry.minutes) ?? null;
}

export function runningMinutes(entry: TimeEntry | null | undefined, now = Date.now()): number {
  if (!entry?.startedAt) return 0;

  const started = new Date(entry.startedAt).getTime();
  if (!Number.isFinite(started)) return 0;

  return Math.max(0, Math.floor((now - started) / 60_000));
}

export function roundMinutes(minutes: number, settings: Partial<TimeSettings> | null | undefined): number {
  const step = Math.max(1, Math.trunc(settings?.roundToMinutes || 1));
  if (step === 1) return Math.round(minutes);

  return settings?.roundUp === false
    ? Math.round(minutes / step) * step
    : Math.ceil(minutes / step) * step;
}

/** Rounding applies here, not while the clock runs: that one shows the truth. */
export function stop(
  entry: TimeEntry,
  settings: Partial<TimeSettings> | null | undefined,
  now = Date.now()
): TimeEntry {
  const config = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };

  return {
    ...entry,
    minutes: Math.max(config.roundToMinutes, roundMinutes(runningMinutes(entry, now), config)),
    startedAt: null,
    updatedAt: new Date().toISOString()
  };
}

export function amountOf(entry: TimeEntry): Cents {
  if (!entry.billable || !entry.rateCents) return 0;
  return roundCents((entry.minutes / 60) * entry.rateCents);
}

/** Minutes as "7:30", the notation everyone reads at a glance. */
export function durationText(minutes: number): string {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Minutes as decimal hours, for the invoice. */
export function decimalHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export interface TimeSummary {
  count: number;
  minutes: number;
  billableMinutes: number;
  openMinutes: number;
  openAmount: Cents;
  invoicedAmount: Cents;
}

const sumMinutes = (list: readonly TimeEntry[]): number =>
  list.reduce((total, entry) => total + entry.minutes, 0);

const sumAmount = (list: readonly TimeEntry[]): Cents =>
  list.reduce((total, entry) => total + amountOf(entry), 0);

export function summarize(times: readonly TimeEntry[] | null | undefined): TimeSummary {
  const finished = (times ?? []).filter((entry) => !entry.startedAt);
  const billable = finished.filter((entry) => entry.billable);
  const open = billable.filter((entry) => !entry.invoiceId);

  return {
    count: finished.length,
    minutes: sumMinutes(finished),
    billableMinutes: sumMinutes(billable),
    openMinutes: sumMinutes(open),
    openAmount: sumAmount(open),
    invoicedAmount: sumAmount(billable.filter((entry) => entry.invoiceId))
  };
}

export interface ProjectGroup {
  projectId: Id | null;
  name: string;
  customerId: Id | null;
  entries: TimeEntry[];
  minutes: number;
  openMinutes: number;
  openAmount: Cents;
}

export function byProject(
  times: readonly TimeEntry[] | null | undefined,
  projects: readonly Project[] | null | undefined
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();

  for (const entry of times ?? []) {
    if (entry.startedAt) continue;

    const key = entry.projectId ?? '__none';
    let group = groups.get(key);

    if (!group) {
      const project = (projects ?? []).find((item) => item.id === entry.projectId);
      group = {
        projectId: entry.projectId,
        name: project?.name ?? 'ohne Projekt',
        customerId: project?.customerId ?? entry.customerId,
        entries: [],
        minutes: 0,
        openMinutes: 0,
        openAmount: 0
      };
      groups.set(key, group);
    }

    group.entries.push(entry);
    group.minutes += entry.minutes;

    if (entry.billable && !entry.invoiceId) {
      group.openMinutes += entry.minutes;
      group.openAmount += amountOf(entry);
    }
  }

  return [...groups.values()].sort(
    (a, b) => b.openMinutes - a.openMinutes || a.name.localeCompare(b.name, 'de')
  );
}

export function byMonth(
  times: readonly TimeEntry[] | null | undefined,
  year: number
): Array<{ month: number; minutes: number; amount: Cents }> {
  const months = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, minutes: 0, amount: 0 }));

  for (const entry of times ?? []) {
    if (entry.startedAt) continue;
    if (String(entry.date).slice(0, 4) !== String(year)) continue;

    const month = months[Number(entry.date.slice(5, 7)) - 1];
    if (!month) continue;

    month.minutes += entry.minutes;
    month.amount += amountOf(entry);
  }

  return months;
}

function formatDate(iso: string | null | undefined): string {
  const [year, month, day] = String(iso ?? '').split('-');
  return day ? `${day}.${month}.${year}` : String(iso ?? '');
}

export interface InvoiceItemDraft {
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceNet: Cents;
  vatRate: number;
}

export interface ToItemsOptions {
  mode?: 'summary' | 'daily' | 'single';
  vatRate?: number;
  unit?: string;
  label?: string;
}

function billableAndOpen(times: readonly TimeEntry[] | null | undefined): TimeEntry[] {
  return (times ?? []).filter((entry) => entry.billable && !entry.invoiceId && !entry.startedAt);
}

function oneLinePerEntry(list: readonly TimeEntry[], unit: string, vatRate: number): InvoiceItemDraft[] {
  return list.map((entry) => ({
    name: entry.description || 'Leistung',
    description: `${formatDate(entry.date)}, ${durationText(entry.minutes)} Stunden`,
    quantity: decimalHours(entry.minutes),
    unit,
    unitPriceNet: entry.rateCents,
    vatRate
  }));
}

function oneLinePerDay(list: readonly TimeEntry[], unit: string, vatRate: number): InvoiceItemDraft[] {
  const days = new Map<string, { date: IsoDate; rate: Cents; minutes: number; texts: string[] }>();

  for (const entry of list) {
    const key = `${entry.date}|${entry.rateCents}`;
    const day = days.get(key) ?? { date: entry.date, rate: entry.rateCents, minutes: 0, texts: [] };

    day.minutes += entry.minutes;
    if (entry.description) day.texts.push(entry.description);
    days.set(key, day);
  }

  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => ({
      name: `Leistungen ${formatDate(day.date)}`,
      description: [...new Set(day.texts)].join(', '),
      quantity: decimalHours(day.minutes),
      unit,
      unitPriceNet: day.rate,
      vatRate
    }));
}

function oneLinePerRate(
  list: readonly TimeEntry[],
  unit: string,
  vatRate: number,
  label?: string
): InvoiceItemDraft[] {
  const rates = new Map<Cents, { rate: Cents; minutes: number; texts: string[]; from: IsoDate; to: IsoDate }>();

  for (const entry of list) {
    const group = rates.get(entry.rateCents)
      ?? { rate: entry.rateCents, minutes: 0, texts: [], from: entry.date, to: entry.date };

    group.minutes += entry.minutes;
    if (entry.description) group.texts.push(entry.description);
    if (entry.date < group.from) group.from = entry.date;
    if (entry.date > group.to) group.to = entry.date;

    rates.set(entry.rateCents, group);
  }

  return [...rates.values()].map((group) => ({
    name: label || 'Geleistete Stunden',
    description: [
      group.from === group.to
        ? formatDate(group.from)
        : `Zeitraum ${formatDate(group.from)} bis ${formatDate(group.to)}`,
      [...new Set(group.texts)].slice(0, 12).join(', ')
    ].filter(Boolean).join(': '),
    quantity: decimalHours(group.minutes),
    unit,
    unitPriceNet: group.rate,
    vatRate
  }));
}

/**
 * Turns tracked time into invoice lines.
 *
 * The summary mode groups by rate, because nobody wants forty-three lines on
 * an invoice. Whoever needs the detail gets it from the timesheet, not from
 * the invoice.
 */
export function toInvoiceItems(
  times: readonly TimeEntry[] | null | undefined,
  options: ToItemsOptions = {}
): InvoiceItemDraft[] {
  const list = billableAndOpen(times);
  if (list.length === 0) return [];

  const unit = options.unit || DEFAULT_SETTINGS.unit;
  const vatRate = options.vatRate ?? 19;

  if (options.mode === 'single') return oneLinePerEntry(list, unit, vatRate);
  if (options.mode === 'daily') return oneLinePerDay(list, unit, vatRate);
  return oneLinePerRate(list, unit, vatRate, options.label);
}

/** The project rate wins over the default from the settings. */
export function rateFor(
  projectId: Id | null | undefined,
  projects: readonly Project[] | null | undefined,
  settings: Settings | null | undefined
): Cents {
  const project = (projects ?? []).find((item) => item.id === projectId);
  if (project?.hourlyRateCents) return project.hourlyRateCents;

  return ((settings?.time ?? {}) as Partial<TimeSettings>).defaultRateCents ?? 0;
}
