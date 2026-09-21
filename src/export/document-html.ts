// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { formatAmount } from '../domain/money';
import { totals, UNITS, type Totals } from '../domain/invoices';
import { typeOf, isOffer, type DocumentTypeInfo } from '../domain/doctypes';
import { buildCss } from './document-css';
import { escapeText as esc } from './xml';
import * as qr from './qr';
import type { RawTheme } from './theme';
import type { PreparedReminder } from '../domain/dunning';
import type { BusinessDocument, Cents, CompanySocial, Customer, DocumentCompany, DocumentItem } from '../shared/types';

/**
 * The layout of every business document, as HTML.
 *
 * The structure follows DIN 5008: a single sender line above the address
 * field, the address on the left where the window sits, the information block
 * on the right. Everything that can be styled lives in the theme and arrives
 * through document-css.
 *
 * The same functions serve the PDF export and the preview in the app.
 */

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [year, month, day] = String(iso).split('-');
  return year && month && day ? `${day}.${month}.${year}` : String(iso);
}

function unitLabel(code: string): string {
  return UNITS.find((unit) => unit.code === code)?.label ?? '';
}

function formatQuantity(value: number): string {
  const numeric = Number(value) || 0;
  return Number.isInteger(numeric) ? String(numeric) : numeric.toLocaleString('de-DE', { maximumFractionDigits: 3 });
}

export interface PlaceholderContext {
  dueDate?: string | null;
  validUntil?: string | null;
  amount: Cents;
  number?: string | null;
  issueDate?: string | null;
  customerName?: string;
  tolerance?: number;
}

/** Replaces the placeholders in the free texts. */
export function fillPlaceholders(text: string | null | undefined, context: PlaceholderContext): string {
  return String(text ?? '')
    .replace(/\{DUEDATE\}/g, formatDate(context.dueDate))
    .replace(/\{VALIDUNTIL\}/g, formatDate(context.validUntil))
    .replace(/\{AMOUNT\}/g, `${formatAmount(context.amount)} Euro`)
    .replace(/\{NUMBER\}/g, context.number ?? '')
    .replace(/\{DATE\}/g, formatDate(context.issueDate))
    .replace(/\{CUSTOMER\}/g, context.customerName ?? '')
    .replace(/\{TOLERANCE\}/g, String(context.tolerance || 15));
}

/**
 * The social media lines of the footer.
 *
 * Printed the way the user typed it, with the prefix the service is known by:
 * an at sign for Instagram, a path for LinkedIn. A full address is taken as is.
 */
const SOCIAL: Record<keyof CompanySocial, { glyph: string; format: (value: string) => string }> = {
  instagram: { glyph: '◎', format: (value) => (value.startsWith('http') ? value : `@${value.replace(/^@/, '')}`) },
  linkedin: { glyph: 'in', format: (value) => (value.startsWith('http') ? value : `/in/${value.replace(/^\/?(in\/)?/, '')}`) },
  facebook: { glyph: 'f', format: (value) => (value.startsWith('http') ? value : `/${value.replace(/^\//, '')}`) },
  xing: { glyph: 'X', format: (value) => (value.startsWith('http') ? value : `/profile/${value.replace(/^\/?(profile\/)?/, '')}`) },
  youtube: { glyph: '▷', format: (value) => (value.startsWith('http') ? value : `@${value.replace(/^@/, '')}`) },
  mastodon: { glyph: '◆', format: (value) => value }
};

/** A footer line is either plain text or a pair of text and glyph. */
type FooterLine = string | { text: string; icon: string };

function socialLines(company: DocumentCompany): FooterLine[] {
  const social: Partial<CompanySocial> = company.social ?? {};
  const services = Object.keys(SOCIAL) as (keyof CompanySocial)[];

  return services
    .map((service) => {
      const value = String(social[service] ?? '').trim();
      return value ? { text: SOCIAL[service].format(value), icon: SOCIAL[service].glyph } : null;
    })
    .filter((line): line is { text: string; icon: string } => line !== null);
}

