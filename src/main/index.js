'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/*
 * NestEgg: Offline-Buchhaltung für Einzelunternehmer und kleine Vereine.
 * Copyright (C) 2026 Riccardo D'Arcangelo
 *
 * Dieses Programm ist freie Software: Sie können es weitergeben und/oder
 * verändern unter den Bedingungen der GNU General Public License, wie von
 * der Free Software Foundation veröffentlicht, entweder in Version 3 der
 * Lizenz oder einer späteren Version.
 *
 * Die Veröffentlichung erfolgt in der Hoffnung, dass sie nützlich ist, aber
 * OHNE JEDE GEWÄHRLEISTUNG, sogar ohne die stillschweigende Zusicherung der
 * MARKTREIFE oder EIGNUNG FÜR EINEN BESTIMMTEN ZWECK. Einzelheiten stehen in
 * der GNU General Public License.
 *
 * Eine Kopie der Lizenz liegt diesem Programm bei (LICENSE), sonst unter
 * <https://www.gnu.org/licenses/>.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { Store, defaultSettings, DATA_FILE } = require('../storage/store');
const vault = require('../security/vault');
const keyring = require('../security/keyring');
const einvoiceRead = require('../import/einvoice');
const gobd = require('../export/gobd');
const datev = require('../export/datev');
const timetracking = require('../domain/timetracking');
const thresholds = require('../domain/thresholds');
const spheres = require('../domain/spheres');
const donations = require('../domain/donations');
const donationReceipt = require('../export/donation-receipt');
const reserves = require('../domain/reserves');
const membersDomain = require('../domain/members');
const sepaDomain = require('../domain/sepa');
const sepaExport = require('../export/sepa');
const returnsDomain = require('../domain/returns');
const claimsDomain = require('../domain/claims');
const customersDomain = require('../domain/customers');
const prenotification = require('../export/prenotification');
const netassets = require('../export/netassets');
const travel = require('../domain/travel');
const verfahrensdoku = require('../export/verfahrensdoku');
const recoverySheet = require('../export/recovery-sheet');
const legacy = require('../storage/legacy');
const receiptsLib = require('../storage/receipts');
const entriesDomain = require('../domain/entries');
const invoicesDomain = require('../domain/invoices');
const assetsDomain = require('../domain/assets');
const categories = require('../domain/categories');
const { VAT_RATES } = require('../domain/tax');
const taxDomain = require('../domain/tax');
const euer = require('../domain/euer');
const vatDomain = require('../domain/vat');
const cii = require('../export/cii');
const ubl = require('../export/ubl');
const pdfa = require('../export/pdfa');
const documentHtml = require('../export/document-html');
const doctypes = require('../domain/doctypes');
const themeLib = require('../export/theme');
const documentCss = require('../export/document-css');
const analytics = require('../domain/analytics');
const ecsales = require('../domain/ecsales');
const forecast = require('../domain/forecast');
const segments = require('../domain/segments');
const projectsDomain = require('../domain/projects');
const recurring = require('../domain/recurring');
const recurrence = require('../domain/recurrence');
const dunning = require('../domain/dunning');
const deadlines = require('../domain/deadlines');
const bankimport = require('../domain/bankimport');
const reports = require('../export/reports');

const context = require('./context');
const profileState = require('./profiles');
require('./ipc/reports');
require('./ipc/profiles');
require('./ipc/receipts');

let store = null;
let mainWindow = null;

/** Der Datenordner steht in einer kleinen Konfigurationsdatei neben den App-Daten. */
function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Der Ordner, in dem die Buchführung liegt, wenn niemand etwas anderes wählt.
 *
 * Neben der Anwendung, nicht unter Dokumente: der Dokumente-Ordner ist auf
 * vielen Rechnern in OneDrive eingehängt, und dann wandert die komplette
 * Buchführung samt Belegen in die Cloud, ohne dass jemand das entschieden
 * hätte.
 *
 * Achtung, und die App sagt das beim Einrichten auch: ein
 * Installationsordner überlebt keine Deinstallation. Wer die Daten zehn Jahre
 * aufbewahren muss, und §147 Abs. 1 AO verlangt genau das, wählt besser einen
 * Ordner außerhalb, etwa auf einer zweiten Platte. Der Weg dorthin steht in
 * den Einstellungen und beim ersten Start.
 */
function defaultDataDir() {
  const candidates = [];

  if (app.isPackaged) {
    // Neben NestEgg.exe. Bei der Installation je Benutzer liegt das unter
    // AppData\Local\Programs und ist beschreibbar.
    candidates.push(path.join(path.dirname(process.execPath), 'Daten'));
  } else {
    // In der Entwicklung neben dem Projekt, damit Prüfläufe nicht in einen
    // echten Bestand schreiben.
    candidates.push(path.join(app.getAppPath(), 'daten-dev'));
  }

  // Falls dort nicht geschrieben werden darf, etwa bei einer Installation für
  // alle Benutzer unter Programme.
  candidates.push(path.join(app.getPath('userData'), 'Daten'));

  for (const dir of candidates) {
    if (isWritableDir(dir)) return dir;
  }
  return candidates[candidates.length - 1];
}

/** Lässt sich in diesem Ordner anlegen und schreiben? */
function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.schreibprobe-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#12151c',
    title: 'NestEgg',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'app.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  context.setWindow(mainWindow);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Externe Links gehören in den Systembrowser, nicht in die App.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ------------------------------------------------------------------ *
 * Sperre
 *
 * Vor dem Hauptfenster steht, wenn der Bestand verschlüsselt ist, ein eigenes
 * kleines Fenster. Getrennt und nicht als Überlagerung im Hauptfenster: so
 * kann die Oberfläche der App gar nicht erst laufen, solange nichts entsperrt
 * ist, und ihre Brücke zum Hauptprozess existiert in diesem Moment nicht.
 * ------------------------------------------------------------------ */

/** Der Datenschlüssel dieser Sitzung. Nur im Hauptprozess, nie im Renderer. */
let sessionKey = null;
let lockWindow = null;
let lockContext = null;

