// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import type { DocumentType } from '../shared/types';

/**
 * Document types.
 *
 * All business documents share their layout, line items and totals. What
 * differs is what follows from them legally:
 *
 *   invoice     demands money, needs the mandatory details of UStG 14 and can
 *               be issued as a structured e-invoice
 *   creditnote  cancels an invoice, same rules otherwise
 *   quote       a binding offer with a deadline. Accepting it forms a contract
 *   estimate    a non-binding figure. BGB 650 requires notice when it will be
 *               exceeded substantially, hence the tolerance in the text
 *
 * Each type counts in its own number range. Separate ranges are allowed as
 * long as each one stays without gaps.
 */

export type DocumentGroup = 'invoice' | 'offer';

export interface DocumentTypeInfo {
  id: DocumentType;
  label: string;
  plural: string;
  /** German article, so sentences can be built from the label. */
  article: string;
  group: DocumentGroup;
  defaultPattern: string;
  /** UNTDID 1001 code for the e-invoice, null where none applies. */
  typeCode: string | null;
  supportsEInvoice: boolean;
  hasPayment: boolean;
  hasValidity: boolean;
  requiresDeliveryDate: boolean;
  validityDefaultDays?: number;
  nonBinding?: boolean;
}

export const DOCUMENT_TYPES: Record<DocumentType, DocumentTypeInfo> = {
  invoice: {
    id: 'invoice',
    label: 'Rechnung',
    plural: 'Rechnungen',
    article: 'die',
    group: 'invoice',
    defaultPattern: 'RE-{YYYY}-{####}',
    typeCode: '380',
    supportsEInvoice: true,
    hasPayment: true,
    hasValidity: false,
    requiresDeliveryDate: true
  },
  creditnote: {
    id: 'creditnote',
    label: 'Stornorechnung',
    plural: 'Stornorechnungen',
    article: 'die',
    group: 'invoice',
    defaultPattern: 'ST-{YYYY}-{####}',
    typeCode: '381',
    supportsEInvoice: true,
    hasPayment: false,
    hasValidity: false,
    requiresDeliveryDate: true
  },
  quote: {
    id: 'quote',
    label: 'Angebot',
    plural: 'Angebote',
    article: 'das',
    group: 'offer',
    defaultPattern: 'AN-{YYYY}-{####}',
    typeCode: null,
    supportsEInvoice: false,
    hasPayment: false,
    hasValidity: true,
    requiresDeliveryDate: false,
    validityDefaultDays: 30
  },
  estimate: {
    id: 'estimate',
    label: 'Kostenvoranschlag',
    plural: 'Kostenvoranschläge',
    article: 'der',
    group: 'offer',
    defaultPattern: 'KV-{YYYY}-{####}',
    typeCode: null,
    supportsEInvoice: false,
    hasPayment: false,
    hasValidity: true,
    requiresDeliveryDate: false,
    validityDefaultDays: 30,
    nonBinding: true
  }
};

export const INVOICE_STATUS = {
  draft: 'Entwurf',
  sent: 'Gestellt',
  paid: 'Bezahlt',
  partial: 'Teilweise bezahlt',
  overdue: 'Überfällig',
  cancelled: 'Storniert'
} as const;

export const OFFER_STATUS = {
  draft: 'Entwurf',
  sent: 'Versendet',
  accepted: 'Angenommen',
  declined: 'Abgelehnt',
  expired: 'Abgelaufen',
  invoiced: 'Abgerechnet',
  cancelled: 'Zurückgezogen'
} as const;

export const ALL_STATUS = { ...INVOICE_STATUS, ...OFFER_STATUS };

/** Falls back to invoice, which is what an unknown type most likely is. */
export function getType(id: string | null | undefined): DocumentTypeInfo {
  return DOCUMENT_TYPES[id as DocumentType] ?? DOCUMENT_TYPES.invoice;
}

export function typeOf(document: { documentType?: string | null } | null | undefined): DocumentTypeInfo {
  return getType(document?.documentType ?? 'invoice');
}

export function isOffer(document: { documentType?: string | null } | null | undefined): boolean {
  return typeOf(document).group === 'offer';
}

export function statusLabels(documentType: string | null | undefined): Record<string, string> {
  return getType(documentType).group === 'offer' ? OFFER_STATUS : INVOICE_STATUS;
}

/**
 * Default wording per type, editable in the settings. Reminders are not a
 * document type of their own, they hang off their invoice, but they still
 * need text; the main paragraph comes from the dunning level.
 */
export const DEFAULT_TEXTS = {
  invoice: {
    intro: '',
    body: 'Bitte überweise {AMOUNT} bis zum {DUEDATE} unter Angabe der Nummer {NUMBER}.',
    outro: 'Vielen Dank für die Zusammenarbeit.'
  },
  creditnote: {
    intro: '',
    body: 'Der Betrag wird dir erstattet. Eine gesonderte Zahlungsaufforderung entfällt.',
    outro: ''
  },
  quote: {
    intro: 'vielen Dank für deine Anfrage. Gern unterbreite ich dir folgendes Angebot.',
    body: 'Dieses Angebot ist bis zum {VALIDUNTIL} gültig. Mit deiner Zusage kommt der Auftrag zustande.',
    outro: 'Bei Fragen melde dich einfach.'
  },
  estimate: {
    intro: 'vielen Dank für deine Anfrage. Nach heutigem Stand schätze ich den Aufwand wie folgt.',
    body: 'Dies ist ein unverbindlicher Kostenvoranschlag. Die tatsächlichen Kosten können um bis zu {TOLERANCE} Prozent abweichen. Zeichnet sich eine darüber hinausgehende Überschreitung ab, melde ich mich vorher bei dir.',
    outro: 'Gern bespreche ich die Punkte mit dir im Einzelnen.'
  },
  reminder: {
    intro: 'die folgende Rechnung ist noch offen.',
    body: '',
    outro: 'Sollte sich die Zahlung mit diesem Schreiben überschnitten haben, betrachte es als gegenstandslos.'
  }
} as const;
