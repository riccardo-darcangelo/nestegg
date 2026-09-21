// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import * as recurrence from './recurrence';
import { normalizeEntry } from './entries';
import { normalizeItem, addDays } from './invoices';
import { getType } from './doctypes';
import type {
  BusinessDocument,
  DocumentItem,
  DocumentType,
  Entry,
  EntryTemplate,
  Id,
  InvoiceTemplate,
  IsoDate,
  IsoTimestamp,
  RecurrenceRule,
  RecurringTemplate,
  TemplateKind
} from '../shared/types';

export type { EntryTemplate, InvoiceTemplate, RecurringTemplate, TemplateKind } from '../shared/types';

/**
 * Recurring bookings and invoices.
 *
 * A template is a recurrence rule plus a draft of what should come out of it.
 * Nothing is generated in the background: the app collects what is due and
 * creates it only after confirmation. Bookkeeping that books by itself is
 * hard to audit.
 *
 * To stop duplicates, every generated record carries the template and the
 * date it came from. Checking happens against those pairs rather than a
 * counter, so a deleted record may come back while an existing one cannot be
 * created twice.
 */

export const KINDS = {
  entry: { id: 'entry', label: 'Buchung', plural: 'Buchungen' },
  invoice: { id: 'invoice', label: 'Rechnung', plural: 'Rechnungen' }
} as const;

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

function normalizeInvoiceTemplate(raw: Partial<InvoiceTemplate>): InvoiceTemplate {
  return {
    documentType: getType(raw.documentType || 'invoice').id,
    customerId: raw.customerId ?? null,
    segmentId: raw.segmentId ?? null,
    projectId: raw.projectId ?? null,
    items: (raw.items ?? []).map((item, index) => normalizeItem(item, index)),
    paymentTermsDays: Number(raw.paymentTermsDays) || 14,
    salutation: String(raw.salutation ?? ''),
    intro: String(raw.intro ?? ''),
    bodyText: String(raw.bodyText ?? ''),
    outro: String(raw.outro ?? ''),
    buyerReference: String(raw.buyerReference ?? ''),
    currency: raw.currency || 'EUR',
    servicePeriod: raw.servicePeriod !== false
  };
}

function normalizeEntryTemplate(raw: Record<string, unknown>): EntryTemplate {
  const entry = normalizeEntry({ ...raw, id: null as never });
  const { date, paidDate, createdAt, updatedAt, ...template } = entry;
  return template;
}

function normalizeTemplate(kind: TemplateKind, raw: Record<string, unknown>): EntryTemplate | InvoiceTemplate {
  return kind === 'invoice' ? normalizeInvoiceTemplate(raw) : normalizeEntryTemplate(raw);
}

export function normalize(raw: Partial<RecurringTemplate> & Record<string, unknown>): RecurringTemplate {
  const kind: TemplateKind = raw.kind && raw.kind in KINDS ? raw.kind : 'entry';
  const now = new Date().toISOString();

  return {
    id: raw.id ?? null,
    kind,
    label: String(raw.label ?? '').trim(),
    active: raw.active !== false,
    rule: recurrence.normalizeRule(raw.rule ?? {}),
    template: normalizeTemplate(kind, (raw.template ?? {}) as Record<string, unknown>),
    markPaid: Boolean(raw.markPaid),
    autoFinalize: Boolean(raw.autoFinalize),
    note: String(raw.note ?? '').trim(),
    skipped: Array.isArray(raw.skipped) ? [...new Set(raw.skipped)] : [],
    createdAt: raw.createdAt ?? now,
    updatedAt: now
  };
}

export function validate(template: RecurringTemplate): string[] {
  const errors = recurrence.validateRule(template.rule);
  if (!template.label) errors.push('Die Vorlage braucht einen Namen.');

  if (template.kind === 'entry') {
    const entry = template.template as EntryTemplate;
    if (!entry.description) errors.push('Der Verwendungszweck fehlt.');
    if (!entry.gross) errors.push('Der Betrag darf nicht null sein.');
    return errors;
  }

  const invoice = template.template as InvoiceTemplate;
  if (!invoice.customerId) errors.push('Die Rechnungsvorlage braucht einen Kunden.');
  if (!invoice.items.length) errors.push('Die Rechnungsvorlage enthält keine Position.');
  if (invoice.items.some((item) => !item.name)) errors.push('Jede Position braucht eine Bezeichnung.');

  return errors;
}

export interface BillingPeriod {
  from: IsoDate;
  to: IsoDate;
  label: string;
}