/** The four columns of the footer. Documents and reminders share them. */
function footerColumns(company: DocumentCompany): FooterLine[][] {
  return [
    [company.name, company.street, [company.zip, company.city].filter(Boolean).join(' ')].filter(Boolean),
    [
      company.phone ? { text: company.phone, icon: '☎' } : null,
      company.email ? { text: company.email, icon: '✉' } : null,
      company.website ? { text: company.website, icon: '⌂' } : null,
      ...socialLines(company)
    ].filter((line): line is FooterLine => Boolean(line)),
    [company.bankName, company.iban ? `IBAN ${company.iban}` : '', company.bic ? `BIC ${company.bic}` : ''].filter(Boolean),
    [
      company.taxNumber ? `Steuernummer ${company.taxNumber}` : '',
      company.vatId ? `USt-IdNr. ${company.vatId}` : '',
      company.owner ? `Inhaber ${company.owner}` : ''
    ].filter(Boolean)
  ];
}

function footerLine(line: FooterLine, withIcons: boolean): string {
  if (typeof line === 'string') return esc(line);
  return withIcons
    ? `<span class="icon" data-icon="${esc(line.icon)}">${esc(line.text)}</span>`
    : esc(line.text);
}

function footerHtml(company: DocumentCompany, withIcons: boolean): string {
  const columns = footerColumns(company)
    .map((column) => `<div>${column.map((line) => footerLine(line, withIcons)).join('<br>')}</div>`)
    .join('');

  return `<div class="footer">${columns}</div>`;
}

/**
 * The QR code for the head of the document.
 *
 * Two kinds: a fixed address, or a GiroCode carrying the payment details. The
 * GiroCode only goes on invoices and only while something is open: a quote has
 * nothing to transfer, and on a paid invoice it would invite a second payment.
 */
function qrImage(
  document: BusinessDocument,
  company: DocumentCompany,
  type: DocumentTypeInfo,
  sums: Totals
): string {
  const settings = company.qr ?? { mode: 'none', url: '', size: 24 };
  const size = Number(settings.size) || 24;
  const image = (payload: string) =>
    `<img class="qr" style="width:${size}mm;height:${size}mm" src="${esc(qr.dataUrl(payload))}" alt="">`;

  if (settings.mode === 'url' && settings.url) return image(settings.url);

  if (settings.mode === 'giro') {
    const open = sums ? sums.openAmount : 0;
    if (type.group === 'offer' || !company.iban || open <= 0) return '';

    const payload = qr.girocode({
      name: company.accountHolder || company.name,
      iban: company.iban,
      bic: company.bic,
      amount: open,
      text: document.number ? `Rechnung ${document.number}` : ''
    });
    return `${image(payload)}<div class="qr-note">Zum Bezahlen scannen</div>`;
  }

  return '';
}

/** The width the head has to leave free for a QR code sitting beside it. */
function headPadding(company: DocumentCompany, hasQr: boolean): number {
  return hasQr ? (Number(company.qr?.size) || 24) + 6 : 0;
}

function headHtml(company: DocumentCompany, hasQr: boolean): string {
  const logo = company.logoDataUrl ? `<img class="logo" src="${esc(company.logoDataUrl)}" alt="">` : '';

  return `<div class="head" style="padding-right:${headPadding(company, hasQr)}mm">
    <div>
      <div class="sender-name">${esc(company.name)}</div>
      ${company.owner ? `<div class="sender-sub">${esc(company.owner)}</div>` : ''}
    </div>
    ${logo}
  </div>`;
}

function addressLines(customer: Customer): string {
  const lines = [
    customer.name,
    customer.contactName,
    customer.street,
    customer.street2,
    [customer.zip, customer.city].filter(Boolean).join(' '),
    customer.country && customer.country !== 'DE' ? customer.country : ''
  ].filter(Boolean);

  return lines.map((line) => `<div>${esc(line)}</div>`).join('');
}

/** Label and value, where an empty value drops the whole row. */
type InfoRow = [string, string | null | undefined];

