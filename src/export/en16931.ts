// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import type { VatGroupDetail } from '../domain/invoices';
import type { BusinessDocument, Cents, Company, Customer, DocumentItem } from '../shared/types';

/**
 * What the two e-invoice formats share.
 *
 * CII and UBL describe the same EN 16931 model with different element names.
 * The parts that are about the model rather than the syntax live here, so a
 * change to how a party or a line is derived cannot drift apart between them.
 */

/** Older documents carry the payment terms in a field of their own. */
export type InvoiceInput = BusinessDocument & { paymentText?: string };

/** The fields a party section reads, whether seller or buyer. */
export interface PartyData {
  name?: string | undefined;
  legalName?: string | undefined;
  street?: string | undefined;
  street2?: string | undefined;
  zip?: string | undefined;
  city?: string | undefined;
  country?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  contactName?: string | undefined;
  vatId?: string | null | undefined;
  taxNumber?: string | null | undefined;
}

export function sellerParty(company: Company): PartyData {
  return {
    name: company.name,
    legalName: company.legalName,
    street: company.street,
    street2: company.street2,
    zip: company.zip,
    city: company.city,
    country: company.country || 'DE',
    email: company.email,
    phone: company.phone,
    contactName: company.owner,
    vatId: company.vatId,
    taxNumber: company.taxNumber
  };
}

export function buyerParty(customer: Customer): PartyData {
  return {
    name: customer.name,
    street: customer.street,
    street2: customer.street2,
    zip: customer.zip,
    city: customer.city,
    country: customer.country || 'DE',
    email: customer.email,
    phone: customer.phone,
    contactName: customer.contactName,
    vatId: customer.vatId
  };
}

export type CodedLine = DocumentItem & { net: Cents; categoryCode: string };

/** Matches every line to its VAT group, so the category code agrees with it. */
export function codedLines(
  breakdown: readonly VatGroupDetail[],
  lines: ReadonlyArray<DocumentItem & { net: Cents }>
): CodedLine[] {
  return lines.map((line) => {
    const group = breakdown.find(
      (item) => item.rate === line.vatRate && (item.vatKey ?? null) === (line.vatKey ?? null)
    );
    return { ...line, categoryCode: group ? group.categoryCode : 'S' };
  });
}

/** The unit price after discount, so quantity times price is the line total. */
export function netUnitPrice(line: DocumentItem): Cents {
  return line.unitPriceNet * (1 - (line.discountPercent || 0) / 100);
}