function createLockWindow() {
  lockWindow = new BrowserWindow({
    width: 560,
    height: 720,
    resizable: true,
    minimizable: true,
    maximizable: false,
    backgroundColor: '#090d14',
    title: 'NestEgg',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'unlock.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  lockWindow.loadFile(path.join(__dirname, '..', 'renderer', 'unlock.html'));
  return lockWindow;
}

/**
 * Sorgt dafür, dass der Bestand offen ist, bevor die App startet.
 *
 * Liefert den Ordner, mit dem weitergearbeitet wird, oder null, wenn der
 * Nutzer abgebrochen hat. Der Ordner kann sich unterwegs ändern: im
 * Einrichtungsschritt lässt er sich wählen.
 */
function ensureUnlocked(dataDir) {
  const hatBund = keyring.exists(dataDir);
  const hatBestand = Boolean(new Store(dataDir).existingFile());

  // Ein offener Bestand aus der Zeit vor der Verschlüsselung bleibt offen,
  // bis der Nutzer das ändert. Ihn beim Start zur Verschlüsselung zu zwingen
  // hieße, ihn vor die Wahl zu stellen, während er eigentlich arbeiten will.
  if (!hatBund && hatBestand) return Promise.resolve({ dir: dataDir, key: null });

  if (hatBund) {
    const bund = keyring.read(dataDir);
    const vomGeraet = keyring.tryDevice(app.getPath('userData'), dataDir, bund, safeStorage);
    if (vomGeraet) return Promise.resolve({ dir: dataDir, key: vomGeraet });
  }

  return new Promise((resolve) => {
    lockContext = {
      dir: dataDir,
      mode: hatBund ? 'unlock' : 'setup',
      keyring: hatBund ? keyring.read(dataDir) : null,
      dataKey: null,
      resolve
    };
    createLockWindow();

    // Fenster zu, ohne dass etwas entsperrt wurde: dann endet die App. Ein
    // Weiterlaufen mit leerem Bestand würde den verschlüsselten überschreiben.
    lockWindow.on('closed', () => {
      lockWindow = null;
      if (lockContext && !lockContext.settled) {
        lockContext.settled = true;
        resolve(null);
      }
    });
  });
}

/**
 * Beendet die Sperre und gibt den Startablauf frei.
 *
 * Das Sperrfenster bleibt dabei absichtlich noch stehen. Würde es hier
 * geschlossen, wäre für einen Augenblick kein Fenster offen, und
 * window-all-closed beendete die App, noch bevor das Hauptfenster entstanden
 * ist. Geschlossen wird es erst, wenn die App steht: closeLockWindow().
 */
function finishUnlock(dir, key) {
  if (!lockContext || lockContext.settled) return;
  lockContext.settled = true;
  const weiter = lockContext.resolve;
  lockContext = null;

  if (lockWindow && !lockWindow.isDestroyed()) lockWindow.hide();
  weiter({ dir, key });
}

function closeLockWindow() {
  if (!lockWindow) return;
  const win = lockWindow;
  lockWindow = null;
  if (!win.isDestroyed()) win.destroy();
}

handle('lock:state', async () => done({
  mode: lockContext ? lockContext.mode : 'unlock',
  dir: lockContext ? lockContext.dir : null,
  canRemember: safeStorage.isEncryptionAvailable()
}));

handle('lock:strength', async ({ password }) => done(vault.passwordStrength(password)));

handle('lock:chooseDir', async () => {
  if (!lockContext || lockContext.mode !== 'setup') return fail('Der Ordner lässt sich hier nicht mehr wechseln.');

  const { canceled, filePaths } = await dialog.showOpenDialog(lockWindow, {
    title: 'Ordner für die Buchführung wählen',
    defaultPath: lockContext.dir,
    properties: ['openDirectory', 'createDirectory']
  });
  if (canceled || !filePaths.length) return done(null);

  const ziel = filePaths[0];
  if (!isWritableDir(ziel)) return fail('In diesen Ordner darf nicht geschrieben werden.');

  // Liegt dort schon eine Buchführung, wird sie übernommen statt überschrieben.
  lockContext.dir = ziel;
  if (keyring.exists(ziel)) {
    lockContext.mode = 'unlock';
    lockContext.keyring = keyring.read(ziel);
  }
  writeConfig({ ...readConfig(), dataDir: ziel });
  return done(ziel);
});

handle('lock:setup', async ({ password, remember }) => {
  if (!lockContext) return fail('Die Einrichtung läuft nicht mehr.');

  const { keyring: bund, dataKey, recoveryKey } = await vault.createKeyring(password);
  const fertig = remember && safeStorage.isEncryptionAvailable()
    ? await keyring.attachDevice(app.getPath('userData'), lockContext.dir, bund, dataKey, safeStorage)
    : bund;

  await keyring.write(lockContext.dir, fertig);
  lockContext.dataKey = dataKey;
  lockContext.keyring = fertig;
  return done({ recoveryKey });
});

handle('lock:skip', async () => {
  if (!lockContext) return fail('Die Einrichtung läuft nicht mehr.');
  finishUnlock(lockContext.dir, null);
  return done(true);
});

handle('lock:unlock', async ({ password, remember }) => {
  if (!lockContext) return fail('Die Sperre läuft nicht mehr.');

  const dataKey = await vault.openWithPassword(lockContext.keyring, password);
  if (remember && safeStorage.isEncryptionAvailable() && !lockContext.keyring.envelopes.device) {
    const bund = await keyring.attachDevice(app.getPath('userData'), lockContext.dir, lockContext.keyring, dataKey, safeStorage);
    await keyring.write(lockContext.dir, bund);
  }
  finishUnlock(lockContext.dir, dataKey);
  return done(true);
});

handle('lock:recover', async ({ recoveryKey }) => {
  if (!lockContext) return fail('Die Sperre läuft nicht mehr.');
  lockContext.dataKey = await vault.openWithRecoveryKey(lockContext.keyring, recoveryKey);
  return done(true);
});

handle('lock:resetPassword', async ({ password, remember }) => {
  if (!lockContext || !lockContext.dataKey) return fail('Der Bestand ist nicht geöffnet.');

  // Beides erneuern: wer den alten Wiederherstellungsschlüssel benutzt hat,
  // soll ihn nicht ein zweites Mal brauchen können, falls er abhandenkam.
  let bund = await vault.withNewPassword(lockContext.keyring, lockContext.dataKey, password);
  const erneuert = await vault.withNewRecoveryKey(bund, lockContext.dataKey);
  bund = erneuert.keyring;

  if (remember && safeStorage.isEncryptionAvailable()) {
    bund = await keyring.attachDevice(app.getPath('userData'), lockContext.dir, bund, lockContext.dataKey, safeStorage);
  } else {
    bund = await keyring.detachDevice(app.getPath('userData'), lockContext.dir, bund);
  }

  await keyring.write(lockContext.dir, bund);
  lockContext.keyring = bund;
  return done({ recoveryKey: erneuert.recoveryKey });
});

handle('lock:printRecoveryKey', async ({ recoveryKey }) => {
  const file = await saveRecoveryKeyPdf(recoveryKey, lockWindow);
  return done(file);
});

/**
 * Legt das Wiederherstellungsblatt als PDF ab.
 *
 * Voreingestellt ist der Dokumente-Ordner, ausdrücklich nicht der Datenordner:
 * der Ersatzschlüssel neben dem Schloss wäre kein Ersatzschlüssel.
 */
async function saveRecoveryKeyPdf(recoveryKey, parent) {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(parent || mainWindow, {
    title: 'Wiederherstellungsschlüssel sichern',
    defaultPath: path.join(app.getPath('documents'), `nestegg-wiederherstellung-${stamp}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return null;

  const bytes = await renderPdf(recoverySheet.html(recoveryKey));
  await fsp.writeFile(filePath, Buffer.from(bytes));
  return filePath;
}

handle('lock:finish', async () => {
  if (!lockContext) return fail('Die Einrichtung läuft nicht mehr.');
  finishUnlock(lockContext.dir, lockContext.dataKey);
  return done(true);
});

handle('lock:quit', async () => {
  app.quit();
  return done(true);
});

/* ------------------------------------------------------------------ *
 * Verschlüsselung verwalten
 *
 * Alles, was die laufende App am Schloss ändern kann. Der Datenschlüssel
 * verlässt den Hauptprozess dabei nie: die Oberfläche schickt Passwörter
 * hinein und bekommt Ja oder Nein zurück.
 * ------------------------------------------------------------------ */

/** Der Zustand, den die Einstellungen anzeigen. */
function securityState() {
  const bund = keyring.exists(store.dataDir) ? keyring.read(store.dataDir) : null;
  return {
    encrypted: Boolean(sessionKey),
    hasKeyring: Boolean(bund),
    remembered: Boolean(bund && bund.envelopes && bund.envelopes.device),
    canRemember: safeStorage.isEncryptionAvailable(),
    dataDir: store.dataDir,
    createdAt: bund ? bund.createdAt : null,
    recoveryCreatedAt: bund && bund.envelopes.recovery ? bund.envelopes.recovery.createdAt : null,
    passwordChangedAt: bund && bund.envelopes.password ? bund.envelopes.password.createdAt : null,
    receipts: store.list('receipts').length
  };
}

handle('security:state', async () => done(securityState()));

handle('security:strength', async (password) => done(vault.passwordStrength(password)));

/** Schaltet einen offenen Bestand auf verschlüsselt um. */
handle('security:enable', async ({ password, remember }) => {
  if (sessionKey) return fail('Der Bestand ist bereits verschlüsselt.');

  const { keyring: bund, dataKey, recoveryKey } = await vault.createKeyring(password);
  const fertig = remember && safeStorage.isEncryptionAvailable()
    ? await keyring.attachDevice(app.getPath('userData'), store.dataDir, bund, dataKey, safeStorage)
    : bund;

  // Erst der Schlüsselbund, dann die Umstellung. Andersherum läge nach einem
  // Absturz ein verschlüsselter Bestand ohne den Schlüssel dazu.
  await keyring.write(store.dataDir, fertig);

  const ergebnis = await store.rekey(null, dataKey, (p) => sendProgress(p));
  sessionKey = dataKey;
  context.setKey(sessionKey);

  return done({ recoveryKey, ...ergebnis });
});

/** Hebt die Verschlüsselung auf. Bewusst umständlich, nicht bewusst versteckt. */
handle('security:disable', async ({ password }) => {
  if (!sessionKey) return fail('Der Bestand ist nicht verschlüsselt.');

  const bund = keyring.read(store.dataDir);
  // Das Passwort noch einmal: sonst genügte ein unbeaufsichtigter Rechner mit
  // gemerktem Schlüssel, um den Schutz abzuschalten.
  await vault.openWithPassword(bund, password);

  const ergebnis = await store.rekey(sessionKey, null, (p) => sendProgress(p));
  await keyring.remove(store.dataDir);
  await keyring.forgetDevice(app.getPath('userData'), store.dataDir);
  sessionKey = null;
  context.setKey(sessionKey);

  return done(ergebnis);
});

handle('security:changePassword', async ({ current, next }) => {
  if (!sessionKey) return fail('Der Bestand ist nicht verschlüsselt.');

  const bund = keyring.read(store.dataDir);
  const dataKey = await vault.openWithPassword(bund, current);
  await keyring.write(store.dataDir, await vault.withNewPassword(bund, dataKey, next));
  return done(true);
});

handle('security:newRecoveryKey', async ({ password }) => {
  if (!sessionKey) return fail('Der Bestand ist nicht verschlüsselt.');

  const bund = keyring.read(store.dataDir);
  const dataKey = await vault.openWithPassword(bund, password);
  const { keyring: neu, recoveryKey } = await vault.withNewRecoveryKey(bund, dataKey);
  await keyring.write(store.dataDir, neu);
  return done({ recoveryKey });
});

handle('security:printRecoveryKey', async ({ recoveryKey }) => {
  const file = await saveRecoveryKeyPdf(recoveryKey, mainWindow);
  return done(file);
});

/** Das Merken an diesem Rechner ein- oder ausschalten. */
handle('security:setRemember', async ({ remember, password }) => {
  if (!sessionKey) return fail('Der Bestand ist nicht verschlüsselt.');

  let bund = keyring.read(store.dataDir);
  if (remember) {
    if (!safeStorage.isEncryptionAvailable()) {
      return fail('Dieses Betriebssystem kann den Schlüssel nicht sicher verwahren.');
    }
    const dataKey = await vault.openWithPassword(bund, password);
    bund = await keyring.attachDevice(app.getPath('userData'), store.dataDir, bund, dataKey, safeStorage);
  } else {
    bund = await keyring.detachDevice(app.getPath('userData'), store.dataDir, bund);
  }
  await keyring.write(store.dataDir, bund);
  return done(securityState());
});

/** Meldet den Fortschritt einer Umstellung an die Oberfläche. */
function sendProgress(progress) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('security:progress', progress);
  }
}

function buildMenu() {
  const template = [
    {
      label: 'Datei',
      submenu: [
        { label: 'Datenordner öffnen', click: () => shell.openPath(store.dataDir) },
        { label: 'Sicherung anlegen', click: () => backupDialog() },
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' }
      ]
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom zurücksetzen' },
        { role: 'zoomIn', label: 'Größer' },
        { role: 'zoomOut', label: 'Kleiner' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function backupDialog() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Sicherung anlegen',
    defaultPath: path.join(app.getPath('documents'), `nestegg-sicherung-${stamp}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return null;
  await store.backupTo(filePath);
  return filePath;
}

/**
 * Bietet an, den Datenbestand einer früheren Fassung zu übernehmen.
 * Lehnt der Nutzer ab, bleibt alles wie es ist und nichts wird angefasst.
 */
async function adoptLegacyData() {
  const legacyDir = legacy.findLegacyDataDir({
    userDataParent: path.dirname(app.getPath('userData')),
    documents: app.getPath('documents')
  });
  if (!legacyDir) return null;

  const target = defaultDataDir();
  const plan = legacy.planAdoption(legacyDir, target);

  const answer = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Neu anfangen', 'Daten übernehmen'],
    defaultId: 1,
    cancelId: 0,
    message: 'Es wurden Daten einer früheren Fassung gefunden.',
    detail: `Gefunden: ${legacyDir}

Sollen diese Daten weiterverwendet werden?

${plan.description}`
  });
  if (answer.response !== 1) return null;

  const result = legacy.adopt(legacyDir, target);
  if (result.error) {
    dialog.showErrorBox(
      'Übernahme nicht vollständig möglich',
      `${result.error.message}

Es wird mit dem bisherigen Ordner weitergearbeitet:
${result.dir}`
    );
  }
  writeConfig({ ...readConfig(), dataDir: result.dir });
  return result.dir;
}

/**
 * Profile.
 *
 * Ein Profil ist ein eigener Datenordner. Welche es gibt und welches gerade
 * gilt, steht in derselben Konfigurationsdatei wie bisher der Datenordner.
 */
app.whenReady().then(async () => {
  const config = readConfig();
  let dataDir = config.dataDir;

  if (!dataDir && !(config.profiles || []).length) {
    // Beim ersten Start unter diesem Namen: nach Daten einer früheren Fassung
    // sehen, bevor ein leerer Bestand angelegt wird.
    dataDir = (await adoptLegacyData()) || defaultDataDir();
  }

  profileState.loadProfiles(readConfig(), dataDir);
  let active = profileState.activeProfile();

  // Vor allem anderen: aufschließen. Erst danach entsteht ein Store, und erst
  // danach lädt die Oberfläche.
  const geoeffnet = await ensureUnlocked(active ? active.dir : dataDir);
  if (!geoeffnet) { app.quit(); return; }

  sessionKey = geoeffnet.key;
  context.setKey(sessionKey);

  // Im Einrichtungsschritt kann der Ordner gewechselt worden sein.
  if (active && geoeffnet.dir !== active.dir) {
    profileState.loadProfiles(readConfig(), geoeffnet.dir);
    active = profileState.activeProfile();
  }

  store = new Store(geoeffnet.dir, sessionKey);
  context.setStore(store);

  try {
    await store.init();
  } catch (err) {
    // Die Datei war beschädigt und wurde beiseitegelegt. Der Nutzer erfährt es.
    dialog.showErrorBox('Datendatei beschädigt', err.message);
  }

  buildMenu();
  createWindow();
  if (mainWindow) mainWindow.setTitle(profileState.windowTitle(active));

  // Jetzt steht das Hauptfenster, das Sperrfenster darf gehen.
  closeLockWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ------------------------------------------------------------------ *
 * Hilfen
 * ------------------------------------------------------------------ */

function fail(message) {
  return { ok: false, error: message };
}

function done(data) {
  return { ok: true, data };
}

/** Kapselt einen Handler, damit ein Fehler die Oberfläche nicht zerreißt. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return await fn(payload);
    } catch (err) {
      console.error(`[${channel}]`, err);
      return fail(err.message || 'Unbekannter Fehler');
    }
  });
}

function company() {
  return store.snapshot().settings.company;
}

function today() {
  return entriesDomain.todayIso();
}

/** Lädt das Logo als Data-URL, damit es im PDF ohne Dateizugriff landet. */
/** Ein Bild aus den Firmendaten als data:-URL, zum Einbetten ins Dokument. */
async function imageDataUrl(bildPfad) {
  if (!bildPfad || !fs.existsSync(bildPfad)) return '';
  const ext = path.extname(bildPfad).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const data = await fsp.readFile(bildPfad);
  return `data:${mime};base64,${data.toString('base64')}`;
}

async function logoDataUrl() {
  return imageDataUrl(company().logoPath);
}

/**
 * Die Firmendaten, wie das Dokument sie braucht: mit eingebetteten Bildern.
 * Eine Stelle, damit kein Aufrufer das Faksimile vergisst.
 */
async function companyForDocument() {
  const c = company();
  return {
    ...c,
    logoDataUrl: await logoDataUrl(),
    signatureDataUrl: await imageDataUrl((c.signature || {}).imagePath)
  };
}

/* ------------------------------------------------------------------ *
 * Stammdaten und Zustand
 * ------------------------------------------------------------------ */

/**
 * Wer hier bucht: ein Einzelunternehmen oder ein Verein.
 * Davon hängen Kategorien, Auswertung und Vorsteuerabzug ab.
 */
function entityKind(settings) {
  return ((settings || {}).entity || {}).kind === 'club' ? 'club' : 'business';
}

handle('app:bootstrap', async () => {
  const data = store.snapshot();
  return done({
    settings: data.settings,
    dataDir: store.dataDir,
    security: securityState(),
    today: today(),
    profiles: profileState.profileList(),
    entity: data.settings.entity,
    categories: {
      income: categories.categoriesFor('income', entityKind(data.settings)),
      expense: categories.categoriesFor('expense', entityKind(data.settings))
    },
    spheres: spheres.SPHERES,
    reserveTypes: reserves.TYPES,
    memberKinds: membersDomain.KINDS,
    memberIntervals: membersDomain.INTERVALS,
    sepaSchemes: sepaDomain.SCHEMES,
    sepaSequenceTypes: sepaDomain.SEQUENCE_TYPES,
    painVersions: sepaDomain.PAIN_VERSIONS,
    sphereLimits: spheres.LIMITS,
    vatRates: VAT_RATES,
    paymentMethods: entriesDomain.PAYMENT_METHODS,
    units: invoicesDomain.UNITS,
    usefulLives: assetsDomain.USEFUL_LIFE_SUGGESTIONS,
    invoiceStatus: doctypes.ALL_STATUS,
    documentTypes: doctypes.DOCUMENT_TYPES,
    segments: segments.listSegments(data.settings),
    segmentKinds: segments.SEGMENT_KINDS,
    projectStatus: projectsDomain.PROJECT_STATUS,
    recurrenceIntervals: recurrence.INTERVALS,
    recurringKinds: recurring.KINDS,
    dunningLevels: dunning.LEVELS,
    deadlineKinds: deadlines.KINDS,
    countries: analytics.countryOptions(),
    defaultTexts: doctypes.DEFAULT_TEXTS,
    themePresets: Object.entries(themeLib.PRESETS).map(([id, p]) => ({ id, label: p.label, hint: p.hint })),
    themeFonts: themeLib.FONT_LABELS,
    defaultTheme: themeLib.DEFAULT_THEME,
    version: app.getVersion()
  });
});

handle('data:snapshot', async () => {
  const data = store.snapshot();
  const todayIso = today();
  // Alles, was der Store hat, geht an die Oberfläche. Eine Aufzählung der
  // Collections wäre eine zweite Liste, die man beim Hinzufügen vergisst:
  // genau daran ist die Navigation schon einmal gescheitert.
  return done({
    ...data,
    invoices: data.invoices.map((invoice) => ({
      ...invoice,
      computed: invoicesDomain.totals(invoice),
      resolvedStatus: invoicesDomain.resolveStatus(invoice, todayIso)
    }))
  });
});

/* ------------------------------------------------------------------ *
 * Buchungen
 * ------------------------------------------------------------------ */

handle('entries:preview', async (raw) => {
  const entry = entriesDomain.normalizeEntry(raw || {});
  return done({
    entry,
    effect: entriesDomain.taxEffect(entry),
    errors: entriesDomain.validateEntry(entry),
    warnings: entriesDomain.warningsFor(entry)
  });
});

handle('entries:save', async (raw) => {
  const entry = entriesDomain.normalizeEntry(raw || {});
  const errors = entriesDomain.validateEntry(entry);
  if (errors.length) return fail(errors.join(' '));

  const saved = entry.id
    ? await store.update('entries', entry.id, entry)
    : await store.create('entries', entry, 'buch');

  // Eine als Anlagegut markierte Ausgabe bekommt automatisch einen Eintrag im
  // Anlageverzeichnis, damit die Abschreibung nicht vergessen wird.
  if (raw.createAsset && !saved.assetId) {
    const asset = assetsDomain.normalizeAsset({
      label: saved.description,
      purchaseDate: saved.date,
      netCents: entriesDomain.taxEffect(saved).businessNet,
      usefulLifeYears: raw.usefulLifeYears || 3,
      entryId: saved.id
    });
    const createdAsset = await store.create('assets', asset, 'anl');
    await store.update('entries', saved.id, { assetId: createdAsset.id });
    saved.assetId = createdAsset.id;
  }

  return done(saved);
});

handle('entries:remove', async (id) => {
  const entry = store.get('entries', id);
  if (entry && entry.assetId) await store.remove('assets', entry.assetId);
  await store.remove('entries', id);
  return done(true);
});

/* ------------------------------------------------------------------ *
 * Kunden
 * ------------------------------------------------------------------ */

handle('customers:save', async (raw) => {
  const customer = {
    id: raw.id || null,
    name: String(raw.name || '').trim(),
    contactName: String(raw.contactName || '').trim(),
    customerNumber: String(raw.customerNumber || '').trim(),
    street: String(raw.street || '').trim(),
    street2: String(raw.street2 || '').trim(),
    zip: String(raw.zip || '').trim(),
    city: String(raw.city || '').trim(),
    country: String(raw.country || 'DE').trim().toUpperCase(),
    email: String(raw.email || '').trim(),
    phone: String(raw.phone || '').trim(),
    vatId: String(raw.vatId || '').trim().toUpperCase(),
    buyerReference: String(raw.buyerReference || '').trim(),
    isPublicAuthority: Boolean(raw.isPublicAuthority),
    paymentTermsDays: Number(raw.paymentTermsDays) || null,
    note: String(raw.note || '').trim(),
    updatedAt: new Date().toISOString()
  };
  if (!customer.name) return fail('Der Name des Kunden fehlt.');

  // Zwei Kunden mit derselben Nummer sind auf jeder Rechnung ein Problem.
  const doppelt = customersDomain.findDuplicate(store.list('customers'), customer.customerNumber, customer.id);
  if (doppelt) {
    return fail(`Die Kundennummer ${customer.customerNumber} trägt bereits ${doppelt.name}.`);
  }

  const saved = customer.id
    ? await store.update('customers', customer.id, customer)
    : await store.create('customers', { ...customer, createdAt: new Date().toISOString() }, 'kd');
  return done(saved);
});

handle('customers:remove', async (id) => {
  const used = store.list('invoices').some((inv) => inv.customerId === id);
  if (used) return fail('Zu diesem Kunden gibt es Rechnungen. Er kann nicht gelöscht werden.');
  await store.remove('customers', id);
  return done(true);
});

/* ------------------------------------------------------------------ *
 * Mahnwesen
 * ------------------------------------------------------------------ */

/** Was gemahnt werden kann, mit Alter und bisherigen Stufen. */
handle('dunning:overdue', async () => {
  const data = store.snapshot();
  const rows = dunning.collectOverdue(data.invoices, data.customers, data.settings, today())
    // Nacherfasste Altjahre werden nicht gemahnt: diese Forderungen sind
    // erledigt oder abgeschrieben, sonst stünden sie nicht im Archiv.
    .filter((row) => !taxDomain.isArchiveYear(data.settings, String(row.invoice.issueDate).slice(0, 4)));

  return done(rows.map((row) => ({
    invoiceId: row.invoice.id,
    number: row.invoice.number,
    issueDate: row.invoice.issueDate,
    dueDate: row.invoice.dueDate,
    customerId: row.invoice.customerId,
    customerName: row.customer.name || '',
    open: row.open,
    overdueDays: row.overdueDays,
    sentCount: row.sentCount,
    lastReminder: row.lastReminder,
    nextLevel: row.nextLevel,
    nextLevelLabel: dunning.getLevel(row.nextLevel).label,
    ready: row.ready
  })));
});

/** Rechnet eine Mahnung durch, ohne sie zu speichern. */
handle('dunning:prepare', async ({ invoiceId, level, deadline, includeInterest, includeFlatFee, includeFee }) => {
  const invoice = store.get('invoices', invoiceId);
  if (!invoice) return fail('Die Rechnung wurde nicht gefunden.');

  const data = store.snapshot();
  const customer = store.get('customers', invoice.customerId) || {};
  const prepared = dunning.prepare(invoice, customer, data.settings, today(), {
    level, deadline, includeInterest, includeFlatFee, includeFee
  });

  return done({
    ...prepared,
    customerName: customer.name || '',
    levels: dunning.LEVELS,
    salutation: data.settings.invoice.salutation || '',
    texts: data.settings.texts.reminder || {}
  });
});

/**
 * Hält die Mahnung fest.
 *
 * Gespeichert wird am Dokument, nicht als eigener Vorgang: eine Mahnung gehört
 * zu ihrer Rechnung und hat außerhalb davon keine Bedeutung.
 */
handle('dunning:create', async (payload) => {
  const invoice = store.get('invoices', payload.invoiceId);
  if (!invoice) return fail('Die Rechnung wurde nicht gefunden.');

  const data = store.snapshot();
  const customer = store.get('customers', invoice.customerId) || {};
  const prepared = dunning.prepare(invoice, customer, data.settings, today(), payload);

  const record = {
    level: prepared.level,
    levelId: prepared.levelId,
    levelLabel: prepared.levelLabel,
    date: prepared.date,
    deadline: prepared.deadline,
    open: prepared.open,
    interest: prepared.interest.amount,
    interestDays: prepared.interest.days,
    interestRate: prepared.interest.rate,
    interestSince: prepared.interest.since,
    flatFee: prepared.flatFee,
    fee: prepared.fee,
    total: prepared.total,
    intro: payload.intro || '',
    bodyText: payload.bodyText || prepared.bodyText,
    outro: payload.outro || ''
  };

  const saved = await store.update('invoices', invoice.id, {
    reminders: [...(invoice.reminders || []), record]
  });

  return done({ invoice: saved, reminder: record });
});

/** Nimmt die letzte Mahnung zurück, etwa wenn sie versehentlich entstand. */
handle('dunning:removeLast', async (invoiceId) => {
  const invoice = store.get('invoices', invoiceId);
  if (!invoice) return fail('Die Rechnung wurde nicht gefunden.');
  const reminders = [...(invoice.reminders || [])];
  if (!reminders.length) return fail('Zu dieser Rechnung gibt es keine Mahnung.');

  reminders.pop();
  await store.update('invoices', invoiceId, { reminders });
  return done(true);
});

/** Erzeugt das Mahnschreiben als PDF. */
handle('dunning:pdf', async ({ invoiceId, index }) => {
  const invoice = store.get('invoices', invoiceId);
  if (!invoice) return fail('Die Rechnung wurde nicht gefunden.');

  const reminders = invoice.reminders || [];
  const reminder = reminders[index !== undefined ? index : reminders.length - 1];
  if (!reminder) return fail('Zu dieser Rechnung gibt es keine Mahnung.');

  const data = store.snapshot();
  const customer = store.get('customers', invoice.customerId) || {};

  const html = documentHtml.renderReminder(
    {
      ...reminder,
      interest: {
        amount: reminder.interest,
        days: reminder.interestDays,
        rate: reminder.interestRate,
        since: reminder.interestSince
      },
      overdueDays: dunning.daysBetween(invoice.dueDate, reminder.date),
      salutation: data.settings.invoice.salutation
    },
    invoice,
    await companyForDocument(),
    customer,
    { theme: data.settings.theme }
  );

  const pdfBytes = await renderPdf(html);
  const base = invoiceFileBase(invoice, customer);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: `${reminder.levelLabel} speichern`,
    defaultPath: path.join(store.exportDir, `${base}_mahnung-${reminder.level}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return done(null);

  await fsp.writeFile(filePath, Buffer.from(pdfBytes));
  return done({ file: filePath });
});

/* ------------------------------------------------------------------ *
 * Fristenkalender
 * ------------------------------------------------------------------ */

handle('deadlines:list', async ({ year, horizonDays, kinds } = {}) => {
  const data = store.snapshot();
  const y = Number(year) || Number(today().slice(0, 4));
  // Für ein Altjahr gibt es nichts mehr abzugeben.
  const result = taxDomain.isArchiveYear(data.settings, y)
    ? { items: [], counts: {}, overdue: 0 }
    : deadlines.collect(data, y, today(), { horizonDays, kinds });
  return done({
    ...result,
    archive: taxDomain.isArchiveYear(data.settings, y),
    months: deadlines.groupByMonth(result.items),
    kinds: deadlines.KINDS
  });
});

/* ------------------------------------------------------------------ *
 * Verein: Sphären und Zuwendungen
 * ------------------------------------------------------------------ */

handle('spheres:review', async ({ year } = {}) => {
  const data = store.snapshot();
  const result = spheres.review(data.entries, Number(year) || Number(today().slice(0, 4)));
  return done({ ...result, definitions: spheres.SPHERES });
});

/* ------------------------------------------------------------------ *
 * Mitglieder und Beiträge
 * ------------------------------------------------------------------ */

handle('members:save', async (raw) => {
  const member = membersDomain.normalizeMember(raw || {});
  const errors = membersDomain.validateMember(member);
  if (errors.length) return fail(errors.join(' '));

  const saved = member.id
    ? await store.update('members', member.id, member)
    : await store.create('members', member, 'mg');
  return done(saved);
});

/**
 * Ein Mitglied löschen.
 *
 * Nur, solange nichts an ihm hängt. Wer ausgetreten ist, bekommt ein
 * Austrittsdatum und bleibt im Bestand: seine Beiträge stehen in der
 * Buchhaltung, und die muss zehn Jahre nachvollziehbar bleiben.
 */
handle('members:remove', async (id) => {
  const booked = store.list('entries').filter((entry) => entry.memberId === id);
  if (booked.length) {
    return fail(`Für dieses Mitglied sind ${booked.length} Buchungen erfasst. Trage stattdessen ein Austrittsdatum ein, dann bleibt die Buchhaltung nachvollziehbar.`);
  }
  await store.remove('members', id);
  return done(true);
});

handle('members:overview', async ({ year } = {}) => {
  const data = store.snapshot();
  const y = Number(year) || Number(today().slice(0, 4));

  return done({
    members: data.members,
    statistics: membersDomain.statistics(data.members, y),
    expected: membersDomain.expectedDues(data.members, data.settings.membership, y),
    tiers: (data.settings.membership || {}).tiers || [],
    intervals: membersDomain.INTERVALS,
    kinds: membersDomain.KINDS,
    today: today()
  });
});

/** Was in einem Jahr an Beiträgen fällig wäre. */
handle('members:duesPlan', async ({ year } = {}) => {
  const data = store.snapshot();
  const y = Number(year) || Number(today().slice(0, 4));

  const settings = data.settings.membership || {};
  if (!(settings.tiers || []).length) {
    return fail('Es ist noch keine Beitragsklasse angelegt. Ohne sie lässt sich kein Beitrag berechnen.');
  }

  const rows = membersDomain.plan(data.members, settings, y, data.entries);
  return done({ year: y, rows, summary: membersDomain.summarize(rows) });
});

/**
 * Der Beitragslauf.
 *
 * Er legt für jede bestätigte Fälligkeit eine Buchung an. Doppelt wird nichts
 * gebucht: die Prüfung gegen die schon vorhandenen Merkmale läuft hier noch
 * einmal, weil zwischen Ansehen und Buchen Zeit vergeht.
 */
handle('members:runDues', async ({ rows } = {}) => {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return fail('Es ist keine Fälligkeit ausgewählt.');

  const data = store.snapshot();
  const settings = data.settings.membership || {};
  const known = new Set((data.entries || []).map((entry) => entry.duesRef).filter(Boolean));

  const result = { created: 0, skipped: 0, amount: 0, problems: [] };

  for (const row of list) {
    if (!row || !row.ref || known.has(row.ref) || row.amount <= 0) {
      result.skipped += 1;
      continue;
    }

    const entry = entriesDomain.normalizeEntry(membersDomain.toEntry(row, settings));
    const errors = entriesDomain.validateEntry(entry);
    if (errors.length) {
      result.problems.push(`${row.memberName}: ${errors.join(' ')}`);
      continue;
    }

    await store.create('entries', entry, 'buch');
    known.add(row.ref);
    result.created += 1;
    result.amount += entry.gross;
  }

  return done(result);
});

/** Beitragsklassen pflegen. */
handle('members:saveTiers', async ({ tiers, dueMonth, dueDay, honoraryFree, categoryId } = {}) => {
  const clean = (Array.isArray(tiers) ? tiers : [])
    .filter((tier) => tier && String(tier.label || '').trim())
    .map((tier, index) => membersDomain.normalizeTier(tier, index));

  const saved = await store.updateSettings({
    membership: {
      tiers: clean,
      dueMonth: Math.min(12, Math.max(1, Number(dueMonth) || 1)),
      dueDay: Math.min(28, Math.max(1, Number(dueDay) || 1)),
      honoraryFree: honoraryFree !== false,
      categoryId: categoryId || 'cl_inc_dues'
    }
  });
  return done(saved.membership);
});

/* ------------------------------------------------------------------ *
 * Aufwandsspenden
 * ------------------------------------------------------------------ */

/** Der Kontostand an dem Tag, an dem der Anspruch eingeräumt wurde. */
function fundsForClaim(data, claim) {
  return claim.basisDate ? claimsDomain.fundsOn(data, claim.basisDate) : null;
}

handle('claims:overview', async ({ year } = {}) => {
  const data = store.snapshot();
  const y = Number(year) || Number(today().slice(0, 4));

  return done({
    ...claimsDomain.overview(data.claims, y, {
      today: today(),
      fundsFor: (claim) => fundsForClaim(data, claim)
    }),
    bases: claimsDomain.BASES,
    kinds: claimsDomain.KINDS,
    kilometerRate: claimsDomain.KILOMETER_RATE,
    waiverMonths: claimsDomain.WAIVER_MONTHS,
    today: today(),
    // Ob die App überhaupt etwas über die Zahlungsfähigkeit sagen kann.
    knowsFunds: claimsDomain.fundsOn(data, today()) !== null
  });
});

handle('claims:save', async (raw) => {
  const claim = claimsDomain.normalizeClaim(raw || {});
  const errors = claimsDomain.validateClaim(claim);
  if (errors.length) return fail(errors.join(' '));

  const saved = claim.id
    ? await store.update('claims', claim.id, claim)
    : await store.create('claims', claim, 'anp');

  const data = store.snapshot();
  return done({
    ...saved,
    check: claimsDomain.check(saved, {
      today: today(),
      fundsAtBasisDate: fundsForClaim(data, saved)
    })
  });
});

handle('claims:remove', async (id) => {
  const claim = store.get('claims', id);
  if (claim && (claim.expenseEntryId || claim.donationEntryId)) {
    return fail('Aus diesem Anspruch sind bereits Buchungen entstanden. Lösche zuerst die Buchungen, dann den Anspruch.');
  }
  await store.remove('claims', id);
  return done(true);
});

/**
 * Der Verzicht.
 *
 * Erst hier entsteht die Spende, und erst hier entstehen die beiden Buchungen.
 * Geprüft wird noch einmal vollständig: zwischen dem Erfassen des Anspruchs
 * und dem Verzicht vergeht Zeit, und die Frist läuft in dieser Zeit ab.
 */
handle('claims:waive', async ({ id, waivedAt, expenseCategoryId, donationCategoryId } = {}) => {
  const data = store.snapshot();
  const claim = store.get('claims', id);
  if (!claim) return fail('Den Anspruch gibt es nicht mehr.');
  if (claim.expenseEntryId || claim.donationEntryId) {
    return fail('Für diesen Anspruch ist der Verzicht schon gebucht.');
  }

  const withWaiver = claimsDomain.normalizeClaim({
    ...claim,
    waivedAt: waivedAt || today()
  });

  const result = claimsDomain.check(withWaiver, {
    today: today(),
    fundsAtBasisDate: fundsForClaim(data, withWaiver)
  });
  if (!result.ok) return fail(result.blocking.join(' '));

  const plan = claimsDomain.toEntries(withWaiver, {
    today: today(),
    expenseCategoryId,
    donationCategoryId
  });

  const expense = entriesDomain.normalizeEntry(plan.expense);
  const expenseErrors = entriesDomain.validateEntry(expense);
  if (expenseErrors.length) return fail(`Die Aufwandsbuchung geht nicht: ${expenseErrors.join(' ')}`);

  const donation = entriesDomain.normalizeEntry(plan.donation);
  const donationErrors = entriesDomain.validateEntry(donation);
  if (donationErrors.length) return fail(`Die Spendenbuchung geht nicht: ${donationErrors.join(' ')}`);

  // Erst beide Buchungen, dann der Vermerk am Anspruch. Bricht etwas ab,
  // steht der Anspruch weiter als offen da und lässt sich wiederholen.
  const savedExpense = await store.create('entries', expense, 'buch');
  const savedDonation = await store.create('entries', donation, 'buch');

  const saved = await store.update('claims', id, {
    waivedAt: withWaiver.waivedAt,
    expenseEntryId: savedExpense.id,
    donationEntryId: savedDonation.id
  });

  return done({
    claim: saved,
    expenseEntryId: savedExpense.id,
    donationEntryId: savedDonation.id,
    amount: savedExpense.gross,
    warnings: result.warnings
  });
});

/* ------------------------------------------------------------------ *
 * Lastschrifteinzug
 * ------------------------------------------------------------------ */

/**
 * Sammelt die Angaben des Gläubigers aus den Firmendaten.
 * Die Bankverbindung des Vereins ist dieselbe, aus der auch Rechnungen zahlen.
 */
function creditorFrom(settings) {
  const company = settings.company || {};
  return {
    name: company.name || '',
    iban: String(company.iban || '').replace(/\s/g, '').toUpperCase(),
    bic: String(company.bic || '').replace(/\s/g, '').toUpperCase()
  };
}

/**
 * Was sich einziehen lässt.
 *
 * Grundlage sind die gebuchten Beiträge: eingezogen wird, was schon als
 * Forderung in der Buchhaltung steht. Der Beitragslauf bucht, dieser Schritt
 * holt das Geld. Gruppiert wird nach Fälligkeitstag, denn er steht in der
 * Datei auf der Sammlerebene und nicht an der einzelnen Lastschrift.
 */
handle('sepa:plan', async ({ year, collectionDate } = {}) => {
  const data = store.snapshot();
  const y = Number(year) || Number(today().slice(0, 4));
  const settings = { ...sepaDomain.DEFAULT_SETTINGS, ...(data.settings.sepa || {}) };
  const byId = new Map((data.members || []).map((member) => [member.id, member]));

  // Wann zuletzt aus einem Mandat eingezogen wurde, damit der 36-Monats-
  // Verfall nicht an jedem alten Mandat hängt, aus dem regelmäßig läuft.
  const lastUsed = new Map();
  for (const entry of data.entries || []) {
    if (!entry.memberId || !entry.sepaExportedAt) continue;
    const seen = lastUsed.get(entry.memberId);
    const at = String(entry.sepaExportedAt).slice(0, 10);
    if (!seen || at > seen) lastUsed.set(entry.memberId, at);
  }

  const groups = new Map();
  for (const entry of data.entries || []) {
    if (!entry.duesRef || !entry.memberId) continue;
    if (String(entry.date).slice(0, 4) !== String(y)) continue;

    const member = byId.get(entry.memberId);
    if (!member || member.payment !== 'debit') continue;

    if (!groups.has(entry.date)) groups.set(entry.date, []);
    groups.get(entry.date).push({ entry, member });
  }

  const earliest = sepaDomain.earliestCollectionDate(today(), 1);
  const latest = sepaDomain.latestCollectionDate(today());

  const dates = [...groups.keys()].sort();
  const collections = dates.map((dueDate) => {
    const items = groups.get(dueDate);

    // Geprüft wird gegen den Tag, an dem tatsächlich eingezogen wird, nicht
    // gegen den Fälligkeitstag der Buchung. Beide fallen fast nie zusammen:
    // die Beiträge sind im Januar fällig, eingezogen wird, wann die Datei
    // entsteht. Gegen den Fälligkeitstag zu prüfen hieße, ein Mandat zu
    // beanstanden, das am Einzugstag längst gilt.
    const planned = collectionDate
      || (dueDate >= earliest && dueDate <= latest ? dueDate : earliest);

    const collected = sepaDomain.collect(items.map(({ entry, member }) => ({
      member,
      amount: entry.gross,
      reference: entry.description,
      endToEndId: entry.duesRef,
      dueDate: planned,
      lastUsed: lastUsed.get(member.id) || null
    })), { today: today() });

    // Was schon in einer Datei war, wird nicht noch einmal angeboten.
    const rows = collected.rows.map((row, index) => ({
      ...row,
      entryId: items[index].entry.id,
      exported: Boolean(items[index].entry.sepaExportedAt),
      exportedAt: items[index].entry.sepaExportedAt || null,
      sepaRef: items[index].entry.sepaRef || null
    }));

    const open = rows.filter((row) => row.ready && !row.exported);

    return {
      dueDate,
      plannedDate: planned,
      rows,
      count: open.length,
      total: open.reduce((sum, row) => sum + row.amount, 0),
      exported: rows.filter((row) => row.exported).length,
      blocked: rows.filter((row) => !row.ready).length,
      check: sepaDomain.validateRun({
        creditor: creditorFrom(data.settings),
        dueDate: planned,
        rows: open,
        today: today(),
        settings
      })
    };
  });

  return done({
    year: y,
    today: today(),
    collections,
    creditor: creditorFrom(data.settings),
    settings,
    // Ob über diese App überhaupt schon eingezogen wurde. Ohne diese Kenntnis
    // sagt ein altes Mandatsdatum nichts, und der Hinweis auf den Verfall
    // gehört einmal an die Datei statt an jede Zeile.
    everExported: lastUsed.size > 0,
    schemes: sepaDomain.SCHEMES,
    sequenceTypes: sepaDomain.SEQUENCE_TYPES,
    painVersions: sepaDomain.PAIN_VERSIONS,
    earliest,
    latest
  });
});

/**
 * Schreibt die Lastschriftdatei.
 *
 * Erst danach werden die Buchungen als eingezogen markiert, und zwar mit der
 * Kennung der Datei: bricht das Speichern ab, ist nichts markiert und der
 * Einzug lässt sich unverändert wiederholen.
 */
handle('sepa:export', async ({ dueDate, entryIds, collectionDate } = {}) => {
  const data = store.snapshot();
  const settings = { ...sepaDomain.DEFAULT_SETTINGS, ...(data.settings.sepa || {}) };
  const creditor = creditorFrom(data.settings);
  const byId = new Map((data.members || []).map((member) => [member.id, member]));

  const wanted = new Set(entryIds || []);
  const picked = (data.entries || []).filter((entry) => wanted.has(entry.id));
  if (!picked.length) return fail('Es ist keine Lastschrift ausgewählt.');

  const already = picked.filter((entry) => entry.sepaExportedAt);
  if (already.length) {
    return fail(`${already.length} der gewählten Forderungen wurden bereits eingezogen. Lade die Ansicht neu, dann stimmt die Auswahl wieder.`);
  }

  const due = collectionDate || dueDate;
  const collected = sepaDomain.collect(picked.map((entry) => ({
    member: byId.get(entry.memberId) || {},
    amount: entry.gross,
    reference: entry.description,
    endToEndId: entry.duesRef,
    dueDate: due
  })), { today: today() });

  const check = sepaDomain.validateRun({
    creditor, dueDate: due, rows: collected.ready, today: today(), settings
  });
  if (!check.ok) return fail(check.errors.join(' '));

  const file = sepaExport.build({
    creditor, rows: collected.ready, dueDate: due, settings, now: new Date()
  });

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'SEPA-Lastschriftdatei speichern',
    defaultPath: path.join(store.exportDir, file.fileName),
    filters: [{ name: 'SEPA XML', extensions: ['xml'] }]
  });
  if (canceled || !filePath) return done(null);

  await fsp.writeFile(filePath, file.xml, 'utf8');

  // Markiert wird nur, was tatsächlich in der Datei steht.
  const exportedAt = new Date().toISOString();
  const inFile = new Set(collected.ready.map((row) => row.endToEndId));
  let marked = 0;
  for (const entry of picked) {
    if (!inFile.has(sepaDomain.endToEndId(entry.duesRef, entry.description))) continue;
    await store.update('entries', entry.id, { sepaRef: file.messageId, sepaExportedAt: exportedAt });
    marked += 1;
  }

  return done({
    file: filePath,
    fileName: path.basename(filePath),
    count: file.count,
    total: file.total,
    marked,
    messageId: file.messageId,
    version: file.version,
    dueDate: due,
    warnings: check.warnings
  });
});

/**
 * Wer eine Vorabankündigung braucht.
 *
 * Sie ist die Pflicht, die neben dem Einzug am leichtesten untergeht: ohne sie
 * kann das Mitglied der Belastung widersprechen, obwohl das Mandat gültig ist,
 * und ein vollständiger Verzicht darauf lässt sich nicht einmal vereinbaren.
 */
handle('members:preNotification', async ({ year } = {}) => {
  const data = store.snapshot();
  const y = Number(year) || Number(today().slice(0, 4));
  const sepa = { ...sepaDomain.DEFAULT_SETTINGS, ...(data.settings.sepa || {}) };

  const plan = membersDomain.preNotificationPlan(
    data.members, data.settings.membership, y,
    { noticeDays: sepa.preNotificationDays, today: today() }
  );

  return done({
    ...plan,
    creditorId: sepa.creditorId,
    // Der letzte Tag, an dem die Schreiben noch fristgerecht draußen sind.
    deadline: plan.firstDue
      ? sepaDomain.addDays(plan.firstDue, -sepa.preNotificationDays)
      : null
  });
});

/** Erzeugt den Serienbrief als PDF. */
handle('members:preNotificationPdf', async ({ year, memberIds, salutation } = {}) => {
  const data = store.snapshot();
  const y = Number(year) || Number(today().slice(0, 4));
  const sepa = { ...sepaDomain.DEFAULT_SETTINGS, ...(data.settings.sepa || {}) };

  if (!sepa.creditorId) {
    return fail('Die Gläubiger-Identifikationsnummer fehlt. Sie gehört in jede Vorabankündigung und steht in der Mitgliederansicht unter Lastschrifteinzug.');
  }

  const plan = membersDomain.preNotificationPlan(
    data.members, data.settings.membership, y,
    { noticeDays: sepa.preNotificationDays, today: today() }
  );

  const wanted = memberIds && memberIds.length ? new Set(memberIds) : null;
  const items = plan.ready.filter((item) => !wanted || wanted.has(item.memberId));
  if (!items.length) return fail('Es ist kein Mitglied ausgewählt, das angeschrieben werden kann.');

  const html = prenotification.build({
    items,
    company: data.settings.company,
    sepa,
    entity: data.settings.entity,
    year: y,
    date: today(),
    salutation
  });

  const pdfBytes = await renderPdf(html);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Vorabankündigung speichern',
    defaultPath: path.join(store.exportDir, `vorabankuendigung-${y}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return done(null);

  await fsp.writeFile(filePath, Buffer.from(pdfBytes));
  return done({ file: filePath, fileName: path.basename(filePath), count: items.length });
});

/** Speichert die Einstellungen des Lastschrifteinzugs. */
handle('sepa:saveSettings', async (payload = {}) => {
  const id = String(payload.creditorId || '').replace(/\s/g, '').toUpperCase();
  if (id && !sepaDomain.validCreditorId(id)) {
    return fail('Die Gläubiger-Identifikationsnummer ist nicht gültig: die Prüfziffer stimmt nicht.');
  }

  const saved = await store.updateSettings({
    sepa: {
      creditorId: id,
      creditorName: String(payload.creditorName || '').trim(),
      scheme: sepaDomain.getScheme(payload.scheme).id,
      sequenceType: (sepaDomain.SEQUENCE_TYPES.find((item) => item.id === payload.sequenceType) || sepaDomain.SEQUENCE_TYPES[0]).id,
      painVersion: sepaDomain.getPainVersion(payload.painVersion).id,
      preNotificationDays: Math.min(60, Math.max(0, Number(payload.preNotificationDays) || 0)),
      batchBooking: payload.batchBooking !== false
    }
  });
  return done(saved.sepa);
});

/**
 * Rücklagen, Mittelverwendung und Vermögen auf einen Blick.
 * Drei Rechnungen, die dieselbe Frage aus drei Richtungen beantworten: wo
 * liegen die Mittel, die noch nicht verwendet wurden?
 */
handle('reserves:overview', async ({ year, date } = {}) => {
  const data = store.snapshot();
  const y = Number(year) || Number(today().slice(0, 4));
  const stichtag = date || (y === Number(today().slice(0, 4)) ? today() : `${y}-12-31`);

  return done({
    overview: reserves.overview(data.reserves, data.entries, y, today()),
    useOfFunds: reserves.useOfFunds(data.entries, data.reserves, y),
    netAssets: reserves.netAssets(data, { assetsDomain, invoicesDomain, typeOf: doctypes.typeOf }, stichtag),
    date: stichtag
  });
});

handle('reserves:save', async (raw) => {
  const reserve = reserves.normalizeReserve(raw || {});
  const errors = reserves.validateReserve(reserve);
  if (errors.length) return fail(errors.join(' '));

  const saved = reserve.id
    ? await store.update('reserves', reserve.id, reserve)
    : await store.create('reserves', reserve, 'rl');
  return done(saved);
});

handle('reserves:remove', async (id) => {
  const reserve = store.get('reserves', id);
  if (!reserve) return fail('Die Rücklage wurde nicht gefunden.');
  if (reserves.balanceOf(reserve) !== 0) {
    return fail('Diese Rücklage hat noch einen Bestand. Löse sie zuerst auf, damit die Bewegung nachvollziehbar bleibt.');
  }
  await store.remove('reserves', id);
  return done(true);
});

/** Eine Zuführung oder Auflösung festhalten. */
handle('reserves:move', async ({ id, kind, amount, year, date, note } = {}) => {
  const reserve = store.get('reserves', id);
  if (!reserve) return fail('Die Rücklage wurde nicht gefunden.');

  const value = Math.abs(Math.trunc(Number(amount) || 0));
  if (!value) return fail('Der Betrag darf nicht null sein.');

  if (kind === 'release' && value > reserves.balanceOf(reserve)) {
    return fail('Es lässt sich nicht mehr auflösen, als die Rücklage enthält.');
  }

  const movements = [...(reserve.movements || []), {
    id: `bew_${Date.now().toString(36)}`,
    date: date || today(),
    year: Number(year) || Number((date || today()).slice(0, 4)),
    kind: kind === 'release' ? 'release' : 'add',
    amount: value,
    note: String(note || '').trim()
  }];

  const saved = await store.update('reserves', id, { movements, updatedAt: new Date().toISOString() });
  return done(saved);
});

/** Die Vermögensübersicht als Blatt zum Beilegen. */
handle('reserves:document', async ({ year, date } = {}) => {
  const data = store.snapshot();
  const y = Number(year) || Number(today().slice(0, 4));
  const stichtag = date || `${y}-12-31`;

  const html = netassets.build({
    assets: reserves.netAssets(data, { assetsDomain, invoicesDomain, typeOf: doctypes.typeOf }, stichtag),
    useOfFunds: reserves.useOfFunds(data.entries, data.reserves, y),
    reserves: reserves.overview(data.reserves, data.entries, y, today()),
    spheres: spheres.calculate(data.entries, y),
    company: data.settings.company,
    entity: data.settings.entity,
    date: stichtag
  });

  const pdfBytes = await renderPdf(html);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Vermögensübersicht speichern',
    defaultPath: path.join(store.exportDir, `vermoegensuebersicht-${y}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return done(null);

  await fsp.writeFile(filePath, Buffer.from(pdfBytes));
  return done({ file: filePath });
});

handle('donations:overview', async ({ year } = {}) => {
  const data = store.snapshot();
  // Kunden und Mitglieder zusammen: gespendet wird aus beiden Richtungen, und
  // für die Bestätigung zählt nur, wer eine vollständige Anschrift hat.
  const people = [...(data.customers || []), ...(data.members || [])];
  return done(donations.overview(data.entries, people, Number(year) || Number(today().slice(0, 4))));
});

/**
 * Bereitet eine Zuwendungsbestätigung vor, ohne sie auszustellen.
 * Erst der zweite Schritt schreibt sie fest, denn eine ausgestellte
 * Bestätigung lässt sich nicht zurückholen.
 */
handle('donations:prepare', async ({ entryIds, customerId, memberId, year, waiver } = {}) => {
  const data = store.snapshot();
  const list = (data.entries || []).filter((entry) => (entryIds || []).includes(entry.id));
  if (!list.length) return fail('Es sind keine Zuwendungen ausgewählt.');

  const party = (customerId && (data.customers || []).find((item) => item.id === customerId))
    || (memberId && (data.members || []).find((item) => item.id === memberId))
    || {};
  const donor = {
    name: party.name || list[0].counterparty || '',
    street: party.street || '',
    zip: party.zip || '',
    city: party.city || ''
  };

  const prepared = donations.prepare(list, data.settings, donor, {
    year: Number(year) || undefined,
    today: today(),
    waiver
  });

  return done({ ...prepared, customerId: customerId || null });
});

/** Stellt die Bestätigung aus: festhalten und drucken. */
handle('donations:create', async (payload = {}) => {
  const data = store.snapshot();
  const list = (data.entries || []).filter((entry) => (payload.entryIds || []).includes(entry.id));
  if (!list.length) return fail('Es sind keine Zuwendungen ausgewählt.');

  const prepared = donations.prepare(list, data.settings, payload.donor || {}, {
    year: payload.year,
    today: today(),
    waiver: payload.waiver,
    collective: payload.collective
  });

  // Blockierend sind nur die Angaben, ohne die die Bestätigung ungültig wäre.
  const blocking = prepared.warnings.filter((warning) => /fehlt|fehlen|Ohne Gemeinnützigkeit|fünf Jahre/.test(warning));
  if (blocking.length && !payload.force) return fail(blocking.join(' '));

  const html = donationReceipt.build(prepared);
  const pdfBytes = await renderPdf(html);

  const base = `zuwendungsbestaetigung-${prepared.year || today().slice(0, 4)}-${slugName(prepared.donor.name)}`;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Zuwendungsbestätigung speichern',
    defaultPath: path.join(store.exportDir, `${base}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return done(null);

  await fsp.writeFile(filePath, Buffer.from(pdfBytes));

  // Festhalten, was ausgestellt wurde. Ohne diese Liste weiß niemand, ob eine
  // Zuwendung schon bestätigt ist, und eine zweite Bestätigung über dieselbe
  // Spende ist ein Haftungsfall.
  const record = await store.create('donations', {
    date: prepared.date,
    year: prepared.year,
    customerId: payload.customerId || null,
    donorName: prepared.donor.name,
    type: prepared.type,
    collective: prepared.collective,
    total: prepared.total,
    entryIds: list.map((entry) => entry.id),
    file: filePath
  }, 'zuw');

  return done({ receipt: record, file: filePath, warnings: prepared.warnings });
});

/** Welche Zuwendungen schon bestätigt sind. */
handle('donations:issued', async ({ year } = {}) => {
  const data = store.snapshot();
  const list = (data.donations || []).filter((item) => !year || Number(item.year) === Number(year));
  return done({
    receipts: list,
    confirmedEntryIds: list.flatMap((item) => item.entryIds || [])
  });
});

function slugName(value) {
  return String(value || 'spender')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'spender';
}

/* ------------------------------------------------------------------ *
 * Schwellenwerte und Reisekosten
 * ------------------------------------------------------------------ */

handle('reports:thresholds', async ({ year } = {}) => {
  const data = store.snapshot();
  const y = Number(year) || Number(today().slice(0, 4));

  return done({
    vatPeriod: thresholds.vatPeriodAdvice(data.entries, data.settings, y),
    smallBusiness: thresholds.smallBusinessWatch(data.entries, y, data.settings.tax.scheme === 'klein')
  });
});

handle('travel:preview', async (trip = {}) => {
  const days = trip.days && trip.days.length
    ? trip.days
    : travel.daysBetween(trip.from, trip.to, trip);

  const result = travel.calculate({ ...trip, days });
  return done({ ...result, entries: travel.toEntries(trip, result) });
});

handle('travel:book', async (trip = {}) => {
  const days = trip.days && trip.days.length
    ? trip.days
    : travel.daysBetween(trip.from, trip.to, trip);

  const result = travel.calculate({ ...trip, days });
  const drafts = travel.toEntries(trip, result);
  if (!drafts.length) return fail('Aus dieser Reise entsteht keine Pauschale.');

  const created = [];
  for (const draft of drafts) {
    const entry = entriesDomain.normalizeEntry({ ...draft, segmentId: trip.segmentId, projectId: trip.projectId });
    const errors = entriesDomain.validateEntry(entry);
    if (errors.length) return fail(errors.join(' '));
    created.push(await store.create('entries', entry, 'buch'));
  }

  return done({ entries: created, total: result.total });
});

/* ------------------------------------------------------------------ *
 * Zeiterfassung
 * ------------------------------------------------------------------ */

handle('times:save', async (raw) => {
  const data = store.snapshot();
  const entry = timetracking.normalizeTime({
    ...raw,
    rateCents: raw.rateCents !== undefined && raw.rateCents !== null
      ? raw.rateCents
      : timetracking.rateFor(raw.projectId, data.projects, data.settings)
  });

  const errors = timetracking.validateTime(entry);
  if (errors.length) return fail(errors.join(' '));

  const saved = entry.id
    ? await store.update('times', entry.id, entry)
    : await store.create('times', entry, 'zeit');
  return done(saved);
});

handle('times:remove', async (id) => {
  const entry = store.get('times', id);
  if (entry && entry.invoiceId) return fail('Diese Zeit ist bereits abgerechnet und lässt sich nicht mehr löschen.');
  await store.remove('times', id);
  return done(true);
});

/** Startet die Uhr. Es läuft immer höchstens eine. */
handle('times:start', async (raw = {}) => {
  const data = store.snapshot();
  const laufend = timetracking.running(data.times);
  if (laufend) return fail('Es läuft bereits eine Aufnahme. Halte sie zuerst an.');

  const entry = timetracking.normalizeTime({
    ...raw,
    minutes: 0,
    startedAt: new Date().toISOString(),
    rateCents: raw.rateCents !== undefined && raw.rateCents !== null
      ? raw.rateCents
      : timetracking.rateFor(raw.projectId, data.projects, data.settings)
  });

  const saved = await store.create('times', entry, 'zeit');
  return done(saved);
});

handle('times:stop', async (id) => {
  const data = store.snapshot();
  const entry = store.get('times', id) || timetracking.running(data.times);
  if (!entry) return fail('Es läuft keine Aufnahme.');

  const stopped = timetracking.stop(entry, data.settings.time);
  const saved = await store.update('times', entry.id, stopped);
  return done(saved);
});

handle('times:overview', async ({ year } = {}) => {
  const data = store.snapshot();
  const list = (data.times || []).filter((entry) =>
    !year || String(entry.date).slice(0, 4) === String(year));

  return done({
    summary: timetracking.summarize(list),
    projects: timetracking.byProject(list, data.projects),
    months: timetracking.byMonth(list, Number(year) || Number(today().slice(0, 4))),
    running: timetracking.running(data.times),
    rounding: timetracking.ROUNDING
  });
});

/**
 * Macht aus offenen Zeiten einen Rechnungsentwurf.
 *
 * Die Zeiten werden erst mit dem Festschreiben der Rechnung als abgerechnet
 * markiert, nicht schon hier: ein verworfener Entwurf darf keine Stunden
 * verschlucken.
 */
handle('times:toInvoice', async ({ projectId, mode, customerId } = {}) => {
  const data = store.snapshot();
  const project = (data.projects || []).find((item) => item.id === projectId) || null;

  const open = (data.times || []).filter((entry) =>
    entry.billable && !entry.invoiceId && !entry.startedAt
    && (projectId ? entry.projectId === projectId : true));

  if (!open.length) return fail('Es gibt keine offenen Zeiten zum Abrechnen.');

  const items = timetracking.toInvoiceItems(open, {
    mode,
    vatRate: data.settings.invoice.defaultVatRate,
    unit: data.settings.time.unit,
    label: project ? `Leistungen ${project.name}` : 'Geleistete Stunden'
  });

  const draft = prepareInvoice({
    documentType: 'invoice',
    status: 'draft',
    customerId: customerId || (project ? project.customerId : null),
    projectId: projectId || null,
    segmentId: project ? project.segmentId : null,
    items
  });

  const saved = await store.create('invoices', draft, 're');

  // Die Zeiten merken sich die Rechnung sofort, damit sie nicht zweimal in
  // einen Entwurf geraten. Gelöscht wird der Entwurf, wird die Markierung
  // wieder entfernt.
  for (const entry of open) {
    await store.update('times', entry.id, { invoiceId: saved.id, invoicedAt: new Date().toISOString() });
  }

  return done({ invoice: saved, count: open.length, items: items.length });
});

/* ------------------------------------------------------------------ *
 * DATEV
 * ------------------------------------------------------------------ */

handle('datev:preview', async ({ year, chart } = {}) => {
  const data = store.snapshot();
  const result = datev.buildBookingBatch(data, Number(year) || Number(today().slice(0, 4)), { chart });

  return done({
    count: result.count,
    skipped: result.skipped,
    chart: result.chart,
    unmapped: result.unmapped,
    fileName: result.fileName,
    accounts: datev.accountMap(data.settings, chart),
    // Nur die Rahmen, die zu dieser Körperschaft passen.
    charts: datev.chartsFor(data.settings).map((item) => ({ id: item.id, label: item.label, hint: item.hint })),
    entity: datev.entityOf(data.settings),
    sphereCostCenters: datev.SPHERE_COST_CENTERS
  });
});

handle('datev:export', async ({ year, chart } = {}) => {
  const data = store.snapshot();
  const result = datev.buildBookingBatch(data, Number(year) || Number(today().slice(0, 4)), { chart });

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Buchungsstapel speichern',
    defaultPath: path.join(store.exportDir, result.fileName),
    filters: [{ name: 'DATEV CSV', extensions: ['csv'] }]
  });
  if (canceled || !filePath) return done(null);

  // DATEV erwartet Windows-1252, nicht UTF-8.
  await fsp.writeFile(filePath, gobd.toAnsi(result.content));
  return done({ file: filePath, count: result.count, skipped: result.skipped, unmapped: result.unmapped });
});

handle('datev:saveAccounts', async ({ chart, accounts, consultantId, clientId } = {}) => {
  const data = store.snapshot();
  const clean = {};
  for (const [key, value] of Object.entries(accounts || {})) {
    const account = String(value || '').trim();
    if (account) clean[key] = account;
  }

  const saved = await store.updateSettings({
    datev: {
      chart: datev.chartFor(data.settings, chart).id,
      consultantId: String(consultantId || '').trim(),
      clientId: String(clientId || '').trim(),
      accounts: clean
    }
  });
  return done(saved.datev);
});

/* ------------------------------------------------------------------ *
 * GoBD: Verfahrensdokumentation und Datenüberlassung
 * ------------------------------------------------------------------ */

handle('gobd:documentation', async () => {
  const data = store.snapshot();
  const active = profileState.activeProfile();

  const html = verfahrensdoku.build(data, {
    dataDir: store.dataDir,
    // Die Verschlüsselung gehört in die Verfahrensdokumentation: sie ist
    // Zugriffsschutz nach GoBD Rz. 103 und zugleich der Grund, warum die
    // Lesbarmachung nach §147 Abs. 5 AO am Schlüssel hängt.
    encrypted: Boolean(sessionKey),
    version: app.getVersion(),
    schemaVersion: data.schemaVersion,
    today: today(),
    profileName: active && profileState.currentProfiles().profiles.length > 1 ? active.name : null
  });

  const pdfBytes = await renderPdf(html);
  const stamp = today();
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Verfahrensdokumentation speichern',
    defaultPath: path.join(store.exportDir, `verfahrensdokumentation-${stamp}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return done(null);

  await fsp.writeFile(filePath, Buffer.from(pdfBytes));
  return done({ file: filePath, summary: verfahrensdoku.summarize(data) });
});

/**
 * Datenüberlassung nach §147 Abs. 6 AO.
 *
 * Geschrieben wird in einen eigenen Ordner, nicht in eine einzelne Datei: der
 * Beschreibungsstandard verlangt die index.xml neben den CSV-Dateien.
 */
handle('gobd:dataExport', async ({ year } = {}) => {
  const data = store.snapshot();

  const filtered = year ? filterYear(data, Number(year)) : data;
  const meta = {
    createdAt: new Date().toISOString(),
    from: year ? `${year}-01-01` : '',
    to: year ? `${year}-12-31` : ''
  };

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Zielordner für die Datenüberlassung wählen',
    defaultPath: store.exportDir,
    properties: ['openDirectory', 'createDirectory']
  });
  if (canceled || !filePaths.length) return done(null);

  const target = path.join(filePaths[0], `gobd-export-${year || 'gesamt'}-${today()}`);
  await fsp.mkdir(target, { recursive: true });

  const { files } = gobd.buildDataExport(filtered, meta);
  for (const file of files) {
    await fsp.writeFile(path.join(target, file.name), gobd.toAnsi(file.content));
  }

  return done({
    dir: target,
    files: files.map((file) => file.name),
    entries: filtered.entries.length,
    invoices: filtered.invoices.length
  });
});

/** Schneidet den Bestand auf ein Jahr zu, für den Export. */
function filterYear(data, year) {
  const inYear = (iso) => String(iso || '').slice(0, 4) === String(year);

  const entries = data.entries.filter((entry) => inYear(entry.paidDate || entry.date));
  const invoices = data.invoices.filter((doc) => inYear(doc.issueDate));
  const usedReceipts = new Set(entries.map((entry) => entry.receiptId).filter(Boolean));

  return {
    ...data,
    entries,
    invoices,
    receipts: data.receipts.filter((receipt) => usedReceipts.has(receipt.id))
  };
}

/* ------------------------------------------------------------------ *
 * Eingehende E-Rechnungen
 * ------------------------------------------------------------------ */

/**
 * Eine empfangene E-Rechnung lesen.
 *
 * Empfangen können muss sie jeder seit dem 1. Januar 2025, unabhängig von der
 * Größe und ohne Übergangsfrist. Gebucht wird trotzdem erst auf Bestätigung.
 */
handle('einvoice:choose', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Empfangene E-Rechnung auswählen',
    properties: ['openFile'],
    filters: [
      { name: 'E-Rechnung', extensions: ['xml', 'pdf'] },
      { name: 'Alle Dateien', extensions: ['*'] }
    ]
  });
  if (canceled || !filePaths.length) return done(null);

  const file = filePaths[0];
  const buffer = await fsp.readFile(file);
  const result = await einvoiceRead.read(buffer, path.basename(file));
  if (result.error) return fail(result.error);

  const data = store.snapshot();
  const existing = einvoiceRead.findExisting(result.invoice, data.entries);

  return done({
    file,
    fileName: path.basename(file),
    invoice: result.invoice,
    warnings: result.warnings,
    entry: einvoiceRead.toEntry(result.invoice, {}),
    existingEntryId: existing ? existing.id : null
  });
});

/** Legt die Buchung an und den Beleg dazu. */
handle('einvoice:commit', async ({ file, invoice, draft } = {}) => {
  if (!invoice) return fail('Es liegt keine gelesene Rechnung vor.');

  const data = store.snapshot();
  if (!draft.force && einvoiceRead.findExisting(invoice, data.entries)) {
    return fail('Diese Rechnung ist bereits gebucht.');
  }

  let receiptId = null;
  if (file && fs.existsSync(file)) {
    // Das Original wandert unverändert in die Belegablage: aufzubewahren ist
    // der strukturierte Datensatz, nicht ein Ausdruck davon.
    const stored = await receiptsLib.store(store.receiptDir, file, {
      date: invoice.issueDate || today(),
      counterparty: invoice.seller.name || '',
      note: `E-Rechnung ${invoice.number || ''}`.trim()
    }, sessionKey);
    const saved = await store.create('receipts', stored, 'beleg');
    receiptId = saved.id;
  }

  const raw = einvoiceRead.toEntry(invoice, draft || {});
  const entry = entriesDomain.normalizeEntry({ ...raw, receiptId });
  const errors = entriesDomain.validateEntry(entry);
  if (errors.length) return fail(errors.join(' '));

  const saved = await store.create('entries', {
    ...entry,
    receiptId,
    eInvoiceRef: raw.eInvoiceRef,
    eInvoiceNumber: invoice.number || ''
  }, 'buch');

  return done({ entry: saved, receiptId });
});

/* ------------------------------------------------------------------ *
 * Kontoauszug einlesen
 * ------------------------------------------------------------------ */

/**
 * Datei wählen, lesen, Vorschläge bauen.
 *
 * Die Datei wird gelesen und wieder losgelassen. Nichts davon landet im
 * Datenordner: ein Kontoauszug ist kein Beleg, und was die App braucht, steht
 * anschließend in den Buchungen.
 */
handle('bank:choose', async () => {
  const data = store.snapshot();
  const lastDir = (data.settings.bank && data.settings.bank.lastDir) || undefined;

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Kontoauszug auswählen',
    defaultPath: lastDir,
    properties: ['openFile'],
    filters: [
      { name: 'Kontoauszug', extensions: ['csv', 'txt'] },
      { name: 'Alle Dateien', extensions: ['*'] }
    ]
  });
  if (canceled || !filePaths.length) return done(null);

  const file = filePaths[0];
  const buffer = await fsp.readFile(file);
  if (buffer.length > 20 * 1024 * 1024) {
    return fail('Die Datei ist größer als zwanzig Megabyte. Das ist kein Kontoauszug mehr.');
  }

  const statement = bankimport.readStatement(buffer);
  const rows = bankimport.plan(statement.transactions, data, today());
  await store.updateSettings({ bank: { lastDir: path.dirname(file) } });

  return done({
    file,
    fileName: path.basename(file),
    encoding: statement.encoding,
    delimiter: statement.delimiter,
    headerRow: statement.headerRow,
    columns: statement.columns,
    warnings: statement.warnings,
    rows,
    summary: bankimport.summarize(rows)
  });
});

/**
 * Übernimmt die bestätigten Zeilen.
 *
 * Zwei Wege, je nach Absicht: eine Zahlung auf eine Rechnung wird wie über den
 * Knopf "Bezahlt" gebucht, alles andere wird eine gewöhnliche Buchung. Die
 * Prüfung auf schon Vorhandenes läuft hier noch einmal, weil zwischen Ansehen
 * und Übernehmen Zeit vergeht.
 */
handle('bank:commit', async (payload = {}) => {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) return fail('Es ist keine Zeile ausgewählt.');

  const data = store.snapshot();
  const known = new Set((data.entries || []).map((e) => e.bankRef).filter(Boolean));
  for (const invoice of data.invoices || []) {
    for (const payment of invoice.payments || []) if (payment.bankRef) known.add(payment.bankRef);
  }

  const result = { entries: 0, payments: 0, skipped: 0, rules: 0, problems: [] };
  const rules = [...(data.settings.bankRules || [])];

  for (const row of rows) {
    if (!row || !row.ref || known.has(row.ref)) {
      result.skipped += 1;
      continue;
    }
    const draft = row.draft || {};

    try {
      if (row.action === 'return') {
        const booked = await bookReturn(row, draft, data);
        if (booked.problem) {
          result.problems.push(`Zeile ${row.line}: ${booked.problem}`);
          continue;
        }
        result.returns = (result.returns || 0) + 1;
        result.entries += booked.created;
      } else if (row.action === 'payment' && draft.invoiceId) {
        const invoice = store.get('invoices', draft.invoiceId);
        if (!invoice) {
          result.problems.push(`Zeile ${row.line}: die Rechnung gibt es nicht mehr.`);
          continue;
        }
        await bookBankPayment(invoice, row);
        result.payments += 1;
      } else {
        const entry = entriesDomain.normalizeEntry(bankimport.toEntry(row, draft));
        const errors = entriesDomain.validateEntry(entry);
        if (errors.length) {
          result.problems.push(`Zeile ${row.line}: ${errors.join(' ')}`);
          continue;
        }
        // normalizeEntry kennt die Bankfelder nicht, sie werden angehängt.
        await store.create('entries', { ...entry, bankRef: row.ref, bankLine: row.line }, 'buch');
        result.entries += 1;
      }
      known.add(row.ref);

      if (draft.rememberRule) {
        const rule = bankimport.ruleFrom(row, draft);
        if (rule && !rules.some((r) => bankimport.normalizeText(r.match) === bankimport.normalizeText(rule.match))) {
          rules.push({ id: `rule_${Date.now()}_${rules.length}`, ...rule });
          result.rules += 1;
        }
      }
    } catch (err) {
      result.problems.push(`Zeile ${row.line}: ${err.message}`);
    }
  }

  if (result.rules) await store.updateSettings({ bankRules: rules });

  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  await store.create('imports', {
    fileName: payload.fileName || '',
    importedAt: new Date().toISOString(),
    rowCount: rows.length,
    entries: result.entries,
    payments: result.payments,
    skipped: result.skipped,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null
  }, 'imp');

  return done(result);
});

/**
 * Bucht eine zurückgekommene Lastschrift.
 *
 * Die Forderung wird nicht storniert, sondern wieder geöffnet: sie besteht ja
 * weiter, nur das Geld ist zurück. Die Gebühr der Bank trägt den
 * Bankverweis, damit dieselbe Auszugszeile nicht zweimal ankommt.
 */
async function bookReturn(row, draft, data) {
  const target = row.returnMatch && row.returnMatch.entryId
    ? store.get('entries', row.returnMatch.entryId)
    : null;

  if (row.returnMatch && !target) {
    return { problem: 'Die zugeordnete Forderung gibt es nicht mehr.' };
  }

  const member = target && target.memberId
    ? (data.members || []).find((item) => item.id === target.memberId)
    : null;

  const feeAmount = Math.max(0, Math.trunc(Number(draft.feeAmount) || 0));
  const plan = returnsDomain.toEntries({
    entry: target,
    member,
    detected: row.returned,
    date: row.date,
    feeAmount,
    chargeMember: Boolean(draft.chargeMember),
    feeCategoryId: draft.feeCategoryId || draft.categoryId || null,
    claimCategoryId: draft.claimCategoryId || null,
    sphereId: target ? target.sphereId : 'ideell'
  });

  let created = 0;

  if (plan.reopen) {
    await store.update('entries', plan.reopen.id, {
      paidDate: null,
      sepaRef: null,
      sepaExportedAt: null,
      returnedAt: plan.reopen.returnedAt,
      returnCode: plan.reopen.returnCode
    });
  }

  if (plan.fee) {
    const entry = entriesDomain.normalizeEntry(plan.fee);
    const errors = entriesDomain.validateEntry(entry);
    if (errors.length) return { problem: `Die Gebührenbuchung geht nicht: ${errors.join(' ')}` };
    await store.create('entries', { ...entry, bankRef: row.ref, bankLine: row.line }, 'buch');
    created += 1;
  }

  if (plan.claim) {
    const entry = entriesDomain.normalizeEntry(plan.claim);
    const errors = entriesDomain.validateEntry(entry);
    if (errors.length) return { problem: `Die Weiterberechnung geht nicht: ${errors.join(' ')}` };
    await store.create('entries', entry, 'buch');
    created += 1;
  }

  // Ohne Gebühr trägt keine Buchung den Bankverweis. Damit die Zeile beim
  // nächsten Einlesen nicht erneut erscheint, bekommt ihn dann die wieder
  // geöffnete Forderung.
  if (!plan.fee && plan.reopen) {
    await store.update('entries', plan.reopen.id, { bankRef: row.ref, bankLine: row.line });
  }

  return { created };
}

/** Bucht eine Bankzeile als Zahlung auf eine Rechnung. */
async function bookBankPayment(invoice, row) {
  const customer = store.get('customers', invoice.customerId) || {};
  const t = invoicesDomain.totals(invoice);
  const amount = Math.min(Math.abs(row.amount), t.openAmount) || Math.abs(row.amount);
  const dominant = [...t.vatBreakdown].sort((a, b) => b.base - a.base)[0] || { rate: 19, vatKey: null };

  const entry = entriesDomain.normalizeEntry({
    type: 'income',
    date: invoice.issueDate,
    paidDate: row.date,
    amount,
    basis: 'gross',
    vatRate: dominant.rate,
    vatKey: dominant.vatKey,
    categoryId: (row.draft && row.draft.categoryId) || 'inc_services',
    description: `Rechnung ${invoice.number}`,
    counterparty: customer.name || row.counterparty || '',
    paymentMethod: 'bank',
    segmentId: invoice.segmentId || null,
    projectId: invoice.projectId || null,
    customerId: invoice.customerId || null,
    invoiceId: invoice.id
  });

  const savedEntry = await store.create('entries', { ...entry, bankRef: row.ref, bankLine: row.line }, 'buch');
  const payments = [
    ...(invoice.payments || []),
    { date: row.date, amount, entryId: savedEntry.id, bankRef: row.ref, note: '' }
  ];
  await store.update('invoices', invoice.id, { payments });
}

/** Regeln pflegen: sie entstehen beim Übernehmen, geändert wird hier. */
handle('bank:saveRules', async (rules) => {
  const cleaned = (Array.isArray(rules) ? rules : [])
    .filter((rule) => rule && String(rule.match || '').trim() && rule.categoryId)
    .map((rule, index) => ({
      id: rule.id || `rule_${Date.now()}_${index}`,
      match: String(rule.match).trim(),
      type: rule.type === 'income' ? 'income' : 'expense',
      categoryId: rule.categoryId,
      segmentId: rule.segmentId || null,
      counterparty: String(rule.counterparty || '').trim()
    }));

  await store.updateSettings({ bankRules: cleaned });
  return done(cleaned);
});

/* ------------------------------------------------------------------ *
 * Wiederkehrende Buchungen und Rechnungen
 * ------------------------------------------------------------------ */

handle('recurring:save', async (raw) => {
  const template = recurring.normalize(raw || {});
  const errors = recurring.validate(template);
  if (errors.length) return fail(errors.join(' '));

  const saved = template.id
    ? await store.update('recurrences', template.id, template)
    : await store.create('recurrences', template, 'wdh');
  return done(saved);
});

handle('recurring:remove', async (id) => {
  await store.remove('recurrences', id);
  return done(true);
});

/**
 * Was steht an.
 *
 * Erzeugt wird hier noch nichts: die Oberfläche zeigt erst, was entstehen
 * würde, und legt es nach Bestätigung an.
 */
handle('recurring:due', async () => {
  const data = store.snapshot();
  const due = recurring.collectDue(data.recurrences, data, today());

  return done({
    groups: due.map((group) => ({
      templateId: group.template.id,
      label: group.template.label,
      kind: group.template.kind,
      dates: group.dates,
      items: group.items.map((item) => ({
        date: item.date,
        summary: summarizePreview(group.template, item.preview)
      }))
    })),
    count: due.reduce((sum, group) => sum + group.dates.length, 0)
  });
});

/** Kurzfassung eines geplanten Datensatzes für die Bestätigungsliste. */
function summarizePreview(template, preview) {
  if (template.kind === 'entry') {
    return {
      description: preview.description,
      counterparty: preview.counterparty,
      gross: preview.gross,
      type: preview.type,
      paid: Boolean(preview.paidDate)
    };
  }
  const t = invoicesDomain.totals(preview);
  const customer = store.get('customers', preview.customerId);
  return {
    description: `${doctypes.getType(preview.documentType).label} an ${customer ? customer.name : 'unbekannt'}`,
    counterparty: customer ? customer.name : '',
    gross: t.grossTotal,
    type: 'income',
    paid: false
  };
}

/**
 * Legt die fälligen Datensätze an.
 *
 * @param {object} payload  { templateId, dates } schränkt auf eine Auswahl ein
 */
handle('recurring:generate', async (payload = {}) => {
  const data = store.snapshot();
  const todayIso = today();
  const settings = data.settings;

  const templates = (data.recurrences || []).filter(
    (t) => !payload.templateId || t.id === payload.templateId
  );

  const created = { entries: [], invoices: [] };
  const warnings = [];

  for (const template of templates) {
    const existing = template.kind === 'entry' ? store.list('entries') : store.list('invoices');
    let dates = recurring.pendingDates(template, existing, todayIso);
    if (payload.dates && payload.dates.length) {
      dates = dates.filter((date) => payload.dates.includes(date));
    }

    for (const date of dates) {
      const record = recurring.materialize(template, date);

      if (template.kind === 'entry') {
        created.entries.push(await store.create('entries', record, 'buch'));
        continue;
      }

      const saved = await store.create('invoices', record, 're');

      if (!template.autoFinalize) {
        created.invoices.push(saved);
        continue;
      }

      // Festschreiben nur, wenn die Rechnung vollständig ist. Sonst bleibt sie
      // Entwurf und der Nutzer erfährt, woran es liegt.
      const customer = store.get('customers', saved.customerId) || {};
      const check = invoicesDomain.validateInvoice({ ...saved, number: 'vorläufig' }, company(), customer);
      if (check.errors.length) {
        warnings.push(`${template.label} vom ${date} bleibt Entwurf: ${check.errors.join(' ')}`);
        created.invoices.push(saved);
        continue;
      }

      const type = doctypes.typeOf(saved);
      const { counter } = await store.reserveNumber(type.id, saved.issueDate);
      const pattern = (settings.invoice.numberPatterns || {})[type.id] || type.defaultPattern;
      const number = invoicesDomain.buildNumber(pattern, counter, saved.issueDate, customer.customerNumber);

      created.invoices.push(await store.update('invoices', saved.id, {
        number,
        status: 'sent',
        finalizedAt: new Date().toISOString()
      }));
    }
  }

  return done({
    entries: created.entries.length,
    invoices: created.invoices.length,
    warnings
  });
});

/**
 * Überspringt Termine, ohne etwas anzulegen.
 *
 * Nötig, wenn eine Vorlage rückwirkend angelegt wird und die alten Monate
 * bereits von Hand gebucht sind. Vermerkt wird das als leerer Platzhalter, der
 * denselben Schutz gegen doppelte Erzeugung bietet.
 */
handle('recurring:skip', async ({ templateId, dates }) => {
  const template = store.get('recurrences', templateId);
  if (!template) return fail('Die Vorlage wurde nicht gefunden.');

  const skipped = [...(template.skipped || []), ...(dates || [])];
  await store.update('recurrences', templateId, { skipped: [...new Set(skipped)] });
  return done(skipped.length);
});

/* ------------------------------------------------------------------ *
 * Projekte und Geschäftsbereiche
 * ------------------------------------------------------------------ */

handle('projects:save', async (raw) => {
  const project = projectsDomain.normalizeProject(raw || {});
  const errors = projectsDomain.validateProject(project);
  if (errors.length) return fail(errors.join(' '));

  const saved = project.id
    ? await store.update('projects', project.id, project)
    : await store.create('projects', project, 'prj');
  return done(saved);
});

handle('projects:remove', async (id) => {
  const used = store.list('entries').some((e) => e.projectId === id)
    || store.list('invoices').some((i) => i.projectId === id);
  if (used) {
    return fail('An diesem Projekt hängen noch Buchungen oder Dokumente. Setze es lieber auf abgeschlossen.');
  }
  await store.remove('projects', id);
  return done(true);
});

handle('projects:totals', async (id) => {
  const data = store.snapshot();
  const project = store.get('projects', id);
  if (!project) return fail('Das Projekt wurde nicht gefunden.');

  const invoices = data.invoices.map((inv) => ({ ...inv, computed: invoicesDomain.totals(inv) }));
  return done(projectsDomain.projectTotals(project, invoices, data.entries, entriesDomain.taxEffect));
});

handle('segments:save', async (list) => {
  const normalized = (list || []).map((raw, i) => segments.normalizeSegment(raw, i));
  if (normalized.some((s) => !s.label)) return fail('Jeder Bereich braucht einen Namen.');
  if (!normalized.length) return fail('Mindestens ein Bereich muss bestehen bleiben.');

  const saved = await store.updateSettings({ segments: normalized });
  return done(saved.segments);
});

/* ------------------------------------------------------------------ *
 * Anlagen
 * ------------------------------------------------------------------ */

handle('assets:save', async (raw) => {
  const asset = assetsDomain.normalizeAsset(raw);
  if (!asset.label) return fail('Die Bezeichnung des Anlageguts fehlt.');
  if (!asset.purchaseDate) return fail('Das Anschaffungsdatum fehlt.');
  const saved = asset.id
    ? await store.update('assets', asset.id, asset)
    : await store.create('assets', asset, 'anl');
  return done(saved);
});

handle('assets:remove', async (id) => {
  const asset = store.get('assets', id);
  if (asset && asset.entryId) await store.update('entries', asset.entryId, { assetId: null }).catch(() => {});
  await store.remove('assets', id);
  return done(true);
});

handle('assets:schedule', async (id) => {
  const asset = store.get('assets', id);
  if (!asset) return fail('Das Anlagegut wurde nicht gefunden.');
  return done(assetsDomain.schedule(asset));
});

/* ------------------------------------------------------------------ *
 * Rechnungen
 * ------------------------------------------------------------------ */

function prepareInvoice(raw) {
  const settings = store.snapshot().settings;
  const documentType = raw.documentType || 'invoice';
  const base = invoicesDomain.emptyDocument(settings, today(), documentType);
  const invoice = { ...base, ...raw, documentType };
  invoice.items = (raw.items || []).map((item, i) => invoicesDomain.normalizeItem(item, i));
  invoice.currency = raw.currency || 'EUR';
  return invoice;
}

handle('invoices:validate', async (raw) => {
  const invoice = prepareInvoice(raw);
  const customer = store.get('customers', invoice.customerId) || {};
  // Gefragt wird hier immer dasselbe: lässt sich der Entwurf festschreiben?
  // Ein Entwurf hat naturgemäß noch keine Nummer, die kommt erst beim
  // Festschreiben. Ohne diesen Platzhalter meldete die Prüfung stets die
  // fehlende Nummer, und es ließ sich nichts festschreiben.
  const number = invoice.number || 'vorläufig';
  return done(invoicesDomain.validateInvoice({ ...invoice, number }, company(), customer));
});

handle('invoices:save', async (raw) => {
  const invoice = prepareInvoice(raw);
  const saved = invoice.id
    ? await store.update('invoices', invoice.id, invoice)
    : await store.create('invoices', { ...invoice, createdAt: new Date().toISOString() }, 're');
  return done(saved);
});

handle('invoices:remove', async (id) => {
  const invoice = store.get('invoices', id);
  if (!invoice) return fail('Das Dokument wurde nicht gefunden.');
  const type = doctypes.typeOf(invoice);
  if (invoice.status !== 'draft') {
    return doctypes.isOffer(invoice)
      ? fail('Versendete Angebote werden nicht gelöscht, sondern zurückgezogen. So bleibt die Nummernfolge lückenlos.')
      : fail('Gestellte Rechnungen werden nicht gelöscht, sondern storniert. Die Nummernfolge muss lückenlos bleiben.');
  }
  // Zeiten, die für diesen Entwurf reserviert waren, sind wieder offen.
  for (const entry of store.list('times').filter((item) => item.invoiceId === id)) {
    await store.update('times', entry.id, { invoiceId: null, invoicedAt: null });
  }

  await store.remove('invoices', id);
  return done(true);
});

/**
 * Vergibt die Nummer und macht aus dem Entwurf ein festes Dokument.
 * Ab hier ist die Nummer aus dem Kreis dieser Dokumentart vergeben und wird
 * nicht wiederverwendet.
 */
handle('invoices:finalize', async (raw) => {
  // Aufrufbar als reine Kennung oder als { id, number, status }: die eigene
  // Nummer braucht nur, wer ein Dokument aus einem früheren Jahr nacherfasst.
  const payload = typeof raw === 'string' ? { id: raw } : (raw || {});
  const id = payload.id;
  const invoice = store.get('invoices', id);
  if (!invoice) return fail('Das Dokument wurde nicht gefunden.');
  if (invoice.number) return done(invoice);

  const type = doctypes.typeOf(invoice);
  const customer = store.get('customers', invoice.customerId) || {};
  const check = invoicesDomain.validateInvoice({ ...invoice, number: 'vorläufig' }, company(), customer);
  if (check.errors.length) return fail(check.errors.join(' '));

  const settings = store.snapshot().settings;

  /**
   * Eine mitgebrachte Nummer beim Nacherfassen.
   *
   * Ein Dokument aus einem früheren Jahr trägt seine Nummer schon. Sie durch
   * eine neue zu ersetzen, hieße die alte Buchhaltung zu verfälschen. Der
   * Zähler des laufenden Kreises bleibt dabei unberührt, sonst entstünde dort
   * eine Lücke.
   */
  const eigene = String(payload.number || '').trim();
  if (eigene) {
    const doppelt = store.list('invoices').find((item) => item.id !== id && item.number === eigene);
    if (doppelt) return fail(`Die Nummer ${eigene} ist schon vergeben.`);

    const saved = await store.update('invoices', id, {
      number: eigene,
      status: payload.status || 'sent',
      finalizedAt: new Date().toISOString()
    });
    return done(saved);
  }

  const { counter } = await store.reserveNumber(type.id, invoice.issueDate);
  const pattern = (settings.invoice.numberPatterns || {})[type.id] || type.defaultPattern;
  const number = invoicesDomain.buildNumber(pattern, counter, invoice.issueDate, customer.customerNumber);

  const saved = await store.update('invoices', id, { number, status: 'sent', finalizedAt: new Date().toISOString() });
  return done(saved);
});

/** Setzt den Status eines Angebots: angenommen, abgelehnt, zurückgezogen. */
handle('offers:setStatus', async ({ id, status }) => {
  const offer = store.get('invoices', id);
  if (!offer) return fail('Das Angebot wurde nicht gefunden.');
  if (!doctypes.isOffer(offer)) return fail('Dieser Vorgang gilt nur für Angebote und Kostenvoranschläge.');
  if (!['sent', 'accepted', 'declined', 'cancelled'].includes(status)) return fail('Unbekannter Status.');
  if (!offer.number) return fail('Das Angebot ist noch ein Entwurf.');

  const saved = await store.update('invoices', id, { status, statusChangedAt: new Date().toISOString() });
  return done(saved);
});

/**
 * Macht aus einem Angebot eine Rechnung.
 *
 * Das Angebot bleibt unangetastet und gilt danach als abgerechnet. Die Rechnung
 * entsteht als Entwurf mit denselben Positionen und verweist auf das Angebot.
 */
handle('offers:convertToInvoice', async (id) => {
  const offer = store.get('invoices', id);
  if (!offer) return fail('Das Angebot wurde nicht gefunden.');
  if (!doctypes.isOffer(offer)) return fail('Nur Angebote und Kostenvoranschläge lassen sich umwandeln.');
  if (!offer.number) return fail('Bitte das Angebot zuerst festschreiben.');
  if (offer.convertedToInvoiceId) {
    const existing = store.get('invoices', offer.convertedToInvoiceId);
    if (existing) return fail(`Aus diesem Angebot ist bereits ${existing.number || 'ein Rechnungsentwurf'} entstanden.`);
  }

  const settings = store.snapshot().settings;
  const base = invoicesDomain.emptyDocument(settings, today(), 'invoice');
  const sourceType = doctypes.typeOf(offer);

  const invoice = {
    ...base,
    customerId: offer.customerId,
    items: offer.items,
    buyerReference: offer.buyerReference,
    orderReference: offer.orderReference || offer.number,
    salutation: offer.salutation,
    currency: offer.currency || 'EUR',
    fromOfferId: offer.id,
    fromOfferNumber: offer.number,
    note: `Entstanden aus ${sourceType.label} ${offer.number}.`,
    createdAt: new Date().toISOString()
  };

  const created = await store.create('invoices', invoice, 're');
  await store.update('invoices', id, { status: 'invoiced', convertedToInvoiceId: created.id });

  const hint = sourceType.nonBinding
    ? 'Der Kostenvoranschlag war unverbindlich. Prüfe die Positionen gegen den tatsächlichen Aufwand, bevor du die Rechnung festschreibst.'
    : null;

  return done({ invoice: created, hint });
});

handle('invoices:duplicate', async (id) => {
  const invoice = store.get('invoices', id);
  if (!invoice) return fail('Die Rechnung wurde nicht gefunden.');
  const copy = {
    ...invoice,
    id: null,
    number: null,
    status: 'draft',
    issueDate: today(),
    deliveryDate: today(),
    dueDate: invoicesDomain.addDays(today(), invoice.paymentTermsDays || 14),
    payments: [],
    finalizedAt: null,
    entryId: null,
    createdAt: new Date().toISOString()
  };
  delete copy.computed;
  delete copy.resolvedStatus;
  const saved = await store.create('invoices', copy, 're');
  return done(saved);
});

/**
 * Storniert eine festgeschriebene Rechnung.
 *
 * Gelöscht wird nichts: die Originalrechnung bleibt stehen und gilt als
 * storniert, dazu entsteht eine Stornorechnung als Entwurf mit denselben
 * Positionen. Sie bekommt beim Festschreiben ihre eigene Nummer aus demselben
 * Kreis, damit die Nummernfolge lückenlos bleibt.
 */
handle('invoices:cancel', async (id) => {
  const invoice = store.get('invoices', id);
  if (!invoice) return fail('Die Rechnung wurde nicht gefunden.');
  if (!invoice.number) return fail('Ein Entwurf wird nicht storniert, sondern gelöscht.');
  if (invoice.status === 'cancelled') return fail('Diese Rechnung ist bereits storniert.');

  const reversal = {
    ...invoice,
    id: null,
    number: null,
    documentType: 'creditnote',
    status: 'draft',
    issueDate: today(),
    deliveryDate: invoice.deliveryDate,
    dueDate: today(),
    payments: [],
    finalizedAt: null,
    cancelsInvoiceId: invoice.id,
    cancelsInvoiceNumber: invoice.number,
    intro: `Storno zur Rechnung ${invoice.number} vom ${invoice.issueDate.split('-').reverse().join('.')}.`,
    bodyText: (store.snapshot().settings.texts.creditnote || {}).body || '',
    createdAt: new Date().toISOString()
  };
  delete reversal.computed;
  delete reversal.resolvedStatus;

  const created = await store.create('invoices', reversal, 're');
  await store.update('invoices', id, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledByInvoiceId: created.id });

  const paid = invoicesDomain.totals(invoice).paid;
  return done({
    invoice: created,
    hint: paid
      ? 'Zu der stornierten Rechnung ist bereits Geld geflossen. Sobald du es zurückzahlst, erfasse das als eigene Buchung, sonst bleibt die Einnahme in der EÜR stehen.'
      : null
  });
});

handle('invoices:addPayment', async ({ id, date, amount, note }) => {
  const invoice = store.get('invoices', id);
  if (!invoice) return fail('Die Rechnung wurde nicht gefunden.');
  const payments = [...(invoice.payments || []), { date, amount: Math.trunc(Number(amount) || 0), note: note || '' }];
  const saved = await store.update('invoices', id, { payments });
  return done(saved);
});

/**
 * Trägt eine Zahlung ein und legt zugleich die passende Einnahme an.
 * Das ist der Weg, auf dem eine Rechnung in der EÜR und in der
 * Umsatzsteuer ankommt.
 */
handle('invoices:bookPayment', async ({ id, date, amount, paymentMethod, categoryId }) => {
  const invoice = store.get('invoices', id);
  if (!invoice) return fail('Die Rechnung wurde nicht gefunden.');
  const customer = store.get('customers', invoice.customerId) || {};
  const t = invoicesDomain.totals(invoice);
  const paidAmount = Math.trunc(Number(amount) || 0) || t.openAmount;

  // Der Steuersatz der Buchung folgt der größten Steuergruppe der Rechnung.
  const dominant = [...t.vatBreakdown].sort((a, b) => b.base - a.base)[0] || { rate: 19, vatKey: null };

  const entry = entriesDomain.normalizeEntry({
    type: 'income',
    date: invoice.issueDate,
    paidDate: date || today(),
    amount: paidAmount,
    basis: 'gross',
    vatRate: dominant.rate,
    vatKey: dominant.vatKey,
    categoryId: categoryId || 'inc_services',
    description: `Rechnung ${invoice.number}`,
    counterparty: customer.name || '',
    paymentMethod: paymentMethod || 'bank',
    invoiceId: invoice.id
  });

  const savedEntry = await store.create('entries', entry, 'buch');
  const payments = [...(invoice.payments || []), { date: entry.paidDate, amount: paidAmount, entryId: savedEntry.id, note: '' }];
  const savedInvoice = await store.update('invoices', id, { payments });

  return done({ invoice: savedInvoice, entry: savedEntry });
});

/* ------------------------------------------------------------------ *
 * Rechnungsausgabe: PDF, ZUGFeRD, XRechnung
 * ------------------------------------------------------------------ */

/**
 * Ordner für Belege, die zum Ansehen kurz entschlüsselt werden.
 *
 * Eigener Ordner je Programmlauf, damit er sich am Ende restlos entfernen
 * lässt. Beim nächsten Start ist nichts mehr da, was ein fremdes Programm im
 * temporären Verzeichnis liegen gelassen haben könnte.
 */
/** Rendert HTML in einem unsichtbaren Fenster zu PDF. */
async function renderPdf(html) {
  const tmpFile = path.join(os.tmpdir(), `nestegg-${Date.now()}.html`);
  await fsp.writeFile(tmpFile, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, contextIsolation: true, nodeIntegration: false }
  });

  try {
    await win.loadFile(tmpFile);
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: true
    });
  } finally {
    win.destroy();
    await fsp.unlink(tmpFile).catch(() => {});
  }
}

function invoiceFileBase(invoice, customer) {
  const number = String(invoice.number || 'entwurf').replace(/[^\w.-]/g, '-');
  const name = String(customer.name || '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 30);
  return [number, name].filter(Boolean).join('_');
}

/**
 * Erzeugt das Rechnungs-PDF.
 * format: 'pdf' für ein reines Sicht-PDF, 'zugferd' mit eingebettetem CII-XML.
 */
handle('invoices:pdf', async ({ id, format }) => {
  const invoice = store.get('invoices', id);
  if (!invoice) return fail('Das Dokument wurde nicht gefunden.');
  const type = doctypes.typeOf(invoice);
  if (!invoice.number) return fail(`${type.label} hat noch keine Nummer. Bitte zuerst festschreiben.`);

  const customer = store.get('customers', invoice.customerId) || {};
  const settings = store.snapshot().settings;
  const check = invoicesDomain.validateInvoice(invoice, company(), customer);
  if (check.errors.length) return fail(check.errors.join(' '));

  const html = documentHtml.render(
    invoice,
    await companyForDocument(),
    customer,
    { theme: settings.theme }
  );
  let pdfBytes = await renderPdf(html);

  // Nur Rechnungen und Stornorechnungen tragen ein Rechnungs-XML. Für ein
  // Angebot gibt es in EN 16931 nichts einzubetten.
  const wantsZugferd = type.supportsEInvoice && (format || settings.eInvoice.defaultFormat) === 'zugferd';
  if (wantsZugferd) {
    const xml = cii.build(invoice, company(), customer, { profile: settings.eInvoice.profile });
    pdfBytes = await pdfa.embedInvoiceXml(pdfBytes, xml, {
      title: `${type.label} ${invoice.number}`,
      author: company().name,
      subject: `${type.label} ${invoice.number} an ${customer.name || ''}`.trim()
    });
  }

  const base = invoiceFileBase(invoice, customer);
  const suffix = wantsZugferd ? '_zugferd' : '';
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: wantsZugferd ? 'ZUGFeRD-Rechnung speichern' : `${type.label} als PDF speichern`,
    defaultPath: path.join(store.exportDir, `${base}${suffix}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return done(null);

  await fsp.writeFile(filePath, Buffer.from(pdfBytes));
  return done({ file: filePath, format: wantsZugferd ? 'zugferd' : 'pdf' });
});

/** Schreibt das reine XML: XRechnung als UBL oder das CII des ZUGFeRD-Profils. */
handle('invoices:xml', async ({ id, flavour }) => {
  const invoice = store.get('invoices', id);
  if (!invoice) return fail('Das Dokument wurde nicht gefunden.');
  const type = doctypes.typeOf(invoice);
  if (!type.supportsEInvoice) {
    return fail(`Für ${type.article} ${type.label} gibt es kein E-Rechnungsformat. EN 16931 beschreibt nur Rechnungen.`);
  }
  if (!invoice.number) return fail(`${type.label} hat noch keine Nummer. Bitte zuerst festschreiben.`);

  const customer = store.get('customers', invoice.customerId) || {};
  const settings = store.snapshot().settings;
  const check = invoicesDomain.validateInvoice(invoice, company(), customer);
  if (check.errors.length) return fail(check.errors.join(' '));

  const isUbl = (flavour || 'xrechnung') === 'xrechnung';
  const xml = isUbl
    ? ubl.build(invoice, company(), customer, { customization: settings.eInvoice.xrechnungCustomization })
    : cii.build(invoice, company(), customer, { profile: settings.eInvoice.profile });

  const base = invoiceFileBase(invoice, customer);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: isUbl ? 'XRechnung speichern' : 'CII-XML speichern',
    defaultPath: path.join(store.exportDir, `${base}${isUbl ? '_xrechnung' : '_cii'}.xml`),
    filters: [{ name: 'XML', extensions: ['xml'] }]
  });
  if (canceled || !filePath) return done(null);

  await fsp.writeFile(filePath, xml, 'utf8');
  return done({ file: filePath, warnings: check.warnings });
});

/* ------------------------------------------------------------------ *
 * Gestaltung der Dokumente
 * ------------------------------------------------------------------ */

/** Ein erfundenes Dokument, an dem sich das Aussehen beurteilen lässt. */
function sampleDocument(documentType, settings) {
  const type = doctypes.getType(documentType);
  const texts = (settings.texts || {})[type.id] || {};
  const offer = type.group === 'offer';

  return {
    number: invoicesDomain.buildNumber(
      (settings.invoice.numberPatterns || {})[type.id] || type.defaultPattern,
      42,
      today(),
      '0001'
    ),
    documentType: type.id,
    issueDate: today(),
    deliveryDate: offer ? null : today(),
    dueDate: offer ? null : invoicesDomain.addDays(today(), settings.invoice.paymentTermsDays || 14),
    validUntil: offer ? invoicesDomain.addDays(today(), 30) : null,
    tolerancePercent: type.nonBinding ? settings.invoice.estimateTolerance || 15 : null,
    showSignature: offer,
    currency: 'EUR',
    payments: [],
    salutation: settings.invoice.salutation || '',
    intro: texts.intro || '',
    bodyText: texts.body || '',
    outro: texts.outro || '',
    items: [
      { name: 'Konzeption und Beratung', description: 'Workshop, Ausarbeitung und Abstimmung', quantity: 12, unit: 'HUR', unitPriceNet: 12000, vatRate: 19, discountPercent: 0 },
      { name: 'Umsetzung', quantity: 1, unit: 'LS', unitPriceNet: 180000, vatRate: 19, discountPercent: 10 },
      { name: 'Material, weiterberechnet', quantity: 4, unit: 'C62', unitPriceNet: 2500, vatRate: 7, discountPercent: 0 }
    ]
  };
}

const SAMPLE_CUSTOMER = {
  name: 'Kundenfirma GmbH',
  contactName: 'Frau Muster',
  customerNumber: 'K-001',
  street: 'Kundenallee 7',
  zip: '20095',
  city: 'Hamburg',
  country: 'DE'
};

/**
 * Liefert das fertige Dokument-HTML für die Vorschau im Gestaltungsdialog.
 * Gerendert wird mit derselben Funktion wie das PDF, damit die Vorschau nicht
 * irgendwann etwas anderes zeigt als das gedruckte Dokument.
 */
handle('theme:preview', async ({ theme, documentType, documentId }) => {
  const settings = store.snapshot().settings;
  const merged = themeLib.normalizeTheme({ ...settings.theme, ...(theme || {}) });

  let document = null;
  let customer = SAMPLE_CUSTOMER;

  if (documentId) {
    const found = store.get('invoices', documentId);
    if (found) {
      document = found;
      customer = store.get('customers', found.customerId) || SAMPLE_CUSTOMER;
    }
  }
  if (!document) document = sampleDocument(documentType || 'invoice', settings);

  const html = documentHtml.render(
    document,
    await companyForDocument(),
    customer,
    { theme: merged, preview: true }
  );

  // Das CSS kommt zusätzlich einzeln. Beim Schieben eines Reglers tauscht die
  // Vorschau dann nur das Stylesheet aus, statt die Seite neu aufzubauen. Das
  // spart den Sprung nach oben und das Flackern.
  return done({
    html,
    css: documentCss.buildCss(merged, { preview: true }),
    theme: merged,
    preset: themeLib.detectPreset(merged)
  });
});

/** Setzt eine Vorlage, ohne Ränder, Logo und Fußnote zu überschreiben. */
handle('theme:applyPreset', async ({ theme, presetId }) => {
  const settings = store.snapshot().settings;
  const base = { ...settings.theme, ...(theme || {}) };
  return done(themeLib.applyPreset(base, presetId));
});

handle('theme:save', async (theme) => {
  const normalized = themeLib.normalizeTheme(theme || {});
  normalized.preset = themeLib.detectPreset(normalized);
  await store.updateSettings({ theme: normalized });
  return done(normalized);
});

handle('theme:reset', async () => {
  await store.updateSettings({ theme: { ...themeLib.DEFAULT_THEME } });
  return done(themeLib.DEFAULT_THEME);
});

/* ------------------------------------------------------------------ *
 * Einstellungen
 * ------------------------------------------------------------------ */

handle('settings:update', async (patch) => {
  const saved = await store.updateSettings(patch || {});
  return done(saved);
});

handle('settings:chooseLogo', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Logo auswählen',
    properties: ['openFile'],
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }]
  });
  if (canceled || !filePaths.length) return done(null);
  await store.updateSettings({ company: { logoPath: filePaths[0] } });
  return done(filePaths[0]);
});

