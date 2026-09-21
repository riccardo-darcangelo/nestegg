// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import * as vault from './vault';
import type { Keyring } from './vault';

/**
 * Storage for the wrapped data key.
 *
 * The keyring lives next to the data it opens, so it travels along when the
 * folder moves and is part of every backup. It only holds salts and wrapped
 * copies of the key, none of which is a secret on its own.
 *
 * The device key is the exception and stays in the app data of this machine,
 * held by the operating system. Keeping it beside the vault would put the key
 * in every backup of the lock.
 */

export const KEYRING_FILE = 'schluessel.json';
export const DEVICE_FILE = 'geraeteschluessel.json';
const DEVICE_KEY_SIZE = 32;

/**
 * What this module needs of Electron safeStorage, named so the security layer
 * does not have to import Electron itself.
 */
export interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export function keyringPath(dataDir: string): string {
  return path.join(dataDir, KEYRING_FILE);
}

export function exists(dataDir: string): boolean {
  return fs.existsSync(keyringPath(dataDir));
}

function readJsonOr<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Writes beside the target and renames, so a crash cannot truncate it. */
async function writeAtomic(file: string, content: unknown): Promise<string> {
  const temp = `${file}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(content, null, 2), 'utf8');
  await fsp.rename(temp, file);
  return file;
}

export function read(dataDir: string): Keyring | null {
  return readJsonOr<Keyring | null>(keyringPath(dataDir), null);
}

export function write(dataDir: string, keyring: Keyring): Promise<string> {
  return writeAtomic(keyringPath(dataDir), keyring);
}

export async function remove(dataDir: string): Promise<void> {
  await fsp.unlink(keyringPath(dataDir)).catch(() => {});
}

/**
 * Identifies a data folder in the device store. Hashed so the file does not
 * list the paths of every profile; lower case because Windows treats paths
 * that way.
 */
function dataDirId(dataDir: string): string {
  return crypto.createHash('sha256')
    .update(path.resolve(dataDir).toLowerCase(), 'utf8')
    .digest('hex')
    .slice(0, 32);
}

function devicePath(userDataDir: string): string {
  return path.join(userDataDir, DEVICE_FILE);
}

/** The encrypted device keys of every data folder this machine can open. */
type DeviceStore = Record<string, string>;

function readDeviceStore(userDataDir: string): DeviceStore {
  return readJsonOr<DeviceStore>(devicePath(userDataDir), {});
}

/**
 * Hands the device key to safeStorage, which on Windows means DPAPI and so
 * ties it to the Windows account. Copying the file to another machine yields
 * nothing.
 */
export async function rememberDevice(
  userDataDir: string,
  dataDir: string,
  deviceKey: Buffer,
  safeStorage: SafeStorage | null | undefined
): Promise<void> {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    throw new Error('Dieses Betriebssystem kann den Schlüssel nicht sicher verwahren.');
  }

  const store = readDeviceStore(userDataDir);
  store[dataDirId(dataDir)] = safeStorage.encryptString(deviceKey.toString('base64')).toString('base64');
  await writeAtomic(devicePath(userDataDir), store);
}

/** Returns the device key, or null when there is none or it no longer opens. */
export function recallDevice(
  userDataDir: string,
  dataDir: string,
  safeStorage: SafeStorage | null | undefined
): Buffer | null {
  const entry = readDeviceStore(userDataDir)[dataDirId(dataDir)];
  if (!entry || !safeStorage || !safeStorage.isEncryptionAvailable()) return null;

  try {
    const key = Buffer.from(safeStorage.decryptString(Buffer.from(entry, 'base64')), 'base64');
    return key.length === DEVICE_KEY_SIZE ? key : null;
  } catch {
    // Happens after a Windows account change. Asking for the password is fine.
    return null;
  }
}

export async function forgetDevice(userDataDir: string, dataDir: string): Promise<void> {
  const store = readDeviceStore(userDataDir);
  if (!(dataDirId(dataDir) in store)) return;

  delete store[dataDirId(dataDir)];
  await writeAtomic(devicePath(userDataDir), store);
}

/**
 * Adds a device envelope. The device key is random to begin with and needs no
 * derivation; its safety comes from where the operating system keeps it.
 */
export async function attachDevice(
  userDataDir: string,
  dataDir: string,
  keyring: Keyring,
  dataKey: Buffer,
  safeStorage: SafeStorage | null | undefined
): Promise<Keyring> {
  const deviceKey = crypto.randomBytes(DEVICE_KEY_SIZE);
  await rememberDevice(userDataDir, dataDir, deviceKey, safeStorage);

  return {
    ...keyring,
    envelopes: { ...keyring.envelopes, device: vault.sealWithKey(dataKey, deviceKey) }
  };
}

export async function detachDevice(userDataDir: string, dataDir: string, keyring: Keyring): Promise<Keyring> {
  await forgetDevice(userDataDir, dataDir);

  const envelopes = { ...keyring.envelopes };
  delete envelopes.device;
  return { ...keyring, envelopes };
}

/**
 * Tries to unlock without asking. Returns the data key or null; a failure
 * just means the password gets asked for.
 */
export function tryDevice(
  userDataDir: string,
  dataDir: string,
  keyring: Keyring | null | undefined,
  safeStorage: SafeStorage | null | undefined
): Buffer | null {
  if (!keyring?.envelopes?.device) return null;

  const deviceKey = recallDevice(userDataDir, dataDir, safeStorage);
  if (!deviceKey) return null;

  try {
    return vault.unsealWithKey(keyring.envelopes.device, deviceKey);
  } catch {
    return null;
  }
}
