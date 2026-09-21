# NestEgg: Handbuch

Diese Seite beschreibt, was das Programm kann und wie es rechnet. Eine kurze
Vorstellung steht in der [README](../README.md).

## Start

```bash
npm install
npm start
```

Beim ersten Start schlägt die App einen Datenordner neben der Anwendung vor und
fragt, wo er liegen soll. Der Ordner lässt sich später in den Einstellungen
wechseln.

```
Datenordner/
  buchhaltung.json     alle Daten
  belege/<Jahr>/       abgelegte Belege, umbenannt nach Datum und Gegenpartei
  exporte/             erzeugte PDFs, XMLs und Excel-Mappen
  backups/             tägliche Kopie, dreißig Stände
  journal.jsonl        Änderungsprotokoll, wird nur angehängt
  profile/<name>/      weitere Profile, jedes mit demselben Aufbau
```

## Wie gerechnet wird

**Zwei Daten je Buchung.** Das Belegdatum ist das Rechnungs- oder
Leistungsdatum, das Zahlungsdatum der tatsächliche Geldfluss. Ohne
Zahlungsdatum gilt eine Buchung als offen und bleibt aus EÜR und
Umsatzsteuer heraus.

**EÜR nach dem Zu- und Abflussprinzip** (§4 Abs. 3, §11 EStG): eine Buchung
zählt in dem Jahr, in dem das Geld geflossen ist. Gerechnet wird nach der
Bruttomethode wie in der Anlage EÜR: Erlöse und Aufwendungen stehen netto,
die vereinnahmte Umsatzsteuer und die gezahlte Vorsteuer bilden je eine
eigene Position.

**Ist-Versteuerung** (§20 UStG) ist voreingestellt: die Umsatzsteuer entsteht
mit dem Zahlungseingang. Der Vorsteuerabzug hängt dagegen an Leistung und
Rechnung, nicht an der Zahlung, und wird deshalb standardmäßig nach dem
Rechnungsdatum abgegrenzt. Beides ist in den Einstellungen umstellbar, ebenso
die Soll-Versteuerung.

**Anlagegüter** über 800 Euro netto wirken nicht sofort, sondern über die
lineare Abschreibung. Im Anschaffungsjahr zeitanteilig ab dem
Anschaffungsmonat, wie §7 Abs. 1 Satz 4 EStG es verlangt.

**Sonderfälle**, die eingebaut sind: Bewirtung mit 70 Prozent
Betriebsausgabe bei vollem Vorsteuerabzug, Privatanteile, Reverse Charge als
Leistungsempfänger, innergemeinschaftlicher Erwerb und Lieferung, und die
Zehn-Tage-Regel über ein abweichendes Steuerjahr.

## Dokumente

Vier Arten, ein Editor: Rechnung, Stornorechnung, Angebot und
Kostenvoranschlag teilen sich Aufbau, Positionen und Summenrechnung. Was sich
unterscheidet, sind die Kopfdaten und die Pflichten.

| Art | Kennzeichen | Nummernkreis |
| --- | --- | --- |
| **Rechnung** | Leistungsdatum und Fälligkeit, Pflichtangaben nach §14 UStG | RE- |
| **Stornorechnung** | hebt eine Rechnung auf, verweist auf ihre Nummer | ST- |
| **Angebot** | verbindlich, mit Bindefrist und Feld für die Zusage | AN- |
| **Kostenvoranschlag** | unverbindliche Schätzung mit Toleranz, §650 BGB | KV- |

Jede Art zählt ihren eigenen Kreis. Getrennte Kreise sind zulässig, solange
jeder für sich lückenlos bleibt.

Ein Angebot durchläuft Entwurf, Versendet, Angenommen oder Abgelehnt. Läuft die
Bindefrist ab, springt es von selbst auf Abgelaufen. Aus einem Angebot wird per
Knopfdruck ein Rechnungsentwurf mit denselben Positionen; das Angebot bleibt
bestehen und gilt danach als abgerechnet. Angebote und Kostenvoranschläge
berühren weder EÜR noch Umsatzsteuer, das passiert erst über die Rechnung.

Jedes Dokument ist zunächst Entwurf und frei änderbar. Mit dem Festschreiben
bekommt es seine Nummer und wird nur noch angezeigt. Bei Rechnungen prüft die
App vorher die Pflichtangaben nach §14 UStG und die Zusatzfelder, die EN 16931
verlangt. Bei Angeboten sind dieselben Angaben nur Hinweise, denn ein Angebot
ist kein Steuerdokument.

### E-Rechnung

Drei Ausgabewege:

| Format | Was es ist | Wofür |
| --- | --- | --- |
| **ZUGFeRD** | PDF mit eingebettetem CII-XML (`factur-x.xml`, Profil EN 16931) | Geschäftskunden. Mensch und Software lesen dieselbe Datei |
| **XRechnung** | reines UBL-XML, Customization `xrechnung_3.0` | öffentliche Auftraggeber, meist mit Leitweg-ID |
| **PDF** | nur Sichtbeleg, ohne XML | wenn beim Empfänger nichts weiter gebraucht wird |

Zum ZUGFeRD-PDF ehrlich eingeordnet: das XML wird normgerecht eingebettet,
mit XMP-Metadaten, Factur-X-Erweiterungsschema, `AFRelationship /Alternative`
und einem OutputIntent samt erzeugtem sRGB-Profil. Empfangssysteme finden das
XML damit zuverlässig. Ob das von Chromium gerenderte PDF in jedem Detail
PDF/A-3b entspricht, lässt sich nur mit einem Prüfwerkzeug wie veraPDF
feststellen. Wer eine geprüfte Datei braucht, nimmt den XRechnung-Export,
dort ist das XML selbst das Dokument.

### E-Rechnungen empfangen

**Seit dem 1. Januar 2025 muss jedes inländische Unternehmen E-Rechnungen
empfangen können**, ohne Übergangsfrist und unabhängig von der Größe. Das
Ausstellen ist gestaffelt (ab 2027 über 800.000 Euro Vorjahresumsatz, ab 2028
alle), das Empfangen nicht.

Die App liest XRechnung und ZUGFeRD, letzteres auch aus dem PDF heraus. Sie
zeigt, was wirklich in der Datei steht: Beträge, Steuersätze, Positionen,
Aussteller. Dazu prüft sie, was hinterher Ärger macht, und sagt es:

- fehlende Pflichtangaben nach §14 UStG
- eine Summe, die nicht aufgeht
- Reverse Charge, das man übersehen könnte
- eine Rechnung, die schon gebucht ist

Auf Bestätigung entsteht daraus eine Ausgabenbuchung mit dem Rechnungsdatum,
denn das steuert den Vorsteuerabzug. Die empfangene Datei wird **unverändert**
als Beleg abgelegt: aufzubewahren ist der strukturierte Datensatz, nicht ein
Ausdruck davon.

### Belege auslesen

