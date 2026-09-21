'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Buchungen: Liste, Filter und das Erfassungsformular.
 *
 * Das Formular rechnet live im Hauptprozess nach, statt die Steuerlogik hier
 * noch einmal nachzubauen. So gibt es nur eine Wahrheit.
 */
window.Views.entries = function entriesView(app) {
  const { h, fmt, panel, table, empty, field, select, segmented, checkbox } = UI;

  const filters = app.state.filters.entries || (app.state.filters.entries = {
    type: 'all',
    search: '',
    status: 'all',
    categoryId: ''
  });

  const root = h('div');
  render();
  return root;

  function visibleEntries() {
    return app.data.entries
      .filter((entry) => {
        const year = entry.taxYearOverride
          ? Number(entry.taxYearOverride)
          : Number((entry.paidDate || entry.date).slice(0, 4));
        if (year !== app.year) return false;
        if (filters.type !== 'all' && entry.type !== filters.type) return false;
        if (filters.status === 'open' && entry.paidDate) return false;
        if (filters.status === 'paid' && !entry.paidDate) return false;
        if (filters.categoryId && entry.categoryId !== filters.categoryId) return false;
        if (filters.search) {
          const needle = filters.search.toLowerCase();
          const hay = `${entry.description} ${entry.counterparty} ${entry.note}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => String(b.paidDate || b.date).localeCompare(String(a.paidDate || a.date)));
  }

  function render() {
    UI.clear(root);
    const list = visibleEntries();
    const income = list.filter((e) => e.type === 'income').reduce((s, e) => s + e.gross, 0);
    const expense = list.filter((e) => e.type === 'expense').reduce((s, e) => s + e.gross, 0);

    root.appendChild(app.pageHead(
      'Buchungen',
      'Jede Einnahme und jede Ausgabe. Das Zahlungsdatum entscheidet darüber, in welchem Jahr und in welchem Voranmeldungszeitraum sie zählt.',
      [
        h('button', {
          class: 'btn ghost',
          title: 'XRechnung oder ZUGFeRD einlesen',
          onClick: () => window.EInvoice.open(app, () => app.refresh())
        }, 'E-Rechnung einlesen'),
        h('button', {
          class: 'btn ghost',
          title: 'Verpflegungspauschale und Kilometergeld rechnen',
          onClick: () => window.Travel.open(app, () => app.refresh())
        }, 'Reise abrechnen'),
        h('button', { class: 'btn', onClick: () => openForm({ type: 'expense' }) }, 'Ausgabe'),
        h('button', { class: 'btn primary', onClick: () => openForm({ type: 'income' }) }, 'Einnahme')
      ]
    ));

    root.appendChild(filterBar());

    if (!list.length) {
      root.appendChild(panel(null, empty(
        'Keine Buchungen gefunden.',
        'Entweder ist das Jahr noch leer oder die Filter sind zu eng gesetzt.',
        h('button', { class: 'btn primary', onClick: () => openForm({ type: 'expense' }) }, 'Erste Buchung erfassen')
      )));
      return;
    }

    const rows = list.map(rowFor);
    rows.push(h('tr', { class: 'sum' }, [
      h('td', { colspan: 5 }, `${list.length} Buchungen`),
      h('td', { class: 'num money income' }, fmt.euro(income)),
      h('td', { class: 'num money expense' }, fmt.euro(expense)),
      h('td', '')
    ]));

    root.appendChild(panel(null, table([
      { label: 'Datum', width: '96px' },
      { label: 'Zahlung', width: '96px' },
      { label: 'Vorgang' },
      { label: 'Kategorie', width: '200px' },
      { label: 'USt', width: '86px', num: true },
      { label: 'Einnahme', width: '118px', num: true },
      { label: 'Ausgabe', width: '118px', num: true },
      { label: '', width: '92px' }
    ], rows)));
  }

  function filterBar() {
    const categoryOptions = [
      { value: '', label: 'Alle Kategorien' },
      ...[...app.boot.categories.income, ...app.boot.categories.expense].map((c) => ({ value: c.id, label: c.label }))
    ];

    return h('div', { class: 'filters' }, [
      segmented([
        { value: 'all', label: 'Alle' },
        { value: 'income', label: 'Einnahmen', tone: 'income' },
        { value: 'expense', label: 'Ausgaben', tone: 'expense' }
      ], filters.type, (value) => { filters.type = value; render(); }),

      segmented([
        { value: 'all', label: 'Alle' },
        { value: 'paid', label: 'Bezahlt' },
        { value: 'open', label: 'Offen' }
      ], filters.status, (value) => { filters.status = value; render(); }),

      // Ohne sichtbare Beschriftung, aber nicht ohne Namen: die Sprachausgabe
      // sagt sonst nur "Auswahlfeld".
      field(null, select(categoryOptions, filters.categoryId, {
        'aria-label': 'Nach Kategorie filtern',
        onChange: (e) => { filters.categoryId = e.target.value; render(); }
      })),

      h('div', { class: 'field grow' }, [
        UI.input({
          placeholder: 'Suchen in Zweck, Gegenpartei und Notiz',
          value: filters.search,
          onInput: UI.debounce((e) => { filters.search = e.target.value; render(); }, 220)
        })
      ]),

      h('button', {
        class: 'btn ghost',
        onClick: async () => {
          const res = await window.kontor.reports.exportCsv(app.year);
          const data = UI.unwrap(res, 'CSV-Export');
          if (data) UI.toast(`Gespeichert: ${data.file}`, 'success');
        }
      }, 'CSV')
    ]);
  }

  function rowFor(entry) {
    const receipt = app.receipt(entry.receiptId);
    const isIncome = entry.type === 'income';

    return UI.clickableRow({ onClick: () => openForm(entry) }, [
      h('td', { class: 'nowrap' }, fmt.date(entry.date)),
      h('td', { class: 'nowrap' }, entry.paidDate
        ? fmt.date(entry.paidDate)
        : h('span', { class: 'tag open' }, 'offen')),
      h('td', [
        h('div', { class: 'strong' }, entry.description || '(ohne Zweck)'),
        h('div', { class: 'small faint' }, [
          entry.counterparty || '',
          entry.counterparty && receipt ? ' · ' : '',
          receipt ? h('span', { class: 'tag' }, 'Beleg') : null,
          entry.assetId ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, 'Anlage') : null,
          entry.privateSharePercent ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, `${entry.privateSharePercent} % privat`) : null
        ])
      ]),
      h('td', { class: 'small' }, app.categoryLabel(entry.categoryId)),
      h('td', { class: 'num small faint' }, entry.vatRate ? `${entry.vatRate} %` : '0 %'),
      h('td', { class: 'num money income' }, isIncome ? fmt.euro(entry.gross) : ''),
      h('td', { class: 'num money expense' }, isIncome ? '' : fmt.euro(entry.gross)),
      h('td', { onClick: (e) => e.stopPropagation() }, [
        receipt
          ? h('button', {
              class: 'btn small ghost',
              title: 'Beleg öffnen',
              onClick: () => window.kontor.receipts.open(receipt.id)
            }, 'Beleg')
          : null,
        h('button', {
          class: 'btn small ghost',
          title: 'Löschen',
          onClick: () => removeEntry(entry)
        }, '✕')
      ])
    ]);
  }

  async function removeEntry(entry) {
    const ok = await UI.confirm(
      `„${entry.description}“ über ${fmt.euro(entry.gross)} wirklich löschen? Die Löschung wird im Änderungsprotokoll festgehalten.`,
      { title: 'Buchung löschen', confirmLabel: 'Löschen', danger: true }
    );
    if (!ok) return;
    const res = await window.kontor.entries.remove(entry.id);
    if (UI.unwrap(res, 'Löschen')) {
      UI.toast('Buchung gelöscht.');
      app.refresh();
    }
  }

  /* ------------------------------------------------------- Formular */

  function openForm(initial) {
    const draft = {
      id: initial.id || null,
      type: initial.type || 'expense',
      date: initial.date || app.boot.today,
      paidDate: initial.paidDate !== undefined ? initial.paidDate : app.boot.today,
      amount: initial.gross !== undefined ? UI.amountValue(initial.gross) : '',
      basis: initial.basis || 'gross',
      vatRate: initial.vatRate !== undefined ? initial.vatRate : 19,
      vatKey: initial.vatKey || null,
      categoryId: initial.categoryId || (initial.type === 'income' ? 'inc_services' : 'exp_other'),
      description: initial.description || '',
      counterparty: initial.counterparty || '',
      paymentMethod: initial.paymentMethod || 'bank',
      privateSharePercent: initial.privateSharePercent || 0,
      segmentId: initial.segmentId || app.boot.segments[0].id,
      customerId: initial.customerId || null,
      projectId: initial.projectId || null,
      countryCode: initial.countryCode || 'DE',
      sphereId: initial.sphereId || null,
      sportsEvent: Boolean(initial.sportsEvent),
      counterpartyVatId: initial.counterpartyVatId || '',
      revenueKind: initial.revenueKind || 'onetime',
      receiptId: initial.receiptId || null,
      assetId: initial.assetId || null,
      reverseCharge: Boolean(initial.reverseCharge),
      intraCommunityAcquisition: Boolean(initial.intraCommunityAcquisition),
      taxYearOverride: initial.taxYearOverride || null,
      note: initial.note || '',
      createdAt: initial.createdAt || null,
      createAsset: false,
      usefulLifeYears: 3
    };

    const preview = h('div', { class: 'note' }, 'Betrag eingeben …');
    const body = h('div');
    let close = null;

    const update = UI.debounce(async () => {
      const res = await window.kontor.entries.preview(draft);
      const data = UI.unwrap(res);
      if (!data) return;
      UI.clear(preview);
      preview.className = data.errors.length ? 'note error' : 'note';
      preview.appendChild(h('div', { style: { fontWeight: '600', marginBottom: '4px' } },
        `${fmt.euro(data.entry.net)} netto  ·  ${fmt.euro(data.entry.vat)} Umsatzsteuer  ·  ${fmt.euro(data.entry.gross)} brutto`));
      if (draft.type === 'expense' && data.effect.inputVat !== data.entry.vat) {
        preview.appendChild(h('div', { class: 'small' },
          `Abziehbare Vorsteuer: ${fmt.euro(data.effect.inputVat)}`));
      }
      if (data.effect.euerAmount !== data.effect.businessNet) {
        preview.appendChild(h('div', { class: 'small' },
          `Wirkt in der EÜR mit ${fmt.euro(data.effect.euerAmount)}`));
      }
      const messages = [...data.errors, ...data.warnings];
      if (messages.length) {
        preview.appendChild(h('ul', { style: { margin: '8px 0 0', paddingLeft: '18px' } },
          messages.map((m) => h('li', { class: 'small' }, m))));
      }
    }, 140);

    /**
     * Übernimmt, was im Beleg gefunden wurde.
     *
     * Nur leere Felder werden gefüllt. Eine Mustererkennung darf nichts
     * überschreiben, was ein Mensch schon eingetragen hat.
     */
    function applyScan(scan) {
      if (!scan) return;

      if (!scan.ok) {
        if (scan.warning) UI.toast(scan.warning);
        return;
      }

      const fields = scan.fields || {};
      const taken = [];

      if (fields.amount && !UI.parseAmount(draft.amount)) {
        draft.amount = UI.amountValue(fields.amount);
        taken.push('Betrag');
      }
      if (fields.date) {
        draft.date = fields.date;
        taken.push('Datum');
      }
      if (fields.counterparty && !draft.counterparty) {
        draft.counterparty = fields.counterparty;
        taken.push('Lieferant');
      }
      if (fields.number && !draft.description) {
        draft.description = `Rechnung ${fields.number}`;
        taken.push('Nummer');
      }
      if (fields.vatRate !== undefined && draft.type === 'expense') {
        draft.vatRate = fields.vatRate;
        taken.push('Steuersatz');
      }
      if (fields.counterpartyVatId && !draft.counterpartyVatId) {
        draft.counterpartyVatId = fields.counterpartyVatId;
      }

      UI.toast(taken.length
        ? `Aus dem Beleg gelesen: ${taken.join(', ')}. Bitte prüfen.`
        : 'Im Beleg stand nichts, was noch gefehlt hätte.');
    }

    function buildBody() {
      UI.clear(body);
      const isIncome = draft.type === 'income';
      const categories = isIncome ? app.boot.categories.income : app.boot.categories.expense;

      const vatOptions = app.boot.vatRates.map((r, i) => ({
        value: r.key ? `k:${r.key}` : `r:${r.rate}`,
        label: r.label
      }));
      const currentVat = draft.vatKey ? `k:${draft.vatKey}` : `r:${draft.vatRate}`;

      body.appendChild(h('div', { style: { marginBottom: '14px' } }, segmented([
        { value: 'expense', label: 'Ausgabe', tone: 'expense' },
        { value: 'income', label: 'Einnahme', tone: 'income' }
      ], draft.type, (value) => {
        draft.type = value;
        draft.categoryId = value === 'income' ? 'inc_services' : 'exp_other';
        buildBody();
        update();
      })));

      body.appendChild(h('div', { class: 'grid grid-3' }, [
        field('Betrag', UI.amountInput({
          value: draft.amount,
          onInput: (e) => { draft.amount = e.target.value; update(); }
        })),
        field('Grundlage', segmented([
          { value: 'gross', label: 'Brutto' },
          { value: 'net', label: 'Netto' }
        ], draft.basis, (value) => { draft.basis = value; buildBody(); update(); })),
        field('Umsatzsteuer', select(vatOptions, currentVat, {
          onChange: (e) => {
            const [kind, value] = e.target.value.split(':');
            if (kind === 'k') {
              const rate = app.boot.vatRates.find((r) => r.key === value);
              draft.vatKey = value;
              draft.vatRate = rate ? rate.rate : 0;
            } else {
              draft.vatKey = null;
              draft.vatRate = Number(value);
            }
            update();
          }
        }))
      ]));

      body.appendChild(h('div', { class: 'grid grid-3' }, [
        field('Verwendungszweck', UI.input({
          value: draft.description,
          placeholder: isIncome ? 'Wofür kam das Geld?' : 'Wofür war die Ausgabe?',
          onInput: (e) => { draft.description = e.target.value; update(); }
        })),
        field(isIncome ? 'Kunde' : 'Lieferant', UI.input({
          value: draft.counterparty,
          list: 'counterparties',
          onInput: (e) => { draft.counterparty = e.target.value; }
        })),
        // Dasselbe Feld, das eine eingelesene E-Rechnung füllt, und dieselbe
        // Spalte im DATEV-Export (Belegfeld 1). Nur eben von Hand.
        field('Belegnummer', UI.input({
          value: draft.eInvoiceNumber || '',
          placeholder: 'Nummer auf dem Beleg',
          onInput: (e) => { draft.eInvoiceNumber = e.target.value; }
        }), 'Die Nummer, die der Beleg trägt')
      ]));

      body.appendChild(field('Kategorie', select(
        categories.map((c) => ({ value: c.id, label: c.label })),
        draft.categoryId,
        {
          onChange: (e) => {
            draft.categoryId = e.target.value;
            const cat = categories.find((c) => c.id === draft.categoryId);
            if (cat) {
              draft.vatRate = cat.defaultVatRate;
              draft.vatKey = cat.defaultVatKey || null;
            }
            buildBody();
            update();
          }
        }
      ), categoryHint(draft.categoryId, categories)));

      body.appendChild(h('div', { class: 'grid grid-3' }, [
        field('Belegdatum', UI.dateInput({
          value: draft.date,
          onChange: (e) => { draft.date = e.target.value; update(); }
        }), 'Rechnungs- oder Leistungsdatum'),
        field('Bezahlt am', h('div', { style: { display: 'flex', gap: '6px' } }, [
          UI.dateInput({
            value: draft.paidDate || '',
            onChange: (e) => { draft.paidDate = e.target.value || null; update(); }
          }),
          h('button', {
            class: 'btn small ghost',
            title: draft.paidDate ? 'Als offen markieren' : 'Heute',
            onClick: () => {
              draft.paidDate = draft.paidDate ? null : app.boot.today;
              buildBody();
              update();
            }
          }, draft.paidDate ? 'offen' : 'heute')
        ]), 'Leer lassen, solange nicht gezahlt wurde'),
        field('Zahlungsart', select(
          app.boot.paymentMethods.map((p) => ({ value: p.id, label: p.label })),
          draft.paymentMethod,
          { onChange: (e) => { draft.paymentMethod = e.target.value; } }
        ))
      ]));

      body.appendChild(dimensionRow(isIncome));
      body.appendChild(preview);
      body.appendChild(receiptRow());
      body.appendChild(advanced());
    }

    /**
     * Bereich, Projekt und Land. Diese drei Angaben kosten beim Erfassen kaum
     * Zeit und sind später die Grundlage jeder Auswertung.
     */
    function dimensionRow(isIncome) {
      const projectOptions = [
        { value: '', label: 'Ohne Projekt' },
        ...app.data.projects
          .filter((p) => ['planned', 'active'].includes(p.status) || p.id === draft.projectId)
          .map((p) => ({ value: p.id, label: p.name }))
      ];

      const customerOptions = [
        { value: '', label: 'Nicht verknüpft' },
        ...app.data.customers.map((c) => ({ value: c.id, label: c.name }))
      ];

      // Im Verein steht die Sphäre über allem: sie entscheidet über
      // Steuerpflicht und Vorsteuerabzug und gehört deshalb ganz nach oben.
      const isClub = app.boot.entity && app.boot.entity.kind === 'club';
      const sphere = isClub ? app.boot.spheres.find((s) => s.id === draft.sphereId) : null;

      return h('div', [
        isClub ? h('div', { class: 'grid grid-2' }, [
          field('Sphäre', select(
            [
              { value: '', label: 'noch nicht zugeordnet' },
              ...app.boot.spheres.map((s) => ({ value: s.id, label: s.label }))
            ],
            draft.sphereId || '',
            {
              onChange: (e) => {
                draft.sphereId = e.target.value || null;
                update();
                buildBody();
              }
            }
          ), sphere
            ? `${sphere.hint}. ${sphere.inputVat ? 'Vorsteuerabzug möglich.' : 'Kein Vorsteuerabzug: nicht unternehmerisch.'}`
            : 'Ohne Zuordnung gibt es keinen Vorsteuerabzug und die Besteuerungsgrenze lässt sich nicht prüfen'),
          draft.sphereId === 'zweckbetrieb' ? field('Art', h('div', { class: 'charge-options', style: { marginBottom: 0 } }, [
            checkbox(
              'Sportliche Veranstaltung (§67a AO)',
              draft.sportsEvent,
              (value) => { draft.sportsEvent = value; }
            )
          ]), 'Für die eigene Grenze von 50.000 Euro') : h('div')
        ]) : null,

        h('div', { class: 'grid grid-3' }, [
          field('Bereich', select(
            app.boot.segments.map((s) => ({ value: s.id, label: s.label })),
            draft.segmentId,
            { onChange: (e) => { draft.segmentId = e.target.value; } }
          )),
          field('Projekt', select(projectOptions, draft.projectId || '', {
            onChange: (e) => { draft.projectId = e.target.value || null; }
          })),
          field('Land der Gegenpartei', select(
            app.boot.countries.map((c) => ({ value: c.code, label: `${c.label} (${c.zone})` })),
            draft.countryCode,
            {
              onChange: (e) => {
                draft.countryCode = e.target.value;
                buildBody();
                update();
              }
            }
          ))
        ]),
        h('div', { class: 'grid grid-2' }, [
          field(isIncome ? 'Kunde verknüpfen' : 'Als Kunde verknüpfen', select(
            customerOptions,
            draft.customerId || '',
            {
              onChange: (e) => {
                draft.customerId = e.target.value || null;
                const customer = app.customer(draft.customerId);
                if (customer) {
                  // Land und Steuernummer des Kunden übernehmen: davon hängt ab,
                  // wo der Umsatz steuerbar ist und ob er gemeldet werden muss.
                  draft.countryCode = customer.country || 'DE';
                  draft.counterpartyVatId = customer.vatId || '';
                  if (!draft.counterparty) draft.counterparty = customer.name;
                }
                buildBody();
                update();
              }
            }
          ), 'Nötig für die Kundenauswertung und die Zusammenfassende Meldung'),
          isIncome
            ? field('Umsatzart', UI.segmented([
                { value: 'onetime', label: 'Einmalig' },
                { value: 'recurring', label: 'Wiederkehrend' }
              ], draft.revenueKind, (value) => { draft.revenueKind = value; }),
              'Wiederkehrend zählt in die Kennzahl des laufenden Monatsumsatzes')
            : null
        ]),
        draft.countryCode !== 'DE'
          ? field('USt-IdNr. der Gegenpartei', UI.input({
              value: draft.counterpartyVatId,
              placeholder: 'IE6388047V',
              onInput: (e) => { draft.counterpartyVatId = e.target.value.toUpperCase(); update(); }
            }), countryHint())
          : null
      ]);
    }

    function countryHint() {
      const country = app.boot.countries.find((c) => c.code === draft.countryCode);
      if (!country) return null;
      if (country.zone === 'Drittland') {
        return 'Drittland: der Umsatz ist im Inland nicht steuerbar, eine Meldung entfällt.';
      }
      if (draft.type === 'income') {
        return draft.counterpartyVatId
          ? 'Mit USt-IdNr. geht die Steuerschuld auf den Empfänger über. Der Umsatz gehört dann in die Zusammenfassende Meldung.'
          : 'Ohne USt-IdNr. gilt der Empfänger als Privatperson und der Umsatz bleibt steuerpflichtig.';
      }
      return 'Bei einer Leistung aus dem EU-Ausland schuldest du die Steuer selbst. Dafür gibt es unten den Reverse-Charge-Schalter.';
    }

    function categoryHint(categoryId, categories) {
      const cat = categories.find((c) => c.id === categoryId);
      if (!cat) return null;
      const bits = [`EÜR-Position: ${cat.position}`];
      if (typeof cat.deductible === 'number') bits.push(`nur ${cat.deductible} Prozent abziehbar`);
      if (cat.vatDeductible === false) bits.push('kein Vorsteuerabzug');
      return bits.join(' · ');
    }

    function receiptRow() {
      const receipt = app.receipt(draft.receiptId);
      return h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0 14px' } }, [
        receipt
          ? h('span', { class: 'small' }, [
              h('span', { class: 'tag' }, 'Beleg'),
              ' ',
              receipt.fileName
            ])
          : h('span', { class: 'small faint' }, 'Kein Beleg hinterlegt'),
        h('div', { style: { flex: '1' } }),
        receipt
          ? h('button', {
              class: 'btn small ghost',
              onClick: () => window.kontor.receipts.open(receipt.id)
            }, 'Öffnen')
          : null,
        h('button', {
          class: 'btn small',
          onClick: async () => {
            const res = await window.kontor.receipts.attach({
              date: draft.date,
              counterparty: draft.counterparty,
              description: draft.description,
              amountLabel: draft.amount
            });
            const stored = UI.unwrap(res, 'Beleg');
            if (!stored) return;
            draft.receiptId = stored.id;

            // Was im Beleg steht, kommt als Vorschlag ins Formular. Übernommen
            // wird nur, was noch leer ist: von Hand Eingetragenes ist immer
            // die bessere Auskunft als eine Mustererkennung.
            applyScan(stored.scan);

            await app.refresh();
            buildBody();
            update();
          }
        }, receipt ? 'Ersetzen' : 'Beleg anhängen')
      ]);
    }

    function advanced() {
      const box = h('details', { style: { marginTop: '8px' } }, [
        h('summary', { class: 'small muted', style: { cursor: 'pointer', marginBottom: '10px' } }, 'Weitere Angaben'),
        h('div', { class: 'grid grid-2' }, [
          field('Privatanteil in Prozent', UI.input({
            type: 'number', min: '0', max: '100', class: 'num',
            value: String(draft.privateSharePercent || 0),
            onInput: (e) => { draft.privateSharePercent = Number(e.target.value) || 0; update(); }
          }), 'Nur der betriebliche Rest wirkt sich aus'),
          field('Steuerjahr abweichend', UI.input({
            type: 'number',
            placeholder: 'automatisch',
            value: draft.taxYearOverride || '',
            onInput: (e) => { draft.taxYearOverride = e.target.value ? Number(e.target.value) : null; update(); }
          }), 'Für die Zehn-Tage-Regel bei wiederkehrenden Zahlungen um den Jahreswechsel')
        ]),
        draft.type === 'expense'
          ? h('div', [
              checkbox('Reverse Charge: ich schulde die Steuer als Leistungsempfänger (§13b)', draft.reverseCharge,
                (v) => { draft.reverseCharge = v; update(); }),
              checkbox('Innergemeinschaftlicher Erwerb aus dem EU-Ausland', draft.intraCommunityAcquisition,
                (v) => { draft.intraCommunityAcquisition = v; update(); }),
              draft.assetId
                ? h('div', { class: 'small faint' }, 'Diese Ausgabe ist bereits mit einem Anlagegut verknüpft.')
                : checkbox('Als Anlagegut führen und abschreiben', draft.createAsset, (v) => {
                    draft.createAsset = v;
                    buildBody();
                    update();
                  })
            ])
          : null,
        draft.createAsset
          ? field('Nutzungsdauer in Jahren', select(
              app.boot.usefulLives.map((u) => ({ value: u.years, label: `${u.years} Jahre – ${u.label}` })),
              draft.usefulLifeYears,
              { onChange: (e) => { draft.usefulLifeYears = Number(e.target.value); } }
            ))
          : null,
        field('Notiz', h('textarea', {
          value: draft.note,
          placeholder: 'Bei Bewirtung gehören Anlass und Teilnehmer hierher.',
          onInput: (e) => { draft.note = e.target.value; }
        }))
      ]);
      return box;
    }

    buildBody();
    update();

    close = UI.modal({
      title: draft.id ? 'Buchung bearbeiten' : 'Neue Buchung',
      body,
      wide: true,
      actions: (closeFn) => [
        h('button', { class: 'btn ghost', onClick: closeFn }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const res = await window.kontor.entries.save(draft);
            if (!UI.unwrap(res, 'Speichern')) return;
            closeFn();
            UI.toast(draft.id ? 'Buchung aktualisiert.' : 'Buchung gespeichert.', 'success');
            app.refresh();
          }
        }, 'Speichern')
      ]
    });
  }
};
