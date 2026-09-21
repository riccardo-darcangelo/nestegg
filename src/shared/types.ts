// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * The shape of everything that gets stored.
 *
 * Money is always an integer number of cents. Floating point has no business
 * in bookkeeping, and every function in this codebase assumes cents.
 *
 * Dates are ISO strings, `YYYY-MM-DD` for calendar dates and full ISO 8601
 * for timestamps. Storing Date objects would not survive the JSON round trip.
 */

/** Cents, never euros. */
export type Cents = number;

/** `YYYY-MM-DD` */
export type IsoDate = string;

/** Full ISO 8601 with time and zone. */
export type IsoTimestamp = string;

/** ISO 3166-1 alpha-2, upper case. */
export type CountryCode = string;

export type Id = string;

export interface Identified {
  id: Id;
  createdAt?: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

/* Bookings */

export type EntryType = 'income' | 'expense';

/** Whether an amount was entered gross or net. */
export type AmountBasis = 'gross' | 'net';

export type PaymentMethod = 'bank' | 'cash' | 'card' | 'paypal' | 'direct_debit' | 'other';

/**
 * Special VAT treatments that override the plain rate.
 *
 *   reverse           liability shifts to a domestic recipient (UStG 13b)
 *   eu_service        service to an EU business, taxed where they sit
 *   igl               intra-community supply of goods
 *   ausland           outside the EU, not taxable here
 *   kleinunternehmer  small business exemption (UStG 19)
 */
export type VatKey = 'reverse' | 'eu_service' | 'igl' | 'ausland' | 'kleinunternehmer' | null;

export type RevenueKind = 'onetime' | 'recurring';

/** A charitable association keeps its money in four separate spheres. */
export type SphereId = 'ideell' | 'vermoegen' | 'zweckbetrieb' | 'wirtschaftlich';

export interface Entry extends Identified {
  type: EntryType;
  /** Document date, which drives the VAT period for accrual accounting. */
  date: IsoDate;
  /** When the money moved. Null means still open, and open means it counts nowhere yet. */
  paidDate: IsoDate | null;
  description: string;
  counterparty: string;
  categoryId: string;

  vatRate: number;
  vatKey: VatKey;
  basis: AmountBasis;
  gross: Cents;
  net: Cents;
  vat: Cents;

  paymentMethod: PaymentMethod;
  /** Share used privately, which reduces the deductible part. */
  privateSharePercent: number;

  segmentId: Id | null;
  customerId: Id | null;
  projectId: Id | null;
  countryCode: CountryCode;

  sphereId: SphereId | null;
  sportsEvent: boolean;
  counterpartyVatId: string;
  revenueKind: RevenueKind;

  receiptId: Id | null;
  invoiceId: Id | null;
  assetId: Id | null;

  /** Where the booking came from, kept so editing cannot lose its origin. */
  bankRef: string | null;
  bankLine: number | null;
  eInvoiceRef: string | null;
  /** Document number shown on the receipt, also DATEV field 1. */
  eInvoiceNumber: string;

  memberId: Id | null;
  duesRef: string | null;
  /** Which direct debit file collected this claim, so it cannot go twice. */
  sepaRef: string | null;
  sepaExportedAt: IsoTimestamp | null;
  /** When and why a collection bounced. The reason decides whether it may be retried. */
  returnedAt: IsoTimestamp | null;
  returnCode: string | null;

  claimId: Id | null;
  /** The waiver box on the official donation form. */
  waiver: boolean;

  recurrenceId: Id | null;
  recurrenceDate: IsoDate | null;

  reverseCharge: boolean;
  intraCommunityAcquisition: boolean;
  /** Books the entry into a different tax year than its dates suggest. */
  taxYearOverride: number | null;
  note: string;
}

/* Documents */

export type DocumentType = 'invoice' | 'creditnote' | 'quote' | 'estimate';

export type DocumentStatus =
  | 'draft'
  | 'sent'
  | 'paid'
  | 'partial'
  | 'overdue'
  | 'cancelled'
  | 'accepted'
  | 'declined'
  | 'expired';

export interface DocumentItem {
  id: Id;
  name: string;
  description: string;
  quantity: number;
  /** UN/ECE Recommendation 20 code, `C62` for pieces and `HUR` for hours. */
  unit: string;
  unitPriceNet: Cents;
  vatRate: number;
  vatKey: VatKey;
  discountPercent: number;
}

export interface Payment {
  date: IsoDate;
  amount: Cents;
  entryId: Id | null;
  note: string;
  /** Set when the payment came from a bank statement, which carries the duplicate check. */
  bankRef?: string;
}

export interface DeliveryPeriod {
  from: IsoDate | null;
  to: IsoDate | null;
}

/** What a sent reminder leaves behind on the invoice. */
export interface ReminderRecord {
  level: number;
  levelId: string;
  levelLabel: string;
  date: IsoDate;
  deadline: IsoDate;
  open: Cents;
  interest: Cents;
  interestDays: number;
  interestRate: number;
  interestSince: IsoDate | null;
  flatFee: Cents;
  fee: Cents;
  total: Cents;
  intro: string;
  bodyText: string;
  outro: string;
}

export interface BusinessDocument extends Identified {
  /** Null until the document is finalised and draws a number. */
  number: string | null;
  documentType: DocumentType;
  status: DocumentStatus;
  customerId: Id;
  segmentId: Id | null;
  projectId: Id | null;

