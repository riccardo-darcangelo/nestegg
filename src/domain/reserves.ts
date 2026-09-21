// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { roundCents } from './money';
import * as spheres from './spheres';
import type { SphereBucket } from './spheres';
import type { Asset } from './assets';
import type { BusinessDocument, Cents, Entry, Id, IsoDate, IsoTimestamp, Settings } from '../shared/types';

/**
 * Reserves under AO 62 and the use of funds.
 *
 * A charitable association has to spend its funds promptly (AO 55 (1) 5).
 * Reserves are the permitted exceptions, and each has its own reason, its own
 * ceiling and its own duty to be released. Getting this wrong puts the
 * charitable status at risk.
 *
 * The free reserve is the only one whose size can be calculated, which is
 * exactly why the app calculates it: one third of the surplus from asset
 * management, plus ten percent of the other funds subject to prompt use.
 * Those others are the gross income of the charitable sphere plus the profits
 * of the two operations; asset management stays out, it is already in the
 * first third.
 *
 * Whatever is not used up in a year can be caught up in the following two.
 *
 * All amounts in cents.
 */

export interface ReserveType {
  id: string;
  label: string;
  short: string;
  law: string;
  hint: string;
  needsPurpose: boolean;
  needsDeadline: boolean;
  /** Whether the amount is limited by law. */
  capped: boolean;
  linksAsset?: boolean;
  /** Funds that were never subject to prompt use in the first place. */
  outsideTimelyUse?: boolean;
}

export const TYPES: ReserveType[] = [
  {
    id: 'project',
    label: 'Zweckgebundene Rücklage',
    short: 'Projekt',
    law: '§ 62 Abs. 1 Nr. 1 AO',
    hint: 'Für ein bestimmtes Vorhaben, das nach dem Stand der Planung feststeht',
    // Needs a reason and must be released once it falls away. Without a
    // purpose and a timeframe the tax office does not accept it.
    needsPurpose: true,
    needsDeadline: true,
    capped: false
  },
  {
    id: 'operating',
    label: 'Betriebsmittelrücklage',
    short: 'Betriebsmittel',
    law: '§ 62 Abs. 1 Nr. 1 AO',
    hint: 'Für wiederkehrende Ausgaben wie Miete, Löhne oder Versicherungen, in Höhe des Bedarfs einer angemessenen Zeit',
    needsPurpose: true,
    needsDeadline: false,
    capped: false
  },
  {
    id: 'replacement',
    label: 'Wiederbeschaffungsrücklage',
    short: 'Wiederbeschaffung',
    law: '§ 62 Abs. 1 Nr. 2 AO',
    hint: 'Für den Ersatz eines Wirtschaftsguts, das dem Zweck dient. Die Höhe bemisst sich nach der Abschreibung',
    needsPurpose: true,
    needsDeadline: false,
    capped: false,
    linksAsset: true
  },
  {
    id: 'free',
    label: 'Freie Rücklage',
    short: 'Frei',
    law: '§ 62 Abs. 1 Nr. 3 AO',
    hint: 'Ohne Zweckbindung, dafür der Höhe nach begrenzt. Sie muss nicht aufgelöst werden',
    needsPurpose: false,
    needsDeadline: false,
    capped: true
  },
  {
    id: 'shares',
    label: 'Rücklage für Gesellschaftsrechte',
    short: 'Beteiligung',
    law: '§ 62 Abs. 1 Nr. 4 AO',
    hint: 'Um die Beteiligungsquote an einer Kapitalgesellschaft zu halten',
    needsPurpose: true,
    needsDeadline: false,
    capped: false
  },
  {
    id: 'endowment',
    label: 'Vermögenszuführung',
    short: 'Vermögen',
    law: '§ 62 Abs. 3 AO',
    hint: 'Erbschaften und Zuwendungen, die ausdrücklich das Vermögen aufstocken sollen. Sie sind gar nicht zeitnah zu verwenden',
    needsPurpose: true,
    needsDeadline: false,
    capped: false,
    outsideTimelyUse: true
  }
];

