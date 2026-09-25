// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * A tiny XML builder.
 *
 * Deliberately without a library: for an e-invoice what matters most is that
 * the element order follows the schema exactly. Nested arrays control that
 * better than a generic object to XML mapper, where key order silently decides
 * validity.
 */

export type AttributeValue = string | number | null | undefined;
export type Attributes = Record<string, AttributeValue>;

/**
 * A node. Its own class so a node is unmistakably not an attribute bag:
 * el('a', el('b', 'x')) has to read as a child, el('a', { id: 1 }) as attributes.
 */
export class XmlNode {
  constructor(
    readonly name: string,
    readonly attrs: Attributes | null,
    readonly children: XmlChild
  ) {}
}

/** Null, undefined, false and empty strings drop out of the output. */
export type XmlChild = XmlNode | string | number | false | null | undefined | XmlChild[];

export function escapeText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttr(value: unknown): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function isAttributes(value: unknown): value is Attributes {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof XmlNode);
}

export function el(name: string, children: XmlChild): XmlNode;
export function el(name: string, attrs: Attributes | null, children?: XmlChild): XmlNode;
export function el(name: string, second?: Attributes | XmlChild, third?: XmlChild): XmlNode {
  if (third === undefined && !isAttributes(second)) return new XmlNode(name, null, second as XmlChild);
  return new XmlNode(name, isAttributes(second) ? second : null, third);
}

function isEmpty(node: XmlChild): boolean {
  if (node === null || node === undefined || node === false) return true;
  if (typeof node === 'string') return node.length === 0;
  return false;
}

function renderAttrs(attrs: Attributes | null): string {
  if (!attrs) return '';

  return Object.entries(attrs)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
    .join('');
}

function childList(children: XmlChild): XmlChild[] {
  if (Array.isArray(children)) return children.filter((child) => !isEmpty(child));
  return isEmpty(children) ? [] : [children];
}

export function render(node: XmlChild, indent = 0): string {
  if (isEmpty(node)) return '';
  const pad = '  '.repeat(indent);

  if (Array.isArray(node)) {
    return node.map((child) => render(child, indent)).filter(Boolean).join('\n');
  }

  if (!(node instanceof XmlNode)) return `${pad}${escapeText(node)}`;

  const attrs = renderAttrs(node.attrs);
  const children = childList(node.children);

  // An element without content is left out entirely. EN 16931 forbids empty
  // elements (PEPPOL-EN16931-R008), and a field that happens to be blank looks
  // exactly like one deliberately emptied, so there is no way to tell them
  // apart and no reason to try.
  if (!children.length) return '';

  const [only] = children;
  if (children.length === 1 && !(only instanceof XmlNode) && !Array.isArray(only)) {
    return `${pad}<${node.name}${attrs}>${escapeText(only)}</${node.name}>`;
  }

  const inner = children.map((child) => render(child, indent + 1)).filter(Boolean).join('\n');
  if (!inner) return '';
  return `${pad}<${node.name}${attrs}>\n${inner}\n${pad}</${node.name}>`;
}

export function document(root: XmlChild): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(root, 0)}\n`;
}

/** ISO date to YYYYMMDD, the format 102 that CII expects. */
export function compactDate(isoDate: string | null | undefined): string {
  return isoDate ? String(isoDate).replace(/-/g, '') : '';
}
