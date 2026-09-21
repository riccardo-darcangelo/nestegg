'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Sphärenrechnung eines gemeinnützigen Vereins.
 *
 * Die eine Ansicht, die ein Verein braucht und die es in einer Buchhaltung für
 * Unternehmen nicht gibt: was ist in welchem Bereich eingenommen und
 * ausgegeben worden, und ist die Besteuerungsgrenze in Sicht?
 */
window.Views.spheres = function spheresView(app) {
  const { h, fmt, panel, table, empty, note } = UI;

  const root = h('div', [app.pageHead(`Sphären ${app.year}`, 'Wird gerechnet …')]);
  load();
  return root;

  async function load() {
    const data = UI.unwrap(await window.kontor.spheres.review({ year: app.year }), 'Sphären');
    if (!data) return;

    UI.clear(root);
    root.appendChild(app.pageHead(
      `Sphären ${app.year}`,
      'Einnahmen und Ausgaben nach den vier Bereichen eines gemeinnützigen Vereins. Erst die Zuordnung entscheidet darüber, ob Steuer anfällt und ob Vorsteuer gezogen werden darf.'
    ));

    root.appendChild(summaryRow(data));

    if (data.warnings.length) root.appendChild(note(data.warnings, data.taxation.exceeded || data.unassigned ? 'warn' : ''));

    root.appendChild(taxationPanel(data));
    root.appendChild(spherePanel(data));
    root.appendChild(detailPanel(data));
  }

  /* --------------------------------------------------------- Kopf */

  function summaryRow(data) {
    const wirtschaftlich = data.spheres.find((sphere) => sphere.id === 'wirtschaftlich') || { income: 0, result: 0 };

    return h('div', { class: 'grid grid-4', style: { marginBottom: '18px' } }, [
      UI.stat('Einnahmen', fmt.euro(data.totals.income), { hint: `${data.totals.count} Buchungen` }),
      UI.stat('Ausgaben', fmt.euro(data.totals.expense), { tone: 'bad' }),
      UI.stat(data.totals.result >= 0 ? 'Überschuss' : 'Fehlbetrag', fmt.euro(Math.abs(data.totals.result)), {
        tone: data.totals.result >= 0 ? 'good' : 'bad',
        hint: 'über alle Sphären'
      }),
      UI.stat('Wirtschaftlicher Betrieb', fmt.euro(wirtschaftlich.income), {
        tone: data.taxation.exceeded ? 'bad' : 'accent',
        hint: `${data.taxation.percent} % der Besteuerungsgrenze`
      })
    ]);
  }

  /**
   * Die Besteuerungsgrenze.
   *
   * Sie ist die Zahl, auf die es ankommt, und wird deshalb als Balken gezeigt.
   * Maßgeblich sind die Einnahmen einschließlich Umsatzsteuer, nicht der
   * Gewinn: das steht ausdrücklich dabei, weil es regelmäßig verwechselt wird.
   */
  function taxationPanel(data) {
    const percent = Math.min(140, data.taxation.percent);

    return panel('Besteuerungsgrenze', h('div', [
      h('div', { class: 'limit-head' }, [
        h('div', [
          h('div', { class: 'limit-value' }, fmt.euro(data.taxation.income)),
          h('div', { class: 'small muted' }, 'Einnahmen des wirtschaftlichen Geschäftsbetriebs, brutto')
        ]),
        h('div', { style: { textAlign: 'right' } }, [
          h('div', { class: 'limit-value muted' }, fmt.euro(data.taxation.limit)),
          h('div', { class: 'small muted' }, 'Grenze nach §64 Abs. 3 AO')
        ])
      ]),
      h('div', { class: 'limit-bar' }, [
        h('div', {
          class: `limit-fill ${data.taxation.exceeded ? 'over' : (percent >= 80 ? 'close' : '')}`.trim(),
          style: { width: `${Math.min(100, percent)}%` }
        }),
        percent > 100 ? h('div', { class: 'limit-over', style: { width: `${percent - 100}%` } }) : null
      ]),
      h('div', { class: 'limit-legend' }, [
        h('span', `${data.taxation.percent} Prozent`),
        h('span', { class: 'muted' }, data.taxation.exceeded ? 'überschritten' : `noch ${fmt.euro(Math.max(0, data.taxation.limit - data.taxation.income))}`)
      ]),
      data.taxation.exceeded ? freibetragTable(data) : null
    ]), { note: `Überschuss ${fmt.euro(data.taxation.result)}` });
  }

  function freibetragTable(data) {
    const a = data.allowances;

    return h('div', { style: { marginTop: '14px' } }, table([
      { label: 'Steuer' },
      { label: 'Freibetrag', width: '130px', num: true },
      { label: 'Zu versteuern', width: '140px', num: true },
      { label: 'Grundlage', width: '210px' }
    ], [
      h('tr', [
        h('td', 'Körperschaftsteuer'),
        h('td', { class: 'num' }, fmt.euro(a.corporateTax.allowance)),
        h('td', { class: 'num strong' }, fmt.euro(a.corporateTax.taxable)),
        h('td', { class: 'small muted' }, a.corporateTax.law)
      ]),
      h('tr', [
        h('td', 'Gewerbesteuer'),
        h('td', { class: 'num' }, fmt.euro(a.tradeTax.allowance)),
        h('td', { class: 'num strong' }, fmt.euro(a.tradeTax.taxable)),
        h('td', { class: 'small muted' }, a.tradeTax.law)
      ])
    ], { flush: false }));
  }

  /* --------------------------------------------------------- Sphären */

  function spherePanel(data) {
    const max = Math.max(1, ...data.spheres.map((sphere) => Math.max(sphere.income, sphere.expense)));

    const rows = data.spheres.map((sphere) => h('div', { class: 'sphere-row' }, [
      h('div', { class: 'sphere-mark', style: { background: sphere.color } }),
      h('div', { class: 'sphere-body' }, [
        h('div', { class: 'sphere-name' }, [
          sphere.label,
          sphere.law ? h('span', { class: 'small faint', style: { marginLeft: '8px' } }, sphere.law) : null
        ]),
        h('div', { class: 'small muted' }, sphere.hint),
        h('div', { class: 'sphere-bars' }, [
          h('div', { class: 'sphere-bar income', style: { width: `${(sphere.income / max) * 100}%` } }),
          h('div', { class: 'sphere-bar expense', style: { width: `${(sphere.expense / max) * 100}%` } })
        ])
      ]),
      h('div', { class: 'sphere-numbers' }, [
        h('div', { class: 'money income' }, fmt.euro(sphere.income)),
        h('div', { class: 'money expense' }, fmt.euro(sphere.expense)),
        h('div', { class: `strong ${sphere.result >= 0 ? 'good' : 'bad'}` }, fmt.signed(sphere.result))
      ])
    ]));

    return panel('Die vier Bereiche', h('div', { class: 'sphere-list' }, rows), {
      note: `${data.totals.count} Buchungen in ${app.year}`
    });
  }

  /* --------------------------------------------------------- Einzelnes */

  function detailPanel(data) {
    const rows = data.spheres.map((sphere) => h('tr', [
      h('td', [
        h('span', { class: 'kind-dot', style: { '--chip': sphere.color } }),
        h('span', { style: { marginLeft: '8px' } }, sphere.label)
      ]),
      h('td', { class: 'num' }, String(sphere.count)),
      h('td', { class: 'num money income' }, fmt.euro(sphere.income)),
      h('td', { class: 'num money expense' }, fmt.euro(sphere.expense)),
      h('td', { class: 'num strong' }, fmt.signed(sphere.result))
    ]));

    rows.push(h('tr', { class: 'sum' }, [
      h('td', 'Zusammen'),
      h('td', { class: 'num' }, String(data.totals.count)),
      h('td', { class: 'num money income' }, fmt.euro(data.totals.income)),
      h('td', { class: 'num money expense' }, fmt.euro(data.totals.expense)),
      h('td', { class: 'num strong' }, fmt.signed(data.totals.result))
    ]));

    return h('div', [
      panel('Einnahmen-Ausgaben-Rechnung', table([
        { label: 'Sphäre' },
        { label: 'Buchungen', width: '110px', num: true },
        { label: 'Einnahmen', width: '140px', num: true },
        { label: 'Ausgaben', width: '140px', num: true },
        { label: 'Ergebnis', width: '140px', num: true }
      ], rows), { note: 'nach §63 Abs. 3 AO, Zu- und Abflussprinzip' }),

      panel('Was sonst noch zu beachten ist', h('div', [
        note([
          data.sports.note,
          data.timelyUse.note,
          `Übungsleiterpauschale ${fmt.euro(data.limits.trainerAllowance)}, Ehrenamtspauschale ${fmt.euro(data.limits.volunteerAllowance)} je Person und Jahr.`
        ])
      ]))
    ]);
  }
};
