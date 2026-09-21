// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import type { Cents, Entry, IsoDate, SphereId } from '../shared/types';

/**
 * The four spheres of a charitable association.
 *
 * An association is not a business under another name. Its income falls into
 * four areas, and only that classification decides whether tax is due and
 * whether input VAT may be deducted:
 *
 *   ideell          membership fees, donations, grants. The core activity,
 *                   not a business, so neither output VAT nor a deduction.
 *   vermoegen       interest, rent, leased advertising rights (AO 14 s3).
 *                   Free of corporation tax.
 *   zweckbetrieb    commercial activity that directly serves the charitable
 *                   purpose (AO 65 to 68). Free of corporation and trade tax,
 *                   reduced VAT of seven percent (UStG 12 (2) 8a).
 *   wirtschaftlich  everything else: the clubhouse bar, advertising, active
 *                   sponsoring, sales. Fully taxable once the threshold is
 *                   passed.
 *
 * As of 1 January 2026. The 2025 tax amendment raised the limits: the
 * taxation threshold and the sports threshold from 45,000 to 50,000 euro, and
 * the duty to spend funds promptly now starts at 100,000 euro of income.
 * If those figures change, they change here.
 *
 * All amounts in cents.
 */

export interface Sphere {
  id: SphereId;
  label: string;
  short: string;
  order: number;
  color: string;
  hint: string;
  /** Whether this counts as business activity at all. */
  business: boolean;
  inputVat: boolean;
  corporateTax: boolean;
  defaultVatRate: number;
  law: string;
}

export const SPHERES: Sphere[] = [
  {
    id: 'ideell',
    label: 'Ideeller Bereich',
    short: 'Ideell',
    order: 1,
    color: '#5b9cf8',
    hint: 'Mitgliedsbeiträge, Spenden, Zuschüsse, Bußgelder',
    // Not a business: no VAT on income, no deduction on expenses. This is the
    // distinction that gets booked wrong most often in practice.
    business: false,
    inputVat: false,
    corporateTax: false,
    defaultVatRate: 0,
    law: '§§ 51 bis 68 AO'
  },
  {
    id: 'vermoegen',
    label: 'Vermögensverwaltung',
    short: 'Vermögen',
    order: 2,
    color: '#7c93f8',
    hint: 'Zinsen, Mieten, Verpachtung von Werberechten',
    business: true,
    inputVat: true,
    corporateTax: false,
    // Renting is often exempt, interest is out of scope and leased
    // advertising is reduced. Seven percent is the most useful default; the
    // individual case decides.
    defaultVatRate: 7,
    law: '§ 14 Satz 3 AO'
  },
  {
    id: 'zweckbetrieb',
    label: 'Zweckbetrieb',
    short: 'Zweckbetrieb',
    order: 3,
    color: '#4ecb8f',
    hint: 'Sportveranstaltungen, Kurse, Beiträge für satzungsgemäße Leistungen',
    business: true,
    inputVat: true,
    corporateTax: false,
    defaultVatRate: 7,
    law: '§§ 65 bis 68 AO, § 12 Abs. 2 Nr. 8a UStG'
  },
  {
    id: 'wirtschaftlich',
    label: 'Wirtschaftlicher Geschäftsbetrieb',
    short: 'Wirtschaftlich',
    order: 4,
    color: '#edb04a',
    hint: 'Gaststätte, Werbung, aktives Sponsoring, Verkauf',
    business: true,
    inputVat: true,
    corporateTax: true,
    defaultVatRate: 19,
    law: '§ 14, § 64 AO'
  }
];

export const LIMITS = {
  /** AO 64 (3): below this the commercial operation stays free of corporation
   *  and trade tax. What counts is income including VAT, not profit. */
  taxation: 5_000_000 as Cents,
  /** AO 67a (1): below this, sports events remain a charitable operation even
   *  with paid athletes taking part. */
  sportsEvents: 5_000_000 as Cents,
  /** AO 55 (1) 5 s4: below this there is no duty to spend funds promptly. */
  timelyUse: 10_000_000 as Cents,
  corporateTaxAllowance: 500_000 as Cents,
  tradeTaxAllowance: 500_000 as Cents,
  /** EStG 3 nr 26 and 26a. */
  trainerAllowance: 330_000 as Cents,
  volunteerAllowance: 96_000 as Cents,
  /** EStDV 50 (4): up to here a bank statement is proof enough for a donation. */
  simpleDonationProof: 30_000 as Cents,
  year: 2026
} as const;

export function getSphere(id: string | null | undefined): Sphere | null {
  return SPHERES.find((sphere) => sphere.id === id) ?? null;
}

export function sphereLabel(id: string | null | undefined): string {
  return getSphere(id)?.label ?? 'ohne Sphäre';
}

/**
 * Without a sphere nothing is deducted. In doubt it is the charitable area,
 * and an input VAT deduction taken wrongly costs more than one forgotten.
 */
export function allowsInputVat(sphereId: string | null | undefined): boolean {
  return getSphere(sphereId)?.inputVat ?? false;
}

