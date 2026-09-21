// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { done, fail, handle } from '../ipc';
import { currentWindow } from '../context';
import {
  activeProfile, apply, currentProfiles, nameInDir, openProfile,
  profileList, profileRoot, rules, windowTitle
} from '../profiles';
import { DATA_FILE } from '../../storage/store';
import type { Id } from '../../shared/types';

/**
 * Profiles: several sets of books in one app.
 *
 * Creating, switching, renaming, taking one out of the list. Every change
 * writes the configuration and, where the active profile is affected, opens
 * the other set of books.
 */

handle('profiles:list', async () => done(profileList()));

handle('profiles:create', async ({ name, dir }: { name: string; dir?: string } = { name: '' }) => {
  const result = rules.add(currentProfiles(), { name, dir, root: profileRoot() });
  if (result.error !== undefined) return fail(result.error);

  apply(result.state);
  await openProfile(result.profile);
  return done(profileList());
});

handle('profiles:switch', async (id: Id) => {
  const active = activeProfile();
  if (active && active.id === id) return done(profileList());

  const result = rules.activate(currentProfiles(), id);
  if (result.error !== undefined) return fail(result.error);

  apply(result.state);
  await openProfile(activeProfile());
  return done(profileList());
});

handle('profiles:rename', async ({ id, name }: { id: Id; name: string }) => {
  const result = rules.rename(currentProfiles(), id, name);
  if (result.error !== undefined) return fail(result.error);

  apply(result.state);
  const window = currentWindow();
  if (window && !window.isDestroyed()) window.setTitle(windowTitle(activeProfile()));
  return done(profileList());
});

/**
 * Takes a profile out of the list.
 *
 * The data stays put. The dialog says so plainly, because "remove" otherwise
 * sounds like "delete" and nobody should throw a set of books away by
 * accident.
 */
handle('profiles:remove', async (id: Id) => {
  const state = currentProfiles();
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile) return fail('Das Profil gibt es nicht.');

  const answer = await dialog.showMessageBox(currentWindow()!, {
    type: 'question',
    buttons: ['Abbrechen', 'Aus der Liste nehmen'],
    defaultId: 0,
    cancelId: 0,
    message: `Profil "${profile.name}" aus der Liste nehmen?`,
    detail: `Die Daten bleiben unangetastet in:\n${profile.dir}\n\nDu kannst das Profil später über "Vorhandenes Profil öffnen" wieder hinzufügen.`
  });
  if (answer.response !== 1) return done(profileList());

  const wasActive = state.activeProfileId === id;
  const result = rules.remove(state, id);
  if (result.error !== undefined) return fail(result.error);

  apply(result.state);
  if (wasActive) await openProfile(activeProfile());
  return done(profileList());
});

/** Takes an existing folder into the list as a profile. */
handle('profiles:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(currentWindow()!, {
    title: 'Ordner eines vorhandenen Profils wählen',
    properties: ['openDirectory']
  });
  if (canceled || !filePaths.length) return done(null);

  const dir = filePaths[0]!;
  if (!fs.existsSync(path.join(dir, DATA_FILE))) {
    return fail(`In diesem Ordner liegt keine ${DATA_FILE}. Für einen neuen Bestand nimm "Profil anlegen".`);
  }

  const result = rules.add(currentProfiles(), {
    name: nameInDir(dir) || path.basename(dir),
    dir,
    root: profileRoot()
  });
  if (result.error !== undefined) return fail(result.error);

  apply(result.state);
  await openProfile(result.profile);
  return done(profileList());
});
