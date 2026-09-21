// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { roundCents } from './money';
import { validIban } from './sepa';
import type { Cents, CountryCode, Entry, Id, IsoDate, IsoTimestamp } from '../shared/types';

/**
 * Members and their dues.
 *
 * A member is not a customer. They have a joining date and maybe a leaving
 * date, a fee tier, a way of paying and a membership number, and out of all
 * that the same claim arises year after year. Which is why they live here and
 * not in the customer list.
 *
 * The dues run is the only operation that creates many bookings at once. It
 * too generates nothing in the background: it shows what would fall due and
 * creates it on confirmation. Nothing is booked twice, because every
 * generated booking carries member and period and is checked against that.
 *
 * All amounts in cents.
 */

export type IntervalId = 'yearly' | 'half' | 'quarterly' | 'monthly';

export const INTERVALS: Array<{ id: IntervalId; label: string; periods: number }> = [
  { id: 'yearly', label: 'jährlich', periods: 1 },
  { id: 'half', label: 'halbjährlich', periods: 2 },
  { id: 'quarterly', label: 'vierteljährlich', periods: 4 },
  { id: 'monthly', label: 'monatlich', periods: 12 }
];

/**
 * The kind of membership says nothing about the fee, that is what the tier
 * does. It says how the member stands in the association, which every report
 * to the federation asks for.
 */
export const KINDS = [
  { id: 'active', label: 'Aktiv' },
  { id: 'passive', label: 'Passiv, fördernd' },
  { id: 'youth', label: 'Jugend' },
  { id: 'honorary', label: 'Ehrenmitglied', freeOfCharge: true }
] as const;

export type MemberKind = typeof KINDS[number]['id'];

export interface Tier {
  id: string;
  label: string;
  amount: Cents;
  interval: IntervalId;
  note: string;
}

export interface MembershipSettings {
  /** Without tiers no dues run happens. */
  tiers: Tier[];
  categoryId: string;
  /** Month and day of the first due date in a year. */
  dueMonth: number;
  dueDay: number;
  /** Honorary members usually pay nothing, but some bylaws differ. */
  honoraryFree: boolean;
}

export const DEFAULT_SETTINGS: MembershipSettings = {
  tiers: [],
  categoryId: 'cl_inc_dues',
  dueMonth: 1,
  dueDay: 15,
  honoraryFree: true
};

export function getInterval(id: string | null | undefined) {
  return INTERVALS.find((interval) => interval.id === id) ?? INTERVALS[0]!;
}

export function getKind(id: string | null | undefined) {
  return KINDS.find((kind) => kind.id === id) ?? KINDS[0];
}

