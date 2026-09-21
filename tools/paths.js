'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Where the project lives.
 *
 * The tools run twice: from the source tree during development and from `out/`
 * after a build, because everything they call is TypeScript by now. Walking up
 * to the package.json finds the root either way, whereas a fixed `..` lands in
 * `out/` and misses node_modules, build and the fixture.
 */

const fs = require('node:fs');
const path = require('node:path');

function projectRoot(from = __dirname) {
  let dir = from;

  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`no package.json above ${from}`);
    dir = up;
  }

  return dir;
}

const ROOT = projectRoot();

module.exports = { ROOT, projectRoot, TOOLS: path.join(ROOT, 'tools') };
