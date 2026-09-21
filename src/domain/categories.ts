// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import type { EntryType, SphereId, VatKey } from '../shared/types';

/**
 * Categories for income and expenses.
 *
 * Each one carries the position it is summed under on the official profit
 * statement. Deliberately without line numbers: those change almost every
 * year, the position names do not.
 */

export type Entity = 'business' | 'club';

export interface Category {
  id: string;
  label: string;
  position: string;
  defaultVatRate: number;
  defaultVatKey?: VatKey;
  /** Percentage that counts as a business expense, 100 unless limited. */
  deductible?: number;
  /** False where the law denies the input VAT deduction. */
  vatDeductible?: boolean;
  /** Marks payments to or from the tax office, which get their own position. */
  settlement?: string;
  /** Set where a marketplace sells in its own name and is therefore the customer. */
  platform?: boolean;
  sphere?: SphereId;
  donation?: string;
  hint?: string;
  sportsEvent?: boolean;
  /** Which tax-free allowance applies, for trainers or volunteers. */
  allowance?: 'trainer' | 'volunteer';
  /** Used internally, never offered in the form. */
  systemOnly?: boolean;
}

/** A category once the lists are merged and it knows where it belongs. */
export interface ResolvedCategory extends Category {
  kind: EntryType;
  entity: Entity;
}

const INCOME_CATEGORIES: Category[] = [
  { id: 'inc_services', label: 'Umsatzerlöse Dienstleistung', position: 'Betriebseinnahmen als umsatzsteuerpflichtiger Unternehmer', defaultVatRate: 19 },
  { id: 'inc_goods', label: 'Umsatzerlöse Warenverkauf', position: 'Betriebseinnahmen als umsatzsteuerpflichtiger Unternehmer', defaultVatRate: 19 },
  { id: 'inc_license', label: 'Lizenzen, Abos, wiederkehrende Erlöse', position: 'Betriebseinnahmen als umsatzsteuerpflichtiger Unternehmer', defaultVatRate: 19 },
  { id: 'inc_reduced', label: 'Erlöse ermäßigter Steuersatz', position: 'Betriebseinnahmen als umsatzsteuerpflichtiger Unternehmer', defaultVatRate: 7 },
  { id: 'inc_free', label: 'Steuerfreie oder nicht steuerbare Erlöse', position: 'Umsatzsteuerfreie und nicht steuerbare Betriebseinnahmen', defaultVatRate: 0, defaultVatKey: 'ausland' },
  { id: 'inc_eu', label: 'Innergemeinschaftliche Lieferung', position: 'Umsatzsteuerfreie und nicht steuerbare Betriebseinnahmen', defaultVatRate: 0, defaultVatKey: 'igl' },
  { id: 'inc_reverse', label: 'Leistung mit Reverse Charge, §13b', position: 'Umsatzsteuerfreie und nicht steuerbare Betriebseinnahmen', defaultVatRate: 0, defaultVatKey: 'reverse' },
  {
    id: 'inc_platform',
    label: 'Plattformerlöse, Merchant of Record',
    position: 'Umsatzsteuerfreie und nicht steuerbare Betriebseinnahmen',
    defaultVatRate: 0,
    defaultVatKey: 'eu_service',
    // Verkauft die Plattform im eigenen Namen, ist sie der Kunde. Sitzt sie in
    // der EU, ist es eine Dienstleistung an einen Unternehmer mit Reverse
    // Charge, sitzt sie im Drittland, ist der Umsatz nicht steuerbar. Der
    // Steuersatz beim Endkunden geht den Anbieter dann nichts an.
    platform: true
  },
  { id: 'inc_asset_sale', label: 'Verkauf von Anlagevermögen', position: 'Veräußerung von Anlagevermögen', defaultVatRate: 19 },
  { id: 'inc_private', label: 'Private Nutzung, Sachentnahme', position: 'Private Nutzung', defaultVatRate: 19 },
  { id: 'inc_interest', label: 'Zinserträge', position: 'Sonstige Betriebseinnahmen', defaultVatRate: 0 },
  { id: 'inc_other', label: 'Sonstige Betriebseinnahmen', position: 'Sonstige Betriebseinnahmen', defaultVatRate: 19 },
  { id: 'inc_vat_refund', label: 'Umsatzsteuererstattung vom Finanzamt', position: 'Vom Finanzamt erstattete Umsatzsteuer', defaultVatRate: 0, settlement: 'vat_refund', vatDeductible: false }
];

