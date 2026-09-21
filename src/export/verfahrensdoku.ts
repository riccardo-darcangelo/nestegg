// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { escapeText as esc } from './xml';
import { formatEuro } from '../domain/money';
import { DOCUMENT_TYPES } from '../domain/doctypes';
import type { IsoDate, Snapshot } from '../shared/types';

/**
 * The process documentation the GoBD ask for.
 *
 * It describes how a receipt arises, is recorded, booked and kept, and in a
 * way that lets a stranger follow the process in reasonable time. That is
 * exactly what the GoBD demand.
 *
 * The text comes from the actual state of this installation: the chosen way of
 * taxation, the number ranges, where things are filed, the schema version, the
 * volumes. A template off the web describes someone else's bookkeeping, this
 * document describes your own. What the app cannot know stands in it as a gap
 * to fill in rather than being invented.
 */

const CSS = `
  @page { size: A4; margin: 22mm 20mm 20mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 10.5pt; line-height: 1.55; color: #1a1d23; margin: 0; background: #fff;
  }
  h1 { font-size: 20pt; margin: 0 0 4pt; letter-spacing: -0.2pt; }
  h2 {
    font-size: 13pt; margin: 20pt 0 6pt; padding-bottom: 3pt;
    border-bottom: 0.5pt solid #c9ced8; page-break-after: avoid;
  }
  h3 { font-size: 11pt; margin: 14pt 0 4pt; page-break-after: avoid; }
  p { margin: 0 0 7pt; }
  ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
  li { margin-bottom: 3pt; }
  .sub { color: #5b6270; font-size: 9.5pt; margin-bottom: 18pt; }
  table { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 9.5pt; }
  th, td { text-align: left; padding: 4pt 6pt; border-bottom: 0.4pt solid #d8dce4; vertical-align: top; }
  th { background: #f1f3f7; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .gap {
    background: #fff6d8; border: 0.4pt solid #e2c15a; padding: 1pt 4pt;
    font-style: italic; color: #6b5310;
  }
  .note {
    background: #f1f5fb; border-left: 2pt solid #5b7fb8;
    padding: 7pt 10pt; margin: 8pt 0 12pt; font-size: 9.5pt;
  }
  .foot { margin-top: 26pt; padding-top: 8pt; border-top: 0.4pt solid #d8dce4; font-size: 8.5pt; color: #5b6270; }
  .sign { margin-top: 30pt; display: flex; gap: 40pt; }
  .sign div { flex: 1; border-top: 0.4pt solid #1a1d23; padding-top: 4pt; font-size: 9pt; }
`;

/** Eine Lücke, die nur der Nutzer füllen kann. */
/** A blank the reader has to fill in, marked so it cannot be overlooked. */
function gap(hint: string): string {
  return `<span class="gap">${esc(hint)}</span>`;
}

function orGap(value: unknown, hint: string): string {
  const text = String(value ?? '').trim();
  return text ? esc(text) : gap(hint);
}

function formatDate(iso: IsoDate | null | undefined): string {
  if (!iso) return '';
  const [year, month, day] = String(iso).slice(0, 10).split('-');
  return `${day}.${month}.${year}`;
}

export interface DocumentationMeta {
  dataDir?: string;
  /** Access protection under GoBD Rz. 103, and why readability hangs on the key. */
  encrypted?: boolean;
  version?: string;
  schemaVersion?: number;
  today?: IsoDate;
  profileName?: string;
}

