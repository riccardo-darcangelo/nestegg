'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Fristenkalender.
 *
 * Führt zusammen, was sonst über die Ansichten verstreut ist. Sortiert nach
 * Datum, gruppiert nach Monat, und was überfällig ist, steht oben und bleibt
 * stehen.
 */
window.Views.deadlines = function deadlinesView(app) {
  const { h, fmt, panel, empty, note } = UI;

  const state = app.state.deadlines || (app.state.deadlines = { kinds: [], horizon: 180 });
  const root = h('div', [app.pageHead('Fristen', 'Wird zusammengetragen …')]);

  load();
  return root;

  async function load() {
    const data = UI.unwrap(
      await window.kontor.deadlines.list({
        year: app.year,
        horizonDays: state.horizon,
        kinds: state.kinds
      }),
      'Fristen'
    );
    if (!data) return;

    UI.clear(root);
    root.appendChild(app.pageHead(
      'Fristen',
      'Voranmeldungen, Meldungen, Jahreserklärungen, fällige Rechnungen und anstehende Mahnungen an einer Stelle. Jeder Termin stammt aus derselben Rechnung wie in seiner eigenen Ansicht.'
    ));

    root.appendChild(summary(data));
    root.appendChild(filterBar(data));

    if (!data.items.length) {
      root.appendChild(panel(null, empty(
        'Keine Termine im gewählten Zeitraum.',
        state.kinds.length ? 'Vielleicht blendet der Filter zu viel aus.' : 'Das ist eine gute Nachricht.'
      )));
      return;
    }

    for (const month of data.months) root.appendChild(monthPanel(month, data));
  }

  /* --------------------------------------------------------- Kopf */

  function summary(data) {
    const c = data.counts;
    return h('div', { class: 'grid grid-4', style: { marginBottom: '18px' } }, [
      UI.stat('Überfällig', String(c.overdue), {
        tone: c.overdue ? 'bad' : '',
        hint: c.overdue ? 'sollte heute erledigt werden' : 'nichts liegen geblieben'
      }),
      UI.stat('Diese Tage', String(c.today), {
        tone: c.today ? 'accent' : '',
        hint: 'in den nächsten drei Tagen'
      }),
      UI.stat('Demnächst', String(c.soon), { hint: 'in den nächsten zwei Wochen' }),
      UI.stat('Später', String(c.later), { hint: `bis zu ${Math.round(state.horizon / 30)} Monate voraus` })
    ]);
  }

  function filterBar(data) {
    const kinds = Object.values(data.kinds);

    return h('div', { class: 'filters' }, [
      h('div', { class: 'kind-filter' }, kinds.map((kind) => {
        const active = !state.kinds.length || state.kinds.includes(kind.id);
        return h('button', {
          class: `kind-chip ${active ? 'active' : ''}`.trim(),
          style: { '--chip': kind.color },
          onClick: () => {
            // Ohne Auswahl gilt alles. Der erste Klick blendet den Rest aus.
            if (!state.kinds.length) state.kinds = [kind.id];
            else if (state.kinds.includes(kind.id)) {
              state.kinds = state.kinds.filter((k) => k !== kind.id);
            } else {
              state.kinds = [...state.kinds, kind.id];
            }
            app.render();
          }
        }, [h('span', { class: 'kind-dot' }), kind.label]);
      })),
      h('div', { style: { flex: '1' } }),
      state.kinds.length
        ? h('button', {
            class: 'btn small ghost',
            onClick: () => { state.kinds = []; app.render(); }
          }, 'Filter aufheben')
        : null,
      UI.segmented([
        { value: 90, label: '3 Monate' },
        { value: 180, label: '6 Monate' },
        { value: 365, label: 'Ein Jahr' }
      ], state.horizon, (value) => { state.horizon = Number(value); app.render(); })
    ]);
  }

  /* --------------------------------------------------------- Monate */

  function monthPanel(month, data) {
    const rows = month.items.map((item) => {
      const kind = data.kinds[item.kind];

      return h('div', {
        class: `deadline ${item.urgency}`,
        onClick: item.action ? () => app.navigate(item.action) : null,
        style: item.action ? { cursor: 'pointer' } : null
      }, [
        h('div', { class: 'deadline-date' }, [
          h('div', { class: 'day' }, item.date.slice(8, 10)),
          h('div', { class: 'month' }, monthShort(item.date))
        ]),
        h('div', { class: 'deadline-body' }, [
          h('div', { class: 'deadline-title' }, [
            h('span', { class: 'kind-dot', style: { '--chip': kind.color } }),
            item.title
          ]),
          h('div', { class: 'deadline-detail' }, [
            item.detail,
            item.note ? h('div', { class: 'deadline-note' }, item.note) : null
          ])
        ]),
        h('div', { class: 'deadline-right' }, [
          item.amount
            ? h('div', { class: 'deadline-amount' }, fmt.euro(Math.abs(item.amount)))
            : null,
          h('div', { class: 'deadline-when' }, relative(item.days))
        ])
      ]);
    });

    return panel(month.label, h('div', { class: 'deadline-list' }, rows), {
      note: `${month.items.length} ${month.items.length === 1 ? 'Termin' : 'Termine'}`
    });
  }

  function monthShort(date) {
    const names = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    return names[Number(date.slice(5, 7)) - 1];
  }

  /** Wie weit ein Termin entfernt ist, in Worten. */
  function relative(days) {
    if (days < -1) return `seit ${Math.abs(days)} Tagen`;
    if (days === -1) return 'seit gestern';
    if (days === 0) return 'heute';
    if (days === 1) return 'morgen';
    if (days <= 14) return `in ${days} Tagen`;
    if (days <= 60) return `in ${Math.round(days / 7)} Wochen`;
    return `in ${Math.round(days / 30)} Monaten`;
  }
};
