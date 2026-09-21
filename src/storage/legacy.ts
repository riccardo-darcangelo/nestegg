// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import fs from 'node:fs';
import path from 'node:path';

import { DATA_FILE } from './store';

/**
 * Moving over from an earlier version of the app.
 *
 * With the application name the folder changes in which Electron keeps its
 * configuration. After a rename the app no longer finds its own configuration
 * and would quietly start on an empty set of data while the old one sits
 * untouched beside it. That only shows once somebody goes looking for their
 * bookkeeping.
 *
 * So what stands here are pure functions without Electron, which makes the
 * whole procedure testable.
 */

export const LEGACY_APP_NAMES = ['Kontor'];

export interface AppPaths {
  /** The folder Electron keeps one directory per app in. */
  userDataParent: string;
  documents: string;
}

/** Looks for the data folder of an earlier version, newest name first. */
export function findLegacyDataDir(paths: AppPaths, names: readonly string[] = LEGACY_APP_NAMES): string | null {
  for (const name of names) {
    // The old configuration first: it also knows a data folder the user
    // moved somewhere themselves.
    try {
      const raw = fs.readFileSync(path.join(paths.userDataParent, name, 'config.json'), 'utf8');
      const legacy = JSON.parse(raw) as { dataDir?: string };
      if (legacy.dataDir && hasData(legacy.dataDir)) return legacy.dataDir;
    } catch { /* no configuration under this name */ }

    // Otherwise the default folder of that time.
    const guess = path.join(paths.documents, name);
    if (hasData(guess)) return guess;
  }
  return null;
}

function hasData(dir: string | null | undefined): boolean {
  return Boolean(dir) && fs.existsSync(path.join(dir!, DATA_FILE));
}

/** Whether a data folder holds nothing but the empty scaffolding. */
export function isEmptyDataDir(dir: string): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, DATA_FILE), 'utf8')) as Record<string, unknown>;
    return ['entries', 'invoices', 'customers', 'projects', 'assets', 'receipts']
      .every((key) => !Array.isArray(data[key]) || data[key].length === 0);
  } catch {
    return false;
  }
}

export type AdoptionAction = 'rename' | 'replace' | 'link';

export interface AdoptionPlan {
  action: AdoptionAction;
  /** The folder that will be worked with afterwards. */
  resultDir: string;
  description: string;
}

/**
 * Describes what an adoption would do, without changing anything, so the text
 * in the dialog and the later execution cannot drift apart.
 */
export function planAdoption(legacyDir: string, targetDir: string): AdoptionPlan {
  const targetExists = fs.existsSync(targetDir);
  const targetIsEmpty = targetExists && isEmptyDataDir(targetDir);

  if (!targetExists) {
    return {
      action: 'rename',
      resultDir: targetDir,
      description: `Der Ordner wird dabei in ${path.basename(targetDir)} umbenannt.`
    };
  }
  if (targetIsEmpty) {
    return {
      action: 'replace',
      resultDir: targetDir,
      description: `Der leere Ordner ${path.basename(targetDir)}, den die App beim Start angelegt hat, wird entfernt. Der alte Ordner nimmt seinen Namen ein.`
    };
  }
  return {
    action: 'link',
    resultDir: legacyDir,
    description: `Unter ${path.basename(targetDir)} liegen bereits Daten. Der alte Ordner bleibt deshalb, wo er ist, und wird nur verknüpft.`
  };
}

export interface Adoption {
  dir: string;
  plan: AdoptionPlan;
  error: Error | null;
}

/**
 * Carries out the adoption and returns the folder to work with. Where anything
 * fails the old folder stays valid: nothing is ever lost.
 */
export function adopt(legacyDir: string, targetDir: string): Adoption {
  const plan = planAdoption(legacyDir, targetDir);

  try {
    if (plan.action === 'link') return { dir: legacyDir, plan, error: null };
    if (plan.action === 'replace') fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(legacyDir, targetDir);
    return { dir: targetDir, plan, error: null };
  } catch (err) {
    return { dir: legacyDir, plan, error: err as Error };
  }
}
