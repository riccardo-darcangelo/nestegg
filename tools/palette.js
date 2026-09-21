'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Rechnet die Farbpalette aus und prüft sie.
 * Aufruf: node tools/palette.js
 *
 * Farben werden hier nicht geraten, sondern aus drei Regeln abgeleitet, die
 * in den Leitfäden zum dunklen Design übereinstimmend stehen:
 *
 *   1. Die Grundfläche ist kein Schwarz. Reines Schwarz gibt es in der Natur
 *      nicht, und weißer Text darauf beginnt zu leuchten (Halation). Material
 *      nennt #121212 als Boden.
 *   2. Höhe entsteht durch Helligkeit, nicht durch Schatten. Jede Stufe legt
 *      eine halbdurchsichtige Schicht über den Boden: 5, 7, 9, 12, 16 Prozent.
 *      Ein schwarzer Schatten auf dunklem Grund ist unsichtbar.
 *   3. Schrift steht nicht auf vollem Weiß, sondern auf 87, 60 und 38 Prozent.
 *      Der Unterschied dieser Stufen trägt die Rangfolge.
 *
 * Dazu kommt die Regel für Akzentfarben: auf dunklem Grund brennen gesättigte
 * Farben. Material verschiebt sie um zwei Tonstufen ins Hellere und nimmt
 * Sättigung heraus. Genau das passiert hier mit dem Teal von GuildNest.
 */

