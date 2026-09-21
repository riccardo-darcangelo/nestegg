// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { roundCents } from './money';
import type { Cents, Entry, Id, IsoDate, IsoTimestamp, Settings, SphereId } from '../shared/types';

/**
 * Expense claims waived into donations.
 *
 * Anyone who pays for something on behalf of an association and waives
 * reimbursement is donating: giving up a claim counts as a monetary donation
 * (EStG 10b (3) s5). No money moves, which is exactly why the tax office
 * looks closely.
 *
 * Three conditions decide, and all three can only be met in advance. After
 * the fact nothing can save such a donation:
 *
 *   1. The claim must exist before the work, through the bylaws or a
 *      contract. A board resolution alone is not enough unless the bylaws
 *      authorise the board to grant it.
 *   2. At the moment the claim was granted the association must have been
 *      able to pay it. Money you never had is nothing to waive.
 *   3. The waiver has to be prompt: within three months of the claim arising,
 *      or every three months for ongoing work.
 *
 * Hence a workflow of its own rather than a checkbox. The tick on the receipt
 * is the end of this, not the beginning.
 *
 * All amounts in cents.
 */

export interface ClaimBasis {
  id: string;
  label: string;
  hint: string;
  /** Whether this basis carries on its own. */
  sufficient: boolean;
  needsBylawsClause?: boolean;
}

export const BASES: ClaimBasis[] = [
  {
    id: 'bylaws',
    label: 'Satzung',
    hint: 'Die Satzung räumt den Anspruch ein. Das ist die sicherste Grundlage.',
    sufficient: true
  },
  {
    id: 'contract',
    label: 'Schriftliche Vereinbarung',
    hint: 'Ein Vertrag zwischen Verein und Zuwendendem, geschlossen vor der Tätigkeit.',
    sufficient: true
  },
  {
    id: 'board',
    label: 'Vorstandsbeschluss',
    hint: 'Trägt nur, wenn die Satzung den Vorstand dazu ermächtigt. Ohne diese Klausel erkennt das Finanzamt die Aufwandsspende nicht an.',
    sufficient: false,
    needsBylawsClause: true
  }
];

export interface ClaimKind {
  id: string;
  label: string;
  hint: string;
  /** The amount follows from the distance rather than being entered. */
  perKilometer?: boolean;
}

export const KINDS: ClaimKind[] = [
  { id: 'travel', label: 'Fahrtkosten', hint: 'Fahrten mit dem eigenen Wagen, je Kilometer', perKilometer: true },
  { id: 'material', label: 'Material und Auslagen', hint: 'Eingekauftes, verauslagt und belegt' },
  { id: 'phone', label: 'Telefon und Porto', hint: 'Laufende Kosten der Vereinsarbeit' },
  { id: 'trainer', label: 'Übungsleiter- oder Ehrenamtspauschale', hint: 'Der zugesagte Betrag, auf den verzichtet wird' },
  { id: 'other', label: 'Sonstiger Aufwand', hint: 'Alles, was sich belegen lässt' }
];

export const KILOMETER_RATE: Cents = 30;

/** A waiver counts as prompt within this many months. */
export const WAIVER_MONTHS = 3;

/** Warn once the deadline is this close. */
const WARN_DAYS_BEFORE_DEADLINE = 21;

export function getBasis(id: string | null | undefined): ClaimBasis {
  return BASES.find((basis) => basis.id === id) ?? BASES[0]!;
}

export function getKind(id: string | null | undefined): ClaimKind {
  return KINDS.find((kind) => kind.id === id) ?? KINDS.at(-1)!;
}

