// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import * as vault from '../security/vault';
import * as receiptsLib from './receipts';
import { DOCUMENT_TYPES, DEFAULT_TEXTS } from '../domain/doctypes';
import { DEFAULT_THEME } from '../export/theme';
import { DEFAULT_SEGMENTS } from '../domain/segments';
import { DEFAULT_SETTINGS as DEFAULT_DUNNING } from '../domain/dunning';
import { DEFAULT_SETTINGS as DEFAULT_TIME } from '../domain/timetracking';
import { DEFAULT_SETTINGS as DEFAULT_MEMBERSHIP } from '../domain/members';
import { DEFAULT_SETTINGS as DEFAULT_SEPA } from '../domain/sepa';
import type { Id, Identified, IsoDate, IsoTimestamp, Receipt, Settings, Snapshot } from '../shared/types';

/**
 * Where the data lives.
 *
 * Everything sits in a single file in the chosen data folder. For a sole
 * trader that is more than enough, and it can be backed up with any tool.
 *
 * Writing is always atomic: into a temporary file first, then a rename. An
 * interrupted write cannot tear the bookkeeping apart that way. Alongside it
 * runs an append only journal that records every change.
 *
 * Encryption
 * ----------
 * Where a key is set the data sits as buchhaltung.nst instead of
 * buchhaltung.json, and the same goes for backups and the journal. Two file
 * names rather than one, so the folder shows at a glance what is protected and
 * what is not: a .json that holds no JSON would be a trap for anyone looking
 * into it later.
 *
 * Both are read. Data from before encryption still opens, and switching over
 * is a step of its own that the user triggers.
 */

/** One line of the change log. */
export interface JournalEntry {
  at: IsoTimestamp;
  action: string;
  collection: string;
  id: Id;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface ReservedNumber {
  counter: number;
  year: string;
  documentType: string;
}

export interface RekeyProgress {
  done: number;
  total: number;
  step: string;
}

export interface RekeyResult {
  total: number;
  failed: { id: Id; reason: string }[];
}

/** A receipt during a rekey, which may pick up the reason it did not move. */
type RekeyableReceipt = Receipt & { rekeyError?: string };

/** Every collection of records in the stored document. */
export type CollectionName = {
  [K in keyof Snapshot]: Snapshot[K] extends readonly Identified[] ? K : never
}[keyof Snapshot];

/**
 * One stored record.
 *
 * The store is deliberately generic over its collections: it knows ids and
 * timestamps, and what else a record carries is the business of the module
 * that works with it.
 */
export type StoredRecord = Identified & Record<string, unknown>;

export const DATA_FILE = 'buchhaltung.json';
const SAFE_FILE = 'buchhaltung.nst';
const JOURNAL_FILE = 'journal.jsonl';
const SAFE_JOURNAL_FILE = 'journal.nstl';
const KEYRING_FILE = 'schluessel.json';
const BACKUP_DIR = 'backups';
const RECEIPT_DIR = 'belege';
const EXPORT_DIR = 'exporte';
const SCHEMA_VERSION = 11;
const MAX_BACKUPS = 30;

export function defaultData(): Snapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: defaultSettings(),
    entries: [],
    invoices: [],
    customers: [],
    projects: [],
    recurrences: [],
    assets: [],
    receipts: [],
    // Imported bank statements: which file, when, how many lines.
    imports: [],
    // Tracked working time. It only touches the books through an invoice.
    times: [],
    // Donation receipts an association has issued.
    donations: [],
    // Reserves under AO 62, each with its movements.
    reserves: [],
    members: [],
    // Expense claims that can be waived into a donation.
    claims: [],
    meta: { createdAt: new Date().toISOString() }
  };
}

