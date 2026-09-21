'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Rechnungen und Stornorechnungen: Liste, Ausgabe und Zahlungen.
 * Den Editor teilt sich diese Ansicht mit den Angeboten.
 *
 * Solange eine Rechnung Entwurf ist, lässt sich alles ändern. Mit dem
 * Festschreiben bekommt sie ihre Nummer, und die bleibt vergeben: eine
 * Nummernfolge mit Lücken ist ein Prüfungsthema.
 */
window.Views.invoices = function invoicesView(app) {
  const { h, fmt, panel, table, empty, note, field, select } = UI;

  const filters = app.state.filters.invoices || (app.state.filters.invoices = { status: 'all', search: '' });
  const root = h('div');
  render();
  return root;

  function visible() {
    return app.data.invoices
      .filter((inv) => {
        const type = app.boot.documentTypes[inv.documentType || 'invoice'];
        if (!type || type.group !== 'invoice') return false;
        if (String(inv.issueDate).slice(0, 4) !== String(app.year)) return false;
        if (filters.status !== 'all' && inv.resolvedStatus !== filters.status) return false;
        if (filters.search) {
          const needle = filters.search.toLowerCase();
          const hay = `${inv.number || ''} ${app.customerName(inv.customerId)}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => String(b.issueDate + (b.number || '')).localeCompare(String(a.issueDate + (a.number || ''))));
  }

  function render() {
    UI.clear(root);
    const list = visible();

    root.appendChild(app.pageHead(
      'Rechnungen',
      'Rechnungen schreiben, festschreiben und als PDF, ZUGFeRD oder XRechnung ausgeben. Eine Rechnung wirkt sich erst auf EÜR und Umsatzsteuer aus, wenn die Zahlung gebucht ist.',
      [
        h('button', { class: 'btn ghost', onClick: () => app.navigate('design') }, 'Aussehen'),
        h('button', { class: 'btn primary', onClick: () => openEditor(null) }, 'Neue Rechnung')
      ]
    ));

    root.appendChild(h('div', { class: 'filters' }, [
      UI.segmented([
        { value: 'all', label: 'Alle' },
        { value: 'draft', label: 'Entwürfe' },
        { value: 'sent', label: 'Offen' },
        { value: 'overdue', label: 'Überfällig' },
        { value: 'paid', label: 'Bezahlt' }
      ], filters.status, (value) => { filters.status = value; render(); }),
      h('div', { class: 'field grow' }, [
        UI.input({
          placeholder: 'Nummer oder Kunde suchen',
          value: filters.search,
          onInput: UI.debounce((e) => { filters.search = e.target.value; render(); }, 220)
        })
      ])
    ]));

    if (!list.length) {
      root.appendChild(panel(null, empty(
        'Keine Rechnungen.',
        app.data.customers.length
          ? 'Lege die erste Rechnung für dieses Jahr an.'
          : 'Lege zuerst einen Kunden an, dann kannst du Rechnungen schreiben.',
        app.data.customers.length
          ? h('button', { class: 'btn primary', onClick: () => openEditor(null) }, 'Neue Rechnung')
          : h('button', { class: 'btn primary', onClick: () => app.navigate('customers') }, 'Zu den Kunden')
      )));
      return;
    }

    const rows = list.map(rowFor);
    const gross = list.reduce((s, i) => s + i.computed.grossTotal, 0);
    const open = list.reduce((s, i) => s + (i.resolvedStatus === 'cancelled' ? 0 : i.computed.openAmount), 0);
    rows.push(h('tr', { class: 'sum' }, [
      h('td', { colspan: 4 }, `${list.length} Dokumente`),
      h('td', { class: 'num' }, fmt.euro(gross)),
      h('td', { class: 'num' }, fmt.euro(open)),
      h('td', '')
    ]));

    root.appendChild(panel(null, table([
      { label: 'Nummer', width: '150px' },
      { label: 'Datum', width: '96px' },
      { label: 'Kunde' },
      { label: 'Status', width: '120px' },
      { label: 'Brutto', width: '120px', num: true },
      { label: 'Offen', width: '120px', num: true },
      { label: '', width: '220px' }
    ], rows)));
  }

  function rowFor(invoice) {
    const status = invoice.resolvedStatus;
    const type = app.boot.documentTypes[invoice.documentType || 'invoice'];
    const isStorno = invoice.documentType === 'creditnote';

    return h('tr', [
      h('td', { class: 'strong clickable', onClick: () => openEditor(invoice) }, [
        invoice.number || 'Entwurf',
        isStorno ? h('div', { class: 'small faint' }, `Storno zu ${invoice.cancelsInvoiceNumber || ''}`) : null,
        invoice.fromOfferNumber ? h('div', { class: 'small faint' }, `aus ${invoice.fromOfferNumber}`) : null
      ]),
      h('td', { class: 'nowrap' }, fmt.date(invoice.issueDate)),
      h('td', app.customerName(invoice.customerId) || h('span', { class: 'faint' }, 'ohne Kunde')),
      h('td', h('span', { class: `tag ${status}` }, app.boot.invoiceStatus[status] || status)),
      h('td', { class: 'num' }, fmt.euro(invoice.computed.grossTotal)),
      h('td', { class: 'num' }, invoice.computed.openAmount && !isStorno
        ? h('span', { class: status === 'overdue' ? 'money expense' : '' }, fmt.euro(invoice.computed.openAmount))
        : h('span', { class: 'faint' }, '–')),
      h('td', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } }, actionsFor(invoice))
    ]);
  }

  function actionsFor(invoice) {
    const actions = [];

    if (!invoice.number) {
      actions.push(h('button', {
        class: 'btn small primary',
        title: 'Nummer vergeben und festschreiben',
        onClick: () => finalize(invoice)
      }, 'Festschreiben'));
      actions.push(h('button', { class: 'btn small ghost', onClick: () => openEditor(invoice) }, 'Bearbeiten'));
      actions.push(h('button', {
        class: 'btn small ghost',
        onClick: async () => {
          const ok = await UI.confirm('Diesen Entwurf löschen?', { title: 'Entwurf löschen', confirmLabel: 'Löschen', danger: true });
          if (!ok) return;
          if (UI.unwrap(await window.kontor.invoices.remove(invoice.id), 'Löschen')) app.refresh();
        }
      }, '✕'));
      return actions;
    }

    actions.push(h('button', {
      class: 'btn small',
      title: 'PDF mit eingebetteter E-Rechnung',
      onClick: () => exportPdf(invoice, 'zugferd')
    }, 'ZUGFeRD'));

    actions.push(h('button', {
      class: 'btn small ghost',
      title: 'Ausgabeformate und mehr',
      onClick: () => openExportMenu(invoice)
    }, 'Mehr'));

    if (invoice.computed.openAmount > 0 && invoice.resolvedStatus !== 'cancelled' && invoice.documentType !== 'creditnote') {
      actions.push(h('button', {
        class: 'btn small',
        title: 'Zahlungseingang buchen',
        onClick: () => openPayment(invoice)
      }, 'Bezahlt'));

      // Gemahnt wird erst, wenn die Fälligkeit vorbei ist.
      if (invoice.resolvedStatus === 'overdue') {
        const sent = (invoice.reminders || []).length;
        actions.push(h('button', {
          class: 'btn small danger',
          title: sent ? `Bisher ${sent} mal gemahnt` : 'Mahnung schreiben',
          onClick: () => window.Dunning.open(app, invoice.id, () => app.refresh())
        }, sent ? `Mahnen (${sent})` : 'Mahnen'));
      }
    }

    return actions;
  }

  /**
   * @param {object} invoice
   * @param {string} [mitgebracht]  Nummer aus dem Editor beim Nacherfassen
   */
  async function finalize(invoice, mitgebracht) {
    const validation = UI.unwrap(await window.kontor.invoices.validate(invoice), 'Prüfung');
    if (validation && validation.errors.length) {
      UI.modal({
        title: 'Die Rechnung ist noch nicht vollständig',
        body: h('div', [
          UI.note(validation.errors, 'error'),
          validation.warnings.length ? UI.note(validation.warnings, 'warn') : null
        ]),
        actions: (close) => [h('button', { class: 'btn', onClick: close }, 'Verstanden')]
      });
      return;
    }

    // Ein Dokument aus einem früheren Jahr bringt seine Nummer schon mit.
    const ab = (app.settings.tax || {}).bookkeepingFrom;
    const alt = ab && Number(String(invoice.issueDate).slice(0, 4)) < Number(ab);

    const eigene = mitgebracht || (alt ? await askOwnNumber(invoice) : null);
    if (eigene === false) return;

    if (!alt) {
      const ok = await UI.confirm(
        'Die Rechnung bekommt jetzt ihre Nummer. Danach lässt sie sich nicht mehr frei ändern, weil die Nummernfolge lückenlos bleiben muss.',
        { title: 'Rechnung festschreiben', confirmLabel: 'Festschreiben' }
      );
      if (!ok) return;
    }

    const saved = UI.unwrap(await window.kontor.invoices.finalize(
      eigene ? { id: invoice.id, number: eigene } : invoice.id
    ), 'Festschreiben');
    if (saved) {
      UI.toast(`Rechnung ${saved.number} festgeschrieben.`, 'success');
      app.refresh();
    }
  }

  /**
   * Fragt nach der Nummer, die das Dokument schon trägt.
   *
   * Nur beim Nacherfassen: ein Beleg aus einem früheren Jahr hat seine Nummer
   * bereits, und eine neue zu vergeben hieße die alte Buchhaltung zu
   * verfälschen. Liefert die Nummer, oder false bei Abbruch.
   */
  function askOwnNumber(invoice) {
    return new Promise((resolve) => {
      let wert = '';
      // Dieselbe Falle wie bei UI.confirm: close() löst onClose aus, deshalb
      // wird die Antwort gemerkt und erst dort gemeldet.
      let antwort = false;
      const feld = UI.input({
        placeholder: 'etwa R-2409-0101',
        onInput: (e) => { wert = e.target.value; }
      });

      UI.modal({
        title: 'Nummer der nacherfassten Rechnung',
        body: h('div', [
          note([
            `Diese Rechnung ist von ${fmt.date(invoice.issueDate)} und liegt vor dem Beginn deiner Buchführung in dieser App. Sie trägt ihre Nummer schon: trage sie hier ein, damit sie erhalten bleibt.`,
            'Der laufende Nummernkreis wird dabei nicht weitergezählt, es entsteht also keine Lücke.'
          ]),
          field("Nummer", feld)
        ]),
        actions: (close) => [
          h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
          h('button', {
            class: 'btn primary',
            onClick: () => {
              if (!wert.trim()) { UI.toast('Ohne Nummer geht es nicht.', 'error'); return; }
              antwort = wert.trim();
              close();
            }
          }, 'Übernehmen')
        ],
        onClose: () => resolve(antwort)
      });
    });
  }

  function openExportMenu(invoice) {
    UI.modal({
      title: `${invoice.number} ausgeben`,
      body: h('div', [
        UI.note([
          'ZUGFeRD ist ein normales PDF mit eingebettetem Rechnungs-XML. Für Geschäftskunden ist das der bequemste Weg, weil Mensch und Software dieselbe Datei lesen können.',
          'XRechnung ist reines XML nach EN 16931. Öffentliche Auftraggeber verlangen dieses Format. Dafür braucht es meist eine Leitweg-ID des Empfängers.'
        ]),
        h('div', { class: 'grid grid-2', style: { marginTop: '4px' } }, [
          h('button', { class: 'btn', onClick: () => exportPdf(invoice, 'zugferd') }, 'PDF mit ZUGFeRD-XML'),
          h('button', { class: 'btn', onClick: () => exportPdf(invoice, 'pdf') }, 'PDF ohne XML'),
          h('button', { class: 'btn', onClick: () => exportXml(invoice, 'xrechnung') }, 'XRechnung (UBL)'),
          h('button', { class: 'btn', onClick: () => exportXml(invoice, 'cii') }, 'CII-XML einzeln')
        ]),
        h('div', { style: { marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
          h('button', {
            class: 'btn ghost small',
            onClick: () => window.DocumentEditor.showPreview(app, invoice.id)
          }, 'Vorschau'),
          h('button', {
            class: 'btn ghost small',
            onClick: async () => {
              const copy = UI.unwrap(await window.kontor.invoices.duplicate(invoice.id), 'Duplizieren');
              if (copy) { UI.toast('Kopie als Entwurf angelegt.'); app.refresh(); }
            }
          }, 'Als Vorlage kopieren'),
          h('div', { style: { flex: '1' } }),
          invoice.resolvedStatus === 'cancelled' || invoice.documentType === 'creditnote'
            ? null
            : h('button', { class: 'btn ghost small danger', onClick: () => cancelInvoice(invoice) }, 'Stornieren')
        ])
      ]),
      actions: (close) => [h('button', { class: 'btn ghost', onClick: close }, 'Schließen')]
    });
  }

  async function cancelInvoice(invoice) {
    const ok = await UI.confirm(
      `Rechnung ${invoice.number} bleibt bestehen und gilt danach als storniert. Zusätzlich entsteht eine Stornorechnung als Entwurf mit denselben Positionen, die du noch festschreiben musst.`,
      { title: 'Rechnung stornieren', confirmLabel: 'Stornorechnung anlegen', danger: true }
    );
    if (!ok) return;

    const result = UI.unwrap(await window.kontor.invoices.cancel(invoice.id), 'Stornieren');
    if (!result) return;
    UI.toast('Stornorechnung als Entwurf angelegt.', 'success');
    if (result.hint) UI.toast(result.hint, 'error');
    await app.refresh();
  }

  async function exportPdf(invoice, format) {
    UI.toast('PDF wird erzeugt …');
    const data = UI.unwrap(await window.kontor.invoices.pdf({ id: invoice.id, format }), 'PDF');
    if (data) UI.toast(`Gespeichert: ${data.file}`, 'success');
  }

  async function exportXml(invoice, flavour) {
    const data = UI.unwrap(await window.kontor.invoices.xml({ id: invoice.id, flavour }), 'XML');
    if (!data) return;
    UI.toast(`Gespeichert: ${data.file}`, 'success');
    if (data.warnings && data.warnings.length) data.warnings.forEach((w) => UI.toast(w, 'error'));
  }

  /* ------------------------------------------------------- Zahlung */

  function openPayment(invoice) {
    const draft = {
      date: app.boot.today,
      amount: UI.amountValue(invoice.computed.openAmount),
      paymentMethod: 'bank',
      categoryId: 'inc_services'
    };

    UI.modal({
      title: `Zahlungseingang zu ${invoice.number}`,
      body: h('div', [
        UI.note('Der Eingang wird als Einnahme gebucht. Erst damit taucht die Rechnung in der EÜR und in der Umsatzsteuer auf, so will es die Ist-Versteuerung.'),
        h('div', { class: 'grid grid-2' }, [
          field('Eingegangen am', UI.dateInput({
            value: draft.date,
            onChange: (e) => { draft.date = e.target.value; }
          })),
          field('Betrag', UI.amountInput({
            value: draft.amount,
            onInput: (e) => { draft.amount = e.target.value; }
          }))
        ]),
        h('div', { class: 'grid grid-2' }, [
          field('Zahlungsart', select(
            app.boot.paymentMethods.map((p) => ({ value: p.id, label: p.label })),
            draft.paymentMethod,
            { onChange: (e) => { draft.paymentMethod = e.target.value; } }
          )),
          field('Erlöskategorie', select(
            app.boot.categories.income.map((c) => ({ value: c.id, label: c.label })),
            draft.categoryId,
            { onChange: (e) => { draft.categoryId = e.target.value; } }
          ))
        ])
      ]),
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const res = await window.kontor.invoices.bookPayment({
              id: invoice.id,
              date: draft.date,
              amount: UI.parseAmount(draft.amount),
              paymentMethod: draft.paymentMethod,
              categoryId: draft.categoryId
            });
            if (!UI.unwrap(res, 'Zahlung buchen')) return;
            close();
            UI.toast('Zahlung gebucht und als Einnahme erfasst.', 'success');
            app.refresh();
          }
        }, 'Buchen')
      ]
    });
  }

  /* ------------------------------------------------------- Editor */

  function openEditor(existing) {
    window.DocumentEditor.open(app, {
      documentType: existing ? existing.documentType : 'invoice',
      existing,
      onDone: async (saved, finalizeAfter, ownNumber) => {
        await app.refresh();
        if (!finalizeAfter) return;
        const fresh = app.data.invoices.find((i) => i.id === saved.id);
        if (fresh) finalize(fresh, ownNumber);
      }
    });
  }
};
