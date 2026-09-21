// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { company } from './context';
import type { BusinessDocument, Customer, DocumentCompany } from '../shared/types';

/**
 * Turning documents into files.
 *
 * Everything the app prints goes through here: HTML is rendered in an
 * invisible window, which keeps the PDF looking exactly like the preview.
 */

/** An image from the company data as a data URL, for embedding in a document. */
export async function imageDataUrl(imagePath: string | null | undefined): Promise<string> {
  if (!imagePath || !fs.existsSync(imagePath)) return '';

  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const data = await fsp.readFile(imagePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

export async function logoDataUrl(): Promise<string> {
  return imageDataUrl(company().logoPath);
}

/**
 * The company data as a document needs it, with the images embedded.
 * One place, so no caller forgets the facsimile.
 */
export async function companyForDocument(): Promise<DocumentCompany> {
  const current = company();
  return {
    ...current,
    logoDataUrl: await logoDataUrl(),
    signatureDataUrl: await imageDataUrl(current.signature?.imagePath)
  };
}

/** Renders HTML to PDF in an invisible window. */
export async function renderPdf(html: string): Promise<Uint8Array> {
  const tmpFile = path.join(os.tmpdir(), `nestegg-${Date.now()}.html`);
  await fsp.writeFile(tmpFile, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, contextIsolation: true, nodeIntegration: false }
  });

  try {
    await win.loadFile(tmpFile);
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: true
    });
  } finally {
    win.destroy();
    await fsp.unlink(tmpFile).catch(() => {});
  }
}

/** The file name a document is offered under, number and customer. */
export function invoiceFileBase(invoice: Pick<BusinessDocument, 'number'>, customer: Partial<Customer>): string {
  const number = String(invoice.number || 'entwurf').replace(/[^\w.-]/g, '-');
  const name = String(customer.name ?? '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 30);

  return [number, name].filter(Boolean).join('_');
}
