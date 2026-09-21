// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { escapeText } from './xml';
import { formatAmount } from '../domain/money';
import { getCategory } from '../domain/categories';
import { totals, type Totals } from '../domain/invoices';
import type {
  Asset, BusinessDocument, Cents, Customer, DocumentItem, Entry, Id, IsoDate, Receipt, Snapshot
} from '../shared/types';


/**
 * GoBD: process documentation and data export.
 *
 * Two things a tax audit may demand, both of which can be produced from what
 * the app knows anyway.
 *
 * **Process documentation.** It describes how receipts arise, how they are
 * recorded and how they are kept. In principle everyone owes it, even on a
 * cash basis ledger; for a sole trader without staff a waiver is accepted when
 * the process explains itself in a few sentences. Where it is missing and a
 * question stays open, estimates are possible. So the app writes it itself: it
 * knows the process better than any template off the web.
 *
 * **Data export under AO 147 (6).** An audit may demand the data in machine
 * readable form (Z3, handing over a medium). Since the GDPdU there is a
 * description standard for that: next to the CSV files sits an index.xml that
 * names every column and gives its type. Without it a CSV is just a text file.
 *
 * The character set is deliberately Windows-1252: the checking software of the
 * tax offices expects it, and UTF-8 still does not arrive there reliably.
 */

export type ColumnType = 'text' | 'date' | 'amount' | 'number';

/**
 * One column of one table.
 *
 * Written as a method rather than a property on purpose: that keeps the
 * parameter bivariant, so tables over different row types can sit in one
 * array without a cast at every use.
 */
export interface Column<Row> {
  name: string;
  type: ColumnType;
  value(row: Row, data: Snapshot, documentTotals?: Totals | null): unknown;
}

export interface Table<Row> {
  file: string;
  name: string;
  description: string;
  rows(data: Snapshot): readonly Row[];
  columns: Column<Row>[];
}

/**
 * What gets written out.
 *
 * Every column carries a name for the human and a type for the checking
 * software. Amounts are decimals with a comma, as the description standard
 * prescribes for Germany.
 */
/** A line item carrying the document it belongs to, for the flat table. */
type DocumentLine = DocumentItem & { _doc: BusinessDocument; _index: number };

