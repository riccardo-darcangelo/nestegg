// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import zlib from 'node:zlib';

/**
 * Getting text out of a PDF.
 *
 * Without a library, but also without kidding ourselves: a PDF stores no text
 * but instructions about which glyph to paint where. Between glyph and letter
 * sits the encoding of the font, and that is exactly where the naive
 * approaches fail.
 *
 *   Older producers use WinAnsi: one byte is one character, and the text sits
 *   almost in the clear in the file.
 *
 *   Modern producers, Chromium and Word among them, embed subset fonts with
 *   Identity-H. There a character is the running number of a glyph within the
 *   font, meaningless on its own. It is translated through the ToUnicode table
 *   the producer ships along.
 *
 * This reader evaluates both. Where it finds no text it says so instead of
 * returning garbage: a scanned receipt holds no text but an image, and that
 * would need optical recognition, which is deliberately not built in.
 */

/* Objects */

/**
 * Splits the file into its indirect objects.
 *
 * Since PDF 1.5 objects may sit in a compressed object stream (/Type /ObjStm).
 * Many producers do that because it makes the file noticeably smaller. Whoever
 * only looks for "x 0 obj" finds nothing in such files and takes them for
 * empty.
 */
export function readObjects(raw: string): Map<number, string> {
  const objects = new Map<number, string>();
  const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match = pattern.exec(raw);

  while (match) {
    const id = Number(match[1]);
    const start = match.index + match[0].length;
    const end = raw.indexOf('endobj', start);
    if (end > start) objects.set(id, raw.slice(start, end));
    match = pattern.exec(raw);
  }

  for (const [, body] of [...objects]) {
    if (/\/Type\s*\/ObjStm/.test(body)) unpackObjectStream(body, objects);
  }

  return objects;
}

/**
 * Unpacks a collective stream into the object table.
 *
 * Its content starts with pairs of object number and offset, the bodies follow
 * from the position /First onwards.
 */
function unpackObjectStream(body: string, objects: Map<number, string>): void {
  const stream = streamOf(body);
  if (!stream) return;

  const first = Number(/\/First\s+(\d+)/.exec(body)?.[1]);
  const count = Number(/\/N\s+(\d+)/.exec(body)?.[1]);
  if (!Number.isFinite(first) || !Number.isFinite(count)) return;

  const text = stream.toString('latin1');
  const headers = text.slice(0, first).trim().split(/\s+/).map(Number);

  for (let i = 0; i < count; i += 1) {
    const id = headers[i * 2];
    const offset = headers[i * 2 + 1];
    if (!Number.isFinite(id) || !Number.isFinite(offset)) continue;

    const nextOffset = i + 1 < count ? headers[(i + 1) * 2 + 1] : text.length - first;
    const end = first + (Number.isFinite(nextOffset) ? nextOffset! : text.length);
    // An object taken from the stream overwrites nothing that stands directly
    // in the file: that would be a later revision.
    if (!objects.has(id!)) objects.set(id!, text.slice(first + offset!, end));
  }
}

/** The unpacked content of an object, where it has a data stream. */
export function streamOf(body: string): Buffer | null {
  const marker = /stream\r\n|stream\n|stream\r/.exec(body);
  if (!marker) return null;

  const start = marker.index + marker[0].length;
  const end = body.indexOf('endstream', start);
  if (end < 0) return null;

  const data = Buffer.from(body.slice(start, end), 'latin1');
  if (!/FlateDecode/.test(body.slice(0, marker.index))) return data;

  try {
    return zlib.inflateSync(data);
  } catch {
    try {
      return zlib.inflateRawSync(data);
    } catch {
      return null;
    }
  }
}

/** Every reference "12 0 R" behind a key. */
function refsFor(body: string, key: string): number[] {
  const single = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`, 'g');
  const array = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`, 'g');
  const ids: number[] = [];

  for (const match of body.matchAll(single)) ids.push(Number(match[1]));
  for (const match of body.matchAll(array)) {
    for (const ref of (match[1] ?? '').matchAll(/(\d+)\s+\d+\s+R/g)) ids.push(Number(ref[1]));
  }
  return ids;
}

/* CMap */

/**
 * Reads a ToUnicode table.
 *
 * It consists of bfchar entries (one glyph, one character) and bfrange entries
 * (a range of glyphs, translated consecutively).
 */
