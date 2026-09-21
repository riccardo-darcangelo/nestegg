'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/** Anlageverzeichnis mit linearer Abschreibung. */
window.Views.assets = function assetsView(app) {
  const { h, fmt, panel, table, empty, field, select } = UI;

  const root = h('div');
  render();
  return root;

  function render() {
    UI.clear(root);
    const list = [...app.data.assets].sort((a, b) => String(b.purchaseDate).localeCompare(String(a.purchaseDate)));

    root.appendChild(app.pageHead(
      'Anlageverzeichnis',
      'Wirtschaftsgüter über 800 Euro netto werden nicht sofort abgezogen, sondern über ihre Nutzungsdauer verteilt. Im Anschaffungsjahr zählt nur der Teil ab dem Anschaffungsmonat.',
      [h('button', { class: 'btn primary', onClick: () => openForm({}) }, 'Anlagegut erfassen')]
    ));

    if (!list.length) {
      root.appendChild(panel(null, empty(
        'Noch keine Anlagegüter.',
        'Beim Erfassen einer Ausgabe kannst du sie direkt als Anlagegut führen. Dann landet sie automatisch hier.'
      )));
      return;
    }

    const rows = list.map((asset) => UI.clickableRow({ onClick: () => openForm(asset) }, [
      h('td', [
        h('div', { class: 'strong' }, asset.label),
        asset.note ? h('div', { class: 'small faint' }, asset.note) : null
      ]),
      h('td', { class: 'nowrap' }, fmt.date(asset.purchaseDate)),
      h('td', { class: 'num' }, fmt.euro(asset.netCents)),
      h('td', { class: 'num small' }, `${asset.usefulLifeYears} Jahre`),
      h('td', { class: 'num strong' }, ''),
      h('td', { class: 'num' }, ''),
      h('td', { onClick: (e) => e.stopPropagation() }, h('button', {
        class: 'btn small ghost',
        onClick: () => showSchedule(asset)
      }, 'Plan'))
    ]));

    const wrapper = panel(null, table([
      { label: 'Bezeichnung' },
      { label: 'Anschaffung', width: '110px' },
      { label: 'Kosten netto', width: '130px', num: true },
      { label: 'Nutzungsdauer', width: '120px', num: true },
      { label: `AfA ${app.year}`, width: '130px', num: true },
      { label: `Restwert 31.12.`, width: '130px', num: true },
      { label: '', width: '80px' }
    ], rows));
    root.appendChild(wrapper);

    fillDepreciation(list, wrapper);
  }

  /** AfA-Werte kommen aus dem Hauptprozess, damit nur dort gerechnet wird. */
  async function fillDepreciation(list, wrapper) {
    const bodyRows = wrapper.querySelectorAll('tbody tr');
    let afaTotal = 0;

    for (let i = 0; i < list.length; i += 1) {
      const schedule = UI.unwrap(await window.kontor.assets.schedule(list[i].id));
      if (!schedule) continue;
      const row = schedule.find((r) => r.year === app.year);
      const past = schedule.filter((r) => r.year <= app.year);
      const bookValue = past.length ? past[past.length - 1].bookValueEnd : list[i].netCents;
      const cells = bodyRows[i].children;
      cells[4].textContent = row ? fmt.euro(row.amount) : '–';
      cells[5].textContent = fmt.euro(bookValue);
      if (row) afaTotal += row.amount;
    }

    const tbody = wrapper.querySelector('tbody');
    tbody.appendChild(h('tr', { class: 'sum' }, [
      h('td', { colspan: 4 }, `Abschreibung ${app.year} insgesamt`),
      h('td', { class: 'num' }, fmt.euro(afaTotal)),
      h('td', ''), h('td', '')
    ]));
  }

  async function showSchedule(asset) {
    const schedule = UI.unwrap(await window.kontor.assets.schedule(asset.id), 'Abschreibungsplan');
    if (!schedule) return;

    UI.modal({
      title: `Abschreibungsplan: ${asset.label}`,
      body: h('div', [
        UI.note(`Anschaffungskosten ${fmt.euro(asset.netCents)} netto, lineare Abschreibung über ${asset.usefulLifeYears} Jahre ab ${fmt.date(asset.purchaseDate)}.`),
        table(
          [{ label: 'Jahr' }, { label: 'Abschreibung', num: true }, { label: 'Restbuchwert', num: true }],
          schedule.map((row) => h('tr', { class: row.year === app.year ? 'strong' : null }, [
            h('td', String(row.year)),
            h('td', { class: 'num' }, fmt.euro(row.amount)),
            h('td', { class: 'num' }, fmt.euro(row.bookValueEnd))
          ])),
          { flush: false }
        )
      ]),
      actions: (close) => [h('button', { class: 'btn', onClick: close }, 'Schließen')]
    });
  }

  function openForm(existing) {
    const draft = {
      id: existing.id || null,
      label: existing.label || '',
      purchaseDate: existing.purchaseDate || app.boot.today,
      netCents: existing.netCents || 0,
      usefulLifeYears: existing.usefulLifeYears || 3,
      note: existing.note || '',
      entryId: existing.entryId || null
    };

    const body = h('div', [
      field('Bezeichnung', UI.input({
        value: draft.label, placeholder: 'Notebook, Schreibtisch, Kamera',
        onInput: (e) => { draft.label = e.target.value; }
      })),
      h('div', { class: 'grid grid-3' }, [
        field('Anschaffungsdatum', UI.dateInput({
          value: draft.purchaseDate, onChange: (e) => { draft.purchaseDate = e.target.value; }
        })),
        field('Anschaffungskosten netto', UI.amountInput({
          value: UI.amountValue(draft.netCents),
          onInput: (e) => { draft.netCents = UI.parseAmount(e.target.value); }
        })),
        field('Nutzungsdauer', select(
          app.boot.usefulLives.map((u) => ({ value: u.years, label: `${u.years} Jahre – ${u.label}` })),
          draft.usefulLifeYears,
          { onChange: (e) => { draft.usefulLifeYears = Number(e.target.value); } }
        ), 'Nach der amtlichen AfA-Tabelle')
      ]),
      field('Notiz', h('textarea', {
        value: draft.note, onInput: (e) => { draft.note = e.target.value; }
      })),
      draft.entryId ? UI.note('Dieses Anlagegut hängt an einer Buchung. Die Anschaffung wirkt deshalb nicht noch einmal als Ausgabe.') : null
    ]);

    UI.modal({
      title: draft.id ? 'Anlagegut bearbeiten' : 'Anlagegut erfassen',
      body,
      actions: (close) => [
        draft.id
          ? h('button', {
              class: 'btn danger',
              onClick: async () => {
                const ok = await UI.confirm(`„${draft.label}“ aus dem Anlageverzeichnis entfernen?`, {
                  title: 'Anlagegut löschen', confirmLabel: 'Löschen', danger: true
                });
                if (!ok) return;
                if (UI.unwrap(await window.kontor.assets.remove(draft.id), 'Löschen')) { close(); app.refresh(); }
              }
            }, 'Löschen')
          : null,
        h('div', { style: { flex: '1' } }),
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (!UI.unwrap(await window.kontor.assets.save(draft), 'Speichern')) return;
            close();
            UI.toast('Anlagegut gespeichert.', 'success');
            app.refresh();
          }
        }, 'Speichern')
      ]
    });
  }
};
