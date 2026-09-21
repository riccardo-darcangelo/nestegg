'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Wiederkehrende Buchungen und Rechnungen.
 *
 * Eine Vorlage ist eine Wiederholungsregel plus der Entwurf dessen, was daraus
 * entstehen soll. Angelegt wird nichts im Hintergrund: die App sammelt, was
 * fällig ist, zeigt es und legt es erst nach Bestätigung an. Eine Buchhaltung,
 * die von selbst bucht, ist schwer zu prüfen.
 */
window.Views.recurring = function recurringView(app) {
  const { h, fmt, panel, table, empty, note, field, select, checkbox } = UI;

  const root = h('div');
  render();
  return root;

  function render() {
    UI.clear(root);

    root.appendChild(app.pageHead(
      'Wiederkehrendes',
      'Miete, Hosting, Betreuungspauschalen: einmal als Vorlage anlegen, danach nur noch bestätigen. Erzeugt wird erst auf Knopfdruck, nie im Hintergrund.',
      [
        h('button', { class: 'btn', onClick: () => openForm({ kind: 'invoice' }) }, 'Rechnungsvorlage'),
        h('button', { class: 'btn primary', onClick: () => openForm({ kind: 'entry' }) }, 'Buchungsvorlage')
      ]
    ));

    const duePanel = h('div');
    root.appendChild(duePanel);
    loadDue(duePanel);

    const list = [...app.data.recurrences].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.label.localeCompare(b.label, 'de');
    });

    if (!list.length) {
      root.appendChild(panel(null, empty(
        'Noch keine Vorlagen.',
        'Alles, was jeden Monat gleich aussieht, gehört hierher.',
        h('button', { class: 'btn primary', onClick: () => openForm({ kind: 'entry' }) }, 'Erste Vorlage anlegen')
      )));
      return;
    }

    root.appendChild(panel('Vorlagen', table([
      { label: 'Vorlage' },
      { label: 'Art', width: '110px' },
      { label: 'Rhythmus', width: '230px' },
      { label: 'Betrag', width: '130px', num: true },
      { label: 'Nächster Termin', width: '150px' },
      { label: '', width: '80px' }
    ], list.map(rowFor))));
  }

  /* --------------------------------------------------------- Anstehendes */

  async function loadDue(host) {
    const data = UI.unwrap(await window.kontor.recurring.due(), 'Fällige Vorlagen');
    if (!data || !data.count) return;

    UI.clear(host);
    // Wer eine Vorlage rückwirkend anlegt, hat sofort ein Dutzend Termine.
    // Die Liste zeigt deshalb nur die ersten und fasst den Rest zusammen.
    const VISIBLE = 4;

    const groups = data.groups.map((group) => {
      const rows = group.items.slice(0, VISIBLE).map((item) => h('tr', [
        h('td', { class: 'nowrap' }, fmt.date(item.date)),
        h('td', [
          h('span', { class: 'strong' }, item.summary.description),
          item.summary.counterparty
            ? h('div', { class: 'small faint' }, item.summary.counterparty)
            : null
        ]),
        h('td', { class: 'num' }, h('span', {
          class: item.summary.type === 'income' ? 'money income' : 'money expense'
        }, fmt.euro(item.summary.gross))),
        h('td', { class: 'small faint' }, group.kind === 'invoice'
          ? 'wird Entwurf'
          : item.summary.paid ? 'gilt als bezahlt' : 'bleibt offen')
      ]));

      const hidden = group.items.length - VISIBLE;
      if (hidden > 0) {
        const rest = group.items.slice(VISIBLE).reduce((sum, item) => sum + item.summary.gross, 0);
        rows.push(h('tr', [
          h('td', { class: 'small faint nowrap' }, `bis ${fmt.date(group.dates[group.dates.length - 1])}`),
          h('td', { class: 'small faint' }, `und ${hidden} weitere Termine`),
          h('td', { class: 'num small faint' }, fmt.euro(rest)),
          h('td', '')
        ]));
      }

      return h('div', { class: 'due-group' }, [
        h('div', { class: 'due-head' }, [
          h('span', { class: 'label' }, group.label),
          h('span', { class: 'tag' }, `${group.dates.length} offen`),
          h('div', { style: { flex: '1' } }),
          h('button', {
            class: 'btn small ghost',
            title: 'Diese Termine überspringen, ohne etwas anzulegen',
            onClick: () => skip(group)
          }, 'Überspringen'),
          h('button', {
            class: 'btn small primary',
            onClick: () => generate(group.templateId)
          }, 'Anlegen')
        ]),
        table(
          [{ label: 'Termin' }, { label: 'Vorgang' }, { label: 'Betrag', width: '130px', num: true }, { label: '', width: '150px' }],
          rows,
          { flush: false }
        )
      ]);
    });

    host.appendChild(panel(
      `${data.count} ${data.count === 1 ? 'Posten steht an' : 'Posten stehen an'}`,
      h('div', [
        note('Jeder Posten wird genau einmal angelegt. Was du löschst, steht wieder hier, was du überspringst, kommt nicht wieder.'),
        ...groups,
        h('div', { style: { display: 'flex', gap: '8px' } }, [
          h('div', { style: { flex: '1' } }),
          h('button', { class: 'btn primary', onClick: () => generate(null) }, 'Alles anlegen')
        ])
      ])
    ));
  }

  async function generate(templateId) {
    const result = UI.unwrap(
      await window.kontor.recurring.generate(templateId ? { templateId } : {}),
      'Anlegen'
    );
    if (!result) return;

    const parts = [];
    if (result.entries) parts.push(`${result.entries} ${result.entries === 1 ? 'Buchung' : 'Buchungen'}`);
    if (result.invoices) parts.push(`${result.invoices} ${result.invoices === 1 ? 'Rechnung' : 'Rechnungen'}`);
    UI.toast(parts.length ? `${parts.join(' und ')} angelegt.` : 'Nichts anzulegen.', 'success');

    if (result.warnings && result.warnings.length) {
      result.warnings.forEach((warning) => UI.toast(warning, 'error'));
    }
    app.refresh();
  }

  async function skip(group) {
    const ok = await UI.confirm(
      `${group.dates.length} Termine von „${group.label}“ überspringen? Es wird nichts angelegt, und sie tauchen auch später nicht wieder auf.`,
      { title: 'Termine überspringen', confirmLabel: 'Überspringen' }
    );
    if (!ok) return;

    const res = UI.unwrap(
      await window.kontor.recurring.skip({ templateId: group.templateId, dates: group.dates }),
      'Überspringen'
    );
    if (res === null) return;
    UI.toast('Termine übersprungen.');
    app.refresh();
  }

  /* --------------------------------------------------------- Liste */

  function rowFor(template) {
    const isEntry = template.kind === 'entry';
    const amount = isEntry
      ? template.template.gross
      : (template.template.items || []).reduce(
          (sum, item) => sum + Math.round(item.quantity * item.unitPriceNet * (1 - (item.discountPercent || 0) / 100)),
          0
        );

    return UI.clickableRow({ onClick: () => openForm(template) }, [
      h('td', [
        h('div', { class: 'strong' }, template.label),
        h('div', { class: 'small faint' }, isEntry
          ? template.template.counterparty || app.categoryLabel(template.template.categoryId)
          : app.customerName(template.template.customerId) || 'ohne Kunde'),
        !template.active ? h('span', { class: 'tag' }, 'stillgelegt') : null
      ]),
      h('td', { class: 'small' }, app.boot.recurringKinds[template.kind].label),
      h('td', { class: 'small' }, describeRule(template.rule)),
      h('td', { class: 'num' }, isEntry
        ? fmt.euro(amount)
        : h('span', [fmt.euro(amount), h('div', { class: 'small faint' }, 'netto')])),
      h('td', { class: 'nowrap small' }, ''),
      h('td', { onClick: (e) => e.stopPropagation() }, h('button', {
        class: 'btn small ghost',
        title: template.active ? 'Stilllegen' : 'Wieder aufnehmen',
        onClick: () => toggleActive(template)
      }, template.active ? 'Pause' : 'Aktiv'))
    ]);
  }

  /**
   * Der Rhythmus als Satz. Gerechnet wird im Hauptprozess, hier steht nur die
   * gleiche Beschreibung noch einmal für die Liste.
   */
  function describeRule(rule) {
    const spec = app.boot.recurrenceIntervals[rule.interval];
    if (!spec || !rule.startDate) return 'Ohne Rhythmus';

    let text = rule.every > 1
      ? (spec.weeks ? `Alle ${spec.weeks * rule.every} Wochen` : `Alle ${spec.months * rule.every} Monate`)
      : spec.label;

    if (!spec.weeks) {
      text += rule.anchorDay >= 29 ? ', am Monatsletzten' : `, am ${rule.anchorDay}.`;
    }
    if (rule.occurrences) text += `, ${rule.occurrences} mal`;
    else if (rule.endDate) text += `, bis ${fmt.date(rule.endDate)}`;
    return text;
  }

  async function toggleActive(template) {
    const saved = UI.unwrap(
      await window.kontor.recurring.save({ ...template, active: !template.active }),
      'Ändern'
    );
    if (!saved) return;
    UI.toast(saved.active ? 'Vorlage wieder aktiv.' : 'Vorlage stillgelegt.');
    app.refresh();
  }

  /* --------------------------------------------------------- Formular */

  function openForm(existing) {
    const kind = existing.kind || 'entry';
    const isEntry = kind === 'entry';

    if (!isEntry && !app.data.customers.length) {
      UI.toast('Für eine Rechnungsvorlage braucht es einen Kunden.', 'error');
      app.navigate('customers');
      return;
    }

    const draft = existing.id
      ? JSON.parse(JSON.stringify(existing))
      : {
          id: null,
          kind,
          label: '',
          active: true,
          markPaid: isEntry,
          autoFinalize: false,
          note: '',
          rule: {
            interval: 'monthly',
            every: 1,
            anchorDay: Number(app.boot.today.slice(8, 10)),
            startDate: app.boot.today,
            endDate: null,
            occurrences: null
          },
          template: isEntry
            ? {
                type: 'expense',
                amount: '',
                basis: 'gross',
                vatRate: 19,
                vatKey: null,
                categoryId: 'exp_other',
                description: '',
                counterparty: '',
                paymentMethod: 'direct_debit',
                segmentId: app.boot.segments[0].id,
                projectId: null,
                countryCode: 'DE',
                revenueKind: 'recurring',
                note: ''
              }
            : {
                documentType: 'invoice',
                customerId: app.data.customers[0].id,
                segmentId: app.boot.segments[0].id,
                projectId: null,
                paymentTermsDays: app.settings.invoice.paymentTermsDays,
                items: [{ name: '', description: '', quantity: 1, unit: 'MON', unitPriceNet: 0, vatRate: 19, discountPercent: 0 }],
                salutation: app.settings.invoice.salutation,
                intro: '',
                bodyText: (app.settings.texts.invoice || {}).body || '',
                outro: (app.settings.texts.invoice || {}).outro || '',
                buyerReference: '',
                currency: 'EUR',
                servicePeriod: true
              }
        };

    // Beim Bearbeiten steht der Betrag als Cent im Datensatz, das Feld erwartet Text.
    if (isEntry && existing.id) draft.template.amount = UI.amountValue(existing.template.gross);

    const body = h('div');

    function buildBody() {
      UI.clear(body);

      body.appendChild(field('Name der Vorlage', UI.input({
        value: draft.label,
        placeholder: isEntry ? 'Büromiete' : 'Betreuungspauschale Kunde X',
        onInput: (e) => { draft.label = e.target.value; }
      }), 'Nur für deine Übersicht, erscheint auf keinem Dokument'));

      body.appendChild(rulePanel());
      body.appendChild(h('h3', { class: 'panel-title', style: { margin: '18px 0 10px' } },
        isEntry ? 'Was gebucht wird' : 'Was berechnet wird'));
      body.appendChild(isEntry ? entryFields() : invoiceFields());
    }

    /* ------------------------------------------------- Rhythmus */

    function rulePanel() {
      const spec = app.boot.recurrenceIntervals[draft.rule.interval];
      const isWeekly = Boolean(spec && spec.weeks);

      return h('div', [
        h('div', { class: 'grid grid-4' }, [
          field('Rhythmus', select(
            Object.entries(app.boot.recurrenceIntervals).map(([id, i]) => ({ value: id, label: i.label })),
            draft.rule.interval,
            { onChange: (e) => { draft.rule.interval = e.target.value; buildBody(); } }
          )),
          field('Beginnt am', UI.dateInput({
            value: draft.rule.startDate || '',
            onChange: (e) => {
              draft.rule.startDate = e.target.value || null;
              if (draft.rule.startDate) draft.rule.anchorDay = Number(draft.rule.startDate.slice(8, 10));
              buildBody();
            }
          }), 'Auch rückwirkend, dann werden die alten Termine nachgeholt'),
          isWeekly
            ? h('div')
            : field('Stichtag im Monat', UI.input({
                type: 'number', min: '1', max: '31', class: 'num',
                value: String(draft.rule.anchorDay),
                onInput: (e) => { draft.rule.anchorDay = Number(e.target.value) || 1; }
              }), '31 bedeutet immer der Monatsletzte'),
          field('Endet', select([
            { value: 'never', label: 'Läuft weiter' },
            { value: 'date', label: 'An einem Datum' },
            { value: 'count', label: 'Nach Anzahl' }
          ], draft.rule.occurrences ? 'count' : draft.rule.endDate ? 'date' : 'never', {
            onChange: (e) => {
              draft.rule.endDate = null;
              draft.rule.occurrences = null;
              if (e.target.value === 'date') draft.rule.endDate = UI.addDays(app.boot.today, 365);
              if (e.target.value === 'count') draft.rule.occurrences = 12;
              buildBody();
            }
          }))
        ]),
        draft.rule.endDate
          ? field('Letzter Termin spätestens', UI.dateInput({
              value: draft.rule.endDate,
              onChange: (e) => { draft.rule.endDate = e.target.value || null; }
            }))
          : null,
        draft.rule.occurrences
          ? field('Anzahl der Termine', UI.input({
              type: 'number', min: '1', class: 'num',
              value: String(draft.rule.occurrences),
              onInput: (e) => { draft.rule.occurrences = Number(e.target.value) || 1; }
            }))
          : null
      ]);
    }

    /* ------------------------------------------------- Buchung */

    function entryFields() {
      const t = draft.template;
      const isIncome = t.type === 'income';
      const categories = isIncome ? app.boot.categories.income : app.boot.categories.expense;

      return h('div', [
        h('div', { style: { marginBottom: '14px' } }, UI.segmented([
          { value: 'expense', label: 'Ausgabe', tone: 'expense' },
          { value: 'income', label: 'Einnahme', tone: 'income' }
        ], t.type, (value) => {
          t.type = value;
          t.categoryId = value === 'income' ? 'inc_license' : 'exp_other';
          buildBody();
        })),

        h('div', { class: 'grid grid-3' }, [
          field('Betrag', UI.amountInput({
            value: t.amount,
            onInput: (e) => { t.amount = e.target.value; }
          })),
          field('Grundlage', UI.segmented([
            { value: 'gross', label: 'Brutto' },
            { value: 'net', label: 'Netto' }
          ], t.basis, (value) => { t.basis = value; })),
          field('Umsatzsteuer', select(
            app.boot.vatRates.map((r) => ({ value: r.key ? `k:${r.key}` : `r:${r.rate}`, label: r.label })),
            t.vatKey ? `k:${t.vatKey}` : `r:${t.vatRate}`,
            {
              onChange: (e) => {
                const [mode, value] = e.target.value.split(':');
                if (mode === 'k') {
                  const rate = app.boot.vatRates.find((r) => r.key === value);
                  t.vatKey = value;
                  t.vatRate = rate ? rate.rate : 0;
                } else {
                  t.vatKey = null;
                  t.vatRate = Number(value);
                }
              }
            }
          ))
        ]),

        h('div', { class: 'grid grid-2' }, [
          field('Verwendungszweck', UI.input({
            value: t.description,
            placeholder: 'Büromiete {PERIOD}',
            onInput: (e) => { t.description = e.target.value; }
          }), 'Platzhalter {PERIOD} wird zum Abrechnungsmonat, etwa März 2026'),
          field(isIncome ? 'Kunde' : 'Lieferant', UI.input({
            value: t.counterparty,
            onInput: (e) => { t.counterparty = e.target.value; }
          }))
        ]),

        field('Kategorie', select(
          categories.map((c) => ({ value: c.id, label: c.label })),
          t.categoryId,
          { onChange: (e) => { t.categoryId = e.target.value; } }
        )),

        h('div', { class: 'grid grid-3' }, [
          field('Bereich', select(
            app.boot.segments.map((s) => ({ value: s.id, label: s.label })),
            t.segmentId,
            { onChange: (e) => { t.segmentId = e.target.value; } }
          )),
          field('Projekt', select(
            [{ value: '', label: 'Ohne Projekt' }, ...app.data.projects.map((p) => ({ value: p.id, label: p.name }))],
            t.projectId || '',
            { onChange: (e) => { t.projectId = e.target.value || null; } }
          )),
          field('Zahlungsart', select(
            app.boot.paymentMethods.map((p) => ({ value: p.id, label: p.label })),
            t.paymentMethod,
            { onChange: (e) => { t.paymentMethod = e.target.value; } }
          ))
        ]),

        checkbox(
          'Gilt sofort als bezahlt',
          draft.markPaid,
          (v) => { draft.markPaid = v; }
        ),
        h('div', { class: 'help', style: { margin: '-6px 0 12px 26px' } },
          'Richtig bei Dauerauftrag und Lastschrift. Ohne Haken bleibt die Buchung offen, bis du das Zahlungsdatum einträgst.')
      ]);
    }

    /* ------------------------------------------------- Rechnung */

    function invoiceFields() {
      const t = draft.template;

      const itemRows = t.items.map((item, index) => h('tr', [
        h('td', { style: { width: '40%' } }, [
          UI.input({
            value: item.name,
            placeholder: 'Technische Betreuung',
            onInput: (e) => { item.name = e.target.value; }
          }),
          h('textarea', {
            value: item.description || '',
            placeholder: 'Beschreibung, {PERIOD} wird zum Monat',
            style: { minHeight: '36px', marginTop: '4px', fontSize: '12px' },
            onInput: (e) => { item.description = e.target.value; }
          })
        ]),
        h('td', { style: { width: '80px' } }, UI.input({
          class: 'num', value: String(item.quantity),
          onInput: (e) => { item.quantity = Number(String(e.target.value).replace(',', '.')) || 0; }
        })),
        h('td', { style: { width: '100px' } }, select(
          app.boot.units.map((u) => ({ value: u.code, label: u.label })),
          item.unit,
          { onChange: (e) => { item.unit = e.target.value; } }
        )),
        h('td', { style: { width: '110px' } }, UI.amountInput({
          value: UI.amountValue(item.unitPriceNet),
          onInput: (e) => { item.unitPriceNet = UI.parseAmount(e.target.value); }
        })),
        h('td', { style: { width: '160px' } }, select(
          app.boot.vatRates.map((r) => ({ value: r.key ? `k:${r.key}` : `r:${r.rate}`, label: r.label })),
          item.vatKey ? `k:${item.vatKey}` : `r:${item.vatRate}`,
          {
            onChange: (e) => {
              const [mode, value] = e.target.value.split(':');
              if (mode === 'k') {
                const rate = app.boot.vatRates.find((r) => r.key === value);
                item.vatKey = value;
                item.vatRate = rate ? rate.rate : 0;
              } else {
                item.vatKey = null;
                item.vatRate = Number(value);
              }
            }
          }
        )),
        h('td', { style: { width: '32px' } }, h('button', {
          class: 'btn small ghost pos-row-remove',
          onClick: () => {
            t.items.splice(index, 1);
            if (!t.items.length) t.items.push({ name: '', quantity: 1, unit: 'MON', unitPriceNet: 0, vatRate: 19 });
            buildBody();
          }
        }, '✕'))
      ]));

      return h('div', [
        h('div', { class: 'grid grid-3' }, [
          field('Kunde', select(
            app.data.customers.map((c) => ({ value: c.id, label: c.name })),
            t.customerId,
            { onChange: (e) => { t.customerId = e.target.value; } }
          )),
          field('Bereich', select(
            app.boot.segments.map((s) => ({ value: s.id, label: s.label })),
            t.segmentId,
            { onChange: (e) => { t.segmentId = e.target.value; } }
          )),
          field('Zahlungsziel in Tagen', UI.input({
            type: 'number', class: 'num', value: String(t.paymentTermsDays),
            onInput: (e) => { t.paymentTermsDays = Number(e.target.value) || 14; }
          }))
        ]),

        h('div', { class: 'table-wrap', style: { margin: '0 0 10px' } },
          h('table', { class: 'pos-table' }, [
            h('thead', h('tr', [
              h('th', 'Bezeichnung'), h('th', { class: 'num' }, 'Menge'), h('th', 'Einheit'),
              h('th', { class: 'num' }, 'Einzelpreis'), h('th', 'Umsatzsteuer'), h('th', '')
            ])),
            h('tbody', itemRows)
          ])),
        h('button', {
          class: 'btn small ghost',
          onClick: () => {
            t.items.push({ name: '', description: '', quantity: 1, unit: 'MON', unitPriceNet: 0, vatRate: 19, discountPercent: 0 });
            buildBody();
          }
        }, '+ Position'),

        h('details', { style: { marginTop: '16px' } }, [
          h('summary', { class: 'small muted', style: { cursor: 'pointer', marginBottom: '10px' } }, 'Texte und Einstellungen'),
          field('Einleitung', h('textarea', {
            value: t.intro,
            placeholder: 'Betreuungspauschale für {PERIOD}.',
            onInput: (e) => { t.intro = e.target.value; }
          }), 'Platzhalter {PERIOD} wird zum Abrechnungsmonat'),
          field('Zahlungshinweis', h('textarea', {
            value: t.bodyText,
            onInput: (e) => { t.bodyText = e.target.value; }
          })),
          checkbox('Leistungszeitraum ist der Abrechnungsmonat', t.servicePeriod,
            (v) => { t.servicePeriod = v; }),
          h('div', { class: 'help', style: { margin: '-6px 0 12px 26px' } },
            'Auf der Rechnung steht dann etwa 01.03. bis 31.03. statt eines einzelnen Leistungsdatums.'),
          checkbox('Sofort festschreiben statt als Entwurf anlegen', draft.autoFinalize,
            (v) => { draft.autoFinalize = v; }),
          h('div', { class: 'help', style: { margin: '-6px 0 12px 26px' } },
            'Die Rechnung bekommt dann direkt ihre Nummer. Fehlt eine Pflichtangabe, bleibt sie trotzdem Entwurf und du erfährst warum.')
        ])
      ]);
    }

    buildBody();

    UI.modal({
      title: draft.id
        ? 'Vorlage bearbeiten'
        : `Neue ${isEntry ? 'Buchungsvorlage' : 'Rechnungsvorlage'}`,
      body,
      wide: true,
      actions: (close) => [
        draft.id
          ? h('button', {
              class: 'btn danger',
              onClick: async () => {
                const ok = await UI.confirm(
                  `„${draft.label}“ löschen? Bereits angelegte Buchungen und Rechnungen bleiben bestehen.`,
                  { title: 'Vorlage löschen', confirmLabel: 'Löschen', danger: true }
                );
                if (!ok) return;
                if (UI.unwrap(await window.kontor.recurring.remove(draft.id), 'Löschen')) {
                  close();
                  app.refresh();
                }
              }
            }, 'Löschen')
          : null,
        h('div', { style: { flex: '1' } }),
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (!UI.unwrap(await window.kontor.recurring.save(draft), 'Speichern')) return;
            close();
            UI.toast('Vorlage gespeichert.', 'success');
            app.refresh();
          }
        }, 'Speichern')
      ]
    });
  }
};
