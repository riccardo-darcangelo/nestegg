'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Mahnungen.
 *
 * Kein eigener Navigationspunkt: gemahnt wird an der Rechnung, und die steht
 * in der Rechnungsansicht. Hier liegt nur der Dialog, den beide Ansichten
 * aufrufen, damit es ihn nicht zweimal gibt.
 */
window.Dunning = (function dunningDialog() {
  const { h, fmt, field, checkbox } = UI;

  /**
   * Öffnet den Mahndialog für eine Rechnung.
   *
   * @param {object}   app
   * @param {string}   invoiceId
   * @param {Function} onDone
   */
  async function open(app, invoiceId, onDone) {
    const prepared = UI.unwrap(
      await window.kontor.dunning.prepare({ invoiceId }),
      'Mahnung vorbereiten'
    );
    if (!prepared) return;

    const draft = {
      invoiceId,
      level: prepared.level,
      deadline: prepared.deadline,
      includeInterest: prepared.interest.amount > 0,
      includeFlatFee: prepared.flatFee > 0,
      includeFee: prepared.fee > 0,
      intro: prepared.texts.intro || '',
      bodyText: prepared.bodyText,
      outro: prepared.texts.outro || ''
    };

    const body = h('div');
    let current = prepared;

    /** Rechnet im Hauptprozess nach, sobald sich etwas ändert. */
    const recalc = UI.debounce(async () => {
      const result = UI.unwrap(await window.kontor.dunning.prepare({ ...draft }));
      if (!result) return;
      current = result;
      // Der Textvorschlag folgt der Stufe, solange er nicht angefasst wurde.
      if (!draft.touchedBody) draft.bodyText = result.bodyText;
      build();
    }, 150);

    function build() {
      UI.clear(body);

      body.appendChild(h('div', { class: 'grid grid-3', style: { marginBottom: '4px' } }, [
        UI.stat('Offene Forderung', fmt.euro(current.open), {
          hint: `${current.overdueDays} Tage überfällig`
        }),
        UI.stat('Zinsen und Gebühren', fmt.euro(current.interest.amount + current.flatFee + current.fee), {
          tone: 'accent',
          hint: current.interest.days
            ? `${fmt.percent(current.interest.rate)} für ${current.interest.days} Tage`
            : 'noch keine Zinsen'
        }),
        UI.stat('Zu zahlen', fmt.euro(current.total), { tone: 'bad', hint: `bis ${fmt.date(draft.deadline)}` })
      ]));

      if (current.warnings.length) {
        body.appendChild(UI.note(current.warnings, current.level > 1 ? 'warn' : ''));
      }

      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Stufe', UI.select(
          prepared.levels.map((l) => ({ value: l.level, label: l.label })),
          draft.level,
          {
            onChange: (e) => {
              draft.level = Number(e.target.value);
              draft.touchedBody = false;
              recalc();
            }
          }
        ), current.business ? 'Empfänger gilt als Unternehmer' : 'Empfänger gilt als Verbraucher'),
        field('Neue Frist', UI.dateInput({
          value: draft.deadline,
          onChange: (e) => { draft.deadline = e.target.value; recalc(); }
        }))
      ]));

      body.appendChild(h('div', { class: 'charge-options' }, [
        checkbox(
          current.interest.days
            ? `Verzugszinsen berechnen, ${fmt.euro(current.interest.amount)}`
            : 'Verzugszinsen berechnen',
          draft.includeInterest,
          (v) => { draft.includeInterest = v; recalc(); }
        ),
        checkbox(
          'Pauschale nach §288 Abs. 5 BGB, 40,00 €',
          draft.includeFlatFee,
          (v) => { draft.includeFlatFee = v; recalc(); }
        ),
        checkbox(
          `Eigene Mahngebühr, ${fmt.euro(app.settings.dunning.feePerLevel)}`,
          draft.includeFee,
          (v) => { draft.includeFee = v; recalc(); }
        )
      ]));

      body.appendChild(h('details', { style: { marginTop: '10px' } }, [
        h('summary', { class: 'small muted', style: { cursor: 'pointer', marginBottom: '10px' } }, 'Texte'),
        field('Einleitung', h('textarea', {
          value: draft.intro,
          onInput: (e) => { draft.intro = e.target.value; }
        })),
        field('Hauptabsatz', h('textarea', {
          value: draft.bodyText,
          onInput: (e) => { draft.bodyText = e.target.value; draft.touchedBody = true; }
        }), 'Folgt der Stufe, solange du ihn nicht änderst'),
        field('Schlusstext', h('textarea', {
          value: draft.outro,
          onInput: (e) => { draft.outro = e.target.value; }
        }))
      ]));
    }

    build();

    UI.modal({
      title: `Mahnung zu ${prepared.invoiceNumber}`,
      body,
      wide: true,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const result = UI.unwrap(await window.kontor.dunning.create(draft), 'Mahnung');
            if (!result) return;
            close();
            UI.toast(`${result.reminder.levelLabel} festgehalten.`, 'success');

            // Direkt danach das Schreiben, sonst muss man es sich suchen.
            const pdf = UI.unwrap(await window.kontor.dunning.pdf({ invoiceId }), 'PDF');
            if (pdf) UI.toast(`Gespeichert: ${pdf.file}`, 'success');
            if (onDone) onDone();
          }
        }, 'Mahnung anlegen und drucken')
      ]
    });
  }

  /** Zeigt die bisherigen Mahnungen einer Rechnung. */
  function history(app, invoice, onDone) {
    const reminders = invoice.reminders || [];
    if (!reminders.length) return null;

    return h('div', { style: { marginTop: '16px' } }, [
      h('h3', { class: 'panel-title', style: { marginBottom: '8px' } }, 'Mahnungen'),
      UI.table(
        [
          { label: 'Datum' }, { label: 'Stufe' }, { label: 'Frist' },
          { label: 'Zinsen', num: true }, { label: 'Gefordert', num: true }, { label: '', width: '110px' }
        ],
        reminders.map((reminder, index) => h('tr', [
          h('td', { class: 'nowrap' }, fmt.date(reminder.date)),
          h('td', h('span', { class: 'tag overdue' }, reminder.levelLabel)),
          h('td', { class: 'nowrap' }, fmt.date(reminder.deadline)),
          h('td', { class: 'num' }, reminder.interest ? fmt.euro(reminder.interest) : '–'),
          h('td', { class: 'num strong' }, fmt.euro(reminder.total)),
          h('td', h('button', {
            class: 'btn small ghost',
            onClick: async () => {
              const pdf = UI.unwrap(await window.kontor.dunning.pdf({ invoiceId: invoice.id, index }), 'PDF');
              if (pdf) UI.toast(`Gespeichert: ${pdf.file}`, 'success');
            }
          }, 'Erneut drucken'))
        ])),
        { flush: false }
      ),
      h('button', {
        class: 'btn small ghost danger',
        style: { marginTop: '10px' },
        onClick: async () => {
          const ok = await UI.confirm(
            'Die letzte Mahnung zurücknehmen? Das Schreiben bleibt, wo du es gespeichert hast.',
            { title: 'Mahnung zurücknehmen', confirmLabel: 'Zurücknehmen', danger: true }
          );
          if (!ok) return;
          if (UI.unwrap(await window.kontor.dunning.removeLast(invoice.id), 'Zurücknehmen')) {
            UI.toast('Letzte Mahnung zurückgenommen.');
            if (onDone) onDone();
          }
        }
      }, 'Letzte zurücknehmen')
    ]);
  }

  return { open, history };
})();
