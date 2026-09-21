'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Projekte.
 *
 * Ein Auftrag zieht sich über mehrere Rechnungen und verursacht eigene Kosten.
 * Erst beides zusammen zeigt, ob er sich gelohnt hat.
 */
window.Views.projects = function projectsView(app) {
  const { h, fmt, panel, table, empty, field, select } = UI;

  const filters = app.state.filters.projects || (app.state.filters.projects = { status: 'open' });
  const root = h('div');
  render();
  return root;

  function visible() {
    return app.data.projects
      .filter((project) => {
        if (filters.status === 'open') return ['planned', 'active'].includes(project.status);
        if (filters.status === 'all') return true;
        return project.status === filters.status;
      })
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  }

  function render() {
    UI.clear(root);
    const list = visible();

    root.appendChild(app.pageHead(
      'Projekte',
      'Die Klammer über Angebote, Rechnungen und Kosten eines Auftrags. Was ein Projekt am Ende eingebracht hat, steht in der Auswertung.',
      [h('button', { class: 'btn primary', onClick: () => openForm({}) }, 'Neues Projekt')]
    ));

    root.appendChild(h('div', { class: 'filters' }, [
      UI.segmented([
        { value: 'open', label: 'Offen' },
        { value: 'active', label: 'Laufend' },
        { value: 'done', label: 'Abgeschlossen' },
        { value: 'all', label: 'Alle' }
      ], filters.status, (value) => { filters.status = value; render(); })
    ]));

    if (!list.length) {
      root.appendChild(panel(null, empty(
        'Keine Projekte.',
        app.data.customers.length
          ? 'Lege ein Projekt an und ordne ihm Rechnungen und Kosten zu.'
          : 'Ein Projekt gehört meist zu einem Kunden. Lege zuerst einen an.',
        h('button', { class: 'btn primary', onClick: () => openForm({}) }, 'Erstes Projekt anlegen')
      )));
      return;
    }

    const wrapper = panel(null, table([
      { label: 'Projekt' },
      { label: 'Kunde', width: '200px' },
      { label: 'Bereich', width: '150px' },
      { label: 'Status', width: '130px' },
      { label: 'Berechnet', width: '130px', num: true },
      { label: 'Ergebnis', width: '130px', num: true },
      { label: 'Budget', width: '140px' }
    ], list.map(rowFor)));

    root.appendChild(wrapper);
    fillTotals(list, wrapper);
  }

  function rowFor(project) {
    const customer = app.customer(project.customerId);
    const segment = app.boot.segments.find((s) => s.id === project.segmentId);

    return UI.clickableRow({ onClick: () => openForm(project) }, [
      h('td', [
        h('div', { class: 'strong' }, project.name),
        project.startDate
          ? h('div', { class: 'small faint' }, `seit ${fmt.date(project.startDate)}`)
          : null
      ]),
      h('td', customer ? customer.name : h('span', { class: 'faint' }, 'ohne Kunde')),
      h('td', segment
        ? h('span', [
            h('span', { class: 'legend-dot', style: { background: segment.color, marginRight: '7px' } }),
            segment.label
          ])
        : h('span', { class: 'faint' }, '–')),
      h('td', h('span', { class: `tag ${statusClass(project.status)}` }, app.boot.projectStatus[project.status])),
      h('td', { class: 'num' }, ''),
      h('td', { class: 'num strong' }, ''),
      h('td', '')
    ]);
  }

  function statusClass(status) {
    return { planned: 'draft', active: 'sent', done: 'paid', cancelled: 'cancelled' }[status] || 'draft';
  }

  /** Die Zahlen kommen aus dem Hauptprozess, gerechnet wird nur dort. */
  async function fillTotals(list, wrapper) {
    const rows = wrapper.querySelectorAll('tbody tr');

    for (let i = 0; i < list.length; i += 1) {
      const totals = UI.unwrap(await window.kontor.projects.totals(list[i].id));
      if (!totals) continue;
      const cells = rows[i].children;

      cells[4].textContent = totals.billedNet ? fmt.euro(totals.billedNet) : '–';

      UI.clear(cells[5]).appendChild(h('span', {
        class: totals.marginNet < 0 ? 'money expense' : totals.marginNet > 0 ? 'money income' : 'faint'
      }, totals.revenueNet || totals.costNet ? fmt.euro(totals.marginNet) : '–'));

      UI.clear(cells[6]).appendChild(budgetCell(list[i], totals));
    }
  }

  function budgetCell(project, totals) {
    if (!project.budgetCents) return h('span', { class: 'faint small' }, 'kein Budget');
    const used = totals.budgetUsedPercent || 0;
    return h('div', [
      h('div', { class: 'share-bar' }, h('div', {
        class: 'share-fill',
        style: {
          width: `${Math.max(2, Math.min(100, used))}%`,
          background: used > 100 ? 'var(--expense)' : 'var(--accent)'
        }
      })),
      h('div', { class: 'small faint', style: { marginTop: '4px' } },
        `${fmt.percent(used)} von ${fmt.euro(project.budgetCents)}`)
    ]);
  }

  /* --------------------------------------------------------- Formular */

  function openForm(existing) {
    const draft = {
      id: existing.id || null,
      name: existing.name || '',
      customerId: existing.customerId || (app.data.customers[0] ? app.data.customers[0].id : null),
      segmentId: existing.segmentId || app.boot.segments[0].id,
      status: existing.status || 'active',
      budgetCents: existing.budgetCents || 0,
      hourlyRateCents: existing.hourlyRateCents || 0,
      startDate: existing.startDate || app.boot.today,
      endDate: existing.endDate || null,
      note: existing.note || ''
    };

    const body = h('div', [
      field('Name', UI.input({
        value: draft.name,
        placeholder: 'Relaunch Webauftritt',
        onInput: (e) => { draft.name = e.target.value; }
      })),
      h('div', { class: 'grid grid-2' }, [
        field('Kunde', select(
          [{ value: '', label: 'Ohne Kunde' }, ...app.data.customers.map((c) => ({ value: c.id, label: c.name }))],
          draft.customerId,
          { onChange: (e) => { draft.customerId = e.target.value || null; } }
        )),
        field('Bereich', select(
          app.boot.segments.map((s) => ({ value: s.id, label: s.label })),
          draft.segmentId,
          { onChange: (e) => { draft.segmentId = e.target.value; } }
        ))
      ]),
      h('div', { class: 'grid grid-4' }, [
        field('Status', select(
          Object.entries(app.boot.projectStatus).map(([value, label]) => ({ value, label })),
          draft.status,
          { onChange: (e) => { draft.status = e.target.value; } }
        )),
        field('Budget netto', UI.amountInput({
          value: draft.budgetCents ? UI.amountValue(draft.budgetCents) : '',
          onInput: (e) => { draft.budgetCents = UI.parseAmount(e.target.value); }
        }), 'Leer lassen, wenn offen'),
        field('Beginn', UI.dateInput({
          value: draft.startDate || '',
          onChange: (e) => { draft.startDate = e.target.value || null; }
        })),
        field('Ende', UI.dateInput({
          value: draft.endDate || '',
          onChange: (e) => { draft.endDate = e.target.value || null; }
        }))
      ]),
      field('Stundensatz', UI.amountInput({
        value: draft.hourlyRateCents ? UI.amountValue(draft.hourlyRateCents) : '',
        onInput: (e) => { draft.hourlyRateCents = UI.parseAmount(e.target.value); }
      }), 'Für spätere Auswertungen, etwa was du effektiv pro Stunde verdient hast'),
      field('Notiz', h('textarea', {
        value: draft.note,
        onInput: (e) => { draft.note = e.target.value; }
      }))
    ]);

    UI.modal({
      title: draft.id ? 'Projekt bearbeiten' : 'Neues Projekt',
      body,
      actions: (close) => [
        draft.id
          ? h('button', {
              class: 'btn danger',
              onClick: async () => {
                const ok = await UI.confirm(`„${draft.name}“ löschen?`, {
                  title: 'Projekt löschen', confirmLabel: 'Löschen', danger: true
                });
                if (!ok) return;
                if (UI.unwrap(await window.kontor.projects.remove(draft.id), 'Löschen')) {
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
            if (!UI.unwrap(await window.kontor.projects.save(draft), 'Speichern')) return;
            close();
            UI.toast('Projekt gespeichert.', 'success');
            app.refresh();
          }
        }, 'Speichern')
      ]
    });
  }
};
