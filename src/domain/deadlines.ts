// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import * as vat from './vat';
import * as ecsales from './ecsales';
import * as recurring from './recurring';
import * as recurrence from './recurrence';
import * as dunning from './dunning';
import { totals, resolveStatus } from './invoices';
import { typeOf } from './doctypes';
import type { RecurringTemplate, EntryTemplate } from './recurring';
import type { BusinessDocument, Cents, Customer, Entry, Id, IsoDate, Settings } from '../shared/types';

/**
 * Deadline calendar.
 *
 * Brings together what is otherwise scattered across the views: VAT returns,
 * recapitulative statements, annual filings, invoices falling due, reminders
 * waiting to go out and recurring items.
 *
 * Nothing is invented here. Every date comes from the same calculation the
 * matching view uses, so there are never two truths.
 *
 * The annual filing dates are the statutory default. Anyone with a tax
 * adviser has until the end of February of the year after next, which is
 * noted on the entry rather than silently assumed.
 */

export type DeadlineKind = 'vat' | 'ecsales' | 'annual' | 'invoice' | 'dunning' | 'recurring';

export const KINDS: Record<DeadlineKind, { id: DeadlineKind; label: string; color: string }> = {
  vat: { id: 'vat', label: 'Umsatzsteuer', color: '#5b9cf8' },
  ecsales: { id: 'ecsales', label: 'Zusammenfassende Meldung', color: '#7c93f8' },
  annual: { id: 'annual', label: 'Jahreserklärung', color: '#edb04a' },
  invoice: { id: 'invoice', label: 'Rechnung', color: '#4ecb8f' },
  dunning: { id: 'dunning', label: 'Mahnung', color: '#f2756b' },
  recurring: { id: 'recurring', label: 'Wiederkehrendes', color: '#94a3b8' }
};

export type Urgency = 'overdue' | 'today' | 'soon' | 'later';

export interface Deadline {
  kind: DeadlineKind;
  date: IsoDate;
  title: string;
  detail: string;
  amount: Cents;
  note: string | null;
  /** Which view to open, or null. */
  action: string | null;
  id: Id | null;
}

export interface ResolvedDeadline extends Deadline {
  days: number;
  urgency: Urgency;
  kindLabel: string;
}

export interface DeadlineData {
  settings: Settings;
  entries: Entry[];
  invoices?: BusinessDocument[];
  customers?: Customer[];
  recurrences?: RecurringTemplate[];
}

