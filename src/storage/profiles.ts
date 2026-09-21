// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import path from 'node:path';

import type { Id, IsoTimestamp } from '../shared/types';

/**
 * Profiles: several sets of books in one app.
 *
 * A profile is nothing but a data folder of its own, with its own bookings
 * file, its own receipts, its own number ranges and its own settings. There is
 * deliberately no shared layer above them:
 *
 *   An association and a sole trader are two different taxable persons. Their
 *   figures must not touch anywhere, neither in a report nor in a number
 *   range. Separate folders are the simplest form of that separation, and one
 *   that can still be followed in ten years when the app is long gone.
 *
 * Data that came into being before profiles existed stays where it is and is
 * declared the first profile. Nothing is moved: moving data is always the
 * occasion on which something goes missing.
 */

/** The folder new profiles are created under. */
export const PROFILE_DIR = 'profile';

// Names Windows still does not allow as a folder.
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
]);

/** Turns a name into a folder name. */
export function slugify(name: string | null | undefined): string {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  if (!slug || RESERVED.has(slug)) return `profil-${slug || 'neu'}`;
  return slug;
}

/** A folder name still free under the root. */
export function freeSlug(name: string, taken: readonly string[] | null | undefined): string {
  const base = slugify(name);
  const used = new Set((taken || []).map((value) => String(value).toLowerCase()));
  if (!used.has(base)) return base;

  for (let i = 2; i < 500; i += 1) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** The proposed folder for a new profile. */
export function dirFor(root: string, name: string, existingDirs?: readonly string[]): string {
  const parent = path.join(root, PROFILE_DIR);
  const taken = (existingDirs || []).map((dir) => path.basename(dir));
  return path.join(parent, freeSlug(name, taken));
}

export interface Profile {
  id: Id;
  name: string;
  dir: string;
  createdAt: IsoTimestamp;
}

export interface ProfileState {
  profiles: Profile[];
  activeProfileId: Id | null;
  /** True when this state was derived from a pre-profile configuration. */
  migrated?: boolean;
}

function newProfileId(existing: readonly Profile[]): Id {
  let id = `prf_${Date.now().toString(36)}`;
  let suffix = 0;
  const used = new Set((existing ?? []).map((profile) => profile.id));
  while (used.has(id)) {
    suffix += 1;
    id = `prf_${Date.now().toString(36)}_${suffix}`;
  }
  return id;
}

function normalizeProfile(raw: Partial<Profile>, index: number): Profile {
  return {
    id: raw.id || `prf_${index}`,
    name: String(raw.name ?? '').trim() || `Profil ${index + 1}`,
    dir: raw.dir!,
    createdAt: raw.createdAt || new Date().toISOString()
  };
}

export interface StoredConfig {
  profiles?: Partial<Profile>[];
  activeProfileId?: Id | null;
  /** The single data folder from before profiles existed. */
  dataDir?: string;
}

export interface FromConfigOptions {
  fallbackDir?: string | undefined;
  fallbackName?: string | undefined;
}

/**
 * Reads the profiles out of the configuration.
 *
 * Where the configuration knows no profiles but does know a data folder it
 * comes from the time before: that folder becomes the first profile. The name
 * comes from outside, because only the caller can look into the bookings file
 * and read the company name.
 */
export function fromConfig(config: StoredConfig = {}, options: FromConfigOptions = {}): ProfileState {
  const list = Array.isArray(config.profiles) ? config.profiles : [];
  const profiles = list
    .filter((entry) => entry && entry.dir)
    .map(normalizeProfile);

  const first = profiles[0];
  if (first) {
    const active = profiles.some((profile) => profile.id === config.activeProfileId)
      ? config.activeProfileId!
      : first.id;
    return { profiles, activeProfileId: active, migrated: false };
  }

  const dir = config.dataDir || options.fallbackDir;
  if (!dir) return { profiles: [], activeProfileId: null, migrated: false };

  const migrated = normalizeProfile({
    id: 'prf_1',
    name: options.fallbackName || 'Mein Betrieb',
    dir
  }, 0);

  return { profiles: [migrated], activeProfileId: migrated.id, migrated: true };
}

export function activeOf(state: ProfileState): Profile | null {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) ?? state.profiles[0] ?? null;
}

/** Either the changed state or the reason it did not change. */
export type Change<T = unknown> = { error: string; state?: undefined } | ({ error?: undefined; state: ProfileState } & T);

/** Adds a profile and makes it the active one. */
export function add(
  state: ProfileState,
  { name, dir, root }: { name: string; dir?: string | undefined; root: string }
): Change<{ profile: Profile }> {
  const clean = String(name ?? '').trim();
  if (!clean) return { error: 'Das Profil braucht einen Namen.' };

  if (state.profiles.some((profile) => profile.name.toLowerCase() === clean.toLowerCase())) {
    return { error: 'Ein Profil mit diesem Namen gibt es schon.' };
  }

  const target = dir || dirFor(root, clean, state.profiles.map((profile) => profile.dir));
  if (state.profiles.some((profile) => samePath(profile.dir, target))) {
    return { error: 'In diesem Ordner liegt bereits ein Profil.' };
  }

  const profile = normalizeProfile({ id: newProfileId(state.profiles), name: clean, dir: target }, state.profiles.length);
  return {
    state: { ...state, profiles: [...state.profiles, profile], activeProfileId: profile.id },
    profile
  };
}

export function rename(state: ProfileState, id: Id, name: string): Change {
  const clean = String(name ?? '').trim();
  if (!clean) return { error: 'Das Profil braucht einen Namen.' };
  if (!state.profiles.some((profile) => profile.id === id)) return { error: 'Das Profil gibt es nicht.' };
  if (state.profiles.some((profile) => profile.id !== id && profile.name.toLowerCase() === clean.toLowerCase())) {
    return { error: 'Ein Profil mit diesem Namen gibt es schon.' };
  }

  return {
    state: {
      ...state,
      profiles: state.profiles.map((profile) => (profile.id === id ? { ...profile, name: clean } : profile))
    }
  };
}

/**
 * Takes a profile out of the list.
 *
 * The data stays put. One click in a set of books must never delete ten years
 * of retention duty, and whoever really wants the folder gone does that
 * deliberately in the file manager.
 */
export function remove(state: ProfileState, id: Id): Change<{ removed: Profile }> {
  if (state.profiles.length <= 1) return { error: 'Das letzte Profil lässt sich nicht entfernen.' };
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile) return { error: 'Das Profil gibt es nicht.' };

  const rest = state.profiles.filter((item) => item.id !== id);
  const active = state.activeProfileId === id ? rest[0]!.id : state.activeProfileId;

  return { state: { ...state, profiles: rest, activeProfileId: active }, removed: profile };
}

export function activate(state: ProfileState, id: Id): Change {
  if (!state.profiles.some((profile) => profile.id === id)) return { error: 'Das Profil gibt es nicht.' };
  return { state: { ...state, activeProfileId: id } };
}

/** Path comparison that forgives case and trailing slashes. */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  const clean = (value: string | null | undefined) =>
    path.resolve(String(value ?? '')).replace(/[\\/]+$/, '').toLowerCase();
  return clean(a) === clean(b);
}
