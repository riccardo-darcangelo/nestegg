// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import * as QRCode from 'qrcode';

import type { Cents } from '../shared/types';

/**
 * QR codes for documents.
 *
 * The matrix comes from `qrcode`, the SVG path is built here.
 *
 * Why a dependency where the app otherwise gets by with two: a QR encoder is a
 * solved problem with many quiet pitfalls, from the bit order of the format
 * information to the choice of mask. A hand written one stood here and looked
 * right, but no scanner could read it. The package works offline, without
 * network and without native parts.
 *
 * The tests read the output back with jsQR, a foreign decoder, so it does not
 * confirm itself.
 */

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

const LEVELS: ErrorCorrectionLevel[] = ['L', 'M', 'Q', 'H'];

export interface EncodedCode {
  size: number;
  version: number;
  level: ErrorCorrectionLevel;
  get(row: number, column: number): 0 | 1;
}

/** The matrix, synchronously, which keeps document building free of await. */
export function encode(text: string, level?: string): EncodedCode {
  const chosen = LEVELS.find((item) => item === level) ?? 'M';
  const code = QRCode.create(String(text), { errorCorrectionLevel: chosen });

  return {
    size: code.modules.size,
    version: code.version,
    level: chosen,
    get: (row, column) => (code.modules.get(row, column) ? 1 : 0)
  };
}

export interface SvgOptions {
  level?: string;
  /** Modules of white margin, four by specification. */
  quietZone?: number;
  background?: string;
  color?: string;
}

/** The dark modules as a single path, which keeps the PDF small. */
function modulePath(code: EncodedCode, offset: number): string {
  let path = '';

  for (let row = 0; row < code.size; row += 1) {
    for (let column = 0; column < code.size; column += 1) {
      if (code.get(row, column)) path += `M${column + offset} ${row + offset}h1v1h-1z`;
    }
  }

  return path;
}

/** The QR code as an SVG, one path instead of a thousand rectangles. */
export function svg(text: string, options: SvgOptions = {}): string {
  const code = encode(text, options.level);
  const margin = options.quietZone ?? 4;
  const extent = code.size + margin * 2;

  const background = options.background === 'none'
    ? ''
    : `<rect width="${extent}" height="${extent}" fill="${options.background ?? '#ffffff'}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges">`
    + `${background}<path d="${modulePath(code, margin)}" fill="${options.color ?? '#000000'}"/></svg>`;
}

/** The same QR code as a data URL, for an img element in the document. */
export function dataUrl(text: string, options: SvgOptions = {}): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg(text, options), 'utf8').toString('base64')}`;
}

export interface GirocodeFields {
  name?: string;
  iban?: string;
  bic?: string;
  amount?: Cents;
  /** Structured creditor reference, or free text below. */
  reference?: string;
  text?: string;
}

/**
 * The payload of a GiroCode (EPC QR).
 *
 * Scanning it hands the payer a prefilled transfer in their banking app, with
 * no IBAN to type. The layout is fixed by the European Payments Council:
 * twelve lines in a set order, the amount with a dot and two decimals.
 */
export function girocode({ name, iban, bic, amount, reference, text }: GirocodeFields): string {
  const value = Number.isFinite(amount) && (amount as number) > 0
    ? `EUR${((amount as number) / 100).toFixed(2)}`
    : '';

  return [
    'BCD',                                   // service tag
    '002',                                   // version
    '1',                                     // character set, UTF-8
    'SCT',                                   // SEPA credit transfer
    String(bic ?? '').replace(/\s/g, ''),
    String(name ?? '').slice(0, 70),
    String(iban ?? '').replace(/\s/g, ''),
    value,
    '',                                      // purpose code, stays empty
    String(reference ?? '').slice(0, 35),
    String(text ?? '').slice(0, 140),
    ''                                       // note to the payer
  ].join('\n');
}