Wird ein PDF als Beleg angehängt, sieht die App hinein und schlägt Betrag,
Datum, Rechnungsnummer und Lieferant vor. Gefüllt werden nur leere Felder: was
von Hand eingetragen wurde, ist immer die bessere Auskunft.

Das Auslesen ist Handarbeit am Format. Ein PDF speichert keinen Text, sondern
Anweisungen, welche Glyphe wohin gemalt wird; übersetzt wird über die
Kodierung der eingebetteten Schrift. Ausgewertet werden deshalb ToUnicode-
Tabellen, ActualText-Markierungen für Ligaturen und die Positionierung, aus
der erst die Zeilenstruktur entsteht. Ohne das käme aus einem
Chromium-erzeugten PDF nur Zeichensalat.

Eingescannte Belege enthalten keinen Text, sondern ein Bild. Eine
Texterkennung ist nicht eingebaut, und zwar bewusst: sie wäre entweder eine
große Abhängigkeit oder ein Dienst im Netz. Die App sagt in dem Fall, dass sie
nichts lesen kann, statt Unsinn vorzuschlagen.

Eine Rechnung wirkt sich erst auf EÜR und Umsatzsteuer aus, wenn die Zahlung
gebucht ist. Der Knopf **Bezahlt** legt dazu die passende Einnahme an.

**Korrekturen** laufen über das Stornieren. Die Originalrechnung bleibt stehen
und gilt danach als storniert, zusätzlich entsteht eine Stornorechnung als
Entwurf mit denselben Positionen und eigener Nummer. Gelöscht wird nur, was
noch Entwurf ist. War die stornierte Rechnung schon bezahlt, gehört die
Rückzahlung als eigene Buchung erfasst.

## Aussehen der Dokumente

Unter **Aussehen** lässt sich gestalten, wie Rechnungen, Stornos, Angebote und
Kostenvoranschläge aussehen: Farben, Schrift und Schriftgrößen, Seitenränder,
Logoposition, Absenderzeile, Stil der Positionstabelle, Hervorhebung der
Endsumme, Fußzeile mit eigenem Zusatztext. Fünf fertige Vorlagen sind der
Ausgangspunkt, jeder Wert lässt sich danach einzeln ändern.

Rechts daneben steht das Dokument, wie es gedruckt aussieht. Vorschau und PDF
laufen durch dieselbe Funktion, die Vorschau ist also kein Näherungswert.

Bewusst nicht einstellbar ist die Anordnung selbst. Der Aufbau folgt DIN 5008,
damit die Anschrift im Sichtfenster steht und die Falzmarken passen. Wer die
Blöcke frei verschieben könnte, hätte schnell ein Dokument, das im Umschlag
nicht mehr funktioniert.

Die Textbausteine je Dokumentart stehen in den Einstellungen. Sie kennen
Platzhalter: `{NUMBER}`, `{DATE}`, `{AMOUNT}`, `{CUSTOMER}`, dazu `{DUEDATE}`
bei Rechnungen, `{VALIDUNTIL}` bei Angeboten und `{TOLERANCE}` beim
Kostenvoranschlag.

## Wiederkehrendes

Miete, Hosting, Betreuungspauschalen: einmal als Vorlage anlegen, danach nur
noch bestätigen. Eine Vorlage ist eine Wiederholungsregel plus der Entwurf
dessen, was daraus entstehen soll.

Rhythmen: wöchentlich, zweiwöchentlich, monatlich, vierteljährlich, halbjährlich
oder jährlich, jeweils auch als Vielfaches. Bei Monatsrhythmen wird der Stichtag
gespeichert und für jeden Monat neu auf dessen letzten Tag begrenzt. Eine Regel
mit Stichtag 31 läuft also über den Februar und steht im März wieder auf dem 31.,
statt dauerhaft auf den 28. zu rutschen. Enden kann eine Regel an einem Datum,
nach einer Anzahl oder gar nicht.

**Erzeugt wird nichts im Hintergrund.** Die App sammelt, was fällig ist, zeigt
was entstehen würde, und legt es erst auf Knopfdruck an. Eine Buchhaltung, die
von selbst bucht, ist schwer zu prüfen. Termine, die schon von Hand gebucht
wurden, lassen sich überspringen.

Jeder erzeugte Datensatz trägt die Vorlage und den Termin, aus dem er
hervorging. Geprüft wird gegen diese Paare, nicht gegen einen Zähler: ein
gelöschter Datensatz darf wieder entstehen, ein vorhandener nicht ein zweites
Mal.

Buchungen können sofort als bezahlt gelten, was bei Dauerauftrag und Lastschrift
richtig ist. Rechnungen entstehen als Entwurf und bekommen ihre Nummer erst beim
Festschreiben; wer will, schaltet das automatische Festschreiben ein. Fehlt dann
eine Pflichtangabe, bleibt die Rechnung trotzdem Entwurf und die App sagt warum.

Im Text der Vorlage wird `{PERIOD}` zum Abrechnungsmonat, etwa "Büromiete
März 2026". Rechnungen bekommen auf Wunsch den ganzen Monat als
Leistungszeitraum statt eines einzelnen Datums.

## Profile

Mehrere Buchführungen in einer App: ein Einzelunternehmen, ein Verein, was
auch immer getrennt gehört. Jedes Profil hat seinen **eigenen Datenordner**,
eigene Firmendaten, eigene Nummernkreise und eigene Belege. Umgeschaltet wird
in der Seitenleiste, der Name des aktiven Profils steht dort und im
Fenstertitel.

Es gibt bewusst keine gemeinsame Ebene darüber und keine Auswertung über
Profile hinweg. Zwei Steuersubjekte dürfen sich nirgends berühren, und
getrennte Ordner sind die Form der Trennung, die auch in zehn Jahren noch
nachvollziehbar ist, wenn diese App längst nicht mehr läuft.

Der Bestand aus der Zeit vor den Profilen bleibt liegen, wo er ist, und wird
beim ersten Start zum ersten Profil erklärt. Verschoben wird nichts: ein Umzug
von Daten ist immer die Gelegenheit, bei der etwas verlorengeht. Wird ein
Profil aus der Liste genommen, bleiben seine Daten ebenfalls liegen, schon
wegen der Aufbewahrungspflicht.

## Verein

Ein Profil kann statt eines Einzelunternehmens einen **gemeinnützigen Verein**
führen. Das ist kein Schalter für die Beschriftung, sondern die Weiche für
Kategorien, Auswertung und Vorsteuerabzug: ein Verein rechnet in vier Sphären,
und erst die Zuordnung entscheidet über Steuer und Vorsteuer.

| Sphäre | Was hineingehört | Steuer |
| --- | --- | --- |
| **Ideeller Bereich** | Mitgliedsbeiträge, Spenden, Zuschüsse | nicht unternehmerisch: keine Umsatzsteuer, **kein Vorsteuerabzug** |
| **Vermögensverwaltung** | Zinsen, Mieten, geduldete Werbung | körperschaftsteuerfrei, §14 Satz 3 AO |
| **Zweckbetrieb** | Sportveranstaltungen, Kurse | steuerfrei, Umsatzsteuer ermäßigt, §§65 bis 68 AO |
| **Wirtschaftlicher Geschäftsbetrieb** | Gaststätte, Werbung, Verkauf | steuerpflichtig oberhalb der Grenze, §64 AO |

