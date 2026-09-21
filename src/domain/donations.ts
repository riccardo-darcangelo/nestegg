// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { LIMITS } from './spheres';
import type { Cents, Company, Entity, Entry, Id, IsoDate, Settings } from '../shared/types';

/**
 * Donation receipts.
 *
 * Without one a donor can deduct nothing, and an association that issues them
 * wrongly is liable for thirty percent of the amount under EStG 10b (4). That
 * is why nothing here is guessed: if a mandatory detail is missing the app
 * says so instead of printing a receipt that hurts the association.
 *
 * Two forms, both following the official template (EStDV 50): a single
 * receipt for one donation, and a collective one covering a whole year, which
 * must be labelled as such and carry a list of the individual donations.
 *
 * Up to 300 euro a bank statement is proof enough for the donor (EStDV 50
 * (4)). A receipt may still be issued, and most associations do, because
 * donors ask for one.
 */

export type DonationType = 'money' | 'dues' | 'kind' | 'expense';

export const TYPES: Record<DonationType, { id: DonationType; label: string; title: string }> = {
  money: { id: 'money', label: 'Geldzuwendung', title: 'Bestätigung über Geldzuwendungen' },
  dues: { id: 'dues', label: 'Mitgliedsbeitrag', title: 'Bestätigung über Geldzuwendungen und Mitgliedsbeiträge' },
  kind: { id: 'kind', label: 'Sachzuwendung', title: 'Bestätigung über Sachzuwendungen' },
  expense: { id: 'expense', label: 'Aufwandsspende', title: 'Bestätigung über Geldzuwendungen' }
};

const ONES = [
  'null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
  'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn',
  'achtzehn', 'neunzehn'
];

const TENS = [
  '', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'
];

/**
 * A one at the end of a number is "eins", inside it is "ein": einhunderteins,
 * but einhundertelf and einundzwanzig.
 */
function tail(value: number): string {
  return value === 1 ? 'eins' : group(value);
}

function group(value: number): string {
  if (value < 20) return ONES[value]!;

  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)]!;
    const ones = value % 10;
    return ones ? `${ONES[ones]}und${tens}` : tens;
  }

  if (value < 1000) {
    const rest = value % 100;
    return `${ONES[Math.floor(value / 100)]}hundert${rest ? tail(rest) : ''}`;
  }

  if (value < 1_000_000) {
    const rest = value % 1000;
    return `${group(Math.floor(value / 1000))}tausend${rest ? tail(rest) : ''}`;
  }

  // Million and Milliarde are nouns and stand apart.
  const millions = Math.floor(value / 1_000_000);
  const rest = value % 1_000_000;
  const name = millions === 1 ? 'eine Million' : `${group(millions)} Millionen`;

  return `${name}${rest ? ` ${tail(rest)}` : ''}`;
}

/**
 * A number in words, as the official template demands. German number words
 * run together and put the units before the tens: einundzwanzig, not
 * zwanzigundein.
 */
export function inWords(value: number): string {
  const whole = Math.trunc(Math.abs(Number(value) || 0));
  return whole === 0 ? 'null' : tail(whole);
}

/** Before a unit the one is "ein": ein Euro, ein Cent. */
function withUnit(value: number, unit: string): string {
  return value === 1 ? `ein ${unit}` : `${inWords(value)} ${unit}`;
}

export function amountInWords(cents: Cents): string {
  const value = Math.abs(Math.trunc(Number(cents) || 0));
  const euros = withUnit(Math.floor(value / 100), 'Euro');
  const rest = value % 100;

  return rest ? `${euros} und ${withUnit(rest, 'Cent')}` : euros;
}

const DONATION_CATEGORIES = new Set(['cl_inc_donation', 'cl_inc_donation_kind', 'cl_inc_dues']);

export function isDonation(entry: Entry): boolean {
  return DONATION_CATEGORIES.has(entry.categoryId);
}

/** Which kind of receipt a booking belongs to. */
export function typeOf(entry: Entry): DonationType {
  if (entry.categoryId === 'cl_inc_donation_kind') return 'kind';
  if (entry.categoryId === 'cl_inc_dues') return 'dues';
  return 'money';
}

function yearRange(year: number): { from: IsoDate; to: IsoDate } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function isDonationInYear(entry: Entry, from: IsoDate, to: IsoDate): boolean {
  if (entry.type !== 'income' || !entry.paidDate) return false;
  if (entry.paidDate < from || entry.paidDate > to) return false;
  return isDonation(entry);
}