export function defaultSettings(): Settings {
  return {
    company: {
      name: '',
      owner: '',
      street: '',
      zip: '',
      city: '',
      country: 'DE',
      taxNumber: '',
      vatId: '',
      email: '',
      phone: '',
      website: '',
      bankName: '',
      iban: '',
      bic: '',
      accountHolder: '',
      logoPath: '',
      // Kanäle für die Fußzeile der Dokumente. Der Wert ist, was hinter dem
      // Dienst steht: bei Instagram der Name, bei LinkedIn der Pfad.
      social: { instagram: '', linkedin: '', facebook: '', xing: '', youtube: '', mastodon: '' },
      /**
       * Die eigene Unterschrift unter dem Schlusstext.
       *
       * Liegt ein Bild vor, wird es genommen, sonst der Name in Schreibschrift.
       * Ein Faksimile ersetzt keine eigenhändige Unterschrift, wo eine
       * vorgeschrieben ist; auf Rechnung und Angebot ist ohnehin keine nötig.
       */
      signature: { imagePath: '', text: '', height: 16 },
      // Der QR-Code auf dem Dokument.
      qr: {
        // 'none', 'url' oder 'giro' (GiroCode zum Überweisen)
        mode: 'none',
        url: '',
        size: 24
      }
    },
    /**
     * Wer hier bucht.
     *
     * Ein Einzelunternehmen rechnet in Betriebseinnahmen und Betriebsausgaben,
     * ein gemeinnütziger Verein in vier Sphären. Das ist kein Schalter für die
     * Oberfläche, sondern die Weiche für Kategorien, Auswertung und
     * Vorsteuerabzug.
     *
     * Die Angaben zum Freistellungsbescheid stehen hier, weil sie auf jede
     * Zuwendungsbestätigung gehören: ohne sie ist keine gültige auszustellen.
     */
    entity: {
      kind: 'business',
      charitable: false,
      purpose: '',
      // 'freistellung' oder 'anlage' (Anlage zum Körperschaftsteuerbescheid)
      noticeType: 'freistellung',
      noticeDate: '',
      noticeOffice: '',
      noticeYear: '',
      boardName: '',
      boardRole: 'Vorstand'
    },
    tax: {
      scheme: 'regel',
      vatMethod: 'ist',
      vatPeriod: 'quarterly',
      inputVatBasis: 'invoice',
      dauerfristverlaengerung: false,
      smallBusinessLimitNet: 2500000,
      /**
       * Ab welchem Jahr diese App die Buchführung trägt.
       *
       * Frühere Jahre lassen sich nacherfassen, etwa um die Auswertung über
       * mehrere Jahre zu sehen. Steuerlich sind sie abgeschlossen: EÜR,
       * Umsatzsteuer, Fristen und Mahnwesen lassen sie deshalb aus, damit aus
       * unvollständigen Altdaten keine Erklärung entsteht.
       *
       * null heißt: alle Jahre zählen voll.
       */
      bookkeepingFrom: null
    },
    invoice: {
      // Ein Nummernkreis je Dokumentart. Getrennte Kreise sind zulässig,
      // solange jeder für sich lückenlos bleibt.
      numberPatterns: {
        invoice: DOCUMENT_TYPES.invoice.defaultPattern,
        creditnote: DOCUMENT_TYPES.creditnote.defaultPattern,
        quote: DOCUMENT_TYPES.quote.defaultPattern,
        estimate: DOCUMENT_TYPES.estimate.defaultPattern
      },
      counters: { invoice: {}, creditnote: {}, quote: {}, estimate: {} },
      paymentTermsDays: 14,
      defaultVatRate: 19,
      salutation: 'Sehr geehrte Damen und Herren,',
      quoteValidityDays: 30,
      estimateTolerance: 15,
      currency: 'EUR'
    },
    // Geschäftsbereiche als Auswertungsdimension.
    segments: JSON.parse(JSON.stringify(DEFAULT_SEGMENTS)),
    // Mahnwesen: Zinsen, Pauschale und Fristen.
    dunning: { ...DEFAULT_DUNNING },
    // Kontoauszug: gelernte Zuordnungsregeln und was zuletzt gewählt war.
    bank: {
      lastDir: '',
      accountName: 'Geschäftskonto',
      rememberRules: true
    },
    bankRules: [],
    // Zeiterfassung: Vorgabesatz und Rundung.
    time: { ...DEFAULT_TIME },
    // Mitgliedsbeiträge: Beitragsklassen und Stichtag.
    membership: { ...DEFAULT_MEMBERSHIP },
    // Lastschrifteinzug: Gläubiger-ID, Formatfassung und Fristen.
    sepa: { ...DEFAULT_SEPA },
    // Übergabe an die Kanzlei: Kontenrahmen und abweichende Konten.
    datev: {
      chart: 'skr03',
      consultantId: '',
      clientId: '',
      accounts: {},
      moneyAccounts: {}
    },
    // Annahmen für Steuerrücklage und Liquiditätsvorschau.
    reserve: {
      incomeTaxRate: 35,
      tradeTaxRate: 0,
      accountBalance: 0,
      accountBalanceDate: null
    },
    // Freie Texte je Dokumentart: Einleitung, Hauptabsatz, Schlusstext.
    texts: JSON.parse(JSON.stringify(DEFAULT_TEXTS)),
    theme: { ...DEFAULT_THEME },
    eInvoice: {
      defaultFormat: 'zugferd',
      profile: 'urn:cen.eu:en16931:2017',
      xrechnungCustomization: 'urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0'
    },
    ui: { lastYear: new Date().getFullYear() }
  };
}

