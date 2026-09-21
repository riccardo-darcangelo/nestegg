// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import crypto from 'node:crypto';

import type { IsoTimestamp } from '../shared/types';

/**
 * Encryption for the bookkeeping data.
 *
 * Files are encrypted with a random data key that never touches the disk in
 * the clear. That key is stored several times over, each copy locked with a
 * different secret: the password, the recovery key, or a device key kept by
 * the operating system. Changing the password only rewrites one envelope
 * instead of re-encrypting everything.
 *
 * The recovery key is not a convenience. German tax law (AO 147) requires
 * records to stay readable for ten years, so a vault nobody can open is a
 * legal problem, not just an annoyance.
 *
 * AES-256-GCM both encrypts and authenticates, so tampering surfaces as an
 * error instead of garbage. Key derivation uses scrypt with the parameters
 * OWASP recommends when Argon2id is unavailable.
 */

const MAGIC = Buffer.from('NSTG', 'ascii');
const FORMAT_VERSION = 1;

/** magic + version + kind + iv + auth tag */
const HEADER_SIZE = MAGIC.length + 1 + 1 + 12 + 16;

const IV_SIZE = 12;
const KEY_SIZE = 32;

export interface KdfParams {
  N: number;
  r: number;
  p: number;
  keyLength: number;
  maxmem: number;
}

const KDF = Object.freeze({
  name: 'scrypt',
  N: 131072,
  r: 8,
  p: 1,
  keyLength: KEY_SIZE,
  // scrypt needs roughly 128 * N * r bytes. Node caps at 32 MB by default and
  // would refuse to run.
  maxmem: 192 * 1024 * 1024
});

/** Payload kinds, mixed into the authenticated header. */
export const KIND = Object.freeze({ FILE: 0, KEY: 1, LINE: 2 });

export type PayloadKind = typeof KIND[keyof typeof KIND];

/**
 * Crockford base32 without I, L, O and U. The first three are easy to confuse
 * with 1 and 0 when copying from paper; U is dropped so random keys cannot
 * spell anything rude.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_GROUPS = 6;
const RECOVERY_GROUP_SIZE = 4;
const RECOVERY_LENGTH = RECOVERY_GROUPS * RECOVERY_GROUP_SIZE;

/**
 * Derives a key from a secret. Deliberately slow, around a second and 128 MB
 * per attempt, which is what makes guessing expensive.
 */
export function deriveKey(
  secret: string | Buffer,
  salt: Buffer,
  params: KdfParams = KDF
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      Buffer.from(String(secret), 'utf8'),
      salt,
      params.keyLength,
      { N: params.N, r: params.r, p: params.p, maxmem: params.maxmem || KDF.maxmem },
      (err: Error | null, key: Buffer) => (err ? reject(err) : resolve(key))
    );
  });
}

function buildHeader(kind: PayloadKind): Buffer {
  return Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION, kind])]);
}

function toBuffer(value: Buffer | string): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
}

/**
 * The header travels as additional authenticated data, so relabelling a file
 * as a different kind breaks decryption instead of silently succeeding.
 */
export function encrypt(plain: Buffer | string, key: Buffer, kind: PayloadKind = KIND.FILE): Buffer {
  if (!Buffer.isBuffer(key) || key.length !== KEY_SIZE) {
    throw new Error(`Der Schlüssel muss ${KEY_SIZE} Bytes lang sein.`);
  }

  const iv = crypto.randomBytes(IV_SIZE);
  const header = buildHeader(kind);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);

  const body = Buffer.concat([cipher.update(toBuffer(plain)), cipher.final()]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), body]);
}

/** Throws when the key is wrong or the content was altered. */
export function decrypt(buffer: Buffer, key: Buffer): Buffer {
  if (!isEncrypted(buffer)) throw new Error('Die Datei ist keine NestEgg-Datei.');

  const version = buffer[MAGIC.length]!;
  if (version !== FORMAT_VERSION) {
    throw new Error(`Die Datei ist in Fassung ${version} geschrieben, diese App kennt nur ${FORMAT_VERSION}.`);
  }

  const headerSize = MAGIC.length + 2;
  const header = buffer.subarray(0, headerSize);
  const iv = buffer.subarray(headerSize, headerSize + IV_SIZE);
  const authTag = buffer.subarray(headerSize + IV_SIZE, HEADER_SIZE);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(buffer.subarray(HEADER_SIZE)), decipher.final()]);
}

export function isEncrypted(buffer: Buffer | null | undefined): boolean {
  return Buffer.isBuffer(buffer)
    && buffer.length >= HEADER_SIZE
    && buffer.subarray(0, MAGIC.length).equals(MAGIC);
}

