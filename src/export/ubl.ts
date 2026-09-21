// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { el, document, type XmlChild, type XmlNode } from './xml';
import { decimalString } from '../domain/money';
import { totals, type VatGroupDetail } from '../domain/invoices';
import { buyerParty, codedLines, netUnitPrice, sellerParty, type CodedLine, type InvoiceInput, type PartyData } from './en16931';
import type { Company, Customer } from '../shared/types';

/**
 * XRechnung as a UBL 2.1 invoice.
 *
 * This is the format German public authorities expect. Unlike the ZUGFeRD PDF
 * the XML here is the document, and a PDF is at best an enclosure.
 *
 * Two details that XRechnung validators like to trip over:
 *   BT-10 BuyerReference is mandatory. For authorities that is the Leitweg-ID.
 *   Every tax exemption needs a reason in plain words.
 */

const NAMESPACES = {
  xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
};

export const DEFAULT_CUSTOMIZATION = 'urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0';
const DEFAULT_PROFILE = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

function party(tag: string, data: PartyData): XmlNode {
  const contact = [
    data.contactName ? el('cbc:Name', data.contactName) : null,
    data.phone ? el('cbc:Telephone', data.phone) : null,
    data.email ? el('cbc:ElectronicMail', data.email) : null
  ].filter(Boolean);

  return el(tag, el('cac:Party', [
    data.email ? el('cbc:EndpointID', { schemeID: 'EM' }, data.email) : null,
    el('cac:PartyName', el('cbc:Name', data.name)),
    el('cac:PostalAddress', [
      el('cbc:StreetName', data.street),
      el('cbc:AdditionalStreetName', data.street2),
      el('cbc:CityName', data.city),
      el('cbc:PostalZone', data.zip),
      el('cac:Country', el('cbc:IdentificationCode', data.country || 'DE'))
    ]),
    data.vatId
      ? el('cac:PartyTaxScheme', [
          el('cbc:CompanyID', data.vatId),
          el('cac:TaxScheme', el('cbc:ID', 'VAT'))
        ])
      : null,
    data.taxNumber
      ? el('cac:PartyTaxScheme', [
          el('cbc:CompanyID', data.taxNumber),
          el('cac:TaxScheme', el('cbc:ID', 'FC'))
        ])
      : null,
    el('cac:PartyLegalEntity', [
      el('cbc:RegistrationName', data.legalName || data.name)
    ]),
    contact.length ? el('cac:Contact', contact) : null
  ]));
}

function taxSubtotal(group: VatGroupDetail, currency: string): XmlNode {
  return el('cac:TaxSubtotal', [
    el('cbc:TaxableAmount', { currencyID: currency }, decimalString(group.base)),
    el('cbc:TaxAmount', { currencyID: currency }, decimalString(group.tax)),
    el('cac:TaxCategory', [
      el('cbc:ID', group.categoryCode || 'S'),
      el('cbc:Percent', decimalString((group.rate || 0) * 100, 2)),
      group.exemptionReason ? el('cbc:TaxExemptionReason', group.exemptionReason) : null,
      el('cac:TaxScheme', el('cbc:ID', 'VAT'))
    ])
  ]);
}

function invoiceLine(line: CodedLine, index: number, currency: string): XmlNode {
  return el('cac:InvoiceLine', [
    el('cbc:ID', String(index + 1)),
    el('cbc:InvoicedQuantity', { unitCode: line.unit || 'C62' }, String(Number(line.quantity) || 0)),
    el('cbc:LineExtensionAmount', { currencyID: currency }, decimalString(line.net)),
    el('cac:Item', [
      line.description ? el('cbc:Description', line.description) : null,
      el('cbc:Name', line.name),
      el('cac:ClassifiedTaxCategory', [
        el('cbc:ID', line.categoryCode || 'S'),
        el('cbc:Percent', decimalString((line.vatRate || 0) * 100, 2)),
        el('cac:TaxScheme', el('cbc:ID', 'VAT'))
      ])
    ]),
    el('cac:Price', [
      el('cbc:PriceAmount', { currencyID: currency }, decimalString(netUnitPrice(line), 4))
    ])
  ]);
}

