'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/** Einnahmenüberschussrechnung für das gewählte Jahr. */
window.Views.euer = function euerView(app) {
  const { h, fmt, panel, table, empty } = UI;

  const root = h('div', [
    app.pageHead(`EÜR ${app.year}`, 'Wird berechnet …')
  ]);

  load();
  return root;

  async function load() {
    const data = UI.unwrap(await window.kontor.reports.euer(app.year), 'EÜR');
    if (!data) return;

    UI.clear(root);
    root.appendChild(app.pageHead(
      `Einnahmenüberschussrechnung ${app.year}`,
      'Gerechnet nach dem Zu- und Abflussprinzip des §4 Abs. 3 EStG: maßgeblich ist, wann das Geld geflossen ist. Erlöse und Aufwendungen stehen netto, die Umsatzsteuer bildet eigene Positionen, genau wie in der Anlage EÜR.',
      [
        h('button', {
          class: 'btn',
          onClick: async () => {
            const res = UI.unwrap(await window.kontor.reports.exportYear(app.year), 'Export');
            if (res) UI.toast(`Gespeichert: ${res.file}`, 'success');
          }
        }, 'Jahresmappe als Excel')
      ]
    ));

    if (data.archiveNote) root.appendChild(UI.note([data.archiveNote], "warn"));

    root.appendChild(h('div', { class: 'grid grid-3', style: { marginBottom: '18px' } }, [
      UI.stat('Betriebseinnahmen', fmt.euro(data.incomeTotal), { tone: 'good' }),
      UI.stat('Betriebsausgaben', fmt.euro(data.expenseTotal), { tone: 'bad' }),
      UI.stat(data.profit >= 0 ? 'Gewinn' : 'Verlust', fmt.euro(data.profit), {
        tone: data.profit >= 0 ? 'accent' : 'bad',
        hint: 'Grundlage für die Einkommensteuer'
      })
    ]));

    if (!data.income.length && !data.expense.length) {
      root.appendChild(panel(null, empty(
        `Für ${app.year} ist noch nichts gebucht.`,
        'Sobald Buchungen mit Zahlungsdatum vorliegen, steht hier die Rechnung.'
      )));
      return;
    }

    root.appendChild(panel('Betriebseinnahmen', table(
      [{ label: 'Position' }, { label: 'Betrag', width: '160px', num: true }],
      [
        ...data.income.map((row) => h('tr', [
          h('td', row.position),
          h('td', { class: 'num' }, fmt.euro(row.amount))
        ])),
        h('tr', { class: 'sum' }, [
          h('td', 'Summe der Betriebseinnahmen'),
          h('td', { class: 'num' }, fmt.euro(data.incomeTotal))
        ])
      ]
    )));

    root.appendChild(panel('Betriebsausgaben', table(
      [{ label: 'Position' }, { label: 'Betrag', width: '160px', num: true }],
      [
        ...data.expense.map((row) => h('tr', [
          h('td', row.position),
          h('td', { class: 'num' }, fmt.euro(row.amount))
        ])),
        h('tr', { class: 'sum' }, [
          h('td', 'Summe der Betriebsausgaben'),
          h('td', { class: 'num' }, fmt.euro(data.expenseTotal))
        ])
      ]
    )));

    root.appendChild(panel('Ergebnis', table(
      [{ label: '' }, { label: '', width: '160px', num: true }],
      [
        h('tr', [h('td', 'Betriebseinnahmen'), h('td', { class: 'num' }, fmt.euro(data.incomeTotal))]),
        h('tr', [h('td', 'abzüglich Betriebsausgaben'), h('td', { class: 'num' }, fmt.euro(-data.expenseTotal))]),
        h('tr', { class: 'sum grand' }, [
          h('td', data.profit >= 0 ? 'Gewinn' : 'Verlust'),
          h('td', { class: 'num' }, fmt.euro(data.profit))
        ])
      ]
    )));

    const hints = [];
    if (data.open.income || data.open.expense) {
      hints.push(`Noch nicht enthalten, weil ohne Zahlungsdatum: ${fmt.euro(data.open.income)} an Einnahmen und ${fmt.euro(data.open.expense)} an Ausgaben.`);
    }
    if (data.depreciation) {
      hints.push(`Enthalten sind ${fmt.euro(data.depreciation)} Abschreibung aus dem Anlageverzeichnis.`);
    }
    hints.push('Die Positionsbezeichnungen folgen der Anlage EÜR. Die amtlichen Zeilennummern ändern sich jährlich und stehen deshalb bewusst nicht dabei.');

    root.appendChild(UI.note(hints));
  }
};
