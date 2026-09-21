// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { taxEffect } from './entries';
import { getCategory } from './categories';
import { taxYearOf } from './euer';
import { segmentLabel, listSegments } from './segments';
import { isEuCountry } from './tax';
import type { Project } from './projects';
import type { BusinessDocument, Cents, CountryCode, Customer, Entry, Id, Settings } from '../shared/types';

/**
 * Reporting by segment, country, customer and project.
 *
 * Everything is net. VAT is a pass-through item that belongs to the tax
 * office and says nothing about how a segment is doing. The cash basis
 * matches the profit statement, so the numbers agree with the profit the
 * program reports elsewhere.
 *
 * Unpaid bookings stay out, as do payments to the tax office: they are not
 * business and would distort every ratio.
 */

const COUNTRY_NAMES: Record<string, string> = {
  DE: 'Deutschland', AT: 'Österreich', CH: 'Schweiz', IE: 'Irland', NL: 'Niederlande',
  FR: 'Frankreich', IT: 'Italien', ES: 'Spanien', PT: 'Portugal', BE: 'Belgien',
  LU: 'Luxemburg', DK: 'Dänemark', SE: 'Schweden', FI: 'Finnland', PL: 'Polen',
  CZ: 'Tschechien', SK: 'Slowakei', HU: 'Ungarn', RO: 'Rumänien', BG: 'Bulgarien',
  GR: 'Griechenland', HR: 'Kroatien', SI: 'Slowenien', EE: 'Estland', LV: 'Lettland',
  LT: 'Litauen', CY: 'Zypern', MT: 'Malta', GB: 'Vereinigtes Königreich',
  US: 'Vereinigte Staaten', CA: 'Kanada', AU: 'Australien', NO: 'Norwegen'
};

export type Zone = 'Inland' | 'EU-Ausland' | 'Drittland';

export function countryName(code: string | null | undefined): string {
  const key = String(code ?? '').toUpperCase();
  return COUNTRY_NAMES[key] ?? key ?? 'Ohne Land';
}

export function countryZone(code: string | null | undefined): Zone {
  const key = String(code ?? 'DE').toUpperCase();
  if (key === 'DE') return 'Inland';
  return isEuCountry(key) ? 'EU-Ausland' : 'Drittland';
}

/** Drops unpaid bookings and anything that settles with the tax office. */
export function relevantEntries(entries: readonly Entry[], year: number): Entry[] {
  return entries.filter(
    (entry) => taxYearOf(entry) === year && !getCategory(entry.categoryId)?.settlement
  );
}

export interface ReportRow {
  key: string;
  label: string;
  revenue: Cents;
  cost: Cents;
  result: Cents;
  /** Percentage of total revenue, one decimal. */
  share: number;
  entries: number;
  [extra: string]: unknown;
}

interface Bucket {
  key: string;
  label: string;
  extra?: Record<string, unknown>;
}

function emptyRow(key: string, label: string, extra: Record<string, unknown> = {}): ReportRow {
  return { key, label, revenue: 0, cost: 0, result: 0, share: 0, entries: 0, ...extra };
}

/** Groups by any dimension the caller cares to name. */
export function groupBy(
  entries: readonly Entry[],
  keyOf: (entry: Entry) => Bucket | null | undefined
): ReportRow[] {
  const rows = new Map<string, ReportRow>();
  let totalRevenue = 0;

  for (const entry of entries) {
    const bucket = keyOf(entry);
    if (!bucket) continue;

    const row = rows.get(bucket.key) ?? emptyRow(bucket.key, bucket.label, bucket.extra);
    const effect = taxEffect(entry);
    row.entries += 1;

    if (entry.type === 'income') {
      row.revenue += effect.businessNet;
      totalRevenue += effect.businessNet;
    } else {
      row.cost += effect.euerAmount;
    }

    rows.set(bucket.key, row);
  }

  for (const row of rows.values()) {
    row.result = row.revenue - row.cost;
    row.share = totalRevenue ? Math.round((row.revenue / totalRevenue) * 1000) / 10 : 0;
  }

  return [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.result - a.result);
}

function colorOf(settings: Settings, segmentId: Id | null): string {
  return listSegments(settings).find((segment) => segment.id === segmentId)?.color ?? '#8d99ab';
}

function changePercent(before: Cents, now: Cents): number | null {
  if (!before) return null;
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
}

const sumNet = (entries: readonly Entry[]): Cents =>
  entries.filter((entry) => entry.type === 'income')
    .reduce((total, entry) => total + taxEffect(entry).businessNet, 0);

