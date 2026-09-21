// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { escapeText as esc } from './xml';
import { formatAmount } from '../domain/money';
import { formatCreditorId, type SepaSettings } from '../domain/sepa';
import type { Cents, Company, Entity, IsoDate } from '../shared/types';

/**
 * The pre-notification of a SEPA direct debit, as a mail merge.
 *
 * Before every collection the payer has to know when which amount leaves their
 * account. That is no courtesy but part of the rulebook: waiving it entirely
 * cannot even be agreed, and without the notice a member can object to the
 * charge although the mandate is valid.
 *
 * Where the amounts stay the same one letter covers the whole year, as long as
 * it names every amount and every due date. That is the normal case in an
 * association, and this letter is built for it: one sheet per member carrying
 * the complete dues plan of the year.
 *
 * All amounts in cents.
 */

const CSS = `
  @page { size: A4; margin: 20mm 20mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 10.5pt; line-height: 1.5; color: #14171c; margin: 0; background: #fff;
  }
  .letter { page-break-after: always; }
  .letter:last-child { page-break-after: auto; }

  /* A mail merge goes into a window envelope, so the address sits at the
     standard place: 45 mm from the top edge. The letterhead gets a fixed
     height for that, otherwise a long association name pushes the address
     out of the window. */
  .head { height: 25mm; display: flex; align-items: flex-start; justify-content: space-between; gap: 10mm; }
  .head .org { font-size: 12pt; font-weight: 600; }
  .head .contact { font-size: 8.5pt; color: #4a515c; text-align: right; line-height: 1.4; }

  .address-area { display: flex; justify-content: space-between; gap: 10mm; }
  /* 35 mm is enough: for the window only where the address starts counts,
     not how far the field below it reaches. */
  .address-block { width: 85mm; min-height: 35mm; }
  .sender { font-size: 7.5pt; color: #4a515c; border-bottom: 0.4pt solid #8b93a1; padding-bottom: 1mm; margin-bottom: 2mm; }
  .address { font-size: 11pt; line-height: 1.45; }
  .meta { width: 70mm; text-align: right; font-size: 9.5pt; color: #4a515c; }
  h1 { font-size: 12.5pt; margin: 0 0 4mm; }
  p { margin: 0 0 3mm; }

  /* With many dates two tables stand side by side. A monthly contribution
     has twelve due dates, and stacked they push the letter onto a second
     sheet: with a mail merge that is exactly where enveloping goes wrong. */
  .periods { display: flex; gap: 6mm; align-items: flex-start; }
  .periods > table { flex: 1; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0 4mm; }
  th, td { text-align: left; padding: 1.6mm 3mm; border-bottom: 0.4pt solid #d8dce4; font-size: 10pt; }
  .periods table { font-size: 9.5pt; }
  .periods th, .periods td { padding: 1.3mm 2mm; }
  .total { display: flex; justify-content: space-between; font-weight: 700;
    border-top: 0.8pt solid #14171c; padding: 1.8mm 3mm 0; margin: 0 0 4mm;
    font-variant-numeric: tabular-nums; }
  th { background: #f2f4f8; font-weight: 600; font-size: 9.5pt; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.sum td { border-top: 0.8pt solid #14171c; border-bottom: none; font-weight: 700; }

  .mandate {
    border: 0.5pt solid #c9ced8; background: #fafbfd;
    padding: 2.5mm 3.5mm; margin: 4mm 0; font-size: 9.5pt;
  }
  .mandate dl { display: grid; grid-template-columns: 52mm 1fr; gap: 1.2mm 4mm; margin: 0; }
  .mandate dt { color: #4a515c; }
  .mandate dd { margin: 0; font-variant-numeric: tabular-nums; }
  .hint { font-size: 8.5pt; line-height: 1.4; color: #4a515c; border-top: 0.4pt solid #d8dce4; padding-top: 2.5mm; margin-top: 6mm; }
  .sign { margin-top: 8mm; font-size: 10pt; }
`;

function formatDate(iso: IsoDate | null | undefined): string {
  if (!iso) return '';
  const [year, month, day] = String(iso).split('-');
  return `${day}.${month}.${year}`;
}

/**
 * The IBAN, shortened.
 *
 * A letter that can go astray in the post has no business carrying the full
 * account number. Start and end are enough for the recipient to recognise it.
 */
export function maskIban(iban: string | null | undefined): string {
  const clean = String(iban ?? '').replace(/\s/g, '');
  if (clean.length < 12) return clean;
  return `${clean.slice(0, 4)} ${clean.slice(4, 8)} •••• •••• ${clean.slice(-4)}`;
}

/** The salutation: personal where the name is known. */
export function salutationFor(member: { name?: string }, fallback?: string): string {
  if (fallback) return fallback;
  return member.name ? `Guten Tag ${member.name},` : 'Guten Tag,';
}

/** One due date on the plan. */
export interface DuePeriod {
  label: string;
  date: IsoDate;
  amount: Cents;
}

/** What a debit needs to know about the member it is addressed to. */
export interface NotifiedMember {
  name?: string;
  number?: string;
  street?: string;
  zip?: string;
  city?: string;
  iban?: string;
  mandateRef?: string;
  mandateDate?: IsoDate | null;
}

export interface LetterItem {
  member: NotifiedMember;
  periods: DuePeriod[];
}

interface LetterOptions {
  company: Company;
  sepa: SepaSettings;
  year: number | string;
  date: IsoDate;
  salutation?: string | undefined;
  boardName?: string | undefined;
}

