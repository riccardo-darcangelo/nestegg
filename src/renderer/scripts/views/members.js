'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Mitglieder und Beiträge.
 *
 * Die Liste, das Formular und der Beitragslauf. Gebucht wird auch hier erst
 * auf Bestätigung, und keine Fälligkeit zweimal.
 */
window.Views.members = function membersView(app) {
  const { h, fmt, panel, table, empty, note, field, select, checkbox } = UI;

  const state = app.state.members || (app.state.members = { filter: 'active', search: '' });
  const root = h('div', [app.pageHead('Mitglieder', 'Wird geladen …')]);

  load();
  return root;

  async function load() {
    const data = UI.unwrap(await window.kontor.members.overview({ year: app.year }), 'Mitglieder');
    if (!data) return;
    state.data = data;
    render();
  }

  /* --------------------------------------------------------- Rahmen */

  function render() {
    const { statistics, expected, tiers } = state.data;

    UI.clear(root);
    root.appendChild(app.pageHead(
      'Mitglieder',
      'Wer gehört zum Verein, in welcher Beitragsklasse, und was ist davon fällig. Aus den Fälligkeiten entstehen die Beitragsbuchungen.',
      [
        h('button', { class: 'btn ghost', onClick: () => openPreNotification() }, 'Vorabankündigung'),
        h('button', { class: 'btn', onClick: () => openDirectDebit() }, 'Lastschriften'),
        tiers.length ? h('button', {
          class: 'btn',
          onClick: () => openDuesRun()
        }, `Beitragslauf ${app.year}`) : null,
        h('button', { class: 'btn primary', onClick: () => openForm({}) }, 'Mitglied aufnehmen')
      ].filter(Boolean)
    ));

    root.appendChild(h('div', { class: 'grid grid-4', style: { marginBottom: '18px' } }, [
      UI.stat('Bestand', String(statistics.count), {
        hint: `am 31.12.${app.year}`
      }),
      UI.stat('Zugang', `${statistics.change >= 0 ? '+' : ''}${statistics.change}`, {
        tone: statistics.change > 0 ? 'good' : (statistics.change < 0 ? 'bad' : ''),
        hint: `${statistics.joined} Eintritte, ${statistics.left} Austritte`
      }),
      UI.stat('Beitragsaufkommen', fmt.euro(expected.total), {
        tone: 'accent',
        hint: `${expected.count} Fälligkeiten im Jahr`
      }),
      UI.stat('Durchschnittsalter', statistics.averageAge ? `${statistics.averageAge} Jahre` : '–', {
        hint: statistics.averageAge
          ? `${statistics.under18} unter 18, ${statistics.withBirthDate} mit Geburtsdatum`
          : 'kein Geburtsdatum erfasst'
      })
    ]));

    if (!tiers.length) {
      root.appendChild(note([
        'Es ist noch keine Beitragsklasse angelegt. Ohne sie lässt sich kein Beitrag berechnen und kein Lauf starten. Die Klassen stehen unten auf dieser Seite.'
      ], 'warn'));
    }

    root.appendChild(listPanel());
    root.appendChild(tierPanel());
    root.appendChild(sepaPanel());
    root.appendChild(statsPanel());
  }

  /* --------------------------------------------------------- Liste */

  function visible() {
    const today = state.data.today;
    const needle = state.search.toLowerCase();

    return state.data.members
      .filter((member) => {
        const status = statusOf(member, today);
        if (state.filter === 'active' && status !== 'active') return false;
        if (state.filter === 'left' && status !== 'left') return false;
        if (needle) {
          const hay = `${member.name} ${member.number} ${member.email} ${member.city}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => String(a.lastName || a.name).localeCompare(String(b.lastName || b.name), 'de'));
  }

  function statusOf(member, today) {
    if (!member.joinedAt) return 'unknown';
    if (member.joinedAt > today) return 'future';
    if (member.leftAt && member.leftAt < today) return 'left';
    return 'active';
  }

  function listPanel() {
    const list = visible();
    const all = state.data.members;

    const filters = h('div', { class: 'filters' }, [
      UI.segmented([
        { value: 'active', label: 'Aktiv' },
        { value: 'left', label: 'Ausgetreten' },
        { value: 'all', label: `Alle ${all.length}` }
      ], state.filter, (value) => { state.filter = value; render(); }),
      h('div', { class: 'field grow' }, [
        UI.input({
          placeholder: 'Suchen in Name, Nummer, Ort',
          value: state.search,
          onInput: UI.debounce((e) => { state.search = e.target.value; render(); }, 200)
        })
      ])
    ]);

    if (!list.length) {
      return h('div', [filters, panel(null, empty(
        all.length ? 'Kein Mitglied in dieser Auswahl.' : 'Noch keine Mitglieder.',
        all.length ? 'Der Filter blendet gerade alles aus.' : 'Trage die Mitglieder ein, dann rechnet die App die Beiträge.',
        h('button', { class: 'btn primary', onClick: () => openForm({}) }, 'Erstes Mitglied aufnehmen')
      ))]);
    }

    const rows = list.map((member) => {
      const status = statusOf(member, state.data.today);
      const tier = state.data.tiers.find((item) => item.id === member.tierId);
      const kind = app.boot.memberKinds.find((item) => item.id === member.kind);
      const dues = amountOf(member);

      return UI.clickableRow({ onClick: () => openForm(member) }, [
        h('td', { class: 'nowrap small faint' }, member.number || '–'),
        h('td', [
          h('div', { class: 'strong' }, member.name),
          h('div', { class: 'small faint' }, [member.zip, member.city].filter(Boolean).join(' ') || 'ohne Anschrift')
        ]),
        h('td', h('span', { class: `tag ${member.kind === 'honorary' ? 'paid' : 'draft'}` }, kind ? kind.label : member.kind)),
        h('td', tier
          ? h('div', [
              h('div', tier.label),
              h('div', { class: 'small faint' }, `${fmt.euro(tier.amount)} ${intervalLabel(tier.interval)}`)
            ])
          : h('span', { class: 'small faint' }, 'ohne Klasse')),
        h('td', { class: 'num' }, dues === 0
          ? h('span', { class: 'faint', title: 'zahlt keinen Beitrag' }, 'beitragsfrei')
          : h('span', {
              class: member.customAmount !== null && member.customAmount !== undefined ? 'strong' : null,
              title: member.customAmount !== null && member.customAmount !== undefined ? 'abweichender Betrag' : null
            }, fmt.euro(dues))),
        h('td', h('span', { class: 'tag' }, member.payment === 'debit' ? 'Lastschrift' : 'Überweisung')),
        h('td', { class: 'nowrap' }, [
          h('div', { class: 'small' }, fmt.date(member.joinedAt)),
          member.leftAt ? h('div', { class: 'small bad' }, `bis ${fmt.date(member.leftAt)}`) : null
        ]),
        h('td', status === 'active'
          ? h('span', { class: 'tag paid' }, 'aktiv')
          : (status === 'left' ? h('span', { class: 'tag cancelled' }, 'ausgetreten') : h('span', { class: 'tag open' }, 'ab ' + fmt.date(member.joinedAt))))
      ]);
    });

    return h('div', [filters, panel(null, table([
      { label: 'Nr.', width: '70px' },
      { label: 'Name' },
      { label: 'Art', width: '130px' },
      { label: 'Beitragsklasse', width: '190px' },
      { label: 'Beitrag', width: '110px', num: true },
      { label: 'Zahlweise', width: '120px' },
      { label: 'Mitglied seit', width: '120px' },
      { label: 'Stand', width: '110px' }
    ], rows))]);
  }

  /**
   * Was ein Mitglied je Fälligkeit zahlt.
   *
   * Dieselbe Reihenfolge wie im Rechenkern: der abweichende Betrag am
   * Mitglied geht vor, danach die Beitragsfreiheit, zuletzt die Klasse.
   */
  function amountOf(member) {
    if (member.customAmount !== null && member.customAmount !== undefined) return member.customAmount;
    if (member.kind === 'honorary' && app.settings.membership.honoraryFree !== false) return 0;
    const tier = state.data.tiers.find((item) => item.id === member.tierId);
    return tier ? tier.amount : 0;
  }

  function intervalLabel(id) {
    const found = app.boot.memberIntervals.find((item) => item.id === id);
    return found ? found.label : id;
  }

  /* --------------------------------------------------------- Klassen */

  function tierPanel() {
    const draft = {
      tiers: state.data.tiers.map((tier) => ({ ...tier })),
      dueMonth: app.settings.membership.dueMonth,
      dueDay: app.settings.membership.dueDay,
      honoraryFree: app.settings.membership.honoraryFree
    };

    const host = h('div');
    const build = () => {
      UI.clear(host);

      const rows = draft.tiers.map((tier, index) => h('tr', [
        h('td', UI.input({
          value: tier.label,
          onInput: (e) => { draft.tiers[index].label = e.target.value; }
        })),
        h('td', UI.amountInput({
          value: tier.amount ? UI.amountValue(tier.amount) : '',
          onInput: (e) => { draft.tiers[index].amount = UI.parseAmount(e.target.value); }
        })),
        h('td', select(
          app.boot.memberIntervals.map((item) => ({ value: item.id, label: item.label })),
          tier.interval,
          { onChange: (e) => { draft.tiers[index].interval = e.target.value; } }
        )),
        h('td', h('button', {
          class: 'btn small ghost danger',
          onClick: () => { draft.tiers.splice(index, 1); build(); }
        }, 'Entfernen'))
      ]));

      host.appendChild(table([
        { label: 'Bezeichnung' },
        { label: 'Betrag je Fälligkeit', width: '180px' },
        { label: 'Rhythmus', width: '180px' },
        { label: '', width: '110px' }
      ], rows));

      host.appendChild(h('div', { class: 'grid grid-3', style: { marginTop: '12px' } }, [
        field('Erste Fälligkeit im Monat', UI.input({
          type: 'number', class: 'num', value: String(draft.dueMonth),
          onInput: (e) => { draft.dueMonth = Number(e.target.value) || 1; }
        }), 'Weitere Termine folgen im Abstand des Rhythmus'),
        field('am Tag', UI.input({
          type: 'number', class: 'num', value: String(draft.dueDay),
          onInput: (e) => { draft.dueDay = Number(e.target.value) || 1; }
        }), 'Höchstens der 28., damit jeder Monat ihn hat'),
        field(null, h('div', { class: 'charge-options', style: { marginBottom: 0 } }, [
          checkbox('Ehrenmitglieder zahlen keinen Beitrag', draft.honoraryFree !== false,
            (value) => { draft.honoraryFree = value; })
        ]))
      ]));

      host.appendChild(h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, [
        h('button', {
          class: 'btn ghost',
          onClick: () => {
            draft.tiers.push({ id: `bk_${Date.now()}`, label: '', amount: 0, interval: 'yearly' });
            build();
          }
        }, 'Klasse hinzufügen'),
        h('div', { style: { flex: '1' } }),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (!UI.unwrap(await window.kontor.members.saveTiers(draft), 'Speichern')) return;
            UI.toast('Beitragsklassen gespeichert.', 'success');
            await app.refresh();
            await load();
          }
        }, 'Klassen speichern')
      ]));
    };

    build();
    return panel('Beitragsklassen', host, {
      note: 'Sie bestimmen, was wann fällig wird'
    });
  }

  /* --------------------------------------------------------- Lastschrift */

  function sepaPanel() {
    const current = app.settings.sepa || {};
    const draft = {
      creditorId: current.creditorId || '',
      creditorName: current.creditorName || '',
      scheme: current.scheme || 'CORE',
      sequenceType: current.sequenceType || 'RCUR',
      painVersion: current.painVersion || 'pain.008.001.08',
      preNotificationDays: current.preNotificationDays === undefined ? 14 : current.preNotificationDays,
      batchBooking: current.batchBooking !== false
    };

    const host = h('div');
    const build = () => {
      UI.clear(host);

      host.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Gläubiger-Identifikationsnummer', UI.input({
          value: draft.creditorId,
          placeholder: 'DE98ZZZ09999999999',
          onInput: (e) => { draft.creditorId = e.target.value; markCreditorId(e.target); }
        }), 'Kostenlos bei der Deutschen Bundesbank zu beantragen. Ohne sie ist kein Einzug möglich.'),
        field('Abweichender Gläubigername', UI.input({
          value: draft.creditorName,
          placeholder: app.settings.company.name || 'wie in den Firmendaten',
          onInput: (e) => { draft.creditorName = e.target.value; }
        }), 'Nur nötig, wenn auf dem Kontoauszug des Mitglieds ein anderer Name stehen soll')
      ]));

      host.appendChild(h('div', { class: 'grid grid-3' }, [
        field('Formatfassung', select(
          app.boot.painVersions.map((item) => ({ value: item.id, label: item.label })),
          draft.painVersion,
          { onChange: (e) => { draft.painVersion = e.target.value; build(); } }
        ), (app.boot.painVersions.find((item) => item.id === draft.painVersion) || {}).hint),
        field('Sequenztyp', select(
          app.boot.sepaSequenceTypes.map((item) => ({ value: item.id, label: `${item.id}, ${item.label}` })),
          draft.sequenceType,
          { onChange: (e) => { draft.sequenceType = e.target.value; build(); } }
        ), (app.boot.sepaSequenceTypes.find((item) => item.id === draft.sequenceType) || {}).hint),
        field('Vorabankündigung', UI.input({
          type: 'number', class: 'num', value: String(draft.preNotificationDays),
          onInput: (e) => { draft.preNotificationDays = Number(e.target.value) || 0; }
        }), 'Tage vor dem Einzug. 14 ohne eigene Vereinbarung, kürzer nur, wenn die Satzung es sagt.')
      ]));

      host.appendChild(h('div', { class: 'charge-options' }, [
        checkbox('Als Sammelbuchung einreichen', draft.batchBooking,
          (value) => { draft.batchBooking = value; })
      ]));

      host.appendChild(note([
        draft.batchBooking
          ? 'Sammelbuchung: die Bank bucht einen Betrag für den ganzen Einzug. Übersichtlich im Auszug, aber die einzelne Lastschrift ist dort nicht mehr zu sehen.'
          : 'Einzelbuchung: jede Lastschrift steht einzeln im Auszug. Gut für den Abgleich, unübersichtlich bei vielen Mitgliedern.'
      ]));

      host.appendChild(h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, [
        h('div', { style: { flex: '1' } }),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (!UI.unwrap(await window.kontor.sepa.saveSettings(draft), 'Speichern')) return;
            UI.toast('Einstellungen zum Lastschrifteinzug gespeichert.', 'success');
            await app.refresh();
            await load();
          }
        }, 'Speichern')
      ]));
    };

    build();
    return panel('Lastschrifteinzug', host, {
      note: 'Was in der SEPA-Datei steht'
    });
  }

  /**
   * Färbt das Feld nach der Prüfziffer.
   * Die Nummer ist achtzehn Stellen lang und wird abgetippt: ein Dreher fällt
   * ohne Rückmeldung erst auf, wenn die Bank die ganze Datei zurückweist.
   */
  function markCreditorId(input) {
    const value = input.value.replace(/\s/g, '').toUpperCase();
    if (!value) { input.classList.remove('bad-input', 'good-input'); return; }
    const ok = checkDigits(value);
    input.classList.toggle('bad-input', !ok);
    input.classList.toggle('good-input', ok);
  }

  /** Dieselbe Rechnung wie im Rechenkern, nur für die Rückmeldung im Feld. */
  function checkDigits(id) {
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(id)) return false;
    const digits = `${id.slice(7)}${id.slice(0, 2)}${id.slice(2, 4)}`
      .replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
    let rest = 0;
    for (const ch of digits) rest = (rest * 10 + Number(ch)) % 97;
    return rest === 1;
  }

  /* --------------------------------------------------------- Bestand */

  function statsPanel() {
    const stats = state.data.statistics;

    return panel(`Bestand ${app.year}`, h('div', { class: 'grid grid-2' }, [
      table([{ label: 'Art der Mitgliedschaft' }, { label: 'Anzahl', width: '110px', num: true }],
        stats.byKind.map((kind) => h('tr', [
          h('td', kind.label),
          h('td', { class: 'num' }, String(kind.count))
        ]))),
      table([{ label: 'Kennzahl' }, { label: 'Wert', width: '110px', num: true }], [
        h('tr', [h('td', 'Eintritte'), h('td', { class: 'num' }, String(stats.joined))]),
        h('tr', [h('td', 'Austritte'), h('td', { class: 'num' }, String(stats.left))]),
        h('tr', [h('td', 'Lastschrift'), h('td', { class: 'num' }, String(stats.byPayment.debit))]),
        h('tr', [h('td', 'Überweisung'), h('td', { class: 'num' }, String(stats.byPayment.transfer))])
      ])
    ]), { note: 'Die Zahlen, nach denen der Verband fragt' });
  }

  /* --------------------------------------------------------- Formular */

  function openForm(initial) {
    const draft = {
      id: initial.id || null,
      number: initial.number || '',
      firstName: initial.firstName || '',
      lastName: initial.lastName || '',
      kind: initial.kind || 'active',
      tierId: initial.tierId || (state.data.tiers[0] ? state.data.tiers[0].id : null),
      birthDate: initial.birthDate || '',
      joinedAt: initial.joinedAt || app.boot.today,
      leftAt: initial.leftAt || '',
      street: initial.street || '',
      zip: initial.zip || '',
      city: initial.city || '',
      email: initial.email || '',
      phone: initial.phone || '',
      payment: initial.payment || 'debit',
      iban: initial.iban || '',
      mandateRef: initial.mandateRef || '',
      mandateDate: initial.mandateDate || '',
      customAmount: initial.customAmount !== null && initial.customAmount !== undefined ? initial.customAmount : null,
      note: initial.note || ''
    };

    const body = h('div');
    const build = () => {
      UI.clear(body);

      body.appendChild(h('div', { class: 'grid grid-3' }, [
        field('Vorname', UI.input({ value: draft.firstName, onInput: (e) => { draft.firstName = e.target.value; } })),
        field('Nachname', UI.input({ value: draft.lastName, onInput: (e) => { draft.lastName = e.target.value; } })),
        field('Mitgliedsnummer', UI.input({
          value: draft.number, placeholder: 'frei wählbar',
          onInput: (e) => { draft.number = e.target.value; }
        }))
      ]));

      body.appendChild(h('div', { class: 'grid grid-3' }, [
        field('Art', select(
          app.boot.memberKinds.map((kind) => ({ value: kind.id, label: kind.label })),
          draft.kind,
          { onChange: (e) => { draft.kind = e.target.value; build(); } }
        )),
        field('Beitragsklasse', select(
          [{ value: '', label: 'ohne' }, ...state.data.tiers.map((tier) => ({ value: tier.id, label: `${tier.label}, ${fmt.euro(tier.amount)} ${intervalLabel(tier.interval)}` }))],
          draft.tierId || '',
          { onChange: (e) => { draft.tierId = e.target.value || null; } }
        ), draft.kind === 'honorary' && app.settings.membership.honoraryFree
          ? 'Ehrenmitglieder zahlen nach der Einstellung keinen Beitrag'
          : null),
        field('Abweichender Beitrag', UI.amountInput({
          value: draft.customAmount !== null ? UI.amountValue(draft.customAmount) : '',
          placeholder: 'wie die Klasse',
          onInput: (e) => {
            const text = e.target.value.trim();
            draft.customAmount = text ? UI.parseAmount(text) : null;
          }
        }), 'Für Ermäßigungen und Familienbeiträge')
      ]));

      body.appendChild(h('div', { class: 'grid grid-3' }, [
        field('Mitglied seit', UI.dateInput({
          value: draft.joinedAt,
          onChange: (e) => { draft.joinedAt = e.target.value; }
        })),
        field('Ausgetreten am', UI.dateInput({
          value: draft.leftAt,
          onChange: (e) => { draft.leftAt = e.target.value; }
        }), 'Leer lassen, solange die Mitgliedschaft läuft'),
        field('Geburtsdatum', UI.dateInput({
          value: draft.birthDate,
          onChange: (e) => { draft.birthDate = e.target.value; }
        }), 'Für Jugendanteil und Bestandsmeldung')
      ]));

      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Straße', UI.input({ value: draft.street, onInput: (e) => { draft.street = e.target.value; } }),
          'Gehört zu den Pflichtangaben einer Zuwendungsbestätigung'),
        h('div', { class: 'grid grid-2' }, [
          field('PLZ', UI.input({ value: draft.zip, onInput: (e) => { draft.zip = e.target.value; } })),
          field('Ort', UI.input({ value: draft.city, onInput: (e) => { draft.city = e.target.value; } }))
        ])
      ]));

      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('E-Mail', UI.input({ value: draft.email, onInput: (e) => { draft.email = e.target.value; } })),
        field('Telefon', UI.input({ value: draft.phone, onInput: (e) => { draft.phone = e.target.value; } }))
      ]));

      body.appendChild(field('Zahlweise', UI.segmented([
        { value: 'debit', label: 'Lastschrift' },
        { value: 'transfer', label: 'Überweisung' }
      ], draft.payment, (value) => { draft.payment = value; build(); }),
      draft.payment === 'debit'
        ? 'Der Beitrag gilt mit dem Fälligkeitstag als eingegangen'
        : 'Die Buchung bleibt offen, bis das Geld da ist'));

      if (draft.payment === 'debit') {
        body.appendChild(h('div', { class: 'grid grid-3' }, [
          field('IBAN', UI.input({
            value: draft.iban,
            onInput: (e) => { draft.iban = e.target.value; }
          }), 'Die App zieht nichts ein, sie hält es fest'),
          field('Mandatsreferenz', UI.input({
            value: draft.mandateRef,
            onInput: (e) => { draft.mandateRef = e.target.value; }
          })),
          field('Mandat vom', UI.dateInput({
            value: draft.mandateDate,
            onChange: (e) => { draft.mandateDate = e.target.value; }
          }))
        ]));
      }

      body.appendChild(field('Bemerkung', UI.input({
        value: draft.note,
        onInput: (e) => { draft.note = e.target.value; }
      })));
    };

    build();

    UI.modal({
      title: draft.id ? `Mitglied: ${initial.name}` : 'Mitglied aufnehmen',
      body,
      wide: true,
      actions: (close) => [
        draft.id ? h('button', {
          class: 'btn ghost danger',
          onClick: async () => {
            const ok = await UI.confirm(
              `${initial.name} wirklich löschen? Für ausgetretene Mitglieder ist ein Austrittsdatum der bessere Weg.`,
              { title: 'Mitglied löschen', confirmLabel: 'Löschen', danger: true }
            );
            if (!ok) return;
            if (!UI.unwrap(await window.kontor.members.remove(draft.id), 'Löschen')) return;
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
            if (!UI.unwrap(await window.kontor.members.save(draft), 'Speichern')) return;
            close();
            await app.refresh();
            await load();
          }
        }, 'Speichern')
      ].filter(Boolean)
    });
  }

  /* --------------------------------------------------------- Beitragslauf */

  async function openDuesRun() {
    const data = UI.unwrap(await window.kontor.members.duesPlan({ year: app.year }), 'Beitragslauf');
    if (!data) return;

    const body = h('div');

    const build = () => {
      UI.clear(body);
      const summary = recount();

      body.appendChild(h('div', { class: 'grid grid-4', style: { marginBottom: '4px' } }, [
        UI.stat('Fälligkeiten', String(summary.total), { hint: `im Jahr ${data.year}` }),
        UI.stat('Schon gebucht', String(summary.booked), { hint: summary.booked ? 'wird übersprungen' : 'noch nichts' }),
        UI.stat('Offen', String(summary.open), { tone: 'accent', hint: fmt.euro(summary.openAmount) }),
        UI.stat('Ausgewählt', fmt.euro(summary.selectedAmount), {
          tone: 'good',
          hint: `${summary.debit} Lastschrift, ${summary.transfer} Überweisung`
        })
      ]));

      body.appendChild(note([
        'Bei Lastschrift gilt der Beitrag mit dem Fälligkeitstag als eingegangen, weil er eingezogen wird. Bei Überweisung bleibt die Buchung offen, bis das Geld da ist.',
        'Die App zieht nichts ein. Den Einzug macht die Bank, und der Eingang lässt sich später über den Kontoauszug abgleichen.'
      ]));

      const rows = data.rows.map((row) => h('tr', { class: row.booked ? 'muted' : null }, [
        h('td', row.booked
          ? h('span', { class: 'tag paid' }, 'gebucht')
          : (row.skip
              ? h('span', { class: 'tag' }, 'beitragsfrei')
              : checkbox('', row.selected, (value) => { row.selected = value; build(); }))),
        h('td', { class: 'nowrap' }, fmt.date(row.date)),
        h('td', [
          h('div', row.memberName),
          h('div', { class: 'small faint' }, row.periodLabel)
        ]),
        h('td', h('span', { class: 'tag' }, row.payment === 'debit' ? 'Lastschrift' : 'Überweisung')),
        h('td', { class: 'num strong' }, row.amount ? fmt.euro(row.amount) : '–')
      ]));

      body.appendChild(table([
        { label: '', width: '110px' },
        { label: 'Fällig', width: '110px' },
        { label: 'Mitglied' },
        { label: 'Zahlweise', width: '130px' },
        { label: 'Betrag', width: '120px', num: true }
      ], rows, { flush: false }));
    };

    function recount() {
      const open = data.rows.filter((row) => !row.booked && !row.skip);
      const selected = data.rows.filter((row) => row.selected);

      return {
        total: data.rows.length,
        booked: data.rows.filter((row) => row.booked).length,
        open: open.length,
        openAmount: open.reduce((sum, row) => sum + row.amount, 0),
        selectedAmount: selected.reduce((sum, row) => sum + row.amount, 0),
        debit: selected.filter((row) => row.payment === 'debit').length,
        transfer: selected.filter((row) => row.payment === 'transfer').length
      };
    }

    build();

    UI.modal({
      title: `Beitragslauf ${data.year}`,
      body,
      wide: true,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const rows = data.rows.filter((row) => row.selected);
            if (!rows.length) return;

            const ok = await UI.confirm(
              `${rows.length} Beitragsbuchungen über ${fmt.euro(rows.reduce((sum, row) => sum + row.amount, 0))} anlegen?`,
              { title: 'Beitragslauf', confirmLabel: 'Buchen' }
            );
            if (!ok) return;

            const result = UI.unwrap(await window.kontor.members.runDues({ rows }), 'Beitragslauf');
            if (!result) return;

            close();
            UI.toast(`${result.created} Buchungen über ${fmt.euro(result.amount)} angelegt.`, 'success');
            if (result.problems.length) UI.toast(result.problems.join(' '), 'error');
            await app.refresh();
            await load();
          }
        }, 'Ausgewählte buchen')
      ]
    });
  }

  /* --------------------------------------------------------- Vorabankündigung */

  /**
   * Der Serienbrief vor dem ersten Einzug.
   *
   * Ein Blatt je Mitglied mit allen Terminen des Jahres. Bei gleichbleibenden
   * Beträgen genügt das für alle Einzüge zusammen, und genau deshalb ist es
   * ein Jahresschreiben und kein Brief je Fälligkeit.
   */
  async function openPreNotification() {
    const data = UI.unwrap(await window.kontor.members.preNotification({ year: app.year }), 'Vorabankündigung');
    if (!data) return;

    const selected = new Set(data.ready.map((item) => item.memberId));
    const body = h('div');

    const build = () => {
      UI.clear(body);

      if (!data.items.length) {
        body.appendChild(empty(
          'Niemand zahlt per Lastschrift.',
          `Für ${app.year} ist kein Mitglied erfasst, von dem eingezogen wird. Ohne Einzug braucht es auch keine Ankündigung.`
        ));
        return;
      }

      const spaet = data.deadline && data.today > data.deadline;

      body.appendChild(h('div', { class: 'grid grid-3', style: { marginBottom: '4px' } }, [
        UI.stat('Anzuschreiben', String(data.count), {
          hint: data.blocked.length ? `${data.blocked.length} ohne Anschrift oder Mandat` : 'alle vollständig'
        }),
        UI.stat('Ausgewählt', String(selected.size), { tone: 'accent', hint: 'Briefe im Dokument' }),
        UI.stat('Erster Einzug', data.firstDue ? fmt.date(data.firstDue) : '–', {
          tone: spaet ? 'bad' : '',
          hint: data.deadline ? `Post raus bis ${fmt.date(data.deadline)}` : ''
        })
      ]));

      body.appendChild(note([
        `Vor dem Einzug muss das Mitglied wissen, wann welcher Betrag von seinem Konto geht. Bei gleichbleibenden Beträgen genügt ein Schreiben für das ganze Jahr, wenn es alle Termine und Beträge nennt. Genau so ist dieser Brief gebaut.`,
        'Ein vollständiger Verzicht auf die Ankündigung lässt sich nicht vereinbaren, auch nicht in der Satzung. Verkürzen geht, ganz weglassen nicht.'
      ]));

      if (spaet) {
        body.appendChild(note([
          `Der erste Einzug ist am ${fmt.date(data.firstDue)}, die Frist von ${data.noticeDays} Tagen lief am ${fmt.date(data.deadline)} ab. Die Ankündigung ist damit verspätet. Sie trotzdem zu verschicken ist besser als gar nicht, aber der Einzug lässt sich bis dahin nicht auf sie stützen.`
        ], 'warn'));
      }

      if (!data.creditorId) {
        body.appendChild(note([
          'Es ist keine Gläubiger-Identifikationsnummer hinterlegt. Sie gehört in jede Vorabankündigung, ohne sie entsteht kein Dokument. Sie steht unten auf dieser Seite unter Lastschrifteinzug.'
        ], 'warn'));
      }

      const rows = data.items.map((item) => {
        const first = item.periods[0];
        return h('tr', { class: item.ready ? null : 'muted' }, [
          h('td', item.ready
            ? checkbox('', selected.has(item.memberId), (value) => {
                if (value) selected.add(item.memberId);
                else selected.delete(item.memberId);
                build();
              })
            : h('span', { class: 'tag cancelled' }, 'offen')),
          h('td', [
            h('div', { class: 'strong' }, item.member.name),
            h('div', { class: 'small faint' }, [item.member.zip, item.member.city].filter(Boolean).join(' ') || 'ohne Anschrift')
          ]),
          h('td', { class: 'small nowrap' }, item.periods.length === 1
            ? fmt.date(first.date)
            : `${item.periods.length} Termine ab ${fmt.date(first.date)}`),
          h('td', { class: 'num strong' }, fmt.euro(item.total)),
          h('td', { class: 'small' }, item.problems.length
            ? h('span', { class: 'bad' }, item.problems.join(' '))
            : '')
        ]);
      });

      body.appendChild(table([
        { label: '', width: '80px' },
        { label: 'Mitglied' },
        { label: 'Termine', width: '190px' },
        { label: 'Jahresbetrag', width: '130px', num: true },
        { label: 'Anmerkung' }
      ], rows, { flush: false }));
    };

    build();

    UI.modal({
      title: `Vorabankündigung ${app.year}`,
      body,
      wide: true,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (!selected.size) { UI.toast('Es ist kein Mitglied ausgewählt.', 'error'); return; }

            const result = UI.unwrap(await window.kontor.members.preNotificationPdf({
              year: app.year,
              memberIds: [...selected]
            }), 'Vorabankündigung');
            if (!result) return;

            close();
            UI.toast(`${result.count} Schreiben erzeugt: ${result.fileName}`, 'success');
          }
        }, 'Briefe erzeugen')
      ]
    });
  }

  /* --------------------------------------------------------- Lastschriftdatei */

  /**
   * Der Einzug.
   *
   * Eingezogen wird, was schon gebucht ist: der Beitragslauf stellt die
   * Forderung, dieser Schritt holt das Geld. Deshalb ist der Einzugstag ein
   * eigenes Feld und nicht der Fälligkeitstag der Buchung: die Beiträge sind
   * im Januar fällig, die Datei entsteht vielleicht im September, und die Bank
   * nimmt nur Termine an, die höchstens 14 Tage voraus liegen.
   */
  async function openDirectDebit() {
    let data = UI.unwrap(await window.kontor.sepa.plan({ year: app.year }), 'Lastschriften');
    if (!data) return;

    const withOpen = data.collections.filter((item) => item.count > 0);
    const first = withOpen.length ? withOpen[0] : data.collections[0];
    const state2 = {
      dueDate: (first || {}).dueDate,
      collectionDate: (first || {}).plannedDate || data.earliest,
      selected: null
    };

    const body = h('div');

    const current = () => data.collections.find((item) => item.dueDate === state2.dueDate) || null;

    /**
     * Holt den Plan für einen anderen Einzugstag.
     * Die Auswahl bleibt dabei erhalten, soweit die Zeilen weiter einziehbar
     * sind: ein verschobener Termin soll nicht die halbe Arbeit zurücksetzen.
     */
    async function reload(collectionDate) {
      const keep = state2.selected ? new Set(state2.selected) : null;
      const fresh = UI.unwrap(await window.kontor.sepa.plan({
        year: app.year, collectionDate
      }), 'Lastschriften');
      if (!fresh) return;

      data = fresh;
      state2.collectionDate = collectionDate;
      const group = current();
      state2.selected = new Set(
        (group ? group.rows : [])
          .filter((row) => row.ready && !row.exported && (!keep || keep.has(row.entryId)))
          .map((row) => row.entryId)
      );
      build();
    }

    const build = () => {
      UI.clear(body);
      const group = current();

      if (!data.collections.length) {
        body.appendChild(empty(
          'Keine Beitragsbuchung mit Lastschrift.',
          `Für ${app.year} ist nichts gebucht, was sich einziehen ließe. Lege die Beiträge zuerst über den Beitragslauf an.`
        ));
        return;
      }

      if (state2.selected === null) {
        state2.selected = new Set(group ? group.rows.filter((row) => row.ready && !row.exported).map((row) => row.entryId) : []);
      }

      // Die Fälligkeitstage, aus denen gewählt wird.
      body.appendChild(field('Fälligkeit', UI.segmented(
        data.collections.map((item) => ({
          value: item.dueDate,
          label: `${fmt.date(item.dueDate)} (${item.count})`,
          tone: item.count ? '' : 'muted'
        })),
        state2.dueDate,
        (value) => {
          state2.dueDate = value;
          state2.selected = null;
          build();
        }
      ), 'Zu welchem Termin die Beiträge gebucht sind'));

      if (!group) return;

      const chosen = group.rows.filter((row) => state2.selected.has(row.entryId));
      const total = chosen.reduce((sum, row) => sum + row.amount, 0);

      body.appendChild(h('div', { class: 'grid grid-3', style: { marginBottom: '4px' } }, [
        UI.stat('Einziehbar', String(group.count), { hint: group.exported ? `${group.exported} schon eingezogen` : 'noch nichts eingezogen' }),
        UI.stat('Ausgewählt', fmt.euro(total), { tone: 'accent', hint: `${chosen.length} Lastschriften` }),
        UI.stat('Beanstandet', String(group.blocked), {
          tone: group.blocked ? 'bad' : '',
          hint: group.blocked ? 'fehlt Mandat oder IBAN' : 'alle Mandate vollständig'
        })
      ]));

      body.appendChild(field('Einzugstag', UI.dateInput({
        value: state2.collectionDate,
        min: data.earliest,
        max: data.latest,
        // Neu geprüft wird im Rechenkern und nicht hier: ob ein Mandat trägt,
        // hängt am Einzugstag, und diese Antwort soll es nur an einer Stelle
        // geben.
        onChange: (e) => reload(e.target.value)
      }), `Frühestens ${fmt.date(data.earliest)}, spätestens ${fmt.date(data.latest)}. Zwischen Einreichung und Einzug muss mindestens ein TARGET-Geschäftstag liegen, mehr als 14 Kalendertage Vorlauf nimmt die Bank nicht an.`));

      // Die Prüfung läuft gegen den gewählten Einzugstag, nicht gegen den
      // Fälligkeitstag der Buchung.
      const check = checkRun(group, chosen);
      if (check.errors.length) body.appendChild(note(check.errors, 'warn'));
      if (check.warnings.length) body.appendChild(note(check.warnings));

      const rows = group.rows.map((row) => {
        const usable = row.ready && !row.exported;
        return h('tr', { class: row.exported ? 'muted' : null }, [
          h('td', row.exported
            ? h('span', { class: 'tag paid' }, 'eingezogen')
            : (row.ready
                ? checkbox('', state2.selected.has(row.entryId), (value) => {
                    if (value) state2.selected.add(row.entryId);
                    else state2.selected.delete(row.entryId);
                    build();
                  })
                : h('span', { class: 'tag cancelled' }, 'offen'))),
          h('td', [
            h('div', { class: usable ? 'strong' : null }, row.name),
            h('div', { class: 'small faint' }, row.reference)
          ]),
          h('td', { class: 'small nowrap' }, row.iban
            ? h('span', { title: row.iban }, `${row.iban.slice(0, 8)} … ${row.iban.slice(-4)}`)
            : h('span', { class: 'bad' }, 'keine IBAN')),
          h('td', { class: 'small' }, row.mandateRef
            ? h('div', [
                h('div', row.mandateRef),
                h('div', { class: 'faint' }, row.mandateDate ? `vom ${fmt.date(row.mandateDate)}` : 'ohne Datum')
              ])
            : h('span', { class: 'bad' }, 'kein Mandat')),
          h('td', { class: 'num strong' }, fmt.euro(row.amount)),
          h('td', { class: 'small' }, row.problems.length
            ? h('span', { class: 'bad' }, row.problems.join(' '))
            : (row.exported
                ? h('span', { class: 'faint' }, `am ${fmt.date(String(row.exportedAt).slice(0, 10))}`)
                : (row.notes.length ? h('span', { class: 'faint' }, row.notes.join(' ')) : '')))
        ]);
      });

      body.appendChild(table([
        { label: '', width: '100px' },
        { label: 'Mitglied' },
        { label: 'IBAN', width: '150px' },
        { label: 'Mandat', width: '150px' },
        { label: 'Betrag', width: '110px', num: true },
        { label: 'Anmerkung' }
      ], rows, { flush: false }));

      const hints = [
        'Die App zieht nichts ein. Sie schreibt die Datei, die im Onlinebanking hochgeladen wird. Erst die Bank führt den Einzug aus.',
        `Die Mitglieder brauchen vorher eine Vorabankündigung mit Betrag, Termin, Mandatsreferenz und Gläubiger-ID, ${data.settings.preNotificationDays} Tage vor dem Einzug.`
      ];

      // Einmal an der Datei statt an jeder Zeile: ohne einen bekannten letzten
      // Einzug kann die App über den Verfall nach 36 Monaten nichts sagen.
      if (!data.everExported) {
        hints.push('Dies ist der erste Einzug über diese App. Ob die Mandate noch gelten, weiß sie deshalb nicht: ein Mandat, aus dem 36 Monate lang nichts eingezogen wurde, ist verfallen und muss neu erteilt werden.');
      }

      body.appendChild(note(hints));
    };

    /** Was die Datei verhindern würde, gegen den gewählten Einzugstag gerechnet. */
    function checkRun(group, chosen) {
      const errors = [];
      const warnings = [];
      const settings = data.settings;

      if (!settings.creditorId) {
        errors.push('Es ist keine Gläubiger-Identifikationsnummer hinterlegt. Sie steht unten auf dieser Seite unter Lastschrifteinzug und wird kostenlos bei der Deutschen Bundesbank beantragt.');
      }
      if (!data.creditor.iban) {
        errors.push('Für den Verein ist keine IBAN hinterlegt. Sie steht in den Einstellungen unter den Firmendaten.');
      }
      if (!chosen.length) errors.push('Es ist keine Lastschrift ausgewählt.');

      const date = state2.collectionDate;
      const inRange = date && date >= data.earliest && date <= data.latest;

      if (date && date < data.earliest) {
        errors.push(`Der ${fmt.date(date)} liegt zu früh. Frühestens möglich ist ${fmt.date(data.earliest)}.`);
      } else if (date && date > data.latest) {
        errors.push(`Der ${fmt.date(date)} liegt zu weit voraus. Spätestens möglich ist ${fmt.date(data.latest)}.`);
      }

      // Die Hinweise zum Termin nur, solange der Termin überhaupt geht. Sonst
      // stünde neben dem Fehler ein "das ist zulässig", und das widerspricht
      // sich.
      if (inRange && date !== group.dueDate) {
        warnings.push(`Fällig waren die Beiträge am ${fmt.date(group.dueDate)}, eingezogen wird am ${fmt.date(date)}. Das ist zulässig, die Buchung bleibt auf dem Fälligkeitstag stehen.`);
      }

      const days = inRange ? Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${data.today}T00:00:00Z`)) / 86400000) : 0;
      if (inRange && days < settings.preNotificationDays) {
        warnings.push(`Bis zum Einzug ${days === 1 ? 'ist es ein Tag' : `sind es ${days} Tage`}. Die Vorabankündigung muss ${settings.preNotificationDays} Tage vorher vorliegen, sonst ist die Frist nur gewahrt, wenn die Satzung sie verkürzt.`);
      }

      return { errors, warnings };
    }

    build();

    UI.modal({
      title: `Lastschriften ${app.year}`,
      body,
      wide: true,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const group = current();
            if (!group) return;

            const chosen = group.rows.filter((row) => state2.selected.has(row.entryId));
            const check = checkRun(group, chosen);
            if (check.errors.length) { UI.toast(check.errors[0], 'error'); return; }

            const ok = await UI.confirm(
              `${chosen.length} Lastschriften über ${fmt.euro(chosen.reduce((sum, row) => sum + row.amount, 0))} zum ${fmt.date(state2.collectionDate)} in eine Datei schreiben? Die Forderungen gelten danach als eingezogen und werden nicht erneut angeboten.`,
              { title: 'Lastschriftdatei', confirmLabel: 'Datei erzeugen' }
            );
            if (!ok) return;

            const result = UI.unwrap(await window.kontor.sepa.export({
              dueDate: group.dueDate,
              collectionDate: state2.collectionDate,
              entryIds: chosen.map((row) => row.entryId)
            }), 'Lastschriftdatei');
            if (!result) return;

            close();
            UI.toast(`${result.count} Lastschriften über ${fmt.euro(result.total)} geschrieben: ${result.fileName}`, 'success');
            for (const warning of result.warnings || []) UI.toast(warning, 'error');
            await app.refresh();
            await load();
          }
        }, 'Datei erzeugen')
      ]
    });
  }
};
