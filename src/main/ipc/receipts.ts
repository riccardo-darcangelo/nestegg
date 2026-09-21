// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { app, dialog, shell } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { done, fail, handle } from '../ipc';
import { currentKey, currentStore, currentWindow } from '../context';
import * as receiptsLib from '../../storage/receipts';
import * as receiptscan from '../../import/receiptscan';
import type { Entry, Id, Receipt } from '../../shared/types';

/**
 * Receipt files.
 *
 * Attaching, reading out, opening, checking and removing. What is filed goes
 * through storage/receipts, which knows whether the vault is locked; nothing
 * here touches a file directly.
 */

const FILE_FILTERS = [
  { name: 'Belege', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'tif', 'tiff', 'xml', 'eml'] },
  { name: 'Alle Dateien', extensions: ['*'] }
];

/**
 * Where encrypted receipts are unpacked for viewing.
 *
 * No PDF viewer knows our format, so an encrypted receipt is decrypted into a
 * temporary folder that disappears when the app quits. That is the price for
 * being able to look at receipts in other programs at all, and it is named
 * openly here rather than hidden.
 */
let tempViewPath: string | null = null;

function tempViewDir(): string {
  if (!tempViewPath) tempViewPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestegg-belege-'));
  return tempViewPath;
}

function cleanTempViewDir(): void {
  if (!tempViewPath) return;
  fs.rmSync(tempViewPath, { recursive: true, force: true });
  tempViewPath = null;
}

// Also when the renderer crashes and when quitting through the menu.
app.on('will-quit', cleanTempViewDir);
process.on('exit', cleanTempViewDir);

/** The receipt behind an id, or the reason there is none. */
function receiptOr404(id: Id): Receipt | null {
  return currentStore().get('receipts', id) as Receipt | null;
}

handle('receipts:attach', async (meta: receiptsLib.ReceiptMeta) => {
  const store = currentStore();
  const { canceled, filePaths } = await dialog.showOpenDialog(currentWindow()!, {
    title: 'Beleg auswählen',
    properties: ['openFile'],
    filters: FILE_FILTERS
  });
  if (canceled || !filePaths.length) return done(null);

  const source = filePaths[0]!;
  const stored = await receiptsLib.store(store.receiptDir, source, meta ?? {}, currentKey());
  const saved = await store.create('receipts', stored, 'beleg');

  // Look inside right away. What is found is a proposal for the form, nothing
  // of it gets booked.
  let scan: receiptscan.ScanResult | null = null;
  try {
    scan = receiptscan.scan(await fsp.readFile(source), path.basename(source));
  } catch {
    scan = null;
  }

  return done({ ...saved, scan });
});

/** Reads an already filed receipt once more. */
handle('receipts:scan', async (id: Id) => {
  const receipt = receiptOr404(id);
  if (!receipt) return fail('Der Beleg wurde nicht gefunden.');

  const buffer = await receiptsLib.read(currentStore().receiptDir, receipt, currentKey());
  return done(receiptscan.scan(buffer, receipt.fileName || ''));
});

/** Opens a receipt in the program the operating system has for it. */
handle('receipts:open', async (id: Id) => {
  const store = currentStore();
  const receipt = receiptOr404(id);
  if (!receipt) return fail('Der Beleg wurde nicht gefunden.');

  const key = currentKey();
  const file = receiptsLib.resolve(store.receiptDir, receipt);
  if (!key || !receipt.encrypted) {
    const error = await shell.openPath(file!);
    return error ? fail(error) : done(true);
  }

  // One subfolder per receipt: two receipts may carry the same telling name,
  // and the second must not overwrite the first.
  const buffer = await receiptsLib.read(store.receiptDir, receipt, key);
  const folder = path.join(tempViewDir(), receipt.id);
  await fsp.mkdir(folder, { recursive: true });
  const temp = path.join(folder, receipt.fileName || `beleg-${receipt.id}.pdf`);
  await fsp.writeFile(temp, buffer);

  const error = await shell.openPath(temp);
  return error ? fail(error) : done(true);
});

handle('receipts:reveal', async (id: Id) => {
  const receipt = receiptOr404(id);
  if (!receipt) return fail('Der Beleg wurde nicht gefunden.');

  shell.showItemInFolder(receiptsLib.resolve(currentStore().receiptDir, receipt)!);
  return done(true);
});

handle('receipts:verify', async (id: Id) => {
  const receipt = receiptOr404(id);
  if (!receipt) return fail('Der Beleg wurde nicht gefunden.');

  return done(await receiptsLib.verify(currentStore().receiptDir, receipt, currentKey()));
});

handle('receipts:remove', async (id: Id) => {
  const store = currentStore();
  const receipt = receiptOr404(id);
  if (!receipt) return fail('Der Beleg wurde nicht gefunden.');

  const linked = (store.list('entries') as unknown as Entry[]).find((entry) => entry.receiptId === id);
  if (linked) return fail('Der Beleg hängt noch an einer Buchung.');

  await receiptsLib.removeFile(store.receiptDir, receipt);
  await store.remove('receipts', id);
  return done(true);
});