/** 24 characters out of an alphabet of 32, so 120 bits of entropy. */
export function makeRecoveryKey(): string {
  const groups = [];
  for (let group = 0; group < RECOVERY_GROUPS; group += 1) {
    let chars = '';
    for (let i = 0; i < RECOVERY_GROUP_SIZE; i += 1) {
      // randomInt is uniform; taking randomBytes modulo 32 would not be.
      chars += ALPHABET[crypto.randomInt(ALPHABET.length)];
    }
    groups.push(chars);
  }
  return groups.join('-');
}

/**
 * Forgives what happens when someone copies the key from paper: lower case,
 * stray spaces, and the four characters the alphabet leaves out.
 */
export function normalizeRecoveryKey(value: string | null | undefined): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[ILO]/g, (char) => (char === 'O' ? '0' : '1'))
    .replace(/U/g, 'V');
}

export function looksLikeRecoveryKey(value: string | null | undefined): boolean {
  const plain = normalizeRecoveryKey(value);
  return plain.length === RECOVERY_LENGTH && [...plain].every((char) => ALPHABET.includes(char));
}

export function formatRecoveryKey(value: string | null | undefined): string {
  const plain = normalizeRecoveryKey(value);
  const groups = [];
  for (let i = 0; i < plain.length; i += RECOVERY_GROUP_SIZE) {
    groups.push(plain.slice(i, i + RECOVERY_GROUP_SIZE));
  }
  return groups.join('-');
}

/** One wrapped copy of the data key. */
export interface Envelope {
  /** Absent on the device envelope, whose key needs no derivation. */
  salt?: string;
  blob: string;
  createdAt: IsoTimestamp;
}

export interface Keyring {
  version: number;
  kdf: { name: string; N: number; r: number; p: number; keyLength: number };
  createdAt: IsoTimestamp;
  envelopes: {
    password: Envelope;
    recovery: Envelope;
    /** Only present once this machine is allowed to open the vault by itself. */
    device?: Envelope;
  };
}

/** Wraps the data key with a secret that still needs deriving. */
export async function seal(dataKey: Buffer, secret: string, params: KdfParams = KDF): Promise<Envelope> {
  const salt = crypto.randomBytes(16);
  const wrappingKey = await deriveKey(secret, salt, params);
  return {
    salt: salt.toString('base64'),
    blob: encrypt(dataKey, wrappingKey, KIND.KEY).toString('base64'),
    createdAt: new Date().toISOString()
  };
}

export async function unseal(
  envelope: Envelope | null | undefined,
  secret: string,
  params: KdfParams = KDF
): Promise<Buffer> {
  if (!envelope || !envelope.salt || !envelope.blob) {
    throw new Error('Der Umschlag ist unvollständig.');
  }
  const wrappingKey = await deriveKey(secret, Buffer.from(envelope.salt!, 'base64'), params);
  return decrypt(Buffer.from(envelope.blob, 'base64'), wrappingKey);
}

/** For the device envelope, whose key is already random and needs no KDF. */
export function sealWithKey(dataKey: Buffer, wrappingKey: Buffer): Envelope {
  return {
    blob: encrypt(dataKey, wrappingKey, KIND.KEY).toString('base64'),
    createdAt: new Date().toISOString()
  };
}

export function unsealWithKey(envelope: Envelope | null | undefined, wrappingKey: Buffer): Buffer {
  if (!envelope || !envelope.blob) throw new Error('Der Umschlag ist unvollständig.');
  return decrypt(Buffer.from(envelope.blob, 'base64'), wrappingKey);
}

/**
 * Creates a keyring. The recovery key is returned here and never stored, so
 * this is the only moment it exists in readable form.
 */
export async function createKeyring(password: string): Promise<{
  keyring: Keyring;
  dataKey: Buffer;
  recoveryKey: string;
}> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);

  const dataKey = crypto.randomBytes(KEY_SIZE);
  const recoveryKey = makeRecoveryKey();

  const keyring: Keyring = {
    version: 1,
    kdf: { name: KDF.name, N: KDF.N, r: KDF.r, p: KDF.p, keyLength: KDF.keyLength },
    createdAt: new Date().toISOString(),
    envelopes: {
      password: await seal(dataKey, password),
      recovery: await seal(dataKey, normalizeRecoveryKey(recoveryKey))
    }
  };

  return { keyring, dataKey, recoveryKey };
}

/** Falls back to current defaults so old keyrings keep opening. */
function paramsOf(keyring: Keyring | null | undefined): KdfParams {
  const kdf = keyring?.kdf ?? ({} as Keyring['kdf']);
  return {
    N: kdf.N || KDF.N,
    r: kdf.r || KDF.r,
    p: kdf.p || KDF.p,
    keyLength: kdf.keyLength || KDF.keyLength,
    maxmem: KDF.maxmem
  };
}

