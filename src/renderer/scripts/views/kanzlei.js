'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Übergabe nach außen: DATEV und GoBD.
 *
 * Beides gehört in die Einstellungen und nicht in eine eigene Ansicht: es sind
 * Vorgänge, die man wenige Male im Jahr braucht, dann aber vollständig.
 */
window.Kanzlei = (function kanzleiPanels() {
  const { h, fmt, panel, table, note, field, select } = UI;

  /* --------------------------------------------------------- DATEV */

  function datevPanel(app) {
    const host = h('div');
    render();
    return panel('Übergabe an die Kanzlei (DATEV)', host, {
      note: 'Buchungsstapel im EXTF-Format'
    });

    async function render() {
      UI.clear(host);
      const settings = app.settings.datev || {};

      const preview = UI.unwrap(await window.kontor.datev.preview({
        year: app.year, chart: settings.chart
      }), 'DATEV');
      if (!preview) return;

      const draft = {
        chart: settings.chart || 'skr03',
        consultantId: settings.consultantId || '',
        clientId: settings.clientId || '',
        accounts: {}
      };

      UI.clear(host);

      const isClub = preview.entity === 'club';
      host.appendChild(note([
        `Für ${app.year} stehen ${preview.count} bezahlte Buchungen bereit${preview.skipped ? `, ${preview.skipped} ohne Zahlungsdatum bleiben draußen` : ''}.`,
        isClub
          ? 'Vereine buchen nach SKR 42. Er hat zum 1. Januar 2025 den SKR 49 abgelöst, den DATEV seither weder unterstützt noch pflegt. Die Sphäre jeder Buchung geht als Kostenstelle mit: 1 ideell, 2 Vermögensverwaltung, 3 Zweckbetrieb, 4 wirtschaftlicher Geschäftsbetrieb, 9 Sammelposten für alles noch nicht Zugeordnete.'
          : 'Die Kontenzuordnung unten ist ein Vorschlag nach üblichem Gebrauch. Stimme sie mit deiner Kanzlei ab, bevor der erste Stapel dort ankommt: welche Konten bebucht werden, weiß nur die Kanzlei.',
        isClub
          ? 'Auch hier gilt: die Konten sind ein Vorschlag. Wo keiner steht, bleibt die Spalte leer, damit die Kanzlei die Lücke sieht statt eines falschen Kontos.'
          : null
      ].filter(Boolean), preview.unmapped.length ? 'warn' : ''));

      if (preview.unmapped.length) {
        host.appendChild(note([
          `Ohne eigenes Konto und daher im Sammelkonto: ${preview.unmapped.join(', ')}`
        ], 'warn'));
      }

      host.appendChild(h('div', { class: 'grid grid-3' }, [
        field('Kontenrahmen', select(
          preview.charts.map((chart) => ({ value: chart.id, label: chart.label })),
          draft.chart,
          { onChange: (e) => { draft.chart = e.target.value; saveAndRender(draft); } }
        ), (preview.charts.find((c) => c.id === draft.chart) || {}).hint),
        field('Beraternummer', UI.input({
          value: draft.consultantId, placeholder: 'von der Kanzlei',
          onInput: (e) => { draft.consultantId = e.target.value; }
        })),
        field('Mandantennummer', UI.input({
          value: draft.clientId, placeholder: 'von der Kanzlei',
          onInput: (e) => { draft.clientId = e.target.value; }
        }))
      ]));

      host.appendChild(h('details', [
        h('summary', { class: 'small muted', style: { cursor: 'pointer', margin: '6px 0 10px' } },
          `Kontenzuordnung ansehen und ändern (${preview.accounts.length} Kategorien)`),
        table([
          { label: 'Kategorie' },
          { label: 'Art', width: '100px' },
          { label: 'Konto', width: '130px' }
        ], preview.accounts.map((row) => h('tr', [
          h('td', row.label),
          h('td', h('span', { class: `tag ${row.kind === 'income' ? 'paid' : 'draft'}` },
            row.kind === 'income' ? 'Einnahme' : 'Ausgabe')),
          h('td', UI.input({
            value: row.account,
            class: 'num',
            'aria-label': `Konto für ${row.label}`,
            style: { width: '110px', padding: '4px 8px' },
            onInput: (e) => { draft.accounts[row.id] = e.target.value; }
          }))
        ])), { flush: false })
      ]));

      host.appendChild(h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
        h('button', { class: 'btn', onClick: () => saveAndRender(draft, true) }, 'Zuordnung speichern'),
        h('div', { style: { flex: '1' } }),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const result = UI.unwrap(await window.kontor.datev.export({
              year: app.year, chart: draft.chart
            }), 'DATEV-Export');
            if (result) UI.toast(`${result.count} Buchungen gespeichert: ${result.file}`, 'success');
          }
        }, `Buchungsstapel ${app.year}`)
      ]));
    }

    async function saveAndRender(draft, toast) {
      const result = UI.unwrap(await window.kontor.datev.saveAccounts(draft), 'Speichern');
      if (!result) return;
      if (toast) UI.toast('Kontenzuordnung gespeichert.', 'success');
      await app.refresh();
    }
  }

  /* --------------------------------------------------------- GoBD */

  function gobdPanel(app) {
    return panel('GoBD: Dokumentation und Datenzugriff', h('div', [
      note([
        'Die Verfahrensdokumentation beschreibt, wie Belege entstehen, erfasst und aufbewahrt werden. Sie ist dem Grunde nach Pflicht, auch bei einer EÜR. Die App schreibt sie aus dem tatsächlichen Stand dieser Installation; was sie nicht wissen kann, bleibt als markierte Lücke darin.',
        'Die Datenüberlassung nach §147 Abs. 6 AO erzeugt CSV-Dateien samt Beschreibungsdatei index.xml, wie es die Prüfsoftware der Finanzverwaltung erwartet.'
      ]),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
        h('button', {
          class: 'btn',
          onClick: async () => {
            const result = UI.unwrap(await window.kontor.gobd.documentation(), 'Verfahrensdokumentation');
            if (result) UI.toast(`Gespeichert: ${result.file}`, 'success');
          }
        }, 'Verfahrensdokumentation erzeugen'),
        h('button', {
          class: 'btn',
          onClick: async () => {
            const result = UI.unwrap(await window.kontor.gobd.dataExport({ year: app.year }), 'Datenüberlassung');
            if (result) {
              UI.toast(`${result.files.length} Dateien in ${result.dir}`, 'success');
            }
          }
        }, `Datenüberlassung ${app.year}`),
        h('button', {
          class: 'btn ghost',
          onClick: async () => {
            const result = UI.unwrap(await window.kontor.gobd.dataExport({}), 'Datenüberlassung');
            if (result) UI.toast(`${result.entries} Buchungen in ${result.dir}`, 'success');
          }
        }, 'Datenüberlassung gesamt')
      ]),
      h('p', { class: 'small muted', style: { marginTop: '12px', marginBottom: 0 } },
        'Die Dokumentation ist fortzuschreiben: ändert sich ein Ablauf, gehört die Änderung mit Datum hinein. Alte Fassungen sind so lange aufzubewahren wie die Unterlagen, für die sie galten.')
    ]));
  }

  return { datevPanel, gobdPanel };
})();