/** The bank details, which turn the invoice into something payable. */
function paymentMeans(invoice: InvoiceInput, seller: Company): XmlChild {
  if (!seller.iban) return null;

  return el('cac:PaymentMeans', [
    el('cbc:PaymentMeansCode', '58'),
    el('cbc:PaymentID', invoice.number),
    el('cac:PayeeFinancialAccount', [
      el('cbc:ID', seller.iban.replace(/\s/g, '')),
      el('cbc:Name', seller.accountHolder || seller.name),
      seller.bic ? el('cac:FinancialInstitutionBranch', el('cbc:ID', seller.bic)) : null
    ])
  ]);
}

export interface BuildOptions {
  customization?: string;
  profileId?: string;
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
  const notes = [invoice.intro, invoice.outro].filter(Boolean);

  const root = el('Invoice', NAMESPACES, [
    el('cbc:CustomizationID', options.customization || DEFAULT_CUSTOMIZATION),
    el('cbc:ProfileID', options.profileId || DEFAULT_PROFILE),
    el('cbc:ID', invoice.number),
    el('cbc:IssueDate', invoice.issueDate),
    invoice.dueDate ? el('cbc:DueDate', invoice.dueDate) : null,
    el('cbc:InvoiceTypeCode', invoice.documentType === 'creditnote' ? '381' : '380'),
    ...notes.map((note) => el('cbc:Note', note)),
    el('cbc:DocumentCurrencyCode', currency),
    // Mandatory in XRechnung. Without a Leitweg-ID the own reference goes in,
    // so the document is acceptable at all.
    el('cbc:BuyerReference', invoice.buyerReference || invoice.number),
    invoice.deliveryPeriod?.from
      ? el('cac:InvoicePeriod', [
          el('cbc:StartDate', invoice.deliveryPeriod.from),
          el('cbc:EndDate', invoice.deliveryPeriod.to || invoice.deliveryPeriod.from)
        ])
      : null,
    invoice.orderReference ? el('cac:OrderReference', el('cbc:ID', invoice.orderReference)) : null,
    party('cac:AccountingSupplierParty', {
      ...sellerParty(seller),
      // Either one or the other: a VAT id makes the tax number redundant.
      taxNumber: seller.vatId ? null : seller.taxNumber
    }),
    party('cac:AccountingCustomerParty', buyerParty(buyer)),
    invoice.deliveryDate
      ? el('cac:Delivery', el('cbc:ActualDeliveryDate', invoice.deliveryDate))
      : null,
    paymentMeans(invoice, seller),
    invoice.paymentText ? el('cac:PaymentTerms', el('cbc:Note', invoice.paymentText)) : null,
    el('cac:TaxTotal', [
      el('cbc:TaxAmount', { currencyID: currency }, decimalString(sums.vatTotal)),
      ...sums.vatBreakdown.map((group) => taxSubtotal(group, currency))
    ]),
    el('cac:LegalMonetaryTotal', [
      el('cbc:LineExtensionAmount', { currencyID: currency }, decimalString(sums.netTotal)),
      el('cbc:TaxExclusiveAmount', { currencyID: currency }, decimalString(sums.netTotal)),
      el('cbc:TaxInclusiveAmount', { currencyID: currency }, decimalString(sums.grossTotal)),
      el('cbc:PrepaidAmount', { currencyID: currency }, decimalString(sums.paid)),
      el('cbc:PayableAmount', { currencyID: currency }, decimalString(sums.grossTotal - sums.paid))
    ]),
    ...lines.map((line, index) => invoiceLine(line, index, currency))
  ]);

  return document(root);
}
