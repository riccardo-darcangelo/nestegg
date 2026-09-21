'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Reisekosten.
 *
 * Verpflegungspauschale und Kilometergeld sind die beiden Beträge, die man
 * nicht belegt, sondern rechnet. Der Dialog rechnet sie und legt daraus zwei
 * Buchungen an, beide ohne Vorsteuer: aus einer Pauschale gibt es keine.
 */
window.Travel = (function travelDialog() {
  const { h, fmt, field, select, checkbox, note } = UI;

  const KINDS = [
    { value: 'full', label: 'Ganzer Tag, 28,00 €' },
    { value: 'arrival', label: 'Anreise, 14,00 €' },
    { value: 'departure', label: 'Abreise, 14,00 €' },
    { value: 'partial', label: 'Über 8 Stunden, 14,00 €' },
    { value: 'none', label: 'Keine Pauschale' }
  ];

  function open(app, onDone) {
    const trip = {
      from: app.boot.today,
      to: app.boot.today,
      description: '',
      kilometers: 0,
      segmentId: null,
      projectId: null,
      days: []
    };

    const body = h('div');
    let preview = null;

    const recalc = UI.debounce(async () => {
      const result = UI.unwrap(await window.kontor.travel.preview(trip));
      if (!result) return;
      preview = result;
      // Die Tage kommen aus dem Hauptprozess zurück, samit Kürzungen.
      if (!trip.days.length) trip.days = result.days.map((day) => ({ ...day }));
      build();
    }, 120);

    function build() {
      UI.clear(body);

      body.appendChild(h('div', { class: 'grid grid-3' }, [
        field('Von', UI.dateInput({
          value: trip.from,
          onChange: (e) => { trip.from = e.target.value; trip.days = []; recalc(); }
        })),
        field('Bis', UI.dateInput({
          value: trip.to,
          onChange: (e) => { trip.to = e.target.value; trip.days = []; recalc(); }
        })),
        field('Gefahrene Kilometer', UI.input({
          type: 'number', class: 'num', value: String(trip.kilometers || ''),
          placeholder: '0',
          onInput: (e) => { trip.kilometers = Number(e.target.value) || 0; recalc(); }
        }), 'Hin und zurück, eigener Wagen')
      ]));

      body.appendChild(h('div', { class: 'grid grid-2' }, [
        field('Anlass', UI.input({
          value: trip.description,
          placeholder: 'z. B. Kundentermin Hamburg',
          onInput: (e) => { trip.description = e.target.value; }
        })),
        field('Projekt', select(
          [{ value: '', label: 'ohne' }, ...app.data.projects.map((p) => ({ value: p.id, label: p.name }))],
          trip.projectId || '',
          { onChange: (e) => { trip.projectId = e.target.value || null; } }
        ))
      ]));

      if (trip.days.length) {
        body.appendChild(h('div', { class: 'travel-days' }, trip.days.map((day, index) => {
          const computed = preview ? preview.days[index] : null;

          return h('div', { class: 'travel-day' }, [
            h('div', { class: 'travel-date' }, fmt.date(day.date)),
            select(KINDS, day.kind, {
              class: 'small',
              onChange: (e) => { trip.days[index].kind = e.target.value; recalc(); }
            }),
            h('div', { class: 'travel-meals' }, [
              checkbox('Frühstück', day.breakfast, (v) => { trip.days[index].breakfast = v; recalc(); }),
              checkbox('Mittag', day.lunch, (v) => { trip.days[index].lunch = v; recalc(); }),
              checkbox('Abend', day.dinner, (v) => { trip.days[index].dinner = v; recalc(); })
            ]),
            h('div', { class: 'travel-amount' }, computed ? fmt.euro(computed.amount) : '')
          ]);
        })));
      }

      if (preview) {
        body.appendChild(h('div', { class: 'grid grid-3', style: { marginTop: '14px' } }, [
          UI.stat('Verpflegung', fmt.euro(preview.meals), {
            hint: `${preview.dayCount} ${preview.dayCount === 1 ? 'Tag' : 'Tage'}`
          }),
          UI.stat('Fahrt', fmt.euro(preview.mileage), { hint: `${preview.kilometers} km zu 0,30 €` }),
          UI.stat('Zusammen', fmt.euro(preview.total), { tone: 'accent', hint: 'als Betriebsausgabe' })
        ]));
      }

      body.appendChild(note([
        'Gestellte Mahlzeiten kürzen die Pauschale: Frühstück um 20, Mittag- und Abendessen um je 40 Prozent des vollen Tagessatzes. Gekürzt wird immer vom vollen Satz, auch an einem Teiltag.',
        'Aus Pauschalen gibt es keinen Vorsteuerabzug. Die Kilometerpauschale deckt alle Fahrzeugkosten ab; wer sie ansetzt, kann daneben nicht tanken absetzen.'
      ]));
    }

    build();
    recalc();

    UI.modal({
      title: 'Reise abrechnen',
      body,
      wide: true,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const result = UI.unwrap(await window.kontor.travel.book(trip), 'Buchen');
            if (!result) return;
            close();
            UI.toast(`${result.entries.length} Buchungen über ${fmt.euro(result.total)} angelegt.`, 'success');
            if (onDone) onDone();
          }
        }, 'Als Buchungen anlegen')
      ]
    });
  }

  return { open };
})();