Dass aus einer Ausgabe im ideellen Bereich keine Vorsteuer gezogen werden
darf, ist der Fehler, der in Vereinen am häufigsten gemacht wird. Die App
rechnet ihn deshalb gar nicht erst.

**Die Grenzen, Stand 1. Januar 2026.** Das Steueränderungsgesetz 2025 hat sie
angehoben, und die App rechnet mit den neuen Werten:

| Grenze | Wert | Folge |
| --- | --- | --- |
| Besteuerungsgrenze §64 Abs. 3 AO | 50.000 € | darüber wird der wirtschaftliche Geschäftsbetrieb körperschaft- und gewerbesteuerpflichtig |
| Sportliche Veranstaltungen §67a AO | 50.000 € | darüber ist die Zweckbetriebseigenschaft je Veranstaltung zu prüfen |
| Zeitnahe Mittelverwendung §55 AO | 100.000 € | darunter besteht seit 2026 keine Pflicht mehr |
| Freibetrag §24 KStG, §11 GewStG | je 5.000 € | greift erst, wenn überhaupt Steuerpflicht besteht |

Maßgeblich für die Besteuerungsgrenze sind die **Einnahmen einschließlich
Umsatzsteuer**, nicht der Gewinn. Ein Verein mit 60.000 Euro Einnahmen und
59.000 Euro Ausgaben liegt darüber, obwohl kaum etwas übrig bleibt. Die Ansicht
**Sphären** zeigt das als Balken und warnt, bevor es so weit ist.

### Mitglieder und Beiträge

Der Bestand ist die Grundlage von allem, was ein Verein sonst tut: der Beitrag
hängt daran, die Bestandsmeldung an den Verband und die Stimmberechtigung in
der Versammlung. Die Ansicht **Mitglieder** hält Stammdaten, Beitragsklasse,
Zahlweise und Lastschriftmandat fest.

**Beitragsklassen** bestimmen, was wann fällig wird: ein Betrag je Fälligkeit
und ein Rhythmus, jährlich bis monatlich. Dazu ein Stichtag, an dem die erste
Fälligkeit des Jahres liegt; die weiteren folgen im Abstand des Rhythmus. Am
Mitglied lässt sich ein **abweichender Betrag** hinterlegen, für Ermäßigungen
und Familienbeiträge, und Ehrenmitglieder sind beitragsfrei, solange die
Satzung nichts anderes sagt.

Der **Beitragslauf** stellt die Fälligkeiten eines Jahres zusammen und legt auf
Bestätigung für jede eine Buchung an: im ideellen Bereich, ohne Umsatzsteuer,
mit einem Merkmal aus Mitglied und Zeitraum. Dasselbe Merkmal verhindert, dass
eine Fälligkeit zweimal gebucht wird, auch wenn der Lauf ein zweites Mal
gestartet wird.

Bei **Lastschrift** gilt der Beitrag mit dem Fälligkeitstag als eingegangen,
denn er wird eingezogen. Bei **Überweisung** bleibt die Buchung offen, bis das
Geld da ist, und lässt sich über den Kontoauszug ausgleichen.

### SEPA-Lastschrift

Aus den gebuchten Beiträgen entsteht die **SEPA-Lastschriftdatei**, die im
Onlinebanking hochgeladen wird. Die App zieht nichts ein: den Einzug macht die
Bank, die App schreibt die Datei und hält fest, was vereinbart ist.

Erzeugt wird **pain.008.001.08**, die ISO-20022-Fassung von 2019. Das ist seit
dem **14. November 2026** die einzige Fassung, die die Banken noch annehmen;
die alte pain.008.001.02 liegt als Umschalter daneben, für den Fall, dass eine
Bank sie noch verlangt.

Vorausgesetzt ist die **Gläubiger-Identifikationsnummer**, achtzehn Stellen,
kostenlos bei der Deutschen Bundesbank zu beantragen. Die App prüft ihre
Prüfziffer schon beim Eintippen. Dabei bleiben die Stellen 5 bis 7, die
Geschäftsbereichskennung, außen vor: wer sie mitrechnet, hält jede Nummer für
falsch, die nicht auf ZZZ lautet.

Der **Einzugstag ist ein eigenes Feld** und nicht der Fälligkeitstag der
Buchung. Beide fallen fast nie zusammen: die Beiträge sind im Januar fällig,
eingezogen wird, wann die Datei entsteht. Die Bank nimmt nur Termine an, die
mindestens einen TARGET-Geschäftstag und höchstens 14 Kalendertage voraus
liegen, und die App rechnet diesen Rahmen aus. Dabei zählen die sechs
TARGET-Feiertage, nicht die deutschen: der 3. Oktober ist ein Bankarbeitstag,
Karfreitag und Ostermontag sind es nicht.

Gearbeitet wird durchgehend mit dem Sequenztyp **RCUR**. Die Kennzeichnung der
Erstlastschrift als FRST ist seit November 2016 nicht mehr verpflichtend, und
durchgängig derselbe Typ erspart die Buchführung darüber, welches Mandat schon
einmal benutzt wurde. Genau daran scheitern sonst die meisten Einzüge.

Geprüft wird vor dem Schreiben, und was nicht einziehbar ist, verschwindet
nicht, sondern bekommt seine Begründung: fehlende IBAN, fehlende
Mandatsreferenz, ein Mandat, das jünger ist als der Einzugstag. Die IBAN wird
über die Prüfziffer geprüft und gegen die Länderliste des SEPA-Raums, denn eine
verdrehte Ziffer fällt sonst erst auf, wenn die Bank die Lastschrift
zurückgibt.

Namen und Verwendungszwecke werden auf den **SEPA-Zeichensatz** umgesetzt, aus
Müller wird Mueller. Das deutsche Regelwerk ließe Umlaute inzwischen zu, das
des EPC nicht, und eine Datei mit Mueller nimmt jede Bank an.

Jede eingezogene Forderung merkt sich, **in welcher Datei sie war**. Damit wird
sie kein zweites Mal angeboten, und im Nachhinein ist zu sehen, wann sie zur
Bank ging.

### Aufwandsspenden

Wer für den Verein Auslagen hat und auf die Erstattung verzichtet, spendet:
der Verzicht auf einen Aufwendungsersatzanspruch ist eine Geldzuwendung
(§10b Abs. 3 Satz 5 EStG). Es fließt kein Geld, und genau deshalb sieht das
Finanzamt hier besonders genau hin.

Drei Voraussetzungen entscheiden, und **alle drei lassen sich nur im Vorhinein
schaffen**. Deshalb ist das ein eigener Ablauf und kein Ankreuzfeld: das Kreuz
auf der Bestätigung ist das Ende, nicht der Anfang.

