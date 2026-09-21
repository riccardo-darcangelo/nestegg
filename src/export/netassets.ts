// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { escapeText as esc } from './xml';
import { formatAmount } from '../domain/money';
import type { netAssets, overview, useOfFunds } from '../domain/reserves';
import type { calculate } from '../domain/spheres';
import type { Cents, Company, IsoDate } from '../shared/types';

/**
 * The statement of assets and the use of funds, as a document.
 *
 * A charitable association accounts for how it actually ran its affairs under
 * AO 63 (3). Besides the income and expenditure account that includes showing
 * where the funds sit that were not spent: exactly what the tax office asks
 * for in the Anlage Gem.
 *
 * The sheet is therefore built so it can be attached to the return and put
 * before the general meeting without being retyped.
 */

const CSS = `
  @page { size: A4; margin: 20mm 20mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 10.5pt; line-height: 1.5; color: #14171c; margin: 0; background: #fff;
  }
  h1 { font-size: 17pt; margin: 0 0 2mm; }
  h2 {
    font-size: 12pt; margin: 9mm 0 3mm; padding-bottom: 1.5mm;
    border-bottom: 0.5pt solid #c9ced8; page-break-after: avoid;
  }
  .sub { color: #4a515c; font-size: 9.5pt; margin-bottom: 7mm; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; }
  th, td { text-align: left; padding: 1.8mm 3mm; border-bottom: 0.4pt solid #d8dce4; font-size: 10pt; }
  th { background: #f2f4f8; font-weight: 600; font-size: 9.5pt; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.sum td { border-top: 0.8pt solid #14171c; border-bottom: none; font-weight: 700; }
  tr.group td { background: #fafbfd; font-weight: 600; }
  td.law { color: #6b7280; font-size: 8.5pt; }
  .two { display: flex; gap: 8mm; }
  .two > div { flex: 1; }
  .note {
    background: #f1f5fb; border-left: 2pt solid #5b7fb8;
    padding: 3mm 4mm; margin: 4mm 0; font-size: 9pt; line-height: 1.45;
  }
  .warn { background: #fff6e8; border-left-color: #d08a2a; }
  .sign { margin-top: 12mm; display: flex; gap: 20mm; }
  .sign div { flex: 1; border-top: 0.4pt solid #14171c; padding-top: 2mm; font-size: 9pt; }
  .foot { margin-top: 8mm; padding-top: 3mm; border-top: 0.4pt solid #d8dce4; font-size: 8.5pt; color: #4a515c; }
`;

function money(cents: Cents): string {
  return `${formatAmount(cents)} €`;
}

function formatDate(iso: IsoDate | null | undefined): string {
  const [year, month, day] = String(iso ?? '').split('-');
  return day ? `${day}.${month}.${year}` : String(iso ?? '');
}

/** A label and an amount, with an optional line of legal detail below. */
function row(label: string, value: Cents, extra = ''): string {
  return `<tr><td>${esc(label)}${extra ? `<div class="law">${esc(extra)}</div>` : ''}</td><td class="num">${money(value)}</td></tr>`;
}

export interface NetAssetsDocument {
  assets: ReturnType<typeof netAssets>;
  useOfFunds: ReturnType<typeof useOfFunds>;
  reserves: ReturnType<typeof overview>;
  spheres: ReturnType<typeof calculate>;
  company: Company;
  entity?: unknown;
  date: IsoDate;
}

