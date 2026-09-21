'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Umsatzsteuer: Jahresübersicht und die einzelne Voranmeldung mit den
 * Kennzahlen des amtlichen Vordrucks.
 */
window.Views.vat = function vatView(app) {
  const { h, fmt, panel, table, empty } = UI;

  const root = h('div', [app.pageHead(`Umsatzsteuer ${app.year}`, 'Wird berechnet …')]);
  load();
  return root;

  /**
   * Die Schwellen, die über den Abgaberhythmus entscheiden.
   *
   * Sie wurden 2025 angehoben, und das Finanzamt ändert den Rhythmus nicht von
   * selbst. Wer hier nicht nachsieht, gibt womöglich jahrelang zwölfmal ab,
   * obwohl vier reichen würden.
   */
  async function loadThresholds() {
    const data = UI.unwrap(await window.kontor.reports.thresholds({ year: app.year }));
    if (!data) return;

    const advice = data.vatPeriod;
    const lines = [
      `Im Jahr ${advice.previousYear} betrug die Zahllast ${fmt.euro(advice.payable)}. Daraus folgt: ${advice.label}.`,
      ...advice.notes
    ];

    const host = h('div');
    host.appendChild(UI.note(lines, advice.matches ? '' : 'warn'));

    if (data.smallBusiness.warnings.length) {
      host.appendChild(UI.note(data.smallBusiness.warnings, 'warn'));
    }

    // Ans Ende der Kennzahlen, vor die Tabelle.
    const target = root.querySelector('.grid.grid-3');
    if (target && target.nextSibling) root.insertBefore(host, target.nextSibling);
    else root.appendChild(host);
  }

  async function load() {
    const data = UI.unwrap(await window.kontor.reports.vatYear(app.year), 'Umsatzsteuer');
    if (!data) return;

    const method = app.settings.tax.vatMethod === 'soll' ? 'Soll-Versteuerung' : 'Ist-Versteuerung';
    const basis = app.settings.tax.inputVatBasis === 'payment' ? 'Zahlung' : 'Rechnungsdatum';

    UI.clear(root);
    root.appendChild(app.pageHead(
      `Umsatzsteuer ${app.year}`,
      `${method}: die Steuer entsteht ${app.settings.tax.vatMethod === 'soll' ? 'mit der Rechnungsstellung' : 'mit dem Zahlungseingang'}. Die Vorsteuer wird nach dem ${basis} abgegrenzt. Die Zahlen sind zum Übertragen nach ELSTER gedacht, übermittelt wird hier nichts.`,
      [h('button', {
        class: 'btn',
        onClick: async () => {
          const res = UI.unwrap(await window.kontor.reports.exportYear(app.year), 'Export');
          if (res) UI.toast(`Gespeichert: ${res.file}`, 'success');
        }
      }, 'Jahresmappe als Excel')]
    ));

    if (data.archiveNote) root.appendChild(UI.note([data.archiveNote], 'warn'));

    const totalPayable = data.overview.reduce((s, p) => s + p.payable, 0);
    root.appendChild(h('div', { class: 'grid grid-3', style: { marginBottom: '18px' } }, [
      UI.stat('Umsatzsteuer', fmt.euro(data.overview.reduce((s, p) => s + p.outputVat, 0)), { tone: 'bad' }),
      UI.stat('Vorsteuer', fmt.euro(data.overview.reduce((s, p) => s + p.inputVat, 0)), { tone: 'good' }),
      UI.stat(totalPayable >= 0 ? 'Zahllast im Jahr' : 'Erstattung im Jahr', fmt.euro(Math.abs(totalPayable)), {
        tone: 'accent',
        hint: data.mode === 'monthly' ? 'monatliche Abgabe' : data.mode === 'quarterly' ? 'vierteljährliche Abgabe' : 'jährliche Abgabe'
      })
    ]));

    loadThresholds();

    if (data.special) {
      root.appendChild(UI.note(
        `Dauerfristverlängerung: Die Sondervorauszahlung für ${app.year} beträgt ${fmt.euro(data.special.amount)}, ein Elftel der Vorauszahlungen des Vorjahres. Fällig am ${fmt.date(data.special.dueDate)}. Sie wird mit der letzten Voranmeldung des Jahres verrechnet.`,
        'warn'
      ));
    }

    const today = UI.todayIso();
    const rows = data.overview.map((period) => UI.clickableRow({
      onClick: () => showPeriod(period)
    }, [
      h('td', { class: 'strong' }, period.label),
      h('td', { class: 'nowrap' }, [
        fmt.date(period.dueDate),
        period.dueDate < today && period.payable !== 0
          ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, 'vergangen')
          : null
      ]),
      h('td', { class: 'num' }, fmt.euro(period.outputVat)),
      h('td', { class: 'num' }, fmt.euro(period.inputVat)),
      h('td', { class: 'num strong' }, period.payable >= 0
        ? fmt.euro(period.payable)
        : h('span', { class: 'money income' }, fmt.euro(period.payable)))
    ]));

    if (!rows.length) {
      root.appendChild(panel(null, empty('Keine Zeiträume.')));
      return;
    }

    rows.push(h('tr', { class: 'sum' }, [
      h('td', { colspan: 2 }, 'Summe'),
      h('td', { class: 'num' }, fmt.euro(data.overview.reduce((s, p) => s + p.outputVat, 0))),
      h('td', { class: 'num' }, fmt.euro(data.overview.reduce((s, p) => s + p.inputVat, 0))),
      h('td', { class: 'num' }, fmt.euro(totalPayable))
    ]));

    root.appendChild(panel('Voranmeldungen', table([
      { label: 'Zeitraum' },
      { label: 'Abgabe bis', width: '160px' },
      { label: 'Umsatzsteuer', width: '150px', num: true },
      { label: 'Vorsteuer', width: '150px', num: true },
      { label: 'Zahllast', width: '150px', num: true }
    ], rows), { note: 'Zeitraum anklicken für die Kennzahlen' }));

    loadEcSales();
  }

  /**
   * Zusammenfassende Meldung.
   *
   * Wer Leistungen an Unternehmer im EU-Ausland erbringt und die Steuerschuld
   * überträgt, muss das gesondert melden. Das ist eine eigene Pflicht neben der
   * Voranmeldung und wird gern übersehen.
   */
  async function loadEcSales() {
    const data = UI.unwrap(await window.kontor.reports.ecSales({ year: app.year }), 'Meldung');
    if (!data) return;

    const relevant = data.overview.some((p) => p.total > 0 || p.problemCount > 0);
    if (!relevant) return;

    const rows = data.overview
      .filter((period) => period.total > 0 || period.problemCount > 0)
      .map((period) => UI.clickableRow({
        onClick: () => showEcSalesPeriod(period)
      }, [
        h('td', { class: 'strong' }, period.label),
        h('td', { class: 'nowrap' }, fmt.date(period.dueDate)),
        h('td', { class: 'num' }, period.services ? fmt.euro(period.services) : h('span', { class: 'faint' }, '–')),
        h('td', { class: 'num' }, period.goods ? fmt.euro(period.goods) : h('span', { class: 'faint' }, '–')),
        h('td', { class: 'num strong' }, fmt.euro(period.total)),
        h('td', period.problemCount
          ? h('span', { class: 'tag overdue' }, `${period.problemCount} Hinweise`)
          : h('span', { class: 'faint small' }, 'vollständig'))
      ]));

    root.appendChild(panel('Zusammenfassende Meldung', h('div', [
      UI.note([
        'Leistungen an Unternehmer im übrigen Gemeinschaftsgebiet sind im Inland nicht steuerbar, müssen aber dem Bundeszentralamt gemeldet werden, mit USt-IdNr. und Summe je Kunde.',
        'Anders als bei der Voranmeldung zählt hier nicht die Zahlung, sondern der Zeitpunkt der Leistung. Abzugeben bis zum 25. nach Ende des Meldezeitraums.',
        data.needsMonthly
          ? 'Die innergemeinschaftlichen Lieferungen überschreiten 50.000 Euro in einem Quartal. Damit wird monatlich gemeldet.'
          : null
      ].filter(Boolean)),
      table([
        { label: 'Zeitraum' },
        { label: 'Abgabe bis', width: '160px' },
        { label: 'Sonstige Leistungen', width: '170px', num: true },
        { label: 'Lieferungen', width: '150px', num: true },
        { label: 'Summe', width: '140px', num: true },
        { label: '', width: '140px' }
      ], rows)
    ]), { note: 'Zeitraum anklicken für die Zeilen der Meldung' }));
  }

  async function showEcSalesPeriod(period) {
    const data = UI.unwrap(
      await window.kontor.reports.ecSales({ year: app.year, periodKey: period.key }),
      'Meldung'
    );
    if (!data) return;
    const detail = data.detail;

    UI.modal({
      title: `Zusammenfassende Meldung ${period.label}`,
      wide: true,
      body: h('div', [
        UI.note(`Abzugeben bis ${fmt.date(period.dueDate)} beim Bundeszentralamt für Steuern. Beträge netto, je Kunde eine Zeile.`),

        detail.problems.length
          ? UI.note(detail.problems, 'error')
          : null,

        detail.lines.length
          ? UI.table(
              [
                { label: 'USt-IdNr.' },
                { label: 'Kunde' },
                { label: 'Art', width: '150px' },
                { label: 'Betrag', width: '140px', num: true }
              ],
              detail.lines.map((line) => h('tr', [
                h('td', { class: 'strong mono' }, line.vatId),
                h('td', line.name),
                h('td', { class: 'small' }, line.kind === 'goods' ? 'Lieferung' : 'Sonstige Leistung'),
                h('td', { class: 'num' }, fmt.euro(line.amount))
              ])),
              { flush: false }
            )
          : UI.empty('Keine meldepflichtigen Umsätze in diesem Zeitraum.'),

        h('div', { class: 'grid grid-3', style: { marginTop: '16px' } }, [
          UI.stat('Sonstige Leistungen', fmt.euro(detail.services)),
          UI.stat('Lieferungen', fmt.euro(detail.goods)),
          UI.stat('Summe', fmt.euro(detail.total), { tone: 'accent' })
        ])
      ]),
      actions: (close) => [h('button', { class: 'btn', onClick: close }, 'Schließen')]
    });
  }

  async function showPeriod(period) {
    const detail = UI.unwrap(
      await window.kontor.reports.vat({ year: app.year, periodKey: period.key }),
      'Voranmeldung'
    );
    if (!detail) return;

    // Reihenfolge wie im Vordruck, nicht numerisch: sonst stünde die Vorsteuer
    // vor den Umsätzen und das Abtippen würde unnötig mühsam.
    const order = detail.order || Object.keys(detail.kz);
    const entries = Object.entries(detail.kz)
      .filter(([code, value]) => value !== 0 || code === '83')
      .sort((a, b) => {
        const ia = order.indexOf(a[0]);
        const ib = order.indexOf(b[0]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

    UI.modal({
      title: `Voranmeldung ${period.label}`,
      wide: true,
      body: h('div', [
        UI.note(`Abzugeben bis ${fmt.date(period.dueDate)}. Werte zum Übertragen in das ELSTER-Formular. Bemessungsgrundlagen stehen netto, Steuerbeträge als Betrag.`),

        h('div', { style: { marginBottom: '18px' } }, entries.map(([code, value]) =>
          h('div', { class: 'kz-row' }, [
            h('div', { class: 'kz-label' }, [
              h('span', { class: 'kz-code' }, code),
              ' ',
              detail.labels[code] || ''
            ]),
            h('div', { class: 'kz-value' }, fmt.euro(value))
          ])
        )),

        h('div', { class: 'grid grid-3' }, [
          UI.stat('Umsatzsteuer', fmt.euro(detail.outputVat), { tone: 'bad' }),
          UI.stat('Vorsteuer', fmt.euro(detail.inputVat), { tone: 'good' }),
          UI.stat(detail.payable >= 0 ? 'Zahllast' : 'Erstattung', fmt.euro(Math.abs(detail.payable)), { tone: 'accent' })
        ]),

        detail.details.outputs.length || detail.details.inputs.length
          ? h('details', { style: { marginTop: '18px' } }, [
              h('summary', { class: 'small muted', style: { cursor: 'pointer', marginBottom: '10px' } },
                `Zugrunde liegende Buchungen (${detail.details.outputs.length + detail.details.inputs.length})`),
              UI.table(
                [{ label: 'Datum' }, { label: 'Vorgang' }, { label: 'Netto', num: true }, { label: 'Steuer', num: true }],
                [
                  ...detail.details.outputs.map((d) => h('tr', [
                    h('td', fmt.date(d.date)),
                    h('td', [h('span', { class: 'tag sent' }, 'Umsatz'), ' ', d.entry.description]),
                    h('td', { class: 'num' }, fmt.euro(d.net)),
                    h('td', { class: 'num' }, fmt.euro(d.vat))
                  ])),
                  ...detail.details.inputs.map((d) => h('tr', [
                    h('td', fmt.date(d.date)),
                    h('td', [h('span', { class: 'tag paid' }, 'Vorsteuer'), ' ', d.entry.description]),
                    h('td', { class: 'num' }, fmt.euro(d.net)),
                    h('td', { class: 'num' }, fmt.euro(d.vat))
                  ]))
                ],
                { flush: false }
              )
            ])
          : null
      ]),
      actions: (close) => [h('button', { class: 'btn', onClick: close }, 'Schließen')]
    });
  }
};