function addressAreaHtml(company: DocumentCompany, customer: Customer, rows: InfoRow[]): string {
  const senderLine = [company.name, company.street, [company.zip, company.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' · ');

  const table = rows.map(([label, value]) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('');

  return `<div class="address-area">
    <div class="address">
      <div class="sender-line">${esc(senderLine)}</div>
      ${addressLines(customer)}
    </div>
    <div class="info">
      <table>${table}</table>
    </div>
  </div>`;
}

function page(title: string, css: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
${css}
</style>
</head>
<body>
<div class="sheet">
${body}
</div>
</body>
</html>`;
}

const NUMBER_LABELS: Record<string, string> = {
  invoice: 'Rechnungsnummer',
  creditnote: 'Stornonummer',
  quote: 'Angebotsnummer',
  estimate: 'Vorschlagsnummer'
};

/** The information block on the right, filled differently per document type. */
function infoRows(
  document: BusinessDocument,
  type: DocumentTypeInfo,
  company: DocumentCompany,
  customer: Customer
): InfoRow[] {
  const rows: InfoRow[] = [
    [NUMBER_LABELS[type.id] ?? 'Nummer', document.number],
    ['Datum', formatDate(document.issueDate)]
  ];

  if (type.group === 'offer') {
    if (document.validUntil) rows.push(['Gültig bis', formatDate(document.validUntil)]);
  } else {
    const period = document.deliveryPeriod;
    if (period?.from) {
      rows.push(['Leistungszeitraum', `${formatDate(period.from)} bis ${formatDate(period.to || period.from)}`]);
    } else if (document.deliveryDate) {
      rows.push(['Leistungsdatum', formatDate(document.deliveryDate)]);
    }
    if (document.dueDate) rows.push(['Fällig am', formatDate(document.dueDate)]);
    if (document.cancelsInvoiceNumber) rows.push(['Storno zu', document.cancelsInvoiceNumber]);
  }

  if (customer.customerNumber) rows.push(['Kundennummer', customer.customerNumber]);
  if (document.buyerReference) rows.push(['Leitweg-ID', document.buyerReference]);
  if (document.orderReference) rows.push(['Ihre Referenz', document.orderReference]);
  if (company.taxNumber) rows.push(['Steuernummer', company.taxNumber]);
  if (company.vatId) rows.push(['USt-IdNr.', company.vatId]);

  return rows.filter(([, value]) => value);
}

function itemRows(lines: ReadonlyArray<DocumentItem & { net: Cents }>): string {
  return lines
    .map((line, index) => {
      const unit = unitLabel(line.unit);
      const description = line.description
        ? `<div class="pos-desc">${esc(line.description).replace(/\n/g, '<br>')}</div>`
        : '';
      const discount = line.discountPercent
        ? `<div class="pos-desc">abzüglich ${formatQuantity(line.discountPercent)} Prozent Rabatt</div>`
        : '';

      return `<tr>
        <td class="num">${index + 1}</td>
        <td><div class="pos-name">${esc(line.name)}</div>${description}${discount}</td>
        <td class="num">${formatQuantity(line.quantity)}${unit ? ` ${esc(unit)}` : ''}</td>
        <td class="num">${formatAmount(line.unitPriceNet)}</td>
        <td class="num">${line.vatRate ? `${formatQuantity(line.vatRate)} %` : '0 %'}</td>
        <td class="num">${formatAmount(line.net)}</td>
      </tr>`;
    })
    .join('');
}

/**
 * The own signature below the closing text.
 *
 * An uploaded image wins, otherwise the name in a script face. Either is a
 * facsimile and replaces no handwritten signature where one is required; on an
 * invoice or a quote none is needed anyway.
 */
function signatureBlock(company: DocumentCompany): string {
  const signature = company.signature ?? { imagePath: '', text: '', height: 16 };
  const greeting = (signature as { greeting?: string }).greeting ?? 'Mit freundlichen Grüßen';
  const height = Number(signature.height) || 16;

  const mark = company.signatureDataUrl
    ? `<img class="sign-image" style="height:${height}mm" src="${esc(company.signatureDataUrl)}" alt="">`
    : (signature.text ? `<div class="sign-text">${esc(signature.text)}</div>` : '');

  if (!mark && !greeting) return '';

  return `<div class="own-signature">
    ${greeting ? `<div class="sign-greeting">${esc(greeting)}</div>` : ''}
    ${mark}
    ${signature.text && company.signatureDataUrl ? `<div class="sign-name">${esc(signature.text)}</div>` : ''}
  </div>`;
}

export interface RenderOptions {
  theme?: RawTheme | null;
  /** Lets the sheet grow instead of cutting off at one page. */
  preview?: boolean;
}

function totalLabelFor(type: DocumentTypeInfo, offer: boolean): string {
  if (offer) return type.id === 'estimate' ? 'Geschätzte Gesamtkosten' : 'Angebotssumme';
  return type.id === 'creditnote' ? 'Stornobetrag' : 'Rechnungsbetrag';
}

function vatRowsHtml(sums: Totals): string {
  return sums.vatBreakdown
    .map((group) => {
      const label = group.rate
        ? `zzgl. ${formatQuantity(group.rate)} Prozent Umsatzsteuer auf ${formatAmount(group.base)}`
        : 'Umsatzsteuer';
      return `<tr><td>${esc(label)}</td><td class="num">${formatAmount(group.tax)}</td></tr>`;
    })
    .join('');
}

/** Renders an invoice, credit note, quote or estimate. */
export function render(
  document: BusinessDocument,
  company: DocumentCompany,
  customer: Customer,
  options: RenderOptions = {}
): string {
  const type = typeOf(document);
  const offer = isOffer(document);
  const sums = totals(document);
  const theme = options.theme ?? {};
  const css = buildCss(theme, { preview: Boolean(options.preview) });

  const context: PlaceholderContext = {
    dueDate: document.dueDate,
    validUntil: document.validUntil,
    amount: sums.openAmount || sums.grossTotal,
    number: document.number,
    issueDate: document.issueDate,
    customerName: customer.name,
    tolerance: document.tolerancePercent || 15
  };

  const title = document.documentTitle || type.label;
  const rows = infoRows(document, type, company, customer);
  const qrBox = qrImage(document, company, type, sums);

  const paidRow = !offer && sums.paid
    ? `<tr><td>Bereits gezahlt</td><td class="num">${formatAmount(-sums.paid)}</td></tr>
       <tr class="total"><td>Offener Betrag</td><td class="num">${formatAmount(sums.openAmount)}</td></tr>`
    : '';

  const hints = sums.vatBreakdown
    .filter((group) => group.exemptionReason)
    .map((group) => `<p class="hint">${esc(group.exemptionReason)}</p>`)
    .join('');

  // A quote or an estimate usually carries a field for the acceptance.
  const acceptance = offer && document.showSignature
    ? `<div class="signature">
        <div>Ort und Datum</div>
        <div>Unterschrift Auftraggeber</div>
      </div>`
    : '';

  const place = document.place || company.city || '';
  const placeLine = theme.showPlaceLine
    ? `<div class="place-line">${esc(place)}${place ? ', ' : ''}${esc(formatDate(document.issueDate))}</div>`
    : '';

  const body = `  ${qrBox ? `<div class="qr-box">${qrBox}</div>` : ''}
  ${headHtml(company, Boolean(qrBox))}

  ${addressAreaHtml(company, customer, rows)}

  ${placeLine}
  <h1>${esc(title)}${theme.infoStyle === 'row' ? '' : ` ${esc(document.number ?? '')}`}</h1>
  <div class="info-row">
    ${rows.map(([label, value]) => `<span class="pair"><span>${esc(label)}:</span> <b>${esc(value)}</b></span>`).join('')}
  </div>
  ${document.salutation ? `<p class="salutation">${esc(document.salutation)}</p>` : ''}
  ${document.intro ? `<p class="intro">${esc(fillPlaceholders(document.intro, context))}</p>` : ''}

  <table class="items">
    <thead>
      <tr>
        <th class="num" style="width:8mm">Pos</th>
        <th>Bezeichnung</th>
        <th class="num" style="width:22mm">Menge</th>
        <th class="num" style="width:24mm">Einzelpreis</th>
        <th class="num" style="width:14mm">USt</th>
        <th class="num" style="width:26mm">Betrag</th>
      </tr>
    </thead>
    <tbody>${itemRows(sums.lines)}</tbody>
  </table>

  <div class="totals">
    <table>
      <tr class="subtotal"><td>Nettobetrag</td><td class="num">${formatAmount(sums.netTotal)}</td></tr>
      ${vatRowsHtml(sums)}
      <tr class="total"><td>${esc(totalLabelFor(type, offer))}</td><td class="num">${formatAmount(sums.grossTotal)} €</td></tr>
      ${paidRow}
    </table>
  </div>

  ${hints}
  ${document.bodyText ? `<p class="body-text">${esc(fillPlaceholders(document.bodyText, context))}</p>` : ''}
  ${document.outro ? `<p class="outro">${esc(fillPlaceholders(document.outro, context))}</p>` : ''}
  ${signatureBlock(company)}
  ${acceptance}
  ${theme.footerNote ? `<p class="footer-note">${esc(theme.footerNote)}</p>` : ''}

  ${footerHtml(company, Boolean(theme.footerIcons))}`;

  return page(`${title} ${document.number ?? ''}`, css, body);
}

/** What a reminder carries beyond the calculated figures. */
export type ReminderLetter = PreparedReminder & {
  salutation?: string;
  intro?: string;
  outro?: string;
};

function reminderExtras(reminder: ReminderLetter): string {
  const rows: string[] = [];

  if (reminder.interest && reminder.interest.amount > 0) {
    const label = `Verzugszinsen, ${formatQuantity(reminder.interest.rate)} Prozent für ${reminder.interest.days} Tage ab ${formatDate(reminder.interest.since)}`;
    rows.push(`<tr><td>${esc(label)}</td><td class="num">${formatAmount(reminder.interest.amount)}</td></tr>`);
  }
  if (reminder.flatFee > 0) {
    rows.push(`<tr><td>Pauschale nach §288 Abs. 5 BGB</td><td class="num">${formatAmount(reminder.flatFee)}</td></tr>`);
  }
  if (reminder.fee > 0) {
    rows.push(`<tr><td>Mahngebühr</td><td class="num">${formatAmount(reminder.fee)}</td></tr>`);
  }

  return rows.join('');
}

/**
 * A reminder.
 *
 * A different job from an invoice, so a layout of its own: instead of line
 * items it shows the open claim with its age, below that interest and the flat
 * fee, and at the end the sum.
 *
 * Head, footer and styling come from the same source as every other document,
 * so a reminder does not look like it came from a stranger.
 *
 * No invoice number of its own: a reminder is no tax document and demands
 * nothing new, it chases what is already there.
 */
export function renderReminder(
  reminder: ReminderLetter,
  invoice: BusinessDocument,
  company: DocumentCompany,
  customer: Customer,
  options: RenderOptions = {}
): string {
  const theme = options.theme ?? {};
  const css = buildCss(theme, { preview: Boolean(options.preview) });
  const sums = totals(invoice);

  const rows: InfoRow[] = [
    ['Rechnungsnummer', invoice.number],
    ['Rechnungsdatum', formatDate(invoice.issueDate)],
    ['Fällig war', formatDate(invoice.dueDate)],
    ['Überfällig seit', `${reminder.overdueDays} Tagen`],
    ...(customer.customerNumber ? [['Kundennummer', customer.customerNumber] as InfoRow] : []),
    ...(company.taxNumber ? [['Steuernummer', company.taxNumber] as InfoRow] : [])
  ];

  // The reminder text names the deadline. Below it stands where the money
  // should go: without an account and a reference the sharpest reminder is of
  // no use.
  const payment = company.iban
    ? `Bitte überweise ${formatAmount(reminder.total)} € bis zum ${formatDate(reminder.deadline)} `
      + `auf das Konto ${company.iban} unter Angabe der Nummer ${invoice.number ?? ''}.`
    : '';

  // No QR code on a reminder: the amount due there is the claim plus interest
  // plus the flat fee, not the open invoice total. A GiroCode with the wrong
  // sum would be worse than none.
  const body = `  ${headHtml(company, false)}

  ${addressAreaHtml(company, customer, rows)}

  <h1>${esc(reminder.levelLabel)}</h1>
  ${reminder.salutation ? `<p class="salutation">${esc(reminder.salutation)}</p>` : ''}
  ${reminder.intro ? `<p class="intro">${esc(reminder.intro)}</p>` : ''}
  ${reminder.bodyText ? `<p class="body-text">${esc(reminder.bodyText)}</p>` : ''}

  <table class="items">
    <thead>
      <tr>
        <th>Vorgang</th>
        <th class="num" style="width:24mm">Datum</th>
        <th class="num" style="width:24mm">Fällig</th>
        <th class="num" style="width:20mm">Tage</th>
        <th class="num" style="width:26mm">Betrag</th>
        <th class="num" style="width:26mm">Offen</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(`Rechnung ${invoice.number ?? ''}`)}</td>
        <td class="num">${formatDate(invoice.issueDate)}</td>
        <td class="num">${formatDate(invoice.dueDate)}</td>
        <td class="num">${reminder.overdueDays}</td>
        <td class="num">${formatAmount(sums.grossTotal)}</td>
        <td class="num">${formatAmount(reminder.open)}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    <table>
      <tr class="subtotal"><td>Offener Rechnungsbetrag</td><td class="num">${formatAmount(reminder.open)}</td></tr>
      ${reminderExtras(reminder)}
      <tr class="total"><td>Zu zahlen</td><td class="num">${formatAmount(reminder.total)} €</td></tr>
    </table>
  </div>

  ${payment ? `<p class="body-text">${esc(payment)}</p>` : ''}
  ${reminder.outro ? `<p class="outro">${esc(reminder.outro)}</p>` : ''}

  ${footerHtml(company, Boolean(theme.footerIcons))}`;

  return page(`${reminder.levelLabel} ${invoice.number ?? ''}`, css, body);
}