export function build(payload: NetAssetsDocument): string {
  const { assets, useOfFunds, reserves, spheres, company, date } = payload;

  const assetRows = (assets.assets.items || [])
    .map((item) => `<tr><td>${esc(item.name)}<div class="law">angeschafft am ${formatDate(item.purchaseDate)}</div></td><td class="num">${money(item.bookValue)}</td></tr>`)
    .join('');

  const reserveRows = (assets.liabilities.reserves || [])
    .map((item) => `<tr><td>${esc(item.label)}<div class="law">${esc(item.typeLabel)}, ${esc(item.law)}</div></td><td class="num">${money(item.balance)}</td></tr>`)
    .join('');

  const sphereRows = (spheres.spheres || [])
    .map((sphere) => `<tr>
      <td>${esc(sphere.label)}</td>
      <td class="num">${money(sphere.income)}</td>
      <td class="num">${money(sphere.expense)}</td>
      <td class="num">${money(sphere.result)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Vermögensübersicht ${esc(company.name || '')} ${esc(assets.year)}</title>
<style>${CSS}</style>
</head>
<body>

<h1>Vermögensübersicht und Mittelverwendung</h1>
<div class="sub">
  ${esc(company.name || '')}${company.city ? `, ${esc(company.city)}` : ''}
  &middot; Stichtag ${formatDate(date)}
</div>

<h2>1. Einnahmen und Ausgaben nach Sphären</h2>
<table>
  <thead>
    <tr>
      <th>Bereich</th>
      <th class="num" style="width:32mm">Einnahmen</th>
      <th class="num" style="width:32mm">Ausgaben</th>
      <th class="num" style="width:32mm">Ergebnis</th>
    </tr>
  </thead>
  <tbody>
    ${sphereRows}
    <tr class="sum">
      <td>Zusammen</td>
      <td class="num">${money(spheres.totals.income)}</td>
      <td class="num">${money(spheres.totals.expense)}</td>
      <td class="num">${money(spheres.totals.result)}</td>
    </tr>
  </tbody>
</table>

<h2>2. Vermögensübersicht zum ${formatDate(date)}</h2>
<div class="two">
  <div>
    <table>
      <thead><tr><th>Aktiva</th><th class="num" style="width:32mm">Betrag</th></tr></thead>
      <tbody>
        ${row('Bank und Kasse', assets.assets.liquid)}
        ${row('Forderungen aus Rechnungen', assets.assets.receivables)}
        <tr class="group"><td>Anlagevermögen</td><td class="num">${money(assets.assets.fixedAssets)}</td></tr>
        ${assetRows}
        <tr class="sum"><td>Summe Aktiva</td><td class="num">${money(assets.assets.total)}</td></tr>
      </tbody>
    </table>
  </div>
  <div>
    <table>
      <thead><tr><th>Passiva</th><th class="num" style="width:32mm">Betrag</th></tr></thead>
      <tbody>
        ${row('Verbindlichkeiten', assets.liabilities.payables)}
        <tr class="group"><td>Rücklagen nach § 62 AO</td><td class="num">${money(assets.liabilities.reservesTotal)}</td></tr>
        ${reserveRows || '<tr><td class="law">keine Rücklagen gebildet</td><td class="num">0,00 €</td></tr>'}
        ${row('Vereinsvermögen', assets.equity)}
        <tr class="sum"><td>Summe Passiva</td><td class="num">${money(assets.assets.total)}</td></tr>
      </tbody>
    </table>
  </div>
</div>

${assets.hasOpeningBalance ? '' : `<div class="note warn">
  Für dieses Profil ist kein Anfangsbestand der Geldkonten hinterlegt. Die Zeile
  "Bank und Kasse" zeigt daher nur die Bewegungen des Zeitraums, nicht den
  tatsächlichen Bestand. Der Stand gehört in die Einstellungen unter Rücklage
  und Vorschau.
</div>`}

<h2>3. Mittelverwendung</h2>
<table>
  <tbody>
    ${row('Zeitnah zu verwendende Mittel des Jahres', useOfFunds.inflow, 'Einnahmen ideeller Bereich, Überschüsse der übrigen Bereiche')}
    ${row('davon für satzungsmäßige Zwecke verwendet', useOfFunds.used)}
    ${row('in Rücklagen eingestellt', useOfFunds.toReserves)}
    ${row('aus Rücklagen entnommen', useOfFunds.fromReserves ? -useOfFunds.fromReserves : 0)}
    <tr class="sum">
      <td>Noch zu verwenden</td>
      <td class="num">${money(useOfFunds.remaining)}</td>
    </tr>
  </tbody>
</table>

<div class="note${useOfFunds.remaining > 0 && useOfFunds.applies ? ' warn' : ''}">
  ${esc(useOfFunds.note)}
</div>

<h2>4. Freie Rücklage nach § 62 Abs. 1 Nr. 3 AO</h2>
<table>
  <tbody>
    ${row('Überschuss aus der Vermögensverwaltung', reserves.free.assetSurplus)}
    ${row('davon ein Drittel', reserves.free.third)}
    ${row('Sonstige zeitnah zu verwendende Mittel', reserves.free.otherMeans, 'Bruttoeinnahmen ideeller Bereich, Gewinne aus Zweckbetrieb und wirtschaftlichem Geschäftsbetrieb')}
    ${row('davon zehn Prozent', reserves.free.tenth)}
    <tr class="sum"><td>Höchstbetrag des Jahres</td><td class="num">${money(reserves.free.limit)}</td></tr>
    ${reserves.free.carryTotal ? row('Nicht ausgeschöpft aus den beiden Vorjahren', reserves.free.carryTotal) : ''}
    ${reserves.free.carryTotal ? `<tr class="sum"><td>Insgesamt verfügbar</td><td class="num">${money(reserves.free.available)}</td></tr>` : ''}
    ${row('Tatsächlich zugeführt', reserves.free.used)}
  </tbody>
</table>

${reserves.warnings.length ? `<div class="note warn">
  ${reserves.warnings.map((warning) => `&bull; ${esc(warning)}`).join('<br>')}
</div>` : ''}

<div class="sign">
  <div>${esc(company.city || '')}, ${formatDate(date)}</div>
  <div>Unterschrift des Vorstands</div>
</div>

<div class="foot">
  Erstellt mit NestEgg am ${formatDate(date)}. Die Aufstellung folgt den
  Aufzeichnungen der Buchhaltung und ersetzt keine steuerliche Beratung.
</div>

</body>
</html>`;
}
