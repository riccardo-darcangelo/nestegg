// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { escapeText as esc } from './xml';
import { formatAmount } from '../domain/money';
import { TYPES, type DonationType, type prepare } from '../domain/donations';
import type { IsoDate } from '../shared/types';

/**
 * The donation receipt on the official form (EStDV 50).
 *
 * Layout and wording follow the template of the federal finance ministry. That
 * is not a design question: under EStDV 50 (1) using the official template is
 * what lets the donor deduct the donation at all. Deviations in the wording put
 * exactly that at risk.
 *
 * So the order of the statements and the notes at the end are fixed. Only what
 * the template leaves open can be styled: paper size, type and the letterhead.
 */

const CSS = `
  @page { size: A4; margin: 20mm 20mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 10.5pt; line-height: 1.5; color: #14171c; margin: 0; background: #fff;
  }
  .issuer { font-size: 9.5pt; line-height: 1.4; margin-bottom: 12mm; }
  .issuer strong { font-size: 11pt; }
  h1 { font-size: 13pt; margin: 0 0 3mm; line-height: 1.35; }
  .sub { font-size: 9.5pt; color: #4a515c; margin-bottom: 8mm; }
  .donor { margin: 6mm 0 8mm; }
  .donor .label { font-size: 9pt; color: #4a515c; margin-bottom: 1mm; }
  table { width: 100%; border-collapse: collapse; margin: 4mm 0 6mm; }
  th, td { text-align: left; padding: 2mm 3mm; border-bottom: 0.4pt solid #ccd2db; font-size: 10pt; }
  th { background: #f2f4f8; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.sum td { border-top: 0.8pt solid #14171c; border-bottom: none; font-weight: 700; }
  .amount-box {
    border: 0.8pt solid #14171c; padding: 3mm 4mm; margin: 5mm 0 6mm;
    display: flex; justify-content: space-between; gap: 6mm;
  }
  .amount-box .value { font-size: 13pt; font-weight: 700; font-variant-numeric: tabular-nums; }
  .amount-box .words { font-size: 9.5pt; color: #4a515c; max-width: 95mm; text-align: right; }
  .statement { margin: 5mm 0; }
  .check { margin: 3mm 0; font-size: 10pt; }
  .hint {
    font-size: 8.5pt; line-height: 1.45; color: #4a515c;
    border-top: 0.4pt solid #ccd2db; padding-top: 3mm; margin-top: 8mm;
  }
  .sign { margin-top: 14mm; display: flex; gap: 20mm; }
  .sign div { flex: 1; border-top: 0.4pt solid #14171c; padding-top: 2mm; font-size: 9pt; }
  .gap { background: #fff3d0; padding: 0 2px; font-style: italic; }
`;

/** Marks a missing entry instead of leaving a silent hole in the form. */
function orGap(value: unknown, hint: string): string {
  const text = String(value ?? '').trim();
  return text ? esc(text) : `<span class="gap">${esc(hint)}</span>`;
}

function formatDate(iso: IsoDate | null | undefined): string {
  if (!iso) return '';
  const [year, month, day] = String(iso).slice(0, 10).split('-');
  return `${day}.${month}.${year}`;
}