| Voraussetzung | Was die App prüft |
| --- | --- |
| Der Anspruch bestand **vor** der Tätigkeit | Grundlagendatum gegen Tätigkeitsdatum |
| Der Verein konnte ihn **zahlen** | Kontostand am Tag der Einräumung gegen den Betrag |
| Der Verzicht kam **zeitnah** | drei Monate nach Entstehen des Anspruchs |

Grundlage kann die **Satzung** oder eine **schriftliche Vereinbarung** sein.
Ein **Vorstandsbeschluss allein genügt nicht**: er trägt nur, wenn die Satzung
den Vorstand ausdrücklich dazu ermächtigt. Die App fragt danach und lässt die
Aufwandsspende sonst nicht zu.

Die Zahlungsfähigkeit wird am Tag der Einräumung geprüft, nicht heute: darauf
kommt es an. Kennt die App den Kontostand nicht, sagt sie das, statt
Leistungsfähigkeit zu unterstellen.

Bei Fahrtkosten rechnet sie mit 0,30 Euro je Kilometer, sonst gilt der
erfasste Betrag.

**Aus dem Verzicht entstehen zwei Buchungen**, nicht eine: der Aufwand in der
Sphäre, in der die Tätigkeit stattfand, und die Spende im ideellen Bereich.
Beide zum Tag des Verzichts, denn er bewirkt Zufluss und Abfluss im selben
Augenblick. Nur eine von beiden zu buchen wäre falsch: ohne den Aufwand fehlt
der Vereinsarbeit ihr Preis, ohne die Spende fehlt sie in der Mittelverwendung.

Die Spende trägt danach das Kennzeichen für das amtliche Muster, und die
Bestätigung **kreuzt den Verzicht von selbst an**. Aufwandsspenden und
gewöhnliche Zuwendungen gehören dabei in getrennte Bestätigungen, weil das
Muster nur ein Kreuz für das ganze Papier kennt. Auch darauf weist die App hin.

### Rücklastschriften

Kommt ein Einzug zurück, erkennt die App das beim Einlesen des Kontoauszugs.
Sie liest die Schlüssel, mit denen Banken den Verwendungszweck strukturieren
(`EREF`, `MREF`, `CRED`), und findet über die Referenz, die sie selbst in die
Lastschriftdatei geschrieben hat, genau die Forderung wieder. Ohne Referenz
sucht sie über die Mandatsreferenz und sagt dazu, dass es ein Vorschlag ist.
Passen zwei Forderungen gleich gut, ordnet sie nichts zu: lieber nichts als das
Falsche.

**Die Forderung wird wieder offen, nicht storniert.** Sie besteht ja weiter,
nur das Geld ist zurück. Der Einzugsvermerk fällt weg, damit sie erneut in eine
Lastschriftdatei darf.

Ob das klug ist, sagt der **Rückgabegrund**, und den kennt die App mit allen
siebzehn Codes:

| Grund | Folge |
| --- | --- |
| `MS03` Rückgabe durch die Bank, ohne Angabe | erneuter Einzug möglich |
| `MD01` kein gültiges Mandat | Mandat verbraucht, ein neues ist nötig |
| `MD06` Widerspruch des Zahlungspflichtigen | nicht erneut einziehen |
| `AC04` Konto erloschen, `AG01` Lastschrift unzulässig | neue Bankverbindung nötig |
| `AM05` Doppeleinreichung, `BE05` Gläubiger-ID falsch | unser Fehler |

**Der häufigste Code sagt am wenigsten.** In Deutschland verbietet das
Datenschutzrecht der Bank, dem Gläubiger mitzuteilen, ob das Konto nicht
gedeckt war, gesperrt ist oder der Kontoinhaber verstorben ist: alle drei
kommen als `MS03` an. Die App sagt das dazu, statt fehlende Deckung zu
unterstellen.

Die **Gebühr der Bank** wird als Ausgabe erfasst. Sie lässt sich dem Mitglied
weiterberechnen, wenn es die Rückgabe zu vertreten hat: das ist Schadensersatz
nach §280 Abs. 1 BGB und deshalb **ohne Umsatzsteuer**, denn mangels
Leistungsaustausch ist er nicht steuerbar (Abschnitt 1.3 UStAE). Weitergegeben
werden darf dabei nur die tatsächliche Gebühr. Der eigene Bearbeitungsaufwand
gehört ausdrücklich nicht dazu, eine Pauschale mit Bearbeitungsanteil ist
unwirksam (BGH, Urteil vom 17.09.2009, Xa ZR 40/08). Die App weist darauf hin
und stellt die Weiterberechnung nie von selbst an.

Die **Gebührenzeile der Bank** wird nicht mit der Rückgabe selbst verwechselt.
In ihr steht dasselbe Wort, aber weder Referenz noch Rückgabecode, und deshalb
bleibt sie eine gewöhnliche Ausgabe.

### Vorabankündigung

Vor dem Einzug muss das Mitglied wissen, wann welcher Betrag von seinem Konto
geht. Das ist keine Höflichkeit: ein vollständiger Verzicht darauf lässt sich
nicht einmal vereinbaren, auch nicht in der Satzung, und ohne Ankündigung kann
das Mitglied der Belastung widersprechen, obwohl das Mandat gültig ist.

Die App erzeugt daraus einen **Serienbrief**, ein Blatt je Mitglied, mit den
vier Pflichtangaben: Betrag, Termin, Mandatsreferenz und Gläubiger-ID.

Bei gleichbleibenden Beträgen genügt **ein Schreiben für das ganze Jahr**,
sofern es alle Beträge und alle Termine nennt. Genau das ist der Regelfall im
Verein, und deshalb steht auf dem Blatt der komplette Beitragsplan statt eines
Briefs je Fälligkeit. Ab sieben Terminen wird die Tabelle zweispaltig, damit
auch ein monatlicher Beitrag mit zwölf Fälligkeiten einseitig bleibt: beim
Kuvertieren eines Serienbriefs ist ein unbemerkt zweites Blatt die
Fehlerquelle.

Das Anschriftfeld sitzt auf der genormten Stelle nach DIN 5008, 45 Millimeter
von der Blattoberkante, damit der Brief in den Fensterumschlag passt. Die
Kontonummer steht nur verkürzt darin, denn ein Brief kann im Umschlag verloren
gehen.

Die Regelfrist sind **14 Kalendertage** vor dem Einzug, verkürzen geht per
Satzung. Die App rechnet aus, bis wann die Post draußen sein muss, und sagt es,
wenn die Frist schon abgelaufen ist.

Verschickt wird nicht aus der App heraus: sie legt das PDF ab, gedruckt und
kuvertiert wird davon unabhängig.

Wer eintritt oder austritt, bekommt ein Datum und bleibt im Bestand. Gelöscht
wird ein Mitglied nur, solange keine Buchung an ihm hängt, denn die Buchhaltung
muss zehn Jahre nachvollziehbar bleiben. Aus den Daten entstehen außerdem die
Zahlen, nach denen der Verband fragt: Bestand am Jahresende, Ein- und
Austritte, Aufteilung nach Art und Zahlweise, Durchschnittsalter und Anteil der
unter Achtzehnjährigen.

