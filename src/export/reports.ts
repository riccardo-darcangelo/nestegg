// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import ExcelJS from 'exceljs';

import { taxEffect } from '../domain/entries';
import { getCategory } from '../domain/categories';
import * as euer from '../domain/euer';
import * as vat from '../domain/vat';
import * as assets from '../domain/assets';
import { totals, resolveStatus, STATUS } from '../domain/invoices';
import type { Cents, Snapshot } from '../shared/types';

/**
 * The yearly export for the tax advisor.
 *
 * One workbook with every sheet the year end needs: the cash basis profit
 * statement, the full journal, the VAT returns, the asset register and the
 * invoice overview. Amounts sit in the cells as numbers rather than text, so
 * they can be calculated with.
 */

const MONEY_FORMAT = '#,##0.00 "€"';
const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2933' }
};

function euros(cents: Cents): number {
  return (Number(cents) || 0) / 100;
}

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle' };
  });
  row.height = 20;
}

function autoWidth(sheet: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
}

function sheetEuer(workbook: ExcelJS.Workbook, data: Snapshot, year: number): void {
  const result = euer.calculate(data.entries, data.assets, year);
  const sheet = workbook.addWorksheet(`EÜR ${year}`);

  sheet.addRow([`Einnahmenüberschussrechnung ${year}`]).font = { bold: true, size: 14 };
  sheet.addRow([`${data.settings.company.name || 'Ohne Firmenangabe'}`]);
  sheet.addRow(['Gerechnet nach dem Zu- und Abflussprinzip, §4 Abs. 3 EStG. Beträge in Euro.']);
  sheet.addRow([]);

  styleHeader(sheet.addRow(['Betriebseinnahmen', 'Betrag']));
  for (const row of result.income) {
    const r = sheet.addRow([row.position, euros(row.amount)]);
    r.getCell(2).numFmt = MONEY_FORMAT;
  }
  const incomeTotal = sheet.addRow(['Summe Betriebseinnahmen', euros(result.incomeTotal)]);
  incomeTotal.font = { bold: true };
  incomeTotal.getCell(2).numFmt = MONEY_FORMAT;

  sheet.addRow([]);
  styleHeader(sheet.addRow(['Betriebsausgaben', 'Betrag']));
  for (const row of result.expense) {
    const r = sheet.addRow([row.position, euros(row.amount)]);
    r.getCell(2).numFmt = MONEY_FORMAT;
  }
  const expenseTotal = sheet.addRow(['Summe Betriebsausgaben', euros(result.expenseTotal)]);
  expenseTotal.font = { bold: true };
  expenseTotal.getCell(2).numFmt = MONEY_FORMAT;

  sheet.addRow([]);
  const profit = sheet.addRow(['Gewinn oder Verlust', euros(result.profit)]);
  profit.font = { bold: true, size: 12 };
  profit.getCell(2).numFmt = MONEY_FORMAT;

  if (result.open.income || result.open.expense) {
    sheet.addRow([]);
    sheet.addRow(['Nicht enthalten, weil noch nicht bezahlt:']);
    const a = sheet.addRow(['Offene Einnahmen', euros(result.open.income)]);
    a.getCell(2).numFmt = MONEY_FORMAT;
    const b = sheet.addRow(['Offene Ausgaben', euros(result.open.expense)]);
    b.getCell(2).numFmt = MONEY_FORMAT;
  }

  autoWidth(sheet, [62, 18]);
}