const TABLES: [
  Table<Entry>,
  Table<BusinessDocument>,
  Table<DocumentLine>,
  Table<Customer>,
  Table<Asset>,
  Table<Receipt>
] = [
  {
    file: 'buchungen.csv',
    name: 'Buchungen',
    description: 'Einnahmen und Ausgaben nach dem Zu- und Abflussprinzip',
    rows: (data) => data.entries,
    columns: [
      { name: 'ID', type: 'text', value: (e) => e.id },
      { name: 'Art', type: 'text', value: (e) => (e.type === 'income' ? 'Einnahme' : 'Ausgabe') },
      { name: 'Belegdatum', type: 'date', value: (e) => e.date },
      { name: 'Zahlungsdatum', type: 'date', value: (e) => e.paidDate || '' },
      { name: 'Beschreibung', type: 'text', value: (e) => e.description },
      { name: 'Gegenpartei', type: 'text', value: (e) => e.counterparty },
      { name: 'Kategorie', type: 'text', value: (e) => labelOf(e.categoryId) },
      { name: 'KategorieID', type: 'text', value: (e) => e.categoryId },
      { name: 'EUERPosition', type: 'text', value: (e) => positionOf(e.categoryId) },
      { name: 'Netto', type: 'amount', value: (e) => e.net },
      { name: 'Umsatzsteuer', type: 'amount', value: (e) => e.vat },
      { name: 'Brutto', type: 'amount', value: (e) => e.gross },
      { name: 'Steuersatz', type: 'number', value: (e) => e.vatRate },
      { name: 'Steuerschluessel', type: 'text', value: (e) => e.vatKey || '' },
      { name: 'Privatanteil', type: 'number', value: (e) => e.privateSharePercent || 0 },
      { name: 'ReverseCharge', type: 'text', value: (e) => (e.reverseCharge ? 'ja' : 'nein') },
      { name: 'Zahlungsart', type: 'text', value: (e) => e.paymentMethod || '' },
      { name: 'Land', type: 'text', value: (e) => e.countryCode || '' },
      { name: 'USTIdNrGegenpartei', type: 'text', value: (e) => e.counterpartyVatId || '' },
      { name: 'Bereich', type: 'text', value: (e, data) => segmentOf(data, e.segmentId) },
      { name: 'Projekt', type: 'text', value: (e, data) => nameOf(data.projects, e.projectId) },
      { name: 'Kunde', type: 'text', value: (e, data) => nameOf(data.customers, e.customerId) },
      { name: 'BelegID', type: 'text', value: (e) => e.receiptId || '' },
      { name: 'RechnungID', type: 'text', value: (e) => e.invoiceId || '' },
      { name: 'Herkunft', type: 'text', value: (e) => herkunft(e) },
      { name: 'Angelegt', type: 'text', value: (e) => e.createdAt || '' },
      { name: 'Geaendert', type: 'text', value: (e) => e.updatedAt || '' },
      { name: 'Bemerkung', type: 'text', value: (e) => e.note || '' }
    ]
  },
  {
    file: 'dokumente.csv',
    name: 'Ausgangsdokumente',
    description: 'Rechnungen, Stornorechnungen, Angebote und Kostenvoranschläge',
    rows: (data) => data.invoices,
    columns: [
      { name: 'ID', type: 'text', value: (d) => d.id },
      { name: 'Art', type: 'text', value: (d) => d.documentType || 'invoice' },
      { name: 'Nummer', type: 'text', value: (d) => d.number || '' },
      { name: 'Status', type: 'text', value: (d) => d.status },
      { name: 'Datum', type: 'date', value: (d) => d.issueDate || '' },
      { name: 'Leistungsdatum', type: 'date', value: (d) => d.deliveryDate || '' },
      { name: 'Faellig', type: 'date', value: (d) => d.dueDate || '' },
      { name: 'Kunde', type: 'text', value: (d, data) => nameOf(data.customers, d.customerId) },
      { name: 'KundeID', type: 'text', value: (d) => d.customerId || '' },
      { name: 'Waehrung', type: 'text', value: (d) => d.currency || 'EUR' },
      { name: 'Netto', type: 'amount', value: (d, data, totals) => totals?.netTotal },
      { name: 'Umsatzsteuer', type: 'amount', value: (d, data, totals) => totals?.vatTotal },
      { name: 'Brutto', type: 'amount', value: (d, data, totals) => totals?.grossTotal },
      { name: 'Bezahlt', type: 'amount', value: (d, data, totals) => totals?.paid },
      { name: 'Offen', type: 'amount', value: (d, data, totals) => totals?.openAmount },
      { name: 'Mahnungen', type: 'number', value: (d) => (d.reminders || []).length },
      { name: 'Festgeschrieben', type: 'text', value: (d) => d.finalizedAt || '' }
    ]
  },
  {
    file: 'positionen.csv',
    name: 'Dokumentpositionen',
    description: 'Einzelpositionen der Ausgangsdokumente',
    rows: (data) => data.invoices.flatMap((doc) =>
      (doc.items || []).map((item, index) => ({ ...item, _doc: doc, _index: index + 1 }))),
    columns: [
      { name: 'DokumentID', type: 'text', value: (i) => i._doc.id },
      { name: 'Nummer', type: 'text', value: (i) => i._doc.number || '' },
      { name: 'Position', type: 'number', value: (i) => i._index },
      { name: 'Bezeichnung', type: 'text', value: (i) => i.name || '' },
      { name: 'Beschreibung', type: 'text', value: (i) => i.description || '' },
      { name: 'Menge', type: 'number', value: (i) => i.quantity },
      { name: 'Einheit', type: 'text', value: (i) => i.unit || '' },
      { name: 'Einzelpreis', type: 'amount', value: (i) => i.unitPriceNet },
      { name: 'Rabatt', type: 'number', value: (i) => i.discountPercent || 0 },
      { name: 'Steuersatz', type: 'number', value: (i) => i.vatRate }
    ]
  },
  {
    file: 'kunden.csv',
    name: 'Kunden',
    description: 'Stammdaten der Geschäftspartner',
    rows: (data) => data.customers,
    columns: [
      { name: 'ID', type: 'text', value: (c) => c.id },
      { name: 'Name', type: 'text', value: (c) => c.name },
      { name: 'Kundennummer', type: 'text', value: (c) => c.customerNumber || '' },
      { name: 'Strasse', type: 'text', value: (c) => c.street || '' },
      { name: 'PLZ', type: 'text', value: (c) => c.zip || '' },
      { name: 'Ort', type: 'text', value: (c) => c.city || '' },
      { name: 'Land', type: 'text', value: (c) => c.country || '' },
      { name: 'USTIdNr', type: 'text', value: (c) => c.vatId || '' }
    ]
  },
  {
    file: 'anlagen.csv',
    name: 'Anlagevermögen',
    description: 'Anlagegüter mit Abschreibung',
    rows: (data) => data.assets,
    columns: [
      { name: 'ID', type: 'text', value: (a) => a.id },
      { name: 'Bezeichnung', type: 'text', value: (a) => a.label },
      { name: 'Anschaffung', type: 'date', value: (a) => a.purchaseDate },
      { name: 'Kosten', type: 'amount', value: (a) => a.netCents },
      { name: 'Nutzungsdauer', type: 'number', value: (a) => a.usefulLifeYears },
      // The app writes down linearly and offers nothing else.
      { name: 'Methode', type: 'text', value: () => 'linear' },
      { name: 'Abgang', type: 'date', value: (a) => a.disposalDate || '' }
    ]
  },
  {
    file: 'belege.csv',
    name: 'Belege',
    description: 'Abgelegte Belegdateien mit Prüfsumme',
    rows: (data) => data.receipts,
    columns: [
      { name: 'ID', type: 'text', value: (r) => r.id },
      { name: 'Datei', type: 'text', value: (r) => r.fileName || '' },
      { name: 'Ablage', type: 'text', value: (r) => r.relativePath || '' },
      { name: 'Datum', type: 'date', value: (r) => r.date || '' },
      { name: 'Originalname', type: 'text', value: (r) => r.originalName || '' },
      { name: 'Groesse', type: 'number', value: (r) => r.size || 0 },
      { name: 'Pruefsumme', type: 'text', value: (r) => r.checksum || '' },
      { name: 'Abgelegt', type: 'text', value: (r) => r.addedAt || '' }
    ]
  }
];

