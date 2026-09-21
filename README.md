# NestEgg

**Buchhaltung, die auf deinem Rechner bleibt.**

Eine Offline-Buchhaltung für Einzelunternehmen und kleine Vereine: Einnahmen und
Ausgaben erfassen, daraus die EÜR und die Zahlen für die Umsatzsteuer ziehen,
Angebote und Rechnungen schreiben, als E-Rechnung ausgeben und am Jahresende der
Kanzlei etwas übergeben, mit dem sie arbeiten kann.

Kein Server, kein Konto, keine Übertragung irgendwohin. Die Daten liegen in einem
Ordner deiner Wahl, auf Wunsch verschlüsselt mit AES-256 und einem Passwort, das
nur du kennst.

[![Lizenz: GPL v3](https://img.shields.io/badge/Lizenz-GPLv3-blue.svg)](LICENSE)

## Warum noch eine Buchhaltung

Die meisten Programme dieser Art laufen heute in der Cloud. Das ist bequem, hat
aber einen Preis: Umsätze, Kundenliste, Kontoverbindungen und Belege liegen auf
fremden Rechnern, und ob sie dort bleiben, lässt sich nicht nachprüfen. Wer damit
kein Problem hat, ist mit den großen Anbietern gut bedient.

NestEgg ist für alle anderen. Es läuft lokal, es hat keine Netzwerkfunktion, und
weil es unter der GPL steht, lässt sich das am Quelltext nachsehen statt
glauben.

## Was drin ist

**Buchführung**
Einnahmen und Ausgaben nach dem Zu- und Abflussprinzip, §4 Abs. 3 EStG. Die EÜR
mit den Positionen des amtlichen Vordrucks, Umsatzsteuervoranmeldung samt
Dauerfristverlängerung, Anlageverzeichnis mit linearer Abschreibung,
Kleinunternehmerregelung mit Überwachung der Grenze.

**Rechnungen und Angebote**
Rechnung, Stornorechnung, Angebot und Kostenvoranschlag mit einem gemeinsamen
Editor. Nummernkreise je Dokumentart, lückenlos und aufsteigend. Das Aussehen
lässt sich einstellen, ohne DIN 5008 zu verlassen, und die Vorschau zeigt
dasselbe wie das erzeugte PDF.

**E-Rechnung**
Ausgabe als XRechnung (UBL) oder ZUGFeRD (PDF mit eingebettetem CII-XML).
Empfangene E-Rechnungen werden gelesen, geprüft und als Buchungsvorschlag
angeboten. Seit dem 1. Januar 2025 muss jedes inländische Unternehmen
E-Rechnungen empfangen können, ohne Übergangsfrist.

**Kontoauszug und Belege**
CSV-Import mit selbsttätiger Spaltenerkennung für die verbreiteten Institute. Die
App lernt aus früheren Buchungen, bucht aber nichts von allein: jede Zeile wird
einzeln bestätigt. Belege werden in den Datenordner kopiert, mit Prüfsumme
abgelegt und auf Wunsch ausgelesen, damit Betrag, Datum und Lieferant nicht
abgetippt werden müssen.

**Mahnwesen und Fristen**
Dreistufiges Mahnwesen mit Verzugszinsen nach §288 BGB und der Pauschale, die
Verbrauchern nicht berechnet wird. Ein Fristenkalender, der Voranmeldungen,
Zahlungsziele und wiederkehrende Termine im Blick behält.

**Kanzlei und Prüfung**
DATEV-Buchungsstapel im EXTF-Format mit SKR 03, SKR 04 oder SKR 42, Datenexport
nach §147 Abs. 6 AO im GDPdU-Beschreibungsstandard, und eine
Verfahrensdokumentation, die aus dem tatsächlichen Zustand der Installation
entsteht statt aus einer Vorlage.

**Vereine**
Ein zweites Profil kann die Buchführung eines gemeinnützigen Vereins tragen:
Sphärenrechnung über die vier Tätigkeitsbereiche, Mitgliederverwaltung mit
Beitragslauf, SEPA-Lastschrift samt Vorabankündigung und Rücklastschriften,
Rücklagen nach §62 AO, Aufwandsspenden und Zuwendungsbestätigungen nach
amtlichem Muster.

**Verschlüsselung**
Der gesamte Bestand, die Belege, die Sicherungen und das Änderungsprotokoll
liegen auf Wunsch verschlüsselt. Wer das Passwort vergisst, kommt mit einem
Wiederherstellungsschlüssel wieder hinein, den die App einmal ausdruckt. Das ist
kein Komfort: §147 AO verlangt zehn Jahre Aufbewahrung und jederzeitige
Lesbarmachung.

Das vollständige Handbuch steht in [docs/handbuch.md](docs/handbuch.md).

## Start

```bash
git clone https://github.com/riccardo-darcangelo/nestegg.git
cd nestegg
npm install
npm start
```

Gebraucht wird Node 20 oder neuer. Fertige Installer gibt es noch nicht, siehe
[Stand](#stand).

Beim ersten Start fragt die App, wo der Datenordner liegen soll, und ob der
Bestand verschlüsselt werden soll. Beides lässt sich später ändern.

```
Datenordner/
  buchhaltung.json     alle Daten, verschlüsselt buchhaltung.nst
  belege/<Jahr>/       abgelegte Belege mit Prüfsumme
  exporte/             erzeugte PDFs, XMLs und Excel-Mappen
  backups/             tägliche Kopie, dreißig Stände
  journal.jsonl        Änderungsprotokoll, wird nur angehängt
  profile/<name>/      weitere Profile, jedes mit demselben Aufbau
```

## Aufbau

```
src/domain/     Rechenkern in TypeScript, kennt weder Electron noch DOM
src/export/     erzeugt XML, PDF, Dokument-CSS und Excel
src/import/     liest E-Rechnungen und Belege ein
src/storage/    Speicher, Profile, Belege, Umzug der alten Fassung
src/security/   Tresor und Schlüsselbund
src/main/       der Electron-Hauptprozess mit den IPC-Handlern
src/preload/    die Brücke zwischen Hauptprozess und Oberfläche
src/renderer/   die Oberfläche in reinem JavaScript ohne Framework
src/shared/     Typen, die beide Seiten teilen
test/           gespiegelt nach domain, export, import, storage, security
tools/          Entwicklungswerkzeuge, Prüfläufe und die Browser-Vorschau
```

Drei Abhängigkeiten zur Laufzeit: `exceljs` für die Jahresmappe, `pdf-lib` zum
Einbetten des Rechnungs-XML und `qrcode` für den GiroCode. Alles andere kommt aus
Node und Electron.

```bash
npm test              # 637 Tests
npm run typecheck     # nur die Typen
npm run smoke         # startet die App und klickt jede Ansicht durch
npm run smoke:a11y    # Kontrast, Beschriftungen, Tastatur, Dialoge
npm run smoke:lock    # Verschlüsselung über mehrere Programmläufe
```

## Stand

Das Programm wird täglich für eine echte Buchführung benutzt, ist aber noch keine
1.0 mit fertigen Installern. Zwei Dinge sind im Gang:

- Die Umstellung von JavaScript auf TypeScript. Rechenkern, Ein- und Ausgabe,
  Speicher und Verschlüsselung sind durch, der Hauptprozess und die Oberfläche
  folgen.
- Signierte Installer für Windows. Ohne Signatur zeigt SmartScreen eine Warnung,
  deshalb gibt es bis dahin nur den Weg über den Quelltext.

## Grenzen

Das Programm ersetzt keine steuerliche Beratung. Kategorien, Abzugsgrenzen und
die Zuordnung der EÜR-Positionen sind nach bestem Wissen umgesetzt, die
Verantwortung für die Erklärung bleibt bei dir.

Es führt keine doppelte Buchführung und ist nicht für eine Bilanz gedacht. Die
Einkommensteuer in der Rücklage ist eine Schätzung mit einem selbst gesetzten
Satz. Das OSS-Verfahren für digitale Leistungen an Privatkunden in der EU ist
nicht abgebildet.

Getestet wird auf Windows. Electron läuft auch auf macOS und Linux, dort fehlt
aber die Erfahrung aus dem Alltag.

## Mitarbeit

Beiträge sind willkommen. Was du dafür brauchst und worauf ich beim Lesen achte,
steht in [CONTRIBUTING.md](CONTRIBUTING.md). Kurz: `git commit -s` für das
Developer Certificate of Origin, Kommentare auf Englisch, alles was der Nutzer
liest auf Deutsch, und Geld immer in ganzen Cent.

Sicherheitslücken bitte nicht als Issue, sondern an info@darcdesign.de. Die
Einzelheiten stehen in [SECURITY.md](SECURITY.md).

## Lizenz

NestEgg ist freie Software unter der **GNU General Public License, Version 3 oder
später** (GPL-3.0-or-later). Der vollständige Text steht in [LICENSE](LICENSE).

Du darfst das Programm nutzen, untersuchen, verändern und weitergeben. Wenn du es
weitergibst, verändert oder nicht, müssen die Empfänger dieselben Rechte bekommen
und an den Quelltext kommen können.

Die Wahl ist kein Zufall. Eine Buchhaltung verspricht, dass die Daten auf dem
eigenen Rechner bleiben. Nachprüfen lässt sich so ein Versprechen nur am
Quelltext, und Copyleft sorgt dafür, dass das auch für jede Abwandlung gilt.

Die mitgelieferten Bibliotheken stehen unter ihren eigenen, damit verträglichen
Lizenzen, überwiegend MIT. Sie sind in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) aufgeführt.

### Gewährleistung

Für dieses Programm besteht keine Gewährleistung, soweit das Gesetz es zulässt.
Es wird unentgeltlich überlassen; nach deutschem Recht ist das eine Schenkung,
und damit haftet der Urheber nach §521 BGB nur für Vorsatz und grobe
Fahrlässigkeit. Der weitergehende Haftungsausschluss im englischen Lizenztext
stammt aus dem US-Recht und greift hier nur so weit, wie §309 Nr. 7 BGB es
zulässt.

Praktisch heißt das: prüfe die Auswertungen, bevor du sie einer Steuererklärung
zugrunde legst.