Ein Mitglied kann auch **Zuwendender** sein. Die Zuwendungsbestätigung findet
Name und Anschrift dann am Mitglied und nicht in der Kundenliste.

### Rücklagen nach §62 AO

Mittel sind grundsätzlich zeitnah zu verwenden. Rücklagen sind die erlaubten
Ausnahmen, und jede hat ihren eigenen Grund, ihre eigene Grenze und ihre eigene
Auflösungspflicht:

| Art | Grundlage | Besonderheit |
| --- | --- | --- |
| Zweckgebundene Rücklage | §62 Abs. 1 Nr. 1 | braucht ein konkretes Vorhaben und eine Zeitvorstellung |
| Betriebsmittelrücklage | §62 Abs. 1 Nr. 1 | für wiederkehrende Ausgaben, in Höhe des Bedarfs einer angemessenen Zeit |
| Wiederbeschaffungsrücklage | §62 Abs. 1 Nr. 2 | Höhe bemisst sich nach der Abschreibung des zu ersetzenden Guts |
| Freie Rücklage | §62 Abs. 1 Nr. 3 | ohne Zweckbindung, dafür der Höhe nach begrenzt, muss nie aufgelöst werden |
| Gesellschaftsrechte | §62 Abs. 1 Nr. 4 | um die Beteiligungsquote zu halten |
| Vermögenszuführung | §62 Abs. 3 | Erbschaften und Zuwendungen ins Vermögen, gar nicht zeitnah zu verwenden |

**Die freie Rücklage ist die einzige, deren Höhe sich rechnen lässt**, und die
App rechnet sie vor:

```
  ein Drittel des Überschusses aus der Vermögensverwaltung
+ zehn Prozent der sonstigen zeitnah zu verwendenden Mittel
```

Zu den sonstigen Mitteln zählen die **Bruttoeinnahmen des ideellen Bereichs**
und die **Gewinne** aus Zweckbetrieb und wirtschaftlichem Geschäftsbetrieb. Die
Vermögensverwaltung bleibt dort außen vor, sie steckt schon im ersten Drittel.
Ein Verlust mindert die Grundlage nicht unter null.

Wird der Höchstbetrag eines Jahres nicht ausgeschöpft, lässt sich der Rest in
den **beiden folgenden Jahren** nachholen. Die App führt diese Reste mit und
sagt, wann der älteste verfällt.

Gewarnt wird außerdem, wenn eine Frist abgelaufen ist (dann ist die Rücklage
nach §62 Abs. 2 AO unverzüglich aufzulösen), wenn eine Rücklage seit drei
Jahren unverändert liegt, und wenn der freien Rücklage mehr zugeführt wurde als
zulässig.

### Vermögensübersicht

Die Rechenschaft nach §63 Abs. 3 AO besteht nicht nur aus Einnahmen und
Ausgaben: das Finanzamt will wissen, wo die Mittel liegen, die nicht verwendet
wurden. Die App stellt das aus dem zusammen, was sie weiß:

| Aktiva | Passiva |
| --- | --- |
| Bank und Kasse, fortgeschrieben aus dem hinterlegten Stand | Verbindlichkeiten aus erfassten, noch nicht gezahlten Ausgaben |
| Forderungen aus offenen Rechnungen | Rücklagen, einzeln nach §62 AO |
| Anlagevermögen zum Restbuchwert | Vereinsvermögen als Saldo |

Dazu die **Mittelverwendungsrechnung**: was war zeitnah zu verwenden, was ist
verwendet, was in Rücklagen eingestellt, und was bleibt übrig. Alles zusammen
lässt sich als Blatt drucken und der Erklärung beilegen.

Ohne hinterlegten Kontostand zeigt die Zeile "Bank und Kasse" nur die
Bewegungen und nicht den Bestand. Die App sagt das dazu, statt eine Zahl zu
behaupten, die sie nicht kennt.

### Zuwendungsbestätigungen

Aus den erfassten Spenden und Mitgliedsbeiträgen entsteht die Bestätigung nach
**amtlichem Muster** (§50 EStDV), einzeln oder als Sammelbestätigung für ein
ganzes Jahr, samt Betrag in Buchstaben.

Der Wortlaut ist nicht gestaltbar: nach §50 Abs. 1 EStDV ist das amtliche
Muster Voraussetzung dafür, dass der Spender die Zuwendung absetzen kann. Fehlt
eine Pflichtangabe, sagt die App es und stellt nichts aus. Das schützt den
Verein, denn wer eine unrichtige Bestätigung ausstellt, haftet nach §10b Abs. 4
EStG mit dreißig Prozent des Betrags.

Geprüft wird unter anderem, ob die Angaben zum Freistellungsbescheid vorhanden
und nicht älter als fünf Jahre sind, ob die Anschrift des Zuwendenden
feststeht und ob bei einer Sachspende die Wertermittlung beschrieben ist. Bis
300 Euro genügt dem Spender ohnehin der Kontoauszug (§50 Abs. 4 EStDV), auch
darauf weist die App hin.

## Zeiten

Arbeitszeit auf Projekte erfassen, mit Stoppuhr oder als Nachtrag. Eine
laufende Aufnahme ist ein Eintrag ohne Ende und übersteht damit auch einen
Absturz. Gerundet wird beim Anhalten, nicht währenddessen: die Uhr zeigt die
Wahrheit, die Abrechnung folgt der eingestellten Regel.

Gespeichert werden Minuten, nicht Stunden. Alles andere führt zu 0,3333
Stunden und zu Summen, die nicht aufgehen. Der Stundensatz kommt vom Projekt,
sonst aus den Einstellungen, und wird **am Eintrag festgehalten**: eine spätere
Erhöhung macht Vergangenes nicht teurer.

Aus offenen Zeiten entsteht ein Rechnungsentwurf, wahlweise zusammengefasst je
Stundensatz, je Tag oder je Eintrag. Die Zeiten merken sich diesen Entwurf
sofort, damit sie nicht in einem zweiten landen; wird er gelöscht, sind sie
wieder offen.

## Reisekosten

Verpflegungspauschale und Kilometergeld sind die beiden Beträge, die man nicht
belegt, sondern rechnet:

| Fall | Betrag |
| --- | --- |
| mehr als 8 Stunden abwesend | 14,00 € |
| An- und Abreisetag | 14,00 € |
| volle 24 Stunden | 28,00 € |
| je gefahrener Kilometer | 0,30 € |

Gestellte Mahlzeiten kürzen: Frühstück um 20, Mittag- und Abendessen um je 40
Prozent **des vollen Tagessatzes**, auch an einem Teiltag. Genau daran
verrechnen sich die meisten.

Aus einer Reise entstehen zwei Buchungen, beide ohne Vorsteuer: aus einer
Pauschale gibt es keine, es gibt ja keine Rechnung. Wer die Kilometerpauschale
ansetzt, kann daneben nicht zusätzlich tanken absetzen.

