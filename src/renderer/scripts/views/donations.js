'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Zuwendungen und Bestätigungen.
 *
 * Wer hat wie viel gespendet, und wer hat seine Bestätigung schon? Ausgestellt
 * wird nach amtlichem Muster; fehlt eine Pflichtangabe, sagt die App es, statt
 * ein Papier zu drucken, mit dem der Spender beim Finanzamt scheitert und für
 * das der Verein haftet.
 */
window.Views.donations = function donationsView(app) {
  const { h, fmt, panel, table, empty, note, field, checkbox } = UI;

  const state = app.state.donations || (app.state.donations = {});
  const root = h('div', [app.pageHead(`Zuwendungen ${app.year}`, 'Wird geladen …')]);

  load();
  return root;

  async function load() {
    const [overview, issued, claims] = await Promise.all([
      window.kontor.donations.overview({ year: app.year }),
      window.kontor.donations.issued({ year: app.year }),
      window.kontor.claims.overview({ year: app.year })
    ]);

    const data = UI.unwrap(overview, 'Zuwendungen');
    const receipts = UI.unwrap(issued, 'Bestätigungen');
    const claimData = UI.unwrap(claims, 'Aufwandsspenden');
    if (!data || !receipts || !claimData) return;

    state.data = data;
    state.issued = receipts;
    state.claims = claimData;
    render();
  }

  function render() {
    const data = state.data;
    const confirmed = new Set(state.issued.confirmedEntryIds);

    UI.clear(root);
    root.appendChild(app.pageHead(
      `Zuwendungen ${app.year}`,
      'Spenden und Mitgliedsbeiträge, gruppiert nach Zuwendendem. Aus einer Auswahl entsteht die Bestätigung nach amtlichem Muster.',
      [h('button', { class: 'btn', onClick: () => openClaim({}) }, 'Aufwandsspende')]
    ));

    root.appendChild(h('div', { class: 'grid grid-4', style: { marginBottom: '18px' } }, [
      UI.stat('Zuwendungen', fmt.euro(data.total), { hint: `${data.count} Buchungen` }),
      UI.stat('Zuwendende', String(data.donors.length), { hint: 'im Jahr ' + app.year }),
      UI.stat('Bestätigt', String(state.issued.receipts.length), {
        tone: state.issued.receipts.length ? 'accent' : '',
        hint: 'ausgestellte Bestätigungen'
      }),
      UI.stat('Ohne Nachweis nötig', fmt.euro(data.simpleProofLimit), {
        hint: 'bis hierher genügt der Kontoauszug'
      })
    ]));

    if (!app.settings.entity.charitable) {
      root.appendChild(note([
        'Für dieses Profil ist nicht hinterlegt, dass es sich um eine steuerbegünstigte Körperschaft handelt. Ohne diese Angabe und ohne die Daten des Freistellungsbescheids lässt sich keine gültige Bestätigung ausstellen. Beides steht in den Einstellungen unter Körperschaft.'
      ], 'warn'));
    }

    if (!data.donors.length && !state.claims.rows.length) {
      root.appendChild(panel(null, empty(
        'Noch keine Zuwendungen erfasst.',
        'Spenden, Sachspenden und Mitgliedsbeiträge erscheinen hier, sobald sie mit der passenden Kategorie gebucht sind.'
      )));
    } else if (data.donors.length) {
      root.appendChild(donorPanel(data, confirmed));
    }

    root.appendChild(claimPanel());
    if (state.issued.receipts.length) root.appendChild(issuedPanel());
  }

  /* --------------------------------------------------------- Aufwandsspenden */

  /**
   * Aufwendungsersatzansprüche und der Verzicht darauf.
   *
   * Der Ablauf steht hier und nicht bei den Buchungen, weil er hier endet: aus
   * dem Verzicht wird eine Geldzuwendung, und die braucht ihre Bestätigung.
   */
  function claimPanel() {
    const data = state.claims;

    const body = h('div');

    if (data.dueSoon.length) {
      const naechste = data.dueSoon[0];
      body.appendChild(note([
        `Der nächste Verzicht ist bis zum ${fmt.date(naechste.check.deadline)} zu erklären: ${naechste.name}, ${fmt.euro(naechste.amount)}. Eine abgelaufene Frist lässt sich nicht heilen.`
      ], daysUntil(naechste.check.deadline) <= 21 ? 'warn' : ''));
    }

    if (!data.rows.length) {
      body.appendChild(empty(
        'Kein Aufwendungsersatzanspruch erfasst.',
        'Wer für den Verein Auslagen hat und darauf verzichtet, spendet. Das geht aber nur, wenn der Anspruch vorher bestand: erfasse ihn, bevor die Tätigkeit stattfindet.',
        h('button', { class: 'btn primary', onClick: () => openClaim({}) }, 'Ersten Anspruch erfassen')
      ));
    } else {
      body.appendChild(table([
        { label: 'Zuwendender' },
        { label: 'Aufwand' },
        { label: 'Betrag', width: '110px', num: true },
        { label: 'Frist', width: '130px' },
        { label: 'Stand', width: '160px' }
      ], data.rows.map((row) => {
        const kind = data.kinds.find((item) => item.id === row.kind);
        const rest = row.waivedAt ? null : daysUntil(row.check.deadline);

        return UI.clickableRow({ onClick: () => openClaim(row) }, [
          h('td', [
            h('div', { class: 'strong' }, row.name),
            h('div', { class: 'small faint' }, `${basisLabel(row)} vom ${fmt.date(row.basisDate)}`)
          ]),
          h('td', [
            h('div', kind ? kind.label : row.kind),
            h('div', { class: 'small faint' }, `${row.description}, ${fmt.date(row.date)}`)
          ]),
          h('td', { class: 'num strong' }, fmt.euro(row.amount)),
          h('td', { class: 'small nowrap' }, row.waivedAt
            ? h('span', { class: 'faint' }, `verzichtet ${fmt.date(row.waivedAt)}`)
            : h('span', { class: rest !== null && rest <= 21 ? 'bad' : '' },
                row.check.deadline ? fmt.date(row.check.deadline) : '–')),
          h('td', row.expenseEntryId
            ? h('span', { class: 'tag paid' }, 'gebucht')
            : (!row.check.ok
                ? h('span', { class: 'tag cancelled', title: row.check.blocking.join(' ') }, 'nicht möglich')
                : h('span', { class: 'tag open' }, 'Verzicht offen')))
        ]);
      })));
    }

    return panel('Aufwandsspenden', body, {
      note: data.rows.length
        ? `${data.waived.length} verzichtet, ${fmt.euro(data.total)}`
        : 'Verzicht auf Aufwendungsersatz, §10b Abs. 3 Satz 5 EStG'
    });
  }

  function basisLabel(row) {
    const basis = state.claims.bases.find((item) => item.id === row.basis);
    return basis ? basis.label : row.basis;
  }

  function daysUntil(date) {
    if (!date) return null;
    return Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${state.claims.today}T00:00:00Z`)) / 86400000);
  }

  /** Anspruch erfassen und, wenn alles stimmt, den Verzicht erklären. */
  function openClaim(initial) {
    const draft = {
      id: initial.id || null,
      memberId: initial.memberId || null,
      customerId: initial.customerId || null,
      name: initial.name || '',
      basis: initial.basis || 'bylaws',
      basisDate: initial.basisDate || '',
      basisNote: initial.basisNote || '',
      bylawsClause: Boolean(initial.bylawsClause),
      kind: initial.kind || 'travel',
      date: initial.date || app.boot.today,
      description: initial.description || '',
      kilometers: initial.kilometers || 0,
      amount: initial.amount || 0,
      sphereId: initial.sphereId || 'ideell',
      note: initial.note || ''
    };
    const gebucht = Boolean(initial.expenseEntryId);

    const body = h('div');
    let close = null;

    const build = () => {
      UI.clear(body);
      const kind = state.claims.kinds.find((item) => item.id === draft.kind);
      const basis = state.claims.bases.find((item) => item.id === draft.basis);

      if (gebucht) {
        body.appendChild(note([
          `Der Verzicht ist am ${fmt.date(initial.waivedAt)} erklärt und gebucht: ein Aufwand und eine Spende über je ${fmt.euro(initial.amount)}. Geändert wird hier nichts mehr, das ginge nur über die Buchungen.`
        ]));
      } else {
        body.appendChild(note([
          'Eine Aufwandsspende entsteht nur, wenn der Anspruch schon vor der Tätigkeit bestand, der Verein ihn hätte zahlen können und der Verzicht binnen drei Monaten erklärt wird. Alle drei lassen sich nur im Vorhinein schaffen.'
        ]));
      }

      /* Wer und woraus */
      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Zuwendender', UI.input({
          value: draft.name, placeholder: 'Name, wie er auf die Bestätigung soll',
          onInput: (e) => { draft.name = e.target.value; }
        }), 'Ein Mitglied oder ein Helfer, der keines ist'),
        field('Anspruch beruht auf', UI.select(
          state.claims.bases.map((item) => ({ value: item.id, label: item.label })),
          draft.basis,
          { onChange: (e) => { draft.basis = e.target.value; build(); } }
        ), basis ? basis.hint : '')
      ]));

      if (basis && basis.needsBylawsClause) {
        body.appendChild(h('div', { class: 'charge-options' }, [
          checkbox('Die Satzung ermächtigt den Vorstand ausdrücklich dazu', draft.bylawsClause,
            (value) => { draft.bylawsClause = value; build(); })
        ]));
      }

      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Eingeräumt am', UI.dateInput({
          value: draft.basisDate,
          onChange: (e) => { draft.basisDate = e.target.value; build(); }
        }), 'Muss vor der Tätigkeit liegen'),
        field('Fundstelle', UI.input({
          value: draft.basisNote, placeholder: 'etwa §12 der Satzung',
          onInput: (e) => { draft.basisNote = e.target.value; }
        }), 'Wo es nachzulesen ist')
      ]));

      /* Der Aufwand */
      body.appendChild(h('div', { class: 'grid grid-3' }, [
        field('Art des Aufwands', UI.select(
          state.claims.kinds.map((item) => ({ value: item.id, label: item.label })),
          draft.kind,
          { onChange: (e) => { draft.kind = e.target.value; build(); } }
        ), kind ? kind.hint : ''),
        field('Tätigkeit am', UI.dateInput({
          value: draft.date,
          onChange: (e) => { draft.date = e.target.value; build(); }
        })),
        kind && kind.perKilometer
          ? field('Kilometer', UI.input({
              type: 'number', class: 'num', value: String(draft.kilometers),
              onInput: (e) => { draft.kilometers = Number(e.target.value) || 0; build(); }
            }), `${(state.claims.kilometerRate / 100).toFixed(2).replace('.', ',')} € je Kilometer`)
          : field('Betrag', UI.amountInput({
              value: draft.amount ? UI.amountValue(draft.amount) : '',
              onInput: (e) => { draft.amount = UI.parseAmount(e.target.value); build(); }
            }), 'Wie belegt')
      ]));

      body.appendChild(field('Beschreibung', UI.input({
        value: draft.description, placeholder: 'etwa Fahrt zum Auswärtsspiel nach München',
        onInput: (e) => { draft.description = e.target.value; }
      }), 'Sie steht später auf der Buchung'));

      body.appendChild(field('Sphäre des Aufwands', UI.select(
        app.boot.spheres.map((s) => ({ value: s.id, label: s.label })),
        draft.sphereId,
        { onChange: (e) => { draft.sphereId = e.target.value; } }
      ), 'Wo die Tätigkeit stattfand. Die Spende selbst zählt immer zum ideellen Bereich.'));

      /* Was daraus folgt */
      const betrag = kind && kind.perKilometer
        ? Math.round(draft.kilometers * state.claims.kilometerRate)
        : draft.amount;

      if (betrag > 0) {
        body.appendChild(h('div', { class: 'grid grid-2' }, [
          UI.stat('Anspruch', fmt.euro(betrag), { tone: 'accent', hint: 'darauf wird verzichtet' }),
          UI.stat('Verzicht bis', draft.date ? fmt.date(deadlineFor(draft.date)) : '–', {
            hint: 'drei Monate nach der Tätigkeit'
          })
        ]));
      }

      const probleme = localCheck(draft, betrag);
      if (probleme.length) body.appendChild(note(probleme, 'warn'));

      if (!state.claims.knowsFunds) {
        body.appendChild(note([
          'Ob der Verein am Tag der Einräumung zahlungsfähig war, kann die App nicht belegen: dafür fehlt ein gepflegter Kontostand in den Einstellungen. Die Leistungsfähigkeit ist Voraussetzung und im Zweifel nachzuweisen.'
        ]));
      }
    };

    /**
     * Die Prüfung im Dialog, damit sie beim Tippen mitläuft.
     * Verbindlich ist die im Rechenkern: sie läuft noch einmal beim Speichern
     * und beim Verzicht.
     */
    function localCheck(value, betrag) {
      const list = [];
      if (value.basisDate && value.date && value.basisDate > value.date) {
        list.push(`Die Grundlage ist vom ${fmt.date(value.basisDate)}, die Tätigkeit war am ${fmt.date(value.date)}. Der Anspruch muss vorher bestanden haben, nachträglich geht es nicht.`);
      }
      const basis = state.claims.bases.find((item) => item.id === value.basis);
      if (basis && basis.needsBylawsClause && !value.bylawsClause) {
        list.push('Ein Vorstandsbeschluss allein genügt nicht. Ohne Satzungsklausel erkennt das Finanzamt die Aufwandsspende nicht an.');
      }
      if (value.date && deadlineFor(value.date) < state.claims.today) {
        list.push(`Die Frist für den Verzicht lief am ${fmt.date(deadlineFor(value.date))} ab. Der Anspruch bleibt bestehen, als Aufwandsspende taugt er nicht mehr.`);
      }
      if (!betrag) list.push('Der Betrag ist null.');
      return list;
    }

    function deadlineFor(date) {
      const d = new Date(`${date}T00:00:00Z`);
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + state.claims.waiverMonths);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, last));
      return d.toISOString().slice(0, 10);
    }

    build();

    close = UI.modal({
      title: gebucht ? 'Aufwandsspende' : (draft.id ? 'Anspruch bearbeiten' : 'Aufwendungsersatzanspruch'),
      body,
      wide: true,
      actions: (dismiss) => gebucht
        ? [h('button', { class: 'btn ghost', onClick: dismiss }, 'Schließen')]
        : [
            draft.id ? h('button', {
              class: 'btn ghost danger',
              onClick: async () => {
                const ok = await UI.confirm('Diesen Anspruch löschen?', {
                  title: 'Anspruch löschen', confirmLabel: 'Löschen', danger: true
                });
                if (!ok) return;
                if (!UI.unwrap(await window.kontor.claims.remove(draft.id), 'Löschen')) return;
                dismiss();
                await load();
              }
            }, 'Löschen') : null,
            h('div', { style: { flex: '1' } }),
            h('button', { class: 'btn ghost', onClick: dismiss }, 'Abbrechen'),
            h('button', {
              class: 'btn',
              onClick: async () => {
                const saved = UI.unwrap(await window.kontor.claims.save(draft), 'Speichern');
                if (!saved) return;
                dismiss();
                await load();
              }
            }, 'Anspruch speichern'),
            h('button', {
              class: 'btn primary',
              onClick: () => waive(draft, dismiss)
            }, 'Verzicht erklären')
          ].filter(Boolean)
    });
  }

  /**
   * Der Verzicht.
   *
   * Erst hier entsteht die Spende. Gefragt wird nach dem Datum, weil der
   * Verzicht oft schriftlich vorliegt und älter ist als der Tag, an dem er
   * erfasst wird.
   */
  async function waive(draft, dismissParent) {
    // Der Anspruch muss stehen, bevor auf ihn verzichtet werden kann.
    const saved = UI.unwrap(await window.kontor.claims.save(draft), 'Speichern');
    if (!saved) return;

    const values = {
      waivedAt: app.boot.today,
      expenseCategoryId: (app.boot.categories.expense[0] || {}).id,
      donationCategoryId: (app.boot.categories.income.find((c) => c.id === 'cl_inc_donation')
        || app.boot.categories.income[0] || {}).id
    };

    const body = h('div');
    const build = () => {
      UI.clear(body);

      body.appendChild(note([
        `Aus dem Verzicht entstehen zwei Buchungen über je ${fmt.euro(saved.amount)}: der Aufwand in der gewählten Sphäre und die Spende im ideellen Bereich. Es fließt kein Geld, und trotzdem gehören beide in die Rechnung.`,
        'Die Spende trägt danach das Kennzeichen für das amtliche Muster und lässt sich oben wie jede andere bestätigen.'
      ]));

      body.appendChild(field('Verzicht erklärt am', UI.dateInput({
        value: values.waivedAt,
        onChange: (e) => { values.waivedAt = e.target.value; }
      }), 'Das Datum der schriftlichen Erklärung'));

      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Aufwand buchen auf', UI.select(
          app.boot.categories.expense.map((c) => ({ value: c.id, label: c.label })),
          values.expenseCategoryId,
          { onChange: (e) => { values.expenseCategoryId = e.target.value; } }
        )),
        field('Spende buchen auf', UI.select(
          app.boot.categories.income.map((c) => ({ value: c.id, label: c.label })),
          values.donationCategoryId,
          { onChange: (e) => { values.donationCategoryId = e.target.value; } }
        ))
      ]));
    };

    build();

    UI.modal({
      title: 'Verzicht erklären',
      body,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const result = UI.unwrap(await window.kontor.claims.waive({
              id: saved.id, ...values
            }), 'Verzicht');
            if (!result) return;

            close();
            if (dismissParent) dismissParent();
            UI.toast(`Aufwandsspende über ${fmt.euro(result.amount)} gebucht.`, 'success');
            for (const warnung of result.warnings || []) UI.toast(warnung, 'error');
            await app.refresh();
            await load();
          }
        }, 'Verzicht buchen')
      ]
    });
  }

  /* --------------------------------------------------------- Spender */

  function donorPanel(data, confirmed) {
    const rows = data.donors.map((donor) => {
      const open = donor.entries.filter((entry) => !confirmed.has(entry.id));
      const alles = open.length === 0;

      return h('tr', [
        h('td', [
          h('div', { class: 'strong' }, donor.name),
          h('div', { class: 'small faint' }, donor.hasAddress
            ? `${donor.entries.length} ${donor.entries.length === 1 ? 'Zuwendung' : 'Zuwendungen'}`
            : 'Anschrift fehlt, sie ist Pflichtangabe'),
          // Aufwandsspenden brauchen eine eigene Bestätigung, weil das
          // amtliche Muster nur ein Kreuz für das ganze Papier kennt.
          donor.waiver
            ? h('div', { class: 'small' }, [
                h('span', { class: 'tag' }, 'Verzicht'),
                h('span', { class: 'faint' }, ` ${fmt.euro(donor.waiver)}, eigene Bestätigung nötig`)
              ])
            : null
        ]),
        h('td', { class: 'num' }, donor.donations ? fmt.euro(donor.donations) : '–'),
        h('td', { class: 'num' }, donor.dues ? fmt.euro(donor.dues) : '–'),
        h('td', { class: 'num strong' }, fmt.euro(donor.total)),
        h('td', alles
          ? h('span', { class: 'tag paid' }, 'bestätigt')
          : h('span', { class: 'tag open' }, `${open.length} offen`)),
        h('td', h('button', {
          class: alles ? 'btn small ghost' : 'btn small',
          onClick: () => openDialog(donor, open.length ? open : donor.entries)
        }, alles ? 'Erneut' : 'Bestätigen'))
      ]);
    });

    return panel('Zuwendende', table([
      { label: 'Name' },
      { label: 'Spenden', width: '130px', num: true },
      { label: 'Beiträge', width: '130px', num: true },
      { label: 'Zusammen', width: '130px', num: true },
      { label: 'Stand', width: '110px' },
      { label: '', width: '110px' }
    ], rows));
  }

  function issuedPanel() {
    const rows = [...state.issued.receipts].reverse().map((item) => h('tr', [
      h('td', { class: 'nowrap' }, fmt.date(item.date)),
      h('td', item.donorName),
      h('td', h('span', { class: 'tag' }, item.collective ? 'Sammelbestätigung' : 'Einzelbestätigung')),
      h('td', { class: 'num strong' }, fmt.euro(item.total)),
      h('td', { class: 'small faint', title: item.file }, item.file ? item.file.split(/[\\/]/).pop() : '')
    ]));

    return panel('Ausgestellte Bestätigungen', table([
      { label: 'Datum', width: '110px' },
      { label: 'Zuwendender' },
      { label: 'Art', width: '160px' },
      { label: 'Betrag', width: '130px', num: true },
      { label: 'Datei', width: '220px' }
    ], rows), { note: 'Über dieselbe Zuwendung darf es nur eine Bestätigung geben' });
  }

  /* --------------------------------------------------------- Dialog */

  async function openDialog(donor, entries) {
    const selected = new Set(entries.map((entry) => entry.id));
    let waiver = false;

    const body = h('div');
    let prepared = null;

    const recalc = async () => {
      const result = UI.unwrap(await window.kontor.donations.prepare({
        entryIds: [...selected],
        customerId: donor.customerId,
        memberId: donor.memberId,
        year: app.year,
        waiver
      }));
      if (!result) return;
      prepared = result;
      build();
    };

    function build() {
      UI.clear(body);
      if (!prepared) return;

      body.appendChild(h('div', { class: 'grid grid-3', style: { marginBottom: '4px' } }, [
        UI.stat('Betrag', fmt.euro(prepared.total), { hint: prepared.collective ? 'Sammelbestätigung' : 'Einzelbestätigung' }),
        UI.stat('Zuwendungen', String(prepared.entries.length), { hint: `im Jahr ${prepared.year}` }),
        UI.stat('Art', (prepared.type === 'kind' ? 'Sachzuwendung' : (prepared.type === 'dues' ? 'Mitgliedsbeitrag' : 'Geldzuwendung')), {
          tone: 'accent'
        })
      ]));

      body.appendChild(note([`In Buchstaben: ${prepared.totalInWords}`]));

      if (prepared.warnings.length) body.appendChild(note(prepared.warnings, 'warn'));

      body.appendChild(h('div', { class: 'donation-list' }, prepared.entries.map((entry) => {
        const row = donor.entries.find((item) => item.id === entry.id) || entry;
        return h('label', { class: 'donation-row' }, [
          (() => {
            const box = h('input', {
              type: 'checkbox',
              onChange: (e) => {
                if (e.target.checked) selected.add(entry.id);
                else selected.delete(entry.id);
                recalc();
              }
            });
            box.checked = selected.has(entry.id);
            return box;
          })(),
          h('span', { class: 'donation-date' }, fmt.date(entry.date)),
          h('span', { class: 'donation-text' }, entry.description || row.description || 'Zuwendung'),
          h('span', { class: 'donation-amount' }, fmt.euro(entry.amount))
        ]);
      })));

      body.appendChild(h('div', { class: 'charge-options', style: { marginTop: '12px' } }, [
        checkbox(
          'Verzicht auf Erstattung von Aufwendungen (Aufwandsspende)',
          waiver,
          (value) => { waiver = value; recalc(); }
        )
      ]));
    }

    await recalc();

    UI.modal({
      title: `Zuwendungsbestätigung für ${donor.name}`,
      body,
      wide: true,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (!prepared) return;

            const result = UI.unwrap(await window.kontor.donations.create({
              entryIds: [...selected],
              customerId: donor.customerId,
              memberId: donor.memberId,
              donor: prepared.donor,
              year: app.year,
              waiver,
              collective: prepared.collective
            }), 'Bestätigung');
            if (!result) return;

            close();
            UI.toast(`Gespeichert: ${result.file}`, 'success');
            await app.refresh();
            await load();
          }
        }, 'Ausstellen und drucken')
      ]
    });
  }
};