/**
 * Collects one donor's donations in a year.
 *
 * Matching goes by category, not by sphere: a donation stays a donation even
 * when someone filed it elsewhere by mistake.
 */
export function collect(
  entries: readonly Entry[] | null | undefined,
  filter: { customerId?: Id | null; counterparty?: string; year: number }
): Entry[] {
  const { from, to } = yearRange(filter.year);
  const name = String(filter.counterparty ?? '').trim().toLowerCase();

  return (entries ?? [])
    .filter((entry) => {
      if (!isDonationInYear(entry, from, to)) return false;
      if (filter.customerId) return entry.customerId === filter.customerId;
      if (name) return String(entry.counterparty ?? '').trim().toLowerCase() === name;
      return false;
    })
    .sort((a, b) => a.paidDate!.localeCompare(b.paidDate!));
}

export interface Donor {
  name: string;
  street: string;
  zip: string;
  city: string;
}

interface CheckInput {
  list: readonly Entry[];
  entity: Entity;
  company: Company;
  donor: Donor;
  total: Cents;
}

function yearsSince(iso: string): number | null {
  const then = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return null;
  return (Date.now() - then.getTime()) / (365.25 * 24 * 3600 * 1000);
}

/** The exemption notice must not be older than five years. */
const NOTICE_MAX_AGE_YEARS = 5;

/**
 * What is missing for the receipt to be valid.
 *
 * This list is the real value of the module. A receipt without the details of
 * the exemption notice is worthless, and the donor only finds out when the
 * tax office rejects it.
 */
export function check({ list, entity, company, donor, total }: CheckInput): string[] {
  const warnings: string[] = [];

  if (!entity.charitable) {
    warnings.push('Für dieses Profil ist nicht hinterlegt, dass es sich um eine steuerbegünstigte Körperschaft handelt. Ohne Gemeinnützigkeit darf keine Zuwendungsbestätigung ausgestellt werden.');
  }
  if (!entity.purpose) warnings.push('Der begünstigte Zweck fehlt. Er steht im Freistellungsbescheid, etwa "Förderung des Sports".');
  if (!entity.noticeDate || !entity.noticeOffice) {
    warnings.push('Datum und Finanzamt des Freistellungsbescheids fehlen. Beides ist Pflichtangabe auf jeder Bestätigung.');
  }
  if (!company.taxNumber) warnings.push('Die Steuernummer des Vereins fehlt.');
  if (!company.name) warnings.push('Der Name des Vereins fehlt.');

  if (!donor.name) warnings.push('Der Name des Zuwendenden fehlt.');
  if (!donor.street || !donor.city) warnings.push('Die Anschrift des Zuwendenden fehlt. Sie gehört zu den Pflichtangaben.');

  if (!list.length) warnings.push('Es sind keine Zuwendungen ausgewählt.');
  if (total <= 0) warnings.push('Der Betrag ist null.');

  if (entity.noticeDate) {
    const age = yearsSince(String(entity.noticeDate));
    if (age !== null && age > NOTICE_MAX_AGE_YEARS) {
      warnings.push(`Der Freistellungsbescheid ist ${Math.floor(age)} Jahre alt. Bestätigungen dürfen nur ausgestellt werden, wenn das Datum des Bescheids nicht länger als fünf Jahre zurückliegt.`);
    }
  }

  if (list.some((entry) => typeOf(entry) === 'kind' && !entry.note)) {
    warnings.push('Bei einer Sachzuwendung verlangt das Muster die genaue Bezeichnung der Sache und die Angabe, woher der Wert stammt. Trage das in der Notiz der Buchung nach.');
  }

  // The official template has one tick for the whole receipt, so a waived
  // claim and an ordinary donation cannot share one: one of them would be
  // stated wrongly.
  const waiverCount = list.filter((entry) => entry.waiver).length;
  if (waiverCount > 0 && waiverCount < list.length) {
    warnings.push('Ausgewählt sind Aufwandsspenden und gewöhnliche Zuwendungen zusammen. Das Muster kennt für den Verzicht auf Erstattung von Aufwendungen nur ein Kreuz für die gesamte Bestätigung, deshalb gehören beide in getrennte Bestätigungen.');
  }

  if (total <= LIMITS.simpleDonationProof && list.length === 1) {
    warnings.push(`Bis ${(LIMITS.simpleDonationProof / 100).toFixed(0)} Euro genügt dem Spender der Kontoauszug als Nachweis (§ 50 Abs. 4 EStDV). Eine Bestätigung ist erlaubt, aber nicht nötig.`);
  }

  return warnings;
}