/** How many years an unused free reserve allowance can be carried forward. */
export const CARRY_YEARS = 2;

export function getType(id: string | null | undefined): ReserveType | null {
  return TYPES.find((type) => type.id === id) ?? null;
}

export interface Movement {
  id: string;
  date: IsoDate | null;
  /** The year it counts for, which can differ from the date: the allocation
   *  for 2026 is often resolved in 2027. */
  year: number | null;
  kind: 'add' | 'release';
  amount: Cents;
  note: string;
}

export interface Reserve {
  id: Id | null;
  type: string;
  label: string;
  purpose: string;
  deadline: IsoDate | null;
  assetId: Id | null;
  movements: Movement[];
  closed: boolean;
  note: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeMovement(raw: Partial<Movement>, index: number): Movement {
  return {
    id: raw.id || `bew_${index + 1}`,
    date: isIsoDate(raw.date) ? raw.date : null,
    year: Number(raw.year) || (isIsoDate(raw.date) ? Number(raw.date.slice(0, 4)) : null),
    kind: raw.kind === 'release' ? 'release' : 'add',
    amount: Math.abs(Math.trunc(Number(raw.amount) || 0)),
    note: String(raw.note ?? '').trim()
  };
}

export function normalizeReserve(raw: Partial<Reserve>): Reserve {
  const type = getType(raw.type) ?? TYPES[0]!;
  const now = new Date().toISOString();

  return {
    id: raw.id ?? null,
    type: type.id,
    label: String(raw.label ?? '').trim() || type.label,
    purpose: String(raw.purpose ?? '').trim(),
    deadline: isIsoDate(raw.deadline) ? raw.deadline : null,
    assetId: raw.assetId ?? null,
    movements: (raw.movements ?? []).map(normalizeMovement),
    closed: Boolean(raw.closed),
    note: String(raw.note ?? '').trim(),
    createdAt: raw.createdAt ?? now,
    updatedAt: now
  };
}

export function validateReserve(reserve: Reserve): string[] {
  const type = getType(reserve.type);
  const errors: string[] = [];

  if (!type) errors.push('Die Art der Rücklage ist unbekannt.');
  if (!reserve.label) errors.push('Die Rücklage braucht eine Bezeichnung.');

  if (type?.needsPurpose && !reserve.purpose) {
    errors.push(`Eine ${type.label} braucht einen konkreten Grund. Ohne ihn erkennt das Finanzamt sie nicht an.`);
  }
  if (type?.needsDeadline && !reserve.deadline) {
    errors.push('Eine zweckgebundene Rücklage braucht eine Zeitvorstellung, bis wann das Vorhaben umgesetzt wird.');
  }
  if (reserve.movements.some((movement) => !movement.year)) {
    errors.push('Jede Bewegung braucht ein Jahr.');
  }

  return errors;
}

/** The balance, optionally as at the end of a year. */
export function balanceOf(reserve: Reserve, year?: number): Cents {
  return (reserve.movements ?? []).reduce((total, movement) => {
    if (year && Number(movement.year) > Number(year)) return total;
    return total + (movement.kind === 'release' ? -movement.amount : movement.amount);
  }, 0);
}

function movementsIn(reserve: Reserve, year: number, kind: Movement['kind']): Cents {
  return (reserve.movements ?? [])
    .filter((movement) => movement.kind === kind && Number(movement.year) === Number(year))
    .reduce((total, movement) => total + movement.amount, 0);
}

export function addedIn(reserve: Reserve, year: number): Cents {
  return movementsIn(reserve, year, 'add');
}

export function releasedIn(reserve: Reserve, year: number): Cents {
  return movementsIn(reserve, year, 'release');
}

export interface FreeLimit {
  year: number;
  assetSurplus: Cents;
  third: Cents;
  otherMeans: Cents;
  tenth: Cents;
  limit: Cents;
  parts: { ideell: Cents; zweckbetrieb: Cents; wirtschaftlich: Cents };
}

function surplusOf(bucket: SphereBucket | undefined): Cents {
  if (!bucket) return 0;
  return Math.max(0, bucket.income - bucket.expense);
}

/** The ceiling for the free reserve in one year. */
export function freeLimit(entries: readonly Entry[] | null | undefined, year: number): FreeLimit {
  const result = spheres.calculate(entries, year);
  const by = Object.fromEntries(result.spheres.map((sphere) => [sphere.id, sphere]));

  // A loss in asset management does not make a negative third: the rule only
  // knows a surplus.
  const assetSurplus = surplusOf(by.vermoegen);
  const charitableIncome = by.ideell?.income ?? 0;
  const zweckProfit = surplusOf(by.zweckbetrieb);
  const businessProfit = surplusOf(by.wirtschaftlich);

  const otherMeans = charitableIncome + zweckProfit + businessProfit;

  return {
    year,
    assetSurplus,
    third: roundCents(assetSurplus / 3),
    otherMeans,
    tenth: roundCents(otherMeans / 10),
    limit: roundCents(assetSurplus / 3) + roundCents(otherMeans / 10),
    parts: { ideell: charitableIncome, zweckbetrieb: zweckProfit, wirtschaftlich: businessProfit }
  };
}

export interface CarryEntry {
  year: number;
  limit: Cents;
  used: Cents;
  remaining: Cents;
}

export interface FreeAllowance extends FreeLimit {
  carry: CarryEntry[];
  carryTotal: Cents;
  available: Cents;
  used: Cents;
  open: Cents;
  exceeded: boolean;
}

/**
 * What may actually go into the free reserve this year: the ceiling plus
 * whatever the two previous years left unused. A remainder from 2024 expires
 * after 2026.
 */
export function freeAllowance(
  entries: readonly Entry[] | null | undefined,
  reserves: readonly Reserve[] | null | undefined,
  year: number
): FreeAllowance {
  const free = (reserves ?? []).filter((reserve) => reserve.type === 'free');
  const usedIn = (forYear: number): Cents =>
    free.reduce((total, reserve) => total + addedIn(reserve, forYear), 0);

  const current = freeLimit(entries, year);
  const carry: CarryEntry[] = [];

  for (let back = CARRY_YEARS; back >= 1; back -= 1) {
    const past = year - back;
    const limit = freeLimit(entries, past);

    // What stayed open then is still available, unless it was drawn on since.
    const openThen = Math.max(0, limit.limit - usedIn(past));
    const usedSince = Math.max(0, usedIn(past + 1) - freeLimit(entries, past + 1).limit);
    const remaining = Math.max(0, openThen - usedSince);

    if (remaining > 0) carry.push({ year: past, limit: limit.limit, used: usedIn(past), remaining });
  }

  const carryTotal = carry.reduce((total, item) => total + item.remaining, 0);
  const available = current.limit + carryTotal;
  const used = usedIn(year);

  return {
    ...current,
    carry,
    carryTotal,
    available,
    used,
    open: Math.max(0, available - used),
    exceeded: used > available
  };
}

function euro(cents: Cents): string {
  return `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Euro`;
}

function formatDate(iso: string | null | undefined): string {
  const [year, month, day] = String(iso ?? '').split('-');
  return day ? `${day}.${month}.${year}` : String(iso ?? '');
}

export interface ReserveRow extends Reserve {
  typeLabel: string;
  typeShort: string;
  law: string;
  balance: Cents;
  added: Cents;
  released: Cents;
  /** Deadline passed while money is still in it. */
  overdue: boolean;
}

/** A reserve untouched for this long looks bad in an audit. */
const STALE_AFTER_YEARS = 3;

function checkReserves(
  list: readonly ReserveRow[],
  free: FreeAllowance,
  year: number
): string[] {
  const warnings: string[] = [];

  if (free.exceeded) {
    warnings.push(`Der freien Rücklage wurden ${euro(free.used)} zugeführt, zulässig waren ${euro(free.available)}. Der überschießende Betrag ist zeitnah zu verwenden, sonst steht die Gemeinnützigkeit in Frage.`);
  }

  for (const reserve of list) {
    if (reserve.overdue) {
      warnings.push(`"${reserve.label}": die Frist lief am ${formatDate(reserve.deadline)} ab. Ist der Grund entfallen, ist die Rücklage unverzüglich aufzulösen (§ 62 Abs. 2 AO).`);
    }
  }

  const stale = list.filter((reserve) => {
    if (reserve.type !== 'project' && reserve.type !== 'operating') return false;
    if (reserve.balance <= 0 || reserve.closed) return false;

    const last = [...(reserve.movements ?? [])].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0];
    return last ? Number(last.year) <= year - STALE_AFTER_YEARS : false;
  });

