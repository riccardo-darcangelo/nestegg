'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Angebote und Kostenvoranschläge.
 *
 * Der Unterschied ist kein kosmetischer: ein Angebot ist ein verbindliches
 * Vertragsangebot mit Bindefrist, ein Kostenvoranschlag eine unverbindliche
 * Schätzung, bei der §650 BGB verlangt, eine wesentliche Überschreitung
 * vorher anzuzeigen. Deshalb tragen beide unterschiedliche Texte und
 * unterschiedliche Pflichtfelder.
 *
 * Beides wirkt sich nicht auf EÜR oder Umsatzsteuer aus. Das passiert erst,
 * wenn daraus eine Rechnung wird und diese bezahlt ist.
 */
window.Views.offers = function offersView(app) {
  const { h, fmt, panel, table, empty } = UI;

  const filters = app.state.filters.offers || (app.state.filters.offers = { status: 'all', type: 'all', search: '' });
  const root = h('div');
  render();
  return root;

  function visible() {
    return app.data.invoices
      .filter((doc) => {
        const type = app.boot.documentTypes[doc.documentType || 'invoice'];
        if (!type || type.group !== 'offer') return false;
        if (String(doc.issueDate).slice(0, 4) !== String(app.year)) return false;
        if (filters.type !== 'all' && doc.documentType !== filters.type) return false;
        if (filters.status !== 'all' && doc.resolvedStatus !== filters.status) return false;
        if (filters.search) {
          const needle = filters.search.toLowerCase();
          const hay = `${doc.number || ''} ${app.customerName(doc.customerId)}`.toLowerCase();
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
      'Angebote',
      'Angebote sind verbindlich und haben eine Bindefrist. Kostenvoranschläge sind unverbindliche Schätzungen mit Toleranz. Aus beiden wird per Knopfdruck eine Rechnung.',
      [
        h('button', { class: 'btn', onClick: () => openEditor(null, 'estimate') }, 'Kostenvoranschlag'),
        h('button', { class: 'btn primary', onClick: () => openEditor(null, 'quote') }, 'Neues Angebot')
      ]
    ));

    root.appendChild(summaryRow(list));

    root.appendChild(h('div', { class: 'filters' }, [
      UI.segmented([
        { value: 'all', label: 'Alle Arten' },
        { value: 'quote', label: 'Angebote' },
        { value: 'estimate', label: 'Kostenvoranschläge' }
      ], filters.type, (value) => { filters.type = value; render(); }),
      UI.segmented([
        { value: 'all', label: 'Alle' },
        { value: 'draft', label: 'Entwürfe' },
        { value: 'sent', label: 'Offen' },
        { value: 'accepted', label: 'Angenommen' },
        { value: 'expired', label: 'Abgelaufen' }
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
        'Keine Angebote.',
        app.data.customers.length
          ? 'Schreibe das erste Angebot für dieses Jahr.'
          : 'Lege zuerst einen Kunden an.',
        app.data.customers.length
          ? h('button', { class: 'btn primary', onClick: () => openEditor(null, 'quote') }, 'Neues Angebot')
          : h('button', { class: 'btn primary', onClick: () => app.navigate('customers') }, 'Zu den Kunden')
      )));
      return;
    }

    root.appendChild(panel(null, table([
      { label: 'Nummer', width: '150px' },
      { label: 'Art', width: '150px' },
      { label: 'Kunde' },
      { label: 'Gültig bis', width: '110px' },
      { label: 'Status', width: '130px' },
      { label: 'Summe', width: '130px', num: true },
      { label: '', width: '250px' }
    ], list.map(rowFor))));
  }

  /** Wie viel liegt draußen und wie viel davon ist angenommen. */
  function summaryRow(list) {
    const open = list.filter((d) => d.resolvedStatus === 'sent');
    const accepted = list.filter((d) => d.resolvedStatus === 'accepted');
    const sum = (arr) => arr.reduce((s, d) => s + d.computed.grossTotal, 0);
    const decided = list.filter((d) => ['accepted', 'declined', 'invoiced'].includes(d.resolvedStatus));
    const won = list.filter((d) => ['accepted', 'invoiced'].includes(d.resolvedStatus));
    const rate = decided.length ? Math.round((won.length / decided.length) * 100) : null;

    return h('div', { class: 'grid grid-3', style: { marginBottom: '18px' } }, [
      UI.stat('Offen beim Kunden', fmt.euro(sum(open)), {
        hint: `${open.length} ${open.length === 1 ? 'Dokument wartet' : 'Dokumente warten'} auf Antwort`
      }),
      UI.stat('Angenommen', fmt.euro(sum(accepted)), {
        tone: 'good',
        hint: accepted.length ? 'noch nicht in Rechnung gestellt' : 'nichts offen'
      }),
      UI.stat('Zusagequote', rate === null ? '–' : `${rate} %`, {
        tone: 'accent',
        hint: rate === null ? 'noch keine Entscheidung gefallen' : `${won.length} von ${decided.length} entschiedenen`
      })
    ]);
  }

  function rowFor(doc) {
    const status = doc.resolvedStatus;
    const type = app.boot.documentTypes[doc.documentType];
    const expiringSoon = status === 'sent' && doc.validUntil
      && doc.validUntil <= UI.addDays(app.boot.today, 7);

    return h('tr', [
      h('td', { class: 'strong clickable', onClick: () => openEditor(doc) }, [
        doc.number || 'Entwurf',
        doc.convertedToInvoiceId ? h('div', { class: 'small faint' }, 'abgerechnet') : null
      ]),
      h('td', { class: 'small' }, type.label),
      h('td', app.customerName(doc.customerId) || h('span', { class: 'faint' }, 'ohne Kunde')),
      h('td', { class: 'nowrap small' }, doc.validUntil
        ? h('span', { class: expiringSoon ? 'money expense' : '' }, fmt.date(doc.validUntil))
        : h('span', { class: 'faint' }, '–')),
      h('td', h('span', { class: `tag ${statusClass(status)}` }, app.boot.invoiceStatus[status] || status)),
      h('td', { class: 'num' }, fmt.euro(doc.computed.grossTotal)),
      h('td', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } }, actionsFor(doc))
    ]);
  }

  /** Die Statusfarben der Rechnungsseite sinngemäß auf Angebote übertragen. */
  function statusClass(status) {
    return {
      draft: 'draft',
      sent: 'sent',
      accepted: 'paid',
      invoiced: 'paid',
      declined: 'cancelled',
      expired: 'overdue',
      cancelled: 'cancelled'
    }[status] || 'draft';
  }

  function actionsFor(doc) {
    const actions = [];

    if (!doc.number) {
      actions.push(h('button', { class: 'btn small primary', onClick: () => finalize(doc) }, 'Festschreiben'));
      actions.push(h('button', { class: 'btn small ghost', onClick: () => openEditor(doc) }, 'Bearbeiten'));
      actions.push(h('button', {
        class: 'btn small ghost',
        onClick: async () => {
          const ok = await UI.confirm('Diesen Entwurf löschen?', { title: 'Entwurf löschen', confirmLabel: 'Löschen', danger: true });
          if (!ok) return;
          if (UI.unwrap(await window.kontor.invoices.remove(doc.id), 'Löschen')) app.refresh();
        }
      }, '✕'));
      return actions;
    }

    actions.push(h('button', { class: 'btn small', onClick: () => exportPdf(doc) }, 'PDF'));

    if (['sent', 'expired'].includes(doc.resolvedStatus)) {
      actions.push(h('button', {
        class: 'btn small',
        title: 'Der Kunde hat zugesagt',
        onClick: () => setStatus(doc, 'accepted')
      }, 'Angenommen'));
    }

    if (['accepted', 'sent', 'expired'].includes(doc.resolvedStatus)) {
      actions.push(h('button', {
        class: 'btn small primary',
        title: 'Rechnung mit denselben Positionen anlegen',
        onClick: () => convert(doc)
      }, 'In Rechnung'));
    }

    actions.push(h('button', { class: 'btn small ghost', onClick: () => openMenu(doc) }, 'Mehr'));
    return actions;
  }

  /**
   * @param {object} doc
   * @param {string} [mitgebracht]  Nummer aus dem Editor beim Nacherfassen
   */
  async function finalize(doc, mitgebracht) {
    const type = app.boot.documentTypes[doc.documentType];
    const validation = UI.unwrap(await window.kontor.invoices.validate(doc), 'Prüfung');
    if (validation && validation.errors.length) {
      UI.modal({
        title: `${type.label} ist noch nicht vollständig`,
        body: h('div', [
          UI.note(validation.errors, 'error'),
          validation.warnings.length ? UI.note(validation.warnings, 'warn') : null
        ]),
        actions: (close) => [h('button', { class: 'btn', onClick: close }, 'Verstanden')]
      });
      return;
    }

    if (validation && validation.warnings.length) {
      const proceed = await UI.confirm(
        `${validation.warnings.join(' ')}\n\nTrotzdem festschreiben?`,
        { title: 'Hinweise', confirmLabel: 'Festschreiben' }
      );
      if (!proceed) return;
    }

    const saved = UI.unwrap(await window.kontor.invoices.finalize(
      mitgebracht ? { id: doc.id, number: mitgebracht } : doc.id
    ), 'Festschreiben');
    if (saved) {
      UI.toast(`${type.label} ${saved.number} festgeschrieben.`, 'success');
      app.refresh();
    }
  }

  async function setStatus(doc, status) {
    const labels = { accepted: 'angenommen', declined: 'abgelehnt', sent: 'wieder offen', cancelled: 'zurückgezogen' };
    const res = UI.unwrap(await window.kontor.offers.setStatus({ id: doc.id, status }), 'Status');
    if (!res) return;
    UI.toast(`${doc.number} als ${labels[status]} markiert.`, 'success');
    app.refresh();
  }

  async function convert(doc) {
    const type = app.boot.documentTypes[doc.documentType];
    const ok = await UI.confirm(
      `Aus ${type.label} ${doc.number} entsteht ein Rechnungsentwurf mit denselben Positionen. ${type.label} bleibt bestehen und gilt danach als abgerechnet.`,
      { title: 'In Rechnung umwandeln', confirmLabel: 'Rechnung anlegen' }
    );
    if (!ok) return;

    const result = UI.unwrap(await window.kontor.offers.convertToInvoice(doc.id), 'Umwandeln');
    if (!result) return;
    UI.toast('Rechnungsentwurf angelegt.', 'success');
    if (result.hint) UI.toast(result.hint, 'error');
    await app.refresh();
    app.navigate('invoices');
  }

  function openMenu(doc) {
    const type = app.boot.documentTypes[doc.documentType];
    UI.modal({
      title: `${type.label} ${doc.number}`,
      body: h('div', [
        UI.note(type.nonBinding
          ? 'Ein Kostenvoranschlag ist unverbindlich. Zeichnet sich ab, dass die tatsächlichen Kosten die Schätzung wesentlich überschreiten, musst du das vorher anzeigen, §650 BGB.'
          : 'Ein Angebot bindet dich bis zum Ende der Bindefrist. Nimmt der Kunde innerhalb dieser Frist an, kommt der Vertrag zustande.'),
        h('div', { class: 'grid grid-2' }, [
          h('button', { class: 'btn', onClick: () => window.DocumentEditor.showPreview(app, doc.id) }, 'Vorschau'),
          h('button', { class: 'btn', onClick: () => exportPdf(doc) }, 'Als PDF speichern'),
          h('button', {
            class: 'btn',
            onClick: async () => {
              const copy = UI.unwrap(await window.kontor.invoices.duplicate(doc.id), 'Duplizieren');
              if (copy) { UI.toast('Kopie als Entwurf angelegt.'); app.refresh(); }
            }
          }, 'Als Vorlage kopieren'),
          h('button', { class: 'btn', onClick: () => openEditor(doc) }, 'Ansehen')
        ]),
        h('div', { style: { marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
          doc.resolvedStatus === 'declined'
            ? h('button', { class: 'btn ghost small', onClick: () => setStatus(doc, 'sent') }, 'Wieder als offen führen')
            : h('button', { class: 'btn ghost small', onClick: () => setStatus(doc, 'declined') }, 'Als abgelehnt markieren'),
          h('div', { style: { flex: '1' } }),
          doc.resolvedStatus === 'cancelled'
            ? null
            : h('button', {
                class: 'btn ghost small danger',
                onClick: async () => {
                  const ok = await UI.confirm(
                    `${type.label} ${doc.number} zurückziehen? Das Dokument bleibt erhalten, die Nummer bleibt vergeben.`,
                    { title: 'Zurückziehen', confirmLabel: 'Zurückziehen', danger: true }
                  );
                  if (ok) setStatus(doc, 'cancelled');
                }
              }, 'Zurückziehen')
        ])
      ]),
      actions: (close) => [h('button', { class: 'btn ghost', onClick: close }, 'Schließen')]
    });
  }

  async function exportPdf(doc) {
    UI.toast('PDF wird erzeugt …');
    const data = UI.unwrap(await window.kontor.invoices.pdf({ id: doc.id, format: 'pdf' }), 'PDF');
    if (data) UI.toast(`Gespeichert: ${data.file}`, 'success');
  }

  function openEditor(existing, documentType) {
    window.DocumentEditor.open(app, {
      documentType: documentType || (existing && existing.documentType) || 'quote',
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
