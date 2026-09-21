// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { normalizeTheme, FONT_STACKS, tint, readableOn, type RawTheme, type Theme } from './theme';

/**
 * Builds the document CSS from a theme.
 *
 * One source for both the PDF and the preview. Deliberately without
 * transparency and without web fonts, so the result stays as close to the
 * PDF/A rules as it can.
 */

export interface CssOptions {
  /** Drops the fixed page height so the preview grows instead of cutting off. */
  preview?: boolean;
}

export function buildCss(rawTheme?: RawTheme | null, options: CssOptions = {}): string {
  const t = normalizeTheme(rawTheme);
  const font = FONT_STACKS[t.fontFamily];
  const headerText = readableOn(t.accentColor);
  const softAccent = tint(t.accentColor, 0.9);
  const zebra = tint(t.lineColor, 0.55);

  const tableHeader = t.tableHeaderAccent
    ? `background: ${t.accentColor}; color: ${headerText}; padding: 2mm 2mm; border-bottom: none;`
    : `color: ${t.mutedColor}; border-bottom: 0.8pt solid ${t.textColor}; padding: 0 2mm 1.5mm 0;`;

  const rowBorder = t.tableStyle === 'plain'
    ? 'border-bottom: none;'
    : `border-bottom: 0.3pt solid ${t.lineColor};`;

  const zebraRule = t.tableStyle === 'zebra'
    ? `table.items tbody tr:nth-child(even) td { background: ${zebra}; }`
    : '';

  const senderLine = {
    rule: `border-bottom: 0.4pt solid ${t.mutedColor}; padding-bottom: 1mm; margin-bottom: 3mm;`,
    plain: 'padding-bottom: 1mm; margin-bottom: 3mm;',
    none: 'display: none;'
  }[t.senderLineStyle];

  const sheetHeight = options.preview ? 'min-height: 297mm;' : 'height: 297mm;';

  return `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${font};
    font-size: ${t.fontSize}pt;
    line-height: ${t.lineHeight};
    color: ${t.textColor};
    background: ${t.paperColor};
  }

  .sheet {
    width: 210mm;
    ${sheetHeight}
    padding: ${t.margins.top}mm ${t.margins.right}mm ${t.margins.bottom}mm ${t.margins.left}mm;
    position: relative;
    background: ${t.paperColor};
  }
  ${accentBarCss(t)}

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm;
    flex-direction: ${t.logoPosition === 'left' ? 'row-reverse' : 'row'}; }
  .logo { max-height: ${t.logoHeight}mm; max-width: 60mm; ${t.logoPosition === 'none' ? 'display: none;' : ''} }

  /* The QR code is pinned top right rather than flexed beside the logo:
     otherwise the two swap sides as soon as the logo moves left. Many
     scanners need the white margin, hence the quiet zone in the SVG. */
  .qr-box {
    position: absolute;
    top: ${t.margins.top}mm;
    right: ${t.margins.right}mm;
    text-align: center;
  }
  .qr { display: block; }
  .qr-note { font-size: ${(t.fontSize * 0.68).toFixed(1)}pt; color: ${t.mutedColor}; margin-top: 0.8mm; }
  .sender-name { font-size: ${(t.fontSize * 1.25).toFixed(1)}pt; font-weight: 600; letter-spacing: 0.2px; }
  .sender-sub { font-size: ${(t.fontSize * 0.86).toFixed(1)}pt; color: ${t.mutedColor}; }

  .address-area { margin-top: 12mm; display: flex; justify-content: space-between; gap: 10mm; }
  .address { width: 85mm; }
  .sender-line { font-size: ${(t.fontSize * 0.71).toFixed(1)}pt; color: ${t.mutedColor}; ${senderLine} }
  ${t.showSenderLine ? '' : '.sender-line { display: none; }'}

  .info { width: 75mm; font-size: ${(t.fontSize * 0.9).toFixed(1)}pt; }
  .info table { width: 100%; border-collapse: collapse; }
  .info td { padding: 0.6mm 0; vertical-align: top; }
  .info td:first-child { color: ${t.mutedColor}; padding-right: 4mm; }
  .info td:last-child { text-align: right; font-variant-numeric: tabular-nums; }

  h1 {
    font-size: ${t.titleSize}pt;
    font-weight: 600;
    margin: 14mm 0 2mm;
    letter-spacing: ${t.titleUppercase ? '1px' : '0.3px'};
    color: ${t.titleAccent ? t.accentColor : t.textColor};
    text-transform: ${t.titleUppercase ? 'uppercase' : 'none'};
    text-align: ${t.titleAlign === 'right' ? 'right' : 'left'};
  }
  .intro, .body-text, .outro { margin: 0 0 5mm; white-space: pre-line; }
  .salutation { margin: 0 0 3mm; }

  table.items { width: 100%; border-collapse: collapse; margin-top: 4mm; }
  table.items th {
    text-align: left;
    font-size: ${(t.fontSize * 0.81).toFixed(1)}pt;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    font-weight: 600;
    ${tableHeader}
  }
  table.items td { padding: 2mm 2mm 2mm 0; ${rowBorder} vertical-align: top; }
  ${t.tableHeaderAccent ? 'table.items td:first-child { padding-left: 2mm; }' : ''}
  ${zebraRule}
  table.items .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.items th.num { text-align: right; }
  .pos-name { font-weight: 500; }
  .pos-desc { font-size: ${(t.fontSize * 0.86).toFixed(1)}pt; color: ${t.mutedColor}; margin-top: 0.8mm; }

  /* Air below, so the text after the total does not stick to it. */
  .totals { margin: 5mm 0 6mm; display: flex; justify-content: flex-end; }
  .totals table { border-collapse: collapse; min-width: 85mm; }
  .totals td { padding: 1.4mm 0; }
  .totals td.num { text-align: right; font-variant-numeric: tabular-nums; padding-left: 8mm; }
  .totals tr.subtotal td { border-top: 0.4pt solid ${t.mutedColor}; }
  .totals tr.total td {
    border-top: 0.8pt solid ${t.textColor};
    font-weight: 600;
    font-size: ${(t.fontSize * 1.14).toFixed(1)}pt;
    padding-top: 2mm;
    ${t.totalsHighlight ? `background: ${softAccent}; padding-left: 3mm; padding-right: 3mm; color: ${t.accentColor};` : ''}
  }
  ${t.totalsHighlight ? '.totals tr.total td:first-child { padding-left: 3mm; }' : ''}

  .hint { font-size: ${(t.fontSize * 0.86).toFixed(1)}pt; color: ${t.mutedColor}; margin: 2mm 0 0; }
  .signature { margin-top: 12mm; display: flex; gap: 14mm; font-size: ${(t.fontSize * 0.86).toFixed(1)}pt; color: ${t.mutedColor}; }
  .signature div { flex: 1; border-top: 0.4pt solid ${t.lineColor}; padding-top: 1.5mm; }

  .footer {
    position: absolute;
    left: ${t.margins.left}mm;
    right: ${t.margins.right}mm;
    bottom: ${Math.max(6, t.margins.bottom - 6)}mm;
    border-top: 0.4pt solid ${t.lineColor};
    padding-top: 2.5mm;
    display: ${t.showFooter ? 'flex' : 'none'};
    gap: 6mm;
    font-size: ${(t.fontSize * 0.71).toFixed(1)}pt;
    color: ${t.mutedColor};
    line-height: 1.35;
  }
  .footer div { flex: 1; }
  .footer-note { margin-top: 2mm; font-size: ${(t.fontSize * 0.71).toFixed(1)}pt; color: ${t.mutedColor}; }

  /* Number and date as a narrow row below the title instead of a table
     next to the address. */
  .info-row {
    display: ${t.infoStyle === 'row' ? 'flex' : 'none'};
    justify-content: space-between; gap: 8mm; flex-wrap: wrap;
    margin: 0 0 3mm; padding-bottom: 1.5mm;
    font-size: ${(t.fontSize * 0.86).toFixed(1)}pt;
  }
  .info-row .pair { white-space: nowrap; }
  .info-row .pair b { font-weight: 600; }
  .info-row .pair span { color: ${t.mutedColor}; }
  ${t.infoStyle === 'row' ? '.address-area .info { display: none; }' : ''}

  /* Place and date above the title, aligned with it. */
  .place-line {
    display: ${t.showPlaceLine ? 'block' : 'none'};
    margin: 12mm 0 0;
    font-size: ${(t.fontSize * 0.9).toFixed(1)}pt;
    color: ${t.mutedColor};
    text-align: ${t.titleAlign === 'right' ? 'right' : 'left'};
  }
  ${t.showPlaceLine ? 'h1 { margin-top: 2mm; }' : ''}

  /* The own signature. The script face comes from the system: a web font
     would bloat the file and be missing offline. */
  .own-signature { margin-top: 8mm; }
  .sign-greeting { margin-bottom: 2mm; }
  .sign-image { display: block; }
  .sign-text {
    font-family: "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive;
    font-size: ${(t.fontSize * 1.6).toFixed(1)}pt;
    color: ${t.accentColor};
    margin: 1mm 0;
  }
  .sign-name { font-size: ${(t.fontSize * 0.9).toFixed(1)}pt; margin-top: 1mm; }

  /* Glyphs in front of the footer contact lines. They are plain text and
     need no font file: every system has them. */
  ${t.footerIcons ? `.footer .icon::before {
    content: attr(data-icon); margin-right: 1.2mm; color: ${t.accentColor};
  }` : ''}
  `.trim();
}

/**
 * The accent bar.
 *
 * 'left' is the stripe along the left edge, 'edges' are two full width bars
 * above and below.
 */
function accentBarCss(t: Theme): string {
  if (t.accentBar === 'left') {
    return `.sheet::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0;
    width: 4mm; background: ${t.accentColor};
  }`;
  }

  if (t.accentBar === 'edges') {
    return `.sheet::before {
    content: ""; position: absolute; left: 0; right: 0; top: 0;
    height: 3mm; background: ${t.accentColor};
  }
  .sheet::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0;
    height: 3mm; background: ${t.accentColor};
  }`;
  }

  return '';
}