function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** A 31st in a month without one lands on that month's last day. */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDate();

  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);

  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));

  return date.toISOString().slice(0, 10);
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function euro(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

export interface Claim {
  id: Id | null;
  /** Helpers are not always members, so either link may be set. */
  memberId: Id | null;
  customerId: Id | null;
  name: string;

  basis: string;
  basisDate: IsoDate | null;
  basisNote: string;
  /** Only asked for a board resolution: whether the bylaws cover it. */
  bylawsClause: boolean;

  kind: string;
  date: IsoDate | null;
  description: string;
  kilometers: number;
  amount: Cents;
  sphereId: SphereId;

  waivedAt: IsoDate | null;
  expenseEntryId: Id | null;
  donationEntryId: Id | null;
  receiptId: Id | null;

  note: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export function normalizeClaim(raw: Partial<Claim> & Record<string, unknown>): Claim {
  const kind = getKind(raw.kind);
  const kilometers = Math.max(0, Number(raw.kilometers) || 0);
  const now = new Date().toISOString();

  return {
    id: raw.id ?? null,
    memberId: raw.memberId ?? null,
    customerId: raw.customerId ?? null,
    name: String(raw.name ?? '').trim(),

    basis: getBasis(raw.basis).id,
    basisDate: isIsoDate(raw.basisDate) ? raw.basisDate : null,
    basisNote: String(raw.basisNote ?? '').trim(),
    bylawsClause: Boolean(raw.bylawsClause),

    kind: kind.id,
    date: isIsoDate(raw.date) ? raw.date : null,
    description: String(raw.description ?? '').trim(),
    kilometers,
    // Mileage is calculated, everything else is taken as entered.
    amount: kind.perKilometer && kilometers > 0
      ? roundCents(kilometers * KILOMETER_RATE)
      : Math.max(0, Math.trunc(Number(raw.amount) || 0)),
    sphereId: (raw.sphereId as SphereId) || 'ideell',

    waivedAt: isIsoDate(raw.waivedAt) ? raw.waivedAt : null,
    expenseEntryId: raw.expenseEntryId ?? null,
    donationEntryId: raw.donationEntryId ?? null,
    receiptId: raw.receiptId ?? null,

    note: String(raw.note ?? '').trim(),
    createdAt: raw.createdAt ?? now,
    updatedAt: now
  };
}

export function validateClaim(claim: Claim): string[] {
  const errors: string[] = [];

  if (!claim.name && !claim.memberId && !claim.customerId) {
    errors.push('Es fehlt, wem der Anspruch zusteht.');
  }
  if (!claim.date) errors.push('Das Datum der Tätigkeit fehlt.');
  if (!claim.basisDate) {
    errors.push('Das Datum der Anspruchsgrundlage fehlt. Ohne es lässt sich nicht zeigen, dass der Anspruch vorher bestand.');
  }
  if (!claim.amount) errors.push('Der Betrag ist null.');
  if (!claim.description) errors.push('Eine Beschreibung des Aufwands fehlt.');

  return errors;
}

export interface CheckOptions {
  today?: IsoDate | undefined;
  /** Null when no balance is on record, undefined when not asked for. */
  fundsAtBasisDate?: Cents | null | undefined;
}

export interface ClaimCheck {
  /** Stops the donation entirely. */
  blocking: string[];
  warnings: string[];
  deadline: IsoDate | null;
  ok: boolean;
  waived: boolean;
  booked: boolean;
}

/** The claim must have existed before the work, and on a basis that carries. */
function checkBasis(claim: Claim): string[] {
  const blocking: string[] = [];
  const basis = getBasis(claim.basis);

  if (claim.basisDate && claim.date && claim.basisDate > claim.date) {
    blocking.push(`Die Anspruchsgrundlage ist vom ${claim.basisDate}, die Tätigkeit war am ${claim.date}. Der Anspruch muss vor der Tätigkeit eingeräumt sein, nachträglich geht es nicht.`);
  }
  if (basis.needsBylawsClause && !claim.bylawsClause) {
    blocking.push('Ein Vorstandsbeschluss allein genügt nicht. Er trägt nur, wenn die Satzung den Vorstand ausdrücklich dazu ermächtigt.');
  }

  return blocking;
}

/**
 * Solvency is measured against the day the claim was granted, not today.
 * Without a maintained balance the app says so instead of assuming it.
 */
function checkFunds(claim: Claim, funds: Cents | null | undefined): { blocking: string[]; warnings: string[] } {
  if (funds === null || funds === undefined) {
    return {
      blocking: [],
      warnings: ['Ob der Verein am Tag der Einräumung zahlungsfähig war, kann die App nicht belegen: dafür fehlt ein gepflegter Kontostand. Die Leistungsfähigkeit ist Voraussetzung und im Zweifel nachzuweisen.']
    };
  }

  if (funds < claim.amount) {
    return {
      blocking: [`Am ${claim.basisDate} waren nach den erfassten Zahlen ${euro(funds)} Euro vorhanden, der Anspruch lautet über ${euro(claim.amount)} Euro. Wer die Zahlung nie leisten konnte, hat auch nichts zu erlassen.`],
      warnings: []
    };
  }

  return { blocking: [], warnings: [] };
}

function checkWaiver(
  claim: Claim,
  deadline: IsoDate | null,
  today: IsoDate | undefined
): { blocking: string[]; warnings: string[] } {
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (claim.waivedAt) {
    if (claim.date && claim.waivedAt < claim.date) {
      blocking.push('Der Verzicht ist älter als die Tätigkeit. Verzichten lässt sich nur auf einen Anspruch, der schon entstanden ist.');
    } else if (deadline && claim.waivedAt > deadline) {
      blocking.push(`Der Verzicht vom ${claim.waivedAt} liegt nach dem ${deadline}. Zeitnah ist er nur binnen drei Monaten nach Entstehen des Anspruchs.`);
    }
    return { blocking, warnings };
  }

  if (!deadline || !today) return { blocking, warnings };

  const daysLeft = daysBetween(today, deadline);
  if (daysLeft < 0) {
    blocking.push(`Die Frist für den Verzicht lief am ${deadline} ab. Der Anspruch bleibt bestehen, als Aufwandsspende taugt er nicht mehr.`);
  } else if (daysLeft <= WARN_DAYS_BEFORE_DEADLINE) {
    warnings.push(`Nur noch ${daysLeft} Tage bis zum ${deadline}: bis dahin muss der Verzicht erklärt sein.`);
  }

  return { blocking, warnings };
}

/**
 * Checks a claim against all three conditions.
 *
 * The split between blocking and warnings matters: an agreement made after
 * the fact cannot be saved, and the app should say so rather than issue a
 * receipt that gets revoked later. Liability under EStG 10b (4) falls on the
 * association, not the donor.
 */
export function check(claim: Claim, options: CheckOptions = {}): ClaimCheck {
  const deadline = claim.date ? addMonths(claim.date, WAIVER_MONTHS) : null;

  const funds = checkFunds(claim, options.fundsAtBasisDate);
  const waiver = checkWaiver(claim, deadline, options.today);
  const blocking = [...checkBasis(claim), ...funds.blocking, ...waiver.blocking];

  return {
    blocking,
    warnings: [...funds.warnings, ...waiver.warnings],
    deadline,
    ok: blocking.length === 0,
    waived: Boolean(claim.waivedAt),
    booked: Boolean(claim.expenseEntryId && claim.donationEntryId)
  };
}

/**
 * How much money the association held on a given day.
 *
 * Rolled forward from the recorded balance, the same calculation as the net
 * asset statement. Without a recorded balance there is no number but null: a
 * guess would be worse than admitting it.
 */
export function fundsOn(
  data: { settings?: Settings; entries?: Entry[] },
  date: IsoDate
): Cents | null {
  const reserve = (data.settings?.reserve ?? {}) as { accountBalance?: Cents; accountBalanceDate?: IsoDate };
  if (!reserve.accountBalanceDate || reserve.accountBalance === undefined || reserve.accountBalance === null) {
    return null;
  }

  let balance = reserve.accountBalance;

  for (const entry of data.entries ?? []) {
    if (!entry.paidDate) continue;
    if (entry.paidDate <= reserve.accountBalanceDate || entry.paidDate > date) continue;
    balance += entry.type === 'income' ? entry.gross : -entry.gross;
  }

  return balance;
}

export interface ToEntriesOptions {
  today?: IsoDate;
  expenseCategoryId?: string | null;
  donationCategoryId?: string;
}

/**
 * The two bookings a waived claim produces.
 *
 * No money moves, and still there are two: the expense in the sphere where
 * the work happened, and the donation in the charitable sphere. Both on the
 * day of the waiver and both marked paid, because waiving causes the inflow
 * and the outflow in the same moment.
 *
 * Booking only one of them would be wrong. Without the expense the work has
 * no cost attached; without the donation it is missing from the use of funds
 * and from the donation receipt.
 */
export function toEntries(claim: Claim, options: ToEntriesOptions = {}) {
  const date = claim.waivedAt || options.today;
  const donor = claim.name || 'Zuwendender';
  const kind = getKind(claim.kind);

  const detail = kind.perKilometer && claim.kilometers
    ? `${claim.description}, ${claim.kilometers} km`
    : claim.description;

  const shared = {
    date,
    paidDate: date,
    amount: claim.amount,
    vatRate: 0,
    counterparty: donor,
    memberId: claim.memberId,
    customerId: claim.customerId,
    claimId: claim.id
  };

  return {
    expense: {
      ...shared,
      type: 'expense',
      categoryId: options.expenseCategoryId ?? null,
      sphereId: claim.sphereId || 'ideell',
      description: `${kind.label}: ${detail}`
    },
    donation: {
      ...shared,
      type: 'income',
      categoryId: options.donationCategoryId || 'cl_inc_donation',
      // The donation always belongs to the charitable sphere, even when the
      // expense arose elsewhere.
      sphereId: 'ideell',
      description: `Aufwandsspende ${donor}: Verzicht auf ${kind.label}`,
      // The tick on the donation receipt depends on this.
      waiver: true
    }
  };
}

export interface OverviewOptions {
  today?: IsoDate;
  fundsFor?: (claim: Claim) => Cents | null;
}

export function overview(
  claims: readonly Claim[] | null | undefined,
  year: number,
  options: OverviewOptions = {}
) {
  const rows = (claims ?? [])
    .filter((claim) => String(claim.date ?? '').slice(0, 4) === String(year))
    .map((claim) => ({
      ...claim,
      check: check(claim, {
        today: options.today,
        fundsAtBasisDate: options.fundsFor ? options.fundsFor(claim) : undefined
      })
    }));

  const open = rows.filter((row) => !row.waivedAt);
  const waived = rows.filter((row) => row.waivedAt);
  const sumAmount = (list: typeof rows): Cents => list.reduce((total, row) => total + row.amount, 0);

  return {
    year,
    rows: rows.sort((a, b) => String(b.date).localeCompare(String(a.date))),
    open,
    waived,
    blocked: rows.filter((row) => !row.check.ok),
    total: sumAmount(waived),
    openTotal: sumAmount(open),
    // The most important view on this page: an expired deadline cannot be
    // healed.
    dueSoon: open
      .filter((row) => row.check.ok && row.check.deadline)
      .sort((a, b) => a.check.deadline!.localeCompare(b.check.deadline!))
  };
}
