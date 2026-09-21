'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Verschlüsselung verwalten.
 *
 * Eigene Datei, nicht in settings.js: hier hängt der Zugang zum gesamten
 * Bestand dran, und was so viel Gewicht hat, soll nicht zwischen
 * Rechnungsvorgaben und Zeiterfassung untergehen.
 *
 * Grundsatz für alle Dialoge hier: nichts Unumkehrbares ohne Passwort, und
 * kein Wiederherstellungsschlüssel, der weggeklickt werden kann, bevor er
 * notiert ist.
 */

window.Security = (function securityView() {
  const { h, field } = UI;

  /** Ein Passwortfeld mit Güteanzeige, dieselbe Regel wie beim Einrichten. */
  function passwordField(label, help) {
    const anzeige = h('div', { class: 'strength', dataset: { level: 'empty' } }, [
      h('div', { class: 'strength-track' }, h('div', { class: 'strength-fill' })),
      h('div', { class: 'strength-label' }, 'Noch nichts eingegeben')
    ]);

    const input = h('input', {
      type: 'password',
      autocomplete: 'new-password',
      spellcheck: false,
      onInput: async () => {
        const s = UI.unwrap(await window.kontor.security.strength(input.value));
        if (!s) return;
        anzeige.dataset.level = s.level;
        anzeige.querySelector('.strength-label').textContent = s.label;
      }
    });

    return { input, nodes: [field(label, input, help), anzeige] };
  }

  function plainPassword() {
    return UI.input({ type: 'password', autocomplete: 'current-password', spellcheck: false });
  }

  /**
   * Zeigt den Wiederherstellungsschlüssel.
   *
   * Nicht wegklickbar, bevor bestätigt ist: das ist die einzige Gelegenheit,
   * ihn zu sehen.
   */
  function showRecoveryKey(recoveryKey, onDone) {
    let close = null;
    const bestaetigt = h('input', {
      type: 'checkbox',
      onChange: () => { fertig.disabled = !bestaetigt.checked; }
    });
    const fertig = h('button', {
      class: 'btn primary',
      disabled: true,
      onClick: () => { close(); if (onDone) onDone(); }
    }, 'Fertig');

    close = UI.modal({
      title: 'Neuer Wiederherstellungsschlüssel',
      body: h('div', [
        UI.note([
          'Schreibe ihn ab oder drucke ihn aus und verwahre ihn getrennt vom Rechner.',
          'Ein früher ausgegebener Schlüssel gilt ab jetzt nicht mehr und gehört vernichtet.'
        ]),
        h('div', { class: 'recovery-key', style: { margin: '14px 0' } }, recoveryKey),
        UI.note(
          'NestEgg speichert diesen Schlüssel nirgends. Ohne Passwort und ohne ihn sind die Daten endgültig verloren.',
          'error'
        ),
        h('label', { class: 'check', style: { marginTop: '14px' } }, [
          bestaetigt,
          h('span', 'Ich habe den Schlüssel notiert oder ausgedruckt')
        ])
      ]),
      actions: () => [
        h('button', {
          class: 'btn',
          onClick: async () => {
            const file = UI.unwrap(await window.kontor.security.printRecoveryKey(recoveryKey), 'Sichern');
            if (file) UI.toast(`Gespeichert: ${file}`, 'success');
          }
        }, 'Als PDF sichern'),
        h('div', { style: { flex: '1' } }),
        fertig
      ],
      // Auch das Schließkreuz darf erst wirken, wenn bestätigt wurde.
      onClose: () => { if (bestaetigt.checked && onDone) onDone(); }
    });
  }

  /**
   * Zeigt, wie weit die Umstellung ist.
   *
   * Bei vielen Belegen dauert das spürbar, und ein Fenster, das einfach steht,
   * sieht aus wie ein Absturz.
   */
  function progressDialog(title) {
    const text = h('div', { class: 'small muted' }, 'Wird vorbereitet …');
    const fill = h('div', { class: 'strength-fill', style: { width: '0%', background: 'var(--accent)' } });

    const close = UI.modal({
      title,
      body: h('div', [
        UI.note('Bitte die App währenddessen nicht schließen. Ein Abbruch ist nicht schlimm, die Umstellung lässt sich fortsetzen, aber sauberer ist es so.'),
        h('div', { class: 'strength-track', style: { margin: '16px 0 8px' } }, fill),
        text
      ]),
      actions: null
    });

    const ab = window.kontor.on('security:progress', (p) => {
      const anteil = p.total ? Math.round((p.done / p.total) * 100) : 100;
      fill.style.width = `${Math.max(4, anteil)}%`;
      text.textContent = p.total
        ? `${p.step}: ${p.done} von ${p.total}`
        : `${p.step} …`;
    });

    return () => { ab(); close(); };
  }

  /* --------------------------------------------------- Einrichten */

  function enable(app, onDone) {
    const pass = passwordField('Passwort', 'Mindestens zwölf Zeichen. Ein Satz ist besser als ein kurzes Kunstwort.');
    const wieder = UI.input({ type: 'password', autocomplete: 'new-password' });
    // Nicht vorangekreuzt, siehe unlock.js: die sicherere Vorgabe gewinnt.
    const merken = h('input', { type: 'checkbox' });

    const close = UI.modal({
      title: 'Verschlüsselung einrichten',
      body: h('div', [
        UI.note([
          'Buchungsdatei, Belege, Sicherungen und das Änderungsprotokoll werden verschlüsselt. Danach kommt ohne Passwort niemand mehr an die Daten, auch nicht, wer die Dateien kopiert.',
          'Die Exporte für Kanzlei und Betriebsprüfung bleiben offen lesbar. Dafür sind sie gedacht.'
        ]),
        h('div', { style: { marginTop: '14px' } }, pass.nodes),
        field('Passwort wiederholen', wieder),
        app.security.canRemember
          ? h('label', { class: 'check' }, [merken, h('span', 'An diesem Rechner merken, dann entfällt die Eingabe beim Start')])
          : UI.note('Dieses System kann kein Passwort verwahren, es wird bei jedem Start gefragt.', 'warn')
      ]),
      actions: (schliessen) => [
        h('button', { class: 'btn ghost', onClick: schliessen }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (pass.input.value !== wieder.value) return UI.toast('Die beiden Passwörter sind nicht gleich.', 'error');

            schliessen();
            const fertig = progressDialog('Bestand wird verschlüsselt');
            const res = UI.unwrap(await window.kontor.security.enable(pass.input.value, merken.checked), 'Verschlüsseln');
            fertig();
            if (!res) return;

            if (res.failed && res.failed.length) {
              UI.toast(`${res.failed.length} Beleg(e) konnten nicht umgestellt werden.`, 'error');
            }
            showRecoveryKey(res.recoveryKey, onDone);
          }
        }, 'Verschlüsseln')
      ]
    });
    pass.input.focus();
  }

  /* ------------------------------------------------ Passwort ändern */

  function changePassword(app) {
    const alt = plainPassword();
    const neu = passwordField('Neues Passwort', 'Mindestens zwölf Zeichen.');
    const wieder = UI.input({ type: 'password', autocomplete: 'new-password' });

    UI.modal({
      title: 'Passwort ändern',
      body: h('div', [
        field('Bisheriges Passwort', alt),
        h('div', { style: { marginTop: '14px' } }, neu.nodes),
        field('Neues Passwort wiederholen', wieder),
        UI.note('Der Wiederherstellungsschlüssel bleibt gültig. Die Daten selbst werden nicht neu geschrieben, nur das Schloss.')
      ]),
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            if (neu.input.value !== wieder.value) return UI.toast('Die beiden Passwörter sind nicht gleich.', 'error');
            const ok = UI.unwrap(await window.kontor.security.changePassword(alt.value, neu.input.value), 'Passwort ändern');
            if (!ok) return;
            close();
            UI.toast('Passwort geändert.', 'success');
          }
        }, 'Ändern')
      ]
    });
    alt.focus();
  }

  /* ------------------------------------- Wiederherstellung erneuern */

  function newRecoveryKey(app, onDone) {
    const pass = plainPassword();

    UI.modal({
      title: 'Neuen Wiederherstellungsschlüssel erzeugen',
      body: h('div', [
        UI.note([
          'Sinnvoll, wenn der Ausdruck verloren gegangen sein könnte oder in fremde Hände geraten ist.',
          'Der bisherige Schlüssel verliert damit sofort seine Gültigkeit.'
        ], 'warn'),
        field('Passwort zur Bestätigung', pass)
      ]),
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const res = UI.unwrap(await window.kontor.security.newRecoveryKey(pass.value), 'Erneuern');
            if (!res) return;
            close();
            showRecoveryKey(res.recoveryKey, onDone);
          }
        }, 'Erzeugen')
      ]
    });
    pass.focus();
  }

  /* ---------------------------------------------- Schutz abschalten */

  function disable(app, onDone) {
    const pass = plainPassword();

    UI.modal({
      title: 'Verschlüsselung aufheben',
      body: h('div', [
        UI.note([
          'Danach liegen Buchungen, Kunden, Kontoverbindungen und alle Belege wieder offen auf der Platte. Jeder, der an den Ordner kommt, kann sie lesen.',
          `Betroffen sind ${app.security.receipts} Belegdatei(en) und der gesamte Bestand.`,
          'Nach Art. 32 DSGVO gehört Verschlüsselung zu den Maßnahmen, mit denen personenbezogene Daten zu schützen sind. In der Buchhaltung stehen Namen, Anschriften und Bankverbindungen deiner Kunden.'
        ], 'error'),
        field('Passwort zur Bestätigung', pass)
      ]),
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn danger',
          onClick: async () => {
            const sicher = await UI.confirm(
              'Die Verschlüsselung wird aufgehoben und der Schlüsselbund gelöscht. Fortfahren?',
              { title: 'Wirklich aufheben?', confirmLabel: 'Aufheben', danger: true }
            );
            if (!sicher) return;

            close();
            const fertig = progressDialog('Bestand wird entschlüsselt');
            const res = UI.unwrap(await window.kontor.security.disable(pass.value), 'Aufheben');
            fertig();
            if (!res) return;
            UI.toast('Die Verschlüsselung ist aufgehoben.', 'success');
            if (onDone) onDone();
          }
        }, 'Aufheben')
      ]
    });
    pass.focus();
  }

  /* -------------------------------------------------------- Merken */

  async function setRemember(app, remember, onDone) {
    if (!remember) {
      const res = UI.unwrap(await window.kontor.security.setRemember(false), 'Ändern');
      if (res) { UI.toast('Beim nächsten Start wird wieder gefragt.', 'success'); if (onDone) onDone(); }
      return;
    }

    const pass = plainPassword();
    UI.modal({
      title: 'An diesem Rechner merken',
      body: h('div', [
        UI.note([
          'Das Passwort wird nicht gespeichert. Hinterlegt wird ein eigener Schlüssel, den Windows an dein Benutzerkonto bindet.',
          'Wer an deinem angemeldeten Windows sitzt, kommt damit ohne Passwort in die App. Gegen einen Diebstahl der Dateien schützt es weiterhin.'
        ], 'warn'),
        field('Passwort zur Bestätigung', pass)
      ]),
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const res = UI.unwrap(await window.kontor.security.setRemember(true, pass.value), 'Ändern');
            if (!res) return;
            close();
            UI.toast('Gemerkt. Der Start fragt nicht mehr nach dem Passwort.', 'success');
            if (onDone) onDone();
          }
        }, 'Merken')
      ]
    });
    pass.focus();
  }

  /* --------------------------------------------------------- Tafel */

  /** Der Abschnitt in den Einstellungen. */
  function panel(app) {
    const s = app.security || {};
    const neuLaden = async () => {
      const frisch = UI.unwrap(await window.kontor.security.state());
      if (frisch) app.security = frisch;
      app.refresh();
    };

    const box = h('div');

    if (!s.encrypted) {
      box.appendChild(UI.note([
        'Der Bestand liegt zurzeit offen auf der Platte. Wer Zugriff auf den Ordner hat, kann Umsätze, Kunden, Kontoverbindungen und Belege lesen, auch ohne diese App.',
        'Das betrifft auch jede Sicherung und jeden Ordner, der in einen Cloud-Dienst synchronisiert wird.'
      ], 'warn'));
      box.appendChild(h('div', { class: 'right', style: { marginTop: '14px' } },
        h('button', { class: 'btn primary', onClick: () => enable(app, neuLaden) }, 'Verschlüsselung einrichten')
      ));
      return UI.panel('Verschlüsselung', box);
    }

    const zeile = (label, wert) => h('tr', [
      h('td', { class: 'muted' }, label),
      h('td', wert)
    ]);

    box.appendChild(UI.note(
      'Der Bestand ist mit AES-256 verschlüsselt. Buchungsdatei, Belege, tägliche Sicherungen und das Änderungsprotokoll sind geschützt, die Exporte für Kanzlei und Betriebsprüfung bleiben offen lesbar.',
      'success'
    ));

    box.appendChild(h('table', { style: { marginTop: '14px' } }, [
      zeile('Eingerichtet', s.createdAt ? fmtDate(s.createdAt) : 'unbekannt'),
      zeile('Passwort zuletzt gesetzt', s.passwordChangedAt ? fmtDate(s.passwordChangedAt) : 'unbekannt'),
      zeile('Wiederherstellungsschlüssel vom', s.recoveryCreatedAt ? fmtDate(s.recoveryCreatedAt) : 'unbekannt'),
      zeile('Geschützte Belege', String(s.receipts || 0)),
      zeile('Start an diesem Rechner', s.remembered ? 'ohne Passwortabfrage' : 'mit Passwortabfrage')
    ]));

    box.appendChild(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' } }, [
      h('button', { class: 'btn', onClick: () => changePassword(app) }, 'Passwort ändern'),
      h('button', { class: 'btn', onClick: () => newRecoveryKey(app, neuLaden) }, 'Neuer Wiederherstellungsschlüssel'),
      s.canRemember
        ? h('button', {
            class: 'btn',
            onClick: () => setRemember(app, !s.remembered, neuLaden)
          }, s.remembered ? 'Nicht mehr merken' : 'An diesem Rechner merken')
        : null,
      h('div', { style: { flex: '1' } }),
      h('button', { class: 'btn ghost', onClick: () => disable(app, neuLaden) }, 'Verschlüsselung aufheben')
    ].filter(Boolean)));

    return UI.panel('Verschlüsselung', box);
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return 'unbekannt';
    }
  }

  return { panel, enable, changePassword, newRecoveryKey, disable };
}());