function newId(prefix: string): Id {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

/** Thrown when the data is encrypted and no key was given. */
interface LockedError extends Error {
  locked?: boolean;
  recovered?: string;
}

export class Store {
  readonly dataDir: string;
  /** The data key, or null while the data lies open. */
  key: Buffer | null;
  data: Snapshot;
  private queue: Promise<unknown> = Promise.resolve();
  private lastBackupDay: string | null = null;

  constructor(dataDir: string, key: Buffer | null = null) {
    this.dataDir = dataDir;
    this.key = key ?? null;
    this.data = defaultData();
  }

  get receiptDir(): string { return path.join(this.dataDir, RECEIPT_DIR); }
  get exportDir(): string { return path.join(this.dataDir, EXPORT_DIR); }
  get keyringFile(): string { return path.join(this.dataDir, KEYRING_FILE); }

  /** The file that gets written. */
  get file(): string {
    return path.join(this.dataDir, this.key ? SAFE_FILE : DATA_FILE);
  }

  get journalFile(): string {
    return path.join(this.dataDir, this.key ? SAFE_JOURNAL_FILE : JOURNAL_FILE);
  }

  /**
   * The file that exists, whichever kind it is.
   *
   * At startup it is not yet settled whether the data is encrypted: that is
   * exactly what this answers.
   */
  existingFile(): string | null {
    const safe = path.join(this.dataDir, SAFE_FILE);
    if (fs.existsSync(safe)) return safe;
    const plain = path.join(this.dataDir, DATA_FILE);
    if (fs.existsSync(plain)) return plain;
    return null;
  }

  /** Turns the data into the bytes that go onto the disk. */
  private serialize(): Buffer {
    const json = JSON.stringify(this.data, null, 2);
    return this.key ? vault.encrypt(json, this.key, vault.KIND.FILE) : Buffer.from(json, 'utf8');
  }

  /**
   * Reads bytes as the data.
   *
   * Recognised by the magic bytes, not by the file name: restoring an
   * encrypted backup should not fail because it is called something else.
   */
  private parse(buffer: Buffer): Snapshot {
    if (vault.isEncrypted(buffer)) {
      if (!this.key) {
        const err: LockedError = new Error('Der Bestand ist verschlüsselt und braucht das Passwort.');
        err.locked = true;
        throw err;
      }
      return JSON.parse(vault.decrypt(buffer, this.key).toString('utf8'));
    }
    return JSON.parse(buffer.toString('utf8'));
  }

  async init(): Promise<Snapshot> {
    await fsp.mkdir(this.dataDir, { recursive: true });
    await fsp.mkdir(this.receiptDir, { recursive: true });
    await fsp.mkdir(this.exportDir, { recursive: true });
    await fsp.mkdir(path.join(this.dataDir, BACKUP_DIR), { recursive: true });

    const existing = this.existingFile();
    if (!existing) {
      this.data = defaultData();
      await this.write();
      return this.data;
    }

    const raw = await fsp.readFile(existing);
    try {
      const parsed = this.parse(raw);
      const previousVersion = Number(parsed.schemaVersion) || 1;
      this.data = migrate(parsed);

      // Nach einem Schemawechsel wird der alte Stand einmal beiseitegelegt und
      // der neue sofort geschrieben. Sonst läge die Datei weiter in der alten
      // Form vor und die Umstellung liefe bei jedem Start erneut.
      if (previousVersion < SCHEMA_VERSION) {
        const stamp = new Date().toISOString().slice(0, 10);
        const extension = this.key ? 'nst' : 'json';
        await fsp.writeFile(
          path.join(this.dataDir, BACKUP_DIR, `vor-schema-${previousVersion}-${stamp}.${extension}`),
          raw
        );
        await this.write();
      }
    } catch (err) {
      // Encrypted data without a key is not damaged, only locked. Putting it
      // aside and starting over would be the worst thing that could happen.
      if ((err as LockedError).locked) throw err;

      // Better to set the broken file aside than to replace it silently.
      const broken = `${existing}.defekt-${Date.now()}`;
      await fsp.rename(existing, broken);
      this.data = defaultData();
      await this.write();
      const error: LockedError = new Error(`Die Datendatei war unlesbar und wurde nach ${path.basename(broken)} verschoben. Es wurde neu begonnen.`);
      error.recovered = broken;
      throw error;
    }
    return this.data;
  }

  /** Serialises every write, so they can never overtake one another. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Waits until nothing is left to write.
   *
   * Needed when switching profiles: the old data has to be fully written
   * before the app moves to a different folder.
   */
  idle(): Promise<boolean> {
    return this.enqueue(async () => true);
  }

  private async write(): Promise<void> {
    const target = this.file;
    const tmp = `${target}.tmp`;
    const payload = this.serialize();
    await fsp.writeFile(tmp, payload);
    await fsp.rename(tmp, target);
    await this.dailyBackup(payload);
  }

  /**
   * Puts a copy aside once a day and thins out the older ones.
   *
   * The copy goes onto the disk in the same shape as the data itself. An open
   * backup beside encrypted data would be a back door that made the whole
   * encryption worthless.
   */
  private async dailyBackup(payload: Buffer): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    if (this.lastBackupDay === day) return;
    this.lastBackupDay = day;
    const dir = path.join(this.dataDir, BACKUP_DIR);
    await fsp.writeFile(path.join(dir, `buchhaltung-${day}.${this.key ? 'nst' : 'json'}`), payload);

    const files = (await fsp.readdir(dir)).filter((f) => f.startsWith('buchhaltung-')).sort();
    for (const old of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
      await fsp.unlink(path.join(dir, old)).catch(() => {});
    }
  }

  /**
   * Writes one line into the change log.
   *
   * Encrypted line by line rather than as a whole file: only that way can it
   * be appended to without rewriting the log every time. Every line is an
   * envelope of its own, in base64.
   */
  private async journal(
    action: string,
    collection: string,
    id: Id,
    before: StoredRecord | null,
    after: StoredRecord | null
  ): Promise<void> {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      action,
      collection,
      id,
      before: before ? summarize(before) : null,
      after: after ? summarize(after) : null
    });

    const out = this.key
      ? `${vault.encrypt(line, this.key, vault.KIND.LINE).toString('base64')}\n`
      : `${line}\n`;
    await fsp.appendFile(this.journalFile, out, 'utf8').catch(() => {});
  }

  /**
   * Reads the change log.
   *
   * Lines that will not open are skipped rather than failing the whole read:
   * an interrupted write at the end of the file should not swallow the history
   * before it.
   */
  async readJournal(limit = 0): Promise<JournalEntry[]> {
    const entries: JournalEntry[] = [];
    for (const file of [this.journalFile, path.join(this.dataDir, JOURNAL_FILE)]) {
      if (!fs.existsSync(file)) continue;
      const text = await fsp.readFile(file, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          if (line.startsWith('{')) {
            entries.push(JSON.parse(line));
          } else if (this.key) {
            entries.push(JSON.parse(vault.decrypt(Buffer.from(line, 'base64'), this.key).toString('utf8')));
          }
        } catch {
          // Skip an unreadable line.
        }
      }
      if (file === this.journalFile && this.key) continue;
      break;
    }
    entries.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return limit > 0 ? entries.slice(-limit) : entries;
  }

  snapshot(): Snapshot {
    return this.data;
  }

  /** The records of one collection, whatever their shape. */
  private records(collection: CollectionName): StoredRecord[] {
    return (this.data[collection] ?? []) as unknown as StoredRecord[];
  }

  list(collection: CollectionName): StoredRecord[] {
    return this.records(collection);
  }

  get(collection: CollectionName, id: Id): StoredRecord | null {
    return this.records(collection).find((item) => item.id === id) ?? null;
  }

  create(collection: CollectionName, item: Record<string, unknown>, prefix?: string): Promise<StoredRecord> {
    return this.enqueue(async () => {
      const record = {
        ...item,
        id: (item.id as Id) || newId(prefix || collection.slice(0, 3))
      } as StoredRecord;

      this.records(collection).push(record);
      await this.write();
      await this.journal('create', collection, record.id, null, record);
      return record;
    });
  }

  update(collection: CollectionName, id: Id, patch: Record<string, unknown>): Promise<StoredRecord> {
    return this.enqueue(async () => {
      const list = this.records(collection);
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) throw new Error(`Eintrag ${id} wurde nicht gefunden.`);

      const before = list[index]!;
      const after = { ...before, ...patch, id, updatedAt: new Date().toISOString() };
      list[index] = after;
      await this.write();
      await this.journal('update', collection, id, before, after);
      return after;
    });
  }

  remove(collection: CollectionName, id: Id): Promise<boolean> {
    return this.enqueue(async () => {
      const list = this.records(collection);
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) return false;

      const [before] = list.splice(index, 1);
      await this.write();
      await this.journal('delete', collection, id, before!, null);
      return true;
    });
  }

  updateSettings(patch: Record<string, unknown>): Promise<Settings> {
    return this.enqueue(async () => {
      this.data.settings = deepMerge(this.data.settings, patch) as Settings;
      await this.write();
      await this.journal('settings', 'settings', 'settings', null, null);
      return this.data.settings;
    });
  }

  /**
   * Reserves the next number of a document type for a year.
   * Without gaps and ascending, one range per type.
   */
  reserveNumber(documentType: string, issueDate: IsoDate): Promise<ReservedNumber> {
    return this.enqueue(async () => {
      const type = DOCUMENT_TYPES[documentType as keyof typeof DOCUMENT_TYPES] ? documentType : 'invoice';
      const year = issueDate.slice(0, 4);
      const invoice = this.data.settings.invoice as { counters?: Record<string, Record<string, number>> };
      const counters = invoice.counters ?? {};
      if (!counters[type]) counters[type] = {};

      const next = (counters[type][year] ?? 0) + 1;
      counters[type][year] = next;
      invoice.counters = counters;
      await this.write();
      return { counter: next, year, documentType: type };
    });
  }

  /** The older name, for callers that only know invoices. */
  reserveInvoiceNumber(issueDate: IsoDate): Promise<ReservedNumber> {
    return this.reserveNumber('invoice', issueDate);
  }

  /**
   * Vollständiges Backup auf Anforderung, etwa vor dem Jahresabschluss.
   *
   * Die Sicherung trägt dieselbe Verschlüsselung wie der Bestand. Eine offene
   * Sicherung wäre ein Hintereingang, und gerade Sicherungen landen auf
   * Sticks und in fremden Händen. Wer die Zahlen offen weitergeben will,
   * nimmt den DATEV- oder GoBD-Export: der ist dafür gemacht.
   */
  backupTo(targetFile: string): Promise<string> {
    return this.enqueue(async () => {
      await fsp.writeFile(targetFile, this.serialize());
      return targetFile;
    });
  }

  /**
   * Stellt den gesamten Ordner auf einen anderen Schlüssel um.
   *
   * Reihenfolge ist hier alles. Jeder Beleg wird einzeln umgestellt und der
   * Bestand sofort danach geschrieben, damit ein Absturz mittendrin keinen
   * Beleg verwaist zurücklässt: der Bestand weiß dann immer, wo jede Datei
   * gerade liegt. Gelesen wird ohnehin an der Kennung im Dateikopf entschieden,
   * ein halb umgestellter Ordner ist deshalb benutzbar und die Umstellung
   * lässt sich einfach erneut starten.
   *
   * A null target key opens the folder up again.
   */
  rekey(fromKey: Buffer | null, toKey: Buffer | null, onProgress?: (progress: RekeyProgress) => void): Promise<RekeyResult> {
    return this.enqueue(async () => {
      const previousFile = this.existingFile();
      const previousJournal = this.journalFile;

      const receipts = (this.data.receipts ?? []) as RekeyableReceipt[];
      const total = receipts.length;
      const report = (done: number, step: string) => onProgress?.({ done, total, step });

      // From here on the data is written with the new key.
      this.key = toKey ?? null;
      report(0, 'Bestand');
      await this.write();

      let done = 0;
      for (const receipt of receipts) {
        try {
          const patch = await receiptsLib.rekeyFile(this.receiptDir, receipt, fromKey, toKey);
          if (patch) Object.assign(receipt, patch);
        } catch (err) {
          // A single receipt that does not come along must not stop the rest.
          // It stays where it is and gets reported at the end.
          receipt.rekeyError = (err as Error).message;
        }
        done += 1;
        await this.write();
        report(done, 'Belege');
      }

      report(total, 'Protokoll und Sicherungen');
      await this.rekeyJournal(previousJournal, fromKey, toKey);
      await this.rekeyBackups(fromKey, toKey);

      // The old data file only at the very end. Until here it was the fallback
      // in case something went wrong.
      if (previousFile && previousFile !== this.file) await fsp.unlink(previousFile).catch(() => {});

      const failed = receipts.filter((receipt) => receipt.rekeyError);
      return { total, failed: failed.map((receipt) => ({ id: receipt.id, reason: receipt.rekeyError! })) };
    });
  }

  /** Rewrites the change log in the new shape. */
  private async rekeyJournal(sourceFile: string, fromKey: Buffer | null, toKey: Buffer | null): Promise<void> {
    if (!fs.existsSync(sourceFile)) return;

    const lines: string[] = [];
    for (const line of (await fsp.readFile(sourceFile, 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      try {
        const plain = line.startsWith('{')
          ? line
          : vault.decrypt(Buffer.from(line, 'base64'), fromKey!).toString('utf8');
        lines.push(toKey ? vault.encrypt(plain, toKey, vault.KIND.LINE).toString('base64') : plain);
      } catch {
        // An unreadable line drops out, the rest of the history stays.
      }
    }

    const target = this.journalFile;
    await fsp.writeFile(`${target}.tmp`, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
    await fsp.rename(`${target}.tmp`, target);
    if (sourceFile !== target) await fsp.unlink(sourceFile).catch(() => {});
  }

  /** Moves the backups that were put aside onto the new key as well. */
  private async rekeyBackups(fromKey: Buffer | null, toKey: Buffer | null): Promise<void> {
    const dir = path.join(this.dataDir, BACKUP_DIR);
    if (!fs.existsSync(dir)) return;

    for (const name of await fsp.readdir(dir)) {
      if (!/\.(json|nst)$/i.test(name)) continue;
      const source = path.join(dir, name);
      try {
        const raw = await fsp.readFile(source);
        const plain = vault.isEncrypted(raw) ? vault.decrypt(raw, fromKey!) : raw;
        const target = path.join(dir, `${name.replace(/\.(json|nst)$/i, '')}.${toKey ? 'nst' : 'json'}`);

        await fsp.writeFile(target, toKey ? vault.encrypt(plain, toKey, vault.KIND.FILE) : plain);
        if (target !== source) await fsp.unlink(source).catch(() => {});
      } catch {
        // A backup that will not open stays as it is. Deleting it would be the
        // greater damage.
      }
    }
  }
}

/** Cuts a record down to the fields worth logging. */
function summarize(record: StoredRecord): Record<string, unknown> {
  const keep = ['id', 'type', 'date', 'paidDate', 'gross', 'net', 'vat', 'categoryId', 'description', 'number', 'status', 'name', 'label'];
  const out: Record<string, unknown> = {};
  for (const key of keep) if (record[key] !== undefined) out[key] = record[key];
  return out;
}

/**
 * Merges a patch into a base, one level at a time.
 *
 * Works on loosely shaped objects on purpose: settings and stored data arrive
 * in whatever form an older version wrote them, and pinning that down would
 * mean one type per schema version.
 */
function deepMerge(base: any, patch: any): any {
  const out: any = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && base[key] !== null) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Hebt ältere Datenstände auf das aktuelle Schema. */
/**
 * Brings an older document up to the current schema.
 *
 * Untyped for the same reason deepMerge is: what arrives here is by definition
 * not the current shape yet.
 */
function migrate(data: any): Snapshot {
  const out = { ...defaultData(), ...data };
  const oldSettings = data.settings || {};
  out.settings = deepMerge(defaultSettings(), oldSettings);

  for (const key of ['entries', 'invoices', 'customers', 'projects', 'recurrences', 'assets', 'receipts', 'imports', 'times', 'donations', 'reserves', 'members', 'claims']) {
    if (!Array.isArray(out[key])) out[key] = [];
  }

  // Version 1 kannte nur Rechnungen: ein Nummernmuster, ein Zähler je Jahr und
  // drei feste Texte. Das wandert in die Struktur je Dokumentart.
  const oldInvoice = oldSettings.invoice || {};
  if (typeof oldInvoice.numberPattern === 'string') {
    out.settings.invoice.numberPatterns.invoice = oldInvoice.numberPattern;
    delete out.settings.invoice.numberPattern;
  }
  const oldCounters = oldInvoice.counters;
  if (oldCounters && Object.keys(oldCounters).some((key) => /^\d{4}$/.test(key))) {
    out.settings.invoice.counters = {
      invoice: { ...oldCounters },
      creditnote: {},
      quote: {},
      estimate: {}
    };
  }
  const renamedTexts: [string, string][] = [['introText', 'intro'], ['paymentText', 'body'], ['footerText', 'outro']];
  for (const [oldKey, target] of renamedTexts) {
    if (typeof oldInvoice[oldKey] === 'string' && oldInvoice[oldKey]) {
      out.settings.texts.invoice[target] = oldInvoice[oldKey];
    }
    delete out.settings.invoice[oldKey];
  }

  // Documents without a type are invoices from the first version.
  for (const document of out.invoices) {
    if (!document.documentType) document.documentType = 'invoice';
    if (document.paymentText && !document.bodyText) {
      document.bodyText = document.paymentText;
      delete document.paymentText;
    }
  }

  // Version 3 brings the reporting dimensions. Everything present gets the
  // first segment and the home country, so no booking stands unassigned.
  const firstSegment = (out.settings.segments && out.settings.segments[0])
    ? out.settings.segments[0].id
    : null;

  for (const entry of out.entries) {
    if (entry.segmentId === undefined) entry.segmentId = firstSegment;
    if (entry.projectId === undefined) entry.projectId = null;
    if (entry.customerId === undefined) entry.customerId = null;
    if (!entry.countryCode) entry.countryCode = 'DE';
    if (!entry.revenueKind) {
      // Licences and subscriptions repeat, everything else counts as one off.
      entry.revenueKind = entry.categoryId === 'inc_license' ? 'recurring' : 'onetime';
    }
  }

  for (const document of out.invoices) {
    if (document.segmentId === undefined) document.segmentId = firstSegment;
    if (document.projectId === undefined) document.projectId = null;
  }

  out.schemaVersion = SCHEMA_VERSION;
  return out;
}

export { newId, deepMerge, SCHEMA_VERSION, SAFE_FILE, KEYRING_FILE };