const sumCost = (entries: readonly Entry[]): Cents =>
  entries.filter((entry) => entry.type === 'expense')
    .reduce((total, entry) => total + taxEffect(entry).euerAmount, 0);

export interface MonthlySegment {
  month: number;
  revenue: Cents;
  cost: Cents;
  bySegment: Record<string, Cents>;
}

function monthlyBySegment(entries: readonly Entry[], settings: Settings): MonthlySegment[] {
  const segments = listSegments(settings);
  const months: MonthlySegment[] = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    revenue: 0,
    cost: 0,
    bySegment: Object.fromEntries(segments.map((segment) => [segment.id, 0]))
  }));

  for (const entry of entries) {
    if (!entry.paidDate) continue;

    const month = months[Number(entry.paidDate.slice(5, 7)) - 1];
    if (!month) continue;

    const effect = taxEffect(entry);

    if (entry.type === 'income') {
      month.revenue += effect.businessNet;
      const key = entry.segmentId ?? 'ohne';
      month.bySegment[key] = (month.bySegment[key] ?? 0) + effect.businessNet;
    } else {
      month.cost += effect.euerAmount;
    }
  }

  return months;
}

export interface RecurringRevenue {
  recurring: Cents;
  onetime: Cents;
  share: number;
  months: Cents[];
  currentMonthly: Cents;
  annualRunRate: Cents;
}

/**
 * For a subscription business this is the number that matters, and it becomes
 * useless the moment one-off payments get mixed in. Every income therefore
 * carries whether it recurs.
 */
function recurringRevenue(income: readonly Entry[]): RecurringRevenue {
  const months: Cents[] = Array.from({ length: 12 }, () => 0);
  let recurring = 0;
  let onetime = 0;

  for (const entry of income) {
    const net = taxEffect(entry).businessNet;

    if (entry.revenueKind !== 'recurring') {
      onetime += net;
      continue;
    }

    recurring += net;
    if (!entry.paidDate) continue;

    const index = Number(entry.paidDate.slice(5, 7)) - 1;
    if (index >= 0 && index < 12) months[index] = (months[index] ?? 0) + net;
  }

  // The run rate comes from the last month that saw any recurring income.
  const lastActive = months.reduce((last, value, index) => (value ? index : last), -1);
  const total = recurring + onetime;

  return {
    recurring,
    onetime,
    share: total ? Math.round((recurring / total) * 1000) / 10 : 0,
    months,
    currentMonthly: lastActive >= 0 ? months[lastActive]! : 0,
    annualRunRate: lastActive >= 0 ? months[lastActive]! * 12 : 0
  };
}

export interface Concentration {
  top1: number;
  top3: number;
  customerCount: number;
  largest?: string;
  risk: string;
}

/** How much the revenue hangs on single customers. */
function concentration(byCustomer: readonly ReportRow[], revenue: Cents): Concentration {
  if (!revenue || byCustomer.length === 0) {
    return { top1: 0, top3: 0, customerCount: 0, risk: 'keine Daten' };
  }

  const sorted = [...byCustomer].sort((a, b) => b.revenue - a.revenue);
  const shareOfTop = (count: number): number =>
    Math.round((sorted.slice(0, count).reduce((total, row) => total + row.revenue, 0) / revenue) * 1000) / 10;

  const top1 = shareOfTop(1);

  return {
    top1,
    top3: shareOfTop(3),
    customerCount: sorted.length,
    largest: sorted[0]!.label,
    risk: top1 >= 60 ? 'hoch' : top1 >= 35 ? 'spürbar' : 'verteilt'
  };
}

export interface PaymentBehaviourRow {
  key: string;
  label: string;
  invoices: number;
  averageDays: number;
  slowest: number;
  overdue: number;
}