/** A receipt covering several kinds falls back to the money form. */
function receiptTypeFor(list: readonly Entry[]): DonationType {
  const kinds = new Set(list.map(typeOf));
  if (kinds.has('kind')) return 'kind';
  if (kinds.has('dues') && kinds.size === 1) return 'dues';
  return 'money';
}

export interface PrepareOptions {
  year?: number;
  today?: IsoDate;
  collective?: boolean;
  waiver?: boolean;
}

export function prepare(
  entries: ReadonlyArray<Entry | null | undefined>,
  settings: Settings,
  donor: Partial<Donor>,
  options: PrepareOptions = {}
) {
  const list = (entries ?? []).filter((entry): entry is Entry => Boolean(entry));
  const entity = settings.entity;
  const company = settings.company;

  const total = list.reduce((sum, entry) => sum + entry.gross, 0);
  const cleanDonor: Donor = {
    name: String(donor.name ?? '').trim(),
    street: String(donor.street ?? '').trim(),
    zip: String(donor.zip ?? '').trim(),
    city: String(donor.city ?? '').trim()
  };

  return {
    type: receiptTypeFor(list),
    collective: options.collective ?? list.length > 1,
    year: options.year ?? (list[0] ? Number(list[0].paidDate!.slice(0, 4)) : null),
    date: options.today ?? new Date().toISOString().slice(0, 10),
    donor: cleanDonor,
    issuer: {
      name: company.name ?? '',
      street: company.street ?? '',
      zip: company.zip ?? '',
      city: company.city ?? '',
      taxNumber: company.taxNumber ?? ''
    },
    notice: {
      type: entity.noticeType ?? 'freistellung',
      date: entity.noticeDate ?? '',
      office: entity.noticeOffice ?? '',
      year: entity.noticeYear ?? '',
      purpose: entity.purpose ?? ''
    },
    board: { name: entity.boardName ?? '', role: entity.boardRole ?? 'Vorstand' },
    entries: list.map((entry) => ({
      id: entry.id,
      date: entry.paidDate,
      amount: entry.gross,
      description: entry.description,
      type: typeOf(entry),
      // Only filled for donations in kind: the template wants an exact
      // description and where the value came from.
      note: entry.note || ''
    })),
    total,
    totalInWords: amountInWords(total),
    // The tick follows the bookings rather than a checkbox: a waived claim
    // carries its mark since the waiver, and anyone having to set it by hand
    // forgets.
    waiver: list.some((entry) => entry.waiver) || Boolean(options.waiver),
    warnings: check({ list, entity, company, donor: cleanDonor, total })
  };
}

export interface DonorGroup {
  key: string;
  customerId: Id | null;
  memberId: Id | null;
  name: string;
  hasAddress: boolean;
  entries: Entry[];
  total: Cents;
  dues: Cents;
  donations: Cents;
  /** Counted separately, because waived claims need their own receipt. */
  waiver: Cents;
}

type Party = { id: Id; name?: string; street?: string; city?: string };

/**
 * A year's donations grouped by donor.
 *
 * A donor may be a customer or a member. Both come in the same list, because
 * all the receipt needs is a name and an address, and those sit in the same
 * fields either way.
 */
export function overview(
  entries: readonly Entry[] | null | undefined,
  people: readonly Party[] | null | undefined,
  year: number
) {
  const { from, to } = yearRange(year);
  const groups = new Map<string, DonorGroup>();

  for (const entry of entries ?? []) {
    if (!isDonationInYear(entry, from, to)) continue;

    const partyId = entry.customerId || entry.memberId || null;
    const party = (people ?? []).find((item) => item.id === partyId);
    const key = partyId ?? `name:${String(entry.counterparty ?? '').trim().toLowerCase()}`;

    const group = groups.get(key) ?? {
      key,
      customerId: entry.customerId,
      memberId: entry.memberId,
      name: party?.name || entry.counterparty || 'ohne Namen',
      hasAddress: Boolean(party?.street && party.city),
      entries: [],
      total: 0,
      dues: 0,
      donations: 0,
      waiver: 0
    };

    group.entries.push(entry);
    group.total += entry.gross;
    if (typeOf(entry) === 'dues') group.dues += entry.gross;
    else group.donations += entry.gross;
    if (entry.waiver) group.waiver += entry.gross;

    groups.set(key, group);
  }

  const donors = [...groups.values()].sort((a, b) => b.total - a.total);

  return {
    year,
    donors,
    total: donors.reduce((sum, group) => sum + group.total, 0),
    count: donors.reduce((sum, group) => sum + group.entries.length, 0),
    simpleProofLimit: LIMITS.simpleDonationProof
  };
}