/** Builds the process documentation as HTML. */
export function build(data: Snapshot, meta: DocumentationMeta = {}): string {
  const settings = data.settings;
  const company = settings.company;
  const { tax } = settings;
  const today = meta.today ?? new Date().toISOString().slice(0, 10);

  const counts = {
    entries: (data.entries || []).length,
    invoices: (data.invoices || []).length,
    receipts: (data.receipts || []).length,
    customers: (data.customers || []).length,
    assets: (data.assets || []).length,
    recurrences: (data.recurrences || []).length,
    imports: (data.imports || []).length
  };

  const years = new Set();
  for (const entry of data.entries || []) {
    if (entry.paidDate) years.add(entry.paidDate.slice(0, 4));
    else if (entry.date) years.add(entry.date.slice(0, 4));
  }
  const yearList = [...years].sort();

  const vatModeLabel = tax.vatMethod === 'soll'
    ? 'Soll-Versteuerung: die Umsatzsteuer entsteht mit der Leistung'
    : 'Ist-Versteuerung nach §20 UStG: die Umsatzsteuer entsteht mit dem Zahlungseingang';

  const periods: Record<string, string> = {
    monthly: 'monatlich', quarterly: 'vierteljährlich', yearly: 'jährlich'
  };
  const periodLabel = periods[String(tax.vatPeriod ?? '')] ?? String(tax.vatPeriod ?? '');

  const invoiceSettings = (settings.invoice ?? {}) as Record<string, Record<string, unknown>>;
  const numberCircles = Object.entries(invoiceSettings.numberPatterns ?? {})
    .map(([type, pattern]) => {
      const label = DOCUMENT_TYPES[type as keyof typeof DOCUMENT_TYPES]?.label ?? type;
      const counters = (invoiceSettings.counters ?? {})[type] as Record<string, unknown> ?? {};
      const state = Object.entries(counters)
        .map(([year, value]) => `${year}: ${value}`)
        .join(', ');
      return `<tr><td>${esc(label)}</td><td><code>${esc(pattern)}</code></td><td>${esc(state || 'noch keine Nummer vergeben')}</td></tr>`;
    }).join('');

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Verfahrensdokumentation ${esc(company.name || '')}</title>
<style>${CSS}</style>
</head>
<body>

<h1>Verfahrensdokumentation</h1>
<div class="sub">
  ${orGap(company.name, 'Firmenname fehlt in den Einstellungen')}
  ${company.owner ? ` &middot; ${esc(company.owner)}` : ''}
  &middot; Stand ${formatDate(today)}
</div>

<div class="note">
  Diese Dokumentation beschreibt, wie in diesem Betrieb Belege entstehen, erfasst,
  verbucht und aufbewahrt werden. Sie folgt den Grundsätzen zur ordnungsmäßigen
  Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in
  elektronischer Form sowie zum Datenzugriff (GoBD).
  Gelb hinterlegte Stellen sind vom Verfasser zu ergänzen: sie beschreiben
  Abläufe außerhalb der Software, die kein Programm kennen kann.
</div>

<h2>1. Allgemeine Beschreibung</h2>

<h3>1.1 Unternehmen</h3>
<table>
  <tr><th style="width:32%">Bezeichnung</th><td>${orGap(company.name, 'Firmenname')}</td></tr>
  <tr><th>Inhaber</th><td>${orGap(company.owner, 'Name des Inhabers')}</td></tr>
  <tr><th>Anschrift</th><td>${orGap([company.street, [company.zip, company.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), 'Anschrift')}</td></tr>
  <tr><th>Steuernummer</th><td>${orGap(company.taxNumber, 'Steuernummer')}</td></tr>
  <tr><th>USt-IdNr.</th><td>${orGap(company.vatId, 'falls vorhanden')}</td></tr>
  <tr><th>Tätigkeit</th><td>${gap('Kurze Beschreibung der Geschäftstätigkeit, etwa: Entwicklung und Betrieb von Software im Abonnement')}</td></tr>
  <tr><th>Mitarbeiter</th><td>${gap('Anzahl, oder: keine')}</td></tr>
</table>

<h3>1.2 Gewinnermittlung und Besteuerung</h3>
<ul>
  <li>Gewinnermittlung durch <strong>Einnahmenüberschussrechnung</strong> nach §4 Abs. 3 EStG. Es wird keine doppelte Buchführung geführt und keine Bilanz erstellt.</li>
  <li>Es gilt das Zu- und Abflussprinzip nach §11 EStG: maßgeblich ist der Tag der Zahlung, nicht der Rechnung. Ausnahme ist die Zehn-Tage-Regel für regelmäßig wiederkehrende Zahlungen um den Jahreswechsel; sie wird in der Software über ein abweichendes Steuerjahr an der einzelnen Buchung abgebildet.</li>
  <li>Umsatzsteuer: ${esc(vatModeLabel)}.</li>
  <li>Der Vorsteuerabzug wird nach dem ${tax.inputVatBasis === 'payment' ? 'Zahlungsdatum' : 'Rechnungsdatum'} abgegrenzt, weil er an Leistung und Rechnung geknüpft ist.</li>
  <li>Voranmeldungen werden ${esc(periodLabel)} abgegeben${tax.dauerfristverlaengerung ? ', mit Dauerfristverlängerung nach §§46 bis 48 UStDV' : ''}.</li>
  <li>Steuerliche Stellung: ${tax.scheme === 'klein' ? 'Kleinunternehmer nach §19 UStG' : 'Regelbesteuerung'}.</li>
</ul>

<h3>1.3 Mengengerüst</h3>
<table>
  <tr><th>Buchungen</th><td class="num">${counts.entries}</td><th>Erfasste Jahre</th><td>${esc(yearList.join(', ') || 'keine')}</td></tr>
  <tr><th>Ausgangsdokumente</th><td class="num">${counts.invoices}</td><th>Kunden</th><td class="num">${counts.customers}</td></tr>
  <tr><th>Belegdateien</th><td class="num">${counts.receipts}</td><th>Anlagegüter</th><td class="num">${counts.assets}</td></tr>
  <tr><th>Wiederkehrende Vorlagen</th><td class="num">${counts.recurrences}</td><th>Eingelesene Kontoauszüge</th><td class="num">${counts.imports}</td></tr>
</table>

<h2>2. Anwenderdokumentation: der Weg eines Belegs</h2>

<h3>2.1 Ausgangsrechnungen</h3>
<ol>
  <li>Ein Dokument entsteht in der Software zunächst als <strong>Entwurf</strong> und trägt noch keine Nummer. Ein Entwurf ist frei änderbar und löschbar.</li>
  <li>Mit dem <strong>Festschreiben</strong> wird die nächste Nummer des jeweiligen Kreises vergeben. Vor der Vergabe prüft die Software die Pflichtangaben nach §14 UStG; fehlt eine, bleibt das Dokument Entwurf.</li>
  <li>Ein festgeschriebenes Dokument ist in der Oberfläche nicht mehr änderbar. Korrekturen laufen ausschließlich über eine <strong>Stornorechnung</strong>, die auf die ursprüngliche Nummer verweist. Die stornierte Rechnung bleibt im Bestand und wird als storniert gekennzeichnet.</li>
  <li>Die Ausgabe erfolgt als PDF, als ZUGFeRD-PDF mit eingebettetem CII-XML oder als XRechnung im UBL-Format. Die erzeugten Dateien liegen im Unterordner <code>exporte</code>.</li>
  <li>Versand: ${gap('Wie werden die Rechnungen versendet? Etwa: per E-Mail aus dem Mailprogramm, Kopie im Ordner exporte')}</li>
</ol>

<h3>2.2 Nummernkreise</h3>
<p>Jede Dokumentart führt einen eigenen, lückenlos aufsteigenden Kreis je Jahr. Die Zähler werden beim Festschreiben erhöht und nie zurückgesetzt.</p>
<table>
  <tr><th>Art</th><th>Muster</th><th>Stand der Zähler</th></tr>
  ${numberCircles || '<tr><td colspan="3">keine</td></tr>'}
</table>

<h3>2.3 Eingangsbelege</h3>
<ol>
  <li>Eingehende Rechnungen erreichen den Betrieb ${gap('auf welchen Wegen? Etwa: per E-Mail, als Download aus Kundenportalen, selten auf Papier')}.</li>
  <li><strong>Elektronische Rechnungen</strong> (XRechnung, ZUGFeRD) werden in der Software eingelesen. Der strukturierte Datensatz wird ausgewertet, die empfangene Datei unverändert in der Belegablage gespeichert. Aufbewahrt wird damit das Original, nicht ein Ausdruck.</li>
  <li><strong>Papierbelege</strong> werden ${gap('eingescannt mit ... und danach ... / kommen nicht vor')}. Der Scan wird der Buchung als Beleg angehängt.</li>
  <li>Jede Belegdatei wird beim Anhängen in den Ordner <code>belege/&lt;Jahr&gt;</code> kopiert und nach Datum und Gegenpartei benannt. Gleichnamige Dateien überschreiben einander nicht.</li>
  <li>Von jeder Belegdatei wird beim Ablegen eine <strong>SHA-256-Prüfsumme</strong> gebildet und gespeichert. Damit lässt sich jederzeit zeigen, dass die Datei seit der Ablage unverändert ist. Die Software prüft das auf Knopfdruck.</li>
</ol>

<h3>2.4 Erfassung der Geschäftsvorfälle</h3>
<ul>
  <li><strong>Von Hand</strong> in der Ansicht Buchungen. Jede Buchung trägt ein Belegdatum und, sobald gezahlt wurde, ein Zahlungsdatum.</li>
  <li><strong>Aus dem Kontoauszug</strong>: Die CSV-Datei des Onlinebankings wird eingelesen. Die Software schlägt je Zeile eine Buchung vor und erkennt Zahlungen auf offene Rechnungen an der Rechnungsnummer im Verwendungszweck. <strong>Gebucht wird nur, was bestätigt wird</strong>; die Software bucht nichts selbsttätig. Jede so entstandene Buchung trägt einen Fingerabdruck der Auszugszeile, der eine doppelte Erfassung verhindert.</li>
  <li><strong>Aus wiederkehrenden Vorlagen</strong> für gleichbleibende Vorgänge. Auch hier entsteht nichts im Hintergrund: die Software zeigt, was fällig ist, und legt es erst nach Bestätigung an.</li>
  <li>Die zeitgerechte Erfassung erfolgt ${gap('in welchem Rhythmus? Etwa: laufend, spätestens monatlich vor der Voranmeldung')}.</li>
</ul>

<h3>2.5 Kontierung und Abgrenzungen</h3>
<p>
  Statt eines Kontenrahmens verwendet die Software feste Kategorien, die
  unmittelbar auf die Positionen der Anlage EÜR verweisen. Die Zuordnung
  Kategorie zu EÜR-Position ist im Programm hinterlegt und wird in jedem
  Datenexport mit ausgegeben.
</p>
<ul>
  <li>Anlagegüter über 800 Euro netto werden nicht sofort als Aufwand erfasst, sondern über die lineare Abschreibung nach §7 EStG, im Anschaffungsjahr zeitanteilig ab dem Anschaffungsmonat.</li>
  <li>Bewirtungsaufwendungen wirken sich zu 70 Prozent als Betriebsausgabe aus, der Vorsteuerabzug bleibt ungekürzt (§4 Abs. 5 Nr. 2 EStG). Anlass und Teilnehmer werden an der Buchung vermerkt.</li>
  <li>Privatanteile werden als Prozentsatz an der Buchung erfasst; nur der betriebliche Anteil wirkt sich aus.</li>
  <li>Reverse Charge als Leistungsempfänger und innergemeinschaftlicher Erwerb werden an der Buchung gekennzeichnet. Die Steuer entsteht in der Voranmeldung und wird dort zugleich wieder abgezogen.</li>
</ul>

<h2>3. Technische Systemdokumentation</h2>

<h3>3.1 Eingesetzte Software</h3>
<table>
  <tr><th style="width:32%">Programm</th><td>NestEgg, Version ${esc(meta.version || 'unbekannt')}</td></tr>
  <tr><th>Art</th><td>Lokal installierte Desktop-Anwendung. Keine Serververbindung, keine Cloud, keine Übertragung von Daten an Dritte.</td></tr>
  <tr><th>Datenhaltung</th><td>${meta.encrypted
    ? `Eine Datei je Profil, verschlüsselt mit AES-256-GCM. Der Datenschlüssel liegt mit scrypt aus einem Passwort abgeleitet im Schlüsselbund <code>schluessel.json</code>.`
    : `Eine JSON-Datei je Profil, im Klartext lesbar`}</td></tr>
  <tr><th>Schemastand</th><td>Version ${esc(meta.schemaVersion || '')}</td></tr>
  <tr><th>Datenordner</th><td><code>${orGap(meta.dataDir, 'Pfad')}</code></td></tr>
  ${meta.profileName ? `<tr><th>Profil</th><td>${esc(meta.profileName)}</td></tr>` : ''}
</table>

<h3>3.2 Aufbau des Datenordners</h3>
<table>
  <tr><th style="width:32%">${meta.encrypted ? `buchhaltung.nst` : `buchhaltung.json`}</th><td>Alle Stamm- und Bewegungsdaten${meta.encrypted ? ` (verschlüsselt)` : ``}</td></tr>
  ${meta.encrypted ? `<tr><th>schluessel.json</th><td>Schlüsselbund: Salze und der mehrfach verschlüsselte Datenschlüssel. Enthält selbst kein Geheimnis.</td></tr>` : ``}
  <tr><th>belege/&lt;Jahr&gt;/</th><td>${meta.encrypted
    ? `Abgelegte Belegdateien, verschlüsselt und unter neutralem Namen. Der sprechende Name steht im Datensatz.`
    : `Abgelegte Belegdateien, umbenannt nach Datum und Gegenpartei`}</td></tr>
  <tr><th>exporte/</th><td>Erzeugte PDF-, XML- und Excel-Dateien</td></tr>
  <tr><th>backups/</th><td>Tägliche Kopie des Bestands, dreißig Stände, dazu eine Sicherung vor jedem Schemawechsel</td></tr>
  <tr><th>${meta.encrypted ? `journal.nstl` : `journal.jsonl`}</th><td>Änderungsprotokoll, wird ausschließlich angehängt${meta.encrypted ? `, jede Zeile einzeln verschlüsselt` : ``}</td></tr>
</table>

<h3>3.3 Unveränderbarkeit und Nachvollziehbarkeit</h3>
<ul>
  <li>Jede Änderung an einem Datensatz wird im <strong>Journal</strong> festgehalten: Zeitpunkt, Art der Änderung, betroffener Datensatz sowie Zustand davor und danach. Das Journal wird nur angehängt, nie überschrieben.</li>
  <li>Geschrieben wird immer atomar: zuerst in eine temporäre Datei, dann umbenannt. Ein abgebrochener Schreibvorgang kann den Bestand nicht zerreißen.</li>
  <li>Festgeschriebene Dokumente sind über die Oberfläche nicht mehr änderbar.</li>
  <li>Belegdateien tragen eine Prüfsumme und werden nach der Ablage nicht mehr angefasst.</li>
  <li>Bei einem Wechsel des Datenschemas wird der vorherige Stand vollständig gesichert, bevor die Umstellung geschrieben wird.</li>
</ul>

<div class="note">
  Die Datendatei liegt im Dateisystem und ist technisch mit einem Texteditor
  veränderbar. Die Unveränderbarkeit stützt sich deshalb auf das Journal, die
  Prüfsummen der Belege und die Sicherungen, nicht auf einen Schreibschutz der
  Datei. Der Zugriff auf den Rechner ist entsprechend zu beschränken.
</div>

<h3>3.4 Auswertungen</h3>
<ul>
  <li>Einnahmenüberschussrechnung nach Positionen der Anlage EÜR</li>
  <li>Kennzahlen der Umsatzsteuer-Voranmeldung in der Reihenfolge des amtlichen Vordrucks. <strong>Die Software übermittelt nichts</strong>; die Werte werden in ELSTER übertragen.</li>
  <li>Zusammenfassende Meldung für innergemeinschaftliche Leistungen</li>
  <li>Auswertung nach Bereich, Projekt, Land und Kunde</li>
  <li>Datenüberlassung nach §147 Abs. 6 AO als CSV-Dateien mit Beschreibungsdatei index.xml</li>
</ul>

<h2>4. Betriebsdokumentation</h2>

<h3>4.1 Zugriffsschutz</h3>
<ul>
  <li>Zugang zum Rechner: ${gap('Etwa: Benutzerkonto mit Kennwort, Festplattenverschlüsselung aktiv')}</li>
  <li>Zugriff auf den Datenordner haben: ${gap('Etwa: nur der Inhaber')}</li>
</ul>
${meta.encrypted ? `
<p>
  Der Datenbestand ist <strong>verschlüsselt</strong>. Buchungsdatei,
  Belegdateien, tägliche Sicherungen und das Änderungsprotokoll sind mit
  AES-256-GCM geschützt; der Datenschlüssel wird mit scrypt
  (N=2<sup>17</sup>, r=8, p=1) aus einem Passwort abgeleitet. Ohne Passwort
  oder Wiederherstellungsschlüssel ist der Bestand nicht lesbar. Damit ist der
  von GoBD Rz. 103 geforderte Schutz vor unberechtigtem Zugriff auch dann
  gegeben, wenn die Dateien den Rechner verlassen, etwa über eine Sicherung.
</p>
<p>
  <strong>Zugleich hängt daran die Lesbarmachung nach §147 Abs. 5 AO.</strong>
  Passwort und Wiederherstellungsschlüssel sind deshalb über die gesamte
  Aufbewahrungsfrist verfügbar zu halten, getrennt voneinander und getrennt vom
  Rechner. Der Wiederherstellungsschlüssel liegt als Ausdruck vor.
</p>
<ul>
  <li>Wiederherstellungsschlüssel verwahrt: ${gap('Ort, etwa: Ordner Steuerunterlagen im Aktenschrank')}</li>
  <li>Passwort hinterlegt für den Vertretungsfall bei: ${gap('Etwa: versiegelt beim Steuerberater / nicht hinterlegt')}</li>
  <li>Lesbarkeit zuletzt geprüft am: ${gap('Datum')}</li>
</ul>
<p>
  Für eine Außenprüfung ist die Verschlüsselung ohne Belang: die Ausgabe nach
  Abschnitt 4.4 erfolgt unverschlüsselt. Verschlüsselt liegt nur der
  Arbeitsbestand.
</p>` : ''}

<h3>4.2 Datensicherung</h3>
<ul>
  <li>Die Software legt beim ersten Start eines Tages eine Sicherung im Unterordner <code>backups</code> an und hält die letzten dreißig Stände vor.</li>
  <li>Sicherung außerhalb des Rechners: ${gap('Etwa: Datenordner liegt in einem synchronisierten Ordner, zusätzlich monatlich auf externe Festplatte')}</li>
  <li>Wiederherstellung wurde zuletzt geprüft am: ${gap('Datum')}</li>
</ul>

<h3>4.3 Aufbewahrung</h3>
<p>
  Nach §147 AO gelten unterschiedliche Fristen: <strong>Buchungsbelege acht
  Jahre</strong>, <strong>Bücher und Aufzeichnungen zehn Jahre</strong>. Die
  Buchungsdatei ist eine Aufzeichnung in diesem Sinne, die abgelegten Belege
  sind Buchungsbelege. Die Frist beginnt mit dem Schluss des Kalenderjahres, in
  dem der letzte Eintrag entstanden ist. Läuft die Festsetzungsfrist noch,
  verlängert sich die Aufbewahrung entsprechend.
</p>
<p>
  Aufbewahrt wird der gesamte Datenordner einschließlich der Belegdateien und
  des Journals. Elektronisch empfangene Rechnungen werden in dem Format
  aufbewahrt, in dem sie eingegangen sind.
</p>

<h3>4.4 Datenzugriff in einer Außenprüfung</h3>
<ul>
  <li><strong>Z1</strong>, unmittelbarer Zugriff: Einsicht am Rechner über die Software.</li>
  <li><strong>Z2</strong>, mittelbarer Zugriff: Auswertungen werden nach Vorgabe der Prüfung erstellt.</li>
  <li><strong>Z3</strong>, Datenträgerüberlassung: Über die Ansicht Einstellungen erzeugt die Software einen Export aus CSV-Dateien und einer Beschreibungsdatei index.xml nach dem Beschreibungsstandard.</li>
</ul>

<h2>5. Änderungsnachweis dieser Dokumentation</h2>
<table>
  <tr><th style="width:20%">Datum</th><th style="width:26%">Verfasser</th><th>Änderung</th></tr>
  <tr><td>${formatDate(today)}</td><td>${orGap(company.owner, 'Name')}</td><td>Erstellt aus dem Stand der Software vom ${formatDate(today)}</td></tr>
  <tr><td class="gap">&nbsp;</td><td class="gap">&nbsp;</td><td class="gap">&nbsp;</td></tr>
</table>

<div class="note">
  Diese Dokumentation ist fortzuschreiben. Ändert sich der Ablauf, etwa durch
  ein neues Bankkonto, einen Steuerberater oder eine andere Software, gehört
  die Änderung mit Datum in die Tabelle oben. Alte Fassungen sind so lange
  aufzubewahren wie die Unterlagen, für die sie galten.
</div>

<div class="sign">
  <div>Ort, Datum</div>
  <div>Unterschrift</div>
</div>

<div class="foot">
  Erstellt mit NestEgg ${esc(meta.version || '')} am ${formatDate(today)}.
  Diese Dokumentation ersetzt keine steuerliche Beratung.
</div>

</body>
</html>`;
}

/** The figures the interface shows before the PDF comes into being. */
export function summarize(data: Snapshot) {
  const entries = data.entries ?? [];
  const gross = entries.reduce((sum, entry) => sum + (entry.type === 'income' ? entry.gross : -entry.gross), 0);
  return {
    entries: entries.length,
    receipts: (data.receipts || []).length,
    invoices: (data.invoices || []).length,
    balance: formatEuro(gross)
  };
}
