'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Auswertung nach Bereich, Land, Kunde und Projekt.
 *
 * Alle Beträge netto. Die Umsatzsteuer gehört dem Finanzamt und sagt nichts
 * darüber, wie gut ein Bereich läuft. Grundlage ist wie in der EÜR das Zu- und
 * Abflussprinzip, damit die Zahlen zum ausgewiesenen Gewinn passen.
 */
window.Views.analytics = function analyticsView(app) {
  const { h, fmt, panel, table, empty, note } = UI;

  const state = app.state.analytics || (app.state.analytics = { dimension: 'segment' });
  const root = h('div', [app.pageHead(`Auswertung ${app.year}`, 'Wird gerechnet …')]);

  load();
  return root;

  async function load() {
    const data = UI.unwrap(await window.kontor.reports.analytics(app.year), 'Auswertung');
    if (!data) return;

    UI.clear(root);
    root.appendChild(app.pageHead(
      `Auswertung ${app.year}`,
      'Alle Beträge netto und nach dem Zu- und Abflussprinzip, damit sie zum Gewinn der EÜR passen. Umsatzsteuerzahlungen bleiben außen vor, sie sind kein Geschäft.',
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

    root.appendChild(headline(data));

    if (!data.totals.revenue && !data.totals.cost) {
      root.appendChild(panel(null, empty(
        `Für ${app.year} ist noch nichts gebucht.`,
        'Sobald Buchungen mit Zahlungsdatum vorliegen, steht hier die Auswertung.'
      )));
      return;
    }

    root.appendChild(chart(data));
    root.appendChild(dimensionPanel(data));

    root.appendChild(h('div', { class: 'grid grid-2' }, [
      recurringPanel(data),
      concentrationPanel(data)
    ]));

    root.appendChild(paymentPanel(data));
  }

  /* --------------------------------------------------------- Kennzahlen */

  function headline(data) {
    const t = data.totals;
    const trend = (value) => {
      if (value === null || value === undefined) return 'kein Vorjahr zum Vergleich';
      const sign = value > 0 ? '+' : '';
      return `${sign}${fmt.percent(value)} gegenüber ${app.year - 1}`;
    };

    return h('div', { class: 'grid grid-4', style: { marginBottom: '18px' } }, [
      UI.stat('Umsatz netto', fmt.euro(t.revenue), { tone: 'good', hint: trend(t.revenueChange) }),
      UI.stat('Kosten netto', fmt.euro(t.cost), { tone: 'bad', hint: `Vorjahr ${fmt.euro(t.previousCost)}` }),
      UI.stat('Ergebnis', fmt.euro(t.result), {
        tone: t.result >= 0 ? 'accent' : 'bad',
        hint: trend(t.resultChange)
      }),
      UI.stat('Wiederkehrend', fmt.percent(data.recurring.share), {
        hint: data.recurring.currentMonthly
          ? `zuletzt ${fmt.euro(data.recurring.currentMonthly)} im Monat`
          : 'noch kein wiederkehrender Umsatz'
      })
    ]);
  }

  /* --------------------------------------------------------- Verlauf */

  function chart(data) {
    const names = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    const segments = app.boot.segments;
    const max = Math.max(1, ...data.months.map((m) => Math.max(m.revenue, m.cost)));

    const columns = data.months.map((month, i) => {
      // Der Umsatzbalken wird nach Bereichen gestapelt, damit sichtbar wird,
      // woher der Monat seinen Umsatz hatte.
      const stack = segments
        .map((segment) => ({ segment, value: month.bySegment[segment.id] || 0 }))
        .filter((part) => part.value > 0)
        .map((part) => h('div', {
          style: {
            height: `${(part.value / max) * 100}%`,
            background: part.segment.color,
            width: '100%'
          },
          title: `${names[i]}: ${part.segment.label} ${fmt.euro(part.value)}`
        }));

      const ohne = month.bySegment.ohne || 0;
      if (ohne > 0) {
        stack.push(h('div', {
          style: { height: `${(ohne / max) * 100}%`, background: '#626e80', width: '100%' },
          title: `${names[i]}: Ohne Bereich ${fmt.euro(ohne)}`
        }));
      }

      return h('div', { class: 'chart-col' }, [
        h('div', { class: 'chart-bars' }, [
          h('div', {
            class: 'chart-stack',
            style: { height: '100%' },
            title: `${names[i]}: Umsatz ${fmt.euro(month.revenue)}`
          }, stack),
          h('div', {
            class: 'chart-bar expense',
            style: { height: `${(month.cost / max) * 100}%` },
            title: `${names[i]}: Kosten ${fmt.euro(month.cost)}`
          })
        ]),
        h('div', { class: 'chart-label' }, names[i])
      ]);
    });

    const legend = [
      ...segments.map((segment) =>
        h('span', { class: 'legend-item' }, [
          h('span', { class: 'legend-dot', style: { background: segment.color } }),
          segment.label
        ])),
      h('span', { class: 'legend-item' }, [
        h('span', { class: 'legend-dot', style: { background: 'var(--expense)' } }),
        'Kosten'
      ])
    ];

    return panel('Monatsverlauf', h('div', [
      h('div', { class: 'chart' }, columns),
      h('div', { class: 'legend' }, legend)
    ]), { note: 'Umsatz gestapelt nach Bereich, daneben die Kosten' });
  }

  /* --------------------------------------------------------- Dimensionen */

  function dimensionPanel(data) {
    const dimensions = [
      { id: 'segment', label: 'Bereich', rows: data.bySegment, hint: 'Woher kommt das Geld und was kostet der Bereich' },
      { id: 'country', label: 'Land', rows: data.byCountry, hint: 'Nach Sitzland der Gegenpartei' },
      { id: 'zone', label: 'Steuerraum', rows: data.byZone, hint: 'Inland, EU-Ausland, Drittland' },
      { id: 'customer', label: 'Kunde', rows: data.byCustomer, hint: 'Nur die Einnahmenseite' },
      { id: 'project', label: 'Projekt', rows: data.byProject, hint: 'Nur Buchungen mit Projektbezug' },
      { id: 'category', label: 'Kategorie', rows: data.byCategory, hint: 'Feingliedrig nach Buchungskategorie' }
    ];

    const current = dimensions.find((d) => d.id === state.dimension) || dimensions[0];

    const body = h('div');
    const renderRows = () => {
      UI.clear(body);
      if (!current.rows.length) {
        body.appendChild(empty('Keine Daten für diese Sicht.', current.hint));
        return;
      }

      const rows = current.rows.map((row) => h('tr', [
        h('td', [
          row.color
            ? h('span', { class: 'legend-dot', style: { background: row.color, marginRight: '8px' } })
            : null,
          h('span', { class: 'strong' }, row.label),
          row.zone ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, row.zone) : null,
          row.unlinked ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, 'nicht verknüpft') : null
        ]),
        h('td', { class: 'num' }, row.revenue ? fmt.euro(row.revenue) : h('span', { class: 'faint' }, '–')),
        h('td', { class: 'num' }, row.cost ? fmt.euro(row.cost) : h('span', { class: 'faint' }, '–')),
        h('td', { class: 'num strong' }, h('span', {
          class: row.result < 0 ? 'money expense' : ''
        }, fmt.euro(row.result))),
        h('td', { style: { width: '150px' } }, shareBar(row.share)),
        h('td', { class: 'num small faint' }, fmt.percent(row.share))
      ]));

      const totals = current.rows.reduce(
        (acc, row) => ({ revenue: acc.revenue + row.revenue, cost: acc.cost + row.cost }),
        { revenue: 0, cost: 0 }
      );
      rows.push(h('tr', { class: 'sum' }, [
        h('td', `${current.rows.length} Einträge`),
        h('td', { class: 'num' }, fmt.euro(totals.revenue)),
        h('td', { class: 'num' }, fmt.euro(totals.cost)),
        h('td', { class: 'num' }, fmt.euro(totals.revenue - totals.cost)),
        h('td', ''), h('td', '')
      ]));

      body.appendChild(table([
        { label: current.label },
        { label: 'Umsatz', width: '130px', num: true },
        { label: 'Kosten', width: '130px', num: true },
        { label: 'Ergebnis', width: '130px', num: true },
        { label: 'Anteil am Umsatz', width: '160px' },
        { label: '', width: '60px', num: true }
      ], rows));
    };

    renderRows();

    return panel(null, h('div', [
      h('div', { class: 'filters', style: { marginBottom: '14px' } }, [
        UI.segmented(
          dimensions.map((d) => ({ value: d.id, label: d.label })),
          state.dimension,
          (value) => {
            state.dimension = value;
            app.render();
          }
        ),
        h('div', { class: 'small faint', style: { alignSelf: 'center' } }, current.hint)
      ]),
      body
    ]));
  }

  function shareBar(share) {
    return h('div', { class: 'share-bar' }, h('div', {
      class: 'share-fill',
      style: { width: `${Math.max(2, Math.min(100, share))}%` }
    }));
  }

  /* --------------------------------------------------------- Wiederkehrend */

  function recurringPanel(data) {
    const r = data.recurring;
    if (!r.recurring && !r.onetime) {
      return panel('Wiederkehrender Umsatz', empty('Noch keine Einnahmen erfasst.'));
    }

    return panel('Wiederkehrender Umsatz', h('div', [
      note('Die Umsatzart stellst du beim Erfassen ein. Einmalzahlungen bleiben draußen, sonst wird der laufende Monatsumsatz unbrauchbar.'),
      table(
        [{ label: '' }, { label: '', num: true }],
        [
          h('tr', [h('td', 'Wiederkehrend im Jahr'), h('td', { class: 'num strong' }, fmt.euro(r.recurring))]),
          h('tr', [h('td', 'Einmalig im Jahr'), h('td', { class: 'num' }, fmt.euro(r.onetime))]),
          h('tr', [h('td', 'Anteil wiederkehrend'), h('td', { class: 'num' }, fmt.percent(r.share))]),
          h('tr', { class: 'sum' }, [
            h('td', 'Zuletzt im Monat'),
            h('td', { class: 'num' }, fmt.euro(r.currentMonthly))
          ]),
          h('tr', [
            h('td', { class: 'muted' }, 'Hochgerechnet aufs Jahr'),
            h('td', { class: 'num muted' }, fmt.euro(r.annualRunRate))
          ])
        ]
      )
    ]));
  }

  /* --------------------------------------------------------- Klumpenrisiko */

  function concentrationPanel(data) {
    const c = data.concentration;
    if (!c.customerCount) {
      return panel('Abhängigkeit von Kunden', empty('Noch keine Kundenumsätze.'));
    }

    const toneOf = (risk) => (risk === 'hoch' ? 'error' : risk === 'spürbar' ? 'warn' : '');
    const message = {
      hoch: `Mehr als die Hälfte des Umsatzes hängt an ${c.largest}. Fällt dieser Kunde weg, fällt ein Großteil des Geschäfts weg.`,
      'spürbar': `Ein spürbarer Teil des Umsatzes hängt an ${c.largest}. Beobachten, aber kein Grund zur Unruhe.`,
      verteilt: 'Der Umsatz verteilt sich gut über mehrere Kunden.'
    }[c.risk];

    return panel('Abhängigkeit von Kunden', h('div', [
      note(message, toneOf(c.risk)),
      table(
        [{ label: '' }, { label: '', num: true }],
        [
          h('tr', [h('td', 'Größter Kunde'), h('td', { class: 'num strong' }, fmt.percent(c.top1))]),
          h('tr', [h('td', 'Die drei größten zusammen'), h('td', { class: 'num' }, fmt.percent(c.top3))]),
          h('tr', [h('td', 'Kunden mit Umsatz'), h('td', { class: 'num' }, String(c.customerCount))])
        ]
      )
    ]));
  }

  /* --------------------------------------------------------- Zahlungsmoral */

  function paymentPanel(data) {
    const p = data.paymentBehaviour;
    if (!p.customers.length) {
      return panel('Zahlungsverhalten', empty(
        'Noch keine bezahlten Rechnungen.',
        'Sobald Rechnungen gestellt und bezahlt sind, steht hier, wer wie schnell zahlt.'
      ));
    }

    const rows = p.customers.map((row) => h('tr', [
      h('td', { class: 'strong' }, row.label),
      h('td', { class: 'num' }, String(row.invoices)),
      h('td', { class: 'num' }, h('span', {
        class: row.averageDays > 30 ? 'money expense' : ''
      }, `${row.averageDays} Tage`)),
      h('td', { class: 'num small faint' }, `${row.slowest} Tage`),
      h('td', { class: 'num' }, row.overdue
        ? h('span', { class: 'tag overdue' }, `${row.overdue} zu spät`)
        : h('span', { class: 'faint' }, 'immer pünktlich'))
    ]));

    return panel('Zahlungsverhalten', table([
      { label: 'Kunde' },
      { label: 'Rechnungen', width: '110px', num: true },
      { label: 'Im Schnitt', width: '120px', num: true },
      { label: 'Langsamste', width: '120px', num: true },
      { label: '', width: '150px', num: true }
    ], rows), {
      note: p.averageDays !== null ? `Über alle Rechnungen: ${p.averageDays} Tage bis zur Zahlung` : null
    });
  }
};
