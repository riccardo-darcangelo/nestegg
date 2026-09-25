// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
'use strict';

/**
 * Bestimmt die nächste Version aus den Commits und schreibt sie fest.
 *
 * Aufruf: node tools/version.js [--dry|--check]
 *
 * Grundlage sind die Conventional Commits seit dem letzten Versionstag. Ein
 * `feat` hebt die zweite Stelle, ein `fix` die dritte, ein Ausrufezeichen
 * hinter dem Typ oder ein `BREAKING CHANGE` im Rumpf die erste. Was weder das
 * eine noch das andere ist, etwa `chore` oder `docs`, hebt für sich genommen
 * gar nichts: eine neue Fassung nur für eine Änderung am README hilft
 * niemandem.
 *
 * Das Ergebnis landet in package.json, in CHANGELOG.md und als Tag. Die App
 * liest ihre Version über app.getVersion() aus package.json, der Installer
 * trägt sie im Dateinamen, also genügt diese eine Stelle.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { ROOT } = require('./paths');

const DRY = process.argv.includes('--dry');
const CHECK = process.argv.includes('--check');

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Der letzte Versionstag, oder null beim allerersten Lauf. */
function lastTag() {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v*');
  } catch {
    return null;
  }
}

/**
 * Die Commits seit dem Tag, als Paare aus Kopfzeile und Rumpf.
 *
 * Der Nullbyte-Trenner ist nötig, weil ein Rumpf Leerzeilen enthält und jedes
 * andere Trennzeichen irgendwann in einer Commit-Nachricht vorkommt.
 */
function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const raw = git('log', range, '--format=%s%n%b%x00');

  return raw
    .split('\0')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [subject, ...rest] = block.split('\n');
      return { subject, body: rest.join('\n') };
    });
}

const CONVENTIONAL = /^(\w+)(\([^)]*\))?(!)?:\s*(.+)$/;

function parse(commit) {
  const match = CONVENTIONAL.exec(commit.subject);
  if (!match) return null;

  const [, type, scope, bang, description] = match;
  return {
    type,
    scope: scope ? scope.slice(1, -1) : null,
    breaking: Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(commit.body),
    description
  };
}

/** major, minor, patch oder null, wenn nichts eine neue Fassung rechtfertigt. */
function bumpFor(commits) {
  let bump = null;

  for (const commit of commits) {
    if (commit.breaking) return 'major';
    if (commit.type === 'feat') bump = 'minor';
    else if (commit.type === 'fix' && bump !== 'minor') bump = 'patch';
  }

  return bump;
}

function nextVersion(current, bump) {
  const [major, minor, patch] = current.split('.').map(Number);

  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const SECTIONS = [
  ['breaking', 'Nicht abwärtskompatibel'],
  ['feat', 'Neu'],
  ['fix', 'Behoben'],
  ['perf', 'Schneller'],
  ['refactor', 'Umgebaut'],
  ['docs', 'Dokumentation']
];

/** Der Abschnitt einer Fassung, nach Art der Änderung gegliedert. */
function changelogEntry(version, commits) {
  const day = new Date().toISOString().slice(0, 10);
  const lines = [`## ${version} (${day})`, ''];

  for (const [key, heading] of SECTIONS) {
    const matching = commits.filter((commit) => (key === 'breaking' ? commit.breaking : commit.type === key && !commit.breaking));
    if (!matching.length) continue;

    lines.push(`### ${heading}`, '');
    for (const commit of matching) {
      lines.push(`- ${commit.scope ? `**${commit.scope}:** ` : ''}${commit.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

const CHANGELOG_HEAD = `# Änderungen

Diese Datei wird erzeugt: \`npm run release\`. Sie folgt den Commits, nicht
umgekehrt, deshalb steht hier nur, was auch im Verlauf steht.

`;

function writeChangelog(entry) {
  const file = path.join(ROOT, 'CHANGELOG.md');
  const existing = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').replace(CHANGELOG_HEAD, '')
    : '';

  fs.writeFileSync(file, `${CHANGELOG_HEAD}${entry}\n${existing}`.trimEnd() + '\n', 'utf8');
}

/* Ablauf */

const packageFile = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));

const tag = lastTag();
const commits = commitsSince(tag).map(parse).filter(Boolean);
const bump = bumpFor(commits);

// Der Prüfmodus hängt vor dem Bau und sagt nur Bescheid, ohne abzubrechen.
if (CHECK) {
  if (bump) {
    console.log(`Hinweis: seit v${pkg.version} liegen ${commits.length} Commit(s) vor, die eine neue Fassung rechtfertigen (${bump}). Mit "npm run release" wird sie gesetzt.`);
  }
  process.exit(0);
}

console.log(`Stand: ${pkg.version}${tag ? ` (Tag ${tag})` : ' (noch kein Tag)'}`);
console.log(`Commits seit dem Tag: ${commits.length}`);

if (!bump) {
  console.log('Keine Änderung, die eine neue Fassung rechtfertigt.');
  process.exit(0);
}

const version = nextVersion(pkg.version, bump);
console.log(`Sprung: ${bump} -> ${version}\n`);
console.log(changelogEntry(version, commits));

if (DRY) {
  console.log('Trockenlauf, nichts geschrieben.');
  process.exit(0);
}

pkg.version = version;
fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
writeChangelog(changelogEntry(version, commits));

git('add', 'package.json', 'CHANGELOG.md');
git('commit', '-s', '-m', `chore(release): ${version}`);
git('tag', '-a', `v${version}`, '-m', `NestEgg ${version}`);

console.log(`Festgeschrieben und getaggt: v${version}`);
