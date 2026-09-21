// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import type { Cents } from '../shared/types';

/**
 * Reading XML.
 *
 * The counterpart to the builder in export/xml and just as deliberately small:
 * from an e-invoice only what the standard puts at fixed places gets read.
 *
 * Two decisions that make all the rest simple:
 *
 *   Namespaces are cut off. "ram:SellerTradeParty" becomes
 *   "SellerTradeParty". For reading an EN 16931 invoice that suffices: the
 *   element names are unambiguous within it, and the prefix is freely
 *   choosable anyway, so comparing it would only give false confidence.
 *
 *   Nothing is validated. Whether an invoice conforms is what a validator
 *   says, not this reader. It tries to get out what is in the document and
 *   reports what it could not find.
 */

export type Attributes = Record<string, string>;

/** One parsed node. */
export class Node {
  readonly children: Node[] = [];
  text = '';

  constructor(readonly name: string, readonly attrs: Attributes = {}) {}

  /** The first child of this name. */
  child(name: string): Node | null {
    return this.children.find((node) => node.name === name) ?? null;
  }

  /** Every child of this name. */
  childs(name: string): Node[] {
    return this.children.filter((node) => node.name === name);
  }
}

export function stripNamespace(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

function decodeEntities(value: string): string {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    // The ampersand last, otherwise "&amp;lt;" would become "<".
    .replace(/&amp;/g, '&');
}

function parseAttrs(raw: string): Attributes {
  const attrs: Attributes = {};
  const pattern = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;

  let match = pattern.exec(raw);
  while (match) {
    const key = stripNamespace(match[1] ?? match[3] ?? '');
    attrs[key] = decodeEntities(match[2] !== undefined ? match[2] : (match[4] ?? ''));
    match = pattern.exec(raw);
  }

  return attrs;
}

/** Determines the character set: UTF-8, otherwise Windows-1252. */
export function decode(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }

  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('�')) return utf8;

  const declared = /encoding\s*=\s*["']([\w-]+)["']/i.exec(buffer.subarray(0, 200).toString('latin1'));
  const name = declared?.[1]?.toLowerCase() ?? '';
  return name.includes('utf') ? utf8 : buffer.toString('latin1');
}

/**
 * Strips what contributes nothing to reading and would only trip the parser.
 *
 * CDATA goes first: its content may hold angle brackets that would otherwise
 * end the tag scan in the middle of the section. Escaped, it travels the same
 * path as any other content.
 */
function stripNoise(text: string): string {
  return text
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/gi, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, content: string) =>
      String(content).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
}

/** Reads an XML document and returns its root node. */
export function parse(input: string | Buffer): Node | null {
  const text = stripNoise(Buffer.isBuffer(input) ? decode(input) : String(input));

  const root = new Node('#root');
  const stack: Node[] = [root];
  const pattern = /<([^>]+)>/g;
  let lastIndex = 0;
  let match = pattern.exec(text);

  while (match) {
    const between = text.slice(lastIndex, match.index);
    if (between.trim()) {
      const current = stack[stack.length - 1]!;
      current.text += decodeEntities(between);
    }
    lastIndex = pattern.lastIndex;

    const tag = match[1] ?? '';

    if (tag.startsWith('/')) {
      if (stack.length > 1) stack.pop();
    } else {
      const selfClosing = tag.endsWith('/');
      const body = selfClosing ? tag.slice(0, -1) : tag;
      const space = body.search(/\s/);
      const name = stripNamespace(space === -1 ? body : body.slice(0, space));
      const attrs = space === -1 ? {} : parseAttrs(body.slice(space));

      const node = new Node(name, attrs);
      stack[stack.length - 1]!.children.push(node);
      if (!selfClosing) stack.push(node);
    }

    match = pattern.exec(text);
  }

  return root.children[0] ?? null;
}

/**
 * Follows a path of element names.
 *
 * find(root, 'A/B/C') takes the first matching child at every step. For
 * anything that occurs exactly once in an invoice that is right; repetitions
 * are what findAll is for.
 */
export function find(node: Node | null, path: string): Node | null {
  let current: Node | null = node;

  for (const name of String(path).split('/')) {
    if (!current) return null;
    if (name === '' || name === '.') continue;
    current = current.child(name);
  }

  return current ?? null;
}

/** Every node at the end of the path, not just the first. */
export function findAll(node: Node, path: string): Node[] {
  const parts = String(path).split('/').filter((part) => part && part !== '.');
  let level = [node];

  for (const name of parts) {
    const next: Node[] = [];
    for (const item of level) next.push(...item.childs(name));
    level = next;
    if (!level.length) return [];
  }

  return level;
}

/** The text at the end of the path, without surrounding whitespace. */
export function text(node: Node | null, path?: string): string {
  const found = path ? find(node, path) : node;
  return found ? found.text.trim() : '';
}

function rawValue(node: Node | null, path?: string): string {
  return (path ? text(node, path) : (node ? node.text.trim() : '')).replace(/\s/g, '');
}

/**
 * A decimal from the XML, in cents.
 *
 * Deliberately not the input heuristic from money: in XML the dot is always
 * the decimal separator. "1.000" is one here, not a thousand, and exactly that
 * difference otherwise costs a factor of a thousand.
 */
export function amount(node: Node | null, path?: string): Cents | null {
  const raw = rawValue(node, path);
  if (!raw) return null;

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** A plain number (a percentage, a quantity) from the XML. */
export function number(node: Node | null, path?: string): number | null {
  const raw = rawValue(node, path);
  if (!raw) return null;

  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}