const EXPENSE_CATEGORIES: Category[] = [
  { id: 'exp_goods', label: 'Wareneinkauf', position: 'Waren, Rohstoffe und Hilfsstoffe', defaultVatRate: 19 },
  { id: 'exp_subcontract', label: 'Fremdleistungen, Subunternehmer', position: 'Bezogene Fremdleistungen', defaultVatRate: 19 },
  { id: 'exp_wages', label: 'Löhne und Gehälter', position: 'Ausgaben für eigenes Personal', defaultVatRate: 0, vatDeductible: false },
  { id: 'exp_depreciation', label: 'Abschreibung (AfA)', position: 'Absetzung für Abnutzung', defaultVatRate: 0, vatDeductible: false, systemOnly: true },
  { id: 'exp_gwg', label: 'Geringwertige Wirtschaftsgüter (GWG)', position: 'Sofortabschreibung geringwertiger Wirtschaftsgüter', defaultVatRate: 19 },
  { id: 'exp_rent', label: 'Miete und Pacht, betrieblich', position: 'Miete und Pacht für Geschäftsräume', defaultVatRate: 19 },
  { id: 'exp_homeoffice', label: 'Arbeitszimmer, Homeoffice-Pauschale', position: 'Aufwendungen für ein häusliches Arbeitszimmer', defaultVatRate: 0, vatDeductible: false },
  { id: 'exp_utilities', label: 'Strom, Gas, Wasser, Nebenkosten', position: 'Übrige Raumkosten', defaultVatRate: 19 },
  { id: 'exp_telecom', label: 'Telefon und Internet', position: 'Übrige unbeschränkt abziehbare Betriebsausgaben', defaultVatRate: 19 },
  { id: 'exp_software', label: 'Software, Lizenzen, Hosting, Cloud', position: 'Übrige unbeschränkt abziehbare Betriebsausgaben', defaultVatRate: 19 },
  { id: 'exp_office', label: 'Bürobedarf und Porto', position: 'Übrige unbeschränkt abziehbare Betriebsausgaben', defaultVatRate: 19 },
  { id: 'exp_marketing', label: 'Werbung und Marketing', position: 'Werbekosten', defaultVatRate: 19 },
  { id: 'exp_travel', label: 'Reisekosten', position: 'Reisekosten', defaultVatRate: 19 },
  { id: 'exp_perdiem', label: 'Verpflegungsmehraufwand, Pauschale', position: 'Reisekosten', defaultVatRate: 0, vatDeductible: false },
  { id: 'exp_entertainment', label: 'Bewirtung, 70 Prozent abziehbar', position: 'Beschränkt abziehbare Betriebsausgaben: Bewirtung', defaultVatRate: 19, deductible: 70 },
  { id: 'exp_gifts', label: 'Geschenke bis 50 Euro je Empfänger', position: 'Beschränkt abziehbare Betriebsausgaben: Geschenke', defaultVatRate: 19 },
  { id: 'exp_gifts_nd', label: 'Geschenke über 50 Euro, nicht abziehbar', position: 'Nicht abziehbare Betriebsausgaben', defaultVatRate: 19, deductible: 0, vatDeductible: false },
  { id: 'exp_vehicle', label: 'Fahrzeugkosten', position: 'Kraftfahrzeugkosten', defaultVatRate: 19 },
  { id: 'exp_mileage', label: 'Kilometerpauschale', position: 'Kraftfahrzeugkosten', defaultVatRate: 0, vatDeductible: false },
  { id: 'exp_insurance', label: 'Betriebliche Versicherungen und Beiträge', position: 'Übrige unbeschränkt abziehbare Betriebsausgaben', defaultVatRate: 0, vatDeductible: false },
  { id: 'exp_education', label: 'Fortbildung und Fachliteratur', position: 'Übrige unbeschränkt abziehbare Betriebsausgaben', defaultVatRate: 7 },
  { id: 'exp_legal', label: 'Rechts-, Steuer- und Beratungskosten', position: 'Übrige unbeschränkt abziehbare Betriebsausgaben', defaultVatRate: 19 },
  { id: 'exp_fees', label: 'Kontoführung, Gebühren, Zahlungsdienstleister', position: 'Übrige unbeschränkt abziehbare Betriebsausgaben', defaultVatRate: 0, vatDeductible: false },
  {
    id: 'exp_platform_fee',
    label: 'Plattform- und Vertriebsprovision',
    position: 'Übrige unbeschränkt abziehbare Betriebsausgaben',
    defaultVatRate: 0,
    defaultVatKey: 'ausland',
    // Provisionen von Plattformen im Ausland sind Leistungen an den Anbieter.
    // Sitzt die Plattform in der EU, schuldet er die Steuer selbst und zieht
    // sie zugleich als Vorsteuer ab, deshalb der Reverse-Charge-Schalter.
    vatDeductible: false,
    platform: true
  },
  { id: 'exp_interest', label: 'Zinsen für betriebliche Darlehen', position: 'Schuldzinsen', defaultVatRate: 0, vatDeductible: false },
  { id: 'exp_other', label: 'Sonstige Betriebsausgaben', position: 'Übrige unbeschränkt abziehbare Betriebsausgaben', defaultVatRate: 19 },
  { id: 'exp_vat_payment', label: 'Umsatzsteuer-Zahlung an das Finanzamt', position: 'An das Finanzamt gezahlte Umsatzsteuer', defaultVatRate: 0, settlement: 'vat_payment', vatDeductible: false },
  { id: 'exp_private', label: 'Privatentnahme, keine Betriebsausgabe', position: 'Nicht abziehbare Betriebsausgaben', defaultVatRate: 0, deductible: 0, vatDeductible: false }
];