  issueDate: IsoDate;
  /** Required by UStG 14 (4) 6 on invoices, unused on quotes. */
  deliveryDate: IsoDate | null;
  deliveryPeriod: DeliveryPeriod | null;
  paymentTermsDays: number | null;
  dueDate: IsoDate | null;
  /** How long a quote stands. */
  validUntil: IsoDate | null;
  /** How far an estimate may be exceeded. */
  tolerancePercent: number | null;
  showSignature: boolean;

  items: DocumentItem[];
  salutation: string;
  intro: string;
  bodyText: string;
  outro: string;

  /** Leitweg-ID, mandatory when billing German public authorities. */
  buyerReference: string;
  orderReference: string;

  payments: Payment[];
  /** Every reminder that went out, in the order they went. */
  reminders?: ReminderRecord[];
  currency: string;
  note: string;

  /** Set on a credit note: which invoice it reverses. */
  cancelsInvoiceId?: Id;
  cancelsInvoiceNumber?: string | null;
  /** Overrides the type label in the heading. */
  documentTitle?: string;
  /** The place in the place and date line, falling back to the company city. */
  place?: string;

  finalizedAt?: IsoTimestamp;
  /** Set when the document came from an offer, for the reference line. */
  fromOfferNumber?: string;
  /** Which recurring template produced this, and for which date. */
  recurrenceId?: Id | null;
  recurrenceDate?: IsoDate | null;
}

export interface VatGroup {
  rate: number;
  vatKey: VatKey;
  base: Cents;
  tax: Cents;
}

export interface DocumentTotals {
  lines: Array<DocumentItem & { net: Cents; vat: Cents; gross: Cents }>;
  netTotal: Cents;
  vatTotal: Cents;
  grossTotal: Cents;
  vatBreakdown: VatGroup[];
}

/* Master data */

export interface Customer extends Identified {
  name: string;
  contactName: string;
  customerNumber: string;
  street: string;
  /** Second address line, for a suffix such as a building or a department. */
  street2: string;
  zip: string;
  city: string;
  country: CountryCode;
  email: string;
  phone: string;
  vatId: string;
  buyerReference: string;
  isPublicAuthority: boolean;
  paymentTermsDays: number | null;
  note: string;
}

/** A fixed asset, written down over its useful life. */
export interface Asset {
  id: Id;
  label: string;
  purchaseDate: IsoDate;
  netCents: Cents;
  usefulLifeYears: number;
  disposalDate: IsoDate | null;
  entryId: Id | null;
  note: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface Receipt extends Identified {
  /** Display name, which is also the file name unless the vault is locked. */
  fileName: string;
  relativePath: string;
  originalName: string;
  size: number;
  storedSize?: number;
  encrypted?: boolean;
  /** SHA-256 of the plain content, so it survives re-encryption. */
  checksum: string;
  mimeHint: string;
  date: IsoDate;
  addedAt: IsoTimestamp;
}

/**
 * A record as it sits in the document.
 *
 * The normalise functions of the domain accept drafts, whose id is still null
 * until the store hands one out. Everything in a collection has been through
 * that, so there the id is certain.
 */
export type Stored<T extends { id: Id | null }> = Omit<T, 'id'> & { id: Id };

/* Projects and recurring templates */

export type ProjectStatus = 'active' | 'paused' | 'done' | 'cancelled';

export interface Project {
  id: Id | null;
  name: string;
  customerId: Id | null;
  segmentId: Id | null;
  status: ProjectStatus;
  budgetCents: Cents;
  hourlyRateCents: Cents;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  note: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type IntervalId = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

export interface RecurrenceRule {
  interval: IntervalId;
  /** Multiplier on the interval, so every: 2 with monthly means every other month. */
  every: number;
  /** Day of month the rule aims for, clamped per month. */
  anchorDay: number;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  /** Fixed number of dates, as an alternative to an end date. */
  occurrences: number | null;
}

export type TemplateKind = 'entry' | 'invoice';

export interface InvoiceTemplate {
  documentType: DocumentType;
  customerId: Id | null;
  segmentId: Id | null;
  projectId: Id | null;
  items: DocumentItem[];
  paymentTermsDays: number;
  salutation: string;
  intro: string;
  bodyText: string;
  outro: string;
  buyerReference: string;
  currency: string;
  /** The billing month is the service period of an ongoing engagement. */
  servicePeriod: boolean;
}

/** An entry template without the fields that only the due date can fill. */
export type EntryTemplate = Omit<Entry, 'date' | 'paidDate' | 'createdAt' | 'updatedAt'>;

export interface RecurringTemplate {
  id: Id | null;
  kind: TemplateKind;
  label: string;
  active: boolean;
  rule: RecurrenceRule;
  template: EntryTemplate | InvoiceTemplate;
  /** Bookings can count as paid straight away, for standing orders. */
  markPaid: boolean;
  /** Invoices can draw their number at once. The default is a draft. */
  autoFinalize: boolean;
  note: string;
  /** Dates deliberately passed over, for instance a month booked by hand. */
  skipped: IsoDate[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/* Results */

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  totals?: DocumentTotals;
}

/** What every IPC handler returns. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

/* The stored document as a whole */

export interface Snapshot {
  schemaVersion: number;
  settings: Settings;
  entries: Entry[];
  invoices: BusinessDocument[];
  customers: Customer[];
  projects: Stored<Project>[];
  recurrences: Stored<RecurringTemplate>[];
  assets: Asset[];
  receipts: Receipt[];
  /** Imported bank statements: which file, when, how many lines. */
  imports: Identified[];
  /** Tracked working time. It only touches the books through an invoice. */
  times: Identified[];
  donations: Identified[];
  /** Reserves under AO 62, each with its movements. */
  reserves: Identified[];
  members: Identified[];
  /** Expense claims that can be waived into a donation. */
  claims: Identified[];
  meta: { createdAt: IsoTimestamp };
}

/**
 * Who keeps these books.
 *
 * A sole trader reckons in business income and expenses, a charitable
 * association in four spheres. That is no switch for the interface but the
 * points for categories, reporting and input tax.
 *
 * The details of the exemption notice live here because they belong on every
 * donation receipt: without them no valid one can be issued.
 */
export interface Entity {
  kind: 'business' | 'club';
  charitable: boolean;
  /** The charitable purpose as the articles word it. */
  purpose: string;
  /** Either the exemption notice or the annex to the corporation tax notice. */
  noticeType: 'freistellung' | 'anlage';
  noticeDate: IsoDate | '';
  noticeOffice: string;
  noticeYear: string;
  boardName: string;
  boardRole: string;
}

/* The business behind the books */

export interface CompanySocial {
  instagram: string;
  linkedin: string;
  facebook: string;
  xing: string;
  youtube: string;
  mastodon: string;
}

export interface CompanySignature {
  imagePath: string;
  text: string;
  height: number;
}

export interface CompanyQr {
  /** The giro mode renders an EPC code that fills in the transfer. */
  mode: 'none' | 'url' | 'giro';
  url: string;
  size: number;
}

export interface Company {
  name: string;
  owner: string;
  street: string;
  zip: string;
  city: string;
  country: CountryCode;
  taxNumber: string;
  vatId: string;
  email: string;
  phone: string;
  website: string;
  bankName: string;
  iban: string;
  bic: string;
  accountHolder: string;
  logoPath: string;
  social: CompanySocial;
  signature: CompanySignature;
  qr: CompanyQr;
  /** Only where the registered name differs from the trading one. */
  legalName?: string;
  street2?: string;
}

/** The company as a document sees it: images resolved, never stored this way. */
export interface DocumentCompany extends Company {
  logoDataUrl?: string;
  signatureDataUrl?: string;
}

/**
 * How this business is taxed.
 *
 * Every field here changes what the reports are allowed to show, which is why
 * they are named rather than left open.
 */
export interface TaxSettings {
  /** Small business exemption under UStG 19, or the regular scheme. */
  scheme: 'regel' | 'klein';
  /** Cash accounting (UStG 20) or accrual, which decides when VAT arises. */
  vatMethod: 'ist' | 'soll';
  vatPeriod: 'monthly' | 'quarterly' | 'yearly';
  /** Whether input tax follows the invoice date or the payment. */
  inputVatBasis: 'invoice' | 'payment';
  /** The extension of the filing deadline, bought with a special prepayment. */
  dauerfristverlaengerung: boolean;
  smallBusinessLimitNet: Cents;
  ecSalesPeriod?: 'monthly' | 'quarterly';
  /**
   * From which year this app carries the books.
   *
   * Earlier years can be caught up on, to see the reports across several years
   * for instance. For tax they are closed: the profit statement, VAT, the
   * deadlines and the reminders leave them out, so no filing arises from
   * incomplete old data. Null means every year counts in full.
   */
  bookkeepingFrom: number | null;
}

/**
 * Settings are typed loosely on purpose for now. They grow with every
 * feature, and pinning them down before the modules that use them are ported
 * would mean changing this file on every step.
 */
export interface Settings {
  company: Company;
  entity: Entity;
  tax: TaxSettings;
  invoice: Record<string, unknown>;
  segments: Array<Record<string, unknown>>;
  [key: string]: unknown;
}
