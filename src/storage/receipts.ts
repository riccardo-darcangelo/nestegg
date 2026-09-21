// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import * as vault from '../security/vault';
import type { IsoDate, Receipt } from '../shared/types';

/**
 * Where receipts are filed.
 *
 * Receipts are copied into the data folder, not linked. One still sitting in
 * the downloads folder is gone at the next clean up, and the duty to keep it
 * runs eight years.
 *
 * Open or encrypted
 * -----------------
 * Without a key the receipt sits at
 * belege/<year>/<date>_<counterparty>_<amount>.<ext>. With a key at
 * belege/<year>/bel_<random>.nst, deliberately without a telling name:
 * "2026-09-05_Nordlicht-Handels_119-00.pdf" already gives away the business
 * partner and the amount to anyone who merely sees the directory. The real
 * name lives in the record, and that is encrypted itself.
 *
 * Every receipt carries a SHA-256 checksum, always over the plain content.
 * That shows the receipt is unchanged since filing, and the checksum stays the
 * same when the data is later encrypted or opened up again.
 */

export const ALLOWED = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff', '.xml', '.txt', '.eml', '.msg'
]);

const SAFE_EXT = '.nst';

function slug(value: string | null | undefined): string {
  return String(value || '')
    // Umlauts first, otherwise normalisation splits them into letter plus
    // mark and Müller would become Muller instead of Mueller.
    .replace(/ä/g, 'ae').replace(/Ä/g, 'Ae')
    .replace(/ö/g, 'oe').replace(/Ö/g, 'Oe')
    .replace(/ü/g, 'ue').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    // Remaining diacritics drop out: é becomes e.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Finds a free file name where the wanted one is taken. */
async function freeName(dir: string, base: string, ext: string): Promise<string> {
  let candidate = path.join(dir, `${base}${ext}`);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

export interface ReceiptMeta {
  date?: IsoDate;
  counterparty?: string;
  /** The amount as it should read in the file name. */
  amountLabel?: string;
  description?: string;
}

/** Files a receipt, encrypted when a data key is given. */
export async function store(
  receiptDir: string,
  sourceFile: string,
  meta: ReceiptMeta = {},
  key: Buffer | null = null
): Promise<Omit<Receipt, 'id'> & { id: null }> {
  const ext = path.extname(sourceFile).toLowerCase();
  if (!ALLOWED.has(ext)) {
    throw new Error(`Dateityp ${ext || 'ohne Endung'} wird nicht als Beleg angenommen.`);
  }

  const date = meta.date || new Date().toISOString().slice(0, 10);
  const year = date.slice(0, 4);
  const dir = path.join(receiptDir, year);
  await fsp.mkdir(dir, { recursive: true });

  const plain = await fsp.readFile(sourceFile);
  const telling = [date, slug(meta.counterparty) || slug(meta.description) || 'beleg'];
  if (meta.amountLabel) telling.push(slug(meta.amountLabel));

  const target = key
    ? await freeName(dir, `bel_${crypto.randomBytes(8).toString('hex')}`, SAFE_EXT)
    : await freeName(dir, telling.filter(Boolean).join('_'), ext);

  await fsp.writeFile(target, key ? vault.encrypt(plain, key, vault.KIND.FILE) : plain);
  const stat = await fsp.stat(target);

  return {
    id: null,
    // Without encryption the display name is the file name, counter and all.
    // With encryption the file is called something else, and this is where the
    // telling name lives for the interface, the export and an auditor's print.
    fileName: key ? `${telling.filter(Boolean).join('_')}${ext}` : path.basename(target),
    relativePath: path.relative(receiptDir, target).split(path.sep).join('/'),
    originalName: path.basename(sourceFile),
    size: plain.length,
    storedSize: stat.size,
    encrypted: Boolean(key),
    checksum: sha256(plain),
    mimeHint: ext.slice(1),
    date,
    addedAt: new Date().toISOString()
  };
}

/** The absolute path of a filed receipt. */
export function resolve(receiptDir: string, receipt: Receipt | null | undefined): string | null {
  if (!receipt?.relativePath) return null;
  return path.join(receiptDir, ...receipt.relativePath.split('/'));
}

/**
 * The content of a receipt, in the clear.
 *
 * The one place every access goes through: display, attaching to a reminder,
 * text recognition, the GoBD export. Whoever reads the file themselves gets
 * gibberish once the vault is locked.
 */
export async function read(receiptDir: string, receipt: Receipt, key: Buffer | null = null): Promise<Buffer> {
  const file = resolve(receiptDir, receipt);
  if (!file || !fs.existsSync(file)) throw new Error('Die Belegdatei liegt nicht mehr an ihrem Platz.');

  const raw = await fsp.readFile(file);
  if (!vault.isEncrypted(raw)) return raw;
  if (!key) throw new Error('Der Beleg ist verschlüsselt und braucht das Passwort.');
  return vault.decrypt(raw, key);
}

export interface Verification {
  ok: boolean;
  reason?: string;
}

/** Checks whether file and checksum still agree. */
export async function verify(
  receiptDir: string,
  receipt: Receipt,
  key: Buffer | null = null
): Promise<Verification> {
  const file = resolve(receiptDir, receipt);
  if (!file || !fs.existsSync(file)) return { ok: false, reason: 'Die Belegdatei fehlt.' };

  let plain: Buffer;
  try {
    plain = await read(receiptDir, receipt, key);
  } catch (err) {
    // A seal that does not open means the file was altered.
    return { ok: false, reason: `Die Belegdatei ließ sich nicht öffnen: ${(err as Error).message}` };
  }
  if (sha256(plain) !== receipt.checksum) {
    return { ok: false, reason: 'Die Belegdatei wurde nach der Ablage verändert.' };
  }
  return { ok: true };
}

/** Removes a receipt file from disk. */
export async function removeFile(receiptDir: string, receipt: Receipt): Promise<void> {
  const file = resolve(receiptDir, receipt);
  if (file && fs.existsSync(file)) await fsp.unlink(file);
}

/** What changes on the record when a receipt file is rekeyed. */
export interface RekeyedFile {
  relativePath: string;
  storedSize: number;
  encrypted: boolean;
}

/**
 * Moves a filed receipt onto a different key.
 *
 * Returns the fields that change on the record, or null when there was nothing
 * to do. The plain content, and with it the checksum, stays untouched. A null
 * target key opens the filing up again.
 */
export async function rekeyFile(
  receiptDir: string,
  receipt: Receipt,
  fromKey: Buffer | null,
  toKey: Buffer | null
): Promise<RekeyedFile | null> {
  const file = resolve(receiptDir, receipt);
  if (!file || !fs.existsSync(file)) return null;

  const plain = await read(receiptDir, receipt, fromKey);
  const year = String(receipt.date || '').slice(0, 4) || String(new Date().getFullYear());
  const dir = path.join(receiptDir, year);
  await fsp.mkdir(dir, { recursive: true });

  const ext = path.extname(receipt.fileName || '') || '.dat';
  const target = toKey
    ? await freeName(dir, `bel_${crypto.randomBytes(8).toString('hex')}`, SAFE_EXT)
    : await freeName(dir, path.basename(receipt.fileName || 'beleg', ext), ext);

  // Write the new file first, remove the old one after. The other way round a
  // crash in between would lose the receipt.
  await fsp.writeFile(target, toKey ? vault.encrypt(plain, toKey, vault.KIND.FILE) : plain);
  await fsp.unlink(file).catch(() => {});

  return {
    relativePath: path.relative(receiptDir, target).split(path.sep).join('/'),
    storedSize: (await fsp.stat(target)).size,
    encrypted: Boolean(toKey)
  };
}
