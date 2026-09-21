// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * CSV reading.
 *
 * No library, because what banks export rarely follows the standard anyway
 * and the deviations deserve to be named here:
 *
 *   Delimiter  semicolon in German exports, comma in English ones, sometimes
 *              a tab. Guessed from the file.
 *   Encoding   Windows-1252 is more common than UTF-8. Guess wrong and
 *              "Müller" turns into "MÃ¼ller".
 *   Preamble   many banks put account number, period and blank lines above
 *              the actual header row.
 *
 * The parser itself follows RFC 4180: quoted fields may contain delimiters
 * and newlines, and two quotes stand for one.
 */

const DELIMITERS = [';', ',', '\t', '|'] as const;

export type Delimiter = string;

export interface DecodedFile {
  text: string;
  encoding: 'utf-8' | 'windows-1252';
}

export interface ReadResult {
  rows: string[][];
  delimiter: Delimiter;
  encoding: DecodedFile['encoding'];
}

/**
 * Assumes UTF-8 and checks the result: a replacement character means it was
 * not, and then Windows-1252 is the better guess.
 */
export function decode(buffer: Buffer | Uint8Array | string): DecodedFile {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as Uint8Array);

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: bytes.subarray(3).toString('utf8'), encoding: 'utf-8' };
  }

  const utf8 = bytes.toString('utf8');
  if (!utf8.includes('�')) return { text: utf8, encoding: 'utf-8' };

  return { text: bytes.toString('latin1'), encoding: 'windows-1252' };
}

function countOutsideQuotes(line: string, delimiter: Delimiter): number {
  let count = 0;
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      count += 1;
    }
  }

  return count;
}

/**
 * Counting happens outside quotes only, otherwise the comma in every payment
 * reference wins. The winner is the character that appears most evenly across
 * the first lines: a real delimiter occurs equally often in every row, a
 * coincidental one does not.
 */
export function guessDelimiter(text: string): Delimiter {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 20);
  if (lines.length === 0) return ';';

  let best: { delimiter: Delimiter; score: number } = { delimiter: ';', score: -1 };

  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const used = counts.filter((count) => count > 0);
    if (used.length < Math.max(1, Math.min(2, lines.length))) continue;

    const max = Math.max(...counts);
    const consistent = counts.filter((count) => count === max).length;

    // Frequency times evenness: many columns across many rows.
    const score = max * consistent;
    if (score > best.score) best = { delimiter, score };
  }

  return best.delimiter;
}

export function parse(text: string, delimiter?: Delimiter): string[][] {
  const separator = delimiter || guessDelimiter(text);
  const rows: string[][] = [];

  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldWasQuoted = false;

  // Only unquoted fields get trimmed; inside quotes the whitespace is meant.
  const endField = (): void => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };

  const endRow = (): void => {
    endField();
    if (row.some((cell) => cell !== '')) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      fieldWasQuoted = true;
    } else if (char === separator) {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      // A lone carriage return also ends the row; CRLF is handled at the \n.
      if (text[index + 1] !== '\n') endRow();
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length) endRow();
  return rows;
}

export function read(
  buffer: Buffer | Uint8Array | string,
  options: { delimiter?: Delimiter } = {}
): ReadResult {
  const { text, encoding } = decode(buffer);
  const delimiter = options.delimiter || guessDelimiter(text);

  return { rows: parse(text, delimiter), delimiter, encoding };
}
