// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { formatAmount } from '../domain/money';
import { getCategory, ALL_CATEGORIES } from '../domain/categories';
import { taxEffect } from '../domain/entries';
import type { BusinessDocument, Cents, Entry, EntryType, Id, IsoDate, Settings, Snapshot } from '../shared/types';

/**
 * DATEV export: a booking batch in the EXTF format.
 *
 * The road to the tax advisor. DATEV published the format so foreign software
 * can hand over bookings; every practice package reads it.
 *
 * A batch is two header lines plus one line per booking. Each line names the
 * amount, the debit/credit marker, the account and the contra account. So
 * everything hangs on the account mapping, and that is exactly where this
 * export has its limit:
 *
 *   This software keeps no double entry books. It knows categories, not
 *   accounts. The mapping below is a proposal following the usual practice of
 *   SKR 03 and SKR 04, and SKR 42 for associations. Which accounts the
 *   practice actually posts to only the practice knows. So the mapping can be
 *   changed in the settings, and every run says that it needs agreeing.
 *
 * The contra account is always the money account (bank or cash), because a
 * cash basis ledger books payments. Without a payment date there is no line:
 * what has not moved does not belong in a cash basis batch.
 */

export type ChartId = 'skr03' | 'skr04' | 'skr42';

export interface Chart {
  id: ChartId;
  label: string;
  hint: string;
  /** Which kind of body this chart is for, sole traders unless stated. */
  entity?: 'club';
  bank: string;
  cash: string;
  paypal: string;
  accounts: Record<string, string>;
}

/**
 * The spheres as a cost centre.
 *
 * The association chart SKR 42 does not model the four areas of activity with
 * accounts of their own, but with an extra field on the booking: cost centre
 * KOST1. The same account carries a different number there depending on the
 * area, and only that field makes the batch usable for an association.
 *
 * That is precisely the difference to the retired SKR 49, which kept every
 * sphere in its own accounts and therefore needed a multiple of them.
 */
export const SPHERE_COST_CENTERS: Record<string, string> = {
  ideell: '1',
  vermoegen: '2',
  zweckbetrieb: '3',
  wirtschaftlich: '4',
  // What is not assigned to a sphere yet goes into the catch all instead of
  // quietly landing in the charitable one.
  unassigned: '9'
};