function sheetJournal(workbook: ExcelJS.Workbook, data: Snapshot, year: number): void {
  const sheet = workbook.addWorksheet(`Buchungen ${year}`);
  styleHeader(sheet.addRow([
    'Belegdatum', 'Zahlung', 'Art', 'Kategorie', 'Gegenpartei', 'Verwendungszweck',
    'Brutto', 'Netto', 'USt-Satz', 'USt', 'Vorsteuer', 'Wirkt in EÜR', 'Zahlungsart', 'Beleg'
  ]));

  const rows = data.entries
    .filter((e) => {
      const y = euer.taxYearOf(e);
      return y === year || (y === null && String(e.date).slice(0, 4) === String(year));
    })
    .sort((a, b) => String(a.paidDate || a.date).localeCompare(String(b.paidDate || b.date)));

  const receiptsById = new Map((data.receipts || []).map((r) => [r.id, r]));

  for (const entry of rows) {
    const effect = taxEffect(entry);
    const category = getCategory(entry.categoryId);
    const receipt = entry.receiptId ? receiptsById.get(entry.receiptId) : null;
    const row = sheet.addRow([
      entry.date,
      entry.paidDate || 'offen',
      entry.type === 'income' ? 'Einnahme' : 'Ausgabe',
      category ? category.label : entry.categoryId,
      entry.counterparty,
      entry.description,
      euros(entry.gross),
      euros(entry.net),
      entry.vatRate ? entry.vatRate / 100 : 0,
      euros(entry.vat),
      euros(effect.inputVat),
      euros(effect.euerAmount),
      entry.paymentMethod,
      receipt ? receipt.fileName : ''
    ]);
    [7, 8, 10, 11, 12].forEach((i) => { row.getCell(i).numFmt = MONEY_FORMAT; });
    row.getCell(9).numFmt = '0 %';
  }

  autoWidth(sheet, [12, 12, 10, 34, 24, 40, 13, 13, 9, 12, 12, 14, 14, 28]);
}

function sheetVat(workbook: ExcelJS.Workbook, data: Snapshot, year: number): void {
  const sheet = workbook.addWorksheet(`Umsatzsteuer ${year}`);
  const method = data.settings.tax.vatMethod === 'soll' ? 'Soll-Versteuerung' : 'Ist-Versteuerung';
  sheet.addRow([`Umsatzsteuer-Voranmeldungen ${year}`]).font = { bold: true, size: 14 };
  sheet.addRow([`${method}, Vorsteuerabzug nach ${data.settings.tax.inputVatBasis === 'payment' ? 'Zahlung' : 'Rechnungsdatum'}`]);
  sheet.addRow(['Zahlen zum Übertragen nach ELSTER. Das Programm übermittelt nichts.']);
  sheet.addRow([]);

  styleHeader(sheet.addRow(['Zeitraum', 'Fällig am', 'Kz 81 Netto 19 %', 'Kz 86 Netto 7 %', 'Kz 66 Vorsteuer', 'Umsatzsteuer', 'Zahllast Kz 83']));

  const periods = vat.yearOverview(data.entries, data.settings, year);
  let totalPayable = 0;
  for (const period of periods) {
    const detail = vat.calculate(data.entries, data.settings, period);
    totalPayable += period.payable;
    const row = sheet.addRow([
      period.label,
      period.dueDate,
      euros(detail.kz['81'] || 0),
      euros(detail.kz['86'] || 0),
      euros(detail.inputVat),
      euros(detail.outputVat),
      euros(detail.payable)
    ]);
    [3, 4, 5, 6, 7].forEach((i) => { row.getCell(i).numFmt = MONEY_FORMAT; });
  }

  const sumRow = sheet.addRow(['Summe', '', '', '', '', '', euros(totalPayable)]);
  sumRow.font = { bold: true };
  sumRow.getCell(7).numFmt = MONEY_FORMAT;

  autoWidth(sheet, [20, 14, 18, 18, 18, 16, 18]);
}

function sheetAssets(workbook: ExcelJS.Workbook, data: Snapshot, year: number): void {
  if (!data.assets || !data.assets.length) return;
  const sheet = workbook.addWorksheet('Anlageverzeichnis');
  styleHeader(sheet.addRow([
    'Bezeichnung', 'Anschaffung', 'Anschaffungskosten netto', 'Nutzungsdauer',
    `AfA ${year}`, `Restbuchwert 31.12.${year}`
  ]));

  for (const asset of data.assets) {
    const row = sheet.addRow([
      asset.label,
      asset.purchaseDate,
      euros(asset.netCents),
      `${asset.usefulLifeYears} Jahre`,
      euros(assets.depreciationForYear(asset, year)),
      euros(assets.bookValueAtEndOf(asset, year))
    ]);
    [3, 5, 6].forEach((i) => { row.getCell(i).numFmt = MONEY_FORMAT; });
  }

  const sum = sheet.addRow(['Summe', '', '', '', euros(assets.totalDepreciation(data.assets, year)), '']);
  sum.font = { bold: true };
  sum.getCell(5).numFmt = MONEY_FORMAT;

  autoWidth(sheet, [40, 14, 22, 16, 16, 22]);
}

