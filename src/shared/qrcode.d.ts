// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * What this app uses of `qrcode`.
 *
 * The package ships no types and DefinitelyTyped only covers the async API,
 * while the document builder needs the synchronous `create` to stay free of
 * await. Two calls are all that is needed, so they are declared here.
 */
declare module 'qrcode' {
  export interface BitMatrix {
    size: number;
    get(row: number, column: number): number;
  }

  export interface QRCodeData {
    modules: BitMatrix;
    version: number;
  }

  export function create(
    text: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }
  ): QRCodeData;
}
