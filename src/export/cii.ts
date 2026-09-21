// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { el, document, compactDate, type XmlChild, type XmlNode } from './xml';
import { decimalString } from '../domain/money';
import { totals, type VatGroupDetail } from '../domain/invoices';
import { buyerParty, codedLines, netUnitPrice, sellerParty, type CodedLine, type InvoiceInput, type PartyData } from './en16931';
import type { Company, Customer } from '../shared/types';

/**
 * Cross Industry Invoice (UN/CEFACT D16B) in the EN 16931 profile.
 *
 * This is the XML that gets embedded into a ZUGFeRD or Factur-X PDF as
 * factur-x.xml. The element order follows the schema, where it is not up for
 * negotiation.
 */

const NAMESPACES = {
  'xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  'xmlns:qdt': 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  'xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  'xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100'
};

const DEFAULT_PROFILE = 'urn:cen.eu:en16931:2017';

/** Invoice 380, credit note 381. */
function typeCode(invoice: InvoiceInput): string {
  return invoice.documentType === 'creditnote' ? '381' : '380';
}

function dateTimeString(isoDate: string | null | undefined): XmlChild {
  if (!isoDate) return null;
  return el('udt:DateTimeString', { format: '102' }, compactDate(isoDate));
}

function tradeParty(tag: string, party: PartyData, options: { includeTaxNumber?: boolean } = {}): XmlNode {
  const contact = [
    party.contactName ? el('ram:PersonName', party.contactName) : null,
    party.phone ? el('ram:TelephoneUniversalCommunication', el('ram:CompleteNumber', party.phone)) : null,
    party.email ? el('ram:EmailURIUniversalCommunication', el('ram:URIID', party.email)) : null
  ].filter(Boolean);

  const taxRegistrations: XmlNode[] = [];
  if (party.vatId) {
    taxRegistrations.push(el('ram:SpecifiedTaxRegistration', el('ram:ID', { schemeID: 'VA' }, party.vatId)));
  }
  // The tax number only travels with the seller, scheme FC.
  if (options.includeTaxNumber && party.taxNumber) {
    taxRegistrations.push(el('ram:SpecifiedTaxRegistration', el('ram:ID', { schemeID: 'FC' }, party.taxNumber)));
  }

  return el(tag, [
    el('ram:Name', party.name),
    party.legalName && party.legalName !== party.name
      ? el('ram:SpecifiedLegalOrganization', el('ram:TradingBusinessName', party.legalName))
      : null,
    contact.length ? el('ram:DefinedTradeContact', contact) : null,
    el('ram:PostalTradeAddress', [
      el('ram:PostcodeCode', party.zip),
      el('ram:LineOne', party.street),
      el('ram:LineTwo', party.street2),
      el('ram:CityName', party.city),
      el('ram:CountryID', party.country || 'DE')
    ]),
    party.email ? el('ram:URIUniversalCommunication', el('ram:URIID', { schemeID: 'EM' }, party.email)) : null,
    taxRegistrations.length ? taxRegistrations : null
  ]);
}

function formatQuantity(quantity: number): string {
  return (Number(quantity) || 0).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
}

function lineItem(line: CodedLine, index: number): XmlNode {
  return el('ram:IncludedSupplyChainTradeLineItem', [
    el('ram:AssociatedDocumentLineDocument', el('ram:LineID', String(index + 1))),
    el('ram:SpecifiedTradeProduct', [
      el('ram:Name', line.name),
      line.description ? el('ram:Description', line.description) : null
    ]),
    el('ram:SpecifiedLineTradeAgreement', [
      el('ram:NetPriceProductTradePrice', el('ram:ChargeAmount', decimalString(netUnitPrice(line), 4)))
    ]),
    el('ram:SpecifiedLineTradeDelivery', [
      el('ram:BilledQuantity', { unitCode: line.unit || 'C62' }, formatQuantity(line.quantity))
    ]),
    el('ram:SpecifiedLineTradeSettlement', [
      el('ram:ApplicableTradeTax', [
        el('ram:TypeCode', 'VAT'),
        el('ram:CategoryCode', line.categoryCode || 'S'),
        el('ram:RateApplicablePercent', decimalString((line.vatRate || 0) * 100, 2))
      ]),
      el('ram:SpecifiedTradeSettlementLineMonetarySummation', [
        el('ram:LineTotalAmount', decimalString(line.net))
      ])
    ])
  ]);
}

/** The code that names why no tax is due, where the category demands one. */
function exemptionCode(group: VatGroupDetail): string | null {
  if (group.categoryCode === 'AE') return 'VATEX-EU-AE';
  if (group.categoryCode === 'K') return 'VATEX-EU-IC';
  if (group.vatKey === 'kleinunternehmer') return 'VATEX-EU-D';
  return null;
}

const EXEMPT_CATEGORIES = ['AE', 'K', 'E'];

