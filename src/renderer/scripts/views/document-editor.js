'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Der Editor für alle Geschäftsdokumente.
 *
 * Rechnung, Storno, Angebot und Kostenvoranschlag teilen sich Aufbau,
 * Positionen und Summenrechnung. Was sich unterscheidet, sind die Kopfdaten:
 * eine Rechnung hat Leistungsdatum und Fälligkeit, ein Angebot eine Bindefrist
 * und beim Kostenvoranschlag eine Toleranz. Deshalb ein Editor statt zwei.
 */

window.DocumentEditor = (function documentEditor() {
  const { h, fmt, field, select, checkbox } = UI;

  function newItem(settings) {
    return {
      name: '',
      description: '',
      quantity: 1,
      unit: 'C62',
      unitPriceNet: 0,
      vatRate: settings.invoice.defaultVatRate,
      vatKey: null,
      discountPercent: 0
    };
  }

  /** Summen im Renderer rechnen, damit die Anzeige beim Tippen mitläuft. */
  function computeTotals(items) {
    const groups = new Map();
    let netTotal = 0;
    for (const item of items) {
      const net = Math.round(item.quantity * item.unitPriceNet * (1 - (item.discountPercent || 0) / 100));
      netTotal += net;
      const key = item.vatKey ? `k:${item.vatKey}` : `r:${item.vatRate}`;
      if (!groups.has(key)) groups.set(key, { rate: item.vatRate, vatKey: item.vatKey, base: 0, tax: 0 });
      groups.get(key).base += net;
    }
    for (const group of groups.values()) group.tax = group.rate ? Math.round((group.base * group.rate) / 100) : 0;
    const breakdown = [...groups.values()].sort((a, b) => b.rate - a.rate);
    const vatTotal = breakdown.reduce((s, g) => s + g.tax, 0);
    return { netTotal, vatTotal, grossTotal: netTotal + vatTotal, breakdown };
  }

  /**
   * @param {object} app         die Schnittstelle aus app.js
   * @param {object} options     { documentType, existing, onDone }
   */
  function open(app, options = {}) {
    const settings = app.settings;
    const documentType = options.documentType || (options.existing && options.existing.documentType) || 'invoice';
    const type = app.boot.documentTypes[documentType] || app.boot.documentTypes.invoice;
    const offer = type.group === 'offer';
    const existing = options.existing || null;
    const locked = Boolean(existing && existing.number);

    if (!app.data.customers.length) {
      UI.toast('Lege zuerst einen Kunden an.', 'error');
      app.navigate('customers');
      return;
    }

    const texts = (settings.texts || {})[type.id] || {};
    const draft = existing
      ? JSON.parse(JSON.stringify({ ...existing, computed: undefined, resolvedStatus: undefined }))
      : {
          id: null,
          number: null,
          documentType: type.id,
          status: 'draft',
          customerId: app.data.customers[0].id,
          issueDate: app.boot.today,
          deliveryDate: offer ? null : app.boot.today,
          deliveryPeriod: null,
          paymentTermsDays: offer ? null : settings.invoice.paymentTermsDays,
          dueDate: offer ? null : UI.addDays(app.boot.today, settings.invoice.paymentTermsDays),
          validUntil: offer ? UI.addDays(app.boot.today, settings.invoice.quoteValidityDays || 30) : null,
          tolerancePercent: type.nonBinding ? settings.invoice.estimateTolerance || 15 : null,
          showSignature: offer,
          items: [newItem(settings)],
          salutation: settings.invoice.salutation || '',
          intro: texts.intro || '',
          bodyText: texts.body || '',
          outro: texts.outro || '',
          buyerReference: '',
          orderReference: '',
          payments: [],
          currency: 'EUR'
        };

    if (!draft.items.length) draft.items = [newItem(settings)];
    draft.documentType = type.id;

    const body = h('div');
    const summary = h('div');
    const problems = h('div');

    /**
     * Die Nummer, die das Dokument schon trägt.
     *
     * Sie darf nicht in den Entwurf wandern: `invoices:finalize` hält ein
     * Dokument mit Nummer für bereits festgeschrieben und täte dann nichts
     * mehr. Deshalb reicht der Editor sie getrennt an das Festschreiben weiter.
     */
    let ownNumber = '';

    /** Nacherfasst wird alles, was vor dem Beginn der Buchführung liegt. */
    function isArchive() {
      const from = (settings.tax || {}).bookkeepingFrom;
      return Boolean(from) && Number(String(draft.issueDate).slice(0, 4)) < Number(from);
    }

    function renderSummary() {
      const t = computeTotals(draft.items);
      UI.clear(summary);
      const totalLabel = offer
        ? (type.nonBinding ? 'Geschätzte Gesamtkosten' : 'Angebotssumme')
        : (type.id === 'creditnote' ? 'Stornobetrag' : 'Rechnungsbetrag');

      summary.appendChild(h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
        h('table', { style: { minWidth: '280px' } }, [
          h('tr', [h('td', { class: 'muted' }, 'Netto'), h('td', { class: 'num' }, fmt.euro(t.netTotal))]),
          ...t.breakdown.filter((g) => g.rate).map((g) =>
            h('tr', [
              h('td', { class: 'muted' }, `zzgl. ${g.rate} % USt`),
              h('td', { class: 'num' }, fmt.euro(g.tax))
            ])),
          h('tr', { class: 'sum grand' }, [
            h('td', totalLabel),
            h('td', { class: 'num' }, fmt.euro(t.grossTotal))
          ])
        ])
      ));
    }

    function renderItems() {
      const rows = draft.items.map((item, index) => h('tr', [
        h('td', { style: { width: '32%' } }, [
          UI.input({
            value: item.name,
            placeholder: 'Leistung oder Artikel',
            disabled: locked,
            onInput: (e) => { item.name = e.target.value; }
          }),
          h('textarea', {
            value: item.description,
            placeholder: 'Beschreibung, optional',
            disabled: locked,
            style: { minHeight: '38px', marginTop: '4px', fontSize: '12px' },
            onInput: (e) => { item.description = e.target.value; }
          })
        ]),
        h('td', { style: { width: '84px' } }, UI.input({
          class: 'num', value: String(item.quantity), disabled: locked,
          onInput: (e) => { item.quantity = Number(String(e.target.value).replace(',', '.')) || 0; renderSummary(); }
        })),
        h('td', { style: { width: '104px' } }, select(
          app.boot.units.map((u) => ({ value: u.code, label: u.label })),
          item.unit,
          { disabled: locked, onChange: (e) => { item.unit = e.target.value; } }
        )),
        h('td', { style: { width: '108px' } }, UI.amountInput({
          value: UI.amountValue(item.unitPriceNet), disabled: locked,
          onInput: (e) => { item.unitPriceNet = UI.parseAmount(e.target.value); renderSummary(); }
        })),
        h('td', { style: { width: '72px' } }, UI.input({
          class: 'num', value: String(item.discountPercent || 0), disabled: locked,
          onInput: (e) => { item.discountPercent = Number(e.target.value) || 0; renderSummary(); }
        })),
        h('td', { style: { width: '170px' } }, select(
          app.boot.vatRates.map((r) => ({ value: r.key ? `k:${r.key}` : `r:${r.rate}`, label: r.label })),
          item.vatKey ? `k:${item.vatKey}` : `r:${item.vatRate}`,
          {
            disabled: locked,
            onChange: (e) => {
              const [kind, value] = e.target.value.split(':');
              if (kind === 'k') {
                const rate = app.boot.vatRates.find((r) => r.key === value);
                item.vatKey = value;
                item.vatRate = rate ? rate.rate : 0;
              } else {
                item.vatKey = null;
                item.vatRate = Number(value);
              }
              renderSummary();
            }
          }
        )),
        h('td', { class: 'num', style: { width: '100px', paddingTop: '14px' } },
          fmt.euro(Math.round(item.quantity * item.unitPriceNet * (1 - (item.discountPercent || 0) / 100)))),
        h('td', { style: { width: '32px' } }, locked ? null : h('button', {
          class: 'btn small ghost pos-row-remove',
          title: 'Position entfernen',
          onClick: () => {
            draft.items.splice(index, 1);
            if (!draft.items.length) draft.items.push(newItem(settings));
            buildBody();
          }
        }, '✕'))
      ]));

      return h('div', [
        h('div', { class: 'table-wrap', style: { margin: '0' } },
          h('table', { class: 'pos-table' }, [
            h('thead', h('tr', [
              h('th', 'Bezeichnung'), h('th', { class: 'num' }, 'Menge'), h('th', 'Einheit'),
              h('th', { class: 'num' }, 'Einzelpreis'), h('th', { class: 'num' }, 'Rabatt %'),
              h('th', 'Umsatzsteuer'), h('th', { class: 'num' }, 'Betrag'), h('th', '')
            ])),
            h('tbody', rows)
          ])
        ),
        locked ? null : h('button', {
          class: 'btn small ghost',
          style: { marginTop: '10px' },
          onClick: () => { draft.items.push(newItem(settings)); buildBody(); }
        }, '+ Position')
      ]);
    }

    /**
     * Das Feld für den Ausstellungsort.
     *
     * Nur sichtbar, wenn die gewählte Vorlage die Zeile "Ort, Datum" überhaupt
     * zeigt: ein Feld ohne Wirkung verwirrt mehr, als es nützt. Leer bedeutet
     * der Sitz aus den Firmendaten.
     */
    function placeField() {
      if (!(app.settings.theme || {}).showPlaceLine) return null;
      return field('Ausstellungsort', UI.input({
        value: draft.place || '', disabled: locked,
        placeholder: app.settings.company.city || '',
        onInput: (e) => { draft.place = e.target.value; }
      }), 'Steht über dem Titel. Leer heißt der Sitz aus den Firmendaten.');
    }

    /** Die Kopfdaten unterscheiden sich je Dokumentart. */
    function renderHeaderFields() {
      if (offer) {
        return h('div', { class: 'grid grid-3' }, [
          field('Datum', UI.dateInput({
            value: draft.issueDate, disabled: locked,
            onChange: (e) => { draft.issueDate = e.target.value; }
          })),
          field(type.nonBinding ? 'Gültig bis' : 'Bindefrist bis', UI.dateInput({
            value: draft.validUntil || '', disabled: locked,
            onChange: (e) => { draft.validUntil = e.target.value || null; }
          }), type.nonBinding
            ? 'Wie lange die Schätzung Bestand hat'
            : 'So lange bist du an das Angebot gebunden'),
          type.nonBinding
            ? field('Toleranz in Prozent', UI.input({
                type: 'number', class: 'num', value: String(draft.tolerancePercent || 15), disabled: locked,
                onInput: (e) => { draft.tolerancePercent = Number(e.target.value) || 0; }
              }), 'Erscheint im Text als zulässige Abweichung')
            : field('Ihre Referenz', UI.input({
                value: draft.orderReference || '', disabled: locked,
                onInput: (e) => { draft.orderReference = e.target.value; }
              })),
          placeField()
        ].filter(Boolean));
      }

      return h('div', { class: 'grid grid-4' }, [
        field('Rechnungsdatum', UI.dateInput({
          value: draft.issueDate, disabled: locked,
          onChange: (e) => {
            draft.issueDate = e.target.value;
            draft.dueDate = UI.addDays(draft.issueDate, draft.paymentTermsDays || 14);
            buildBody();
          }
        })),
        field('Leistungsdatum', UI.dateInput({
          value: draft.deliveryDate || '', disabled: locked,
          onChange: (e) => { draft.deliveryDate = e.target.value; }
        }), 'Pflichtangabe nach §14 UStG'),
        field('Zahlungsziel in Tagen', UI.input({
          type: 'number', class: 'num', value: String(draft.paymentTermsDays || 14), disabled: locked,
          onInput: (e) => {
            draft.paymentTermsDays = Number(e.target.value) || 0;
            draft.dueDate = UI.addDays(draft.issueDate, draft.paymentTermsDays);
            const dueField = body.querySelector('[data-due]');
            if (dueField) dueField.value = draft.dueDate;
          }
        })),
        field('Fällig am', UI.dateInput({
          value: draft.dueDate || '', disabled: locked, dataset: { due: '1' },
          onChange: (e) => { draft.dueDate = e.target.value; }
        })),
        placeField()
      ].filter(Boolean));
    }

    /** Bereich und Projekt: dieselben Dimensionen wie bei den Buchungen. */
    function dimensionFields() {
      const projectOptions = [
        { value: '', label: 'Ohne Projekt' },
        ...app.data.projects
          .filter((p) => ['planned', 'active'].includes(p.status) || p.id === draft.projectId)
          .map((p) => ({ value: p.id, label: p.name }))
      ];

      return h('div', { class: 'grid grid-2' }, [
        field('Bereich', select(
          app.boot.segments.map((s) => ({ value: s.id, label: s.label })),
          draft.segmentId || app.boot.segments[0].id,
          { disabled: locked, onChange: (e) => { draft.segmentId = e.target.value; } }
        )),
        field('Projekt', select(projectOptions, draft.projectId || '', {
          disabled: locked,
          onChange: (e) => { draft.projectId = e.target.value || null; }
        }), 'Fasst mehrere Dokumente und Kosten zu einem Auftrag zusammen')
      ]);
    }

    function buildBody() {
      UI.clear(body);

      if (locked) {
        UI.append(body, UI.note(
          offer
            ? `${type.label} ${draft.number} ist festgeschrieben und wird nur noch angezeigt. Für Änderungen legst du eine neue Fassung an.`
            : `Rechnung ${draft.number} ist festgeschrieben und wird nur noch angezeigt. Für eine Korrektur schreibst du eine Storno- oder Nachtragsrechnung.`,
          'warn'
        ));
      }

      if (draft.fromOfferNumber) {
        UI.append(body, UI.note(`Entstanden aus ${draft.fromOfferNumber}. Prüfe die Positionen, bevor du festschreibst.`));
      }

      body.appendChild(problems);

      const archiv = isArchive();
      const numberField = locked ? null : field('Nummer', UI.input({
        value: ownNumber,
        placeholder: archiv ? 'etwa R-2409-0101' : 'wird automatisch vergeben',
        onInput: (e) => { ownNumber = e.target.value; }
      }), archiv
        ? `Pflicht: ${type.label} von ${fmt.date(draft.issueDate)} trägt ihre Nummer schon.`
        : 'Nur ausfüllen, wenn das Dokument seine Nummer schon trägt');

      body.appendChild(h('div', { class: numberField ? 'grid grid-3' : 'grid grid-2' }, [
        field('Kunde', select(
          app.data.customers.map((c) => ({ value: c.id, label: c.name })),
          draft.customerId,
          {
            disabled: locked,
            onChange: (e) => {
              draft.customerId = e.target.value;
              const customer = app.customer(draft.customerId);
              if (customer) {
                if (customer.buyerReference) draft.buyerReference = customer.buyerReference;
                if (customer.paymentTermsDays && !offer) {
                  draft.paymentTermsDays = customer.paymentTermsDays;
                  draft.dueDate = UI.addDays(draft.issueDate, customer.paymentTermsDays);
                }
              }
              buildBody();
            }
          }
        )),
        numberField,
        offer
          ? field('Anrede', UI.input({
              value: draft.salutation || '', disabled: locked,
              placeholder: 'Sehr geehrte Damen und Herren,',
              onInput: (e) => { draft.salutation = e.target.value; }
            }))
          : field('Käuferreferenz, Leitweg-ID', UI.input({
              value: draft.buyerReference, disabled: locked,
              placeholder: 'Pflicht bei öffentlichen Auftraggebern',
              onInput: (e) => { draft.buyerReference = e.target.value; }
            }))
      ].filter(Boolean)));

      body.appendChild(renderHeaderFields());
      body.appendChild(dimensionFields());

      body.appendChild(h('h3', { class: 'panel-title', style: { margin: '18px 0 8px' } }, 'Positionen'));
      body.appendChild(renderItems());
      body.appendChild(h('div', { style: { marginTop: '14px' } }, summary));
      renderSummary();

      body.appendChild(h('details', { style: { marginTop: '16px' } }, [
        h('summary', { class: 'small muted', style: { cursor: 'pointer', marginBottom: '10px' } }, 'Texte und Referenzen'),
        !offer
          ? field('Anrede', UI.input({
              value: draft.salutation || '', disabled: locked,
              onInput: (e) => { draft.salutation = e.target.value; }
            }))
          : null,
        field('Einleitung', h('textarea', {
          value: draft.intro || '', disabled: locked,
          placeholder: 'Steht über den Positionen',
          onInput: (e) => { draft.intro = e.target.value; }
        })),
        field(offer ? 'Hinweis zur Gültigkeit' : 'Zahlungshinweis', h('textarea', {
          value: draft.bodyText || '', disabled: locked,
          onInput: (e) => { draft.bodyText = e.target.value; }
        }), placeholderHint(offer, type)),
        field('Schlusstext', h('textarea', {
          value: draft.outro || '', disabled: locked,
          onInput: (e) => { draft.outro = e.target.value; }
        })),
        offer
          ? checkbox('Unterschriftsfeld für die Zusage anzeigen', draft.showSignature,
              (v) => { draft.showSignature = v; })
          : field('Bestellreferenz', UI.input({
              value: draft.orderReference || '', disabled: locked,
              onInput: (e) => { draft.orderReference = e.target.value; }
            }))
      ]));

      if (draft.payments && draft.payments.length) {
        body.appendChild(h('div', { style: { marginTop: '16px' } }, [
          h('h3', { class: 'panel-title', style: { marginBottom: '8px' } }, 'Zahlungen'),
          h('table', draft.payments.map((p) => h('tr', [
            h('td', fmt.date(p.date)),
            h('td', { class: 'num' }, fmt.euro(p.amount)),
            h('td', { class: 'small faint' }, p.note || '')
          ])))
        ]));
      }
    }

    function placeholderHint(isOffer, docType) {
      const common = '{NUMBER} Nummer, {DATE} Datum, {AMOUNT} Betrag, {CUSTOMER} Kunde';
      if (docType.nonBinding) return `Platzhalter: ${common}, {VALIDUNTIL} Gültigkeit, {TOLERANCE} Toleranz`;
      if (isOffer) return `Platzhalter: ${common}, {VALIDUNTIL} Bindefrist`;
      return `Platzhalter: ${common}, {DUEDATE} Fälligkeit`;
    }

    buildBody();

    async function save() {
      const res = await window.kontor.invoices.save({ ...draft });
      const saved = UI.unwrap(res, 'Speichern');
      if (saved) UI.toast(`${type.label} gespeichert.`, 'success');
      return saved;
    }

    /**
     * Prüft die Pflichtangaben, solange der Dialog noch offen ist.
     *
     * Die Prüfung lief früher erst nach dem Schließen. Wer etwas vergessen
     * hatte, las den Hinweis vor einem leeren Bildschirm und musste alles neu
     * eintippen. Die Meldungen stehen jetzt oben im Dialog, die Eingaben
     * bleiben stehen.
     */
    async function isComplete() {
      const eigene = ownNumber.trim();
      const check = UI.unwrap(
        await window.kontor.invoices.validate({ ...draft, number: eigene || undefined }),
        'Prüfung'
      );
      if (!check) return false;

      const errors = [...check.errors];
      if (isArchive() && !eigene) {
        errors.push(`Nacherfasste Dokumente behalten ihre Nummer: trage die Nummer dieser ${type.label} ein.`);
      }
      if (eigene && app.data.invoices.some((i) => i.id !== draft.id && i.number === eigene)) {
        errors.push(`Die Nummer ${eigene} ist schon vergeben.`);
      }

      UI.clear(problems);
      if (!errors.length) return true;

      problems.appendChild(UI.note(errors, 'error'));
      if (check.warnings.length) problems.appendChild(UI.note(check.warnings, 'warn'));
      problems.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return false;
    }

    UI.modal({
      title: draft.number
        ? `${type.label} ${draft.number}`
        : (draft.id ? `${type.label} bearbeiten` : `${type.label} anlegen`),
      body,
      wide: true,
      actions: (close) => locked
        ? [
            h('button', {
              class: 'btn ghost',
              onClick: async () => {
                close();
                await showPreview(app, draft.id);
              }
            }, 'Vorschau'),
            h('button', { class: 'btn', onClick: close }, 'Schließen')
          ]
        : [
            h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
            h('button', {
              class: 'btn',
              onClick: async () => {
                const saved = await save();
                if (!saved) return;
                close();
                if (options.onDone) await options.onDone(saved, false);
                else app.refresh();
              }
            }, 'Als Entwurf speichern'),
            h('button', {
              class: 'btn primary',
              onClick: async () => {
                if (!await isComplete()) return;
                const saved = await save();
                if (!saved) return;
                close();
                if (options.onDone) await options.onDone(saved, true, ownNumber.trim() || null);
                else app.refresh();
              }
            }, 'Speichern und festschreiben')
          ]
    });
  }

  /** Zeigt ein gespeichertes Dokument so, wie es gedruckt aussieht. */
  async function showPreview(app, documentId) {
    const result = UI.unwrap(
      await window.kontor.theme.preview({ documentId, theme: app.settings.theme }),
      'Vorschau'
    );
    if (!result) return;

    const frame = h('iframe', {
      class: 'doc-frame',
      src: 'doc-frame.html',
      title: 'Dokumentvorschau'
    });

    frame.addEventListener('load', () => {
      // Das Vorschaufenster ist ein eigenes Dokument. Es bekommt genau das
      // HTML, das auch ins PDF wandert.
      const doc = frame.contentDocument;
      doc.open();
      doc.write(result.html);
      doc.close();
    });

    UI.modal({
      title: 'Vorschau',
      wide: true,
      body: h('div', { class: 'doc-preview' }, frame),
      actions: (close) => [h('button', { class: 'btn', onClick: close }, 'Schließen')]
    });
  }

  return { open, showPreview, computeTotals };
})();
