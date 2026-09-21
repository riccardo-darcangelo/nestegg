'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Empfangene E-Rechnungen.
 *
 * Kein eigener Navigationspunkt: eine eingelesene Eingangsrechnung wird eine
 * gewöhnliche Ausgabenbuchung, und die steht in den Buchungen. Hier liegt nur
 * der Dialog dazwischen, der zeigt, was in der Datei wirklich steht.
 */
window.EInvoice = (function eInvoiceDialog() {
  const { h, fmt, field, select, note } = UI;

  /** Datei wählen, lesen, zeigen. */
  async function open(app, onDone) {
    const result = UI.unwrap(await window.kontor.einvoice.choose(), 'E-Rechnung');
    if (!result) return;

    show(app, result, onDone);
  }

  function show(app, result, onDone) {
    const invoice = result.invoice;
    const draft = {
      categoryId: result.entry.categoryId,
      segmentId: null,
      projectId: null,
      description: result.entry.description,
      counterparty: result.entry.counterparty,
      paidDate: null,
      force: false
    };

    const body = h('div');
    const build = () => {
      UI.clear(body);

      body.appendChild(h('div', { class: 'grid grid-3', style: { marginBottom: '4px' } }, [
        UI.stat('Rechnungsbetrag', fmt.euro(invoice.payable ?? invoice.grossTotal ?? 0), {
          hint: invoice.currency !== 'EUR' ? invoice.currency : `netto ${fmt.euro(invoice.netTotal || 0)}`
        }),
        UI.stat('Umsatzsteuer', fmt.euro(invoice.vatTotal || 0), {
          tone: 'accent',
          hint: invoice.taxes.map((tax) => `${fmt.percent(tax.rate)}`).join(', ') || 'keine'
        }),
        UI.stat('Fällig', invoice.dueDate ? fmt.date(invoice.dueDate) : 'ohne Angabe', {
          hint: invoice.issueDate ? `Rechnung vom ${fmt.date(invoice.issueDate)}` : 'ohne Rechnungsdatum'
        })
      ]));

      body.appendChild(note([
        `${formatLabel(invoice)} von ${invoice.seller.name || 'unbekannt'}${invoice.seller.vatId ? `, ${invoice.seller.vatId}` : ''}`,
        `Rechnungsnummer ${invoice.number || 'fehlt'}${invoice.orderReference ? `, Bestellung ${invoice.orderReference}` : ''}`,
        `Datei ${result.fileName}, wird unverändert als Beleg abgelegt`
      ]));

      if (result.existingEntryId && !draft.force) {
        body.appendChild(note([
          'Diese Rechnung ist bereits gebucht. Ein zweites Mal wäre sie doppelt in der EÜR und doppelt in der Vorsteuer.'
        ], 'warn'));
      }
      if (result.warnings.length) body.appendChild(note(result.warnings, 'warn'));

      const categories = app.boot.categories.expense;
      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Kategorie', select(
          categories.map((c) => ({ value: c.id, label: c.label })),
          draft.categoryId,
          { onChange: (e) => { draft.categoryId = e.target.value; } }
        ), 'Bestimmt Vorsteuerabzug und EÜR-Position'),
        field('Bereich', select(
          [{ value: '', label: 'ohne' }, ...app.boot.segments.map((s) => ({ value: s.id, label: s.label }))],
          draft.segmentId || '',
          { onChange: (e) => { draft.segmentId = e.target.value || null; } }
        ))
      ]));

      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Beschreibung', UI.input({
          value: draft.description,
          onInput: (e) => { draft.description = e.target.value; }
        })),
        field('Bezahlt am', UI.dateInput({
          value: draft.paidDate || '',
          onChange: (e) => { draft.paidDate = e.target.value || null; }
        }), 'Leer lassen, solange nicht gezahlt ist. Die Buchung gilt dann als offen.')
      ]));

      if (invoice.lines.length) {
        body.appendChild(h('details', { style: { marginTop: '4px' } }, [
          h('summary', { class: 'small muted', style: { cursor: 'pointer', marginBottom: '10px' } },
            `Positionen (${invoice.lines.length})`),
          UI.table([
            { label: 'Position' },
            { label: 'Menge', width: '90px', num: true },
            { label: 'Satz', width: '70px', num: true },
            { label: 'Netto', width: '110px', num: true }
          ], invoice.lines.map((line) => h('tr', [
            h('td', [
              h('div', line.name || 'ohne Bezeichnung'),
              line.description ? h('div', { class: 'small faint' }, line.description) : null
            ]),
            h('td', { class: 'num' }, line.quantity !== null ? fmt.quantity(line.quantity) : '–'),
            h('td', { class: 'num' }, fmt.percent(line.vatRate)),
            h('td', { class: 'num' }, fmt.euro(line.net || 0))
          ])), { flush: false })
        ]));
      }
    };

    build();

    UI.modal({
      title: 'Empfangene E-Rechnung',
      body,
      wide: true,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (result.existingEntryId) {
              const ok = await UI.confirm(
                'Diese Rechnung ist schon gebucht. Trotzdem ein zweites Mal buchen?',
                { title: 'Doppelt buchen', confirmLabel: 'Trotzdem buchen', danger: true }
              );
              if (!ok) return;
              draft.force = true;
            }

            const saved = UI.unwrap(await window.kontor.einvoice.commit({
              file: result.file, invoice, draft
            }), 'Buchen');
            if (!saved) return;

            close();
            UI.toast('E-Rechnung gebucht und als Beleg abgelegt.', 'success');
            if (onDone) onDone();
          }
        }, 'Als Ausgabe buchen')
      ]
    });
  }

  function formatLabel(invoice) {
    if (invoice.source === 'zugferd') return 'ZUGFeRD-Rechnung';
    if (invoice.flavour === 'ubl') return 'XRechnung';
    return 'E-Rechnung im CII-Format';
  }

  return { open, show };
})();
