'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Rücklagen, Mittelverwendung und Vermögen.
 *
 * Drei Rechnungen, die dieselbe Frage aus drei Richtungen beantworten: wo
 * liegen die Mittel, die noch nicht verwendet wurden? Ein gemeinnütziger
 * Verein muss darauf jederzeit antworten können, denn davon hängt die
 * Gemeinnützigkeit ab.
 */
window.Views.reserves = function reservesView(app) {
  const { h, fmt, panel, table, empty, note, field, select } = UI;

  const state = app.state.reserves || (app.state.reserves = {});
  const root = h('div', [app.pageHead(`Rücklagen ${app.year}`, 'Wird gerechnet …')]);

  load();
  return root;

  async function load() {
    const data = UI.unwrap(await window.kontor.reserves.overview({ year: app.year }), 'Rücklagen');
    if (!data) return;
    state.data = data;
    render();
  }

  function render() {
    const { overview, useOfFunds, netAssets } = state.data;

    UI.clear(root);
    root.appendChild(app.pageHead(
      `Rücklagen und Vermögen ${app.year}`,
      'Mittel sind grundsätzlich zeitnah zu verwenden. Rücklagen nach §62 AO sind die erlaubten Ausnahmen, jede mit eigenem Grund und eigener Grenze.',
      [
        h('button', {
          class: 'btn ghost',
          onClick: async () => {
            const result = UI.unwrap(await window.kontor.reserves.document({ year: app.year }), 'Vermögensübersicht');
            if (result) UI.toast(`Gespeichert: ${result.file}`, 'success');
          }
        }, 'Übersicht als PDF'),
        h('button', { class: 'btn primary', onClick: () => openForm({}) }, 'Rücklage anlegen')
      ]
    ));

    root.appendChild(h('div', { class: 'grid grid-4', style: { marginBottom: '18px' } }, [
      UI.stat('Rücklagen', fmt.euro(overview.total), {
        hint: `${overview.reserves.length} ${overview.reserves.length === 1 ? 'Rücklage' : 'Rücklagen'}`
      }),
      UI.stat('Freie Rücklage möglich', fmt.euro(overview.free.open), {
        tone: overview.free.exceeded ? 'bad' : 'accent',
        hint: overview.free.carryTotal ? `davon ${fmt.euro(overview.free.carryTotal)} aus Vorjahren` : 'in diesem Jahr'
      }),
      UI.stat('Noch zu verwenden', fmt.euro(Math.max(0, useOfFunds.remaining)), {
        tone: useOfFunds.remaining > 0 && useOfFunds.applies ? 'bad' : '',
        hint: useOfFunds.applies ? `bis ${fmt.date(useOfFunds.deadline)}` : 'keine Frist, kleiner Verein'
      }),
      UI.stat('Vereinsvermögen', fmt.euro(netAssets.equity), {
        tone: 'good',
        hint: `Stichtag ${fmt.date(state.data.date)}`
      })
    ]));

    if (overview.warnings.length) root.appendChild(note(overview.warnings, 'warn'));

    root.appendChild(freePanel(overview.free));
    root.appendChild(listPanel(overview));
    root.appendChild(useOfFundsPanel(useOfFunds));
    root.appendChild(assetsPanel(netAssets));
  }

  /* --------------------------------------------------------- Freie Rücklage */

  function freePanel(free) {
    const rows = [
      ['Überschuss aus der Vermögensverwaltung', free.assetSurplus, ''],
      ['davon ein Drittel', free.third, '§62 Abs. 1 Nr. 3 AO'],
      ['Sonstige zeitnah zu verwendende Mittel', free.otherMeans, 'Bruttoeinnahmen ideell, Gewinne aus Zweckbetrieb und Wirtschaftsbetrieb'],
      ['davon zehn Prozent', free.tenth, '']
    ].map(([label, value, hint]) => h('tr', [
      h('td', [label, hint ? h('div', { class: 'small faint' }, hint) : null]),
      h('td', { class: 'num' }, fmt.euro(value))
    ]));

    rows.push(h('tr', { class: 'sum' }, [
      h('td', 'Höchstbetrag dieses Jahres'),
      h('td', { class: 'num' }, fmt.euro(free.limit))
    ]));

    for (const carry of free.carry) {
      rows.push(h('tr', [
        h('td', [
          `Nicht ausgeschöpft aus ${carry.year}`,
          h('div', { class: 'small faint' }, `Höchstbetrag ${fmt.euro(carry.limit)}, genutzt ${fmt.euro(carry.used)}`)
        ]),
        h('td', { class: 'num' }, fmt.euro(carry.remaining))
      ]));
    }

    if (free.carryTotal) {
      rows.push(h('tr', { class: 'sum' }, [
        h('td', 'Insgesamt verfügbar'),
        h('td', { class: 'num' }, fmt.euro(free.available))
      ]));
    }

    rows.push(h('tr', [
      h('td', 'Bereits zugeführt'),
      h('td', { class: `num ${free.exceeded ? 'bad strong' : ''}`.trim() }, fmt.euro(free.used))
    ]));

    return panel('Freie Rücklage', h('div', [
      note([
        'Die einzige Rücklage, deren Höhe sich rechnen lässt, und die einzige ohne Zweckbindung. Sie muss nicht aufgelöst werden.',
        'Ein nicht ausgeschöpfter Höchstbetrag lässt sich in den beiden folgenden Jahren nachholen, danach verfällt er.'
      ]),
      table([{ label: 'Rechnung' }, { label: 'Betrag', width: '150px', num: true }], rows)
    ]), { note: free.exceeded ? 'Höchstbetrag überschritten' : `noch ${fmt.euro(free.open)} möglich` });
  }

  /* --------------------------------------------------------- Liste */

  function listPanel(overview) {
    if (!overview.reserves.length) {
      return panel('Gebildete Rücklagen', empty(
        'Noch keine Rücklage gebildet.',
        'Was nicht zeitnah verwendet wird, gehört in eine Rücklage mit erkennbarem Grund. Sonst steht die Gemeinnützigkeit in Frage.',
        h('button', { class: 'btn primary', onClick: () => openForm({}) }, 'Erste Rücklage anlegen')
      ));
    }

    const rows = overview.reserves.map((reserve) => h('tr', { class: reserve.overdue ? 'overdue-row' : null }, [
      h('td', [
        h('div', { class: 'strong' }, reserve.label),
        h('div', { class: 'small faint' }, [
          reserve.typeLabel,
          reserve.law ? ` · ${reserve.law}` : '',
          reserve.purpose ? ` · ${reserve.purpose}` : ''
        ].join(''))
      ]),
      h('td', reserve.deadline
        ? h('span', { class: reserve.overdue ? 'tag overdue' : 'tag' }, fmt.date(reserve.deadline))
        : h('span', { class: 'small faint' }, 'ohne Frist')),
      h('td', { class: 'num' }, reserve.added ? fmt.euro(reserve.added) : '–'),
      h('td', { class: 'num' }, reserve.released ? fmt.euro(reserve.released) : '–'),
      h('td', { class: 'num strong' }, fmt.euro(reserve.balance)),
      h('td', { class: 'nowrap' }, [
        h('button', { class: 'btn small', onClick: () => openMove(reserve, 'add') }, 'Zuführen'),
        reserve.balance > 0 ? h('button', {
          class: 'btn small ghost',
          style: { marginLeft: '6px' },
          onClick: () => openMove(reserve, 'release')
        }, 'Auflösen') : null,
        h('button', {
          class: 'btn small ghost',
          style: { marginLeft: '6px' },
          onClick: () => openForm(reserve)
        }, 'Ändern')
      ])
    ]));

    return panel('Gebildete Rücklagen', table([
      { label: 'Rücklage' },
      { label: 'Frist', width: '120px' },
      { label: `Zuführung ${app.year}`, width: '130px', num: true },
      { label: 'Auflösung', width: '120px', num: true },
      { label: 'Bestand', width: '130px', num: true },
      { label: '', width: '230px' }
    ], rows), { note: `Bestand zusammen ${fmt.euro(overview.total)}` });
  }

  /* --------------------------------------------------------- Mittelverwendung */

  function useOfFundsPanel(use) {
    const rows = [
      ['Zeitnah zu verwendende Mittel', use.inflow, 'Einnahmen des ideellen Bereichs und Überschüsse der übrigen Bereiche'],
      ['Für satzungsmäßige Zwecke verwendet', -use.used, ''],
      ['In Rücklagen eingestellt', -use.toReserves, ''],
      ['Aus Rücklagen entnommen', use.fromReserves, '']
    ].map(([label, value, hint]) => h('tr', [
      h('td', [label, hint ? h('div', { class: 'small faint' }, hint) : null]),
      h('td', { class: 'num' }, fmt.signed(value))
    ]));

    rows.push(h('tr', { class: 'sum' }, [
      h('td', 'Noch zu verwenden'),
      h('td', { class: 'num' }, fmt.euro(use.remaining))
    ]));

    return panel('Mittelverwendung', h('div', [
      table([{ label: 'Rechnung' }, { label: 'Betrag', width: '150px', num: true }], rows),
      note([use.note], use.remaining > 0 && use.applies ? 'warn' : '')
    ]));
  }

  /* --------------------------------------------------------- Vermögen */

  function assetsPanel(assets) {
    const aktiva = [
      h('tr', [h('td', 'Bank und Kasse'), h('td', { class: 'num' }, fmt.euro(assets.assets.liquid))]),
      h('tr', [h('td', 'Forderungen aus Rechnungen'), h('td', { class: 'num' }, fmt.euro(assets.assets.receivables))]),
      h('tr', [h('td', 'Anlagevermögen'), h('td', { class: 'num' }, fmt.euro(assets.assets.fixedAssets))]),
      ...assets.assets.items.map((item) => h('tr', [
        h('td', { class: 'small faint', style: { paddingLeft: '20px' } }, item.name),
        h('td', { class: 'num small faint' }, fmt.euro(item.bookValue))
      ])),
      h('tr', { class: 'sum' }, [h('td', 'Summe Aktiva'), h('td', { class: 'num' }, fmt.euro(assets.assets.total))])
    ];

    const passiva = [
      h('tr', [h('td', 'Verbindlichkeiten'), h('td', { class: 'num' }, fmt.euro(assets.liabilities.payables))]),
      h('tr', [h('td', 'Rücklagen nach §62 AO'), h('td', { class: 'num' }, fmt.euro(assets.liabilities.reservesTotal))]),
      ...assets.liabilities.reserves.map((item) => h('tr', [
        h('td', { class: 'small faint', style: { paddingLeft: '20px' } }, item.label),
        h('td', { class: 'num small faint' }, fmt.euro(item.balance))
      ])),
      h('tr', [h('td', { class: 'strong' }, 'Vereinsvermögen'), h('td', { class: 'num strong' }, fmt.euro(assets.equity))]),
      h('tr', { class: 'sum' }, [h('td', 'Summe Passiva'), h('td', { class: 'num' }, fmt.euro(assets.assets.total))])
    ];

    return panel(`Vermögensübersicht zum ${fmt.date(assets.date)}`, h('div', [
      !assets.hasOpeningBalance ? note([
        'Für dieses Profil ist kein Anfangsbestand der Geldkonten hinterlegt. Die Zeile Bank und Kasse zeigt deshalb nur die Bewegungen, nicht den tatsächlichen Bestand. Der Stand gehört in die Einstellungen unter Rücklage und Vorschau.'
      ], 'warn') : null,
      h('div', { class: 'grid grid-2' }, [
        table([{ label: 'Aktiva' }, { label: 'Betrag', width: '140px', num: true }], aktiva),
        table([{ label: 'Passiva' }, { label: 'Betrag', width: '140px', num: true }], passiva)
      ])
    ]), { note: 'Rechenschaft nach §63 Abs. 3 AO' });
  }

  /* --------------------------------------------------------- Formulare */

  function openForm(initial) {
    const types = app.boot.reserveTypes;
    const draft = {
      id: initial.id || null,
      type: initial.type || 'free',
      label: initial.label || '',
      purpose: initial.purpose || '',
      deadline: initial.deadline || '',
      movements: initial.movements || []
    };

    const body = h('div');
    const build = () => {
      UI.clear(body);
      const type = types.find((item) => item.id === draft.type) || types[0];

      body.appendChild(note([`${type.hint}. Rechtsgrundlage: ${type.law}.`]));

      body.appendChild(field('Art', select(
        types.map((item) => ({ value: item.id, label: item.label })),
        draft.type,
        {
          onChange: (e) => {
            draft.type = e.target.value;
            const next = types.find((item) => item.id === draft.type);
            if (!draft.label || types.some((item) => item.label === draft.label)) draft.label = next.label;
            build();
          }
        }
      )));

      body.appendChild(field('Bezeichnung', UI.input({
        value: draft.label,
        placeholder: type.label,
        onInput: (e) => { draft.label = e.target.value; }
      })));

      if (type.needsPurpose) {
        body.appendChild(field('Grund', UI.input({
          value: draft.purpose,
          placeholder: type.id === 'replacement' ? 'z. B. Ersatz des Rasenmähers' : 'z. B. Sanierung des Hallendachs',
          onInput: (e) => { draft.purpose = e.target.value; }
        }), 'Je konkreter, desto belastbarer in einer Prüfung'));
      }

      if (type.needsDeadline) {
        body.appendChild(field('Umsetzung bis', UI.dateInput({
          value: draft.deadline,
          onChange: (e) => { draft.deadline = e.target.value; }
        }), 'Eine zweckgebundene Rücklage braucht eine Zeitvorstellung'));
      }
    };

    build();

    UI.modal({
      title: draft.id ? 'Rücklage ändern' : 'Rücklage anlegen',
      body,
      actions: (close) => [
        draft.id ? h('button', {
          class: 'btn ghost danger',
          onClick: async () => {
            const ok = await UI.confirm(`Die Rücklage "${draft.label}" löschen?`, {
              title: 'Rücklage löschen', confirmLabel: 'Löschen', danger: true
            });
            if (!ok) return;
            if (!UI.unwrap(await window.kontor.reserves.remove(draft.id), 'Löschen')) return;
            close();
            await app.refresh();
            await load();
          }
        }, 'Löschen') : null,
        h('div', { style: { flex: '1' } }),
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (!UI.unwrap(await window.kontor.reserves.save(draft), 'Speichern')) return;
            close();
            await app.refresh();
            await load();
          }
        }, 'Speichern')
      ].filter(Boolean)
    });
  }

  function openMove(reserve, kind) {
    const draft = {
      id: reserve.id,
      kind,
      amount: 0,
      year: app.year,
      date: app.boot.today,
      note: ''
    };

    const free = state.data.overview.free;
    const isFree = reserve.type === 'free';

    UI.modal({
      title: kind === 'add' ? `Zuführung: ${reserve.label}` : `Auflösung: ${reserve.label}`,
      body: h('div', [
        kind === 'add' && isFree
          ? note([`In diesem Jahr sind noch ${UI.fmt.euro(free.open)} möglich: ${UI.fmt.euro(free.limit)} Höchstbetrag${free.carryTotal ? ` plus ${UI.fmt.euro(free.carryTotal)} aus den Vorjahren` : ''}, davon ${UI.fmt.euro(free.used)} genutzt.`])
          : null,
        kind === 'release'
          ? note([`Bestand ${UI.fmt.euro(reserve.balance)}. Aufgelöste Mittel sind wieder zeitnah zu verwenden.`])
          : null,
        h('div', { class: 'grid grid-3' }, [
          field('Betrag', UI.amountInput({
            onInput: (e) => { draft.amount = UI.parseAmount(e.target.value); }
          })),
          field('Wirtschaftsjahr', UI.input({
            type: 'number', class: 'num', value: String(draft.year),
            onInput: (e) => { draft.year = Number(e.target.value) || app.year; }
          }), 'Dem Jahr zugerechnet, nicht dem Beschlussdatum'),
          field('Datum', UI.dateInput({
            value: draft.date,
            onChange: (e) => { draft.date = e.target.value; }
          }))
        ]),
        field('Bemerkung', UI.input({
          placeholder: kind === 'add' ? 'z. B. Beschluss der Mitgliederversammlung' : 'z. B. Dach saniert',
          onInput: (e) => { draft.note = e.target.value; }
        }))
      ]),
      wide: true,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (!UI.unwrap(await window.kontor.reserves.move(draft), 'Speichern')) return;
            close();
            await app.refresh();
            await load();
          }
        }, kind === 'add' ? 'Zuführen' : 'Auflösen')
      ]
    });
  }
};