  for (const reserve of stale) {
    warnings.push(`"${reserve.label}" liegt seit mehr als drei Jahren unverändert. Eine Rücklage ohne erkennbaren Fortschritt fällt in einer Prüfung auf.`);
  }

  if (free.carryTotal > 0) {
    const expiresAfter = free.carry[0] ? free.carry[0].year + CARRY_YEARS : year;
    warnings.push(`Aus den Vorjahren stehen noch ${euro(free.carryTotal)} an nicht ausgeschöpfter freier Rücklage zur Verfügung. Der älteste Rest verfällt nach ${expiresAfter}.`);
  }

  return warnings;
}

export function overview(
  reserves: readonly Reserve[] | null | undefined,
  entries: readonly Entry[] | null | undefined,
  year: number,
  today?: IsoDate
): {
  year: number;
  reserves: ReserveRow[];
  total: Cents;
  timelyBound: Cents;
  free: FreeAllowance;
  types: ReserveType[];
  warnings: string[];
} {
  const cutoff = today || `${year}-12-31`;

  const list: ReserveRow[] = (reserves ?? []).map((reserve) => {
    const type = getType(reserve.type) ?? TYPES[0]!;
    const balance = balanceOf(reserve, year);

    return {
      ...reserve,
      typeLabel: type.label,
      typeShort: type.short,
      law: type.law,
      balance,
      added: addedIn(reserve, year),
      released: releasedIn(reserve, year),
      overdue: Boolean(reserve.deadline && !reserve.closed && balance > 0 && reserve.deadline < cutoff)
    };
  });

  const free = freeAllowance(entries, reserves, year);

  return {
    year,
    reserves: list.sort((a, b) => b.balance - a.balance),
    total: list.reduce((total, reserve) => total + reserve.balance, 0),
    timelyBound: list
      .filter((reserve) => !getType(reserve.type)?.outsideTimelyUse)
      .reduce((total, reserve) => total + reserve.balance, 0),
    free,
    types: TYPES,
    warnings: checkReserves(list, free, year)
  };
}