/** The billing month of a due date, as a range and as text. */
export function periodOf(date: IsoDate): BillingPeriod {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const pad = (value: number): string => String(value).padStart(2, '0');

  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(recurrence.lastDayOfMonth(year, month))}`,
    label: `${MONTH_NAMES[month - 1]} ${year}`
  };
}

/** Fills {PERIOD} in the free texts; the other placeholders come later. */
function fillPeriod(text: string | null | undefined, period: BillingPeriod): string {
  return String(text ?? '').replace(/\{PERIOD\}/g, period.label);
}

function materializeEntry(template: RecurringTemplate, date: IsoDate, period: BillingPeriod): Entry {
  const source = template.template as EntryTemplate;

  const entry = normalizeEntry({
    ...source,
    // The template is itself a normalized booking and carries the amount as
    // gross, while normalizeEntry works from amount. Passing it back here
    // explicitly is what keeps the result from being zero.
    amount: source.gross,
    basis: 'gross',
    date,
    paidDate: template.markPaid ? date : null,
    description: fillPeriod(source.description, period),
    note: fillPeriod(source.note, period)
  });

  return { ...entry, recurrenceId: template.id, recurrenceDate: date };
}

/** A document draft, not a stored one: it has no id yet. */
export type DocumentDraft = Partial<BusinessDocument> & {
  recurrenceId: Id | null;
  recurrenceDate: IsoDate;
};

function materializeInvoice(
  template: RecurringTemplate,
  date: IsoDate,
  period: BillingPeriod
): DocumentDraft {
  const source = template.template as InvoiceTemplate;

  return {
    documentType: source.documentType,
    status: 'draft',
    number: null,
    customerId: source.customerId as Id,
    segmentId: source.segmentId,
    projectId: source.projectId,
    issueDate: date,
    deliveryDate: source.servicePeriod ? null : date,
    deliveryPeriod: source.servicePeriod ? { from: period.from, to: period.to } : null,
    paymentTermsDays: source.paymentTermsDays,
    dueDate: addDays(date, source.paymentTermsDays),
    items: source.items.map((item) => ({ ...item, description: fillPeriod(item.description, period) })),
    salutation: source.salutation,
    intro: fillPeriod(source.intro, period),
    bodyText: fillPeriod(source.bodyText, period),
    outro: fillPeriod(source.outro, period),
    buyerReference: source.buyerReference,
    currency: source.currency,
    payments: [],
    recurrenceId: template.id,
    recurrenceDate: date,
    createdAt: new Date().toISOString()
  };
}

/** Builds the record from a template and a date, without storing it. */
export function materialize(template: RecurringTemplate, date: IsoDate): Entry | DocumentDraft {
  const period = periodOf(date);

  return template.kind === 'entry'
    ? materializeEntry(template, date, period)
    : materializeInvoice(template, date, period);
}

type Generated = { recurrenceId?: Id | null; recurrenceDate?: IsoDate | null };

/** Dates already generated or deliberately skipped. */
export function doneDates(
  template: RecurringTemplate,
  existing: readonly Generated[] | null | undefined
): Set<string> {
  return new Set([
    ...(existing ?? [])
      .filter((item) => item.recurrenceId === template.id)
      .map((item) => String(item.recurrenceDate)),
    ...(template.skipped ?? [])
  ]);
}

/** Which dates of a template are due up to and including `until` and missing. */
export function pendingDates(
  template: RecurringTemplate,
  existing: readonly Generated[] | null | undefined,
  until: IsoDate
): IsoDate[] {
  if (!template.active) return [];

  const done = doneDates(template, existing);
  return recurrence.occurrencesBetween(template.rule, null, until).filter((date) => !done.has(date));
}

export interface DueTemplate {
  template: RecurringTemplate;
  dates: IsoDate[];
  items: Array<{ date: IsoDate; preview: Entry | DocumentDraft }>;
}

export function collectDue(
  templates: readonly RecurringTemplate[] | null | undefined,
  data: { entries?: Entry[]; invoices?: BusinessDocument[] },
  today: IsoDate
): DueTemplate[] {
  const due: DueTemplate[] = [];

  for (const template of templates ?? []) {
    const existing = template.kind === 'entry' ? data.entries : data.invoices;
    const dates = pendingDates(template, existing as Generated[], today);
    if (!dates.length) continue;

    due.push({
      template,
      dates,
      items: dates.map((date) => ({ date, preview: materialize(template, date) }))
    });
  }

  return due;
}

/** The next outstanding date, even when it lies in the future. */
export function nextDate(
  template: RecurringTemplate,
  existing: readonly Generated[] | null | undefined
): IsoDate | null {
  const done = doneDates(template, existing);

  for (let index = 0; index < 500; index += 1) {
    const date = recurrence.occurrenceAt(template.rule, index);
    if (date === null) return null;
    if (!done.has(date)) return date;
  }

  return null;
}
