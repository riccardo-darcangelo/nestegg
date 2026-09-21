// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { roundCents } from './money';
import { findVatRate } from './tax';
import { getType, isOffer } from './doctypes';
import type {
  BusinessDocument,
  Cents,
  Customer,
  DocumentItem,
  DocumentStatus,
  DocumentType,
  IsoDate,
  Settings,
  ValidationResult,
  VatKey
} from '../shared/types';

/**
 * Outgoing documents.
 *
 * Totals are computed line by line and then grouped per VAT rate. That is
 * what EN 16931 requires, and it avoids the one cent differences you get from
 * deriving the tax out of a single sum.
 */

/** Labels for the statuses an invoice can take. An offer has its own in doctypes. */
export const STATUS: Partial<Record<DocumentStatus, string>> = {
  draft: 'Entwurf',
  sent: 'Gestellt',
  paid: 'Bezahlt',
  partial: 'Teilweise bezahlt',
  overdue: 'Überfällig',
  cancelled: 'Storniert'
};

/** UN/ECE Recommendation 20 codes. */
export const UNITS = [
  { code: 'C62', label: 'Stück' },
  { code: 'HUR', label: 'Stunde' },
  { code: 'DAY', label: 'Tag' },
  { code: 'MON', label: 'Monat' },
  { code: 'KGM', label: 'Kilogramm' },
  { code: 'MTR', label: 'Meter' },
  { code: 'LS', label: 'Pauschal' }
] as const;

export function normalizeItem(raw: Partial<DocumentItem>, index: number): DocumentItem {
  const quantity = Number(raw.quantity);

  return {
    id: raw.id || `pos_${index + 1}`,
    name: String(raw.name ?? '').trim(),
    description: String(raw.description ?? '').trim(),
    quantity: Number.isFinite(quantity) ? quantity : 1,
    unit: raw.unit || 'C62',
    unitPriceNet: Math.trunc(Number(raw.unitPriceNet) || 0),
    vatRate: Number.isFinite(Number(raw.vatRate)) ? Number(raw.vatRate) : 19,
    vatKey: raw.vatKey ?? null,
    discountPercent: Math.min(100, Math.max(0, Number(raw.discountPercent) || 0))
  };
}

export function lineNet(item: DocumentItem): Cents {
  return roundCents(item.quantity * item.unitPriceNet * (1 - item.discountPercent / 100));
}

export interface VatGroupDetail {
  rate: number;
  vatKey: VatKey;
  /** EN 16931 category code. */
  categoryCode: string;
  exemptionReason: string | null;
  base: Cents;
  tax: Cents;
}

export interface Totals {
  lines: Array<DocumentItem & { net: Cents }>;
  vatBreakdown: VatGroupDetail[];
  netTotal: Cents;
  vatTotal: Cents;
  grossTotal: Cents;
  paid: Cents;
  openAmount: Cents;
}

/**
 * What the calculations actually read. Narrower than a full document, so both
 * a stored one and a half-filled form pass.
 */
type DocumentLike = {
  items?: ReadonlyArray<Partial<DocumentItem>>;
  payments?: ReadonlyArray<{ amount?: Cents | string }>;
  status?: string;
  documentType?: string | null;
  number?: string | null;
  issueDate?: IsoDate;
  dueDate?: IsoDate | null;
  validUntil?: IsoDate | null;
  deliveryDate?: IsoDate | null;
  deliveryPeriod?: { from?: IsoDate | null } | null;
  tolerancePercent?: number | null;
};

function groupByVat(lines: ReadonlyArray<DocumentItem & { net: Cents }>): VatGroupDetail[] {
  const groups = new Map<string, VatGroupDetail>();

  for (const line of lines) {
    const rateInfo = findVatRate(line.vatKey, line.vatRate);
    const key = `${line.vatRate}|${line.vatKey || rateInfo.code}`;

    const group = groups.get(key) ?? {
      rate: line.vatRate,
      vatKey: line.vatKey,
      categoryCode: rateInfo.code,
      exemptionReason: rateInfo.exemptionReason ?? null,
      base: 0,
      tax: 0
    };

    group.base += line.net;
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.tax = group.rate ? roundCents((group.base * group.rate) / 100) : 0;
  }

  return [...groups.values()].sort((a, b) => b.rate - a.rate);
}

export function totals(invoice: DocumentLike): Totals {
  const lines = (invoice.items ?? []).map((item, index) => {
    const normalized = normalizeItem(item, index);
    return { ...normalized, net: lineNet(normalized) };
  });

  const vatBreakdown = groupByVat(lines);
  const netTotal = lines.reduce((total, line) => total + line.net, 0);
  const vatTotal = vatBreakdown.reduce((total, group) => total + group.tax, 0);
  const paid = (invoice.payments ?? []).reduce(
    (total, payment) => total + (Math.trunc(Number(payment.amount)) || 0),
    0
  );
  const grossTotal = netTotal + vatTotal;

  return { lines, vatBreakdown, netTotal, vatTotal, grossTotal, paid, openAmount: grossTotal - paid };
}

