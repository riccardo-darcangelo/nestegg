'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Kleine Werkzeugkiste für die Oberfläche: DOM-Bau, Formatierung, Dialoge.
 * Kein Framework, keine Abhängigkeiten.
 */

const UI = (() => {
  /* --------------------------------------------------------- DOM-Bau */

  /**
   * h('div', { class: 'x', onClick: fn }, [kinder])
   * Werte null, undefined und false werden übersprungen.
   */
  function h(tag, props, children) {
    const node = document.createElement(tag);
    if (props && (typeof props !== 'object' || Array.isArray(props) || props instanceof Node)) {
      children = props;
      props = null;
    }
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, value);
    }
    append(node, children);
    return node;
  }

  function append(parent, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) {
      children.forEach((child) => append(parent, child));
      return;
    }
    parent.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /* --------------------------------------------------------- Formatierung */

  const nf = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmt = {
    money(cents) {
      return nf.format((Number(cents) || 0) / 100);
    },
    euro(cents) {
      return `${nf.format((Number(cents) || 0) / 100)} €`;
    },
    /** Beträge mit Vorzeichen, für Salden. */
    signed(cents) {
      const n = Number(cents) || 0;
      return `${n > 0 ? '+' : ''}${nf.format(n / 100)} €`;
    },
    date(iso) {
      if (!iso) return '';
      const parts = String(iso).split('-');
      return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : String(iso);
    },
    dateShort(iso) {
      if (!iso) return '';
      const parts = String(iso).split('-');
      return parts.length === 3 ? `${parts[2]}.${parts[1]}.` : String(iso);
    },
    quantity(value) {
      const n = Number(value) || 0;
      return Number.isInteger(n) ? String(n) : n.toLocaleString('de-DE', { maximumFractionDigits: 3 });
    },
    percent(value, digits = 1) {
      const n = Number(value);
      if (!Number.isFinite(n)) return '–';
      return `${n.toLocaleString('de-DE', { maximumFractionDigits: digits })} %`;
    }
  };

  /**
   * Betragseingabe zu Cent.
   * Bewusst dieselbe Regel wie im Hauptprozess: das hintere Trennzeichen
   * entscheidet, alles andere ist Gruppierung.
   */
  function parseAmount(input) {
    if (typeof input === 'number') return Math.round(input * 100);
    let s = String(input || '').trim().replace(/[\s €]/g, '');
    if (!s) return 0;
    const negative = s.startsWith('-');
    s = s.replace(/-/g, '');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma > -1) {
      s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    }
    const value = Number.parseFloat(s);
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100) * (negative ? -1 : 1);
  }

  /** Cent als Eingabewert, also ohne Tausenderpunkte. */
  function amountValue(cents) {
    return ((Number(cents) || 0) / 100).toFixed(2).replace('.', ',');
  }

  function todayIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Number(days || 0));
    return d.toISOString().slice(0, 10);
  }

  /* --------------------------------------------------------- Formularfelder */

  /**
   * Verbindet Beschriftung und Feld.
   *
   * Ohne diese Verbindung ist ein Feld für eine Sprachausgabe namenlos: sie
   * sagt "Eingabefeld" und sonst nichts, denn die Beschriftung daneben ist
   * für sie nur Text, der zufällig in der Nähe steht. WCAG 1.3.1 und 4.1.2
   * verlangen deshalb eine ausgewiesene Zuordnung, und die entsteht hier
   * einmal für jedes Feld der App statt an hundert einzelnen Stellen.
   *
   * Der Hilfetext darunter wird über aria-describedby angehängt: er wird dann
   * nach dem Namen vorgelesen, statt verloren zu gehen.
   */
  let feldZaehler = 0;

  /** Findet das eigentliche Bedienelement in dem, was field() bekommt. */
  function controlIn(node) {
    if (!node || !node.tagName) return null;
    if (/^(input|select|textarea)$/i.test(node.tagName)) return node;
    return node.querySelector ? node.querySelector('input, select, textarea') : null;
  }

  function field(label, control, help) {
    const steuer = controlIn(control);
    const kennung = steuer ? (steuer.id || `feld-${(feldZaehler += 1)}`) : null;
    if (steuer && !steuer.id) steuer.id = kennung;

    let hilfeId = null;
    if (steuer && help) {
      hilfeId = `${kennung}-hilfe`;
      // Eine bereits gesetzte Beschreibung bleibt stehen, sie ist dann Absicht.
      if (!steuer.getAttribute('aria-describedby')) steuer.setAttribute('aria-describedby', hilfeId);
    }

    if (steuer && label) {
      // Ein aus dem Platzhalter abgeleiteter Notname weicht der echten
      // Beschriftung: sonst gewänne der Notname, weil aria-label vorgeht.
      if (steuer.dataset.autoLabel) {
        steuer.removeAttribute('aria-label');
        delete steuer.dataset.autoLabel;
      }
    }

    return h('div', { class: 'field' }, [
      // "for", nicht "htmlFor": h() setzt unbekannte Schlüssel als Attribut,
      // und das Attribut heißt for.
      label ? h('label', kennung ? { for: kennung } : null, label) : null,
      control,
      help ? h('div', { class: 'help', id: hilfeId }, help) : null
    ]);
  }

  /**
   * Gibt einem Feld einen Notnamen aus seinem Platzhalter.
   *
   * Ein Platzhalter ist kein Ersatz für eine Beschriftung, er verschwindet ja
   * beim Tippen. Für die Sprachausgabe ist er aber besser als gar nichts, und
   * er greift nur dort, wo kein field() darüberliegt: bei Suchfeldern etwa,
   * die keine sichtbare Beschriftung tragen sollen. Sobald field() das Feld
   * beschriftet, wird der Notname wieder entfernt.
   */
  function withFallbackLabel(node) {
    if (node.getAttribute('aria-label') || node.getAttribute('aria-labelledby')) return node;
    const platzhalter = node.getAttribute('placeholder');
    if (!platzhalter) return node;
    node.setAttribute('aria-label', platzhalter);
    node.dataset.autoLabel = '1';
    return node;
  }

  function input(props = {}) {
    return withFallbackLabel(h('input', { type: 'text', ...props }));
  }

  function amountInput(props = {}) {
    return withFallbackLabel(h('input', { type: 'text', class: 'amount', inputmode: 'decimal', placeholder: '0,00', ...props }));
  }

  function dateInput(props = {}) {
    return h('input', { type: 'date', ...props });
  }

  function select(options, value, props = {}) {
    const node = h('select', props);
    for (const option of options) {
      const opt = h('option', { value: option.value }, option.label);
      if (String(option.value) === String(value)) opt.selected = true;
      if (option.disabled) opt.disabled = true;
      node.appendChild(opt);
    }
    return node;
  }

  function checkbox(label, checked, onChange) {
    const box = h('input', { type: 'checkbox', onChange: (e) => onChange(e.target.checked) });
    box.checked = Boolean(checked);
    return h('label', { class: 'check' }, [box, h('span', label)]);
  }

  /**
   * Eine Tabellenzeile, die sich anklicken lässt, auch ohne Maus.
   *
   * Eine Zeile mit onClick ist für die Tastatur nicht vorhanden: sie lässt
   * sich nicht anspringen und nicht auslösen, und damit ist der Weg, den sie
   * öffnet, für manche Nutzer schlicht zu. WCAG 2.1.1 verlangt, dass alles
   * Bedienbare auch mit der Tastatur bedienbar ist.
   *
   * Die Zeile bleibt dabei eine Zeile. Ihr eine Knopf-Rolle zu geben wäre
   * bequemer, nähme einer Sprachausgabe aber die Tabellenstruktur: Spalte,
   * Zeile und Überschrift gingen verloren.
   */
  function clickableRow(props, children) {
    const klick = props.onClick;
    return h('tr', {
      ...props,
      class: `clickable ${props.class || ''}`.trim(),
      tabindex: '0',
      onKeydown: (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        klick(e);
      }
    }, children);
  }

  function segmented(options, value, onChange) {
    const wrap = h('div', { class: 'seg' });
    for (const option of options) {
      const active = String(option.value) === String(value);
      wrap.appendChild(
        h('button', {
          type: 'button',
          class: `${active ? 'active' : ''} ${option.tone || ''}`.trim(),
          onClick: () => onChange(option.value)
        }, option.label)
      );
    }
    return wrap;
  }

  /* --------------------------------------------------------- Bausteine */

  function panel(title, content, options = {}) {
    return h('section', { class: 'panel' }, [
      title || options.actions
        ? h('div', { class: 'panel-head' }, [
            h('div', [
              h('h2', { class: 'panel-title' }, title),
              options.note ? h('div', { class: 'panel-note' }, options.note) : null
            ]),
            options.actions ? h('div', { class: 'page-actions' }, options.actions) : null
          ])
        : null,
      content
    ]);
  }

  function stat(label, value, options = {}) {
    return h('div', { class: `stat ${options.tone || ''}`.trim() }, [
      h('div', { class: 'stat-label' }, label),
      h('div', { class: 'stat-value' }, value),
      options.hint ? h('div', { class: 'stat-hint' }, options.hint) : null
    ]);
  }

  function table(columns, rows, options = {}) {
    const head = h('tr', columns.map((col) =>
      h('th', { class: col.num ? 'num' : null, style: col.width ? { width: col.width } : null }, col.label)
    ));
    const body = h('tbody', rows);
    return h('div', { class: options.flush === false ? null : 'table-wrap' }, [
      h('table', [h('thead', head), body])
    ]);
  }

  function empty(title, hint, action) {
    return h('div', { class: 'empty' }, [
      h('div', { class: 'empty-title' }, title),
      hint ? h('div', { class: 'small' }, hint) : null,
      action ? h('div', { style: { marginTop: '16px' } }, action) : null
    ]);
  }

  function note(text, tone) {
    const content = Array.isArray(text)
      ? h('ul', text.map((line) => h('li', line)))
      : text;
    return h('div', { class: `note ${tone || ''}`.trim() }, content);
  }

  /* --------------------------------------------------------- Dialog */

  /** Was sich in einem Dialog anspringen lässt. */
  const FOKUSSIERBAR = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

  let dialogZaehler = 0;

  /**
   * Ein Dialog, der die Tastatur nicht verliert.
   *
   * Drei Dinge, die ein Dialog können muss und die keine Kür sind:
   *
   *   Der Fokus springt beim Öffnen hinein. Sonst steht man nach dem Öffnen
   *   irgendwo dahinter und weiß nicht, dass etwas aufgegangen ist.
   *
   *   Der Fokus bleibt drin, solange der Dialog offen ist. Tabbt man heraus,
   *   bedient man die Seite dahinter blind, die für die Maus längst gesperrt
   *   ist. Der Umlauf am Ende ist deshalb kein Käfig, sondern das Gegenteil
   *   einer Falle: es gibt immer Escape.
   *
   *   Der Fokus kehrt beim Schließen dorthin zurück, wo er herkam. Sonst
   *   landet man wieder am Anfang der Seite.
   *
   * Dazu die Auszeichnung als Dialog, damit eine Sprachausgabe ihn als
   * solchen ankündigt und seinen Titel nennt.
   */
  function modal({ title, body, actions, wide, onClose }) {
    const root = document.getElementById('modal-root');
    const vorher = document.activeElement;
    const titelId = `dialog-titel-${(dialogZaehler += 1)}`;

    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      clear(root);
      // Zurück zum Auslöser, falls es ihn noch gibt.
      if (vorher && vorher.isConnected && typeof vorher.focus === 'function') vorher.focus();
      if (onClose) onClose();
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;

      const ziele = [...overlay.querySelectorAll(FOKUSSIERBAR)].filter((el) => el.offsetParent !== null);
      if (!ziele.length) return;
      const erste = ziele[0];
      const letzte = ziele[ziele.length - 1];

      if (!overlay.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? letzte : erste).focus();
      } else if (e.shiftKey && document.activeElement === erste) {
        e.preventDefault();
        letzte.focus();
      } else if (!e.shiftKey && document.activeElement === letzte) {
        e.preventDefault();
        erste.focus();
      }
    };
    // In der Erfassungsphase, damit ein Feld die Taste nicht vorher abfängt.
    document.addEventListener('keydown', onKey, true);

    const overlay = h('div', {
      class: 'overlay',
      onClick: (e) => { if (e.target === overlay) close(); }
    }, [
      h('div', {
        class: `modal ${wide ? 'wide' : ''}`.trim(),
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titelId
      }, [
        h('div', { class: 'modal-head' }, [
          h('h2', { class: 'modal-title', id: titelId }, title),
          h('button', { class: 'close-x', onClick: close, 'aria-label': 'Dialog schließen' }, '×')
        ]),
        h('div', { class: 'modal-body' }, body),
        actions ? h('div', { class: 'modal-foot' }, actions(close)) : null
      ])
    ]);

    clear(root).appendChild(overlay);

    // Das erste Eingabefeld, sonst der erste Knopf, sonst der Dialog selbst.
    const zuerst = overlay.querySelector('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
      || overlay.querySelector(FOKUSSIERBAR);
    if (zuerst) zuerst.focus();
    return close;
  }

  function confirm(message, { title = 'Bitte bestätigen', confirmLabel = 'Ja, weiter', danger = false } = {}) {
    return new Promise((resolve) => {
      // Die Antwort wird gemerkt und erst beim Schließen gemeldet. close()
      // ruft selbst onClose auf: ein resolve danach bliebe wirkungslos, und
      // genau daran kam aus jedem Bestätigen ein Nein zurück.
      let answer = false;
      modal({
        title,
        body: h('p', { style: { margin: 0 } }, message),
        actions: (close) => [
          h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
          h('button', {
            class: `btn ${danger ? 'danger' : 'primary'}`,
            onClick: () => { answer = true; close(); }
          }, confirmLabel)
        ],
        onClose: () => resolve(answer)
      });
    });
  }

  /* --------------------------------------------------------- Toast */

  function toast(message, tone = '') {
    const host = document.getElementById('toasts');
    const node = h('div', { class: `toast ${tone}`.trim() }, message);
    host.appendChild(node);
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transition = 'opacity 0.2s';
      setTimeout(() => node.remove(), 220);
    }, tone === 'error' ? 6500 : 3600);
  }

  /**
   * Nimmt eine IPC-Antwort entgegen, zeigt den Fehler an und liefert die Daten.
   * Fehlerfall: null.
   */
  function unwrap(result, errorPrefix) {
    if (!result) return null;
    if (result.ok) return result.data;
    toast(`${errorPrefix ? `${errorPrefix}: ` : ''}${result.error}`, 'error');
    return null;
  }

  function debounce(fn, delay = 160) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  return {
    h, append, clear, fmt, parseAmount, amountValue, todayIso, addDays,
    field, input, amountInput, dateInput, select, checkbox, segmented,
    clickableRow,
    panel, stat, table, empty, note, modal, confirm, toast, unwrap, debounce
  };
})();

window.UI = UI;
window.Views = window.Views || {};