/* --------------------------------------------------------- Farbrechnen */

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  const zwei = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${zwei(r)}${zwei(g)}${zwei(b)}`;
}

/** Legt eine halbdurchsichtige Schicht über eine Fläche. */
function overlay(base, layer, prozent) {
  const a = hexToRgb(base);
  const b = hexToRgb(layer);
  const t = prozent / 100;
  return rgbToHex([0, 1, 2].map((i) => a[i] * (1 - t) + b[i] * t));
}

function rgbToHsl([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0));
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToRgb([h, s, l]) {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const teil = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]
  ][Math.floor((h % 360) / 60)];
  return teil.map((v) => (v + m) * 255);
}

function adjust(hex, { s = 0, l = 0, h = 0 } = {}) {
  const [H, S, L] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb([
    (H + h + 360) % 360,
    Math.max(0, Math.min(100, S + s)),
    Math.max(0, Math.min(100, L + l))
  ]));
}

/* ------------------------------------------------------------ Kontrast */

function luminance(hex) {
  const kanal = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex).map(kanal);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/* -------------------------------------------------------------- Aufbau */

// Der Boden. GuildNest setzt auf #181819, Material auf #121212. Dazwischen,
// eine Spur kühl, damit das Teal darauf nicht fremd wirkt.
const GRUND = '#15181b';

// Die Schicht, die Höhe macht. Nicht reines Weiß, sondern ein sehr blasses
// Blaugrün: so bekommen die Flächen einen eigenen Ton statt Fotograu, ohne
// dass irgendwo eine Farbfläche entsteht.
const SCHICHT = '#a8e8de';

/**
 * Sucht die kleinste Schicht, die als Rand noch sichtbar genug ist.
 *
 * WCAG 1.4.11 verlangt für Bedienelemente 3:1. Der Rand eines
 * Eingabefeldes ist das, woran man es überhaupt als Eingabefeld erkennt:
 * ist er zu blass, sieht man nicht, wo zu klicken ist. Für Trennlinien
 * zwischen Tabellenzeilen gilt das nicht, die sind Dekoration im Sinne der
 * Norm. Deshalb zwei Ränder statt einem.
 */
function randFor(flaechen, ziel) {
  for (let deckung = 10; deckung <= 90; deckung += 1) {
    const farbe = overlay(GRUND, SCHICHT, deckung);
    if (flaechen.every((f) => contrast(farbe, f) >= ziel)) return farbe;
  }
  throw new Error('Keine Schicht erfüllt das Ziel.');
}

const flaechen = {
  bg: GRUND,
  'bg-elevated': overlay(GRUND, SCHICHT, 5),
  'bg-panel': overlay(GRUND, SCHICHT, 7),
  'bg-hover': overlay(GRUND, SCHICHT, 11),
  'bg-raised': overlay(GRUND, SCHICHT, 16),
  border: overlay(GRUND, SCHICHT, 14),
  'border-strong': overlay(GRUND, SCHICHT, 26)
};

// Bedienelemente stehen auf dem Grund, in Tafeln und in Dialogen.
flaechen['border-control'] = randFor(
  [flaechen.bg, flaechen['bg-panel'], flaechen['bg-elevated']],
  3
);

/**
 * Sucht die kleinste Deckkraft, die auf einer Fläche noch trägt.
 *
 * Material nennt 87, 60 und 38 Prozent. Die 38 sind dort für Deaktiviertes
 * gedacht, also für Text, den man gerade nicht lesen soll. In dieser App
 * steht auf der blassesten Stufe aber echter Inhalt: der Zusatz unter einer
 * Kennzahl, die Zahl in einer Marke. Solcher Text ist unter 18,66 Pixel
 * normaler Fließtext und braucht nach WCAG AA 4,5:1. Deshalb wird die Stufe
 * nicht übernommen, sondern ausgerechnet.
 */
function faintFor(flaechen, ziel) {
  for (let deckung = 38; deckung <= 90; deckung += 1) {
    const farbe = overlay(GRUND, '#ffffff', deckung);
    if (flaechen.every((f) => contrast(farbe, f) >= ziel)) return farbe;
  }
  throw new Error('Keine Deckkraft erfüllt das Ziel.');
}

// Die hellste Fläche, auf der blasse Schrift vorkommt, ist die Marke in der
// Navigation. Was dort trägt, trägt überall.
const SIDEBAR = '#101314';

/*
  Drei Stufen, und alle drei müssen lesbar sein.

  Die 87/60/38 aus Material gehen hier nicht auf: die 38 sind dort für
  Deaktiviertes gedacht, für Text also, den man gerade nicht lesen soll. In
  dieser App steht auf der blassesten Stufe echter Inhalt. Also wird die
  oberste Stufe belassen, die mittlere angehoben, damit darunter Platz
  bleibt, und die unterste ausgerechnet.
*/
const schrift = {
  text: overlay(GRUND, '#ffffff', 87),
  'text-muted': overlay(GRUND, '#ffffff', 70),
  'text-faint': faintFor([GRUND, flaechen['bg-panel'], SIDEBAR], 4.5)
};

// GuildNest Teal Cyan. Ungebremst ist es ein Neonstrich auf dunklem Grund,
// genau das, wovor die Leitfäden warnen. Also Sättigung heraus und eine Spur
// dunkler, bis es wie eingefärbtes Metall wirkt und nicht wie eine Leuchtröhre.
const TEAL_ROH = '#55FCE6';
const akzent = {
  accent: adjust(TEAL_ROH, { s: -38, l: -8 }),
  'accent-bright': adjust(TEAL_ROH, { s: -22, l: -2 }),
  'accent-deep': adjust(TEAL_ROH, { s: -30, l: -34 })
};

// Geld hat zwei Richtungen, und beide müssen auf einen Blick auseinandergehen.
// Das Grün rutscht ins Gelbgrüne, weg vom Teal: zwei Blautöne nebeneinander
// in einer Spalte mit Beträgen wären eine Falle. Das Rot bleibt Rot, nur
// abgemildert, denn ein rosa Minusbetrag liest sich nicht als Warnung.
const semantisch = {
  income: adjust('#22C55E', { s: -22, l: 10, h: -12 }),
  expense: adjust('#EF4444', { s: -12, l: 14 }),
  warn: adjust('#F59E0B', { s: -24, l: 18 })
};

/* ------------------------------------------------------------- Ausgabe */

const alle = { ...flaechen, ...schrift, ...akzent, ...semantisch, sidebar: SIDEBAR };

console.log('Farbwerte\n');
for (const [name, wert] of Object.entries(alle)) {
  console.log(`  --${name.padEnd(14)} ${wert}`);
}

console.log('\nKontrast gegen die Flächen (WCAG AA verlangt 4.5 für Text, 3.0 für Große und Ränder)\n');
const proben = [
  ['text', 'bg'], ['text', 'bg-panel'], ['text', 'bg-elevated'], ['text', 'bg-raised'],
  ['text-muted', 'bg'], ['text-muted', 'bg-panel'],
  ['text-faint', 'bg'], ['text-faint', 'bg-panel'],
  ['accent', 'bg'], ['accent', 'bg-panel'], ['accent-bright', 'bg'],
  ['income', 'bg'], ['income', 'bg-panel'],
  ['expense', 'bg'], ['expense', 'bg-panel'],
  ['warn', 'bg'], ['warn', 'bg-panel'],
  ['border-strong', 'bg-panel'],
  ['border-control', 'bg'], ['border-control', 'bg-panel'], ['border-control', 'bg-elevated'],
  ['text-muted', 'bg-raised'], ['text', 'sidebar'],
  ['text-muted', 'sidebar'], ['text-faint', 'sidebar'], ['accent', 'sidebar']
];

let offen = 0;
for (const [vorne, hinten] of proben) {
  const wert = contrast(alle[vorne], alle[hinten]);
  // Ränder und die blasseste Schriftstufe müssen nur wahrnehmbar sein.
  // Bedienelemente 3:1 nach 1.4.11, bloße Trennlinien nur wahrnehmbar.
  const ziel = vorne === 'border-control' ? 3 : (/border/.test(vorne) ? 1.4 : 4.5);
  const ok = wert >= ziel;
  if (!ok) offen += 1;
  console.log(`  ${ok ? 'ok  ' : 'ENG '} ${vorne.padEnd(14)} auf ${hinten.padEnd(12)} ${wert.toFixed(2)}:1  (Ziel ${ziel})`);
}

// Und die Gegenprobe: Text auf der Akzentfläche, etwa auf einem Knopf.
const aufAkzent = contrast('#0d1112', alle.accent);
console.log(`\n  ${aufAkzent >= 4.5 ? 'ok  ' : 'ENG '} dunkle Schrift  auf accent      ${aufAkzent.toFixed(2)}:1  (Ziel 4.5)`);

// Halation: reines Weiß auf reinem Schwarz wäre 21:1. Die Leitfäden nennen
// rund 15.8:1 als angenehme Obergrenze.
const oben = contrast(alle.text, alle.bg);
console.log(`\n  Höchster Textkontrast: ${oben.toFixed(2)}:1 ${oben <= 16.5 ? '(unter der Halationsgrenze)' : '(ZU HOCH, Text leuchtet)'}`);

console.log(offen ? `\n${offen} Wert(e) zu eng.\n` : '\nAlle Werte tragen.\n');
process.exit(offen ? 1 : 0);