/** States the user set deliberately and that no calculation may override. */
const FIXED_STATUS = ['draft', 'cancelled', 'accepted', 'declined', 'invoiced'];

/**
 * Invoices resolve from payments and the due date, offers from their
 * validity.
 */
export function resolveStatus(invoice: DocumentLike, today: IsoDate | null): DocumentStatus {
  const status = invoice.status as DocumentStatus;
  if (FIXED_STATUS.includes(status)) return status;

  if (isOffer(invoice)) {
    if (invoice.validUntil && today && invoice.validUntil < today) return 'expired';
    return 'sent';
  }

  // A credit note asks for no money, so it must never show up as open or
  // overdue among the receivables.
  if (invoice.documentType === 'creditnote') return 'sent';

  const { grossTotal, paid } = totals(invoice);
  if (paid >= grossTotal && grossTotal > 0) return 'paid';
  if (paid > 0) return 'partial';
  if (invoice.dueDate && today && invoice.dueDate < today) return 'overdue';

  return 'sent';
}

export function addDays(isoDate: IsoDate, days: number): IsoDate {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

/**
 * Placeholders: {YYYY} {YY} {MM}, {#} through {########} for the counter and
 * {K} through {KKKK} for the customer number. The number of characters sets
 * the width, so customer number 0001 with {KK} becomes 01.
 */
export function buildNumber(
  pattern: string | null | undefined,
  counter: number,
  date: IsoDate,
  customerNumber?: string | null
): string {
  const template = String(pattern || 'RE-{YYYY}-{####}');
  const year = date.slice(0, 4);

  // Without a customer number the result would not be unique: every customer
  // lacking one would get the same number. That only surfaces when two
  // documents collide, and by then the sequence is already broken.
  if (/\{K+\}/.test(template) && !String(customerNumber ?? '').trim()) {
    throw new Error('Das Nummernmuster enthält die Kundennummer, aber dieser Kunde hat keine. Trage sie beim Kunden nach.');
  }

  return template
    .replace(/\{YYYY\}/g, year)
    .replace(/\{YY\}/g, year.slice(2))
    .replace(/\{MM\}/g, date.slice(5, 7))
    .replace(/\{(#+)\}/g, (_, hashes: string) => String(counter).padStart(hashes.length, '0'))
    .replace(/\{(K+)\}/g, (_, letters: string) =>
      String(customerNumber).trim().padStart(letters.length, '0').slice(-letters.length));
}

type CompanyLike = Record<string, unknown> & {
  name?: string;
  street?: string;
  city?: string;
  taxNumber?: string;
  vatId?: string;
  iban?: string;
};

/** Checks that hold for every document type. */
function validateCommon(
  invoice: DocumentLike,
  company: CompanyLike | null | undefined,
  customer: Partial<Customer> | null | undefined,
  totalsResult: Totals,
  typeLabel: string,
  typeArticle: string
): string[] {
  const errors: string[] = [];

  if (!invoice.number) errors.push(`Die Nummer für ${typeArticle} ${typeLabel} fehlt.`);
  if (!invoice.issueDate) errors.push('Das Datum fehlt.');
  if (!totalsResult.lines.length) errors.push(`${typeLabel} enthält keine Position.`);
  if (totalsResult.lines.some((line) => !line.name)) errors.push('Jede Position braucht eine Bezeichnung.');

  if (!company?.name) errors.push('Der eigene Firmenname fehlt in den Einstellungen.');
  if (!company?.street || !company.city) errors.push('Die eigene Anschrift fehlt in den Einstellungen.');
  if (!customer?.name) errors.push('Der Empfänger fehlt.');

  return errors;
}

/**
 * An offer is not a tax document. It needs none of the mandatory details of
 * UStG 14, but it does need enough to become an invoice later.
 */
function validateOffer(
  invoice: DocumentLike,
  company: CompanyLike | null | undefined,
  customer: Partial<Customer> | null | undefined,
  totalsResult: Totals,
  type: ReturnType<typeof getType>
): string[] {
  const warnings: string[] = [];

  if (!customer?.street || !customer.city) {
    warnings.push('Die Anschrift des Empfängers fehlt. Spätestens für die Rechnung wird sie gebraucht.');
  }
  if (!invoice.validUntil) {
    warnings.push(type.id === 'quote'
      ? 'Ohne Bindefrist bleibt offen, wie lange du an das Angebot gebunden bist.'
      : 'Ohne Gültigkeitsdatum bleibt offen, wie lange die Schätzung Bestand hat.');
  }
  if (type.nonBinding && !invoice.tolerancePercent) {
    warnings.push('Ohne Toleranzangabe fehlt der Hinweis, um wie viel die tatsächlichen Kosten abweichen dürfen.');
  }
  if (!company?.taxNumber && !company?.vatId) {
    warnings.push('Steuernummer oder USt-IdNr. fehlt. Für die spätere Rechnung ist sie Pflicht.');
  }
  if (totalsResult.grossTotal <= 0) warnings.push('Die Summe ist null oder negativ.');

  return warnings;
}

/** The mandatory details of UStG 14 plus what EN 16931 needs on top. */
export function validateInvoice(
  invoice: DocumentLike,
  company: CompanyLike | null | undefined,
  customer: Partial<Customer> | null | undefined
): ValidationResult {
  const totalsResult = totals(invoice);
  const type = getType((invoice.documentType as DocumentType) || 'invoice');

  const errors = validateCommon(invoice, company, customer, totalsResult, type.label, type.article);
  const warnings: string[] = [];

  if (type.group === 'offer') {
    warnings.push(...validateOffer(invoice, company, customer, totalsResult, type));
    return { errors, warnings, totals: totalsResult as never };
  }

  if (!invoice.deliveryDate && !invoice.deliveryPeriod?.from) {
    errors.push('Der Leistungszeitpunkt oder Leistungszeitraum fehlt. §14 Abs. 4 Nr. 6 UStG verlangt ihn.');
  }
  if (!company?.taxNumber && !company?.vatId) {
    errors.push('Steuernummer oder Umsatzsteuer-Identifikationsnummer fehlt in den Einstellungen.');
  }
  if (!customer?.street || !customer.city) {
    errors.push('Die Anschrift des Empfängers fehlt. Sie gehört zu den Pflichtangaben.');
  }

  const hasReverse = totalsResult.vatBreakdown.some((group) => group.vatKey === 'reverse');
  const hasIgl = totalsResult.vatBreakdown.some((group) => group.vatKey === 'igl');

  if (hasReverse && !customer?.vatId) {
    errors.push('Bei Reverse Charge braucht der Empfänger eine Umsatzsteuer-Identifikationsnummer.');
  }
  if (hasIgl && !customer?.vatId) {
    errors.push('Bei innergemeinschaftlicher Lieferung braucht der Empfänger eine Umsatzsteuer-Identifikationsnummer.');
  }
  if ((hasReverse || hasIgl) && !company?.vatId) {
    errors.push('Für diese Umsätze brauchst du selbst eine Umsatzsteuer-Identifikationsnummer.');
  }

  if (totalsResult.grossTotal <= 0) warnings.push('Die Rechnungssumme ist null oder negativ.');
  if (!invoice.dueDate) warnings.push('Kein Fälligkeitsdatum gesetzt. Für die E-Rechnung ist ein Zahlungsziel empfehlenswert.');
  if (!company?.iban) warnings.push('Ohne IBAN fehlen in der E-Rechnung die Zahlungsdaten.');
  if (customer?.buyerReference === '' && customer.isPublicAuthority) {
    warnings.push('Öffentliche Auftraggeber verlangen eine Leitweg-ID als Käuferreferenz.');
  }

  return { errors, warnings, totals: totalsResult as never };
}

export { validateInvoice as validateDocument };

/** Texts come from the settings, which hold one set per document type. */
export function emptyDocument(
  settings: Settings | null | undefined,
  today: IsoDate,
  documentType: DocumentType = 'invoice'
): BusinessDocument {
  const type = getType(documentType);
  const invoiceSettings = (settings?.invoice ?? {}) as {
    paymentTermsDays?: number;
    salutation?: string;
    estimateTolerance?: number;
  };
  const texts = ((settings?.texts ?? {}) as Record<string, { intro?: string; body?: string; outro?: string }>)[type.id] ?? {};
  const terms = invoiceSettings.paymentTermsDays || 14;
  const offer = type.group === 'offer';

  return {
    id: null as never,
    number: null,
    documentType: type.id,
    status: 'draft',
    customerId: null as never,
    segmentId: settings?.segments?.[0]?.id as string ?? null,
    projectId: null,
    issueDate: today,
    deliveryDate: offer ? null : today,
    deliveryPeriod: null,
    paymentTermsDays: offer ? null : terms,
    dueDate: offer ? null : addDays(today, terms),
    validUntil: offer ? addDays(today, type.validityDefaultDays || 30) : null,
    tolerancePercent: type.nonBinding ? (invoiceSettings.estimateTolerance || 15) : null,
    showSignature: offer,
    items: [],
    salutation: invoiceSettings.salutation || '',
    intro: texts.intro || '',
    bodyText: texts.body || '',
    outro: texts.outro || '',
    buyerReference: '',
    orderReference: '',
    payments: [],
    currency: 'EUR',
    note: ''
  };
}

/** Kept for callers that only know about invoices. */
export function emptyInvoice(settings: Settings | null | undefined, today: IsoDate): BusinessDocument {
  return emptyDocument(settings, today, 'invoice');
}