function configFrom(settings: Partial<MembershipSettings> | null | undefined): MembershipSettings {
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizeTier(raw: Partial<Tier>, index: number): Tier {
  return {
    id: raw.id || `bk_${index + 1}`,
    label: String(raw.label ?? '').trim() || `Beitragsklasse ${index + 1}`,
    amount: Math.max(0, Math.trunc(Number(raw.amount) || 0)),
    interval: getInterval(raw.interval).id,
    note: String(raw.note ?? '').trim()
  };
}

export interface Member {
  id: Id | null;
  number: string;
  firstName: string;
  lastName: string;
  /** Kept alongside so lists and receipts do not rebuild it every time. */
  name: string;
  kind: MemberKind;
  tierId: string | null;
  birthDate: IsoDate | null;
  joinedAt: IsoDate | null;
  leftAt: IsoDate | null;
  street: string;
  zip: string;
  city: string;
  country: CountryCode;
  email: string;
  phone: string;
  /** The app collects nothing, it only records what was agreed. */
  payment: 'debit' | 'transfer';
  iban: string;
  mandateRef: string;
  mandateDate: IsoDate | null;
  /** Overrides the tier, for reductions or a family rate. */
  customAmount: Cents | null;
  familyOf: Id | null;
  note: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

function optionalCents(value: unknown): Cents | null {
  if (value === null || value === undefined || value === '') return null;
  return Math.max(0, Math.trunc(Number(value) || 0));
}

export function normalizeMember(raw: Partial<Member> & Record<string, unknown>): Member {
  const firstName = String(raw.firstName ?? '').trim();
  const lastName = String(raw.lastName ?? '').trim();
  const now = new Date().toISOString();

  return {
    id: raw.id ?? null,
    number: String(raw.number ?? '').trim(),
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' ') || String(raw.name ?? '').trim(),
    kind: getKind(raw.kind).id,
    tierId: raw.tierId ?? null,
    birthDate: isIsoDate(raw.birthDate) ? raw.birthDate : null,
    joinedAt: isIsoDate(raw.joinedAt) ? raw.joinedAt : null,
    leftAt: isIsoDate(raw.leftAt) ? raw.leftAt : null,
    street: String(raw.street ?? '').trim(),
    zip: String(raw.zip ?? '').trim(),
    city: String(raw.city ?? '').trim(),
    country: String(raw.country ?? 'DE').toUpperCase().slice(0, 2),
    email: String(raw.email ?? '').trim(),
    phone: String(raw.phone ?? '').trim(),
    payment: raw.payment === 'transfer' ? 'transfer' : 'debit',
    iban: String(raw.iban ?? '').replace(/\s/g, '').toUpperCase(),
    mandateRef: String(raw.mandateRef ?? '').trim(),
    mandateDate: isIsoDate(raw.mandateDate) ? raw.mandateDate : null,
    customAmount: optionalCents(raw.customAmount),
    familyOf: raw.familyOf ?? null,
    note: String(raw.note ?? '').trim(),
    createdAt: raw.createdAt ?? now,
    updatedAt: now
  };
}

export function validateMember(member: Member): string[] {
  const errors: string[] = [];

  if (!member.name) errors.push('Das Mitglied braucht einen Namen.');
  if (!member.joinedAt) errors.push('Das Eintrittsdatum fehlt. Ohne es lässt sich kein Beitrag zuordnen.');
  if (member.leftAt && member.joinedAt && member.leftAt < member.joinedAt) {
    errors.push('Der Austritt liegt vor dem Eintritt.');
  }

  // Checked by its check digits, not just its shape. A transposed digit would
  // otherwise surface when the bank returns the debit, which costs a fee.
  if (member.iban && !validIban(member.iban)) {
    errors.push('Die IBAN ist nicht gültig: die Prüfziffer stimmt nicht, oder das Land gehört nicht zum SEPA-Raum.');
  }

  return errors;
}

export function isMemberOn(member: Member, date: IsoDate): boolean {
  if (!member.joinedAt || member.joinedAt > date) return false;
  return !member.leftAt || member.leftAt >= date;
}

export type MemberStatus = 'unknown' | 'future' | 'left' | 'active';

export function statusOf(member: Member, today: IsoDate): MemberStatus {
  if (!member.joinedAt) return 'unknown';
  if (member.joinedAt > today) return 'future';
  if (member.leftAt && member.leftAt < today) return 'left';
  return 'active';
}

function tierOf(member: Member, config: MembershipSettings): Tier | undefined {
  return config.tiers.find((tier) => tier.id === member.tierId);
}

/**
 * The fee per due date. A custom amount on the member wins over the tier, and
 * honorary members pay nothing unless the bylaws say otherwise.
 */
export function amountFor(member: Member, settings?: Partial<MembershipSettings> | null): Cents {
  const config = configFrom(settings);

  if (config.honoraryFree && 'freeOfCharge' in getKind(member.kind)) return 0;
  if (member.customAmount !== null) return member.customAmount;

  return tierOf(member, config)?.amount ?? 0;
}

export function intervalFor(member: Member, settings?: Partial<MembershipSettings> | null) {
  return getInterval(tierOf(member, configFrom(settings))?.interval ?? 'yearly');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

function periodLabel(interval: { id: IntervalId }, year: number, index: number): string {
  if (interval.id === 'yearly') return `Jahresbeitrag ${year}`;
  if (interval.id === 'half') return `${index + 1}. Halbjahr ${year}`;
  if (interval.id === 'quarterly') return `${index + 1}. Quartal ${year}`;
  return `${MONTH_NAMES[index]} ${year}`;
}

export interface DuePeriod {
  key: string;
  label: string;
  date: IsoDate;
  from: IsoDate;
  to: IsoDate;
}

/**
 * The due dates of a year: one for annual payers, twelve for monthly ones.
 *
 * Periods before joining or after leaving drop out entirely. Within a period
 * nothing is apportioned: joining in February means paying the first quarter
 * in full, which is what bylaws usually provide and what a custom amount on
 * the member can correct.
 */
export function periodsOf(
  member: Member,
  settings: Partial<MembershipSettings> | null | undefined,
  year: number
): DuePeriod[] {
  const config = configFrom(settings);
  const interval = intervalFor(member, config);
  const step = 12 / interval.periods;

  const periods: DuePeriod[] = [];

  for (let index = 0; index < interval.periods; index += 1) {
    const month = Math.min(12, Math.max(1, Number(config.dueMonth) || 1) + index * step);
    const monthIndex = ((month - 1) % 12) + 1;
    const day = Math.min(28, Math.max(1, Number(config.dueDay) || 1));
    const date = `${year}-${pad(monthIndex)}-${pad(day)}`;

    // The period paid for starts on the due date and ends before the next.
    const endMonth = monthIndex + step - 1;
    const to = endMonth > 12
      ? `${year}-12-31`
      : `${year}-${pad(endMonth)}-${pad(lastDay(year, endMonth))}`;

    periods.push({
      key: interval.periods === 1 ? String(year) : `${year}-${index + 1}`,
      label: periodLabel(interval, year, index),
      date,
      from: date,
      to
    });
  }

  return periods.filter((period) => {
    if (member.joinedAt && member.joinedAt > period.to) return false;
    if (member.leftAt && member.leftAt < period.from) return false;
    return true;
  });
}

/** How an already booked due date is recognised. */
export function duesRef(member: Member, period: DuePeriod): string {
  return `${member.id}|${period.key}`;
}

export interface DuesRow {
  memberId: Id | null;
  memberName: string;
  memberNumber: string;
  payment: Member['payment'];
  period: string;
  periodLabel: string;
  date: IsoDate;
  amount: Cents;
  ref: string;
  booked: boolean;
  /** Nothing to book. Normal for honorary members, not an error. */
  skip: boolean;
  selected: boolean;
}

export function plan(
  members: readonly Member[] | null | undefined,
  settings: Partial<MembershipSettings> | null | undefined,
  year: number,
  entries: readonly Entry[] | null | undefined
): DuesRow[] {
  const booked = new Set((entries ?? []).map((entry) => entry.duesRef).filter(Boolean));
  const rows: DuesRow[] = [];

  for (const member of members ?? []) {
    const amount = amountFor(member, settings);

    for (const period of periodsOf(member, settings, year)) {
      const ref = duesRef(member, period);
      const alreadyBooked = booked.has(ref);

      rows.push({
        memberId: member.id,
        memberName: member.name,
        memberNumber: member.number,
        payment: member.payment,
        period: period.key,
        periodLabel: period.label,
        date: period.date,
        amount,
        ref,
        booked: alreadyBooked,
        skip: amount <= 0,
        selected: !alreadyBooked && amount > 0
      });
    }
  }

  return rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.memberName.localeCompare(b.memberName, 'de')
  );
}

export function summarize(rows: readonly DuesRow[]) {
  const open = rows.filter((row) => !row.booked && !row.skip);
  const selected = rows.filter((row) => row.selected);
  const sumOf = (list: readonly DuesRow[]): Cents => list.reduce((total, row) => total + row.amount, 0);

  return {
    total: rows.length,
    booked: rows.filter((row) => row.booked).length,
    free: rows.filter((row) => row.skip).length,
    open: open.length,
    openAmount: sumOf(open),
    selected: selected.length,
    selectedAmount: sumOf(selected),
    debit: selected.filter((row) => row.payment === 'debit').length,
    transfer: selected.filter((row) => row.payment === 'transfer').length
  };
}

/**
 * With direct debit the fee counts as received on the due date, because it
 * gets collected. With a transfer the booking stays open until the money
 * arrives: anything else would be income that does not exist.
 */
export function toEntry(
  row: DuesRow,
  settings?: Partial<MembershipSettings> | null
): Record<string, unknown> {
  const config = configFrom(settings);
  const byDebit = row.payment === 'debit';

  return {
    type: 'income',
    date: row.date,
    paidDate: byDebit ? row.date : null,
    description: `${row.periodLabel}${row.memberNumber ? `, Mitglied ${row.memberNumber}` : ''}`,
    counterparty: row.memberName,
    categoryId: config.categoryId || 'cl_inc_dues',
    sphereId: 'ideell',
    amount: row.amount,
    basis: 'gross',
    vatRate: 0,
    paymentMethod: byDebit ? 'direct_debit' : 'bank',
    memberId: row.memberId,
    duesRef: row.ref
  };
}

/**
 * The numbers every federation asks for once a year: headcount at year end,
 * joiners, leavers and the split by kind.
 */
export function statistics(members: readonly Member[] | null | undefined, year: number) {
  const list = members ?? [];
  const endOfYear = `${year}-12-31`;

  const current = list.filter((member) => isMemberOn(member, endOfYear));
  const joined = list.filter((member) => String(member.joinedAt ?? '').slice(0, 4) === String(year));
  const left = list.filter((member) => String(member.leftAt ?? '').slice(0, 4) === String(year));

  // For a sports club the average age says more about its future than any
  // other figure. Only members with a known birth date count, and how many
  // that is stands right beside it.
  const withBirthDate = current.filter((member) => member.birthDate);
  const ages = withBirthDate.map((member) => year - Number(member.birthDate!.slice(0, 4)));
  const averageAge = ages.length
    ? Math.round(ages.reduce((total, age) => total + age, 0) / ages.length)
    : null;

  return {
    year,
    count: current.length,
    joined: joined.length,
    left: left.length,
    change: joined.length - left.length,
    byKind: KINDS.map((kind) => ({
      id: kind.id,
      label: kind.label,
      count: current.filter((member) => member.kind === kind.id).length
    })),
    byPayment: {
      debit: current.filter((member) => member.payment === 'debit').length,
      transfer: current.filter((member) => member.payment === 'transfer').length
    },
    averageAge,
    withBirthDate: withBirthDate.length,
    under18: ages.filter((age) => age < 18).length
  };
}

export interface PreNotificationItem {
  memberId: Id | null;
  member: Member;
  periods: Array<{ key: string; label: string; date: IsoDate; amount: Cents }>;
  total: Cents;
  problems: string[];
  ready: boolean;
}

function preNotificationProblems(member: Member): string[] {
  const problems: string[] = [];

  if (!member.street || !member.city) problems.push('Es fehlt die Anschrift.');
  if (!member.mandateRef) problems.push('Die Mandatsreferenz fehlt.');
  if (!member.iban) problems.push('Es ist keine IBAN hinterlegt.');

  return problems;
}

/**
 * Who needs a pre-notification and what goes in it.
 *
 * Everyone collected from. With unchanging amounts one letter covers the
 * whole year, provided it names every amount and date, which is why this
 * holds the full schedule per member rather than one line per collection.
 *
 * Members who cannot be written to are not dropped, they get their reason.
 * Silently skipping a member without an address would mean collecting without
 * notice.
 */
export function preNotificationPlan(
  members: readonly Member[] | null | undefined,
  settings: Partial<MembershipSettings> | null | undefined,
  year: number,
  options: { noticeDays?: number; today?: IsoDate } = {}
) {
  const config = configFrom(settings);
  const items: PreNotificationItem[] = [];

  for (const member of members ?? []) {
    if (member.payment !== 'debit') continue;

    const periods = periodsOf(member, config, year);
    if (!periods.length) continue;

    const amount = amountFor(member, config);
    if (amount <= 0) continue;

    const problems = preNotificationProblems(member);

    items.push({
      memberId: member.id,
      member,
      periods: periods.map((period) => ({
        key: period.key,
        label: period.label,
        date: period.date,
        amount
      })),
      total: amount * periods.length,
      problems,
      ready: problems.length === 0
    });
  }

  items.sort((a, b) => String(a.member.lastName || a.member.name)
    .localeCompare(String(b.member.lastName || b.member.name), 'de'));

  const ready = items.filter((item) => item.ready);

  return {
    year,
    items,
    ready,
    blocked: items.filter((item) => !item.ready),
    count: ready.length,
    total: ready.reduce((total, item) => total + item.total, 0),
    // The earliest collection sets the deadline for sending the letters, not
    // the next one.
    firstDue: items.reduce<IsoDate | null>((earliest, item) => {
      const first = item.periods[0]?.date ?? null;
      if (!first) return earliest;
      return !earliest || first < earliest ? first : earliest;
    }, null),
    // The notice period lives in the SEPA settings, so it comes in from
    // outside.
    noticeDays: options.noticeDays ?? 14,
    today: options.today ?? null
  };
}

export function expectedDues(
  members: readonly Member[] | null | undefined,
  settings: Partial<MembershipSettings> | null | undefined,
  year: number
) {
  const rows = plan(members, settings, year, []);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const memberCount = new Set(rows.map((row) => row.memberId)).size;

  return {
    year,
    total,
    count: rows.filter((row) => row.amount > 0).length,
    average: rows.length ? roundCents(total / Math.max(1, memberCount)) : 0
  };
}
