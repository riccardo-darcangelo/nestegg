'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Profile.
 *
 * Mehrere Buchführungen in einer App: ein Einzelunternehmen, ein Verein, was
 * auch immer getrennt gehört. Jedes Profil hat seinen eigenen Datenordner,
 * seine eigenen Nummernkreise und seine eigenen Firmendaten.
 *
 * Hier liegen der Umschalter in der Seitenleiste und der Dialog dazu. Die
 * Verwaltung selbst steht zusätzlich in den Einstellungen, weil man sie dort
 * sucht.
 */
window.Profiles = (function profileUi() {
  const { h, field } = UI;

  /** Der Knopf in der Seitenleiste, der zeigt, worin man gerade bucht. */
  function renderSwitch(app, host) {
    UI.clear(host);
    const state = app.boot.profiles;
    if (!state || !state.profiles.length) return;

    const active = state.profiles.find((p) => p.active) || state.profiles[0];
    const others = state.profiles.length - 1;

    host.appendChild(h('button', {
      class: 'profile-button',
      title: active.dir,
      onClick: () => openChooser(app)
    }, [
      h('span', { class: 'profile-dot' }),
      h('span', { class: 'profile-name' }, active.name),
      h('span', { class: 'profile-hint' }, others ? `+${others}` : 'Profil')
    ]));
  }

  /* --------------------------------------------------------- Wechseln */

  function openChooser(app) {
    const state = app.boot.profiles;
    // Wird gesetzt, sobald der Dialog steht. Die Einträge darin werden vorher
    // gebaut, geklickt aber erst danach.
    let close = () => {};

    const list = h('div', { class: 'profile-list' }, state.profiles.map((profile) => h('button', {
      class: `profile-entry ${profile.active ? 'active' : ''}`.trim(),
      onClick: profile.active ? null : () => { close(); switchTo(app, profile); },
      disabled: profile.active
    }, [
      h('div', [
        h('div', { class: 'profile-entry-name' }, profile.name),
        h('div', { class: 'profile-entry-dir', title: profile.dir }, profile.dir)
      ]),
      profile.active ? h('span', { class: 'tag paid' }, 'aktiv') : h('span', { class: 'small muted' }, 'wechseln')
    ])));

    close = UI.modal({
      title: 'Profil',
      body: h('div', [
        UI.note('Jedes Profil ist eine eigene Buchführung mit eigenem Datenordner. Nichts davon wird vermischt: getrennte Steuersubjekte gehören getrennt.'),
        list
      ]),
      actions: (close) => [
        h('button', {
          class: 'btn ghost',
          onClick: async () => { close(); await openExisting(app); }
        }, 'Vorhandenes öffnen'),
        h('div', { style: { flex: '1' } }),
        h('button', { class: 'btn ghost', onClick: close }, 'Schließen'),
        h('button', {
          class: 'btn primary',
          onClick: () => { close(); openForm(app); }
        }, 'Profil anlegen')
      ]
    });
  }

  async function switchTo(app, profile) {
    // Das Fenster lädt danach neu, der Hinweis ist also das Letzte, was von
    // dieser Seite übrig bleibt.
    UI.toast(`Wechsle zu ${profile.name} …`);
    const result = UI.unwrap(await window.kontor.profiles.switch(profile.id), 'Profil wechseln');
    if (result) await app.reboot();
  }

  async function openExisting(app) {
    const result = UI.unwrap(await window.kontor.profiles.open(), 'Profil öffnen');
    if (result) await app.reboot();
  }

  /* --------------------------------------------------------- Anlegen */

  function openForm(app) {
    const draft = { name: '' };
    const body = h('div');

    body.appendChild(field('Name des Profils', UI.input({
      placeholder: 'z. B. Turnverein Musterstadt e. V.',
      onInput: (e) => { draft.name = e.target.value; }
    }), 'Nur zur Unterscheidung in dieser App. Die Firmendaten trägst du danach in den Einstellungen des neuen Profils ein.'));

    body.appendChild(UI.note([
      `Der Ordner entsteht unter ${app.boot.profiles.root}.`,
      'Das neue Profil startet leer: eigene Buchungen, eigene Nummernkreise, eigene Belege.'
    ]));

    UI.modal({
      title: 'Profil anlegen',
      body,
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const result = UI.unwrap(await window.kontor.profiles.create({ name: draft.name }), 'Profil anlegen');
            if (!result) return;
            close();
            await app.reboot();
          }
        }, 'Anlegen und wechseln')
      ]
    });
  }

  /* --------------------------------------------------------- Einstellungen */

  /** Das Panel für die Einstellungen. */
  function panel(app) {
    const state = app.boot.profiles;

    const rows = state.profiles.map((profile) => h('tr', [
      h('td', [
        h('div', { class: 'strong' }, profile.name),
        h('div', { class: 'small faint' }, profile.dir)
      ]),
      h('td', profile.active
        ? h('span', { class: 'tag paid' }, 'aktiv')
        : (profile.exists ? h('span', { class: 'small muted' }, 'bereit') : h('span', { class: 'tag overdue' }, 'Ordner fehlt'))),
      h('td', { class: 'nowrap' }, [
        !profile.active ? h('button', {
          class: 'btn small ghost',
          onClick: () => switchTo(app, profile)
        }, 'Wechseln') : null,
        h('button', {
          class: 'btn small ghost',
          style: { marginLeft: '6px' },
          onClick: () => renameForm(app, profile)
        }, 'Umbenennen'),
        state.profiles.length > 1 ? h('button', {
          class: 'btn small ghost danger',
          style: { marginLeft: '6px' },
          onClick: async () => {
            const result = UI.unwrap(await window.kontor.profiles.remove(profile.id), 'Profil entfernen');
            if (result) await app.reboot();
          }
        }, 'Entfernen') : null
      ])
    ]));

    return UI.panel('Profile', h('div', [
      UI.note([
        'Ein Profil ist eine eigene Buchführung: eigener Datenordner, eigene Firmendaten, eigene Nummernkreise. Für einen Verein neben dem Betrieb ist das der richtige Weg, denn es sind zwei Steuersubjekte.',
        'Entfernen nimmt ein Profil nur aus dieser Liste. Die Daten bleiben liegen, schon wegen der Aufbewahrungspflicht.'
      ]),
      UI.table([
        { label: 'Profil' },
        { label: 'Zustand', width: '130px' },
        { label: '', width: '250px' }
      ], rows),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
        h('button', { class: 'btn', onClick: () => openForm(app) }, 'Profil anlegen'),
        h('button', { class: 'btn ghost', onClick: () => openExisting(app) }, 'Vorhandenes öffnen')
      ])
    ]), { note: `${state.profiles.length} ${state.profiles.length === 1 ? 'Profil' : 'Profile'}` });
  }

  function renameForm(app, profile) {
    let name = profile.name;

    UI.modal({
      title: 'Profil umbenennen',
      body: h('div', [
        field('Name', UI.input({ value: name, onInput: (e) => { name = e.target.value; } })),
        UI.note('Der Ordner behält seinen Namen. Umbenannte Ordner wären in einer Betriebsprüfung nur verwirrend.')
      ]),
      actions: (close) => [
        h('button', { class: 'btn ghost', onClick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const result = UI.unwrap(await window.kontor.profiles.rename({ id: profile.id, name }), 'Umbenennen');
            if (!result) return;
            close();
            await app.reboot();
          }
        }, 'Speichern')
      ]
    });
  }

  return { renderSwitch, panel, openForm };
})();