export function parseToUnicode(text: string): Map<number, string> {
  const map = new Map<number, string>();

  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of (block[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(pair[1]!, 16), fromUtf16(pair[2]!));
    }
  }

  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1] ?? '';

    // Form 1: <from> <to> <target>
    for (const range of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const from = parseInt(range[1]!, 16);
      const to = parseInt(range[2]!, 16);
      const target = parseInt(range[3]!, 16);
      for (let i = 0; i <= to - from && i < 65536; i += 1) {
        map.set(from + i, String.fromCodePoint(target + i));
      }
    }

    // Form 2: <from> <to> [ <a> <b> ... ]
    for (const range of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      const from = parseInt(range[1]!, 16);
      let index = 0;
      for (const item of (range[3] ?? '').matchAll(/<([0-9A-Fa-f]+)>/g)) {
        map.set(from + index, fromUtf16(item[1]!));
        index += 1;
      }
    }
  }

  return map;
}

function fromUtf16(hex: string): string {
  let out = '';
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (Number.isFinite(code) && code) out += String.fromCharCode(code);
  }
  return out;
}

/* Text */

export type Token =
  | { type: 'font'; name: string }
  | { type: 'actual'; value: string }
  | { type: 'endmarked' }
  | { type: 'str'; value: string }
  | { type: 'hex'; value: string }
  | { type: 'break' }
  | { type: 'move'; y: number; relative: boolean };

/**
 * The strings of a content stream, in order, with font changes.
 *
 * One peculiarity is deliberately accounted for: marked content with
 * ActualText. Chromium and other producers put ligatures and special glyphs
 * into such a block and write the intended text beside it. Without evaluating
 * that, "Consulting" turns into "ConsulWing", because the ti ligature is a
 * glyph of its own with no entry in the translation table.
 */
