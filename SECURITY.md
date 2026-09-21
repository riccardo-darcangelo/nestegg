# Sicherheit

NestEgg verwaltet Umsätze, Kundendaten, Kontoverbindungen und Belege. Diese
Daten liegen auf dem Rechner des Nutzers, auf Wunsch verschlüsselt. Wer eine
Schwachstelle findet, die diesen Schutz aushebelt, soll sie melden können, ohne
sie vorher öffentlich zu machen.

## Wohin melden

**info@darcdesign.de**

Schreib bitte hin, was du gefunden hast, wie es sich auslösen lässt und was ein
Angreifer damit erreichen könnte. Ein Beispiel oder ein kurzer Ablauf hilft mehr
als eine Vermutung. Wenn du magst, verschlüssele die Nachricht; sag in dem Fall
kurz Bescheid, unter welchem Schlüssel.

Bitte **kein** öffentliches Issue für Sicherheitslücken. Für alles andere ist der
Issue-Tracker der richtige Ort.

## Was du erwarten kannst

Das hier ist ein Einzelprojekt und kein Unternehmen. Ich melde mich in der Regel
innerhalb von sieben Tagen, und ich sage dir ehrlich, ob und wann ich etwas
reparieren kann. Ein Kopfgeld gibt es nicht. Wenn du möchtest, nenne ich dich in
den Anmerkungen zur Fassung, die den Fehler behebt.

Gefixt wird jeweils die aktuelle Fassung. Ältere Stände bekommen keine
Nachlieferung.

## Was eine Schwachstelle ist

Die App läuft offline. Es gibt keinen Server, kein Konto und keine Übertragung
irgendwohin. Damit fallen ganze Klassen von Problemen weg, und andere rücken in
den Vordergrund. Besonders interessieren mich:

- Wege, den verschlüsselten Bestand ohne Passwort und ohne
  Wiederherstellungsschlüssel zu öffnen
- Fehler in der Ableitung oder Verwahrung der Schlüssel, etwa ein Schlüssel, der
  im Klartext auf der Platte landet
- Daten, die trotz eingeschalteter Verschlüsselung offen liegen bleiben, etwa in
  Sicherungen, im Änderungsprotokoll oder in temporären Dateien
- Ausbrüche aus der Trennung zwischen Oberfläche und Hauptprozess, also alles,
  was aus dem Renderer heraus beliebigen Code ausführt
- Eingelesene Dateien, die den Prozess übernehmen: ein präpariertes PDF, ein
  Kontoauszug oder eine E-Rechnung aus fremder Hand

Kein Sicherheitsfall ist dagegen, dass jemand mit Zugang zum entsperrten
Rechner die Daten lesen kann. Dagegen hilft die Verschlüsselung erst, wenn die
App zu ist, und der Schutz endet an der Anmeldung des Betriebssystems.

## Verschlüsselung in Kürze

Verschlüsselt wird mit AES-256-GCM und einem zufälligen Datenschlüssel, der nie
im Klartext auf die Platte kommt. Dieser Schlüssel liegt mehrfach verpackt vor:
einmal hinter dem Passwort, einmal hinter dem Wiederherstellungsschlüssel und,
wenn der Nutzer es will, einmal hinter einem Geräteschlüssel, den das
Betriebssystem verwahrt. Die Ableitung aus dem Passwort nutzt scrypt mit den
Werten, die das OWASP Password Storage Cheat Sheet nennt, wenn Argon2id nicht
zur Verfügung steht.

Der Wiederherstellungsschlüssel ist kein Komfort, sondern Pflichtprogramm:
§147 Abs. 1 AO verlangt zehn Jahre Aufbewahrung und Abs. 5 die jederzeitige
Lesbarmachung. Ein Bestand, den niemand mehr öffnen kann, ist ein Verstoß gegen
beides.

## Rechtlicher Rahmen

NestEgg wird unentgeltlich und außerhalb einer gewerblichen Tätigkeit
abgegeben. Damit greifen weder die Herstellerpflichten des Cyber Resilience Act
noch die neue Produkthaftungsrichtlinie. Diese Seite gibt es trotzdem, weil ein
erreichbarer Kontakt das Mindeste ist, was ein Programm mit solchen Daten
mitbringen sollte.
