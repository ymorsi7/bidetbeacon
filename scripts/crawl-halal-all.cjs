#!/usr/bin/env node
/**
 * Run all halal list crawlers then merge into halal.html.
 *
 *   node scripts/crawl-halal-all.cjs --minutes=120
 *   node scripts/crawl-halal-all.cjs --minutes=60 --zabihah-only
 *   node scripts/crawl-halal-all.cjs --minutes=60 --extras-only   # skip Zabihah
 *   node scripts/crawl-halal-all.cjs --minutes=30 --osm-only
 */
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const minutesArg = args.find((a) => a.startsWith('--minutes='));
const MINUTES = minutesArg ? minutesArg.split('=')[1] : '90';
const zabihahOnly = args.includes('--zabihah-only');
const osmOnly = args.includes('--osm-only');
const extrasOnly = args.includes('--extras-only');
const skipImport = args.includes('--no-import');

function run(cmd) {
  console.log('\n▶', cmd);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

try {
  run('node scripts/import-muis-halal.cjs');
  run('node scripts/import-halal-atly.cjs');
  run('node scripts/crawl-halal-directories.cjs');

  if (!osmOnly && !extrasOnly) {
    run(`node scripts/crawl-zabihah.cjs --minutes=${MINUTES} --no-import`);
  }

  if (!zabihahOnly) {
    run(`node scripts/crawl-osm-halal.cjs --minutes=${Math.max(15, Math.floor(Number(MINUTES) / 3))}`);
    run('node scripts/crawl-reddit-halal.cjs');
    run(`node scripts/crawl-halal-web.cjs --minutes=${Math.max(20, Math.floor(Number(MINUTES) / 2))}`);
  }

  if (!skipImport) run('node scripts/import-halal-all.cjs');
} catch (e) {
  process.exit(e.status || 1);
}
