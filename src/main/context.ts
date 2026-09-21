// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import type { BrowserWindow } from 'electron';

import { todayIso } from '../domain/entries';
import type { Store } from '../storage/store';
import type { Company, Entity, IsoDate, Settings } from '../shared/types';

/**
 * What the whole main process shares.
 *
 * The store and the window change over the life of the app: switching a
 * profile replaces the store, unlocking creates the window. So the handlers
 * ask for them here instead of closing over a value that may already be stale.
 *
 * The data key lives here too and goes no further. It never crosses into the
 * renderer: the interface sends passwords in and gets yes or no back.
 */

let store: Store | null = null;
let mainWindow: BrowserWindow | null = null;
let sessionKey: Buffer | null = null;

/** The store of the active profile. Throws before the app has opened one. */
export function currentStore(): Store {
  if (!store) throw new Error('Der Datenbestand ist noch nicht geöffnet.');
  return store;
}

export function setStore(next: Store | null): void {
  store = next;
}

export function currentWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setWindow(next: BrowserWindow | null): void {
  mainWindow = next;
}

/** The data key of this session, or null while the data lies open. */
export function currentKey(): Buffer | null {
  return sessionKey;
}

export function setKey(next: Buffer | null): void {
  sessionKey = next;
}

export function settings(): Settings {
  return currentStore().snapshot().settings;
}

export function company(): Company {
  return settings().company;
}

export function today(): IsoDate {
  return todayIso();
}

/**
 * Who keeps these books: a sole trader or an association.
 * Categories, reporting and input tax all hang off this.
 */
export function entityKind(from?: Settings | null): Entity['kind'] {
  return (from ?? settings()).entity?.kind === 'club' ? 'club' : 'business';
}

/** Tells the interface how far a long running job has come. */
export function sendProgress(channel: string, progress: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, progress);
  }
}