export function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  const pattern = new RegExp([
    // Font change
    /\/([A-Za-z0-9#+._-]+)\s+[-\d.]+\s+Tf/.source,
    // ActualText as a string or as a hex sequence
    /\/ActualText\s*\(((?:[^()\\]|\\[\s\S])*)\)/.source,
    /\/ActualText\s*<([0-9A-Fa-f\s]+)>/.source,
    // End of the marked content
    /(EMC)\b/.source,
    // Ordinary strings
    /\(((?:[^()\\]|\\[\s\S])*)\)/.source,
    /<([0-9A-Fa-f\s]+)>/.source,
    /(T\*|'|")/.source,
    // Positioning: this is where the line breaks come from that a PDF does not
    // know itself. Without them the whole receipt runs into a single line, and
    // no evaluation finds a letterhead in it any more.
    /([-\d.]+)\s+([-\d.]+)\s+(Td|TD)\b/.source,
    /[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm\b/.source
  ].join('|'), 'g');

  let match = pattern.exec(content);

  while (match) {
    if (match[1] !== undefined) tokens.push({ type: 'font', name: match[1] });
    else if (match[2] !== undefined) tokens.push({ type: 'actual', value: unescapePdf(match[2]) });
    else if (match[3] !== undefined) tokens.push({ type: 'actual', value: fromUtf16(match[3].replace(/\s/g, '')) });
    else if (match[4] !== undefined) tokens.push({ type: 'endmarked' });
    else if (match[5] !== undefined) tokens.push({ type: 'str', value: unescapePdf(match[5]) });
    else if (match[6] !== undefined) tokens.push({ type: 'hex', value: match[6].replace(/\s/g, '') });
    else if (match[7] !== undefined) tokens.push({ type: 'break' });
    else if (match[10] !== undefined) tokens.push({ type: 'move', y: Number(match[9]), relative: true });
    else if (match[12] !== undefined) tokens.push({ type: 'move', y: Number(match[12]), relative: false });
    match = pattern.exec(content);
  }

  return tokens;
}

const PDF_ESCAPES: Record<string, string> = {
  n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\'
};

function unescapePdf(value: string): string {
  return value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, code: string) =>
    PDF_ESCAPES[code] ?? String.fromCharCode(parseInt(code, 8)));
}

/** A byte string read through WinAnsi. */
function winAnsi(value: string): string {
  return Buffer.from(value, 'latin1').toString('latin1')
    .replace(//g, '€').replace(//g, '"').replace(//g, '"')
    .replace(//g, '-').replace(//g, "'");
}

/* Fonts */

interface Font {
  map: Map<number, string> | null;
  /** Identity-H encodes a glyph in two bytes instead of one. */
  twoByte: boolean;
}

function viaMap(value: string, font: Font): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out += font.map?.get(code) ?? value[i];
  }
  return out;
}

function hexText(hex: string, font: Font | null): string {
  const step = font?.twoByte ? 4 : 2;
  let out = '';

  for (let i = 0; i + step <= hex.length; i += step) {
    const code = parseInt(hex.slice(i, i + step), 16);
    if (!Number.isFinite(code)) continue;

    const mapped = font?.map?.get(code);
    if (mapped !== undefined) out += mapped;
    else if (!font?.twoByte) out += String.fromCharCode(code);
  }

  return out;
}

const FONT_ENTRY = /\/([A-Za-z0-9#+._-]+)\s+(\d+)\s+\d+\s+R/g;

/**
 * Resolves font names to their tables.
 *
 * Fonts are cached per object but always looked up through the resources of
 * the page. Two pages may carry different fonts under the same name, and
 * regularly do: otherwise a one turns into glyph number one of the wrong
 * subset, which is any other letter.
 */
function fontResolver(objects: Map<number, string>) {
  const cache = new Map<number, Font | null>();

  const fontFor = (objectId: number): Font | null => {
    const cached = cache.get(objectId);
    if (cached !== undefined) return cached;

    const body = objects.get(objectId);
    if (!body) return null;

    const toUnicodeIds = refsFor(body, 'ToUnicode');
    const first = toUnicodeIds[0];
    const stream = first !== undefined ? streamOf(objects.get(first) ?? '') : null;

    const font: Font = {
      map: stream ? parseToUnicode(stream.toString('latin1')) : null,
      twoByte: /Identity-H/.test(body)
    };

    cache.set(objectId, font);
    return font;
  };

  /** The font names of one page, resolved to their objects. */
  return (pageBody: string): Map<string, Font | null> => {
    const table = new Map<string, Font | null>();

    // The resources sit either in the page itself or behind a reference.
    const bodies = [pageBody];
    for (const id of refsFor(pageBody, 'Resources')) {
      const resources = objects.get(id);
      if (resources) bodies.push(resources);
    }

    for (const body of bodies) {
      const scope = /\/Font\s*<<([\s\S]*?)>>/.exec(body)?.[1] ?? '';
      for (const entry of scope.matchAll(FONT_ENTRY)) {
        table.set(entry[1]!, fontFor(Number(entry[2])));
      }

      // Where the font dictionary lives in an object of its own, follow it.
      for (const id of refsFor(body, 'Font')) {
        const dict = objects.get(id);
        if (!dict) continue;
        for (const entry of dict.matchAll(FONT_ENTRY)) {
          table.set(entry[1]!, fontFor(Number(entry[2])));
        }
      }
    }

    return table;
  };
}

/* Extraction */

interface StreamText {
  text: string;
  /** Whether hex strings occurred, which means an embedded subset font. */
  sawHex: boolean;
}

/** Walks one content stream and turns its tokens back into text. */
function readStream(tokens: Token[], fonts: Map<string, Font | null>): StreamText {
  let text = '';
  let sawHex = false;
  let font: Font | null = null;
  // While an ActualText applies it counts, not the glyphs being painted.
  let marked: string | null = null;
  let lastY: number | null = null;

  for (const token of tokens) {
    if (token.type === 'move') {
      // A jump in height is a new line. Small jumps are super and subscript
      // and are not.
      const y: number = token.relative && lastY !== null ? lastY + token.y : token.y;
      if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n';
      lastY = y;
    } else if (token.type === 'font') {
      font = fonts.get(token.name) ?? null;
    } else if (token.type === 'actual') {
      marked = token.value;
      text += token.value;
    } else if (token.type === 'endmarked') {
      marked = null;
    } else if (token.type === 'break') {
      text += '\n';
    } else if (marked !== null) {
      // The glyphs inside the block would be a repetition.
      continue;
    } else if (token.type === 'str') {
      text += font?.map ? viaMap(token.value, font) : winAnsi(token.value);
    } else if (token.type === 'hex') {
      sawHex = true;
      text += hexText(token.value, font);
    }
  }

  return { text, sawHex };
}

export interface ExtractedText {
  text: string;
  pages: number;
  encoded: boolean;
  warning?: string;
}

/** Gets the text out of a PDF. */
export function extract(buffer: Buffer): ExtractedText {
  const objects = readObjects(buffer.toString('latin1'));
  const fontsOfPage = fontResolver(objects);

  let text = '';
  let sawHex = false;
  let pages = 0;

  for (const [, body] of objects) {
    if (!/\/Type\s*\/Page\b/.test(body)) continue;
    pages += 1;

    const pageFonts = fontsOfPage(body);

    for (const id of refsFor(body, 'Contents')) {
      const stream = streamOf(objects.get(id) ?? '');
      if (!stream) continue;

      const result = readStream(tokenize(stream.toString('latin1')), pageFonts);
      text += `${result.text}\n`;
      sawHex = sawHex || result.sawHex;
    }
  }

  const cleaned = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const readable = (cleaned.match(/[A-Za-zÄÖÜäöüß]/g) ?? []).length;

  if (readable < 20) {
    return {
      text: '',
      pages,
      encoded: sawHex,
      warning: pages
        ? 'In diesem PDF steht kein auslesbarer Text. Vermutlich ist es ein Scan, also ein Bild. Eine Texterkennung ist nicht eingebaut.'
        : 'Die Datei ließ sich nicht als PDF lesen.'
    };
  }

  return { text: cleaned, pages, encoded: sawHex };
}