/** The charts that come into question. */
export const CHARTS: Record<ChartId, Chart> = {
  skr03: {
    id: 'skr03',
    label: 'SKR 03',
    hint: 'Der verbreitetste Rahmen für Einzelunternehmen',
    bank: '1200',
    cash: '1000',
    paypal: '1210',
    accounts: {
      inc_services: '8400', inc_goods: '8400', inc_license: '8400', inc_reduced: '8300',
      inc_free: '8200', inc_eu: '8125', inc_reverse: '8337', inc_platform: '8336',
      inc_asset_sale: '8820', inc_private: '8924', inc_interest: '8100', inc_other: '8200',
      inc_vat_refund: '1780',

      exp_goods: '3200', exp_subcontract: '3100', exp_wages: '4100', exp_gwg: '4855',
      exp_rent: '4210', exp_homeoffice: '4288', exp_utilities: '4240', exp_telecom: '4920',
      exp_software: '4980', exp_office: '4930', exp_marketing: '4600', exp_travel: '4670',
      exp_perdiem: '4664', exp_entertainment: '4650', exp_gifts: '4630', exp_gifts_nd: '4635',
      exp_vehicle: '4530', exp_mileage: '4670', exp_insurance: '4360', exp_education: '4945',
      exp_legal: '4950', exp_fees: '4970', exp_platform_fee: '4760', exp_interest: '2110',
      exp_other: '4900', exp_vat_payment: '1780', exp_private: '1800',
      exp_depreciation: '4830'
    }
  },
  skr04: {
    id: 'skr04',
    label: 'SKR 04',
    hint: 'Nach Bilanzgliederung aufgebaut, in Kanzleien ebenso verbreitet',
    bank: '1800',
    cash: '1600',
    paypal: '1810',
    accounts: {
      inc_services: '4400', inc_goods: '4400', inc_license: '4400', inc_reduced: '4300',
      inc_free: '4200', inc_eu: '4125', inc_reverse: '4337', inc_platform: '4336',
      inc_asset_sale: '4845', inc_private: '4639', inc_interest: '7100', inc_other: '4830',
      inc_vat_refund: '3820',

      exp_goods: '5200', exp_subcontract: '5900', exp_wages: '6000', exp_gwg: '6260',
      exp_rent: '6310', exp_homeoffice: '6314', exp_utilities: '6325', exp_telecom: '6805',
      exp_software: '6837', exp_office: '6815', exp_marketing: '6600', exp_travel: '6650',
      exp_perdiem: '6664', exp_entertainment: '6640', exp_gifts: '6610', exp_gifts_nd: '6620',
      exp_vehicle: '6530', exp_mileage: '6650', exp_insurance: '6400', exp_education: '6821',
      exp_legal: '6825', exp_fees: '6855', exp_platform_fee: '6760', exp_interest: '7300',
      exp_other: '6300', exp_vat_payment: '3820', exp_private: '2100',
      exp_depreciation: '6220'
    }
  },

  /**
   * SKR 42, the chart for associations, foundations and charitable companies.
   *
   * It replaced SKR 49 on 1 January 2025, which DATEV neither supports nor
   * maintains since. Its accounts have five digits and follow SKR 04, and the
   * sphere sits in the cost centre.
   *
   * The mapping below covers the common association cases. Where no account is
   * given the column stays empty and the export reports it: a wrong account is
   * worse than a missing one, and the practice fills it in one go.
   */
  skr42: {
    id: 'skr42',
    label: 'SKR 42',
    hint: 'Für Vereine und Stiftungen, seit 2025 der Nachfolger des SKR 49',
    entity: 'club',
    bank: '18000',
    cash: '16000',
    paypal: '18000',
    accounts: {
      cl_inc_dues: '40000',
      cl_inc_fines: '40100',
      cl_inc_donation: '40400',
      cl_inc_donation_kind: '40400',
      cl_inc_grant: '40510',

      cl_inc_rent: '50000',
      cl_inc_interest: '50400',

      cl_inc_events: '51000',
      cl_inc_courses: '51200',
      cl_inc_services: '51700',

      cl_inc_catering: '52000',
      cl_inc_ads: '52300',
      cl_inc_sales: '52400',

      cl_exp_volunteer: '60020',
      cl_exp_trainer: '60040',
      cl_exp_sports: '63000',
      cl_exp_admin: '63010',
      cl_exp_insurance: '63800',
      cl_exp_fees_assoc: '63910',
      cl_exp_catering: '65000',
      cl_exp_depreciation: '82000'
    }
  }
};

/** What the settings hold about DATEV, all of it optional. */
export interface DatevSettings {
  chart?: ChartId;
  consultantId?: string | number;
  clientId?: string | number;
  /** Account per category, overriding the chart. */
  accounts?: Record<string, string>;
  /** Money account per payment method. */
  moneyAccounts?: Record<string, string>;
}

function datevSettings(settings: Settings): DatevSettings {
  return (settings.datev ?? {}) as DatevSettings;
}

/**
 * The correction key (BU-Schlüssel).
 *
 * It tells DATEV which tax rate to book with where the account does not
 * already decide. The keys 2, 3, 5 and 9 are the common ones for output and
 * input tax.
 */
export function buKey(entry: Entry): string {
  if (entry.reverseCharge || entry.intraCommunityAcquisition) return '94';
  if (!entry.vatRate) return '';
  if (entry.type === 'income') return entry.vatRate === 7 ? '2' : '3';
  return entry.vatRate === 7 ? '8' : '9';
}

/** Which set of categories this profile keeps. */
export function entityOf(settings: Settings | null | undefined): 'club' | 'business' {
  return settings?.entity?.kind === 'club' ? 'club' : 'business';
}

/** The charts that fit this kind of body. */
export function chartsFor(settings: Settings): Chart[] {
  const entity = entityOf(settings);
  return Object.values(CHARTS).filter((chart) => (chart.entity ?? 'business') === entity);
}

/**
 * The chart that is worked with.
 *
 * An association gets SKR 42 even when the settings still name the SKR 03 of
 * an earlier profile: a revenue account from the business chart would simply
 * be wrong there.
 */
export function chartFor(settings: Settings, requested?: ChartId | null): Chart {
  const allowed = chartsFor(settings);
  const wanted = (requested && CHARTS[requested]) || CHARTS[datevSettings(settings).chart as ChartId];

  if (wanted && allowed.includes(wanted)) return wanted;
  return allowed[0] ?? CHARTS.skr03;
}

