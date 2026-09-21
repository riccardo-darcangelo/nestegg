'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Zeiterfassung.
 *
 * Oben die Uhr, darunter was offen ist, darunter die Einträge. Eine erfasste
 * Stunde berührt die Buchhaltung erst über eine Rechnung, deshalb führt von
 * hier genau ein Weg weiter: der Rechnungsentwurf.
 */
window.Views.time = function timeView(app) {
  const { h, fmt, panel, table, empty, note, field, select, checkbox } = UI;

  const state = app.state.time || (app.state.time = { filter: 'open' });
  const root = h('div');
  let ticker = null;

  render();
  load();
  return root;

  async function load() {
    const data = UI.unwrap(await window.kontor.times.overview({ year: app.year }), 'Zeiten');
    if (!data) return;
    state.data = data;
    render();
  }

  /* --------------------------------------------------------- Rahmen */

  function render() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    UI.clear(root);

    root.appendChild(app.pageHead(
      'Zeiten',
      'Arbeitszeit auf Projekte erfassen und daraus abrechnen. Eine erfasste Stunde ist noch kein Geschäftsvorfall: erst die Rechnung bucht.',
      [h('button', { class: 'btn', onClick: () => openForm({}) }, 'Zeit nachtragen')]
    ));

    if (!state.data) {
      root.appendChild(panel(null, empty('Wird geladen …')));
      return;
    }

    root.appendChild(clockPanel());
    root.appendChild(summaryRow());

    if (state.data.projects.length) {
      root.appendChild(projectPanel());
    }

    root.appendChild(listPanel());
  }

  /* --------------------------------------------------------- Uhr */

  function clockPanel() {
    const laufend = state.data.running;
    const projects = app.data.projects.filter((p) => ['planned', 'active'].includes(p.status));

    if (!laufend) {
      const draft = { projectId: projects.length ? projects[0].id : null, description: '' };

      return panel('Aufnahme', h('div', { class: 'clock-row' }, [
        field('Projekt', select(
          [{ value: '', label: 'ohne Projekt' }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
          draft.projectId || '',
          { onChange: (e) => { draft.projectId = e.target.value || null; } }
        )),
        field('Woran arbeitest du?', UI.input({
          placeholder: 'kurze Beschreibung',
          onInput: (e) => { draft.description = e.target.value; },
          onKeyDown: (e) => { if (e.key === 'Enter') start(draft); }
        })),
        h('button', { class: 'btn primary clock-button', onClick: () => start(draft) }, 'Starten')
      ]));
    }

    const project = app.data.projects.find((p) => p.id === laufend.projectId);
    const display = h('div', { class: 'clock-time' }, UI.fmt ? '' : '');

    const tick = () => {
      const minutes = Math.max(0, Math.floor((Date.now() - new Date(laufend.startedAt).getTime()) / 60000));
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(laufend.startedAt).getTime()) / 1000) % 60);
      display.textContent = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    };
    tick();
    ticker = setInterval(tick, 1000);

    return panel('Läuft', h('div', { class: 'clock-running' }, [
      h('div', { class: 'clock-dot' }),
      display,
      h('div', { class: 'clock-what' }, [
        h('div', { class: 'strong' }, laufend.description || 'ohne Beschreibung'),
        h('div', { class: 'small muted' }, [
          project ? project.name : 'ohne Projekt',
          laufend.rateCents ? ` · ${fmt.euro(laufend.rateCents)} je Stunde` : ''
        ].join(''))
      ]),
      h('button', { class: 'btn primary', onClick: stop }, 'Anhalten')
    ]), {
      note: `gerundet wird beim Anhalten ${roundingLabel()}`
    });
  }

  function roundingLabel() {
    const minutes = app.settings.time.roundToMinutes;
    const found = (state.data.rounding || []).find((item) => item.value === minutes);
    return found ? found.label : `auf ${minutes} Minuten`;
  }

  async function start(draft) {
    if (!UI.unwrap(await window.kontor.times.start(draft), 'Starten')) return;
    await load();
  }

  async function stop() {
    const saved = UI.unwrap(await window.kontor.times.stop(state.data.running.id), 'Anhalten');
    if (!saved) return;
    UI.toast(`${UI.fmt.date(saved.date)}: ${hours(saved.minutes)} erfasst.`, 'success');
    await app.refresh();
    await load();
  }

  function hours(minutes) {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} Stunden`;
  }

  /* --------------------------------------------------------- Zahlen */

  function summaryRow() {
    const s = state.data.summary;

    return h('div', { class: 'grid grid-4', style: { marginBottom: '18px' } }, [
      UI.stat('Erfasst', hours(s.minutes), { hint: `${s.count} ${s.count === 1 ? 'Eintrag' : 'Einträge'} in ${app.year}` }),
      UI.stat('Abrechenbar', hours(s.billableMinutes), { hint: 'ohne interne Zeiten' }),
      UI.stat('Noch offen', hours(s.openMinutes), {
        tone: s.openMinutes ? 'accent' : '',
        hint: 'geleistet, nicht in Rechnung'
      }),
      UI.stat('Offener Betrag', fmt.euro(s.openAmount), {
        tone: s.openAmount ? 'good' : '',
        hint: 'netto, zu den erfassten Sätzen'
      })
    ]);
  }

  function projectPanel() {
    const rows = state.data.projects.map((group) => h('tr', [
      h('td', [
        h('div', { class: 'strong' }, group.name),
        h('div', { class: 'small faint' }, app.customerName(group.customerId) || 'ohne Kunde')
      ]),
      h('td', { class: 'num' }, hours(group.minutes)),
      h('td', { class: 'num' }, group.openMinutes ? hours(group.openMinutes) : '–'),
      h('td', { class: 'num strong' }, group.openAmount ? fmt.euro(group.openAmount) : '–'),
      h('td', group.openMinutes ? h('button', {
        class: 'btn small',
        onClick: () => billDialog(group)
      }, 'Abrechnen') : null)
    ]));

    return panel('Nach Projekt', table([
      { label: 'Projekt' },
      { label: 'Erfasst', width: '120px', num: true },
      { label: 'Offen', width: '120px', num: true },
      { label: 'Betrag', width: '130px', num: true },
      { label: '', width: '120px' }
    ], rows));
  }

  /* --------------------------------------------------------- Liste */

  function listPanel() {
    const all = [...(app.data.times || [])]
      .filter((entry) => !entry.startedAt && String(entry.date).slice(0, 4) === String(app.year))
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));

    const list = state.filter === 'open'
      ? all.filter((entry) => entry.billable && !entry.invoiceId)
      : all;

    const filters = h('div', { class: 'filters' }, [
      UI.segmented([
        { value: 'open', label: 'Offen' },
        { value: 'all', label: `Alle ${all.length}` }
      ], state.filter, (value) => { state.filter = value; render(); })
    ]);

    if (!list.length) {
      return h('div', [filters, panel(null, empty(
        state.filter === 'open' ? 'Nichts offen.' : 'Noch keine Zeiten erfasst.',
        state.filter === 'open' ? 'Alles Erfasste ist abgerechnet.' : 'Starte die Uhr oder trage eine Zeit nach.'
      ))]);
    }

    const rows = list.map((entry) => {
      const project = app.data.projects.find((p) => p.id === entry.projectId);
      const invoice = entry.invoiceId ? app.data.invoices.find((i) => i.id === entry.invoiceId) : null;

      return h('tr', [
        h('td', { class: 'nowrap' }, fmt.date(entry.date)),
        h('td', [
          h('div', entry.description || 'ohne Beschreibung'),
          h('div', { class: 'small faint' }, project ? project.name : 'ohne Projekt')
        ]),
        h('td', { class: 'num nowrap' }, hours(entry.minutes)),
        h('td', { class: 'num' }, entry.rateCents ? fmt.euro(entry.rateCents) : '–'),
        h('td', { class: 'num strong' }, entry.billable ? fmt.euro(Math.round((entry.minutes / 60) * entry.rateCents)) : '–'),
        h('td', invoice
          ? h('span', { class: 'tag paid', title: invoice.number || 'Entwurf' }, invoice.number || 'im Entwurf')
          : (entry.billable ? h('span', { class: 'tag open' }, 'offen') : h('span', { class: 'tag draft' }, 'intern'))),
        h('td', { class: 'nowrap' }, [
          h('button', { class: 'btn small ghost', onClick: () => openForm(entry) }, 'Ändern'),
          !entry.invoiceId ? h('button', {
            class: 'btn small ghost danger',
            style: { marginLeft: '6px' },
            onClick: () => remove(entry)
          }, 'Löschen') : null
        ])
      ]);
    });

    return h('div', [filters, panel(null, table([
      { label: 'Datum', width: '110px' },
      { label: 'Tätigkeit' },
      { label: 'Dauer', width: '100px', num: true },
      { label: 'Satz', width: '100px', num: true },
      { label: 'Betrag', width: '110px', num: true },
      { label: 'Stand', width: '110px' },
      { label: '', width: '150px' }
    ], rows))]);
  }

  async function remove(entry) {
    const ok = await UI.confirm(`Den Eintrag vom ${fmt.date(entry.date)} löschen?`, {
      title: 'Zeit löschen', confirmLabel: 'Löschen', danger: true
    });
    if (!ok) return;
    if (!UI.unwrap(await window.kontor.times.remove(entry.id), 'Löschen')) return;
    await app.refresh();
    await load();
  }

  /* --------------------------------------------------------- Formular */

  function openForm(initial) {
    const projects = app.data.projects;
    const draft = {
      id: initial.id || null,
      date: initial.date || app.boot.today,
      projectId: initial.projectId || (projects[0] ? projects[0].id : null),
      description: initial.description || '',
      minutes: initial.minutes || 0,
      rateCents: initial.rateCents !== undefined ? initial.rateCents : null,
      billable: initial.billable !== false,
      note: initial.note || ''
    };

    const body = h('div', [
      h('div', { class: 'grid grid-2' }, [
        field('Datum', UI.dateInput({
          value: draft.date,
          onChange: (e) => { draft.date = e.target.value; }
        })),
        field('Dauer', UI.input({
          value: draft.minutes ? `${Math.floor(draft.minutes / 60)}:${String(draft.minutes % 60).padStart(2, '0')}` : '',
          placeholder: '1:30 oder 90',
          onInput: (e) => { draft.minutes = parseDuration(e.target.value); }
        }), 'Stunden:Minuten oder einfach Minuten')
      ]),
      field('Tätigkeit', UI.input({
        value: draft.description,
        onInput: (e) => { draft.description = e.target.value; }
      })),
      h('div', { class: 'grid grid-2' }, [
        field('Projekt', select(
          [{ value: '', label: 'ohne Projekt' }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
          draft.projectId || '',
          { onChange: (e) => { draft.projectId = e.target.value || null; draft.rateCents = null; } }
        ), 'Der Stundensatz kommt vom Projekt, sonst aus den Einstellungen'),
        field('Stundensatz', UI.amountInput({
          value: draft.rateCents ? UI.amountValue(draft.rateCents) : '',
          placeholder: 'wie im Projekt',
          onInput: (e) => { draft.rateCents = UI.parseAmount(e.target.value); }
        }))
      ]),
      h('div', { class: 'charge-options' }, [
        checkbox('Abrechenbar', draft.billable, (value) => { draft.billable = value; })
      ])
    ]);

    UI.modal({
      title: draft.id ? 'Zeit ändern' : 'Zeit nachtragen',
      body,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (!UI.unwrap(await window.kontor.times.save(draft), 'Speichern')) return;
            close();
            await app.refresh();
            await load();
          }
        }, 'Speichern')
      ]
    });
  }

  /** "1:30" oder "90" oder "1,5" zu Minuten. */
  function parseDuration(value) {
    const text = String(value || '').trim();
    if (!text) return 0;

    if (text.includes(':')) {
      const [h1, m1] = text.split(':');
      return (Number(h1) || 0) * 60 + (Number(m1) || 0);
    }
    // Eine Kommazahl meint Stunden, eine ganze Zahl Minuten. Das entspricht
    // dem, was man beim Tippen im Kopf hat: "1,5" ist anderthalb Stunden,
    // "90" sind neunzig Minuten.
    if (/[.,]/.test(text)) return Math.round(Number(text.replace(',', '.')) * 60);
    return Math.round(Number(text) || 0);
  }

  /* --------------------------------------------------------- Abrechnen */

  function billDialog(group) {
    let mode = 'summary';

    const body = h('div', [
      note([
        `${hours(group.openMinutes)} offen, ${fmt.euro(group.openAmount)} netto.`,
        'Es entsteht ein Rechnungsentwurf. Die Zeiten gelten ab sofort als zugeordnet und tauchen nicht in einem zweiten Entwurf auf. Löschst du den Entwurf, werden sie wieder offen.'
      ]),
      field('Wie soll es auf der Rechnung stehen?', UI.segmented([
        { value: 'summary', label: 'Zusammengefasst' },
        { value: 'daily', label: 'Je Tag' },
        { value: 'single', label: 'Jeder Eintrag' }
      ], mode, (value) => { mode = value; }))
    ]);

    UI.modal({
      title: `Abrechnen: ${group.name}`,
      body,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const result = UI.unwrap(await window.kontor.times.toInvoice({
              projectId: group.projectId, mode, customerId: group.customerId
            }), 'Abrechnen');
            if (!result) return;

            close();
            UI.toast(`Entwurf mit ${result.items} ${result.items === 1 ? 'Position' : 'Positionen'} angelegt.`, 'success');
            await app.refresh();
            app.navigate('invoices');
          }
        }, 'Rechnungsentwurf anlegen')
      ]
    });
  }
};