/**
 * Kategorien eines gemeinnützigen Vereins.
 *
 * Ein Verein rechnet nicht in Betriebseinnahmen und Betriebsausgaben, sondern
 * in vier Sphären (siehe `spheres.js`). Die Kategorie schlägt die Sphäre vor,
 * entschieden wird sie an der einzelnen Buchung: derselbe Vorgang kann je nach
 * Ausgestaltung in zwei verschiedene Sphären gehören. Das bekannteste Beispiel
 * ist das Sponsoring, bei dem die Frage, ob der Verein aktiv mitwirbt, über
 * Vermögensverwaltung und wirtschaftlichen Geschäftsbetrieb entscheidet.
 *
 * `position` bezeichnet hier die Zeile der Einnahmen-Ausgaben-Rechnung, die
 * ein Verein nach § 63 Abs. 3 AO führt, nicht die der Anlage EÜR.
 */
const CLUB_INCOME: Category[] = [
  { id: 'cl_inc_dues', label: 'Mitgliedsbeiträge', position: 'Ideeller Bereich', sphere: 'ideell', defaultVatRate: 0, vatDeductible: false, donation: 'dues' },
  { id: 'cl_inc_donation', label: 'Geldspenden', position: 'Ideeller Bereich', sphere: 'ideell', defaultVatRate: 0, vatDeductible: false, donation: 'money' },
  { id: 'cl_inc_donation_kind', label: 'Sachspenden', position: 'Ideeller Bereich', sphere: 'ideell', defaultVatRate: 0, vatDeductible: false, donation: 'kind' },
  { id: 'cl_inc_grant', label: 'Zuschüsse und Fördermittel', position: 'Ideeller Bereich', sphere: 'ideell', defaultVatRate: 0, vatDeductible: false },
  { id: 'cl_inc_fines', label: 'Bußgelder und Aufnahmegebühren', position: 'Ideeller Bereich', sphere: 'ideell', defaultVatRate: 0, vatDeductible: false },

  { id: 'cl_inc_interest', label: 'Zinsen und Kapitalerträge', position: 'Vermögensverwaltung', sphere: 'vermoegen', defaultVatRate: 0 },
  { id: 'cl_inc_rent', label: 'Miete und Pacht', position: 'Vermögensverwaltung', sphere: 'vermoegen', defaultVatRate: 0 },
  {
    id: 'cl_inc_sponsor_passive',
    label: 'Sponsoring ohne Mitwirkung',
    position: 'Vermögensverwaltung',
    sphere: 'vermoegen',
    defaultVatRate: 7,
    // Duldet der Verein nur die Nennung des Sponsors, bleibt es
    // Vermögensverwaltung. Wirbt er selbst aktiv für ihn, wird daraus ein
    // wirtschaftlicher Geschäftsbetrieb.
    hint: 'Nur Duldung der Nennung, keine aktive Werbung'
  },

  { id: 'cl_inc_events', label: 'Sportliche Veranstaltungen, Eintritt', position: 'Zweckbetrieb', sphere: 'zweckbetrieb', defaultVatRate: 7, sportsEvent: true },
  { id: 'cl_inc_courses', label: 'Kurse, Lehrgänge, Training', position: 'Zweckbetrieb', sphere: 'zweckbetrieb', defaultVatRate: 7 },
  { id: 'cl_inc_services', label: 'Satzungsgemäße Leistungen an Mitglieder', position: 'Zweckbetrieb', sphere: 'zweckbetrieb', defaultVatRate: 7 },

  { id: 'cl_inc_catering', label: 'Bewirtung, Vereinsgaststätte', position: 'Wirtschaftlicher Geschäftsbetrieb', sphere: 'wirtschaftlich', defaultVatRate: 19 },
  { id: 'cl_inc_ads', label: 'Werbung und aktives Sponsoring', position: 'Wirtschaftlicher Geschäftsbetrieb', sphere: 'wirtschaftlich', defaultVatRate: 19 },
  { id: 'cl_inc_sales', label: 'Verkauf von Waren und Merchandise', position: 'Wirtschaftlicher Geschäftsbetrieb', sphere: 'wirtschaftlich', defaultVatRate: 19 },
  { id: 'cl_inc_other', label: 'Sonstige Einnahmen', position: 'Wirtschaftlicher Geschäftsbetrieb', sphere: 'wirtschaftlich', defaultVatRate: 19 },
  { id: 'cl_inc_vat_refund', label: 'Umsatzsteuererstattung vom Finanzamt', position: 'Wirtschaftlicher Geschäftsbetrieb', sphere: 'wirtschaftlich', defaultVatRate: 0, settlement: 'vat_refund', vatDeductible: false }
];