/** Die eingescannte Unterschrift. Am besten freigestellt als PNG. */
handle('settings:chooseSignature', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Unterschrift auswählen',
    properties: ['openFile'],
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }]
  });
  if (canceled || !filePaths.length) return done(null);

  const current = company().signature || {};
  await store.updateSettings({ company: { signature: { ...current, imagePath: filePaths[0] } } });
  return done(filePaths[0]);
});

handle('settings:chooseDataDir', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Datenordner wählen',
    properties: ['openDirectory', 'createDirectory']
  });
  if (canceled || !filePaths.length) return done(null);

  const target = filePaths[0];
  const answer = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Abbrechen', 'Ordner wechseln'],
    defaultId: 0,
    cancelId: 0,
    message: 'Datenordner wechseln?',
    detail: `Die App arbeitet danach mit den Daten in:\n${target}\n\nDie bisherigen Daten bleiben unangetastet in:\n${store.dataDir}\n\nDie App wird neu gestartet.`
  });
  if (answer.response !== 1) return done(null);

  writeConfig({ ...readConfig(), dataDir: target });
  app.relaunch();
  app.exit(0);
  return done(target);
});

handle('settings:openDataDir', async () => {
  await shell.openPath(store.dataDir);
  return done(true);
});

handle('settings:backup', async () => {
  const file = await backupDialog();
  return done(file ? { file } : null);
});
