// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import type { StoredConfig } from '../storage/profiles';

/** The data folder is named in a small configuration file beside the app data. */
export function configFile(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export function readConfig(): StoredConfig {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8')) as StoredConfig;
  } catch {
    return {};
  }
}

export function writeConfig(config: StoredConfig): void {
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2), 'utf8');
}

/** Can this folder be created and written to? */
export function isWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.schreibprobe-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the bookkeeping goes when nobody picks something else.
 *
 * Beside the application, deliberately not under Documents: on many machines
 * that folder is mounted into OneDrive, and then the whole set of books and
 * every receipt travels into the cloud without anyone having decided so.
 *
 * Mind you, and the app says so during setup: an installation folder does not
 * survive an uninstall. Whoever has to keep the data for ten years, and AO 147
 * (1) demands exactly that, is better off with a folder outside it, on a second
 * disk for instance. The way there is in the settings and at the first start.
 */
export function defaultDataDir(): string {
  const candidates: string[] = [];

  if (app.isPackaged) {
    // Beside NestEgg.exe. With a per user installation that sits under
    // AppData\Local\Programs and is writable.
    candidates.push(path.join(path.dirname(process.execPath), 'Daten'));
  } else {
    // In development beside the project, so test runs cannot write into real
    // bookkeeping.
    candidates.push(path.join(app.getAppPath(), 'daten-dev'));
  }

  // In case that folder cannot be written to, as with an installation for all
  // users under Program Files.
  candidates.push(path.join(app.getPath('userData'), 'Daten'));

  return candidates.find(isWritableDir) ?? candidates[candidates.length - 1]!;
}
