// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { ipcMain } from 'electron';

import type { IpcResult } from '../shared/types';

/**
 * The bridge to the interface.
 *
 * Every handler answers in the same shape, so the renderer never has to guess
 * whether something worked. An exception becomes a refusal with a readable
 * reason instead of tearing the interface apart.
 */

export function fail(message: string): IpcResult<never> {
  return { ok: false, error: message };
}

export function done<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

export type Handler<P, T> = (payload: P) => Promise<IpcResult<T>>;

export function handle<P, T>(channel: string, fn: Handler<P, T>): void {
  ipcMain.handle(channel, async (_event, payload: P) => {
    try {
      return await fn(payload);
    } catch (err) {
      console.error(`[${channel}]`, err);
      return fail((err as Error).message || 'Unbekannter Fehler');
    }
  });
}