function letter(item: LetterItem, options: LetterOptions): string {
  const { company, sepa, year } = options;
  const member = item.member;
  const rows = item.periods;
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const senderLine = [company.name, company.street, [company.zip, company.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(' · ');

  const addressLines = [
    member.name,
    member.street,
    [member.zip, member.city].filter(Boolean).join(' ')
  ].filter(Boolean).map((line) => esc(line)).join('<br>');

  const rowHtml = (row: DuePeriod) => `
    <tr>
      <td>${esc(row.label)}</td>
      <td>${esc(formatDate(row.date))}</td>
      <td class="num">${esc(formatAmount(row.amount))} €</td>
    </tr>`;

  const periodTable = (list: DuePeriod[]) => `
    <table>
      <thead>
        <tr><th>Zeitraum</th><th>Fällig am</th><th class="num">Betrag</th></tr>
      </thead>
      <tbody>${list.map(rowHtml).join('')}</tbody>
    </table>`;

  // From seven dates on it breaks into columns, so the letter stays one page.
  const periodsHtml = rows.length > 6
    ? `<div class="periods">
        ${periodTable(rows.slice(0, Math.ceil(rows.length / 2)))}
        ${periodTable(rows.slice(Math.ceil(rows.length / 2)))}
      </div>`
    : periodTable(rows);

  // The sentence about the deadline follows the setting: the default is 14
  // calendar days, and shorter only by agreement.
  const notice = sepa.preNotificationDays === 14
    ? 'Die Ankündigung erfolgt mindestens 14 Kalendertage vor dem jeweiligen Einzug.'
    : `Nach unserer Satzung beträgt die Frist für diese Ankündigung ${sepa.preNotificationDays} Kalendertage vor dem jeweiligen Einzug.`;

  const contact = [company.email, company.phone].filter(Boolean).map((line) => esc(line)).join('<br>');

  return `
  <section class="letter">
    <div class="head">
      <div class="org">${esc(company.name)}</div>
      ${contact ? `<div class="contact">${contact}</div>` : ''}
    </div>

    <div class="address-area">
      <div class="address-block">
        <div class="sender">${esc(senderLine)}</div>
        <div class="address">${addressLines}</div>
      </div>
      <div class="meta">
        ${esc([company.zip, company.city].filter(Boolean).join(' '))}${company.city ? ', den ' : ''}${esc(formatDate(options.date))}
      </div>
    </div>

    <h1>Vorabankündigung zum Einzug des Mitgliedsbeitrags ${esc(year)}</h1>

    <p>${esc(salutationFor(member, options.salutation))}</p>

    <p>
      wir ziehen ${rows.length === 1 ? 'den folgenden Betrag' : 'die folgenden Beträge'}
      mit dem SEPA-Lastschriftverfahren von Ihrem Konto ein.
      ${rows.length === 1 ? 'Der Termin ist' : 'Die Termine sind'} hier aufgeführt,
      eine weitere Ankündigung erfolgt dazu nicht.
    </p>

    ${periodsHtml}
    ${rows.length > 1 ? `<div class="total"><span>Gesamt ${esc(year)}</span><span>${esc(formatAmount(total))} €</span></div>` : ''}

    <div class="mandate">
      <dl>
        <dt>Gläubiger-Identifikationsnummer</dt>
        <dd>${esc(formatCreditorId(sepa.creditorId))}</dd>
        <dt>Mandatsreferenz</dt>
        <dd>${esc(member.mandateRef || '')}</dd>
        <dt>Ihr Konto</dt>
        <dd>${esc(maskIban(member.iban))}</dd>
        ${member.number ? `<dt>Mitgliedsnummer</dt><dd>${esc(member.number)}</dd>` : ''}
      </dl>
    </div>

    <p>
      Bitte sorgen Sie für ausreichende Deckung auf Ihrem Konto. Fällt der
      Termin auf einen Samstag, Sonntag oder Feiertag, erfolgt der Einzug am
      nächsten Bankarbeitstag.
    </p>

    <div class="sign">
      Mit freundlichen Grüßen<br><br>
      ${esc(company.name)}${options.boardName ? `<br>${esc(options.boardName)}` : ''}
    </div>

    <div class="hint">
      ${esc(notice)}
      Sie können die Erstattung des belasteten Betrags verlangen. Es gelten
      dabei die mit Ihrem Kreditinstitut vereinbarten Bedingungen; die Frist
      beträgt acht Wochen ab dem Tag der Belastung.
      ${member.mandateDate ? `Ihr Mandat trägt das Datum ${esc(formatDate(member.mandateDate))}.` : ''}
    </div>
  </section>`;
}

export interface MailMerge {
  items: readonly LetterItem[];
  company: Company;
  sepa: SepaSettings;
  entity?: Entity | null;
  year: number | string;
  date: IsoDate;
  salutation?: string;
}

/**
 * Builds the mail merge.
 *
 * One sheet per member in one file: that way it prints and envelopes in a
 * single pass instead of producing every notice on its own.
 */
export function build({ items, company, sepa, entity, year, date, salutation }: MailMerge): string {
  const letters = (items ?? []).map((item) => letter(item, {
    company, sepa, year, date, salutation,
    boardName: entity?.boardName ?? ''
  })).join('\n');

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Vorabankündigung Mitgliedsbeitrag ${esc(year)}</title>
<style>${CSS}</style>
</head>
<body>
${letters}
</body>
</html>`;
}