const CLUB_EXPENSE: Category[] = [
  { id: 'cl_exp_purpose', label: 'Satzungsgemäße Ausgaben', position: 'Ideeller Bereich', sphere: 'ideell', defaultVatRate: 0, vatDeductible: false },
  { id: 'cl_exp_trainer', label: 'Übungsleiter, Pauschale nach §3 Nr. 26 EStG', position: 'Ideeller Bereich', sphere: 'ideell', defaultVatRate: 0, vatDeductible: false, allowance: 'trainer' },
  { id: 'cl_exp_volunteer', label: 'Ehrenamtspauschale nach §3 Nr. 26a EStG', position: 'Ideeller Bereich', sphere: 'ideell', defaultVatRate: 0, vatDeductible: false, allowance: 'volunteer' },
  { id: 'cl_exp_fees_assoc', label: 'Beiträge an Verbände', position: 'Ideeller Bereich', sphere: 'ideell', defaultVatRate: 0, vatDeductible: false },
  { id: 'cl_exp_insurance', label: 'Versicherungen', position: 'Ideeller Bereich', sphere: 'ideell', defaultVatRate: 0, vatDeductible: false },
  { id: 'cl_exp_admin', label: 'Verwaltung, Porto, Software', position: 'Ideeller Bereich', sphere: 'ideell', defaultVatRate: 19, vatDeductible: false },
  { id: 'cl_exp_bank', label: 'Kontoführung und Gebühren', position: 'Ideeller Bereich', sphere: 'ideell', defaultVatRate: 0, vatDeductible: false },

  { id: 'cl_exp_property', label: 'Kosten der Vermögensverwaltung', position: 'Vermögensverwaltung', sphere: 'vermoegen', defaultVatRate: 19 },

  { id: 'cl_exp_events', label: 'Kosten sportlicher Veranstaltungen', position: 'Zweckbetrieb', sphere: 'zweckbetrieb', defaultVatRate: 19, sportsEvent: true },
  { id: 'cl_exp_sports', label: 'Sportbetrieb, Hallenmiete, Ausrüstung', position: 'Zweckbetrieb', sphere: 'zweckbetrieb', defaultVatRate: 19 },
  { id: 'cl_exp_referee', label: 'Schiedsrichter, Startgelder, Lizenzen', position: 'Zweckbetrieb', sphere: 'zweckbetrieb', defaultVatRate: 0, vatDeductible: false },

  { id: 'cl_exp_catering', label: 'Wareneinkauf Gaststätte und Verkauf', position: 'Wirtschaftlicher Geschäftsbetrieb', sphere: 'wirtschaftlich', defaultVatRate: 19 },
  { id: 'cl_exp_ads', label: 'Kosten für Werbung und Sponsoring', position: 'Wirtschaftlicher Geschäftsbetrieb', sphere: 'wirtschaftlich', defaultVatRate: 19 },
  { id: 'cl_exp_wages', label: 'Löhne und Gehälter', position: 'Wirtschaftlicher Geschäftsbetrieb', sphere: 'wirtschaftlich', defaultVatRate: 0, vatDeductible: false },
  { id: 'cl_exp_depreciation', label: 'Abschreibung (AfA)', position: 'Wirtschaftlicher Geschäftsbetrieb', sphere: 'wirtschaftlich', defaultVatRate: 0, vatDeductible: false, systemOnly: true },
  { id: 'cl_exp_other', label: 'Sonstige Ausgaben', position: 'Wirtschaftlicher Geschäftsbetrieb', sphere: 'wirtschaftlich', defaultVatRate: 19 },
  { id: 'cl_exp_vat_payment', label: 'Umsatzsteuer-Zahlung an das Finanzamt', position: 'Wirtschaftlicher Geschäftsbetrieb', sphere: 'wirtschaftlich', defaultVatRate: 0, settlement: 'vat_payment', vatDeductible: false }
];

