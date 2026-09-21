'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const { contextBridge, ipcRenderer } = require('electron');

/**
 * Brücke des Sperrbildschirms.
 *
 * Bewusst getrennt von der Brücke der App und bewusst winzig: dieses Fenster
 * läuft, bevor irgendetwas entschlüsselt ist. Es kann Passwörter anbieten,
 * einen Ordner wählen und aufgeben. Mehr nicht. Alles, was mit Buchungen zu
 * tun hat, gibt es hier schlicht nicht.
 */

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('schloss', {
  /** Was der Bildschirm zeigen soll: entsperren oder einrichten. */
  state: () => invoke('lock:state'),

  /** Entsperren mit dem Passwort. */
  unlock: (password, remember) => invoke('lock:unlock', { password, remember }),

  /** Entsperren mit dem Wiederherstellungsschlüssel. */
  recover: (recoveryKey) => invoke('lock:recover', { recoveryKey }),

  /** Nach der Wiederherstellung sofort ein neues Passwort setzen. */
  resetPassword: (password, remember) => invoke('lock:resetPassword', { password, remember }),

  /** Ersteinrichtung: Passwort setzen, Schlüssel erzeugen. */
  setup: (password, remember) => invoke('lock:setup', { password, remember }),

  /** Ohne Verschlüsselung weitermachen. */
  skip: () => invoke('lock:skip'),

  /** Den Datenordner wählen. */
  chooseDir: () => invoke('lock:chooseDir'),

  /** Den Wiederherstellungsschlüssel ausdrucken oder als Datei sichern. */
  printRecoveryKey: (recoveryKey) => invoke('lock:printRecoveryKey', { recoveryKey }),

  /** Bestätigen, dass der Schlüssel verwahrt ist, und die App öffnen. */
  finish: () => invoke('lock:finish'),

  /** Einschätzung der Passwortgüte beim Tippen. */
  strength: (password) => invoke('lock:strength', { password }),

  quit: () => invoke('lock:quit')
});
