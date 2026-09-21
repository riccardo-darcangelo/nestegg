'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Copies everything tsc does not touch into the build output.
 * Run: node tools/copy-assets.js
 *
 * The renderer is still plain JavaScript loaded through script tags, so it is
 * copied rather than compiled. Once it moves to TypeScript this shrinks to
 * HTML and CSS.
 */

const fs = require('node:fs');
const path = require('node:path');

const { ROOT } = require('./paths');
const OUT = path.join(ROOT, 'out');

const COPY = ['src/renderer', 'build'];
const SKIP = /^(node_modules|out|dist|ausgabe)$/;

function copyTree(from, to) {
  let copied = 0;

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.test(entry.name)) continue;

    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copied += copyTree(source, target);
      continue;
    }

    // Skip files that have not changed, so a rebuild stays fast.
    const stat = fs.statSync(source);
    if (fs.existsSync(target) && fs.statSync(target).mtimeMs >= stat.mtimeMs) continue;

    fs.copyFileSync(source, target);
    copied += 1;
  }

  return copied;
}

let total = 0;
for (const dir of COPY) {
  const from = path.join(ROOT, dir);
  if (!fs.existsSync(from)) continue;

  const to = path.join(OUT, dir);
  fs.mkdirSync(to, { recursive: true });
  total += copyTree(from, to);
}

console.log(`assets: ${total} file(s) copied to out/`);
