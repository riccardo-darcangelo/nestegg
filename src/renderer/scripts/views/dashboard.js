'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Übersicht: was steht an, wie läuft das Jahr, wo fehlt etwas.
 */
window.Views.dashboard = function dashboard(app) {
  const { h, fmt, panel, stat, table, empty, note } = UI;

  const root = h('div', [
    app.pageHead(
      `Übersicht ${app.year}`,
      'Alle Zahlen nach dem Zu- und Abflussprinzip: gezählt wird, was tatsächlich geflossen ist.',
      [
        h('button', { class: 'btn', onClick: () => app.navigate('entries') }, 'Buchung erfassen'),
        h('button', { class: 'btn primary', onClick: () => app.navigate('invoices') }, 'Rechnung schreiben')
      ]
    ),
    h('div', { class: 'muted' }, 'Wird berechnet …')
  ]);

  load();
  return root;

  async function load() {
    const result = await window.kontor.reports.dashboard(app.year);
    const d = UI.unwrap(result, 'Übersicht');
    if (!d) return;

    UI.clear(root);
    root.appendChild(app.pageHead(
      `Übersicht ${app.year}`,
      'Alle Zahlen nach dem Zu- und Abflussprinzip: gezählt wird, was tatsächlich geflossen ist.',
      [
        h('button', { class: 'btn', onClick: () => app.navigate('entries') }, 'Buchung erfassen'),
        h('button', { class: 'btn primary', onClick: () => app.navigate('invoices') }, 'Rechnung schreiben')
      ]
    ));

    root.appendChild(h('div', { class: 'grid grid-4', style: { marginBottom: '18px' } }, [
      stat('Einnahmen', fmt.euro(d.incomeTotal), {
        tone: 'good',
        hint: `${d.entriesCount} bezahlte Buchungen`
      }),
      stat('Ausgaben', fmt.euro(d.expenseTotal), {
        tone: 'bad',
        hint: `davon ${fmt.euro(d.paidInputVat)} Vorsteuer`
      }),
      stat('Gewinn', fmt.euro(d.profit), {
        tone: d.profit >= 0 ? 'accent' : 'bad',
        hint: 'Vorläufiges Ergebnis der EÜR'
      }),
stat('Offene Forderungen', fmt.euro(d.openInvoices.reduce((s, i) => s + i.open, 0)), {
        tone: d.openInvoices.some((i) => i.status === 'overdue') ? 'bad' : '',
        hint: d.openInvoices.length
          ? `${d.openInvoices.length} ${d.openInvoices.length === 1 ? 'Rechnung wartet' : 'Rechnungen warten'} auf Zahlung`
          : 'alles bezahlt'
      })
    ]));

    if (d.recurringDue) {
      root.appendChild(h('div', { class: 'note action' }, [
        h('span', `${d.recurringDue} ${d.recurringDue === 1 ? 'wiederkehrender Posten steht' : 'wiederkehrende Posten stehen'} an und ${d.recurringDue === 1 ? 'wartet' : 'warten'} auf deine Bestätigung.`),
        h('button', {
          class: 'btn small primary',
          onClick: () => app.navigate('recurring')
        }, 'Ansehen')
      ]));
    }

    if (d.nextPeriod) {
      root.appendChild(note([
        `Nächste Umsatzsteuer-Voranmeldung: ${d.nextPeriod.label}, abzugeben bis ${fmt.date(d.nextPeriod.dueDate)}.`,
        d.nextPeriod.payable >= 0
          ? `Voraussichtliche Zahllast: ${fmt.euro(d.nextPeriod.payable)}.`
          : `Voraussichtlicher Erstattungsanspruch: ${fmt.euro(-d.nextPeriod.payable)}.`
      ]));
    }

    root.appendChild(panel('Monatsverlauf', chart(d.months), {
      note: 'Zahlungsströme brutto je Monat'
    }));

    root.appendChild(h('div', { class: 'grid grid-2' }, [
      openInvoicesPanel(d),
      attentionPanel(d)
    ]));
  }

  function chart(months) {
    const names = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    const max = Math.max(1, ...months.map((m) => Math.max(m.income, m.expense)));

    return h('div', [
      h('div', { class: 'chart' }, months.map((m, i) =>
        h('div', { class: 'chart-col' }, [
          h('div', { class: 'chart-bars' }, [
            h('div', {
              class: 'chart-bar income',
              style: { height: `${(m.income / max) * 100}%` },
              title: `${names[i]}: Einnahmen ${fmt.euro(m.income)}`
            }),
            h('div', {
              class: 'chart-bar expense',
              style: { height: `${(m.expense / max) * 100}%` },
              title: `${names[i]}: Ausgaben ${fmt.euro(m.expense)}`
            })
          ]),
          h('div', { class: 'chart-label' }, names[i])
        ])
      )),
      h('div', { class: 'small faint', style: { marginTop: '10px', display: 'flex', gap: '16px' } }, [
        h('span', [h('span', { class: 'money income' }, '■'), ' Einnahmen']),
        h('span', [h('span', { class: 'money expense' }, '■'), ' Ausgaben'])
      ])
    ]);
  }

  function openInvoicesPanel(d) {
    if (!d.openInvoices.length) {
      return panel('Offene Rechnungen', empty('Nichts offen.', 'Alle gestellten Rechnungen sind bezahlt.'));
    }

    const today = UI.todayIso();
    const rows = d.openInvoices.slice(0, 8).map((inv) => {
      const overdue = inv.dueDate && inv.dueDate < today;
      return UI.clickableRow({ onClick: () => app.navigate('invoices') }, [
        h('td', { class: 'strong nowrap' }, inv.number || 'Entwurf'),
        h('td', app.customerName(inv.customerId)),
        h('td', h('span', { class: `tag ${overdue ? 'overdue' : 'sent'}` },
          overdue ? `seit ${fmt.date(inv.dueDate)}` : `bis ${fmt.date(inv.dueDate)}`)),
        h('td', { class: 'num strong' }, fmt.euro(inv.open))
      ]);
    });

    const total = d.openInvoices.reduce((s, i) => s + i.open, 0);
    rows.push(h('tr', { class: 'sum' }, [
      h('td', { colspan: 3 }, d.openInvoices.length === 1
        ? 'Eine offene Rechnung'
        : `${d.openInvoices.length} offene Rechnungen`),
      h('td', { class: 'num' }, fmt.euro(total))
    ]));

    return panel('Offene Rechnungen', table(
      [{ label: 'Nummer' }, { label: 'Kunde' }, { label: 'Fällig' }, { label: 'Offen', num: true }],
      rows
    ));
  }

  function attentionPanel(d) {
    const items = [];

    if (d.openTotals.income) {
      items.push(`${fmt.euro(d.openTotals.income)} an Einnahmen sind erfasst, aber noch ohne Zahlungsdatum. Sie zählen erst mit dem Geldeingang.`);
    }
    if (d.openTotals.expense) {
      items.push(`${fmt.euro(d.openTotals.expense)} an Ausgaben warten auf ein Zahlungsdatum.`);
    }
    if (d.missingReceipts) {
      items.push(`${d.missingReceipts} Ausgaben über 250 Euro haben keinen Beleg. Ab dieser Grenze verlangt das Finanzamt eine vollständige Rechnung.`);
    }
    if (!app.settings.company.taxNumber && !app.settings.company.vatId) {
      items.push('In den Einstellungen fehlt Steuernummer oder USt-IdNr. Ohne sie ist keine gültige Rechnung möglich.');
    }
    if (!app.settings.company.iban) {
      items.push('Ohne IBAN fehlen auf der Rechnung und in der E-Rechnung die Zahlungsdaten.');
    }

    const limit = app.settings.tax.smallBusinessLimitNet;
    if (app.settings.tax.scheme === 'klein' && d.turnover > limit * 0.8) {
      items.push(`Der Umsatz liegt bei ${fmt.euro(d.turnover)}. Die Kleinunternehmergrenze rückt näher.`);
    }

    if (!items.length) {
      return panel('Zu erledigen', empty('Alles sauber.', 'Keine offenen Punkte für dieses Jahr.'));
    }

    return panel('Zu erledigen', h('div', items.map((item) =>
      h('div', { style: { padding: '9px 0', borderBottom: '1px solid #1f2632' } }, item)
    )));
  }
};