export function defaultVatRate(sphereId: string | null | undefined): number {
  return getSphere(sphereId)?.defaultVatRate ?? 0;
}

export interface SphereBucket {
  id: string;
  label: string;
  short: string;
  color: string;
  order: number;
  hint: string;
  law: string;
  income: Cents;
  incomeNet: Cents;
  expense: Cents;
  expenseNet: Cents;
  result: Cents;
  count: number;
}

/** Takes a plain id, because the bucket for unassigned entries is not a sphere. */
function emptyBucket(sphere: Omit<SphereBucket, 'income' | 'incomeNet' | 'expense' | 'expenseNet' | 'result' | 'count'>): SphereBucket {
  return {
    id: sphere.id,
    label: sphere.label,
    short: sphere.short,
    color: sphere.color,
    order: sphere.order,
    hint: sphere.hint,
    law: sphere.law,
    income: 0,
    incomeNet: 0,
    expense: 0,
    expenseNet: 0,
    result: 0,
    count: 0
  };
}

function euro(cents: Cents): string {
  return `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Euro`;
}

function yearOf(entry: Entry): number | null {
  if (!entry.paidDate) return null;
  return Number(entry.taxYearOverride || entry.paidDate.slice(0, 4));
}

export interface TaxationCheck {
  income: Cents;
  result: Cents;
  limit: Cents;
  percent: number;
  exceeded: boolean;
  year: number;
  notes: string[];
}

/**
 * The threshold of AO 64 (3) compares income including VAT, not profit. An
 * association with 60,000 euro of income and 59,000 of expenses is over it,
 * even though almost nothing remains.
 */
function taxationCheck(buckets: Map<string, SphereBucket>, year: number): TaxationCheck {
  const commercial = buckets.get('wirtschaftlich');
  const income = commercial?.income ?? 0;
  const result = commercial ? commercial.income - commercial.expense : 0;

  const exceeded = income > LIMITS.taxation;
  const percent = Math.round((income / LIMITS.taxation) * 100);
  const notes: string[] = [];

  if (exceeded) {
    notes.push(`Die Besteuerungsgrenze von ${euro(LIMITS.taxation)} ist überschritten. Der wirtschaftliche Geschäftsbetrieb unterliegt damit der Körperschaft- und der Gewerbesteuer.`);
    if (result <= LIMITS.corporateTaxAllowance) {
      notes.push(`Der Überschuss liegt unter dem Freibetrag von ${euro(LIMITS.corporateTaxAllowance)}. Es bleibt voraussichtlich bei null Euro Steuer, die Erklärung ist trotzdem abzugeben.`);
    }
  } else {
    if (percent >= 80) {
      notes.push(`Die Einnahmen liegen bei ${percent} Prozent der Besteuerungsgrenze von ${euro(LIMITS.taxation)}. Bei Überschreiten wird der gesamte wirtschaftliche Geschäftsbetrieb steuerpflichtig, nicht nur der übersteigende Teil.`);
    }
    notes.push('Unterhalb der Grenze muss seit 2026 nicht mehr abgegrenzt werden, ob eine Einnahme zum Zweckbetrieb oder zum wirtschaftlichen Geschäftsbetrieb gehört (§ 64 Abs. 3 Satz 2 AO). Für die Umsatzsteuer gilt die Erleichterung nicht.');
  }

  return { income, result, limit: LIMITS.taxation, percent, exceeded, year, notes };
}

/** Allowances only bite once there is a tax liability at all. */
function allowanceCheck(buckets: Map<string, SphereBucket>) {
  const commercial = buckets.get('wirtschaftlich');
  const result = commercial ? commercial.income - commercial.expense : 0;

  return {
    result,
    corporateTax: {
      allowance: LIMITS.corporateTaxAllowance,
      taxable: Math.max(0, result - LIMITS.corporateTaxAllowance),
      law: '§ 24 KStG'
    },
    tradeTax: {
      allowance: LIMITS.tradeTaxAllowance,
      taxable: Math.max(0, result - LIMITS.tradeTaxAllowance),
      law: '§ 11 Abs. 1 Satz 3 Nr. 2 GewStG'
    }
  };
}

export interface SphereResult {
  year: number;
  spheres: SphereBucket[];
  totals: { income: Cents; expense: Cents; result: Cents; count: number };
  unassigned: number;
  taxation: TaxationCheck;
  allowances: ReturnType<typeof allowanceCheck>;
}

/**
 * Cash basis, like the income and expenditure account an association has to
 * keep anyway under AO 63 (3). Gross, because the taxation threshold looks at
 * income including VAT.
 */
