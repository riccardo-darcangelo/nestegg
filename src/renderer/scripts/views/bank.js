'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Kontoauszug.
 *
 * Die Datei wird gelesen, jede Zeile bekommt einen Vorschlag, und übernommen
 * wird erst auf Knopfdruck. Dieselbe Haltung wie bei den wiederkehrenden
 * Vorlagen: die App schlägt vor, gebucht wird bestätigt.
 */
window.Views.bank = function bankView(app) {
  const { h, fmt, panel, table, empty, note, field, select, checkbox } = UI;

  const state = app.state.bank || (app.state.bank = { statement: null, filter: 'all' });
  const root = h('div');

  render();
  return root;

  /* --------------------------------------------------------- Rahmen */

  function render() {
    UI.clear(root);

    root.appendChild(app.pageHead(
      'Kontoauszug',
      'CSV aus dem Onlinebanking einlesen. Die App erkennt die Spalten selbst, ordnet Zahlungen den offenen Rechnungen zu und schlägt für alles andere eine Kategorie vor. Gebucht wird erst, was du bestätigst.',
      [
        state.statement
          ? h('button', { class: 'btn ghost', onClick: () => { state.statement = null; render(); } }, 'Verwerfen')
          : null,
        h('button', { class: 'btn primary', onClick: choose }, state.statement ? 'Andere Datei' : 'Datei wählen')
      ].filter(Boolean)
    ));

    if (!state.statement) {
      root.appendChild(startPanel());
      root.appendChild(rulesPanel());
      root.appendChild(historyPanel());
      return;
    }

    renderStatement();
  }

  async function choose() {
    const result = UI.unwrap(await window.kontor.bank.choose(), 'Kontoauszug');
    if (!result) return;

    state.statement = result;
    render();

    if (!result.rows.length) {
      UI.toast('In der Datei sind keine Umsätze zu finden.', 'error');
    }
  }

  /* --------------------------------------------------------- Startseite */

  function startPanel() {
    return panel(null, empty(
      'Kein Auszug geladen.',
      'Lade im Onlinebanking den Umsatzexport als CSV herunter und wähle ihn hier aus.',
      h('button', { class: 'btn primary', onClick: choose }, 'Datei wählen')
    ));
  }

  function rulesPanel() {
    const rules = app.settings.bankRules || [];
    const categories = [...app.boot.categories.income, ...app.boot.categories.expense];
    const labelOf = (id) => (categories.find((c) => c.id === id) || {}).label || id;

    const body = rules.length
      ? table([
          { label: 'Erkennungstext' },
          { label: 'Wird zu', width: '220px' },
          { label: 'Art', width: '110px' },
          { label: '', width: '60px' }
        ], rules.map((rule) => h('tr', [
          h('td', h('code', rule.match)),
          h('td', labelOf(rule.categoryId)),
          h('td', h('span', { class: `tag ${rule.type === 'income' ? 'paid' : ''}`.trim() },
            rule.type === 'income' ? 'Einnahme' : 'Ausgabe')),
          h('td', h('button', {
            class: 'btn small ghost danger',
            onClick: () => removeRule(rule.id)
          }, 'Löschen'))
        ])))
      : empty(
          'Noch keine Regeln.',
          'Regeln entstehen beim Übernehmen: setze dort das Häkchen "Zuordnung merken". Unabhängig davon lernt die App aus jeder Buchung, die schon dieselbe Gegenpartei trägt.'
        );

    return panel('Zuordnungsregeln', body, {
      note: rules.length ? `${rules.length} ${rules.length === 1 ? 'Regel' : 'Regeln'}` : null
    });
  }

  async function removeRule(id) {
    const rest = (app.settings.bankRules || []).filter((rule) => rule.id !== id);
    if (!UI.unwrap(await window.kontor.bank.saveRules(rest), 'Regeln')) return;
    await app.refresh();
  }

  function historyPanel() {
    const list = [...(app.data.imports || [])].reverse().slice(0, 8);
    if (!list.length) return h('div');

    return panel('Zuletzt eingelesen', table([
      { label: 'Datei' },
      { label: 'Zeitraum', width: '190px' },
      { label: 'Zeilen', width: '80px', num: true },
      { label: 'Gebucht', width: '110px', num: true },
      { label: 'Am', width: '150px' }
    ], list.map((entry) => h('tr', [
      h('td', entry.fileName || 'ohne Namen'),
      h('td', { class: 'nowrap small muted' }, entry.from ? `${fmt.date(entry.from)} bis ${fmt.date(entry.to)}` : '–'),
      h('td', { class: 'num' }, String(entry.rowCount || 0)),
      h('td', { class: 'num' }, String((entry.entries || 0) + (entry.payments || 0))),
      h('td', { class: 'nowrap small muted' }, fmt.date(String(entry.importedAt).slice(0, 10)))
    ]))), { note: 'Nachweis, welche Datei wann eingelesen wurde' });
  }

  /* --------------------------------------------------------- Auszug */

  function renderStatement() {
    const s = state.statement;
    const summary = recount();

    root.appendChild(h('div', { class: 'grid grid-4', style: { marginBottom: '18px' } }, [
      UI.stat('Zeilen', String(summary.total), { hint: s.fileName }),
      UI.stat('Zahlungen erkannt', String(summary.payments), {
        tone: summary.payments ? 'accent' : '',
        hint: 'werden auf die Rechnung gebucht'
      }),
      summary.returns
        ? UI.stat('Rücklastschriften', String(summary.returns), {
            tone: 'bad',
            hint: 'Forderungen werden wieder offen'
          })
        : UI.stat('Neue Buchungen', String(summary.entries), { hint: 'mit Vorschlag für die Kategorie' }),
      UI.stat('Schon vorhanden', String(summary.duplicates), {
        hint: summary.duplicates ? 'wird übersprungen' : 'nichts doppelt'
      })
    ]));

    if (s.warnings.length) root.appendChild(note(s.warnings, 'warn'));

    root.appendChild(note([
      `Erkannt: ${describeColumns(s.columns)}. Zeichensatz ${s.encoding}, Trennzeichen "${s.delimiter === '\t' ? 'Tabulator' : s.delimiter}".`,
      'Der Kontoauszug belegt die Zahlung, nicht die Leistung. Für den Vorsteuerabzug brauchst du weiterhin die Rechnung des Lieferanten.'
    ]));

    root.appendChild(filterBar(summary));

    const rows = visibleRows();
    if (!rows.length) {
      root.appendChild(panel(null, empty('Keine Zeile in dieser Auswahl.', 'Der Filter blendet gerade alles aus.')));
    } else {
      root.appendChild(panel(null, h('div', { class: 'bank-list' }, rows.map(rowNode))));
    }

    root.appendChild(commitBar(summary));
  }

  /** Zählt neu, weil sich Auswahl und Absicht laufend ändern. */
  function recount() {
    const rows = state.statement.rows;
    const selected = rows.filter((r) => r.selected && !r.duplicate);

    return {
      total: rows.length,
      duplicates: rows.filter((r) => r.duplicate).length,
      payments: rows.filter((r) => !r.duplicate && r.action === 'payment').length,
      entries: rows.filter((r) => !r.duplicate && r.action === 'entry').length,
      returns: rows.filter((r) => !r.duplicate && r.action === 'return').length,
      selected: selected.length,
      income: selected.filter((r) => r.amount > 0).reduce((sum, r) => sum + r.amount, 0),
      expense: selected.filter((r) => r.amount < 0).reduce((sum, r) => sum + r.amount, 0)
    };
  }

  function describeColumns(columns) {
    const names = { date: 'Datum', amount: 'Betrag', debit: 'Soll', credit: 'Haben', purpose: 'Verwendungszweck', counterparty: 'Gegenpartei', currency: 'Währung' };
    const found = Object.keys(names).filter((key) => columns[key] !== undefined).map((key) => names[key]);
    return found.length ? found.join(', ') : 'nichts Brauchbares';
  }

  function filterBar(summary) {
    return h('div', { class: 'filters' }, [
      UI.segmented([
        { value: 'all', label: `Alle ${summary.total}` },
        { value: 'payment', label: `Zahlungen ${summary.payments}` },
        { value: 'entry', label: `Buchungen ${summary.entries}` },
        ...(summary.returns ? [{ value: 'return', label: `Rücklastschriften ${summary.returns}`, tone: 'bad' }] : []),
        { value: 'duplicate', label: `Vorhanden ${summary.duplicates}` }
      ], state.filter, (value) => { state.filter = value; render(); }),
      h('div', { style: { flex: '1' } }),
      h('button', { class: 'btn small ghost', onClick: () => setAll(true) }, 'Alle auswählen'),
      h('button', { class: 'btn small ghost', onClick: () => setAll(false) }, 'Keine')
    ]);
  }

  function setAll(value) {
    for (const row of visibleRows()) if (!row.duplicate) row.selected = value;
    render();
  }

  function visibleRows() {
    const rows = state.statement.rows;
    if (state.filter === 'all') return rows;
    if (state.filter === 'duplicate') return rows.filter((r) => r.duplicate);
    return rows.filter((r) => !r.duplicate && r.action === state.filter);
  }

  /* --------------------------------------------------------- Zeile */

  function rowNode(row) {
    const income = row.amount > 0;

    return h('div', { class: `bank-row ${row.duplicate ? 'is-duplicate' : ''} ${row.selected && !row.duplicate ? 'is-selected' : ''}`.trim() }, [
      h('div', { class: 'bank-check' }, row.duplicate
        ? h('span', { class: 'tag', title: 'Diese Zeile ist bereits gebucht' }, 'gebucht')
        : checkbox('', row.selected, (value) => { row.selected = value; render(); })),

      h('div', { class: 'bank-date' }, [
        h('div', { class: 'day' }, row.date.slice(8, 10)),
        h('div', { class: 'month' }, monthShort(row.date))
      ]),

      h('div', { class: 'bank-body' }, [
        h('div', { class: 'bank-party' }, row.counterparty || row.bookingText || 'ohne Angabe'),
        h('div', { class: 'bank-purpose', title: row.purpose }, row.purpose || '–'),
        row.duplicate ? null : h('div', { class: 'bank-suggestion' }, suggestionNode(row))
      ]),

      h('div', { class: 'bank-amount' }, [
        h('div', { class: `amount ${income ? 'good' : 'bad'}` }, fmt.signed(row.amount)),
        row.currency !== 'EUR' ? h('div', { class: 'small muted' }, row.currency) : null
      ]),

      h('div', { class: 'bank-actions' }, row.duplicate ? null : h('button', {
        class: 'btn small ghost',
        onClick: () => openDetail(row)
      }, 'Ändern'))
    ]);
  }

  /**
   * Der Vorschlag in der Zeile.
   *
   * Bei einer erkannten Zahlung steht die Rechnung da, sonst die Kategorie als
   * Auswahlfeld. Die Kategorie ist der Fall, den man am häufigsten ändert, und
   * sie soll deshalb ohne Umweg über einen Dialog erreichbar sein.
   */
  function suggestionNode(row) {
    if (row.action === 'return') return returnNode(row);

    if (row.action === 'payment' && row.match) {
      return h('div', { class: 'bank-match' }, [
        h('span', { class: 'tag paid' }, row.match.invoice.number),
        h('span', { class: 'small muted' }, row.match.reason),
        !row.match.exact ? h('span', { class: 'tag overdue' }, 'Betrag weicht ab') : null,
        h('button', {
          class: 'link-button small',
          onClick: () => { row.action = 'entry'; row.draft.invoiceId = null; render(); }
        }, 'doch als Buchung')
      ]);
    }

    const categories = row.draft.type === 'income' ? app.boot.categories.income : app.boot.categories.expense;

    return h('div', { class: 'bank-pick' }, [
      select(
        categories.map((c) => ({ value: c.id, label: c.label })),
        row.draft.categoryId,
        {
          class: 'small',
          onChange: (e) => {
            row.draft.categoryId = e.target.value;
            row.draft.vatRate = undefined;
            row.touched = true;
            render();
          }
        }
      ),
      h('span', { class: `small ${row.touched ? 'muted' : 'hint-source'}` },
        row.touched ? 'von dir gewählt' : (row.suggestion ? row.suggestion.reason : '')),
      row.match ? h('button', {
        class: 'link-button small',
        onClick: () => { row.action = 'payment'; row.draft.invoiceId = row.match.invoiceId; render(); }
      }, `als Zahlung auf ${row.match.invoice.number}`) : null
    ]);
  }

  /**
   * Eine zurückgekommene Lastschrift.
   *
   * Sie ist keine Ausgabe, sondern das Gegenteil einer Zahlung: die Forderung
   * lebt wieder auf. Deshalb steht hier nicht die Kategorie, sondern die
   * Forderung, der Grund und was daraus folgt.
   */
  function returnNode(row) {
    const folge = row.consequence || {};

    return h('div', { class: 'bank-return' }, [
      h('div', { class: 'bank-match' }, [
        h('span', { class: 'tag overdue' }, 'Rücklastschrift'),
        row.returned.code
          ? h('span', { class: 'tag' , title: folge.label || '' }, row.returned.code)
          : h('span', { class: 'small muted' }, 'ohne Grundangabe'),
        row.returnMatch
          ? h('span', { class: 'small' }, [
              h('span', { class: 'strong' }, row.returnMatch.description),
              h('span', { class: 'muted' }, row.returnMatch.sure ? ' über die Referenz' : ' über die Mandatsreferenz, bitte prüfen')
            ])
          : h('span', { class: 'small bad' }, 'keine Forderung zugeordnet')
      ]),
      h('div', { class: 'small muted' }, folge.label
        ? `${folge.label}. ${folge.retry ? 'Ein erneuter Einzug ist möglich.' : 'Nicht erneut einziehen, ohne den Fall zu klären.'}`
        : 'Der Grund steht nicht im Auszug.'),
      h('button', {
        class: 'link-button small',
        onClick: () => openReturn(row)
      }, row.draft.feeAmount ? `Gebühr ${fmt.euro(row.draft.feeAmount)} erfasst` : 'Gebühr erfassen')
    ]);
  }

  /** Der Dialog zur Rücklastschrift: Gebühr, Weiterberechnung, Folgen. */
  function openReturn(row) {
    const draft = {
      feeAmount: row.draft.feeAmount || 0,
      chargeMember: Boolean(row.draft.chargeMember),
      feeCategoryId: row.draft.feeCategoryId || row.draft.categoryId,
      claimCategoryId: row.draft.claimCategoryId || null
    };
    const folge = row.consequence || {};
    const body = h('div');

    const build = () => {
      UI.clear(body);

      body.appendChild(note([
        row.returnMatch
          ? `Die Forderung "${row.returnMatch.description}" wird wieder offen. Sie wird nicht storniert: sie besteht weiter, nur das Geld ist zurück.`
          : 'Zu dieser Rückbuchung ist keine Forderung zugeordnet. Gebucht wird dann nur die Gebühr.',
        ...(folge.notes || [])
      ], folge.retry ? '' : 'warn'));

      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Gebühr der Bank', UI.amountInput({
          value: draft.feeAmount ? UI.amountValue(draft.feeAmount) : '',
          onInput: (e) => { draft.feeAmount = UI.parseAmount(e.target.value); }
        }), 'Steht meist als eigene Zeile im Auszug oder ist im Betrag enthalten'),
        field('Gebühr buchen auf', select(
          app.boot.categories.expense.map((c) => ({ value: c.id, label: c.label })),
          draft.feeCategoryId,
          { onChange: (e) => { draft.feeCategoryId = e.target.value; } }
        ))
      ]));

      body.appendChild(h('div', { class: 'charge-options' }, [
        checkbox('Gebühr dem Mitglied weiterberechnen', draft.chargeMember,
          (value) => { draft.chargeMember = value; build(); })
      ]));

      if (draft.chargeMember) {
        body.appendChild(field('Forderung buchen auf', select(
          app.boot.categories.income.map((c) => ({ value: c.id, label: c.label })),
          draft.claimCategoryId || app.boot.categories.income[0].id,
          { onChange: (e) => { draft.claimCategoryId = e.target.value; } }
        ), 'Echter Schadensersatz, deshalb ohne Umsatzsteuer'));

        const warnungen = [];
        if (folge.chargeable === 'no') {
          warnungen.push(`Bei ${folge.code} hat das Mitglied die Rückgabe nicht zu vertreten. Eine Weiterberechnung ist dann nicht begründet.`);
        } else if (folge.chargeable === 'unknown') {
          warnungen.push('Der Grund lässt nicht erkennen, ob das Mitglied die Rückgabe zu vertreten hat. Weiterberechnet werden darf nur, wenn es das tut.');
        }
        warnungen.push('Weitergegeben werden darf nur die tatsächliche Gebühr der Bank. Eigener Bearbeitungsaufwand gehört nicht dazu, eine Pauschale mit Bearbeitungsanteil ist unwirksam (BGH, Xa ZR 40/08).');

        body.appendChild(note(warnungen, 'warn'));
      }
    };

    build();

    UI.modal({
      title: 'Rücklastschrift',
      body,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: () => {
            Object.assign(row.draft, draft);
            row.touched = true;
            close();
            render();
          }
        }, 'Übernehmen')
      ]
    });
  }

  function monthShort(date) {
    const names = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    return names[Number(date.slice(5, 7)) - 1];
  }

  /* --------------------------------------------------------- Dialog */

  function openDetail(row) {
    const draft = { ...row.draft };
    const body = h('div');

    const build = () => {
      UI.clear(body);
      const categories = draft.type === 'income' ? app.boot.categories.income : app.boot.categories.expense;
      if (!categories.some((c) => c.id === draft.categoryId)) {
        draft.categoryId = categories[0].id;
      }

      body.appendChild(note([
        `${fmt.date(row.date)}, ${fmt.signed(row.amount)}`,
        row.counterparty ? `Gegenpartei: ${row.counterparty}` : null,
        row.purpose ? `Verwendungszweck: ${row.purpose}` : null
      ].filter(Boolean)));

      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Art', UI.segmented([
          { value: 'expense', label: 'Ausgabe' },
          { value: 'income', label: 'Einnahme' }
        ], draft.type, (value) => { draft.type = value; build(); }),
        'Das Vorzeichen der Bankzeile bleibt, wie es ist'),
        field('Kategorie', select(
          categories.map((c) => ({ value: c.id, label: c.label })),
          draft.categoryId,
          { onChange: (e) => { draft.categoryId = e.target.value; } }
        ), categoryHint(draft.categoryId, categories))
      ]));

      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Beschreibung', UI.input({
          value: draft.description,
          onInput: (e) => { draft.description = e.target.value; }
        })),
        field('Gegenpartei', UI.input({
          value: draft.counterparty,
          onInput: (e) => { draft.counterparty = e.target.value; }
        }))
      ]));

      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Bereich', select(
          [{ value: '', label: 'ohne' }, ...app.boot.segments.map((s) => ({ value: s.id, label: s.label }))],
          draft.segmentId || '',
          { onChange: (e) => { draft.segmentId = e.target.value || null; } }
        )),
        field('Projekt', select(
          [{ value: '', label: 'ohne' }, ...app.data.projects.map((p) => ({ value: p.id, label: p.name }))],
          draft.projectId || '',
          { onChange: (e) => { draft.projectId = e.target.value || null; } }
        ))
      ]));

      body.appendChild(h('div', { class: 'charge-options' }, [
        checkbox(
          `Zuordnung merken: "${row.counterparty || row.purpose.slice(0, 24)}" künftig so buchen`,
          draft.rememberRule,
          (value) => { draft.rememberRule = value; }
        )
      ]));
    };

    build();

    UI.modal({
      title: 'Zeile anpassen',
      body,
      wide: true,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: () => {
            row.draft = { ...draft };
            row.action = draft.invoiceId ? 'payment' : 'entry';
            row.touched = true;
            close();
            render();
          }
        }, 'Übernehmen')
      ]
    });
  }

  function categoryHint(categoryId, categories) {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return null;
    const parts = [];
    if (category.defaultVatRate !== undefined) parts.push(`${category.defaultVatRate} Prozent Umsatzsteuer voreingestellt`);
    if (category.deductiblePercent && category.deductiblePercent < 100) {
      parts.push(`nur ${category.deductiblePercent} Prozent abziehbar`);
    }
    return parts.join(', ') || null;
  }

  /* --------------------------------------------------------- Übernehmen */

  function commitBar(summary) {
    const disabled = summary.selected === 0;

    return h('div', { class: 'bank-commit' }, [
      h('div', [
        h('div', { class: 'strong' }, `${summary.selected} ${summary.selected === 1 ? 'Zeile' : 'Zeilen'} ausgewählt`),
        h('div', { class: 'small muted' }, [
          summary.income ? `Eingang ${fmt.euro(summary.income)}` : null,
          summary.expense ? `Ausgang ${fmt.euro(Math.abs(summary.expense))}` : null
        ].filter(Boolean).join(', ') || 'nichts ausgewählt')
      ]),
      h('button', {
        class: 'btn primary',
        disabled,
        onClick: commit
      }, 'Ausgewählte übernehmen')
    ]);
  }

  async function commit() {
    const rows = state.statement.rows.filter((row) => row.selected && !row.duplicate);
    if (!rows.length) return;

    const ok = await UI.confirm(
      `${rows.length} ${rows.length === 1 ? 'Zeile wird' : 'Zeilen werden'} gebucht. Zahlungen auf Rechnungen gelten damit als eingegangen.`,
      { title: 'Übernehmen', confirmLabel: 'Buchen' }
    );
    if (!ok) return;

    const result = UI.unwrap(
      await window.kontor.bank.commit({ fileName: state.statement.fileName, rows }),
      'Übernehmen'
    );
    if (!result) return;

    const parts = [];
    if (result.entries) parts.push(`${result.entries} ${result.entries === 1 ? 'Buchung' : 'Buchungen'}`);
    if (result.payments) parts.push(`${result.payments} ${result.payments === 1 ? 'Zahlung' : 'Zahlungen'}`);
    if (result.rules) parts.push(`${result.rules} ${result.rules === 1 ? 'Regel' : 'Regeln'}`);

    UI.toast(parts.length ? `${parts.join(', ')} übernommen.` : 'Nichts zu übernehmen.', 'success');
    if (result.problems.length) UI.toast(result.problems.join(' '), 'error');

    state.statement = null;
    await app.refresh();
  }
};
