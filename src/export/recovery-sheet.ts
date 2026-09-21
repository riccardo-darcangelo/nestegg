// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { escapeText as escape } from './xml';

/**
 * The sheet carrying the recovery key.
 *
 * It gets printed once and then filed with the tax papers. So it looks like a
 * form and not like a screen design: black on white, large figures, a fold
 * line, and a line to write down where it is kept.
 *
 * Deliberately without a company logo and without a hint which data it belongs
 * to. Whoever finds the sheet should not be able to tell which machine it
 * unlocks.
 */

export interface SheetOptions {
  /** Injectable so a test gets a stable date. */
  createdAt?: number | string | Date;
}

export function html(recoveryKey: string, options: SheetOptions = {}): string {
  const stamp = new Date(options.createdAt || Date.now()).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });

  const groups = String(recoveryKey).split('-');

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Wiederherstellungsschlüssel</title>
<style>
  @page { size: A4; margin: 0; }

  :root {
    --ink: #111111;
    --line: #9a9a9a;
    --soft: #555555;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    width: 210mm;
    min-height: 297mm;
    padding: 30mm 25mm;
    font-family: "Segoe UI", Arial, sans-serif;
    color: var(--ink);
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .kopf {
    border-bottom: 1.5pt solid var(--ink);
    padding-bottom: 5mm;
    margin-bottom: 12mm;
  }

  .marke {
    font-family: "Bahnschrift", "DIN Alternate", Arial, sans-serif;
    font-size: 13pt;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  h1 {
    font-family: "Bahnschrift", "DIN Alternate", Arial, sans-serif;
    font-size: 20pt;
    font-weight: 600;
    margin: 2mm 0 0;
  }

  .datum { font-size: 9pt; color: var(--soft); margin-top: 1.5mm; }

  p { font-size: 10.5pt; line-height: 1.6; margin: 0 0 4mm; }

  /* The key itself. Large enough to type without glasses, and in groups so
     the eye does not lose the line while copying. */
  .schluessel {
    border: 1pt solid var(--ink);
    padding: 10mm 6mm;
    margin: 8mm 0;
    text-align: center;
  }

  .gruppen {
    font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
    font-size: 21pt;
    font-weight: 600;
    letter-spacing: 0.1em;
    line-height: 1.85;
    word-spacing: 0.5em;
  }

  .hinweis {
    border-left: 2pt solid var(--ink);
    padding: 3mm 0 3mm 5mm;
    margin: 8mm 0;
    font-size: 10pt;
    line-height: 1.6;
  }

  .hinweis strong { font-weight: 700; }

  ul { font-size: 10pt; line-height: 1.7; padding-left: 5mm; margin: 0 0 4mm; }

  .feld {
    margin-top: 10mm;
    font-size: 9.5pt;
    color: var(--soft);
  }

  .linie {
    border-bottom: 0.7pt solid var(--line);
    height: 8mm;
    margin-top: 1mm;
  }

  .falz {
    margin-top: 14mm;
    border-top: 0.7pt dashed var(--line);
    padding-top: 2.5mm;
    font-size: 8pt;
    color: var(--soft);
    text-align: center;
    letter-spacing: 0.08em;
  }
</style>
</head>
<body>
  <div class="kopf">
    <div class="marke">NestEgg</div>
    <h1>Wiederherstellungsschlüssel</h1>
    <div class="datum">Ausgestellt am ${escape(stamp)}</div>
  </div>

  <p>
    Mit diesem Schlüssel lässt sich die verschlüsselte Buchführung öffnen, auch
    wenn das Passwort vergessen ist. Er ersetzt das Passwort vollständig.
  </p>

  <div class="schluessel">
    <div class="gruppen">${groups.map((g) => escape(g)).join('&nbsp;')}</div>
  </div>

  <div class="hinweis">
    <strong>Dieser Schlüssel existiert nur auf diesem Blatt.</strong>
    NestEgg speichert ihn nirgends, auch nicht verschlüsselt. Geht er zusammen
    mit dem Passwort verloren, sind die Daten endgültig nicht mehr lesbar.
  </div>

  <ul>
    <li>Getrennt vom Rechner aufbewahren, nicht im selben Raum wie das Gerät.</li>
    <li>Nicht abfotografieren und nicht in einen Cloud-Ordner legen.</li>
    <li>Wer dieses Blatt hat, kommt an die gesamte Buchführung.</li>
    <li>Nach einer Wiederherstellung wird ein neuer Schlüssel ausgegeben. Dieses Blatt ist dann zu vernichten.</li>
  </ul>

  <p style="font-size:9.5pt;color:#555555">
    Aufbewahrung ist keine Kür: §147 Abs. 1 AO verlangt die Aufbewahrung der
    Buchführung über zehn Jahre, §147 Abs. 5 AO ihre jederzeitige
    Lesbarmachung. Ein Bestand, den niemand mehr öffnen kann, erfüllt beides
    nicht.
  </p>

  <div class="feld">
    Aufbewahrungsort
    <div class="linie"></div>
  </div>

  <div class="falz">Hier falten und verschlossen aufbewahren</div>
</body>
</html>`;
}