function addDays(iso: IsoDate, days: number): IsoDate {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function nextBusinessDay(iso: IsoDate): IsoDate {
  const date = new Date(`${iso}T00:00:00Z`);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

export function daysUntil(from: IsoDate, to: IsoDate): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

export function urgencyOf(days: number): Urgency {
  if (days < 0) return 'overdue';
  if (days <= 3) return 'today';
  if (days <= 14) return 'soon';
  return 'later';
}

function makeDeadline(kind: DeadlineKind, fields: Partial<Deadline> & { date: IsoDate; title: string; detail: string }): Deadline {
  return {
    kind,
    date: fields.date,
    title: fields.title,
    detail: fields.detail,
    amount: fields.amount ?? 0,
    note: fields.note ?? null,
    action: fields.action ?? null,
    id: fields.id ?? null
  };
}

function formatShort(iso: IsoDate): string {
  const [year, month, day] = String(iso).split('-');
  return `${day}.${month}.${year}`;
}

function vatDeadlines(data: DeadlineData, year: number, today: IsoDate): Deadline[] {
  const list: Deadline[] = [];
  const tax = data.settings.tax as { dauerfristverlaengerung?: boolean; vatPeriod?: string };

  for (const forYear of [year, year + 1]) {
    for (const period of vat.yearOverview(data.entries, data.settings, forYear)) {
      // Periods that have not started yet are of no interest.
      if (period.from > today) continue;

      list.push(makeDeadline('vat', {
        date: period.dueDate,
        title: `Umsatzsteuer-Voranmeldung ${period.label}`,
        detail: period.payable >= 0
          ? `Zahllast ${period.payable === 0 ? 'null' : 'voraussichtlich'}`
          : 'Erstattung erwartet',
        amount: period.payable,
        action: 'vat'
      }));
    }
  }

  if (tax.dauerfristverlaengerung && tax.vatPeriod === 'monthly') {
    const special = vat.specialPrepayment(data.entries, data.settings, year - 1);
    list.push(makeDeadline('vat', {
      date: special.dueDate,
      title: `Sondervorauszahlung ${year}`,
      detail: 'Ein Elftel der Vorauszahlungen des Vorjahres, wird im Dezember verrechnet',
      amount: special.amount,
      action: 'vat'
    }));
  }

  return list;
}

function ecSalesDeadlines(data: DeadlineData, year: number, today: IsoDate): Deadline[] {
  const mode = ((data.settings.tax as { ecSalesPeriod?: ecsales.ReportMode }).ecSalesPeriod) ?? 'quarterly';

  return ecsales
    .yearOverview(data.entries, data.customers, year, mode)
    .filter((period) => (period.total > 0 || period.problemCount > 0) && period.from <= today)
    .map((period) => makeDeadline('ecsales', {
      date: period.dueDate,
      title: `Zusammenfassende Meldung ${period.label}`,
      detail: period.problemCount
        ? `${period.problemCount} Hinweise prüfen, sonst nicht meldefähig`
        : `${period.lineCount} ${period.lineCount === 1 ? 'Kunde' : 'Kunden'} zu melden`,
      amount: period.total,
      action: 'vat'
    }));
}

function annualDeadlines(year: number): Deadline[] {
  const date = nextBusinessDay(`${year + 1}-07-31`);
  const note = 'Mit steuerlicher Beratung verlängert sich die Frist bis Ende Februar des übernächsten Jahres.';

  return [
    makeDeadline('annual', {
      date,
      title: `Einkommensteuererklärung ${year}`,
      detail: 'Mit Anlage EÜR und Anlage S oder G',
      note,
      action: 'euer'
    }),
    makeDeadline('annual', {
      date,
      title: `Umsatzsteuer-Jahreserklärung ${year}`,
      detail: 'Fasst die Voranmeldungen des Jahres zusammen',
      note,
      action: 'vat'
    })
  ];
}

function openInvoiceDeadlines(data: DeadlineData, today: IsoDate): Deadline[] {
  const list: Deadline[] = [];

  for (const invoice of data.invoices ?? []) {
    const type = typeOf(invoice);
    if (type.group !== 'invoice' || type.id === 'creditnote') continue;
    if (!['sent', 'overdue', 'partial'].includes(resolveStatus(invoice, today))) continue;

    const open = totals(invoice).openAmount;
    if (open <= 0 || !invoice.dueDate) continue;

    const customer = (data.customers ?? []).find((item) => item.id === invoice.customerId);
    list.push(makeDeadline('invoice', {
      id: invoice.id,
      date: invoice.dueDate,
      title: `Zahlungseingang ${invoice.number}`,
      detail: customer?.name ?? 'ohne Kunde',
      amount: open,
      action: 'invoices'
    }));
  }

  return list;
}

/** Not a tax deadline, but one you do not want to miss either. */
function expiringOfferDeadlines(data: DeadlineData, today: IsoDate): Deadline[] {
  const list: Deadline[] = [];

  for (const offer of data.invoices ?? []) {
    if (typeOf(offer).group !== 'offer') continue;
    if (resolveStatus(offer, today) !== 'sent' || !offer.validUntil) continue;

    list.push(makeDeadline('invoice', {
      id: offer.id,
      date: offer.validUntil,
      title: `Bindefrist ${offer.number} läuft ab`,
      detail: 'Nachfassen oder verfallen lassen',
      amount: totals(offer).grossTotal,
      action: 'offers'
    }));
  }

  return list;
}

function dunningDeadlines(data: DeadlineData, today: IsoDate): Deadline[] {
  return dunning
    .collectOverdue(data.invoices, data.customers, data.settings, today)
    .filter((row) => row.ready)
    .map((row) => makeDeadline('dunning', {
      id: row.invoice.id,
      // A reminder is due right away, so it sits on today.
      date: today,
      title: `${dunning.getLevel(row.nextLevel).label} für ${row.invoice.number}`,
      detail: `${row.overdueDays} Tage überfällig, ${row.customer.name || 'ohne Kunde'}`,
      amount: row.open,
      action: 'invoices'
    }));
}

const RECURRING_HORIZON_DAYS = 45;

/**
 * Two different things that must not be mixed: what has to be caught up, and
 * when the next one is due.
 *
 * Creating a template retroactively produces a dozen open dates at once.
 * Listing each as a missed deadline makes the calendar useless and everything
 * look overdue, so the backlog collapses into one line on today.
 */
function recurringDeadlines(data: DeadlineData, today: IsoDate): Deadline[] {
  const horizon = addDays(today, RECURRING_HORIZON_DAYS);
  const list: Deadline[] = [];

  for (const template of data.recurrences ?? []) {
    if (!template.active) continue;

    const existing = template.kind === 'entry' ? data.entries : data.invoices;
    const kindLabel = template.kind === 'entry' ? 'Buchung' : 'Rechnung';
    const amount = template.kind === 'entry' ? (template.template as EntryTemplate).gross : 0;

    const pending = recurring.pendingDates(template, existing, today);
    if (pending.length) {
      list.push(makeDeadline('recurring', {
        id: template.id,
        date: today,
        title: template.label,
        detail: pending.length === 1
          ? `${kindLabel} anlegen, Termin vom ${formatShort(pending[0]!)}`
          : `${pending.length} Termine nachzuholen, ab ${formatShort(pending[0]!)}`,
        amount: amount * pending.length,
        action: 'recurring'
      }));
    }

    // Taken from the rule rather than from the pending list, which would
    // otherwise hand back the oldest missed date again.
    const upcoming = recurrence.nextAfter(template.rule, today);
    if (upcoming && upcoming <= horizon) {
      list.push(makeDeadline('recurring', {
        id: template.id,
        date: upcoming,
        title: template.label,
        detail: `${kindLabel} anlegen`,
        amount,
        action: 'recurring'
      }));
    }
  }

  return list;
}

export interface CollectOptions {
  horizonDays?: number;
  kinds?: DeadlineKind[];
}

export interface DeadlineResult {
  today: IsoDate;
  items: ResolvedDeadline[];
  counts: Record<Urgency, number>;
  /** The one number for the dashboard: what needs attention now. */
  pressing: number;
}

export function collect(
  data: DeadlineData,
  year: number,
  today: IsoDate,
  options: CollectOptions = {}
): DeadlineResult {
  const horizon = addDays(today, Number(options.horizonDays) || 180);

  let list: Deadline[] = [
    ...vatDeadlines(data, year, today),
    ...ecSalesDeadlines(data, year, today),
    ...annualDeadlines(year - 1),
    ...annualDeadlines(year),
    ...openInvoiceDeadlines(data, today),
    ...expiringOfferDeadlines(data, today),
    ...dunningDeadlines(data, today),
    ...recurringDeadlines(data, today)
  ];

  if (options.kinds?.length) {
    list = list.filter((item) => options.kinds!.includes(item.kind));
  }

  // More than half a year out helps nobody. Overdue items stay, however old.
  const items = list
    .filter((item) => item.date <= horizon)
    .map((item) => {
      const days = daysUntil(today, item.date);
      return { ...item, days, urgency: urgencyOf(days), kindLabel: KINDS[item.kind].label };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'de'));

  const counts: Record<Urgency, number> = { overdue: 0, today: 0, soon: 0, later: 0 };
  for (const item of items) counts[item.urgency] += 1;

  return { today, items, counts, pressing: counts.overdue + counts.today };
}

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

export function groupByMonth(items: readonly ResolvedDeadline[]) {
  const groups = new Map<string, { key: string; label: string; items: ResolvedDeadline[] }>();

  for (const item of items) {
    const key = item.date.slice(0, 7);
    let group = groups.get(key);

    if (!group) {
      const [year, month] = key.split('-');
      group = { key, label: `${MONTH_NAMES[Number(month) - 1]} ${year}`, items: [] };
      groups.set(key, group);
    }

    group.items.push(item);
  }

  return [...groups.values()];
}
