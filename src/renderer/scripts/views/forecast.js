'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Rücklage und Liquidität.
 *
 * Zwei Fragen, eine Ansicht: wie viel von dem Geld auf dem Konto gehört mir
 * eigentlich noch nicht, und reicht es bis zum nächsten großen Termin.
 */
window.Views.forecast = function forecastView(app) {
  const { h, fmt, panel, table, empty, note, field } = UI;

  const root = h('div', [app.pageHead('Rücklage und Liquidität', 'Wird gerechnet …')]);
  load();
  return root;

  async function load() {
    const [reserve, liquidity] = await Promise.all([
      window.kontor.reports.reserve(app.year),
      window.kontor.reports.liquidity(6)
    ]);

    const r = UI.unwrap(reserve, 'Rücklage');
    const l = UI.unwrap(liquidity, 'Liquidität');
    if (!r || !l) return;

    UI.clear(root);
    root.appendChild(app.pageHead(
      'Rücklage und Liquidität',
      'Die Umsatzsteuer ist exakt gerechnet, die Einkommensteuer geschätzt. Sie hängt vom gesamten zu versteuernden Einkommen ab, das dieses Programm nicht kennt, deshalb ist der Satz einstellbar.',
      [h('button', { class: 'btn ghost', onClick: () => app.navigate('settings') }, 'Annahmen ändern')]
    ));

    root.appendChild(reserveSection(r));
    root.appendChild(liquiditySection(l));
  }

  /* --------------------------------------------------------- Rücklage */

  function reserveSection(r) {
    const box = h('div');

    box.appendChild(h('div', { class: 'grid grid-4', style: { marginBottom: '18px' } }, [
      UI.stat('Zurücklegen', fmt.euro(r.total), {
        tone: 'accent',
        hint: `für Steuern auf ${app.year}`
      }),
      UI.stat('Offene Umsatzsteuer', fmt.euro(r.openVat), {
        tone: 'bad',
        hint: r.paidVat ? `${fmt.euro(r.paidVat)} bereits gezahlt` : 'noch nichts gezahlt'
      }),
      UI.stat('Einkommensteuer geschätzt', fmt.euro(r.incomeTax), {
        hint: `${r.incomeTaxRate} Prozent auf ${fmt.euro(r.profit)} Gewinn`
      }),
      UI.stat('Gewerbesteuer', r.tradeTaxRate ? fmt.euro(r.tradeTax) : '–', {
        hint: r.tradeTaxRate ? `Hebesatz ${r.tradeTaxRate} Prozent` : 'kein Hebesatz hinterlegt'
      })
    ]));

    if (r.nextVatDue && r.nextVatDue.amount > 0) {
      box.appendChild(note(
        `Nächster Termin: ${r.nextVatDue.label}, fällig am ${fmt.date(r.nextVatDue.dueDate)} mit ${fmt.euro(r.nextVatDue.amount)}.`
      ));
    }

    box.appendChild(h('details', { style: { marginTop: '4px' } }, [
      h('summary', { class: 'small muted', style: { cursor: 'pointer', marginBottom: '10px' } },
        'Worauf diese Zahlen beruhen'),
      h('ul', { class: 'small muted', style: { margin: 0, paddingLeft: '18px', lineHeight: '1.7' } },
        r.assumptions.map((line) => h('li', line)))
    ]));

    return panel(`Steuerrücklage ${app.year}`, box, {
      note: 'Eine Schätzung, keine Steuerberatung'
    });
  }

  /* --------------------------------------------------------- Liquidität */

  function liquiditySection(l) {
    if (!l.hasBalance) {
      return panel('Liquiditätsvorschau', h('div', [
        note([
          'Für die Vorschau fehlt der aktuelle Kontostand. Ohne ihn lässt sich zwar sagen, was rein und raus geht, aber nicht, ob es reicht.',
          'Den Stand trägst du in den Einstellungen unter Rücklage und Vorschau ein.'
        ], 'warn'),
        h('button', { class: 'btn primary', onClick: () => app.navigate('settings') }, 'Kontostand eintragen'),
        rowsTable(l, true)
      ]));
    }

    const box = h('div');

    if (l.warning) box.appendChild(note(l.warning, 'error'));

    box.appendChild(h('div', { class: 'grid grid-3', style: { marginBottom: '18px' } }, [
      UI.stat('Stand heute', fmt.euro(l.startBalance), {
        hint: l.balanceDate ? `eingetragen zum ${fmt.date(l.balanceDate)}` : 'ohne Datum'
      }),
      UI.stat('In sechs Monaten', fmt.euro(l.endBalance), {
        tone: l.endBalance >= l.startBalance ? 'good' : 'bad',
        hint: l.endBalance >= l.startBalance ? 'es wird mehr' : 'es wird weniger'
      }),
      UI.stat('Tiefpunkt', l.lowest ? fmt.euro(l.lowest.closing) : '–', {
        tone: l.lowest && l.lowest.closing < 0 ? 'bad' : '',
        hint: l.lowest ? `im ${l.lowest.label}` : 'keine Daten'
      })
    ]));

    box.appendChild(rowsTable(l, false));

    box.appendChild(note(
      'Gerechnet wird nur mit dem, was feststeht: offene Rechnungen, erfasste noch unbezahlte Buchungen und fällige Umsatzsteuer. Künftige Aufträge denkt sich die Vorschau nicht aus.'
    ));

    return panel('Liquiditätsvorschau', box, { note: 'die nächsten sechs Monate' });
  }

  function rowsTable(l, withoutBalance) {
    if (!l.rows.length) return empty('Keine Bewegungen im Vorschauzeitraum.');

    const rows = [];
    for (const row of l.rows) {
      rows.push(h('tr', { class: row.items.length ? 'clickable' : null, onClick: () => showMonth(row) }, [
        h('td', { class: 'strong' }, row.label),
        h('td', { class: 'num money income' }, row.incoming ? fmt.euro(row.incoming) : h('span', { class: 'faint' }, '–')),
        h('td', { class: 'num money expense' }, row.outgoing ? fmt.euro(row.outgoing) : h('span', { class: 'faint' }, '–')),
        h('td', { class: 'num' }, fmt.signed(row.change)),
        withoutBalance
          ? h('td', { class: 'faint num' }, '–')
          : h('td', { class: 'num strong' }, h('span', {
              class: row.closing < 0 ? 'money expense' : ''
            }, fmt.euro(row.closing))),
        h('td', { class: 'small faint' }, row.items.length ? `${row.items.length} Posten` : '')
      ]));
    }

    return table([
      { label: 'Monat' },
      { label: 'Eingänge', width: '130px', num: true },
      { label: 'Ausgänge', width: '130px', num: true },
      { label: 'Veränderung', width: '130px', num: true },
      { label: 'Stand am Ende', width: '140px', num: true },
      { label: '', width: '100px' }
    ], rows);
  }

  function showMonth(row) {
    if (!row.items.length) return;

    UI.modal({
      title: row.label,
      body: h('div', [
        note(`Erwartet: ${fmt.euro(row.incoming)} rein, ${fmt.euro(row.outgoing)} raus.`),
        table(
          [{ label: 'Datum' }, { label: 'Posten' }, { label: 'Betrag', num: true }],
          row.items.map((item) => h('tr', [
            h('td', { class: 'nowrap' }, fmt.date(item.date)),
            h('td', [
              h('span', { class: `tag ${item.kind === 'vat' ? 'overdue' : item.kind === 'invoice' ? 'sent' : ''}` },
                item.kind === 'vat' ? 'Finanzamt' : item.kind === 'invoice' ? 'Rechnung' : 'Buchung'),
              ' ',
              item.label,
              item.overdue ? h('span', { class: 'tag overdue', style: { marginLeft: '6px' } }, 'überfällig') : null
            ]),
            h('td', { class: 'num' }, h('span', {
              class: item.amount < 0 ? 'money expense' : 'money income'
            }, fmt.signed(item.amount)))
          ])),
          { flush: false }
        )
      ]),
      actions: (close) => [h('button', { class: 'btn', onClick: close }, 'Schließen')]
    });
  }
};
