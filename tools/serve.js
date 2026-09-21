'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Kleiner Server für die Oberflächenvorschau im Browser. Die App selbst
 * braucht ihn nicht.
 *
 * Neben den Dateien beantwortet er einen Endpunkt: die Dokumentvorschau wird
 * hier mit denselben Modulen gerendert wie in der App. Dadurch lässt sich der
 * Gestaltungsdialog im Browser genauso bedienen wie in Electron.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const documentHtml = require('../src/export/document-html');
const { buildCss } = require('../src/export/document-css');
const themeLib = require('../src/export/theme');
const doctypes = require('../src/domain/doctypes');
const invoicesDomain = require('../src/domain/invoices');

const { ROOT, TOOLS } = require('./paths');
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.pdf': 'application/pdf'
};

function fixture() {
  return JSON.parse(fs.readFileSync(path.join(TOOLS, 'fixture.json'), 'utf8'));
}

function sampleDocument(documentType, settings) {
  const type = doctypes.getType(documentType);
  const texts = (settings.texts || {})[type.id] || {};
  const offer = type.group === 'offer';
  const today = '2026-09-17';

  return {
    number: invoicesDomain.buildNumber(
      (settings.invoice.numberPatterns || {})[type.id] || type.defaultPattern, 42, today
    ),
    documentType: type.id,
    issueDate: today,
    deliveryDate: offer ? null : today,
    dueDate: offer ? null : invoicesDomain.addDays(today, 14),
    validUntil: offer ? invoicesDomain.addDays(today, 30) : null,
    tolerancePercent: type.nonBinding ? 15 : null,
    showSignature: offer,
    currency: 'EUR',
    payments: [],
    salutation: settings.invoice.salutation || '',
    intro: texts.intro || '',
    bodyText: texts.body || '',
    outro: texts.outro || '',
    items: [
      { name: 'Konzeption und Beratung', description: 'Workshop, Ausarbeitung und Abstimmung', quantity: 12, unit: 'HUR', unitPriceNet: 12000, vatRate: 19, discountPercent: 0 },
      { name: 'Umsetzung', quantity: 1, unit: 'LS', unitPriceNet: 180000, vatRate: 19, discountPercent: 10 },
      { name: 'Material, weiterberechnet', quantity: 4, unit: 'C62', unitPriceNet: 2500, vatRate: 7, discountPercent: 0 }
    ]
  };
}

function handlePreview(body, res) {
  const request = JSON.parse(body || '{}');
  const data = fixture();
  const settings = data.data.settings;
  const merged = themeLib.normalizeTheme({ ...settings.theme, ...(request.theme || {}) });

  let document = null;
  let customer = {
    name: 'Kundenfirma GmbH', contactName: 'Frau Muster', customerNumber: 'K-001',
    street: 'Kundenallee 7', zip: '20095', city: 'Hamburg', country: 'DE'
  };

  if (request.documentId) {
    const found = data.data.invoices.find((i) => i.id === request.documentId);
    if (found) {
      document = found;
      customer = data.data.customers.find((c) => c.id === found.customerId) || customer;
    }
  }
  if (!document) document = sampleDocument(request.documentType || 'invoice', settings);

  const html = documentHtml.render(document, settings.company, customer, { theme: merged, preview: true });

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    ok: true,
    data: { html, css: buildCss(merged, { preview: true }), theme: merged, preset: themeLib.detectPreset(merged) }
  }));
}

function handleApplyPreset(body, res) {
  const request = JSON.parse(body || '{}');
  const base = { ...fixture().data.settings.theme, ...(request.theme || {}) };
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, data: themeLib.applyPreset(base, request.presetId) }));
}

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  if (req.method === 'POST' && (url === '/api/theme-preview' || url === '/api/theme-preset')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        if (url === '/api/theme-preview') handlePreview(body, res);
        else handleApplyPreset(body, res);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(err && err.message) }));
      }
    });
    return;
  }

  // Die Vorschau lädt ihre Nachbardateien relativ. Unter "/" wäre mock.js
  // deshalb nicht zu finden, also wird auf den richtigen Pfad verwiesen statt
  // die Seite an falscher Stelle auszuliefern.
  if (url === '/') {
    res.writeHead(302, { Location: '/tools/preview.html' }).end();
    return;
  }

  const target = path.join(ROOT, url);
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('verboten');
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404).end('nicht gefunden');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Vorschau laeuft auf http://localhost:${PORT}/tools/preview.html`));
