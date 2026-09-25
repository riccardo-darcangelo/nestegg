# Mitarbeit

Beiträge sind willkommen, von der Tippfehlerkorrektur bis zum neuen Bereich.
Diese Seite sagt, was du dafür brauchst und worauf ich beim Lesen achte.

## Developer Certificate of Origin

Zeichne jeden Commit mit `-s`:

```bash
git commit -s -m "Beschreibung der Änderung"
```

Das hängt eine Zeile `Signed-off-by` an und ist deine Bestätigung nach dem
[Developer Certificate of Origin](https://developercertificate.org/), dass du
die Rechte an deinem Beitrag hast und ihn unter dieselbe Lizenz stellst. Ohne
diese Zeile kann ich einen Beitrag nicht übernehmen, und ohne sie ließe sich die
Lizenz später auch nicht mehr ändern.

Eine Abtretung der Rechte verlange ich nicht. Dein Beitrag bleibt deiner, er
steht nur unter GPL-3.0-or-later wie der Rest.

## Loslegen

```bash
npm install
npm start
```

Gebraucht wird Node 20 oder neuer. Der Rechenkern ist TypeScript und wird nach
`out/` übersetzt, deshalb bauen alle Skripte vorher.

```bash
npm test              # die Testsuite
npm run typecheck     # nur die Typen, ohne zu bauen
npm run smoke         # startet die App und klickt jede Ansicht durch
npm run smoke:a11y    # Kontrast, Beschriftungen, Tastatur, Dialoge
npm run smoke:lock    # Verschlüsselung über mehrere Programmläufe
npm run preview       # die Oberfläche im Browser, ohne Electron

node tools/pdfa-check.js <datei.pdf>   # sieht ein erzeugtes PDF auf die
                                       # PDF/A-Punkte durch, die in der Praxis
                                       # schiefgehen
```

Vor einem Pull Request sollten `npm test` und `npm run typecheck` durchlaufen.
Hast du an der Oberfläche gearbeitet, nimm `npm run smoke` dazu; hast du an der
Verschlüsselung gearbeitet, `npm run smoke:lock`.

## Eine neue Fassung

Die Version wird nicht von Hand gesetzt, sondern aus den Commits abgeleitet:

```bash
npm run release:dry   # zeigt, welche Version herauskäme und warum
npm run release       # setzt sie, schreibt das CHANGELOG, committet und taggt
```

Ein `feat` hebt die zweite Stelle, ein `fix` die dritte, ein Ausrufezeichen
hinter dem Typ oder ein `BREAKING CHANGE` im Rumpf die erste. `chore` und
`docs` heben für sich genommen nichts, denn eine neue Fassung nur für eine
Änderung am README hilft niemandem. Deshalb ist es nicht gleichgültig, wie ein
Commit betitelt ist.

Der Bau erinnert daran, wenn seit der letzten Fassung etwas liegen geblieben
ist, bricht aber nie ab.

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

Das Projekt wird gerade von JavaScript auf TypeScript umgestellt. Der
Rechenkern, die Ein- und Ausgabe, der Speicher und die Verschlüsselung sind
durch; der Hauptprozess und die Oberfläche folgen. Neuer Code sollte TypeScript
sein.

## Wie der Code aussieht

Kommentare und JSDoc auf Englisch, und zwar nur dort, wo sie etwas erklären, was
der Code nicht selbst sagt. Ein Kommentar, der den nächsten Ausdruck wiederholt,
ist Ballast. Erkläre lieber, warum etwas so und nicht anders gelöst ist,
besonders wenn eine Vorschrift dahintersteht.

Alles, was der Nutzer liest, bleibt Deutsch. Fehlermeldungen, Beschriftungen,
Dokumententexte.

Weiter:

- Geld ist immer eine ganze Zahl in Cent. Fließkomma hat in einer Buchhaltung
  nichts verloren.
- Daten sind ISO-Zeichenketten, `YYYY-MM-DD` für Kalendertage.
- Bezeichner sprechen für sich. `openAmount` statt `oa`, `isTargetBusinessDay`
  statt `check3`.
- Funktionen tun eine Sache. Wenn du eine Überschrift über einen Block schreiben
  willst, ist es meistens eine eigene Funktion.
- Keine langen Striche in nutzersichtbaren Texten, weder Gedankenstrich noch
  Halbgeviertstrich. Ein Doppelpunkt, ein Komma oder zwei Sätze tun es auch.
- Neue Abhängigkeiten bitte begründen. Die App kommt mit drei aus, und jede
  weitere muss offline laufen und zur GPL passen.

## Was gut hineinpasst

Fehlerberichte mit einem nachvollziehbaren Ablauf. Korrekturen an der
steuerlichen Logik, gern mit Fundstelle. Bessere Erkennung beim Einlesen von
Belegen und Kontoauszügen. Barrierefreiheit. Übersetzungen der Oberfläche, wenn
jemand die Pflege übernimmt.

## Was nicht hineinpasst

Alles, was Daten aus dem Haus schafft. Keine Cloud, keine Telemetrie, keine
Updateprüfung, die nach Hause funkt, keine Schriftart von einem fremden Server.
Das ist kein Geschmack, sondern die Zusage, die das Programm im ersten Absatz
seiner Beschreibung macht, und sie muss am Quelltext nachprüfbar bleiben.

Ebenso wenig Funktionen, die eine steuerliche Entscheidung stillschweigend
treffen. Die App darf rechnen und vorschlagen, buchen muss der Mensch.

## Sicherheitslücken

Nicht als Issue, sondern an info@darcdesign.de. Die Einzelheiten stehen in
[SECURITY.md](SECURITY.md).