/** The money account for the payment method. */
function moneyAccount(chart: Chart, entry: Entry, settings: Settings): string {
  const custom = (datevSettings(settings).moneyAccounts ?? {})[entry.paymentMethod];
  if (custom) return custom;
  if (entry.paymentMethod === 'cash') return chart.cash;
  if (entry.paymentMethod === 'paypal') return chart.paypal;
  return chart.bank;
}

/**
 * The revenue or expense account of a booking.
 *
 * Without a mapped account the column stays empty. Filling it with a catch all
 * that may not even exist in the chart would be worse: the practice sees the
 * gap and fills it, a wrong account it does not see.
 */
function accountFor(chart: Chart, entry: Entry, settings: Settings): string {
  const custom = (datevSettings(settings).accounts ?? {})[entry.categoryId];
  if (custom) return custom;

  const mapped = chart.accounts[entry.categoryId];
  if (mapped) return mapped;

  const fallback = entry.type === 'income' ? chart.accounts.inc_other : chart.accounts.exp_other;
  return fallback ?? '';
}

/**
 * The cost centre of a booking.
 *
 * In the association chart that is the sphere, otherwise the segment as text.
 * Both land in the same column, because DATEV provides only this one.
 */
export function costCenter(chart: Chart, entry: Entry, settings: Settings): string {
  if (chart.entity === 'club') {
    return SPHERE_COST_CENTERS[entry.sphereId ?? ''] ?? SPHERE_COST_CENTERS.unassigned!;
  }
  return clamp(segmentLabel(settings, entry.segmentId), 36);
}

/* Formatting */

