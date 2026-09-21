// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Builds an sRGB colour profile (ICC v2, matrix/TRC).
 *
 * PDF/A requires an OutputIntent with an embedded colour profile. Rather than
 * shipping a foreign .icc file of unclear licensing, a valid profile is built
 * here from the sRGB figures: primaries adapted to D50, plus the sRGB transfer
 * function as a curve table.
 */

const HEADER_SIZE = 128;
const CURVE_POINTS = 1024;

/** The D50 white point, also written into the header. */
const WHITE_POINT = { x: 0.9642, y: 1.0, z: 0.8249 };

const s15Fixed16 = (value: number): number => Math.round(value * 65536);

function signature(text: string): Buffer {
  return Buffer.from(text, 'ascii');
}

/** XYZType: signature, reserved, three s15Fixed16 values. */
function xyzTag(x: number, y: number, z: number): Buffer {
  const buffer = Buffer.alloc(20);
  signature('XYZ ').copy(buffer, 0);
  buffer.writeInt32BE(s15Fixed16(x), 8);
  buffer.writeInt32BE(s15Fixed16(y), 12);
  buffer.writeInt32BE(s15Fixed16(z), 16);
  return buffer;
}

/** curveType with 1024 samples of the sRGB curve. */
function curveTag(): Buffer {
  const buffer = Buffer.alloc(12 + CURVE_POINTS * 2);
  signature('curv').copy(buffer, 0);
  buffer.writeUInt32BE(CURVE_POINTS, 8);

  for (let i = 0; i < CURVE_POINTS; i += 1) {
    const value = i / (CURVE_POINTS - 1);
    const linear = value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    buffer.writeUInt16BE(Math.max(0, Math.min(65535, Math.round(linear * 65535))), 12 + i * 2);
  }

  return buffer;
}

/** textDescriptionType, as ICC v2 demands for the desc tag. */
function descTag(text: string): Buffer {
  const ascii = Buffer.from(`${text}\0`, 'ascii');
  // Unicode and ScriptCode sections stay empty but are mandatory.
  const buffer = Buffer.alloc(12 + ascii.length + 12 + 2 + 1 + 67);
  signature('desc').copy(buffer, 0);
  buffer.writeUInt32BE(ascii.length, 8);
  ascii.copy(buffer, 12);
  return buffer;
}

/** textType for the copyright tag. */
function textTag(text: string): Buffer {
  const ascii = Buffer.from(`${text}\0`, 'ascii');
  const buffer = Buffer.alloc(8 + ascii.length);
  signature('text').copy(buffer, 0);
  ascii.copy(buffer, 8);
  return buffer;
}

function padding(length: number): number {
  return (4 - (length % 4)) % 4;
}

interface Tag {
  sig: string;
  data: Buffer;
}

interface TagEntry {
  sig: string;
  offset: number;
  size: number;
}

function profileTags(): Tag[] {
  return [
    { sig: 'desc', data: descTag('sRGB IEC61966-2.1') },
    { sig: 'wtpt', data: xyzTag(WHITE_POINT.x, WHITE_POINT.y, WHITE_POINT.z) },
    { sig: 'rXYZ', data: xyzTag(0.4360, 0.2225, 0.0139) },
    { sig: 'gXYZ', data: xyzTag(0.3851, 0.7169, 0.0971) },
    { sig: 'bXYZ', data: xyzTag(0.1431, 0.0606, 0.7141) },
    { sig: 'rTRC', data: curveTag() },
    { sig: 'cprt', data: textTag('Public Domain') }
  ];
}

interface Layout {
  entries: TagEntry[];
  blocks: Buffer[];
  totalSize: number;
}

/**
 * Places every tag behind the table and records where it landed.
 *
 * The three channel curves are identical, so gTRC and bTRC get their own table
 * entries pointing at the rTRC block instead of a copy each.
 */
function layoutTags(tags: Tag[]): Layout {
  const tableSize = 4 + (tags.length + 2) * 12;
  const entries: TagEntry[] = [];
  const blocks: Buffer[] = [];
  let offset = HEADER_SIZE + tableSize;

  for (const tag of tags) {
    entries.push({ sig: tag.sig, offset, size: tag.data.length });
    blocks.push(tag.data, Buffer.alloc(padding(tag.data.length)));
    offset += tag.data.length + padding(tag.data.length);
  }

  const curve = entries.find((entry) => entry.sig === 'rTRC');
  if (!curve) throw new Error('rTRC tag missing');
  entries.push({ ...curve, sig: 'gTRC' }, { ...curve, sig: 'bTRC' });

  return { entries, blocks, totalSize: offset };
}

function profileHeader(totalSize: number): Buffer {
  const header = Buffer.alloc(HEADER_SIZE);
  const now = new Date();

  header.writeUInt32BE(totalSize, 0);
  signature('none').copy(header, 4);
  header.writeUInt32BE(0x02100000, 8); // version 2.1
  signature('mntr').copy(header, 12);
  signature('RGB ').copy(header, 16);
  signature('XYZ ').copy(header, 20);

  header.writeUInt16BE(now.getUTCFullYear(), 24);
  header.writeUInt16BE(now.getUTCMonth() + 1, 26);
  header.writeUInt16BE(now.getUTCDate(), 28);
  header.writeUInt16BE(now.getUTCHours(), 30);
  header.writeUInt16BE(now.getUTCMinutes(), 32);
  header.writeUInt16BE(now.getUTCSeconds(), 34);

  signature('acsp').copy(header, 36);
  header.writeUInt32BE(0, 64); // rendering intent: perceptual
  header.writeInt32BE(s15Fixed16(WHITE_POINT.x), 68);
  header.writeInt32BE(s15Fixed16(WHITE_POINT.y), 72);
  header.writeInt32BE(s15Fixed16(WHITE_POINT.z), 76);

  return header;
}

function tagTable(entries: TagEntry[]): Buffer {
  const table = Buffer.alloc(4 + entries.length * 12);
  table.writeUInt32BE(entries.length, 0);

  entries.forEach((entry, index) => {
    const base = 4 + index * 12;
    signature(entry.sig).copy(table, base);
    table.writeUInt32BE(entry.offset, base + 4);
    table.writeUInt32BE(entry.size, base + 8);
  });

  return table;
}

export function buildSrgbProfile(): Buffer {
  const { entries, blocks, totalSize } = layoutTags(profileTags());
  return Buffer.concat([profileHeader(totalSize), tagTable(entries), ...blocks], totalSize);
}

let cached: Buffer | null = null;

/** The profile, built once and reused. */
export function srgbProfile(): Buffer {
  if (!cached) cached = buildSrgbProfile();
  return cached;
}
