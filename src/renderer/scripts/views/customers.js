'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/** Kunden: Stammdaten für Rechnungen und E-Rechnung. */
window.Views.customers = function customersView(app) {
  const { h, fmt, panel, table, empty, field, checkbox } = UI;

  const root = h('div');
  render();
  return root;

  function render() {
    UI.clear(root);
    const list = [...app.data.customers].sort((a, b) => a.name.localeCompare(b.name, 'de'));

    root.appendChild(app.pageHead(
      'Kunden',
      'Anschrift und Steuernummern gehören zu den Pflichtangaben einer Rechnung. Bei öffentlichen Auftraggebern kommt die Leitweg-ID dazu.',
      [h('button', { class: 'btn primary', onClick: () => openForm({}) }, 'Neuer Kunde')]
    ));

    if (!list.length) {
      root.appendChild(panel(null, empty(
        'Noch keine Kunden.',
        'Ohne Kunde keine Rechnung.',
        h('button', { class: 'btn primary', onClick: () => openForm({}) }, 'Ersten Kunden anlegen')
      )));
      return;
    }

    const rows = list.map((customer) => {
      const invoices = app.data.invoices.filter((i) => i.customerId === customer.id);
      const open = invoices.reduce((s, i) => s + (i.resolvedStatus === 'cancelled' ? 0 : i.computed.openAmount), 0);
      const total = invoices.reduce((s, i) => s + i.computed.grossTotal, 0);

      return UI.clickableRow({ onClick: () => openForm(customer) }, [
        h('td', [
          h('div', { class: 'strong' }, customer.name),
          h('div', { class: 'small faint' }, [
            customer.contactName || '',
            customer.isPublicAuthority ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, 'Behörde') : null
          ])
        ]),
        h('td', { class: 'small' }, [
          customer.street ? h('div', customer.street) : null,
          h('div', [customer.zip, customer.city].filter(Boolean).join(' ')),
          customer.country && customer.country !== 'DE' ? h('div', { class: 'faint' }, customer.country) : null
        ]),
        h('td', { class: 'small' }, customer.vatId || h('span', { class: 'faint' }, '–')),
        h('td', { class: 'num' }, invoices.length || h('span', { class: 'faint' }, '–')),
        h('td', { class: 'num' }, total ? fmt.euro(total) : ''),
        h('td', { class: 'num' }, open ? h('span', { class: 'money expense' }, fmt.euro(open)) : h('span', { class: 'faint' }, '–'))
      ]);
    });

    root.appendChild(panel(null, table([
      { label: 'Name' },
      { label: 'Anschrift', width: '220px' },
      { label: 'USt-IdNr.', width: '160px' },
      { label: 'Rechnungen', width: '110px', num: true },
      { label: 'Umsatz', width: '130px', num: true },
      { label: 'Offen', width: '130px', num: true }
    ], rows)));
  }

  /**
   * Die nächste freie Kundennummer, im Format der vorhandenen.
   * Dieselbe Regel wie im Rechenkern: aus 0001 und 0005 wird 0006.
   */
  function nextNumber() {
    const numerisch = (app.data.customers || [])
      .map((item) => String(item.customerNumber || '').trim())
      .filter((value) => /^\d+$/.test(value));

    if (!numerisch.length) return '0001';
    const hoechste = numerisch.reduce((max, value) => Math.max(max, Number(value)), 0);
    const stellen = Math.max(...numerisch.map((value) => value.length));
    return String(hoechste + 1).padStart(stellen, '0');
  }

  function openForm(existing) {
    const draft = {
      id: existing.id || null,
      name: existing.name || '',
      contactName: existing.contactName || '',
      customerNumber: existing.customerNumber || '',
      street: existing.street || '',
      street2: existing.street2 || '',
      zip: existing.zip || '',
      city: existing.city || '',
      country: existing.country || 'DE',
      email: existing.email || '',
      phone: existing.phone || '',
      vatId: existing.vatId || '',
      buyerReference: existing.buyerReference || '',
      isPublicAuthority: Boolean(existing.isPublicAuthority),
      paymentTermsDays: existing.paymentTermsDays || '',
      note: existing.note || ''
    };

    const body = h('div');
    build();

    function build() {
      UI.clear(body);
      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Name oder Firma', UI.input({
          value: draft.name, onInput: (e) => { draft.name = e.target.value; }
        })),
        field('Ansprechpartner', UI.input({
          value: draft.contactName, onInput: (e) => { draft.contactName = e.target.value; }
        }))
      ]));

      body.appendChild(field('Straße und Hausnummer', UI.input({
        value: draft.street, onInput: (e) => { draft.street = e.target.value; }
      })));

      body.appendChild(h('div', { class: 'grid grid-3' }, [
        field('PLZ', UI.input({ value: draft.zip, onInput: (e) => { draft.zip = e.target.value; } })),
        field('Ort', UI.input({ value: draft.city, onInput: (e) => { draft.city = e.target.value; } })),
        field('Land', UI.input({
          value: draft.country, maxlength: '2',
          onInput: (e) => { draft.country = e.target.value.toUpperCase(); }
        }), 'Zwei Buchstaben, etwa DE oder AT')
      ]));

      body.appendChild(h('div', { class: 'grid grid-3' }, [
        field('E-Mail', UI.input({ type: 'email', value: draft.email, onInput: (e) => { draft.email = e.target.value; } })),
        field('Telefon', UI.input({ type: 'tel', value: draft.phone, onInput: (e) => { draft.phone = e.target.value; } })),
        field('Kundennummer', UI.input({
          value: draft.customerNumber,
          placeholder: nextNumber(),
          onInput: (e) => { draft.customerNumber = e.target.value; }
        }), draft.id ? null : `Nächste freie: ${nextNumber()}. Eigene Nummern bleiben, wie du sie einträgst.`)
      ]));

      body.appendChild(h('div', { class: 'grid grid-3' }, [
        field('USt-IdNr.', UI.input({
          value: draft.vatId,
          placeholder: 'DE123456789',
          onInput: (e) => { draft.vatId = e.target.value.toUpperCase(); }
        }), 'Nötig bei Reverse Charge und EU-Lieferungen'),
        field('Leitweg-ID', UI.input({
          value: draft.buyerReference, onInput: (e) => { draft.buyerReference = e.target.value; }
        }), 'Käuferreferenz für die XRechnung'),
        field('Zahlungsziel in Tagen', UI.input({
          type: 'number', class: 'num', value: String(draft.paymentTermsDays || ''),
          placeholder: String(app.settings.invoice.paymentTermsDays),
          onInput: (e) => { draft.paymentTermsDays = e.target.value; }
        }))
      ]));

      body.appendChild(checkbox('Öffentlicher Auftraggeber, verlangt XRechnung', draft.isPublicAuthority,
        (v) => { draft.isPublicAuthority = v; }));

      body.appendChild(field('Notiz', h('textarea', {
        value: draft.note, onInput: (e) => { draft.note = e.target.value; }
      })));
    }

    UI.modal({
      title: draft.id ? 'Kunde bearbeiten' : 'Neuer Kunde',
      body,
      actions: (close) => [
        draft.id
          ? h('button', {
              class: 'btn danger',
              onClick: async () => {
                const ok = await UI.confirm(`„${draft.name}“ löschen?`, { title: 'Kunde löschen', confirmLabel: 'Löschen', danger: true });
                if (!ok) return;
                if (UI.unwrap(await window.kontor.customers.remove(draft.id), 'Löschen')) {
                  close();
                  app.refresh();
                }
              }
            }, 'Löschen')
          : null,
        h('div', { style: { flex: '1' } }),
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const res = await window.kontor.customers.save(draft);
            if (!UI.unwrap(res, 'Speichern')) return;
            close();
            UI.toast('Kunde gespeichert.', 'success');
            app.refresh();
          }
        }, 'Speichern')
      ]
    });
  }
};