function quote(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/** The amount without a sign and with a comma, as DATEV expects it. */
export function amount(cents: Cents): string {
  return formatAmount(Math.abs(cents)).replace(/\./g, '');
}

/** DDMM, the document date in DATEV notation. */
export function datevDate(iso: IsoDate | null | undefined): string {
  const [, month, day] = String(iso ?? '').split('-');
  return day && month ? `${day}${month}` : '';
}

/** A text, cut to the length DATEV allows. */
function clamp(value: unknown, length: number): string {
  return String(value || '').replace(/[\r\n;"]/g, ' ').trim().slice(0, length);
}

export const COLUMNS = [
  'Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz',
  'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2',
  'Skonto', 'Buchungstext', 'Postensperre', 'Diverse Adressnummer', 'Geschäftspartnerbank', 'Sachverhalt',
  'Zinssperre', 'Beleglink', 'Beleginfo - Art 1', 'Beleginfo - Inhalt 1', 'Beleginfo - Art 2', 'Beleginfo - Inhalt 2',
  'KOST1 - Kostenstelle', 'KOST2 - Kostenstelle', 'KOST-Menge', 'EU-Mitgliedstaat u. USt-IdNr.',
  'EU-Steuersatz', 'Abw. Versteuerungsart', 'Sachverhalt L+L', 'Funktionsergänzung L+L',
  'BU 49 Hauptfunktionstyp', 'BU 49 Hauptfunktionsnummer', 'BU 49 Funktionsergänzung', 'Zusatzinformation - Art 1',
  'Zusatzinformation- Inhalt 1'
];

export interface BatchOptions {
  chart?: ChartId;
  consultantId?: string | number;
  clientId?: string | number;
  from?: IsoDate;
  to?: IsoDate;
  label?: string;
}

export interface BookingBatch {
  content: string;
  fileName: string;
  count: number;
  /** Bookings inside the period that carry no payment date, hence no line. */
  skipped: number;
  chart: string;
  unmapped: string[];
}

/** Builds the booking batch for one financial year. */
export function buildBookingBatch(data: Snapshot, year: number, options: BatchOptions = {}): BookingBatch {
  const settings = data.settings;
  const chart = chartFor(settings, options.chart);

  const from = options.from || `${year}-01-01`;
  const to = options.to || `${year}-12-31`;

  // No payment, no booking: the batch shows money in and money out.
  const entries = (data.entries ?? [])
    .filter((entry) => entry.paidDate && entry.paidDate >= from && entry.paidDate <= to)
    .sort((a, b) => a.paidDate!.localeCompare(b.paidDate!));

  const skipped = (data.entries ?? []).filter(
    (entry) => !entry.paidDate && (entry.date || '') >= from && (entry.date || '') <= to
  );

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '000';
  const company = settings.company;
  const config = datevSettings(settings);

  const header = [
    quote('EXTF'), '700', '21', quote('Buchungsstapel'), '13', stamp, '', quote('RE'), quote(''), quote(''),
    String(config.consultantId || options.consultantId || ''),
    String(config.clientId || options.clientId || ''),
    `${year}0101`, '4',
    from.replace(/-/g, ''), to.replace(/-/g, ''),
    quote(clamp(options.label || `${company.name || 'Buchungen'} ${year}`, 30)),
    quote(''), '1', '0', '0', quote('EUR'), '', '', '', '', quote(''), quote(''), quote(''), '', '', '', quote(''), quote('')
  ].join(';');

  const columnLine = COLUMNS.map(quote).join(';');

  const lines = entries.map((entry) => {
    const account = accountFor(chart, entry, settings);
    const counterAccount = moneyAccount(chart, entry, settings);
    const category = getCategory(entry.categoryId);

    // Income: money arrives in the bank account, so debit bank, credit
    // revenue. In the batch the revenue account is the account and the bank
    // the contra account, and the marker tells the direction apart.
    const sign = entry.type === 'income' ? 'H' : 'S';

    const belegfeld1 = clamp(entry.eInvoiceNumber || documentNumber(data, entry) || '', 36);
    const text = clamp(`${entry.counterparty ? `${entry.counterparty} ` : ''}${entry.description}`, 60);

    return [
      amount(entry.gross), sign, quote('EUR'), '', '', quote(''),
      account, counterAccount, buKey(entry), datevDate(entry.paidDate),
      quote(belegfeld1), quote(''), '', quote(text), '0', '', '', '',
      '0', quote(''), quote(''), quote(''), quote(''), quote(''),
      quote(costCenter(chart, entry, settings)), quote(''), '',
      quote(entry.counterpartyVatId || ''), '', '', '', '', '', '', '',
      quote(category ? 'Kategorie' : ''), quote(category ? category.id : '')
    ].join(';');
  });

  return {
    content: [header, columnLine, ...lines].join('\r\n') + '\r\n',
    fileName: `EXTF_Buchungsstapel_${year}.csv`,
    count: lines.length,
    skipped: skipped.length,
    chart: chart.label,
    unmapped: unmappedCategories(entries, chart, settings)
  };
}

function documentNumber(data: Snapshot, entry: Entry): string {
  if (!entry.invoiceId) return '';
  const document: BusinessDocument | undefined = (data.invoices ?? []).find((item) => item.id === entry.invoiceId);
  return document?.number ?? '';
}

function segmentLabel(settings: Settings, id: Id | null): string {
  if (!id) return '';
  const found = (settings.segments ?? []).find((segment) => segment.id === id);
  return found ? String(found.label ?? '') : '';
}

/** Categories without an account of their own land in the catch all and deserve naming. */
function unmappedCategories(entries: readonly Entry[], chart: Chart, settings: Settings): string[] {
  const custom = datevSettings(settings).accounts ?? {};
  const missing = new Set<string>();

  for (const entry of entries) {
    if (!custom[entry.categoryId] && !chart.accounts[entry.categoryId]) {
      const category = getCategory(entry.categoryId);
      missing.add(category ? category.label : entry.categoryId);
    }
  }
  return [...missing];
}

export interface AccountMapping {
  id: string;
  label: string;
  kind: EntryType;
  account: string;
  isCustom: boolean;
}

/**
 * The account mapping to look at and change.
 *
 * Shown in the settings so it can be agreed with the practice before the first
 * batch arrives there.
 */
export function accountMap(settings: Settings, chartId?: ChartId | null): AccountMapping[] {
  const chart = chartFor(settings, chartId);
  const custom = datevSettings(settings).accounts ?? {};

  // Only the categories this profile uses at all: a revenue account from the
  // business chart would be plain wrong in an association.
  const entity = entityOf(settings);

  return ALL_CATEGORIES.filter((category) => category.entity === entity).map((category) => ({
    id: category.id,
    label: category.label,
    kind: category.kind,
    account: custom[category.id] || chart.accounts[category.id] || '',
    isCustom: Boolean(custom[category.id])
  }));
}
