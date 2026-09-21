// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import zlib from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

import * as xml from './xmlread';
import { getCategory } from '../domain/categories';
import type { Cents, Entry, Id, IsoDate } from '../shared/types';

/**
 * Reading incoming e-invoices.
 *
 * Since 1 January 2025 every domestic business has to be able to receive
 * e-invoices, with no transition period and regardless of size. Issuing them is
 * staggered until 2028, receiving them is not. That is what this reader is for.
 *
 * Three shapes arrive:
 *
 *   XRechnung   plain UBL XML
 *   ZUGFeRD     a PDF with embedded CII XML (factur-x.xml)
 *   CII         the same XML without a PDF around it
 *
 * What comes out is a proposal for an expense booking, not a booked invoice.
 * And the original stays the original: the received file is filed unchanged as
 * the receipt, because what has to be kept is the structured record, not a
 * printout of it.
 */

export type Flavour = 'cii' | 'ubl';

export interface ReadParty {
  name: string;
  vatId: string;
  taxNumber: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  email: string;
}

export interface ReadTax {
  amount: Cents | null;
  base: Cents | null;
  rate: number;
  /** EN 16931 category code, where AE and K mean reverse charge. */
  categoryCode: string;
  exemptionReason: string;
}

export interface ReadLine {
  name: string;
  description: string;
  quantity: number | null;
  unit: string;
  unitPriceNet: Cents | null;
  net: Cents | null;
  vatRate: number;
}

export interface ReadInvoice {
  flavour: Flavour;
  profile: string;
  number: string;
  /** 380 for an invoice, 381 for a credit note. */
  typeCode: string;
  issueDate: IsoDate | null;
  deliveryDate: IsoDate | null;
  dueDate: IsoDate | null;
  currency: string;
  note: string;
  seller: ReadParty;
  buyer: ReadParty;
  iban: string;
  reference: string;
  orderReference: string;
  netTotal: Cents | null;
  vatTotal: Cents | null;
  grossTotal: Cents | null;
  payable: Cents | null;
  prepaid: Cents | null;
  taxes: ReadTax[];
  lines: ReadLine[];
  /** Which shape it arrived in, kept for the receipt. */
  source?: string;
  fileName?: string;
}

/* Format */

export type FileKind = 'pdf' | 'cii' | 'ubl' | 'xml';

export function sniff(buffer: Buffer, fileName = ''): FileKind | null {
  const head = buffer.subarray(0, 1024).toString('latin1');

  if (head.startsWith('%PDF')) return 'pdf';
  if (/CrossIndustryInvoice/i.test(head)) return 'cii';
  if (/<([\w-]+:)?Invoice[\s>]/i.test(head)) return 'ubl';
  if (/CreditNote/i.test(head)) return 'ubl';
  if (/^\s*<\?xml/i.test(head) || /\.xml$/i.test(fileName)) return 'xml';
  return null;
}

export type Extraction = { xml: Buffer; error?: undefined } | { error: string; xml?: undefined };

/** Inflates a stream, trying both the wrapped and the raw form. */
function inflate(contents: Buffer): Buffer<ArrayBufferLike> | null {
  try {
    return zlib.inflateSync(contents);
  } catch {
    try {
      return zlib.inflateRawSync(contents);
    } catch {
      return null;
    }
  }
}

/**
 * Pulls the embedded XML out of a ZUGFeRD PDF.
 *
 * Searched by content, not by file name: the names range from factur-x.xml
 * through zugferd-invoice.xml to xrechnung.xml, depending on which program
 * wrote the invoice.
 */
export async function extractFromPdf(buffer: Buffer): Promise<Extraction> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  } catch (err) {
    return { error: `Das PDF lässt sich nicht öffnen: ${(err as Error).message}` };
  }

  const candidates: Buffer[] = [];

  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;

    const dict = object.dict;
    const type = String(dict.get(PDFName.of('Type')) ?? '');
    const subtype = String(dict.get(PDFName.of('Subtype')) ?? '');
    if (!type.includes('EmbeddedFile') && !subtype.includes('xml')) continue;

    let contents: Buffer<ArrayBufferLike> = Buffer.from(object.contents);
    if (String(dict.get(PDFName.of('Filter')) ?? '').includes('FlateDecode')) {
      const inflated = inflate(contents);
      if (!inflated) continue;
      contents = inflated;
    }

    const head = contents.subarray(0, 2048).toString('latin1');
    if (/CrossIndustryInvoice|<([\w-]+:)?Invoice[\s>]/i.test(head)) candidates.push(contents);
  }

  const first = candidates[0];
  if (!first) {
    return { error: 'In diesem PDF steckt kein Rechnungs-XML. Es ist damit keine E-Rechnung, sondern ein Sichtbeleg.' };
  }
  return { xml: first };
}

