// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { currentStore, currentWindow, setStore } from './context';
import { defaultDataDir, readConfig, writeConfig } from './config';
import * as profiles from '../storage/profiles';
import { Store, DATA_FILE } from '../storage/store';
import type { Profile, ProfileState, StoredConfig } from '../storage/profiles';
import type { Id } from '../shared/types';

/**
 * The profiles of this installation.
 *
 * Which sets of books exist, which one is open, and what happens when it
 * changes. The rules of the list live in storage/profiles and know nothing of
 * Electron; here is where they meet the window, the store and the disk.
 */

let state: ProfileState = { profiles: [], activeProfileId: null };

export function currentProfiles(): ProfileState {
  return state;
}

export function activeProfile(): Profile | null {
  return profiles.activeOf(state);
}

/** Reads the company name out of a bookings file, for naming a profile. */
export function nameInDir(dir: string): string {
  try {
    const raw = fs.readFileSync(path.join(dir, DATA_FILE), 'utf8');
    const parsed = JSON.parse(raw) as { settings?: { company?: { name?: string } } };
    return String(parsed.settings?.company?.name ?? '').trim();
  } catch {
    return '';
  }
}

export function saveProfiles(): void {
  const active = activeProfile();
  const config: StoredConfig = {
    ...readConfig(),
    // dataDir stays and points at the active profile. An older version of the
    // app would still find its data that way.
    profiles: state.profiles,
    activeProfileId: state.activeProfileId
  };
  if (active) config.dataDir = active.dir;

  writeConfig(config);
}

export function loadProfiles(config: StoredConfig, fallbackDir?: string): ProfileState {
  const dir = config.dataDir || fallbackDir;
  const loaded = profiles.fromConfig(config, {
    fallbackDir: dir,
    fallbackName: (dir && nameInDir(dir)) || 'Mein Betrieb'
  });

  state = { profiles: loaded.profiles, activeProfileId: loaded.activeProfileId };
  if (loaded.migrated) saveProfiles();
  return state;
}

/** The root new profiles are created under. */
function profileRoot(): string {
  return state.profiles[0]?.dir ?? defaultDataDir();
}

/**
 * The name belongs in the window title: otherwise one books in the wrong set
 * of books at some point, and notices months later.
 */
export function windowTitle(profile?: Profile | null): string {
  const active = profile ?? activeProfile();
  return active && state.profiles.length > 1 ? `NestEgg: ${active.name}` : 'NestEgg';
}

/** Opens a profile: swap the store, rebuild the window. */
export async function openProfile(
  profile: Profile | null,
  { reload = true }: { reload?: boolean } = {}
): Promise<Profile | null> {
  if (!profile) return null;

  await currentStore().idle().catch(() => {});

  const store = new Store(profile.dir);
  setStore(store);
  try {
    await store.init();
  } catch (err) {
    dialog.showErrorBox('Datendatei beschädigt', (err as Error).message);
  }

  const window = currentWindow();
  if (window && !window.isDestroyed()) {
    window.setTitle(windowTitle(profile));
    if (reload) window.reload();
  }

  return profile;
}

export interface ProfileListing {
  profiles: (Profile & { active: boolean; exists: boolean })[];
  activeProfileId: Id | null;
  root: string;
}

/** What the interface shows, with whether each folder still holds data. */
export function profileList(): ProfileListing {
  const active = activeProfile();

  return {
    profiles: state.profiles.map((profile) => ({
      ...profile,
      active: Boolean(active && profile.id === active.id),
      exists: fs.existsSync(path.join(profile.dir, DATA_FILE))
    })),
    activeProfileId: state.activeProfileId,
    root: path.join(profileRoot(), profiles.PROFILE_DIR)
  };
}

/** Applies a change from storage/profiles and writes it down. */
function apply(next: ProfileState): void {
  state = next;
  saveProfiles();
}

export { profileRoot, apply, profiles as rules };