function tradeTax(group: VatGroupDetail): XmlNode {
  return el('ram:ApplicableTradeTax', [
    el('ram:CalculatedAmount', decimalString(group.tax)),
    el('ram:TypeCode', 'VAT'),
    group.exemptionReason ? el('ram:ExemptionReason', group.exemptionReason) : null,
    el('ram:BasisAmount', decimalString(group.base)),
    el('ram:CategoryCode', group.categoryCode || 'S'),
    EXEMPT_CATEGORIES.includes(group.categoryCode) ? el('ram:ExemptionReasonCode', exemptionCode(group)) : null,
    el('ram:RateApplicablePercent', decimalString((group.rate || 0) * 100, 2))
  ]);
}

function paymentMeans(seller: Company): XmlChild {
  if (!seller.iban) return null;

  return el('ram:SpecifiedTradeSettlementPaymentMeans', [
    el('ram:TypeCode', '58'),
    el('ram:PayeePartyCreditorFinancialAccount', [
      el('ram:IBANID', seller.iban.replace(/\s/g, '')),
      el('ram:AccountName', seller.accountHolder || seller.name)
    ]),
    seller.bic ? el('ram:PayeeSpecifiedCreditorFinancialInstitution', el('ram:BICID', seller.bic)) : null
  ]);
}

function billingPeriod(invoice: InvoiceInput): XmlChild {
  const period = invoice.deliveryPeriod;
  if (!period?.from) return null;

  return el('ram:BillingSpecifiedPeriod', [
    el('ram:StartDateTime', dateTimeString(period.from)),
    el('ram:EndDateTime', dateTimeString(period.to || period.from))
  ]);
}

function paymentTerms(invoice: InvoiceInput): XmlChild {
  if (!invoice.dueDate && !invoice.paymentText) return null;

  return el('ram:SpecifiedTradePaymentTerms', [
    invoice.paymentText ? el('ram:Description', invoice.paymentText) : null,
    invoice.dueDate ? el('ram:DueDateDateTime', dateTimeString(invoice.dueDate)) : null
  ]);
}

/** Free text on the document, plus every reason a tax was not charged. */
function documentNotes(invoice: InvoiceInput, breakdown: readonly VatGroupDetail[]): string[] {
  const notes = [invoice.intro, invoice.outro].filter(Boolean);
  for (const group of breakdown) {
    if (group.exemptionReason) notes.push(group.exemptionReason);
  }
  return notes;
}

export interface BuildOptions {
  profile?: string;
}

export function build(
  invoice: InvoiceInput,
  seller: Company,
  buyer: Customer,
  options: BuildOptions = {}
): string {
  const sums = totals(invoice);
  const currency = invoice.currency || 'EUR';
  const lines = codedLines(sums.vatBreakdown, sums.lines);

  const root = el('rsm:CrossIndustryInvoice', NAMESPACES, [
    el('rsm:ExchangedDocumentContext', [
      el('ram:GuidelineSpecifiedDocumentContextParameter', el('ram:ID', options.profile || DEFAULT_PROFILE))
    ]),
    el('rsm:ExchangedDocument', [
      el('ram:ID', invoice.number),
      el('ram:TypeCode', typeCode(invoice)),
      el('ram:IssueDateTime', dateTimeString(invoice.issueDate)),
      ...documentNotes(invoice, sums.vatBreakdown).map((note) => el('ram:IncludedNote', el('ram:Content', note)))
    ]),
    el('rsm:SupplyChainTradeTransaction', [
      ...lines.map((line, index) => lineItem(line, index)),
      el('ram:ApplicableHeaderTradeAgreement', [
        invoice.buyerReference ? el('ram:BuyerReference', invoice.buyerReference) : null,
        tradeParty('ram:SellerTradeParty', sellerParty(seller), { includeTaxNumber: true }),
        tradeParty('ram:BuyerTradeParty', buyerParty(buyer)),
        invoice.orderReference
          ? el('ram:BuyerOrderReferencedDocument', el('ram:IssuerAssignedID', invoice.orderReference))
          : null
      ]),
      el('ram:ApplicableHeaderTradeDelivery', [
        invoice.deliveryDate
          ? el('ram:ActualDeliverySupplyChainEvent', el('ram:OccurrenceDateTime', dateTimeString(invoice.deliveryDate)))
          : null
      ]),
      el('ram:ApplicableHeaderTradeSettlement', [
        el('ram:InvoiceCurrencyCode', currency),
        paymentMeans(seller),
        ...sums.vatBreakdown.map((group) => tradeTax(group)),
        billingPeriod(invoice),
        paymentTerms(invoice),
        el('ram:SpecifiedTradeSettlementHeaderMonetarySummation', [
          el('ram:LineTotalAmount', decimalString(sums.netTotal)),
          el('ram:ChargeTotalAmount', decimalString(0)),
          el('ram:AllowanceTotalAmount', decimalString(0)),
          el('ram:TaxBasisTotalAmount', decimalString(sums.netTotal)),
          el('ram:TaxTotalAmount', { currencyID: currency }, decimalString(sums.vatTotal)),
          el('ram:GrandTotalAmount', decimalString(sums.grossTotal)),
          el('ram:TotalPrepaidAmount', decimalString(sums.paid)),
          el('ram:DuePayableAmount', decimalString(sums.grossTotal - sums.paid))
        ])
      ])
    ])
  ]);

  return document(root);
}
