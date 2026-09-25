// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { PDFDocument, PDFName, PDFString, PDFHexString, AFRelationship } from 'pdf-lib';
import crypto from 'node:crypto';

import { srgbProfile } from './icc';
import { escapeText } from './xml';

/**
 * Turns a rendered PDF into a ZUGFeRD document: the CII XML is embedded as
 * factur-x.xml, together with the XMP metadata and the OutputIntent that
 * PDF/A-3 demands.
 *
 * Put honestly: the XML sits in the document the way the standard wants and
 * receiving systems find it. Whether the skeleton Chromium produced matches
 * PDF/A-3b in every detail can only be settled with a checker such as veraPDF.
 * Whoever needs a verified file takes the XRechnung export, where the XML is
 * the document itself.
 */

const FACTUR_X_NAMESPACE = 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#';

/** The extension schema properties, which PDF/A requires to be declared. */
const FACTUR_X_PROPERTIES: [string, string][] = [
  ['DocumentFileName', 'Name der eingebetteten XML-Rechnung'],
  ['DocumentType', 'Art des Dokuments'],
  ['Version', 'Version des Factur-X-Schemas'],
  ['ConformanceLevel', 'Profil der eingebetteten Rechnung']
];

function xmpDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export interface XmpFields {
  title: string;
  author: string;
  subject: string;
  createdAt?: Date;
  conformanceLevel: string;
  attachmentName: string;
}

export function buildXmp({ title, author, subject, createdAt, conformanceLevel, attachmentName }: XmpFields): string {
  const now = xmpDate(createdAt ?? new Date());
  const properties = FACTUR_X_PROPERTIES
    .map(([name, description]) => `        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>${name}</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>${escapeText(description)}</pdfaProperty:description>
        </rdf:li>`)
    .join('\n');

  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeText(title)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${escapeText(author)}</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeText(subject)}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>NestEgg</xmp:CreatorTool>
   <xmp:CreateDate>${now}</xmp:CreateDate>
   <xmp:ModifyDate>${now}</xmp:ModifyDate>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>NestEgg</pdf:Producer>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:fx="${FACTUR_X_NAMESPACE}">
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:DocumentFileName>${escapeText(attachmentName)}</fx:DocumentFileName>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>${escapeText(conformanceLevel)}</fx:ConformanceLevel>
  </rdf:Description>
  <rdf:Description rdf:about=""
    xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
    xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
    xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas>
    <rdf:Bag>
     <rdf:li rdf:parseType="Resource">
      <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
      <pdfaSchema:namespaceURI>${FACTUR_X_NAMESPACE}</pdfaSchema:namespaceURI>
      <pdfaSchema:prefix>fx</pdfaSchema:prefix>
      <pdfaSchema:property>
       <rdf:Seq>
${properties}
       </rdf:Seq>
      </pdfaSchema:property>
     </rdf:li>
    </rdf:Bag>
   </pdfaExtension:schemas>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export interface InvoiceMeta {
  title?: string;
  author?: string;
  subject?: string;
  attachmentName?: string;
  conformanceLevel?: string;
}

/** Writes the XMP packet as an uncompressed stream, as PDF/A requires. */
function attachMetadata(doc: PDFDocument, xmp: string): void {
  const stream = doc.context.stream(xmp, {
    Type: PDFName.of('Metadata'),
    Subtype: PDFName.of('XML')
  });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
}

/** The OutputIntent with the embedded sRGB profile. */
function attachOutputIntent(doc: PDFDocument): void {
  const iccRef = doc.context.register(doc.context.stream(srgbProfile(), { N: 3 }));
  const outputIntent = doc.context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB'),
    OutputCondition: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: iccRef
  });
  doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([outputIntent]));
}

/**
 * The file identifier in the trailer.
 *
 * ISO 19005 requires it, and Chromium writes no trailer ID at all, which is
 * the one hard PDF/A violation its output otherwise does not have. Both halves
 * are identical here because the file is new: the first identifies the
 * original, the second the current revision, and for a first version they are
 * the same.
 */
function attachFileId(doc: PDFDocument): void {
  const id = PDFHexString.of(crypto.randomBytes(16).toString('hex').toUpperCase());
  doc.context.trailerInfo.ID = doc.context.obj([id, id]);
}

/** Embeds the invoice XML into a rendered PDF and returns the new bytes. */
export async function embedInvoiceXml(
  pdfBytes: Uint8Array,
  xml: string,
  meta: InvoiceMeta = {}
): Promise<Uint8Array> {
  const attachmentName = meta.attachmentName ?? 'factur-x.xml';
  const conformanceLevel = meta.conformanceLevel ?? 'EN 16931';
  const title = meta.title ?? 'Rechnung';
  const author = meta.author ?? '';
  const subject = meta.subject ?? 'Rechnung';
  const now = new Date();

  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });

  doc.setTitle(title);
  doc.setAuthor(author);
  doc.setSubject(subject);
  doc.setProducer('NestEgg');
  doc.setCreator('NestEgg');
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  await doc.attach(Buffer.from(xml, 'utf8'), attachmentName, {
    mimeType: 'text/xml',
    description: 'Rechnungsdaten nach EN 16931',
    creationDate: now,
    modificationDate: now,
    // Factur-X prescribes Alternative: the XML is an equal rendition of the
    // same invoice, not an extra attachment.
    afRelationship: AFRelationship.Alternative
  });

  attachMetadata(doc, buildXmp({ title, author, subject, createdAt: now, conformanceLevel, attachmentName }));
  attachOutputIntent(doc);
  attachFileId(doc);

  return doc.save({ useObjectStreams: false });
}