/** Reihenfolge der Einnahmen-Ausgaben-Rechnung eines Vereins. */
const CLUB_ORDER: string[] = [
  'Ideeller Bereich',
  'Vermögensverwaltung',
  'Zweckbetrieb',
  'Wirtschaftlicher Geschäftsbetrieb'
];

function resolve(category: Category, kind: EntryType, entity: Entity): ResolvedCategory {
  return { ...category, kind, entity };
}

const ALL_CATEGORIES: ResolvedCategory[] = [
  ...INCOME_CATEGORIES.map((category) => resolve(category, 'income', 'business')),
  ...EXPENSE_CATEGORIES.map((category) => resolve(category, 'expense', 'business')),
  ...CLUB_INCOME.map((category) => resolve(category, 'income', 'club')),
  ...CLUB_EXPENSE.map((category) => resolve(category, 'expense', 'club'))
];

const BY_ID = new Map<string, ResolvedCategory>(ALL_CATEGORIES.map((category) => [category.id, category]));

export function getCategory(id: string | null | undefined): ResolvedCategory | null {
  return BY_ID.get(String(id)) ?? null;
}

/** Without an entity this returns the sole trader set, the common case. */
export function categoriesFor(kind: EntryType, entity: Entity = 'business'): ResolvedCategory[] {
  return ALL_CATEGORIES.filter(
    (category) => category.kind === kind && category.entity === entity && !category.systemOnly
  );
}

/** Share that counts, 100 unless the law limits it. */
export function deductiblePercent(categoryId: string): number {
  const category = getCategory(categoryId);
  return typeof category?.deductible === 'number' ? category.deductible : 100;
}

/** Whether this category can carry an input VAT deduction at all. */
export function allowsInputVat(categoryId: string): boolean {
  return getCategory(categoryId)?.vatDeductible !== false;
}

/** The order positions appear in on the report. */
const EUER_ORDER: string[] = [
  'Betriebseinnahmen als umsatzsteuerpflichtiger Unternehmer',
  'Umsatzsteuerfreie und nicht steuerbare Betriebseinnahmen',
  'Vereinnahmte Umsatzsteuer',
  'Vom Finanzamt erstattete Umsatzsteuer',
  'Veräußerung von Anlagevermögen',
  'Private Nutzung',
  'Sonstige Betriebseinnahmen',
  'Waren, Rohstoffe und Hilfsstoffe',
  'Bezogene Fremdleistungen',
  'Ausgaben für eigenes Personal',
  'Absetzung für Abnutzung',
  'Sofortabschreibung geringwertiger Wirtschaftsgüter',
  'Miete und Pacht für Geschäftsräume',
  'Übrige Raumkosten',
  'Aufwendungen für ein häusliches Arbeitszimmer',
  'Kraftfahrzeugkosten',
  'Reisekosten',
  'Werbekosten',
  'Beschränkt abziehbare Betriebsausgaben: Bewirtung',
  'Beschränkt abziehbare Betriebsausgaben: Geschenke',
  'Schuldzinsen',
  'Übrige unbeschränkt abziehbare Betriebsausgaben',
  'Gezahlte Vorsteuerbeträge',
  'An das Finanzamt gezahlte Umsatzsteuer',
  'Nicht abziehbare Betriebsausgaben'
];

export {
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  CLUB_INCOME,
  CLUB_EXPENSE,
  CLUB_ORDER,
  ALL_CATEGORIES,
  EUER_ORDER
};
