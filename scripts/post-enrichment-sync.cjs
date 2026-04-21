#!/usr/bin/env node
/**
 * Post-enrichment sync — run after any artist enrichment batch.
 * 1. Re-runs genre denorm (overwrites all gig genres from fresh artist data)
 * 2. Re-runs upcoming counts
 *
 * Usage:  node scripts/post-enrichment-sync.cjs
 */
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ROOT = path.join(__dirname, '..');

function run(label, cmd) {
  console.log(`\n▶ ${label}...`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

// Clear resume state so genre denorm does a full fresh pass
const progressFile = path.join(__dirname, 'update-gig-genres-progress.json');
if (fs.existsSync(progressFile)) {
  fs.unlinkSync(progressFile);
  console.log('Cleared genre denorm progress cache');
}

run('Genre denorm (full pass)', 'node scripts/update-gig-genres.cjs');
run('Upcoming counts', 'node scripts/update-upcoming-counts.cjs');
run('Stats snapshot', 'node scripts/live-stats.cjs --once');

console.log('\n✓ Post-enrichment sync complete');
