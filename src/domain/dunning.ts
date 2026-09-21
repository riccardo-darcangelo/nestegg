// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { roundCents } from './money';
import { totals, resolveStatus, addDays } from './invoices';
import { typeOf } from './doctypes';
import type { BusinessDocument, Cents, Customer, Id, IsoDate, Settings } from '../shared/types';

/**
 * Dunning.
 *
 * Three terms that get mixed up and have to stay apart here:
 *
 *   due date  the day payment is expected
 *   default   the state afterwards, from which interest follows
 *   reminder  the letter, which can itself trigger default
 *
 * Under BGB 286 default starts either with a reminder or automatically thirty
 * days after the due date and receipt of the invoice. Against consumers that
 * automatic rule only applies if the invoice said so, which is why it can be
 * switched off.
 *
 * From default the customer owes interest under BGB 288: five points above
 * base rate for consumers, nine between businesses, plus a flat forty euro
 * that consumers never owe.
 *
 * The base rate is set twice a year by the Bundesbank. This program cannot
 * know it and does not invent it: it lives in the settings and has to be kept
 * current there.
 */

export interface DunningLevel {
  level: number;
  id: string;
  label: string;
  short: string;
  /** Whether interest and fees may be added at this level. */
  charges: boolean;
  defaultDays: number;
  tone: string;
}

export const LEVELS: DunningLevel[] = [
  {
    level: 1,
    id: 'reminder',
    label: 'Zahlungserinnerung',
    short: 'Erinnerung',
    // The friendly step. It does put the customer in default, but deliberately
    // asks for neither interest nor fees.
    charges: false,
    defaultDays: 10,
    tone: 'Vermutlich ist die Rechnung untergegangen. Bitte gleiche sie bis zum {DEADLINE} aus.'
  },
  {
    level: 2,
    id: 'first',
    label: 'Erste Mahnung',
    short: '1. Mahnung',
    charges: true,
    defaultDays: 7,
    tone: 'Trotz unserer Erinnerung ist kein Zahlungseingang zu verzeichnen. Bitte zahle bis zum {DEADLINE}.'
  },
  {
    level: 3,
    id: 'final',
    label: 'Letzte Mahnung',
    short: 'Letzte Mahnung',
    charges: true,
    defaultDays: 7,
    tone: 'Dies ist die letzte Mahnung. Geht bis zum {DEADLINE} kein Geld ein, gebe ich die Forderung ohne weitere Ankündigung in das gerichtliche Mahnverfahren.'
  }
];

export interface DunningSettings {
  /** Bundesbank base rate in percent. Zero means no interest is calculated. */
  baseRate: number;
  baseRateNote: string;
  consumerSurcharge: number;
  businessSurcharge: number;
  /** BGB 288 (5), between businesses only. */
  businessFlatFee: Cents;
  /** Own fee. Only actual costs are lawful, and the first reminder should carry none. */
  feePerLevel: Cents;
  chargeFees: boolean;
  /** BGB 286 (3): default without a reminder after thirty days. */
  automaticAfterDays: number;
  useAutomaticDefault: boolean;
}

export const DEFAULT_SETTINGS: DunningSettings = {
  baseRate: 0,
  baseRateNote: '',
  consumerSurcharge: 5,
  businessSurcharge: 9,
  businessFlatFee: 4000,
  feePerLevel: 250,
  chargeFees: false,
  automaticAfterDays: 30,
  useAutomaticDefault: true
};

type DunnedDocument = BusinessDocument & {
  reminders?: Array<{ date: IsoDate; deadline?: IsoDate | null; level?: number }>;
};

type DunningCustomer = Partial<Customer> & { isConsumer?: boolean };

function configFrom(settings: Settings | null | undefined): DunningSettings {
  return { ...DEFAULT_SETTINGS, ...((settings?.dunning ?? {}) as Partial<DunningSettings>) };
}

export function getLevel(level: number): DunningLevel {
  return LEVELS.find((entry) => entry.level === level) ?? LEVELS[0]!;
}