export { checkReserves as check };

/**
 * The use of funds statement.
 *
 * It answers the question the tax office asks: what came in, what was spent,
 * and what is still lying around? Whatever remains and is not held in a
 * permitted reserve has to be spent promptly.
 */
export function useOfFunds(
  entries: readonly Entry[] | null | undefined,
  reserves: readonly Reserve[] | null | undefined,
  year: number
) {
  const result = spheres.calculate(entries, year);
  const by = Object.fromEntries(result.spheres.map((sphere) => [sphere.id, sphere]));

  // Subject to prompt use: the charitable income plus the surpluses of the
  // other spheres.
  const inflow = (by.ideell?.income ?? 0)
    + surplusOf(by.zweckbetrieb)
    + surplusOf(by.wirtschaftlich)
    + surplusOf(by.vermoegen);

  const used = by.ideell?.expense ?? 0;
  const toReserves = (reserves ?? []).reduce((total, reserve) => total + addedIn(reserve, year), 0);
  const fromReserves = (reserves ?? []).reduce((total, reserve) => total + releasedIn(reserve, year), 0);
  const remaining = inflow - used - toReserves + fromReserves;

  return {
    year,
    inflow,
    used,
    toReserves,
    fromReserves,
    remaining,
    deadline: `${year + 2}-12-31` as IsoDate,
    applies: spheres.timelyUseCheck(entries, year).applies,
    note: remaining > 0
      ? `Aus ${year} sind ${euro(remaining)} weder verwendet noch in eine Rücklage eingestellt. Sie sind bis zum 31.12.${year + 2} zu verwenden.`
      : `Die Mittel des Jahres ${year} sind verwendet oder in Rücklagen gebunden.`
  };
}