/** Builds the receipt from what donations.prepare put together. */
export function build(receipt: ReturnType<typeof prepare>): string {
  const type = TYPES[receipt.type] ?? TYPES.money;
  const collective = receipt.collective;
  const isKind = receipt.type === 'kind';

  const title = collective
    ? `Sammelbestätigung über ${isKind ? 'Sachzuwendungen' : 'Geldzuwendungen'}`
    : type.title;

  const rows = receipt.entries.map((entry) => `<tr>
      <td>${formatDate(entry.date)}</td>
      <td>${esc(entry.description || '')}${entry.note ? `<br><span style="font-size:9pt;color:#4a515c">${esc(entry.note)}</span>` : ''}</td>
      <td>${esc((TYPES[entry.type as DonationType] ?? TYPES.money).label)}</td>
      <td class="num">${formatAmount(entry.amount)} €</td>
    </tr>`).join('');

  // The official template distinguishes how the tax notice is named.
  const noticeName = receipt.notice.type === 'anlage'
    ? 'nach der Anlage zum Körperschaftsteuerbescheid'
    : 'nach dem Freistellungsbescheid';

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${esc(title)} ${esc(receipt.donor.name)}</title>
<style>${CSS}</style>
</head>
<body>

<div class="issuer">
  <strong>${orGap(receipt.issuer.name, 'Name des Vereins')}</strong><br>
  ${orGap(receipt.issuer.street, 'Straße')}<br>
  ${orGap([receipt.issuer.zip, receipt.issuer.city].filter(Boolean).join(' '), 'PLZ und Ort')}
</div>

<h1>${esc(title)}</h1>
<div class="sub">
  ${isKind ? 'Sachzuwendungen' : 'Geldzuwendungen und Mitgliedsbeiträge'} im Sinne des § 10b des
  Einkommensteuergesetzes an eine der in § 5 Absatz 1 Nummer 9 des Körperschaftsteuergesetzes
  bezeichneten Körperschaften, Personenvereinigungen oder Vermögensmassen
</div>

<div class="donor">
  <div class="label">Name und Anschrift des Zuwendenden</div>
  <strong>${orGap(receipt.donor.name, 'Name fehlt')}</strong><br>
  ${orGap(receipt.donor.street, 'Straße fehlt')}<br>
  ${orGap([receipt.donor.zip, receipt.donor.city].filter(Boolean).join(' '), 'PLZ und Ort fehlen')}
</div>

${collective ? `
<p class="statement">
  Es wird bestätigt, dass die nachstehend aufgeführten Zuwendungen im Zeitraum vom
  01.01.${esc(receipt.year)} bis 31.12.${esc(receipt.year)} eingegangen sind und dass über
  diese Zuwendungen keine weiteren Bestätigungen, weder formelle Zuwendungsbestätigungen
  noch Beitragsquittungen oder Ähnliches, ausgestellt wurden.
</p>` : ''}

<table>
  <thead>
    <tr>
      <th style="width:26mm">Tag der Zuwendung</th>
      <th>Bezeichnung</th>
      <th style="width:34mm">Art</th>
      <th class="num" style="width:30mm">Betrag</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
    ${receipt.entries.length > 1 ? `<tr class="sum"><td colspan="3">Summe</td><td class="num">${formatAmount(receipt.total)} €</td></tr>` : ''}
  </tbody>
</table>

<div class="amount-box">
  <div>
    <div style="font-size:9pt;color:#4a515c">Betrag der Zuwendung</div>
    <div class="value">${formatAmount(receipt.total)} €</div>
  </div>
  <div class="words">
    in Buchstaben:<br><strong>${esc(receipt.totalInWords)}</strong>
  </div>
</div>

<div class="check">
  Es handelt sich um den Verzicht auf Erstattung von Aufwendungen:
  <strong>${receipt.waiver ? 'Ja' : 'Nein'}</strong>
</div>

${isKind ? `
<p class="statement">
  Geeignete Unterlagen, die zur Wertermittlung gedient haben, liegen dem Zuwendungsempfänger
  vor. Die Sachzuwendung stammt <span class="gap">nach den Angaben des Zuwendenden aus dem
  Betriebsvermögen / dem Privatvermögen</span>.
</p>` : ''}

<p class="statement">
  Wir sind wegen Förderung ${orGap(receipt.notice.purpose, 'begünstigter Zweck')}
  ${esc(noticeName)} des Finanzamts ${orGap(receipt.notice.office, 'Finanzamt')},
  StNr. ${orGap(receipt.issuer.taxNumber, 'Steuernummer')},
  vom ${orGap(formatDate(receipt.notice.date), 'Datum des Bescheids')}
  ${receipt.notice.year ? `für den letzten Veranlagungszeitraum ${esc(receipt.notice.year)} ` : ''}
  nach § 5 Absatz 1 Nummer 9 des Körperschaftsteuergesetzes von der Körperschaftsteuer und
  nach § 3 Nummer 6 des Gewerbesteuergesetzes von der Gewerbesteuer befreit.
</p>

<p class="statement">
  Es wird bestätigt, dass die Zuwendung nur zur Förderung
  ${orGap(receipt.notice.purpose, 'begünstigter Zweck')} verwendet wird.
</p>

<div class="sign">
  <div>
    ${orGap([receipt.issuer.city, formatDate(receipt.date)].filter(Boolean).join(', '), 'Ort, Datum')}
  </div>
  <div>
    ${orGap(receipt.board.name, 'Name')}, ${esc(receipt.board.role)}<br>
    <span style="font-size:8.5pt;color:#4a515c">Unterschrift des Zuwendungsempfängers</span>
  </div>
</div>

<div class="hint">
  <strong>Hinweis:</strong> Wer vorsätzlich oder grob fahrlässig eine unrichtige
  Zuwendungsbestätigung erstellt oder wer veranlasst, dass Zuwendungen nicht zu den in der
  Zuwendungsbestätigung angegebenen steuerbegünstigten Zwecken verwendet werden, haftet für
  die entgangene Steuer (§ 10b Absatz 4 EStG, § 9 Absatz 3 KStG, § 9 Nummer 5 GewStG).
  <br><br>
  Diese Bestätigung wird nicht als Nachweis für die steuerliche Berücksichtigung der Zuwendung
  anerkannt, wenn das Datum des Freistellungsbescheides länger als 5 Jahre bzw. das Datum der
  Feststellung der Einhaltung der satzungsmäßigen Voraussetzungen nach § 60a Absatz 1 AO
  länger als 3 Jahre seit Ausstellung des Bescheides zurückliegt (§ 63 Absatz 5 AO).
</div>

</body>
</html>`;
}
