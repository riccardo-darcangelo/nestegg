// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { dialog } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { done, handle } from '../ipc';
import { currentStore, currentWindow, today } from '../context';
import * as analytics from '../../domain/analytics';
import * as ecsales from '../../domain/ecsales';
import * as forecast from '../../domain/forecast';
import * as euer from '../../domain/euer';
import * as vatDomain from '../../domain/vat';
import * as taxDomain from '../../domain/tax';
import * as deadlines from '../../domain/deadlines';
import * as recurring from '../../domain/recurring';
import * as doctypes from '../../domain/doctypes';
import * as invoicesDomain from '../../domain/invoices';
import * as reports from '../../export/reports';
import type { IsoDate, Settings, Snapshot } from '../../shared/types';

/**
 * Reports.
 *
 * Everything the interface asks for as figures: the profit statement, the VAT
 * returns, the EC sales list, the forecasts and the dashboard. Nothing here
 * writes; every handler reads the current data and calculates.
 */

/**
 * A year that is only being caught up on.
 *
 * It is calculated like any other, but marked: no return comes out of it, and
 * saying so beats a figure the user takes for a filing.
 */
function archiveNote(settings: Settings, year: number) {
  const archive = taxDomain.isArchiveYear(settings, year);
  return { archive, archiveNote: archive ? taxDomain.archiveNote(year, settings) : null };
}

handle('reports:analytics', async (year: number | string) => {
  const data = currentStore().snapshot();
  return done(analytics.analyze(data, Number(year)));
});

handle('reports:ecSales', async ({ year, periodKey }: { year: number; periodKey?: string }) => {
  const data = currentStore().snapshot();
  const mode = data.settings.tax.ecSalesPeriod ?? 'quarterly';
  const periods = ecsales.periodsOf(Number(year), mode);
  const period = periods.find((item) => item.key === periodKey) ?? periods[0]!;

  return done({
    detail: ecsales.calculate(data.entries, data.customers, period),
    overview: ecsales.yearOverview(data.entries, data.customers, Number(year), mode),
    mode,
    needsMonthly: ecsales.needsMonthly(data.entries, data.customers, Number(year))
  });
});

handle('reports:reserve', async (year: number | string) => {
  return done(forecast.taxReserve(currentStore().snapshot(), Number(year), today()));
});

handle('reports:liquidity', async (months: number | string) => {
  return done(forecast.liquidity(currentStore().snapshot(), today(), Number(months) || 6));
});

handle('reports:euer', async (year: number | string) => {
  const data = currentStore().snapshot();
  const requested = Number(year);

  return done({
    ...euer.calculate(data.entries, data.assets, requested),
    ...archiveNote(data.settings, requested)
  });
});

handle('reports:vat', async ({ year, periodKey }: { year: number; periodKey?: string }) => {
  const data = currentStore().snapshot();
  const { tax } = data.settings;
  const periods = vatDomain.periodsOf(Number(year), tax.vatPeriod, tax.dauerfristverlaengerung);
  const period = periods.find((item) => item.key === periodKey) ?? periods[0]!;

  return done({
    ...vatDomain.calculate(data.entries, data.settings, period),
    ...archiveNote(data.settings, Number(year))
  });
});

handle('reports:vatYear', async (year: number | string) => {
  const data = currentStore().snapshot();
  const { tax } = data.settings;
  const requested = Number(year);

  return done({
    overview: vatDomain.yearOverview(data.entries, data.settings, requested),
    // The special prepayment rests on the previous year, which is what the
    // extension of the filing deadline is bought with.
    special: tax.dauerfristverlaengerung
      ? vatDomain.specialPrepayment(data.entries, data.settings, requested - 1)
      : null,
    mode: tax.vatPeriod,
    ...archiveNote(data.settings, requested)
  });
});

/**
 * The receivables on the dashboard.
 *
 * Only real invoices are claims. A quote is not money yet, and a credit note
 * demands none.
 */
function openInvoicesOf(data: Snapshot, todayIso: IsoDate) {
  return data.invoices
    .filter((invoice) => {
      const type = doctypes.typeOf(invoice);
      if (type.group !== 'invoice' || type.id === 'creditnote') return false;
      const status = invoicesDomain.resolveStatus(invoice, todayIso);
      return status === 'sent' || status === 'overdue' || status === 'partial';
    })
    .map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      dueDate: invoice.dueDate,
      customerId: invoice.customerId,
      open: invoicesDomain.totals(invoice).openAmount,
      status: invoicesDomain.resolveStatus(invoice, todayIso)
    }))
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
}

/** Receipts an audit would ask about first: expenses above 250 euro. */
const RECEIPT_THRESHOLD = 25000;

handle('reports:dashboard', async (year: number | string) => {
  const data = currentStore().snapshot();
  const requested = Number(year);
  const todayIso = today();

  const result = euer.calculate(data.entries, data.assets, requested);
  const periods = vatDomain.yearOverview(data.entries, data.settings, requested);
  const ofYear = data.entries.filter((entry) => euer.taxYearOf(entry) === requested);

  return done({
    year: requested,
    profit: result.profit,
    incomeTotal: result.incomeTotal,
    expenseTotal: result.expenseTotal,
    collectedVat: result.collectedVat,
    paidInputVat: result.paidInputVat,
    months: euer.monthlyTotals(data.entries, requested),
    openInvoices: openInvoicesOf(data, todayIso),
    openTotals: result.open,
    nextPeriod: periods.find((period) => period.dueDate >= todayIso) ?? null,
    // The small business threshold looks at turnover, not at profit.
    turnover: ofYear.filter((entry) => entry.type === 'income').reduce((sum, entry) => sum + entry.gross, 0),
    pressingDeadlines: deadlines.collect(data, requested, todayIso, { horizonDays: 30 }).pressing,
    recurringDue: recurring.collectDue(data.recurrences, data, todayIso)
      .reduce((sum, group) => sum + group.dates.length, 0),
    entriesCount: ofYear.length,
    missingReceipts: ofYear.filter(
      (entry) => entry.type === 'expense' && !entry.receiptId && entry.gross > RECEIPT_THRESHOLD
    ).length
  });
});

handle('reports:exportYear', async (year: number | string) => {
  const store = currentStore();
  const { canceled, filePath } = await dialog.showSaveDialog(currentWindow()!, {
    title: `Jahresauswertung ${year}`,
    defaultPath: path.join(store.exportDir, `nestegg-${year}.xlsx`),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (canceled || !filePath) return done(null);

  await reports.exportYear(store.snapshot(), Number(year), filePath);
  return done({ file: filePath });
});

handle('reports:exportCsv', async (year: number | string) => {
  const store = currentStore();
  const { canceled, filePath } = await dialog.showSaveDialog(currentWindow()!, {
    title: `Buchungen ${year} als CSV`,
    defaultPath: path.join(store.exportDir, `buchungen-${year}.csv`),
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (canceled || !filePath) return done(null);

  await fsp.writeFile(filePath, reports.journalCsv(store.snapshot(), Number(year)), 'utf8');
  return done({ file: filePath });
});