## Kontoauszug

Die CSV aus dem Onlinebanking einlesen, statt jede Zeile abzutippen. Die App
erkennt die Datei selbst:

| Was | Wie |
| --- | --- |
| Trennzeichen | geraten aus der Datei, Semikolon, Komma, Tabulator oder Strich |
| Zeichensatz | UTF-8, sonst Windows-1252, das die deutschen Banken liefern |
| Kopfzeile | gesucht, nicht angenommen, denn davor steht oft ein Vorspann |
| Spalten | über die verbreiteten Bezeichnungen der Institute |
| Betrag | eine Spalte mit Vorzeichen, getrennte Spalten für Soll und Haben, oder Betrag plus Kennzeichen S und H |

Jede Zeile bekommt einen Vorschlag. Eine Gutschrift, deren Verwendungszweck
eine offene Rechnungsnummer enthält, wird als **Zahlung auf diese Rechnung**
gebucht, nicht als zweite Einnahme. Auch "RE 2026 0004" und "RE20260004"
führen zur richtigen Rechnung. Ohne Nummer reicht ein Betrag, der auf genau
eine offene Forderung passt, als Hinweis; passt er auf zwei, bleibt die Zeile
unzugeordnet, statt zu raten.

Für alles andere kommt die Kategorie aus drei Quellen, in dieser Reihenfolge:
einer selbst angelegten Regel, den eigenen früheren Buchungen mit derselben
Gegenpartei, und sonst der Vorgabe nach Vorzeichen. Woher der Vorschlag
stammt, steht an jeder Zeile. Regeln entstehen nebenbei, mit dem Häkchen
"Zuordnung merken".

**Doppelt gebucht wird nichts.** Jede Zeile trägt einen Fingerabdruck aus
Datum, Betrag, Gegenpartei und Verwendungszweck, der an der Buchung gespeichert
wird. Zwei gleiche Lastschriften am selben Tag bleiben allerdings zwei
Buchungen: der Fingerabdruck zählt Wiederholungen mit, sonst verschwände die
zweite.

Gebucht wird auch hier nichts von allein. Die Datei wird gelesen und wieder
losgelassen, nichts davon landet im Datenordner. Der Kontoauszug belegt die
Zahlung, nicht die Leistung: für den Vorsteuerabzug bleibt die Rechnung des
Lieferanten nötig, und der Steuersatz kommt aus der Kategorie, weil ein
Kontoauszug keine Steuer kennt.

## Mahnwesen

Drei Begriffe, die das Programm auseinanderhält, weil sie im Alltag gern
verwechselt werden: **Fälligkeit** ist der Tag, bis zu dem gezahlt werden soll,
**Verzug** der Zustand danach, aus dem Zinsansprüche folgen, und die **Mahnung**
das Schreiben, das den Verzug begründen oder anmahnen kann.

Gemahnt wird an der Rechnung, nicht in einer eigenen Ansicht. Drei Stufen:

| Stufe | Frist | Kosten |
| --- | --- | --- |
| Zahlungserinnerung | 10 Tage | keine, setzt aber in Verzug |
| Erste Mahnung | 7 Tage | Zinsen, Pauschale, Gebühr |
| Letzte Mahnung | 7 Tage | dieselben, mit Ankündigung des Mahnverfahrens |

Verzug tritt nach §286 BGB entweder mit einer Mahnung ein oder von selbst
dreißig Tage nach Fälligkeit. Gegenüber Verbrauchern gilt die Dreißig-Tage-Regel
nur, wenn in der Rechnung darauf hingewiesen wurde, deshalb ist sie abschaltbar.

Zinsen nach §288 BGB: fünf Prozentpunkte über dem Basiszinssatz gegenüber
Verbrauchern, neun Prozentpunkte zwischen Unternehmen, dazu die Pauschale von
vierzig Euro nach §288 Abs. 5 BGB, die es gegenüber Verbrauchern nicht gibt.
Gerechnet wird taggenau auf Basis von 365 Tagen, ab dem Tag nach der ersten
Mahnung.

**Den Basiszinssatz erfindet das Programm nicht.** Er wird halbjährlich von der
Bundesbank festgesetzt, steht in den Einstellungen und ist dort nachzutragen.
Solange er auf null steht, sagt der Mahndialog das jedes Mal dazu.

Ob jemand als Unternehmer gilt, entscheidet die USt-IdNr. oder ein
ausdrücklich gesetztes Kennzeichen am Kunden. Das ändert Zinssatz und Pauschale, also
steht es im Dialog, statt still im Hintergrund zu wirken.

Jede Mahnung wird an der Rechnung festgehalten, mit Datum, Stufe, Frist, Zinsen
und gefordertem Betrag, und als Schreiben im selben Layout wie alle anderen
Dokumente ausgegeben. Die letzte lässt sich zurücknehmen, falls das Geld doch
noch eingegangen ist.

## Fristen

Ein Kalender, der nichts erfindet: jeder Termin stammt aus derselben Rechnung,
die auch die jeweilige Ansicht anzeigt. Gesammelt werden

- Umsatzsteuer-Voranmeldungen und die Sondervorauszahlung
- Zusammenfassende Meldungen, mit Hinweis, wenn sie noch nicht meldefähig sind
- Einkommensteuer- und Umsatzsteuer-Jahreserklärung
- fällige Rechnungen und auslaufende Bindefristen von Angeboten
- Mahnungen, die nach der gesetzten Frist anstehen
- wiederkehrende Posten, die anzulegen sind

Sortiert nach Datum, gruppiert nach Monat, gefiltert nach Art. Was überfällig
ist, bleibt stehen, egal wie alt. Was mehr als ein halbes Jahr entfernt ist,
verschwindet, weil es niemandem hilft.

Nachholbedarf aus wiederkehrenden Vorlagen steht als **eine** Zeile auf heute.
Wer eine Vorlage rückwirkend anlegt, hätte sonst ein Dutzend verpasster Fristen
im Kalender und könnte ihn wegwerfen.

Die Abgabefristen der Jahreserklärungen sind der gesetzliche Regelfall, auf den
nächsten Werktag geschoben. Mit steuerlicher Beratung ist es Ende Februar des
übernächsten Jahres, und das steht als Hinweis am Termin, statt stillschweigend
gerechnet zu werden.

## Auswertung

Jede Buchung und jedes Dokument trägt vier Dimensionen: **Bereich**, **Projekt**,
**Land** und **Kunde**. Nach außen bleibt alles ein Gewerbe und eine EÜR, intern
zeigt die Auswertung, welcher Teil trägt und welcher nur beschäftigt.

Die Ansicht **Auswertung** rechnet durchgehend netto, weil die Umsatzsteuer ein
durchlaufender Posten ist und nichts über den Erfolg eines Bereichs sagt.
Sie zeigt:

- Umsatz, Kosten und Ergebnis je Bereich, Land, Steuerraum, Kunde, Projekt und Kategorie
- den Monatsverlauf, gestapelt nach Bereich
- den Vorjahresvergleich
- **wiederkehrenden Umsatz** getrennt von Einmalzahlungen, samt laufendem
  Monatsumsatz. Für ein Abo-Geschäft die eine Zahl, die zählt, und sie wird
  unbrauchbar, sobald Einmalzahlungen mitgerechnet werden
- das **Klumpenrisiko**: wie viel Umsatz an einem einzelnen Kunden hängt
- das **Zahlungsverhalten** je Kunde, gerechnet aus Rechnungsdatum und Zahlungseingang

**Projekte** klammern Angebote, Rechnungen und Kosten eines Auftrags zusammen
und zeigen Marge und Budgetverbrauch.

## Rücklage und Liquidität

**Steuerrücklage**: die offene Umsatzsteuer ist exakt gerechnet, die
Einkommensteuer geschätzt mit einem einstellbaren Satz. Maßgeblich ist der
höchste Steuersatz, nicht der durchschnittliche, weil der Gewinn zum übrigen
Einkommen hinzukommt. Die Gewerbesteuer bleibt außen vor, solange kein Hebesatz
hinterlegt ist.

**Liquiditätsvorschau** über sechs Monate aus Kontostand, offenen Rechnungen,
noch unbezahlten Buchungen und fälligen Steuerterminen. Bewusst ohne Annahmen
über künftige Aufträge: eine Vorschau, die sich Umsätze ausdenkt, beruhigt nur.

## Umsatzsteuer

Die Ansicht zeigt je Zeitraum die Kennzahlen des amtlichen Vordrucks in der
Reihenfolge des Formulars, dazu Abgabefristen mit Wochenendverschiebung und,
wenn eingeschaltet, die Sondervorauszahlung bei Dauerfristverlängerung.

Die Zahlen sind zum Abtippen in ELSTER gedacht. Die App übermittelt nichts.

### Grenzüberschreitende Umsätze

Aus dem Sitzland der Gegenpartei und ihrer Umsatzsteuer-Identifikationsnummer
folgt, wo ein Umsatz steuerbar ist. Die App führt das mit:

| Fall | Behandlung | Kennzahl |
| --- | --- | --- |
| Inland | normaler Steuersatz | 81 oder 86 |
| EU, Unternehmer mit USt-IdNr. | Reverse Charge nach §3a Abs. 2, im Inland nicht steuerbar | 21, dazu Meldepflicht |
| EU, ohne USt-IdNr. | steuerpflichtig wie im Inland | 81 oder 86 |
| Drittland | nicht steuerbar | 45 |

**Zusammenfassende Meldung**: Leistungen an Unternehmer im übrigen
Gemeinschaftsgebiet müssen dem Bundeszentralamt gemeldet werden, je Kunde mit
USt-IdNr. und Summe. Anders als bei der Voranmeldung zählt dort nicht die
Zahlung, sondern der Zeitpunkt der Leistung. Die App bereitet die Meldung vor
und weist auf fehlende oder unstimmige Nummern hin.

**Plattformerlöse**: Verkauft eine Plattform als Merchant of Record im eigenen
Namen an die Endkunden, ist sie der Kunde. Sitzt sie in der EU, ist es eine
Dienstleistung an einen Unternehmer mit Reverse Charge, sitzt sie im Drittland,
ist der Umsatz nicht steuerbar. Die Umsatzsteuer der Endkunden geht den Anbieter
dann nichts an, und das OSS-Verfahren entfällt. Dafür gibt es die Kategorie
Plattformerlöse und einen Kundeneintrag für die Plattform selbst.

## Entwicklung

```bash
npm test                      # 632 Tests über Rechenkern, Dokumente, Auswertung, Wiederholungen, Mahnwesen, Kontoauszug, E-Rechnung, Zeiten, Verein, Mitglieder, SEPA, Vorabankündigung, Rücklastschriften, Aufwandsspenden, Nacherfassung, Rücklagen, DATEV, GoBD, Profile, Datenhaltung, Verschlüsselung
npm start                     # App starten
npm run typecheck             # nur die Typen prüfen, ohne zu bauen
npm run preview               # Oberfläche im Browser unter localhost:4173
npm run smoke:pdf             # ganze PDF-Kette prüfen, Ergebnisse in tools/ausgabe
npm run dist:win              # Installer bauen
```

Der Rechenkern ist TypeScript und wird nach `out/` übersetzt, deshalb bauen die
Skripte vorher. Die Läufe, die eine laufende App brauchen und darum nicht in
`npm test` passen:

```bash
npm run smoke                 # startet die App und klickt jede Ansicht durch
npm run smoke:a11y            # Barrierefreiheit: Kontrast, Beschriftungen, Tastatur, Dialoge
npm run smoke:lock            # Einrichten, Entsperren, Wiederherstellen, Aufheben über mehrere Programmläufe
node tools/palette.js         # rechnet die Farbpalette aus und prüft sie
node tools/make-fixture.js    # Beispieldaten für die Vorschau erzeugen
node tools/make-icon.js       # Icon aus build/icon.svg in PNGs und .ico umsetzen
```

`tools/start-smoke.js` gibt es, weil ein laufender Prozess nichts beweist: das
Fenster kann leer sein, wenn im Renderer eine Ausnahme fliegt. Genau so ist die
Navigation schon einmal verschwunden.

`tools/palette.js` ist die Quelle der Farbwerte in `src/renderer/styles/app.css`. Wer dort
eine Farbe ändert, ändert sie hier und lässt das Skript laufen.

Die Vorschau unter `tools/` rendert dieselbe Oberfläche mit vorberechneten
Beispieldaten im Browser, ohne Electron. Praktisch für Layoutarbeit. Die
Dokumentvorschau darin kommt vom Entwicklungsserver, der dafür dieselben
Module aufruft wie die App.

Aufbau: unter `src/` liegt der gesamte Quellcode, nach Verantwortung getrennt.

```
src/domain/     Rechenkern in TypeScript, kennt weder Electron noch DOM
src/export/     erzeugt XML, PDF, Dokument-CSS und Excel
src/import/     liest E-Rechnungen und Belege ein
src/storage/    hält die Daten: Speicher, Profile, Belege, Umzug der alten Fassung
src/security/   Tresor und Schlüsselbund, also alles Kryptografische
src/main/       der Electron-Hauptprozess mit den IPC-Handlern
src/preload/    die Brücke zwischen Hauptprozess und Oberfläche
src/renderer/   die Oberfläche in reinem JavaScript ohne Framework
src/shared/     Typen, die beide Seiten teilen
test/           gespiegelt nach domain, export, import, storage, security
tools/          Entwicklungswerkzeuge, Prüfläufe und die Browser-Vorschau
```

Rechnungen und Angebote teilen sich den Editor in
`src/renderer/scripts/views/document-editor.js`.