/** The next step for a document, capped at the last level. */
export function nextLevel(invoice: DunnedDocument): number {
  return Math.min((invoice.reminders ?? []).length + 1, LEVELS.length);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function formatDate(iso: IsoDate | null | undefined): string {
  if (!iso) return '';
  const [year, month, day] = String(iso).split('-');
  return `${day}.${month}.${year}`;
}

/**
 * After a reminder, default starts the day after it. Without one, and only
 * where the thirty day rule applies, on the thirty first day after the due
 * date.
 */
export function defaultSince(invoice: DunnedDocument, settings: Settings | null | undefined): IsoDate | null {
  const config = configFrom(settings);
  const reminders = invoice.reminders ?? [];

  if (reminders.length) {
    const earliest = [...reminders].sort((a, b) => String(a.date).localeCompare(String(b.date)))[0]!;
    return addDays(earliest.date, 1);
  }

  if (!config.useAutomaticDefault || !invoice.dueDate) return null;
  return addDays(invoice.dueDate, config.automaticAfterDays + 1);
}

export interface Interest {
  days: number;
  rate: number;
  amount: Cents;
  since: IsoDate | null;
  until: IsoDate | null;
}

/** Day by day on a 365 day year. */
export function interestFor(
  openAmount: Cents,
  since: IsoDate | null,
  until: IsoDate | null,
  settings: Settings | null | undefined,
  isBusiness: boolean
): Interest {
  const config = configFrom(settings);
  const rate = Number(config.baseRate) + (isBusiness ? config.businessSurcharge : config.consumerSurcharge);

  if (!since || !until || openAmount <= 0) return { days: 0, rate, amount: 0, since, until };

  const days = Math.max(0, daysBetween(since, until));
  return { days, rate, amount: roundCents((openAmount * rate * days) / (100 * 365)), since, until };
}

/**
 * Decides the interest rate and whether the flat fee applies.
 *
 * Business is the default: only an explicit consumer flag rules it out. The
 * original also tested the VAT ID, but that branch sat behind the consumer
 * check and could never return anything but true.
 */
export function isBusinessCustomer(customer: DunningCustomer | null | undefined): boolean {
  return !customer?.isConsumer;
}

interface WarningInput {
  config: DunningSettings;
  level: DunningLevel;
  since: IsoDate | null;
  today: IsoDate;
  business: boolean;
  interest: Interest;
  open: Cents;
}

function warningsFor({ config, level, since, today, business, interest, open }: WarningInput): string[] {
  const warnings: string[] = [];

  if (open <= 0) {
    warnings.push('Diese Rechnung ist ausgeglichen. Ohne offene Forderung gibt es auch keine Zinsen und keine Pauschale.');
  }
  if (level.charges && !since) {
    warnings.push('Ohne Verzugsbeginn lassen sich keine Zinsen fordern. Entweder ging eine Mahnung voraus oder die Dreißig-Tage-Regel greift.');
  }
  if (level.charges && since && since > today) {
    warnings.push(`Verzug tritt erst am ${formatDate(since)} ein. Zinsen und Pauschale sind vorher nicht durchsetzbar.`);
  }
  if (interest.amount > 0 && !Number(config.baseRate)) {
    warnings.push('Der Basiszinssatz steht auf null. Trage in den Einstellungen den aktuellen Wert der Bundesbank nach, sonst rechnest du zu niedrig.');
  }
  if (!business) {
    warnings.push('Der Kunde gilt als Verbraucher: fünf statt neun Prozentpunkte Zinsen, und die Pauschale von vierzig Euro entfällt.');
  }
  if (level.level === 1) {
    warnings.push('Die Zahlungserinnerung verlangt bewusst weder Zinsen noch Gebühren. Sie setzt den Kunden aber in Verzug.');
  }

  return warnings;
}

export interface PrepareOptions {
  level?: number;
  deadline?: IsoDate;
  since?: IsoDate | null;
  includeInterest?: boolean;
  includeFlatFee?: boolean;
  includeFee?: boolean;
}

export interface PreparedReminder {
  invoiceId: Id;
  invoiceNumber: string | null;
  level: number;
  levelId: string;
  levelLabel: string;
  date: IsoDate;
  deadline: IsoDate;
  open: Cents;
  overdueDays: number;
  business: boolean;
  since: IsoDate | null;
  interest: Interest;
  flatFee: Cents;
  fee: Cents;
  total: Cents;
  bodyText: string;
  warnings: string[];
}

/** Builds a reminder without storing it. */
export function prepare(
  invoice: DunnedDocument,
  customer: DunningCustomer | null | undefined,
  settings: Settings | null | undefined,
  today: IsoDate,
  options: PrepareOptions = {}
): PreparedReminder {
  const config = configFrom(settings);
  const level = getLevel(options.level || nextLevel(invoice));
  const open = totals(invoice).openAmount;

  const business = isBusinessCustomer(customer);
  const since = options.since !== undefined ? options.since : defaultSince(invoice, settings);
  const overdueDays = invoice.dueDate ? Math.max(0, daysBetween(invoice.dueDate, today)) : 0;

  // Interest and the flat fee start at the first real reminder and only once
  // default has actually begun. With nothing outstanding there is no side
  // claim either, and ticking the boxes must not change that.
  const collectible = open > 0;
  const mayCharge = level.charges && Boolean(since) && since! <= today && collectible;

  const wantsInterest = collectible && (options.includeInterest ?? mayCharge);
  const wantsFlatFee = collectible && (options.includeFlatFee ?? (mayCharge && business));
  const wantsFee = collectible && (options.includeFee ?? (mayCharge && config.chargeFees));

  const interest = wantsInterest
    ? interestFor(open, since, today, settings, business)
    : { days: 0, rate: 0, amount: 0, since, until: today };

  const flatFee = wantsFlatFee ? Math.trunc(config.businessFlatFee) : 0;
  const fee = wantsFee ? Math.trunc(config.feePerLevel) : 0;
  const deadline = options.deadline || addDays(today, level.defaultDays);

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    level: level.level,
    levelId: level.id,
    levelLabel: level.label,
    date: today,
    deadline,
    open,
    overdueDays,
    business,
    since,
    interest,
    flatFee,
    fee,
    total: open + interest.amount + flatFee + fee,
    bodyText: level.tone.replace('{DEADLINE}', formatDate(deadline)),
    warnings: warningsFor({ config, level, since, today, business, interest, open })
  };
}