function labelOf(categoryId: string): string {
  return getCategory(categoryId)?.label ?? categoryId ?? '';
}

function positionOf(categoryId: string): string {
  return getCategory(categoryId)?.position ?? '';
}

function nameOf(list: ReadonlyArray<{ id: Id; name?: string }> | undefined, id: Id | null): string {
  if (!id) return '';
  const found = (list ?? []).find((item) => item.id === id);
  return found?.name ?? '';
}

function segmentOf(data: Snapshot, id: Id | null): string {
  if (!id) return '';
  const found = (data.settings.segments ?? []).find((segment) => segment.id === id);
  return found ? String(found.label ?? '') : '';
}

/** Where a booking came from, which an audit takes particular interest in. */
export function herkunft(entry: Entry): string {
  if (entry.bankRef) return 'Kontoauszug';
  if (entry.eInvoiceRef) return 'E-Rechnung';
  if (entry.recurrenceId) return 'Wiederkehrende Vorlage';
  if (entry.invoiceId) return 'Zahlung auf eigene Rechnung';
  return 'Erfassung von Hand';
}

/**
 * The same tables for everything that walks all of them at once.
 *
 * The declaration above keeps every row type strict; a heterogeneous array
 * cannot be iterated under one type parameter, and this is the one place that
 * needs the erasure.
 */
const ALL_TABLES = TABLES as readonly Table<any>[];

/* CSV */

export function csvCell(value: unknown, type: ColumnType): string {
  if (value === null || value === undefined) return '';
  if (type === 'amount') return formatAmount(value as Cents).replace(/\./g, '');
  if (type === 'number') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(numeric).replace('.', ',') : '';
  }

  const text = String(value).replace(/\r?\n/g, ' ').trim();
  // The standard allows text delimiters. Delimiting every text field is safer
  // than guessing which one holds a semicolon.
  return `"${text.replace(/"/g, '""')}"`;
}

/** One table as CSV text, without a header row in the file. */
export function tableCsv<Row>(table: Table<Row>, data: Snapshot): string {
  const rows = table.rows(data) ?? [];

  const lines = rows.map((row) => {
    const documentTotals = table.file === 'dokumente.csv' ? totals(row as BusinessDocument) : null;
    return table.columns
      .map((column) => csvCell(column.value(row, data, documentTotals), column.type))
      .join(';');
  });

  return lines.join('\r\n') + (lines.length ? '\r\n' : '');
}

/* index.xml */

const TYPE_MAP: Record<ColumnType, string> = {
  text: 'AlphaNumeric',
  date: 'AlphaNumeric',
  amount: 'Numeric',
  number: 'Numeric'
};

export interface ExportMeta {
  from?: IsoDate;
  to?: IsoDate;
  /** Injectable so a test gets a stable stamp. */
  createdAt?: string;
}

/**
 * The description file following the GDPdU standard.
 *
 * It tells the checking software which files exist, how they are built and
 * what sits in which column. Without it the export is worthless.
 */