/**
 * The error deliberately does not say what went wrong. Telling an attacker
 * apart "wrong password" from "damaged file" confirms they are on track.
 */
export async function openWithPassword(keyring: Keyring, password: string): Promise<Buffer> {
  try {
    return await unseal(keyring.envelopes.password, password, paramsOf(keyring));
  } catch {
    throw new Error('Das Passwort passt nicht.');
  }
}

export async function openWithRecoveryKey(keyring: Keyring, recoveryKey: string): Promise<Buffer> {
  if (!looksLikeRecoveryKey(recoveryKey)) {
    throw new Error('Der Wiederherstellungsschlüssel besteht aus 24 Zeichen in sechs Vierergruppen.');
  }
  try {
    return await unseal(keyring.envelopes.recovery, normalizeRecoveryKey(recoveryKey), paramsOf(keyring));
  } catch {
    throw new Error('Der Wiederherstellungsschlüssel passt nicht.');
  }
}

/** Only the envelope changes, so no stored file has to be rewritten. */
export async function withNewPassword(keyring: Keyring, dataKey: Buffer, password: string): Promise<Keyring> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  return {
    ...keyring,
    envelopes: { ...keyring.envelopes, password: await seal(dataKey, password, paramsOf(keyring)) }
  };
}

/** Issues a new recovery key and invalidates the old one. */
export async function withNewRecoveryKey(
  keyring: Keyring,
  dataKey: Buffer
): Promise<{ keyring: Keyring; recoveryKey: string }> {
  const recoveryKey = makeRecoveryKey();
  const recovery = await seal(dataKey, normalizeRecoveryKey(recoveryKey), paramsOf(keyring));
  return {
    keyring: { ...keyring, envelopes: { ...keyring.envelopes, recovery } },
    recoveryKey
  };
}

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;

const COMMON_PASSWORDS = new Set([
  'passwort', 'password', 'passwort123', 'password123', '123456789012',
  'qwertzuiopü', 'qwertyuiop', 'buchhaltung', 'nestegg', 'nestegg123',
  'administrator', 'geheim', 'geheim123', 'willkommen', 'sommer2026'
]);

/**
 * Length matters more than character classes, which is why there is no rule
 * forcing symbols: those produce Passwort1! and little else.
 *
 * Returns the problem in German, or null when the password is fine.
 */
export function passwordProblem(password: string | null | undefined): string | null {
  const value = String(password ?? '');

  if (value.length < MIN_PASSWORD_LENGTH) return 'Das Passwort braucht mindestens zwölf Zeichen.';
  if (value.length > MAX_PASSWORD_LENGTH) return 'Das Passwort ist zu lang, 256 Zeichen sind das Äußerste.';
  if (value.trim() !== value) return 'Das Passwort darf nicht mit einem Leerzeichen beginnen oder enden.';
  if (COMMON_PASSWORDS.has(value.toLowerCase())) return 'Dieses Passwort ist zu geläufig.';
  if (/^(.)\1+$/.test(value)) return 'Ein einzelnes wiederholtes Zeichen ist kein Passwort.';

  return null;
}

function characterPoolSize(value: string): number {
  let pool = 0;
  if (/[a-z]/.test(value)) pool += 26;
  if (/[A-Z]/.test(value)) pool += 26;
  if (/[0-9]/.test(value)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(value)) pool += 33;
  return pool;
}

/**
 * A rough estimate for the strength meter, not a promise. Repeated characters
 * are discounted, because a long password built from three letters is shorter
 * than it looks.
 */
export type StrengthLevel = 'empty' | 'weak' | 'fair' | 'good' | 'strong';

export interface Strength {
  level: StrengthLevel;
  /** German, for display. */
  label: string;
  bits: number;
}

export function passwordStrength(password: string | null | undefined): Strength {
  const value = String(password ?? '');
  if (!value) return { level: 'empty', label: 'Noch nichts eingegeben', bits: 0 };

  const distinct = new Set(value).size;
  const effectiveLength = value.length * Math.min(1, distinct / Math.min(value.length, 8));
  const bits = Math.round(effectiveLength * Math.log2(Math.max(characterPoolSize(value), 2)));

  if (bits < 45) return { level: 'weak', label: 'Schwach, das ist schnell geraten', bits };
  if (bits < 70) return { level: 'fair', label: 'Brauchbar, länger wäre besser', bits };
  if (bits < 100) return { level: 'good', label: 'Gut', bits };
  return { level: 'strong', label: 'Sehr gut', bits };
}

export { MAGIC, FORMAT_VERSION, HEADER_SIZE, KDF };