export interface NetAssetsData {
  entries?: Entry[];
  invoices?: BusinessDocument[];
  assets?: Asset[];
  reserves?: Reserve[];
  settings?: Settings;
}

/** Passed in rather than imported, to keep this module free of cycles. */
export interface NetAssetsDeps {
  assetsDomain: { bookValueAtEndOf: (asset: Asset, year: number) => Cents };
  invoicesDomain: { totals: (invoice: BusinessDocument) => { openAmount: Cents } };
  typeOf?: (document: BusinessDocument) => { group: string };
}

/**
 * Net assets as at a given date.
 *
 * An association reports on income and expenses under AO 63 (3), and in
 * practice that includes a statement of assets: the tax office wants to know
 * where the unspent funds are.
 *
 * The bank balance comes from the settings because the program knows no
 * account; everything else comes from the bookings.
 */
export function netAssets(data: NetAssetsData, deps: NetAssetsDeps, date: IsoDate) {
  const year = Number(String(date).slice(0, 4));
  const reserveSettings = (data.settings?.reserve ?? {}) as {
    accountBalance?: number;
    accountBalanceDate?: IsoDate;
  };

  const balanceDate = reserveSettings.accountBalanceDate ?? null;
  const opening = Math.trunc(Number(reserveSettings.accountBalance) || 0);

  const movements = (data.entries ?? [])
    .filter((entry) => entry.paidDate && (!balanceDate || entry.paidDate > balanceDate) && entry.paidDate <= date)
    .reduce((total, entry) => total + (entry.type === 'income' ? entry.gross : -entry.gross), 0);

  const liquid = opening + movements;

  const receivables = (data.invoices ?? []).reduce((total, invoice) => {
    if (deps.typeOf && deps.typeOf(invoice).group !== 'invoice') return total;
    if (!invoice.issueDate || invoice.issueDate > date) return total;
    if (invoice.status === 'draft' || invoice.status === 'cancelled') return total;
    return total + deps.invoicesDomain.totals(invoice).openAmount;
  }, 0);

  const payables = (data.entries ?? [])
    .filter((entry) => entry.type === 'expense' && !entry.paidDate && entry.date <= date)
    .reduce((total, entry) => total + entry.gross, 0);

  const assetItems = (data.assets ?? [])
    .filter((asset) => asset.purchaseDate && asset.purchaseDate <= date)
    .map((asset) => ({
      id: asset.id,
      name: asset.label || 'Anlagegut',
      purchaseDate: asset.purchaseDate,
      cost: asset.netCents,
      bookValue: deps.assetsDomain.bookValueAtEndOf(asset, year)
    }))
    .filter((asset) => asset.bookValue > 0);

  const fixedAssets = assetItems.reduce((total, asset) => total + asset.bookValue, 0);

  const reserveList = (data.reserves ?? [])
    .map((reserve) => ({
      id: reserve.id,
      label: reserve.label,
      type: reserve.type,
      typeLabel: getType(reserve.type)?.label ?? reserve.type,
      law: getType(reserve.type)?.law ?? '',
      balance: balanceOf(reserve, year)
    }))
    .filter((reserve) => reserve.balance !== 0);

  const reservesTotal = reserveList.reduce((total, reserve) => total + reserve.balance, 0);
  const assetsTotal = liquid + receivables + fixedAssets;

  return {
    date,
    year,
    assets: { liquid, receivables, fixedAssets, items: assetItems, total: assetsTotal },
    liabilities: {
      payables,
      reserves: reserveList,
      reservesTotal,
      total: payables + reservesTotal
    },
    equity: assetsTotal - payables - reservesTotal,
    // Without a maintained balance the statement is only as good as the
    // movements. That belongs said out loud.
    hasOpeningBalance: Boolean(opening || balanceDate),
    balanceDate
  };
}