export function buildIndexXml(data: Snapshot, meta: ExportMeta = {}): string {
  const company = data.settings.company;
  const now = meta.createdAt ?? new Date().toISOString();

  const tables = ALL_TABLES.map((table) => {
    const columns = table.columns.map((column) => {
      const type = TYPE_MAP[column.type] ?? 'AlphaNumeric';
      const extra = column.type === 'amount' || column.type === 'number'
        ? '\n            <Accuracy>2</Accuracy>\n            <DecimalSymbol>,</DecimalSymbol>\n            <DigitGroupingSymbol>.</DigitGroupingSymbol>'
        : '';
      return `        <VariableColumn>
          <Name>${escapeText(column.name)}</Name>
          <Description>${escapeText(column.name)}</Description>
          <${type}>${extra}
          </${type}>
        </VariableColumn>`;
    }).join('\n');

    return `    <Table>
      <URL>${escapeText(table.file)}</URL>
      <Name>${escapeText(table.name)}</Name>
      <Description>${escapeText(table.description)}</Description>
      <Validity>
        <Range>
          <From>${escapeText(meta.from || '')}</From>
          <To>${escapeText(meta.to || '')}</To>
        </Range>
        <Format>YYYY-MM-DD</Format>
      </Validity>
      <DecimalSymbol>,</DecimalSymbol>
      <DigitGroupingSymbol>.</DigitGroupingSymbol>
      <VariableLength>
        <ColumnDelimiter>;</ColumnDelimiter>
        <RecordDelimiter>${'\\r\\n'}</RecordDelimiter>
        <TextEncapsulator>"</TextEncapsulator>
${columns}
      </VariableLength>
    </Table>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE DataSet SYSTEM "gdpdu-01-08-2002.dtd">
<DataSet>
  <Version>1.0</Version>
  <DataSupplier>
    <Name>${escapeText(company.name || 'Unbekannt')}</Name>
    <Location>${escapeText([company.zip, company.city].filter(Boolean).join(' ') || 'Deutschland')}</Location>
    <Comment>Erzeugt von NestEgg am ${escapeText(now.slice(0, 10))}</Comment>
  </DataSupplier>
  <Media>
    <Name>Datenüberlassung nach §147 Abs. 6 AO</Name>
${tables}
  </Media>
</DataSet>
`;
}

export interface ExportFile {
  name: string;
  content: string;
}

export interface DataExport {
  files: ExportFile[];
  tables: { file: string; name: string }[];
}

/** Builds the complete export: one CSV per table plus its description. */
export function buildDataExport(data: Snapshot, meta: ExportMeta = {}): DataExport {
  const files: ExportFile[] = ALL_TABLES.map((table) => ({
    name: table.file,
    content: tableCsv(table, data)
  }));

  files.push({ name: 'index.xml', content: buildIndexXml(data, meta) });
  files.push({ name: 'liesmich.txt', content: readme(meta) });
  return { files, tables: ALL_TABLES.map((table) => ({ file: table.file, name: table.name })) };
}

function readme(meta: ExportMeta): string {
  return [
    'Datenüberlassung nach §147 Abs. 6 AO (Z3)',
    '',
    `Erzeugt am ${(meta.createdAt || new Date().toISOString()).slice(0, 10)} aus NestEgg.`,
    meta.from ? `Zeitraum: ${meta.from} bis ${meta.to}` : 'Zeitraum: gesamter Bestand',
    '',
    'Aufbau:',
    ...ALL_TABLES.map((table) => `  ${table.file.padEnd(18)} ${table.description}`),
    '  index.xml          Beschreibungsstandard, nennt Dateien, Spalten und Typen',
    '',
    'Zeichensatz: Windows-1252. Trennzeichen: Semikolon. Textbegrenzer: doppeltes Anführungszeichen.',
    'Beträge stehen in Euro mit Komma als Dezimaltrennzeichen, ohne Tausenderpunkt.',
    '',
    'Die Belegdateien selbst liegen im Ordner belege des Datenbestands. Die Spalte',
    'Pruefsumme in belege.csv enthält den SHA-256-Wert der Datei zum Zeitpunkt der',
    'Ablage und belegt, dass sie seither unverändert ist.'
  ].join('\r\n');
}

/**
 * Text as Windows-1252, without characters quietly disappearing.
 *
 * Buffer.from(text, 'latin1') truncates everything that does not fit: a euro
 * sign becomes a question mark, typographic quotes become nonsense. So what
 * cannot be represented is replaced beforehand and the rest stays readable.
 */
export function toAnsi(text: string): Buffer {
  const replaced = String(text)
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/€/g, 'EUR')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    // Everything else Windows-1252 does not know is named, not dropped.
    .replace(/[^ -ÿ]/g, (char) => `&#${char.codePointAt(0)};`);

  return Buffer.from(replaced, 'latin1');
}

export { TABLES };