/* CII */

const CII_LINE = 'SupplyChainTradeTransaction/IncludedSupplyChainTradeLineItem';

/** CII writes dates as 20260317, format 102. */
export function ciiDate(value: string | null | undefined): IsoDate | null {
  const raw = String(value ?? '').trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

function unitOf(node: xml.Node | null): string {
  return node?.attrs.unitCode ?? '';
}

export function readCii(root: xml.Node): ReadInvoice {
  const doc = xml.find(root, 'ExchangedDocument');
  const trade = xml.find(root, 'SupplyChainTradeTransaction');
  const agreement = xml.find(trade, 'ApplicableHeaderTradeAgreement');
  const delivery = xml.find(trade, 'ApplicableHeaderTradeDelivery');
  const settlement = xml.find(trade, 'ApplicableHeaderTradeSettlement');
  const sums = xml.find(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');

  const taxes: ReadTax[] = settlement
    ? xml.findAll(settlement, 'ApplicableTradeTax').map((node) => ({
        amount: xml.amount(node, 'CalculatedAmount'),
        base: xml.amount(node, 'BasisAmount'),
        rate: xml.number(node, 'RateApplicablePercent') ?? 0,
        categoryCode: xml.text(node, 'CategoryCode'),
        exemptionReason: xml.text(node, 'ExemptionReason')
      }))
    : [];

  const lines: ReadLine[] = xml.findAll(root, CII_LINE).map((node) => ({
    name: xml.text(node, 'SpecifiedTradeProduct/Name'),
    description: xml.text(node, 'SpecifiedTradeProduct/Description'),
    quantity: xml.number(node, 'SpecifiedLineTradeDelivery/BilledQuantity'),
    unit: unitOf(xml.find(node, 'SpecifiedLineTradeDelivery/BilledQuantity')),
    unitPriceNet: xml.amount(node, 'SpecifiedLineTradeAgreement/NetPriceProductTradePrice/ChargeAmount'),
    net: xml.amount(node, 'SpecifiedLineTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount'),
    vatRate: xml.number(node, 'SpecifiedLineTradeSettlement/ApplicableTradeTax/RateApplicablePercent') ?? 0
  }));

  return {
    flavour: 'cii',
    profile: xml.text(root, 'ExchangedDocumentContext/GuidelineSpecifiedDocumentContextParameter/ID'),
    number: xml.text(doc, 'ID'),
    typeCode: xml.text(doc, 'TypeCode'),
    issueDate: ciiDate(xml.text(doc, 'IssueDateTime/DateTimeString')),
    deliveryDate: ciiDate(xml.text(delivery, 'ActualDeliverySupplyChainEvent/OccurrenceDateTime/DateTimeString')),
    dueDate: ciiDate(xml.text(settlement, 'SpecifiedTradePaymentTerms/DueDateDateTime/DateTimeString')),
    currency: xml.text(settlement, 'InvoiceCurrencyCode') || 'EUR',
    note: xml.text(doc, 'IncludedNote/Content'),
    seller: ciiParty(xml.find(agreement, 'SellerTradeParty')),
    buyer: ciiParty(xml.find(agreement, 'BuyerTradeParty')),
    iban: xml.text(settlement, 'SpecifiedTradeSettlementPaymentMeans/PayeePartyCreditorFinancialAccount/IBANID'),
    reference: xml.text(agreement, 'BuyerReference'),
    orderReference: xml.text(agreement, 'BuyerOrderReferencedDocument/IssuerAssignedID'),
    netTotal: xml.amount(sums, 'TaxBasisTotalAmount') ?? xml.amount(sums, 'LineTotalAmount'),
    vatTotal: xml.amount(sums, 'TaxTotalAmount'),
    grossTotal: xml.amount(sums, 'GrandTotalAmount'),
    payable: xml.amount(sums, 'DuePayableAmount'),
    prepaid: xml.amount(sums, 'TotalPrepaidAmount'),
    taxes,
    lines
  };
}

/* UBL */

export function readUbl(root: xml.Node): ReadInvoice {
  const totals = xml.find(root, 'LegalMonetaryTotal');

  const taxes: ReadTax[] = xml.findAll(root, 'TaxTotal/TaxSubtotal').map((node) => ({
    amount: xml.amount(node, 'TaxAmount'),
    base: xml.amount(node, 'TaxableAmount'),
    rate: xml.number(node, 'TaxCategory/Percent') ?? 0,
    categoryCode: xml.text(node, 'TaxCategory/ID'),
    exemptionReason: xml.text(node, 'TaxCategory/TaxExemptionReason')
  }));

  const lineNodes = [...xml.findAll(root, 'InvoiceLine'), ...xml.findAll(root, 'CreditNoteLine')];
  const lines: ReadLine[] = lineNodes.map((node) => ({
    name: xml.text(node, 'Item/Name'),
    description: xml.text(node, 'Item/Description'),
    quantity: xml.number(node, 'InvoicedQuantity') ?? xml.number(node, 'CreditedQuantity'),
    unit: unitOf(xml.find(node, 'InvoicedQuantity')),
    unitPriceNet: xml.amount(node, 'Price/PriceAmount'),
    net: xml.amount(node, 'LineExtensionAmount'),
    vatRate: xml.number(node, 'Item/ClassifiedTaxCategory/Percent') ?? 0
  }));

  return {
    flavour: 'ubl',
    profile: xml.text(root, 'CustomizationID'),
    number: xml.text(root, 'ID'),
    typeCode: xml.text(root, 'InvoiceTypeCode') || (root.name === 'CreditNote' ? '381' : '380'),
    issueDate: xml.text(root, 'IssueDate') || null,
    deliveryDate: xml.text(root, 'Delivery/ActualDeliveryDate') || null,
    dueDate: xml.text(root, 'DueDate') || null,
    currency: xml.text(root, 'DocumentCurrencyCode') || 'EUR',
    note: xml.text(root, 'Note'),
    seller: ublParty(xml.find(root, 'AccountingSupplierParty/Party')),
    buyer: ublParty(xml.find(root, 'AccountingCustomerParty/Party')),
    iban: xml.text(root, 'PaymentMeans/PayeeFinancialAccount/ID'),
    reference: xml.text(root, 'BuyerReference'),
    orderReference: xml.text(root, 'OrderReference/ID'),
    netTotal: xml.amount(totals, 'TaxExclusiveAmount') ?? xml.amount(totals, 'LineExtensionAmount'),
    vatTotal: xml.amount(root, 'TaxTotal/TaxAmount'),
    grossTotal: xml.amount(totals, 'TaxInclusiveAmount'),
    payable: xml.amount(totals, 'PayableAmount'),
    prepaid: xml.amount(totals, 'PrepaidAmount'),
    taxes,
    lines
  };
}

/* Parties */

const EMPTY_PARTY: ReadParty = {
  name: '', vatId: '', taxNumber: '', country: '', city: '', zip: '', street: '', email: ''
};

function ciiParty(node: xml.Node | null): ReadParty {
  if (!node) return { ...EMPTY_PARTY };

  const registrations = xml.findAll(node, 'SpecifiedTaxRegistration/ID');
  const bySchema = (schema: string) =>
    registrations.find((id) => (id.attrs.schemeID ?? '').toUpperCase() === schema)?.text.trim() ?? '';

  return {
    name: xml.text(node, 'Name'),
    vatId: bySchema('VA'),
    taxNumber: bySchema('FC'),
    street: xml.text(node, 'PostalTradeAddress/LineOne'),
    zip: xml.text(node, 'PostalTradeAddress/PostcodeCode'),
    city: xml.text(node, 'PostalTradeAddress/CityName'),
    country: xml.text(node, 'PostalTradeAddress/CountryID'),
    email: xml.text(node, 'URIUniversalCommunication/URIID')
      || xml.text(node, 'DefinedTradeContact/EmailURIUniversalCommunication/URIID')
  };
}

function ublParty(node: xml.Node | null): ReadParty {
  if (!node) return { ...EMPTY_PARTY };

  const schemes = xml.findAll(node, 'PartyTaxScheme');
  const vatScheme = schemes.find((scheme) => /VAT/i.test(xml.text(scheme, 'TaxScheme/ID')));
  const second = schemes[1];

  return {
    name: xml.text(node, 'PartyLegalEntity/RegistrationName') || xml.text(node, 'PartyName/Name'),
    vatId: vatScheme ? xml.text(vatScheme, 'CompanyID') : '',
    taxNumber: second ? xml.text(second, 'CompanyID') : '',
    street: xml.text(node, 'PostalAddress/StreetName'),
    zip: xml.text(node, 'PostalAddress/PostalZone'),
    city: xml.text(node, 'PostalAddress/CityName'),
    country: xml.text(node, 'PostalAddress/Country/IdentificationCode'),
    email: xml.text(node, 'Contact/ElectronicMail') || xml.text(node, 'EndpointID')
  };
}

/* Reading */

export type ReadResult =
  | { invoice: ReadInvoice; warnings: string[]; error?: undefined }
  | { error: string; invoice?: undefined; warnings?: undefined };

/** Reads a received file, whatever shape it arrived in. */
export async function read(buffer: Buffer, fileName = ''): Promise<ReadResult> {
  const kind = sniff(buffer, fileName);
  if (!kind) return { error: 'Das ist weder ein PDF noch eine XML-Datei.' };

  let xmlBuffer = buffer;
  let source: string = kind;

  if (kind === 'pdf') {
    const extracted = await extractFromPdf(buffer);
    if (!extracted.xml) return { error: extracted.error };
    xmlBuffer = extracted.xml;
    source = 'zugferd';
  }

  const root = xml.parse(xmlBuffer);
  if (!root) return { error: 'Die XML-Datei ließ sich nicht lesen.' };

  const isCii = root.name === 'CrossIndustryInvoice';
  const isUbl = root.name === 'Invoice' || root.name === 'CreditNote';
  if (!isCii && !isUbl) {
    return { error: `Unbekanntes Wurzelelement "${root.name}". Erwartet wird eine Rechnung nach EN 16931.` };
  }

  const invoice: ReadInvoice = { ...(isCii ? readCii(root) : readUbl(root)), source, fileName };
  return { invoice, warnings: checkInvoice(invoice) };
}

const REVERSE_CHARGE_CODES = ['AE', 'K'];

function isReverseCharge(tax: Pick<ReadTax, 'categoryCode'>): boolean {
  return REVERSE_CHARGE_CODES.includes(String(tax.categoryCode).toUpperCase());
}

/**
 * Checks what matters for the own books.
 *
 * This is no conformance check. It is the list of things that cause trouble
 * later: missing mandatory details under UStG 14, a total that does not add
 * up, and reverse charge one could overlook.
 */
export function checkInvoice(invoice: ReadInvoice): string[] {
  const warnings: string[] = [];

  if (!invoice.number) warnings.push('Die Rechnung nennt keine Rechnungsnummer. Ohne sie fehlt eine Pflichtangabe nach §14 UStG.');
  if (!invoice.issueDate) warnings.push('Es steht kein Rechnungsdatum darin.');
  if (!invoice.seller.name) warnings.push('Der Rechnungsaussteller ist nicht benannt.');
  if (!invoice.seller.vatId && !invoice.seller.taxNumber) {
    warnings.push('Der Aussteller nennt weder Steuernummer noch USt-IdNr. Für den Vorsteuerabzug ist beides zusammen mit dem Rest Pflicht.');
  }

  const computed = (invoice.netTotal ?? 0) + (invoice.vatTotal ?? 0);
  if (invoice.grossTotal !== null && Math.abs(computed - invoice.grossTotal) > 2) {
    warnings.push('Netto plus Steuer ergibt nicht den Bruttobetrag der Rechnung. Bitte vor dem Buchen nachsehen.');
  }

  if (invoice.taxes.some(isReverseCharge)) {
    warnings.push('Die Rechnung weist Reverse Charge aus: du schuldest die Steuer als Leistungsempfänger und ziehst sie im selben Zug wieder ab.');
  }
  if (invoice.taxes.some((tax) => String(tax.categoryCode).toUpperCase() === 'E')) {
    const reason = invoice.taxes[0]?.exemptionReason;
    warnings.push(`Steuerfreier Umsatz${reason ? `: ${reason}` : ''}.`);
  }
  if (invoice.currency !== 'EUR') {
    warnings.push(`Die Rechnung lautet auf ${invoice.currency}. Die Buchung übernimmt den Betrag, wie er dasteht.`);
  }
  if (invoice.typeCode === '381') {
    warnings.push('Das ist eine Gutschrift oder Stornorechnung, keine Forderung.');
  }

  return warnings;
}

export interface EntryDraft {
  categoryId?: string;
  paidDate?: IsoDate | null;
  description?: string;
  counterparty?: string;
  segmentId?: Id | null;
  projectId?: Id | null;
}

/** The booking a read invoice proposes, still to be confirmed. */
export type ProposedEntry = Pick<Entry,
  'type' | 'date' | 'paidDate' | 'description' | 'counterparty' | 'counterpartyVatId' |
  'countryCode' | 'categoryId' | 'basis' | 'vatRate' | 'reverseCharge' | 'paymentMethod' |
  'segmentId' | 'projectId' | 'note' | 'eInvoiceRef'
> & { amount: Cents };

/**
 * Turns the read invoice into the draft of an expense booking.
 *
 * The invoice date drives the input tax deduction, so it becomes the document
 * date. There is no payment date: nothing has been paid yet.
 */
export function toEntry(invoice: ReadInvoice, draft: EntryDraft = {}): ProposedEntry {
  const main = [...invoice.taxes].sort((a, b) => (b.base ?? 0) - (a.base ?? 0))[0]
    ?? { rate: 19, categoryCode: 'S' };
  const reverseCharge = isReverseCharge(main);
  const categoryId = draft.categoryId || 'exp_other';
  const category = getCategory(categoryId);

  const gross = invoice.payable ?? invoice.grossTotal ?? 0;
  const net = invoice.netTotal ?? gross;

  return {
    type: 'expense',
    date: invoice.issueDate ?? '',
    paidDate: draft.paidDate ?? null,
    description: draft.description || `Rechnung ${invoice.number || 'ohne Nummer'}`,
    counterparty: draft.counterparty || invoice.seller.name || '',
    counterpartyVatId: invoice.seller.vatId || '',
    countryCode: (invoice.seller.country || 'DE').toUpperCase().slice(0, 2),
    categoryId,
    // Under reverse charge the invoice total is the net amount and the tax only
    // arises in the VAT return. Otherwise the gross amount counts.
    amount: reverseCharge ? net : gross,
    basis: 'gross',
    vatRate: reverseCharge ? (main.rate || 19) : (main.rate ?? category?.defaultVatRate ?? 19),
    reverseCharge,
    paymentMethod: 'bank',
    segmentId: draft.segmentId ?? null,
    projectId: draft.projectId ?? null,
    note: [
      invoice.number ? `Rechnungsnummer ${invoice.number}` : '',
      invoice.orderReference ? `Bestellung ${invoice.orderReference}` : ''
    ].filter(Boolean).join(', '),
    // The trail back to the origin, so the same invoice cannot come in twice.
    eInvoiceRef: fingerprint(invoice)
  };
}

/** What identifies a received invoice: its issuer plus its number. */
export function fingerprint(invoice: ReadInvoice): string {
  const clean = (value: string) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const seller = clean(invoice.seller.vatId) || clean(invoice.seller.name);
  return `${seller}|${clean(invoice.number)}`;
}

/** Whether a read invoice is already booked. */
export function findExisting(invoice: ReadInvoice, entries: readonly Entry[] | null | undefined): Entry | null {
  const ref = fingerprint(invoice);
  return (entries ?? []).find((entry) => entry.eInvoiceRef && entry.eInvoiceRef === ref) ?? null;
}