function sheetInvoices(workbook: ExcelJS.Workbook, data: Snapshot, year: number): void {
  const list = (data.invoices || []).filter((inv) => String(inv.issueDate).slice(0, 4) === String(year));
  if (!list.length) return;
  const sheet = workbook.addWorksheet(`Rechnungen ${year}`);
  styleHeader(sheet.addRow(['Nummer', 'Datum', 'Kunde', 'Status', 'Netto', 'USt', 'Brutto', 'Bezahlt', 'Offen']));

  const customers = new Map((data.customers || []).map((c) => [c.id, c]));
  const today = new Date().toISOString().slice(0, 10);

  for (const invoice of list.sort((a, b) => String(a.number).localeCompare(String(b.number)))) {
    const t = totals(invoice);
    const customer = customers.get(invoice.customerId);
    const row = sheet.addRow([
      invoice.number,
      invoice.issueDate,
      customer ? customer.name : '',
      STATUS[resolveStatus(invoice, today)] || invoice.status,
      euros(t.netTotal),
      euros(t.vatTotal),
      euros(t.grossTotal),
      euros(t.paid),
      euros(t.openAmount)
    ]);
    [5, 6, 7, 8, 9].forEach((i) => { row.getCell(i).numFmt = MONEY_FORMAT; });
  }

  autoWidth(sheet, [18, 13, 32, 18, 14, 14, 14, 14, 14]);
}

/** Builds the complete workbook for a year and writes it to disk. */
export async function exportYear(data: Snapshot, year: number, file: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NestEgg';
  workbook.created = new Date();

  sheetEuer(workbook, data, year);
  sheetJournal(workbook, data, year);
  sheetVat(workbook, data, year);
  sheetAssets(workbook, data, year);
  sheetInvoices(workbook, data, year);

  await workbook.xlsx.writeFile(file);
  return file;
}

/** The journal as CSV, semicolon separated, for importing elsewhere. */
export function journalCsv(data: Snapshot, year: number): string {
  const header = [
    'Belegdatum', 'Zahlungsdatum', 'Art', 'Kategorie', 'Gegenpartei', 'Verwendungszweck',
    'Brutto', 'Netto', 'USt-Satz', 'USt', 'Vorsteuer', 'Zahlungsart', 'Beleg'
  ];
  const escapeCsv = (value: unknown) => {
    const s = String(value ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const receiptsById = new Map((data.receipts || []).map((r) => [r.id, r]));

  const lines = [header.join(';')];
  const rows = data.entries
    .filter((e) => {
      const y = euer.taxYearOf(e);
      return y === year || (y === null && String(e.date).slice(0, 4) === String(year));
    })
    .sort((a, b) => String(a.paidDate || a.date).localeCompare(String(b.paidDate || b.date)));

  for (const entry of rows) {
    const effect = taxEffect(entry);
    const category = getCategory(entry.categoryId);
    const receipt = entry.receiptId ? receiptsById.get(entry.receiptId) : null;
    lines.push([
      entry.date,
      entry.paidDate || '',
      entry.type === 'income' ? 'Einnahme' : 'Ausgabe',
      category ? category.label : entry.categoryId,
      entry.counterparty,
      entry.description,
      euros(entry.gross).toFixed(2).replace('.', ','),
      euros(entry.net).toFixed(2).replace('.', ','),
      `${entry.vatRate}%`,
      euros(entry.vat).toFixed(2).replace('.', ','),
      euros(effect.inputVat).toFixed(2).replace('.', ','),
      entry.paymentMethod,
      receipt ? receipt.fileName : ''
    ].map(escapeCsv).join(';'));
  }

  // A byte order mark, so Excel reads the umlauts correctly.
  return `﻿${lines.join('\r\n')}\r\n`;
}
