// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { roundCents } from './money';
import type { AmountBasis, Cents, CountryCode, Settings, VatKey } from '../shared/types';

export interface VatRate {
  /** Percentage, not a factor. */
  rate: number;
  label: string;
  /** EN 16931 category code (UNTDID 5305), used in e-invoices. */
  code: string;
  key?: string;
  exemptionReason?: string;
  /** Box number on the German advance VAT return. */
  vatKz?: string;
  ecSales?: 'service' | 'goods';
}

export const VAT_RATES: VatRate[] = [
  { rate: 19, label: '19 % Regelsteuersatz', code: 'S' },
  { rate: 7, label: '7 % ermäßigt', code: 'S' },
  { rate: 0, label: '0 % steuerfrei (§4 UStG)', code: 'E', exemptionReason: 'Steuerfreier Umsatz nach §4 UStG' },
  {
    rate: 0,
    label: '0 % Kleinunternehmer (§19 UStG)',
    code: 'E',
    key: 'kleinunternehmer',
    exemptionReason: 'Kein Steuerausweis nach §19 UStG'
  },
  {
    // Place of supply sits with the recipient, so this is not taxable here. It
    // belongs in box 21 and in the recapitulative statement.
    rate: 0,
    label: '0 % EU-Dienstleistung, Reverse Charge (§3a Abs. 2)',
    code: 'AE',
    key: 'eu_service',
    exemptionReason: 'Steuerschuldnerschaft des Leistungsempfängers, Reverse Charge nach §3a Abs. 2 UStG',
    vatKz: '21',
    ecSales: 'service'
  },
  {
    rate: 0,
    label: '0 % innergemeinschaftliche Lieferung',
    code: 'K',
    key: 'igl',
    exemptionReason: 'Innergemeinschaftliche Lieferung nach §4 Nr. 1b i.V.m. §6a UStG',
    vatKz: '41',
    ecSales: 'goods'
  },
  {
    rate: 0,
    label: '0 % Reverse Charge im Inland (§13b UStG)',
    code: 'AE',
    key: 'reverse',
    exemptionReason: 'Steuerschuldnerschaft des Leistungsempfängers nach §13b UStG',
    vatKz: '60'
  },
  {
    rate: 0,
    label: '0 % Drittland, nicht steuerbar',
    code: 'O',
    key: 'ausland',
    exemptionReason: 'Nicht im Inland steuerbarer Umsatz',
    vatKz: '45'
  }
];

export const EU_COUNTRIES: ReadonlySet<CountryCode> = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);

export function isEuCountry(code: string | null | undefined): boolean {
  return EU_COUNTRIES.has(String(code ?? '').toUpperCase());
}

export interface TaxParty {
  country?: CountryCode;
  vatId?: string;
}

/**
 * Where a sale is taxed follows from the recipient's country and whether they
 * are a business. For services to EU businesses UStG 3a (2) moves the place
 * of supply to the recipient, who then owes the tax, and the sale has to show
 * up in the recapitulative statement.
 *
 * @param kind services or goods, which decide between the two EU treatments
 * @returns the VAT key, or null for the ordinary domestic rate
 */
export function suggestVatKey(party: TaxParty | null | undefined, kind: 'service' | 'goods' = 'service'): string | null {
  const country = String(party?.country ?? 'DE').toUpperCase();

  if (country === 'DE') return null;
  if (!isEuCountry(country)) return 'ausland';

  // Inside the EU the liability only shifts against a VAT ID.
  if (!party?.vatId) return null;
  return kind === 'goods' ? 'igl' : 'eu_service';
}

export function findVatRate(key: string | VatKey | undefined, rate: number): VatRate {
  if (key) {
    const byKey = VAT_RATES.find((entry) => entry.key === key);
    if (byKey) return byKey;
  }
  return VAT_RATES.find((entry) => entry.rate === rate && !entry.key) ?? VAT_RATES[0]!;
}

export interface AmountSplit {
  gross: Cents;
  net: Cents;
  vat: Cents;
}

/**
 * Takes the tax out of a gross amount. Derived from the gross so that net
 * plus tax adds back up exactly and no cent goes missing.
 */
export function splitGross(grossCents: Cents, rate: number): AmountSplit {
  const gross = Math.trunc(grossCents) || 0;
  if (!rate) return { gross, net: gross, vat: 0 };

  const net = roundCents(gross / (1 + rate / 100));
  return { gross, net, vat: gross - net };
}

/** Net stays exact, the tax is what gets rounded. */
export function grossFromNet(netCents: Cents, rate: number): AmountSplit {
  const net = Math.trunc(netCents) || 0;
  if (!rate) return { gross: net, net, vat: 0 };

  const vat = roundCents((net * rate) / 100);
  return { gross: net + vat, net, vat };
}

export function normalizeAmount(amountCents: Cents, rate: number, basis: AmountBasis = 'gross'): AmountSplit {
  return basis === 'net' ? grossFromNet(amountCents, rate) : splitGross(amountCents, rate);
}

function bookkeepingStart(settings: Settings | null | undefined): number | null {
  const from = (settings?.tax as { bookkeepingFrom?: number } | undefined)?.bookkeepingFrom;
  return from ? Number(from) : null;
}

/**
 * Years before bookkeeping started here may be entered so that reports reach
 * further back, but they carry no tax return: the data is incomplete and a
 * profit statement built on it would simply be wrong.
 */
export function isArchiveYear(settings: Settings | null | undefined, year: number | string): boolean {
  const start = bookkeepingStart(settings);
  return start !== null && Number(year) < start;
}

/** The one sentence every archive year shows, written down once. */
export function archiveNote(year: number | string, settings: Settings | null | undefined): string {
  return `${year} liegt vor dem Beginn der Buchführung in dieser App (ab ${bookkeepingStart(settings)}). `
    + 'Die Zahlen sind nacherfasst und dienen der Auswertung, nicht der Erklärung.';
}