export function calculate(entries: readonly Entry[] | null | undefined, year: number): SphereResult {
  const buckets = new Map(SPHERES.map((sphere) => [sphere.id as string, emptyBucket(sphere)]));
  const unassigned = emptyBucket({
    id: 'offen',
    label: 'Ohne Zuordnung',
    short: 'Offen',
    order: 9,
    color: '#f2756b',
    hint: 'muss noch einer Sphäre zugeordnet werden',
    law: ''
  });

  for (const entry of entries ?? []) {
    if (yearOf(entry) !== Number(year)) continue;

    const bucket = buckets.get(entry.sphereId ?? '') ?? unassigned;
    bucket.count += 1;

    if (entry.type === 'income') {
      bucket.income += entry.gross;
      bucket.incomeNet += entry.net;
    } else {
      bucket.expense += entry.gross;
      bucket.expenseNet += entry.net;
    }
  }

  const list = [...buckets.values()];
  if (unassigned.count) list.push(unassigned);
  for (const bucket of list) bucket.result = bucket.income - bucket.expense;

  const totals = list.reduce(
    (sum, bucket) => ({
      income: sum.income + bucket.income,
      expense: sum.expense + bucket.expense,
      result: sum.result + bucket.result,
      count: sum.count + bucket.count
    }),
    { income: 0, expense: 0, result: 0, count: 0 }
  );

  return {
    year,
    spheres: list.sort((a, b) => a.order - b.order),
    totals,
    unassigned: unassigned.count,
    taxation: taxationCheck(buckets, year),
    allowances: allowanceCheck(buckets)
  };
}

export { taxationCheck };

function incomeOfYear(entries: readonly Entry[] | null | undefined, year: number, filter: (entry: Entry) => boolean): Cents {
  return (entries ?? [])
    .filter((entry) => entry.type === 'income' && String(entry.paidDate ?? '').slice(0, 4) === String(year) && filter(entry))
    .reduce((total, entry) => total + entry.gross, 0);
}

/**
 * Up to 50,000 euro of income, sports events stay a charitable operation even
 * with paid athletes. Above that every event is judged on its own, and those
 * with paid athletes become commercial.
 */
export function sportsCheck(entries: readonly Entry[] | null | undefined, year: number) {
  const income = incomeOfYear(entries, year, (entry) => entry.sphereId === 'zweckbetrieb' && entry.sportsEvent);
  const exceeded = income > LIMITS.sportsEvents;

  return {
    income,
    limit: LIMITS.sportsEvents,
    exceeded,
    note: exceeded
      ? `Die Einnahmen aus sportlichen Veranstaltungen liegen über ${euro(LIMITS.sportsEvents)}. Die Zweckbetriebseigenschaft ist damit für jede Veranstaltung einzeln zu prüfen; wirken bezahlte Sportler mit, wird sie zum wirtschaftlichen Geschäftsbetrieb. Auf die Option nach § 67a Abs. 2 AO kann verzichtet werden.`
      : `Sportliche Veranstaltungen bleiben bis ${euro(LIMITS.sportsEvents)} Einnahmen Zweckbetrieb (§ 67a Abs. 1 AO).`
  };
}

/**
 * Funds have to be spent by the end of the year after next (AO 55 (1) 5).
 * Since 2026 that only applies above 100,000 euro of annual income; smaller
 * associations may save up without risking their charitable status.
 */
export function timelyUseCheck(entries: readonly Entry[] | null | undefined, year: number) {
  const income = incomeOfYear(entries, year, () => true);
  const applies = income > LIMITS.timelyUse;

  return {
    income,
    limit: LIMITS.timelyUse,
    applies,
    deadline: `${year + 2}-12-31` as IsoDate,
    note: applies
      ? `Die Einnahmen liegen über ${euro(LIMITS.timelyUse)}. Die Mittel des Jahres ${year} sind damit bis zum 31.12.${year + 2} zu verwenden, soweit sie nicht in eine zulässige Rücklage nach § 62 AO eingestellt werden.`
      : `Mit Einnahmen unter ${euro(LIMITS.timelyUse)} besteht seit 2026 keine Pflicht zur zeitnahen Mittelverwendung (§ 55 Abs. 1 Nr. 5 Satz 4 AO).`
  };
}

/** The list to walk through once a year, before the tax return. */
export function review(entries: readonly Entry[] | null | undefined, year: number) {
  const result = calculate(entries, year);
  const warnings: string[] = [];

  if (result.unassigned) {
    warnings.push(`${result.unassigned} ${result.unassigned === 1 ? 'Buchung ist' : 'Buchungen sind'} keiner Sphäre zugeordnet. Ohne Zuordnung lässt sich weder die Besteuerungsgrenze prüfen noch der Vorsteuerabzug begründen.`);
  }
  warnings.push(...result.taxation.notes);

  const sports = sportsCheck(entries, year);
  if (sports.exceeded) warnings.push(sports.note);

  const timelyUse = timelyUseCheck(entries, year);
  if (timelyUse.applies) warnings.push(timelyUse.note);

  const charitable = result.spheres.find((sphere) => sphere.id === 'ideell');
  if (charitable && charitable.result < 0) {
    warnings.push('Der ideelle Bereich schließt mit einem Fehlbetrag. Wird er dauerhaft aus dem wirtschaftlichen Geschäftsbetrieb gedeckt, ist das unschädlich; umgekehrt dürfen Mittel des ideellen Bereichs nicht in den wirtschaftlichen Geschäftsbetrieb fließen (§ 55 Abs. 1 Nr. 1 AO).');
  }

  return { ...result, sports, timelyUse, warnings, limits: LIMITS };
}
