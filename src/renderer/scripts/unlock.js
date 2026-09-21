'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Der Sperrbildschirm.
 *
 * Eigenständig, ohne ui.js: dieses Fenster läuft, bevor irgendetwas
 * entschlüsselt ist, und soll so wenig Code wie möglich mitbringen. Es kennt
 * fünf Schritte, und immer nur einen davon:
 *
 *   einrichten   Passwort setzen, Ordner wählen
 *   schluessel   den Wiederherstellungsschlüssel zeigen und wegschreiben
 *   entsperren   Passwort eingeben
 *   retten       Wiederherstellungsschlüssel eingeben
 *   neusetzen    nach der Rettung sofort ein neues Passwort
 */

(function unlockScreen() {
  const root = document.getElementById('lock');

  /* ------------------------------------------------------- Bausteine */

  function h(tag, props, children) {
    const node = document.createElement(tag);
    if (props && (typeof props !== 'object' || Array.isArray(props) || props instanceof Node)) {
      children = props;
      props = null;
    }
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children == null ? [] : children)) {
      if (child == null || child === false) continue;
      node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  /**
   * Beschriftung und Feld, verbunden.
   *
   * Dieselbe Regel wie in ui.js: ohne for und id ist ein Feld für eine
   * Sprachausgabe namenlos, und ausgerechnet hier steht das Passwortfeld.
   */
  let feldZaehler = 0;

  function field(label, control, help) {
    const kennung = `sperre-feld-${(feldZaehler += 1)}`;
    if (control && /^(input|select|textarea)$/i.test(control.tagName)) control.id = kennung;
    const hilfeId = help ? `${kennung}-hilfe` : null;
    if (hilfeId && control.setAttribute) control.setAttribute('aria-describedby', hilfeId);

    return h('div', { class: 'field' }, [
      h('label', { for: kennung }, label),
      control,
      help ? h('div', { class: 'help', id: hilfeId }, help) : null
    ]);
  }

  function toast(message, tone) {
    const host = document.getElementById('toasts');
    const node = h('div', { class: `toast ${tone || ''}`.trim() }, message);
    host.appendChild(node);
    setTimeout(() => node.remove(), tone === 'error' ? 6000 : 3200);
  }

  /** Setzt den Kartentext auf eine Fehlermeldung, ohne den Rest neu zu bauen. */
  function showError(message) {
    const old = root.querySelector('.lock-note.error');
    if (old) old.remove();
    root.querySelector('.lock-card').appendChild(
      h('div', { class: 'lock-note error', role: 'alert' }, message)
    );
  }

  function clearError() {
    const old = root.querySelector('.lock-note.error');
    if (old) old.remove();
  }

  /** Zeigt eine Karte. Immer nur eine, immer komplett neu. */
  function render(title, text, body, actions, extras) {
    root.replaceChildren(
      h('div', { class: 'lock-mark' }, 'NestEgg'),
      h('div', { class: 'lock-sub' }, 'Buchhaltung, die auf deinem Rechner bleibt'),
      h('div', { class: 'lock-card' }, [
        h('h1', { class: 'lock-title' }, title),
        text ? h('p', { class: 'lock-text' }, text) : null,
        ...[].concat(body || []),
        actions ? h('div', { class: 'lock-actions' }, actions) : null,
        ...[].concat(extras || [])
      ].filter(Boolean))
    );
  }

  /** Sperrt die Knöpfe, solange die Ableitung läuft. Sie dauert spürbar. */
  function busy(on, label) {
    for (const btn of root.querySelectorAll('button')) btn.disabled = on;
    const old = root.querySelector('.lock-busy');
    if (old) old.remove();
    if (!on) return;
    root.querySelector('.lock-actions').replaceChildren(
      h('div', { class: 'lock-busy' }, [h('div', { class: 'lock-spinner' }), label || 'Einen Moment …'])
    );
  }

  /* ------------------------------------------------- Passwortfelder */

  /**
   * Ein Passwortfeld mit Güteanzeige.
   *
   * Die Einschätzung kommt aus dem Hauptprozess, damit die Regel an genau
   * einer Stelle steht: dieselbe, die das Passwort später auch annimmt oder
   * ablehnt.
   */
  function passwordField(label, help, onEnter) {
    const anzeige = h('div', {
      class: 'strength',
      dataset: { level: 'empty' },
      // Der Balken allein ist eine Farbe. Was er bedeutet, steht daneben,
      // und das wird beim Tippen mitgesprochen.
      role: 'status',
      'aria-live': 'polite'
    }, [
      h('div', { class: 'strength-track', 'aria-hidden': 'true' }, h('div', { class: 'strength-fill' })),
      h('div', { class: 'strength-label' }, 'Noch nichts eingegeben')
    ]);

    const input = h('input', {
      type: 'password',
      autocomplete: 'new-password',
      spellcheck: false,
      onInput: async () => {
        clearError();
        const res = await window.schloss.strength(input.value);
        if (!res.ok) return;
        anzeige.dataset.level = res.data.level;
        anzeige.querySelector('.strength-label').textContent = res.data.label;
      },
      onKeydown: (e) => { if (e.key === 'Enter' && onEnter) onEnter(); }
    });

    return { input, nodes: [field(label, input, help), anzeige] };
  }

  /* --------------------------------------------------- Die Schritte */

  /** Erster Start: Ordner bestätigen, Passwort setzen. */
  function screenSetup(state) {
    const pass = passwordField(
      'Passwort',
      'Mindestens zwölf Zeichen. Ein Satz, den nur du kennst, ist besser als ein kurzes Kunstwort.',
      () => weiter()
    );
    const wieder = h('input', {
      type: 'password',
      autocomplete: 'new-password',
      spellcheck: false,
      onKeydown: (e) => { if (e.key === 'Enter') weiter(); }
    });
    // Nicht vorangekreuzt: gefragt wird beim Start, und wer das abstellen will,
    // soll es bewusst tun statt es zu übersehen.
    const merken = h('input', { type: 'checkbox' });

    async function weiter() {
      clearError();
      if (pass.input.value !== wieder.value) return showError('Die beiden Passwörter sind nicht gleich.');

      busy(true, 'Schlüssel werden erzeugt …');
      const res = await window.schloss.setup(pass.input.value, merken.checked);
      if (!res.ok) { busy(false); screenSetup(state); return showError(res.error); }
      screenRecoveryKey(res.data.recoveryKey, 'setup');
    }

    render(
      'Buchhaltung schützen',
      'Deine Buchführung wird verschlüsselt auf der Platte abgelegt. Ohne dieses Passwort kommt niemand an Umsätze, Kunden, Kontoverbindungen oder Belege, auch nicht, wer die Dateien kopiert.',
      [
        ...pass.nodes,
        field('Passwort wiederholen', wieder),
        state.canRemember
          ? h('label', { class: 'check' }, [merken, h('span', 'An diesem Rechner merken, dann entfällt die Eingabe beim Start')])
          : h('div', { class: 'lock-note' }, 'Dieses System kann kein Passwort für dich verwahren, es wird bei jedem Start gefragt.')
      ],
      [
        h('button', { class: 'btn primary', onClick: weiter }, 'Verschlüsselung einrichten'),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'lock-link',
          onClick: async () => {
            const res = await window.schloss.skip();
            if (!res.ok) showError(res.error);
          }
        }, 'Ohne Schutz fortfahren')
      ],
      dirRow(state)
    );
    pass.input.focus();
  }

  /** Die Zeile mit dem Speicherort, samt Wechsel. */
  function dirRow(state) {
    if (!state.dir) return null;
    return h('div', { class: 'lock-dir' }, [
      h('span', 'Speicherort'),
      h('code', state.dir),
      h('button', {
        class: 'lock-link',
        onClick: async () => {
          const res = await window.schloss.chooseDir();
          if (!res.ok) return showError(res.error);
          if (res.data) start();
        }
      }, 'ändern')
    ]);
  }

  /**
   * Der Wiederherstellungsschlüssel.
   *
   * Der einzige Bildschirm, den man nicht überspringen darf. Er wird genau
   * einmal gezeigt: gespeichert ist er nirgends, auch nicht verschlüsselt.
   */
  function screenRecoveryKey(recoveryKey, herkunft) {
    let gesichert = false;
    const bestaetigt = h('input', {
      type: 'checkbox',
      onChange: () => { fertig.disabled = !bestaetigt.checked; }
    });

    const fertig = h('button', {
      class: 'btn primary',
      disabled: true,
      onClick: async () => {
        const res = await window.schloss.finish();
        if (!res.ok) showError(res.error);
      }
    }, herkunft === 'setup' ? 'Fertig, App öffnen' : 'Fertig');

    render(
      'Wiederherstellungsschlüssel',
      'Das ist dein Ersatzweg, wenn du das Passwort vergisst. Schreibe ihn ab oder drucke ihn aus und verwahre ihn getrennt vom Rechner, etwa im Ordner mit den Steuerunterlagen.',
      [
        h('div', { class: 'recovery-key' }, recoveryKey),
        h('div', { class: 'lock-note' }, [
          h('strong', 'Dieser Schlüssel wird nur einmal gezeigt. '),
          'NestEgg speichert ihn nirgends. Ohne Passwort und ohne diesen Schlüssel sind die Daten endgültig verloren, und die Aufbewahrungspflicht nach §147 AO läuft zehn Jahre.'
        ]),
        h('label', { class: 'check', style: 'margin-top:16px' }, [
          bestaetigt,
          h('span', 'Ich habe den Schlüssel notiert oder ausgedruckt')
        ])
      ],
      [
        h('button', {
          class: 'btn',
          onClick: async () => {
            const res = await window.schloss.printRecoveryKey(recoveryKey);
            if (!res.ok) return showError(res.error);
            if (res.data) { gesichert = true; toast(`Gespeichert: ${res.data}`, 'success'); }
          }
        }, 'Als PDF sichern'),
        h('div', { class: 'spacer' }),
        fertig
      ]
    );
  }

  /** Der Normalfall: Passwort eingeben. */
  function screenUnlock(state) {
    const input = h('input', {
      type: 'password',
      autocomplete: 'current-password',
      spellcheck: false,
      onInput: clearError,
      onKeydown: (e) => { if (e.key === 'Enter') oeffnen(); }
    });
    const merken = h('input', { type: 'checkbox' });

    async function oeffnen() {
      clearError();
      if (!input.value) return showError('Bitte das Passwort eingeben.');

      busy(true, 'Wird geprüft …');
      const res = await window.schloss.unlock(input.value, merken.checked);
      if (!res.ok) {
        screenUnlock(state);
        return showError(res.error);
      }
      // Bei Erfolg übernimmt der Hauptprozess und schließt dieses Fenster.
    }

    render(
      'Entsperren',
      null,
      [
        field('Passwort', input),
        state.canRemember
          ? h('label', { class: 'check' }, [merken, h('span', 'An diesem Rechner merken')])
          : null
      ].filter(Boolean),
      [
        h('button', { class: 'btn primary', onClick: oeffnen }, 'Öffnen'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'lock-link', onClick: () => screenRecover(state) }, 'Passwort vergessen')
      ],
      dirRow(state)
    );
    input.focus();
  }

  /** Der Ersatzweg. */
  function screenRecover(state) {
    const input = h('input', {
      type: 'text',
      spellcheck: false,
      autocapitalize: 'characters',
      placeholder: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ23',
      onInput: clearError,
      onKeydown: (e) => { if (e.key === 'Enter') retten(); }
    });

    async function retten() {
      clearError();
      busy(true, 'Wird geprüft …');
      const res = await window.schloss.recover(input.value);
      if (!res.ok) {
        screenRecover(state);
        input.value = '';
        return showError(res.error);
      }
      screenReset(state);
    }

    render(
      'Wiederherstellung',
      'Gib den Wiederherstellungsschlüssel ein, den du beim Einrichten ausgedruckt hast. Groß- und Kleinschreibung sowie die Bindestriche sind egal.',
      [field('Wiederherstellungsschlüssel', input)],
      [
        h('button', { class: 'btn primary', onClick: retten }, 'Weiter'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'lock-link', onClick: () => screenUnlock(state) }, 'Zurück')
      ]
    );
    input.focus();
  }

  /** Nach der Rettung sofort ein neues Passwort, sonst bleibt das alte Loch. */
  function screenReset(state) {
    const pass = passwordField('Neues Passwort', 'Mindestens zwölf Zeichen.', () => setzen());
    const wieder = h('input', {
      type: 'password',
      autocomplete: 'new-password',
      onKeydown: (e) => { if (e.key === 'Enter') setzen(); }
    });
    // Nicht vorangekreuzt: gefragt wird beim Start, und wer das abstellen will,
    // soll es bewusst tun statt es zu übersehen.
    const merken = h('input', { type: 'checkbox' });

    async function setzen() {
      clearError();
      if (pass.input.value !== wieder.value) return showError('Die beiden Passwörter sind nicht gleich.');

      busy(true, 'Wird gesetzt …');
      const res = await window.schloss.resetPassword(pass.input.value, merken.checked);
      if (!res.ok) { screenReset(state); return showError(res.error); }
      screenRecoveryKey(res.data.recoveryKey, 'reset');
    }

    render(
      'Neues Passwort',
      'Der Bestand ist offen. Vergib jetzt ein neues Passwort. Danach bekommst du einen neuen Wiederherstellungsschlüssel, der alte gilt dann nicht mehr.',
      [
        ...pass.nodes,
        field('Passwort wiederholen', wieder),
        state.canRemember
          ? h('label', { class: 'check' }, [merken, h('span', 'An diesem Rechner merken')])
          : null
      ].filter(Boolean),
      [h('button', { class: 'btn primary', onClick: setzen }, 'Passwort setzen')]
    );
    pass.input.focus();
  }

  /* ------------------------------------------------------------ Start */

  async function start() {
    const res = await window.schloss.state();
    const state = res.data || {};
    if (state.mode === 'setup') screenSetup(state);
    else screenUnlock(state);
  }

  start();
}());