/** How long customers take to pay, counted from the invoice date. */
function paymentBehaviour(
  invoices: readonly BusinessDocument[],
  customers: Map<Id, Customer>
): { customers: PaymentBehaviourRow[]; averageDays: number | null } {
  const collected = new Map<string, { key: string; label: string; days: number[]; overdue: number }>();

  for (const invoice of invoices) {
    if (invoice.documentType && invoice.documentType !== 'invoice') continue;
    if (!invoice.issueDate || !invoice.payments?.length) continue;

    const lastPayment = [...invoice.payments]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .at(-1);
    if (!lastPayment?.date) continue;

    const days = Math.round(
      (new Date(`${lastPayment.date}T00:00:00Z`).getTime()
        - new Date(`${invoice.issueDate}T00:00:00Z`).getTime()) / 86_400_000
    );

    const key = invoice.customerId || 'ohne';
    const row = collected.get(key)
      ?? { key, label: customers.get(key)?.name ?? 'Ohne Kunde', days: [], overdue: 0 };

    row.days.push(days);
    if (invoice.dueDate && lastPayment.date > invoice.dueDate) row.overdue += 1;
    collected.set(key, row);
  }

  const average = (values: readonly number[]): number =>
    Math.round(values.reduce((total, value) => total + value, 0) / values.length);

  const rows = [...collected.values()].map((row) => ({
    key: row.key,
    label: row.label,
    invoices: row.days.length,
    averageDays: average(row.days),
    slowest: Math.max(...row.days),
    overdue: row.overdue
  }));

  const allDays = rows.flatMap((row) => new Array<number>(row.invoices).fill(row.averageDays));

  return {
    customers: rows.sort((a, b) => b.averageDays - a.averageDays),
    averageDays: allDays.length ? average(allDays) : null
  };
}

export interface AnalyticsData {
  entries?: Entry[];
  customers?: Customer[];
  invoices?: BusinessDocument[];
  projects?: Project[];
  settings?: Settings;
}

export function analyze(data: AnalyticsData, year: number) {
  const settings = data.settings ?? ({} as Settings);
  const entries = relevantEntries(data.entries ?? [], year);
  const previous = relevantEntries(data.entries ?? [], year - 1);

  const customers = new Map((data.customers ?? []).map((customer) => [customer.id, customer]));
  const projects = new Map((data.projects ?? []).map((project) => [project.id!, project]));

  const income = entries.filter((entry) => entry.type === 'income');
  const revenue = sumNet(entries);
  const cost = sumCost(entries);
  const previousRevenue = sumNet(previous);
  const previousCost = sumCost(previous);

  const byCustomer = groupBy(income, (entry) => {
    const customer = entry.customerId ? customers.get(entry.customerId) : undefined;
    if (customer) {
      return { key: entry.customerId!, label: customer.name, extra: { country: customer.country } };
    }

    // Bookings without a linked customer still say something, so they group
    // by the name that was typed.
    const name = entry.counterparty || 'Ohne Kunde';
    return { key: `text:${name.toLowerCase()}`, label: name, extra: { unlinked: true } };
  });

  return {
    year,
    totals: {
      revenue,
      cost,
      result: revenue - cost,
      previousRevenue,
      previousCost,
      previousResult: previousRevenue - previousCost,
      revenueChange: changePercent(previousRevenue, revenue),
      resultChange: changePercent(previousRevenue - previousCost, revenue - cost)
    },
    bySegment: groupBy(entries, (entry) => ({
      key: entry.segmentId ?? 'ohne',
      label: entry.segmentId ? segmentLabel(settings, entry.segmentId) : 'Ohne Bereich',
      extra: { color: colorOf(settings, entry.segmentId) }
    })),
    byCountry: groupBy(entries, (entry) => {
      const code = (entry.countryCode || 'DE').toUpperCase();
      return { key: code, label: countryName(code), extra: { zone: countryZone(code) } };
    }),
    byZone: groupBy(entries, (entry) => {
      const zone = countryZone(entry.countryCode);
      return { key: zone, label: zone };
    }),
    byCustomer,
    byProject: groupBy(entries.filter((entry) => entry.projectId), (entry) => {
      const project = projects.get(entry.projectId!);
      return {
        key: entry.projectId!,
        label: project?.name ?? 'Unbekanntes Projekt',
        extra: { status: project?.status ?? null }
      };
    }),
    byCategory: groupBy(entries, (entry) => ({
      key: entry.categoryId,
      label: getCategory(entry.categoryId)?.label ?? entry.categoryId,
      extra: { kind: entry.type }
    })),
    months: monthlyBySegment(entries, settings),
    recurring: recurringRevenue(income),
    concentration: concentration(byCustomer, revenue),
    paymentBehaviour: paymentBehaviour(data.invoices ?? [], customers)
  };
}

/** Frequent countries first, the rest alphabetically. */
export function countryOptions(): Array<{ code: CountryCode; label: string; zone: Zone }> {
  const common = ['DE', 'AT', 'CH', 'IE', 'NL', 'FR', 'IT', 'ES', 'PL', 'US', 'GB'];
  const rest = Object.keys(COUNTRY_NAMES).filter((code) => !common.includes(code)).sort();

  return [...common, ...rest].map((code) => ({
    code,
    label: COUNTRY_NAMES[code] ?? code,
    zone: countryZone(code)
  }));
}

export { COUNTRY_NAMES };
