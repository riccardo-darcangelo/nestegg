'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Aussehen der Dokumente.
 *
 * Links die Regler, rechts das Dokument, wie es gedruckt aussieht. Gerendert
 * wird mit derselben Funktion wie das PDF, deshalb ist die Vorschau kein
 * Näherungswert, sondern das Ergebnis.
 *
 * Beim Schieben eines Reglers wird nur das Stylesheet im Vorschaufenster
 * ausgetauscht. Ein vollständiger Neuaufbau würde springen und flackern.
 */
window.Views.design = function designView(app) {
  const { h, field, select, checkbox } = UI;

  const state = app.state.design || (app.state.design = {
    theme: JSON.parse(JSON.stringify(app.settings.theme)),
    documentType: 'invoice',
    zoom: 0.62,
    dirty: false
  });

  // Nach einem Wechsel der Ansicht soll der gespeicherte Stand gelten.
  if (!state.dirty) state.theme = JSON.parse(JSON.stringify(app.settings.theme));

  const root = h('div');
  let frame = null;
  let frameReady = false;
  let sheetWrap = null;
  // Muss vor dem ersten render() stehen, sonst greift die erste Vorschau
  // auf eine noch nicht ausgewertete Deklaration zu.
  let previewTimer = null;

  // A4 in Bildpunkten bei 96 dpi. Die Seite wird skaliert, ihre Layoutbox
  // bleibt dabei unverändert groß, deshalb wird der Rahmen mitgerechnet.
  const PAGE_W = 794;
  const PAGE_H = 1123;

  render();
  return root;

  function render() {
    UI.clear(root);

    root.appendChild(app.pageHead(
      'Aussehen der Dokumente',
      'Gilt für Rechnungen, Stornos, Angebote und Kostenvoranschläge. Der Aufbau folgt DIN 5008, damit die Anschrift im Sichtfenster steht. Einstellbar ist alles, was sich ändern lässt, ohne diesen Aufbau zu zerstören.',
      [
        h('button', {
          class: 'btn ghost',
          onClick: async () => {
            const ok = await UI.confirm('Alle Gestaltungseinstellungen auf den Auslieferungszustand zurücksetzen?', {
              title: 'Zurücksetzen', confirmLabel: 'Zurücksetzen', danger: true
            });
            if (!ok) return;
            const fresh = UI.unwrap(await window.kontor.theme.reset(), 'Zurücksetzen');
            if (!fresh) return;
            state.theme = JSON.parse(JSON.stringify(fresh));
            state.dirty = false;
            await app.refresh();
            app.navigate('design');
          }
        }, 'Zurücksetzen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const saved = UI.unwrap(await window.kontor.theme.save(state.theme), 'Speichern');
            if (!saved) return;
            state.theme = JSON.parse(JSON.stringify(saved));
            state.dirty = false;
            UI.toast('Aussehen gespeichert. Es gilt ab sofort für alle neuen PDFs.', 'success');
            app.refresh();
          }
        }, 'Speichern')
      ]
    ));

    const layout = h('div', { class: 'design-layout' }, [
      h('div', { class: 'design-controls' }, controls()),
      h('div', { class: 'design-preview' }, previewPane())
    ]);
    root.appendChild(layout);

    refreshPreview(true);
    // Erst nach dem Einhaengen steht die Breite der Buehne fest.
    requestAnimationFrame(fitZoom);
  }

  /* --------------------------------------------------------- Vorschau */

  function previewPane() {
    frame = h('iframe', { src: 'doc-frame.html', title: 'Dokumentvorschau', class: 'doc-frame' });
    frameReady = false;
    frame.addEventListener('load', () => { frameReady = true; });

    sheetWrap = h('div', { class: 'doc-scaler' }, frame);

    return [
      h('div', { class: 'design-preview-bar' }, [
        UI.segmented(
          Object.entries(app.boot.documentTypes).map(([id, type]) => ({ value: id, label: type.label })),
          state.documentType,
          (value) => { state.documentType = value; refreshPreview(true); markActiveType(); }
        ),
        h('div', { style: { flex: '1' } }),
        h('div', { class: 'small faint' }, 'Zoom'),
        h('input', {
          type: 'range', min: '40', max: '100', value: String(Math.round(state.zoom * 100)),
          class: 'zoom-range',
          'aria-label': 'Vorschau vergrößern oder verkleinern',
          onInput: (e) => { state.zoom = Number(e.target.value) / 100; applyZoom(); }
        })
      ]),
      h('div', { class: 'doc-stage' }, sheetWrap)
    ];
  }

  function markActiveType() {
    // Die Leiste wird bei jedem Wechsel neu gezeichnet, damit die Auswahl sitzt.
    const bar = root.querySelector('.design-preview-bar .seg');
    if (!bar) return;
    [...bar.children].forEach((button, index) => {
      const id = Object.keys(app.boot.documentTypes)[index];
      button.className = id === state.documentType ? 'active' : '';
    });
  }

  function applyZoom() {
    if (!sheetWrap || !frame) return;
    frame.style.transform = `scale(${state.zoom})`;
    frame.style.transformOrigin = 'top left';
    sheetWrap.style.width = `${Math.round(PAGE_W * state.zoom)}px`;
    sheetWrap.style.height = `${Math.round(PAGE_H * state.zoom)}px`;
  }

  /** Beim ersten Anzeigen so weit verkleinern, dass die Seite ganz hineinpasst. */
  function fitZoom() {
    const stage = root.querySelector('.doc-stage');
    if (!stage) return;
    const available = stage.clientWidth - 28;
    if (available > 80) state.zoom = Math.min(0.85, Math.max(0.4, available / PAGE_W));
    const slider = root.querySelector('.zoom-range');
    if (slider) slider.value = String(Math.round(state.zoom * 100));
    applyZoom();
  }

  /**
   * Bewusst eine Funktionsdeklaration: render() läuft vor dieser Stelle und
   * stößt die erste Vorschau an. Eine const käme dafür zu spät.
   */
  function refreshPreview(rebuild) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => runPreview(rebuild), 180);
  }

  async function runPreview(rebuild) {
    const result = UI.unwrap(
      await window.kontor.theme.preview({ theme: state.theme, documentType: state.documentType }),
      'Vorschau'
    );
    if (!result) return;

    state.theme = { ...state.theme, ...result.theme };
    updatePresetHint(result.preset);

    const write = () => {
      const doc = frame.contentDocument;
      if (!doc) return;

      const existingSheet = doc.querySelector('.sheet');
      if (!rebuild && existingSheet) {
        // Nur das Stylesheet tauschen, der Inhalt bleibt stehen.
        const style = doc.querySelector('style');
        if (style) {
          style.textContent = result.css;
          applyZoom();
          return;
        }
      }
      doc.open();
      doc.write(result.html);
      doc.close();
      applyZoom();
    };

    if (frameReady) write();
    else frame.addEventListener('load', () => { frameReady = true; write(); }, { once: true });
  }

  function updatePresetHint(presetId) {
    const hint = root.querySelector('[data-preset-hint]');
    if (!hint) return;
    const preset = app.boot.themePresets.find((p) => p.id === presetId);
    hint.textContent = preset ? preset.hint : 'Eigene Einstellung, von den Vorlagen abgewichen.';
    const cards = root.querySelectorAll('[data-preset]');
    cards.forEach((card) => {
      card.className = card.dataset.preset === presetId ? 'preset-card active' : 'preset-card';
    });
  }

  /** Ändert einen Wert und zieht die Vorschau nach. */
  function set(key, value) {
    state.theme[key] = value;
    state.dirty = true;
    refreshPreview(false);
  }

  function setMargin(side, value) {
    state.theme.margins = { ...state.theme.margins, [side]: value };
    state.dirty = true;
    refreshPreview(false);
  }

  /* --------------------------------------------------------- Regler */

  function controls() {
    return [
      UI.panel('Vorlage', h('div', [
        h('div', { class: 'preset-grid' }, app.boot.themePresets.map((preset) =>
          h('button', {
            class: 'preset-card',
            dataset: { preset: preset.id },
            onClick: async () => {
              const applied = UI.unwrap(
                await window.kontor.theme.applyPreset({ theme: state.theme, presetId: preset.id }),
                'Vorlage'
              );
              if (!applied) return;
              state.theme = applied;
              state.dirty = true;
              UI.clear(root);
              render();
            }
          }, [
            h('span', { class: 'preset-dot', dataset: { p: preset.id } }),
            h('span', { class: 'preset-name' }, preset.label)
          ])
        )),
        h('div', { class: 'small faint', style: { marginTop: '10px' }, dataset: { presetHint: '1' } }, '')
      ])),

      UI.panel('Farben', h('div', { class: 'grid grid-2' }, [
        colorField('Akzent', 'accentColor', 'Titel, Summenzeile, Balken'),
        colorField('Text', 'textColor'),
        colorField('Gedämpfter Text', 'mutedColor', 'Beschreibungen und Fußzeile'),
        colorField('Linien', 'lineColor')
      ])),

      UI.panel('Schrift', h('div', [
        field('Schriftart', select(
          app.boot.themeFonts.map((f) => ({ value: f.value, label: f.label })),
          state.theme.fontFamily,
          { onChange: (e) => set('fontFamily', e.target.value) }
        ), 'Nur Schriften, die auf jedem Windows-Rechner vorhanden sind. Fremde Schriften würden im PDF fehlen.'),
        h('div', { class: 'grid grid-3' }, [
          rangeField('Grundgröße', 'fontSize', 8, 14, 0.5, 'pt'),
          rangeField('Zeilenabstand', 'lineHeight', 1.1, 2, 0.05, ''),
          rangeField('Titelgröße', 'titleSize', 11, 28, 1, 'pt')
        ]),
        checkbox('Titel in Akzentfarbe', state.theme.titleAccent, (v) => set('titleAccent', v)),
        checkbox('Titel in Großbuchstaben', state.theme.titleUppercase, (v) => set('titleUppercase', v))
      ])),

      UI.panel('Seite und Logo', h('div', [
        h('div', { class: 'grid grid-4' }, [
          rangeField('Rand oben', 'margins.top', 10, 45, 1, 'mm'),
          rangeField('Rand rechts', 'margins.right', 10, 40, 1, 'mm'),
          rangeField('Rand unten', 'margins.bottom', 10, 40, 1, 'mm'),
          rangeField('Rand links', 'margins.left', 15, 45, 1, 'mm')
        ]),
        h('div', { class: 'small faint', style: { margin: '-4px 0 12px' } },
          'Der linke Rand ist nach DIN 5008 breiter, damit Platz zum Abheften bleibt.'),
        h('div', { class: 'grid grid-2' }, [
          field('Logo', select([
            { value: 'right', label: 'Rechts oben' },
            { value: 'left', label: 'Links oben' },
            { value: 'none', label: 'Nicht anzeigen' }
          ], state.theme.logoPosition, { onChange: (e) => set('logoPosition', e.target.value) }),
            app.settings.company.logoPath ? null : 'Noch kein Logo hinterlegt, das geht in den Einstellungen.'),
          rangeField('Logohöhe', 'logoHeight', 8, 40, 1, 'mm')
        ]),
        field('Absenderzeile über der Anschrift', select([
          { value: 'rule', label: 'Mit Trennlinie' },
          { value: 'plain', label: 'Ohne Linie' },
          { value: 'none', label: 'Weglassen' }
        ], state.theme.senderLineStyle, { onChange: (e) => set('senderLineStyle', e.target.value) }),
          'Die kleine Zeile mit der eigenen Anschrift, die im Sichtfenster über der Empfängeradresse steht.'),
        checkbox('Farbiger Balken am linken Seitenrand', state.theme.accentBar, (v) => set('accentBar', v))
      ])),

      UI.panel('Tabelle und Summen', h('div', [
        field('Positionstabelle', select([
          { value: 'lines', label: 'Feine Trennlinien' },
          { value: 'zebra', label: 'Abwechselnd hinterlegt' },
          { value: 'plain', label: 'Ohne Linien' }
        ], state.theme.tableStyle, { onChange: (e) => set('tableStyle', e.target.value) }),
          'Abwechselnd hinterlegt hilft bei langen Positionslisten.'),
        checkbox('Tabellenkopf in Akzentfarbe', state.theme.tableHeaderAccent, (v) => set('tableHeaderAccent', v)),
        checkbox('Endsumme hervorheben', state.theme.totalsHighlight, (v) => set('totalsHighlight', v))
      ])),

      UI.panel('Fußzeile', h('div', [
        checkbox('Fußzeile mit Firmendaten anzeigen', state.theme.showFooter, (v) => set('showFooter', v)),
        field('Zusatztext', h('textarea', {
          value: state.theme.footerNote || '',
          placeholder: 'Etwa Gerichtsstand, Handelsregister oder ein Hinweis zur Aufbewahrung',
          onInput: (e) => set('footerNote', e.target.value)
        }), 'Steht über der Fußzeile, auf jedem Dokument')
      ]))
    ];
  }

  function colorField(label, key, help) {
    const input = h('input', {
      type: 'color',
      value: state.theme[key],
      class: 'color-input',
      onInput: (e) => { set(key, e.target.value); text.value = e.target.value; }
    });
    const text = h('input', {
      type: 'text',
      value: state.theme[key],
      class: 'color-text',
      'aria-label': label + ': Farbwert als Text',
      onInput: (e) => {
        const value = e.target.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(value)) { input.value = value; set(key, value); }
      }
    });
    return field(label, h('div', { class: 'color-row' }, [input, text]), help);
  }

  /** Schieberegler mit Zahlenanzeige. Der Pfad darf verschachtelt sein. */
  function rangeField(label, path, min, max, step, unit) {
    const [group, key] = path.includes('.') ? path.split('.') : [null, path];
    const current = group ? state.theme[group][key] : state.theme[key];
    const readout = h('span', { class: 'range-value' }, `${current}${unit ? ` ${unit}` : ''}`);

    const input = h('input', {
      type: 'range',
      min: String(min), max: String(max), step: String(step),
      value: String(current),
      onInput: (e) => {
        const value = Number(e.target.value);
        readout.textContent = `${value}${unit ? ` ${unit}` : ''}`;
        if (group) setMargin(key, value); else set(key, value);
      }
    });

    // Die Beschriftung wird mit dem Regler verbunden, sonst ist er namenlos.
    const kennung = `regler-${path.replace(/[^a-z0-9]+/gi, "-")}`;
    input.id = kennung;
    return h('div', { class: 'field' }, [
      h('label', { class: 'range-label', for: kennung }, [h('span', label), readout]),
      input
    ]);
  }
};