Zur Gestaltung: Überschriften, Kennzahlen und Tabellenköpfe stehen in
Bahnschrift, dem DIN-1451-Abkömmling von Windows. Fließtext bleibt bei Segoe UI.
Bewusst keine Webfonts, die App läuft offline. Farbe ist nie die einzige
Auskunft: der aktive Navigationspunkt trägt zusätzlich einen Balken, jede
Statusmarke ihr Wort, jede Kennzahl ihr Label.

## Umzug von der ersten Fassung

Die App hieß zuerst Kontor. Mit dem Namen wechselt auch der Ordner, in dem
Electron seine Konfiguration ablegt, deshalb sucht NestEgg beim ersten Start
ausdrücklich nach dem alten Datenbestand und bietet an, ihn zu übernehmen. Ohne
das würde die App leer starten, während die Buchhaltung unangetastet daneben
liegt. Der Ablauf steht in `src/storage/legacy.js` und ist vollständig getestet.

## Kanzlei und Prüfung

**DATEV-Buchungsstapel** im EXTF-Format, der Weg zu jeder Kanzleisoftware. Der
Stapel enthält alle bezahlten Buchungen eines Jahres; was kein Zahlungsdatum
hat, bleibt draußen und wird gemeldet, denn ein Stapel nach Zu- und
Abflussprinzip bildet Zahlungen ab.

Der Kontenrahmen folgt der Körperschaft: ein Einzelunternehmen bekommt
**SKR 03 oder SKR 04**, ein Verein **SKR 42**. Der frühere Vereinsrahmen
SKR 49 ist zum 1. Januar 2025 durch SKR 42 abgelöst worden und wird von DATEV
weder unterstützt noch gepflegt, deshalb steht er nicht zur Wahl.

Im Verein steckt die Sphäre nicht im Konto, sondern in der **Kostenstelle**:
1 ideell, 2 Vermögensverwaltung, 3 Zweckbetrieb, 4 wirtschaftlicher
Geschäftsbetrieb. Was noch keiner Sphäre zugeordnet ist, geht auf 9,
den Sammelposten, statt stillschweigend im ideellen Bereich zu landen.

Die Kontenzuordnung ist ein **Vorschlag** nach üblichem Gebrauch, in den
Einstellungen für jede Kategorie änderbar. Welche Konten die Kanzlei
tatsächlich bebucht, weiß nur die Kanzlei: vor dem ersten Stapel gehört das
abgestimmt. Wo kein Konto hinterlegt ist, bleibt die Spalte leer und der Export
meldet es. Ein falsches Konto ist schlimmer als ein fehlendes, denn das
fehlende sieht die Kanzlei.

**Verfahrensdokumentation nach GoBD.** Sie beschreibt, wie ein Beleg entsteht,
erfasst und aufbewahrt wird, und ist dem Grunde nach Pflicht, auch bei einer
EÜR. Für Einzelunternehmer ohne Mitarbeiter wird ein Verzicht anerkannt, wenn
sich der Ablauf in wenigen Sätzen erklären lässt; fehlt sie und bleibt eine
Frage offen, sind Zuschätzungen möglich.

Die App schreibt sie aus dem tatsächlichen Stand dieser Installation:
eingestellte Besteuerungsart, Nummernkreise mit Zählerstand, Ablageorte,
Schemastand, Mengengerüst. Was sie nicht wissen kann, etwa auf welchem Weg
Rechnungen versendet werden, bleibt als markierte Lücke darin stehen, statt
erfunden zu werden.

**Datenüberlassung nach §147 Abs. 6 AO.** Die Prüfung darf die Daten maschinell
auswertbar verlangen (Z3). Die App erzeugt dafür einen Ordner mit CSV-Dateien
und einer `index.xml` nach dem Beschreibungsstandard, die jede Spalte benennt
und ihren Typ angibt. Ohne diese Datei ist eine CSV nur eine Textdatei.
Geschrieben wird in Windows-1252, weil die Prüfsoftware der Finanzverwaltung
das erwartet.

Jede Buchung trägt dabei ihre **Herkunft**: von Hand, aus dem Kontoauszug, aus
einer E-Rechnung, aus einer wiederkehrenden Vorlage oder als Zahlung auf eine
eigene Rechnung.

## Frühere Jahre nacherfassen

Wer schon vor dieser App gearbeitet hat, kann Rechnungen und Belege aus
abgeschlossenen Jahren nachtragen, damit die Auswertung weiter zurückreicht.
Dafür steht in den Einstellungen das Feld **Buchführung in dieser App ab**.

Frühere Jahre werden dann anders behandelt:

| | Nacherfasstes Jahr |
| --- | --- |
| Auswertung, Dashboard, Kunden- und Bereichszahlen | zählen normal mit |
| EÜR und Umsatzsteuer | werden gerechnet, aber deutlich als nacherfasst gekennzeichnet |
| Fristenkalender | bleibt leer, es gibt nichts mehr abzugeben |
| Mahnwesen | übergeht sie, diese Forderungen sind erledigt oder abgeschrieben |

Der Grund für die Kennzeichnung: Nacherfasste Daten sind selten vollständig.
Eine EÜR daraus wäre falsch, und ohne Hinweis merkt das später niemand mehr.

**Rechnungen behalten ihre Nummer.** Ein Beleg aus einem früheren Jahr trägt
seine Nummer schon; beim Festschreiben fragt die App danach, statt eine neue zu
vergeben. Der laufende Nummernkreis wird dabei nicht weitergezählt, es entsteht
also keine Lücke. Doppelte Nummern weist die App ab.

## Grenzen

Das Programm ersetzt keine steuerliche Beratung. Kategorien, Abzugsgrenzen und
die Zuordnung der EÜR-Positionen sind nach bestem Wissen umgesetzt, die
Verantwortung für die Erklärung bleibt beim Nutzer. Es führt keine doppelte
Buchführung und ist nicht für eine Bilanz gedacht.

Die Einkommensteuer in der Rücklage ist eine Schätzung mit einem selbst
gesetzten Satz, keine Berechnung. Sie hängt vom gesamten zu versteuernden
Einkommen ab, das dieses Programm nicht kennt.

Das OSS-Verfahren für digitale Leistungen an Privatkunden in der EU ist nicht
abgebildet. Wer selbst an Endkunden in der EU verkauft und die Schwelle von
10.000 Euro überschreitet, braucht es. Läuft der Verkauf über eine Plattform,
die als Merchant of Record auftritt, entfällt die Frage.

Für die Aufbewahrungspflicht gehört der Datenordner in die reguläre
Datensicherung. §147 AO unterscheidet dabei: Buchungsbelege sind seit dem
Vierten Bürokratieentlastungsgesetz acht Jahre aufzubewahren, Bücher und
Aufzeichnungen und damit die Buchungsdatei selbst weiterhin zehn.

Ist die Verschlüsselung eingeschaltet, hängt die Lesbarmachung nach §147 Abs. 5
AO am Passwort und am Wiederherstellungsschlüssel. Beide gehören über die
gesamte Frist verwahrt, getrennt voneinander und getrennt vom Rechner.