export interface OverdueEntry {
  invoice: DunnedDocument;
  customer: DunningCustomer;
  open: Cents;
  overdueDays: number;
  sentCount: number;
  lastReminder: { date: IsoDate; deadline?: IsoDate | null } | null;
  nextLevel: number;
  /** False while the deadline of the last reminder still runs. */
  ready: boolean;
}

function needsDunning(invoice: DunnedDocument, today: IsoDate): boolean {
  const type = typeOf(invoice);
  if (type.group !== 'invoice' || type.id === 'creditnote') return false;
  if (!invoice.number) return false;

  const status = resolveStatus(invoice, today);
  return status === 'overdue' || (status === 'partial' && Boolean(invoice.dueDate) && invoice.dueDate! < today);
}

export function collectOverdue(
  invoices: readonly DunnedDocument[] | null | undefined,
  customers: readonly Customer[] | null | undefined,
  settings: Settings | null | undefined,
  today: IsoDate
): OverdueEntry[] {
  const customerById = new Map((customers ?? []).map((customer) => [customer.id, customer]));

  return (invoices ?? [])
    .filter((invoice) => needsDunning(invoice, today))
    .map((invoice) => {
      const reminders = invoice.reminders ?? [];
      const lastReminder = reminders.at(-1) ?? null;

      return {
        invoice,
        customer: customerById.get(invoice.customerId) ?? {},
        open: totals(invoice).openAmount,
        overdueDays: daysBetween(invoice.dueDate!, today),
        sentCount: reminders.length,
        lastReminder,
        nextLevel: nextLevel(invoice),
        ready: !lastReminder || !lastReminder.deadline || lastReminder.deadline < today
      };
    })
    .sort((a, b) => b.overdueDays - a.overdueDays);
}
