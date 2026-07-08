#!/usr/bin/env node
/**
 * Merge all halal list sources into data/halal-restaurants.json, then embed
 * into halal.html (static site — no runtime fetch).
 *
 * Sources (if present):
 *   data/zabihah-halal-restaurants.json
 *   data/osm-halal-restaurants.json
 *   data/muis-halal-restaurants.json
 *   data/halal-reddit-restaurants.json
 *   data/halal-web-crawl-restaurants.json
 *   data/halal-directory-restaurants.json
 *   data/halal-restaurants-seed.json  (Atly / manual)
 *
 *   node scripts/import-halal-all.cjs
 */
const fs = require('fs');
const path = require('path');
const { mergeRows } = require('./lib/halal-web.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/halal-restaurants.json');

const SOURCES = [
  { file: 'data/zabihah-halal-restaurants.json', label: 'Zabihah' },
  { file: 'data/osm-halal-restaurants.json', label: 'OpenStreetMap' },
  { file: 'data/muis-halal-restaurants.json', label: 'MUIS Singapore' },
  { file: 'data/halal-reddit-restaurants.json', label: 'Reddit' },
  { file: 'data/halal-web-crawl-restaurants.json', label: 'Web search (Yelp/TripAdvisor/Google/social)' },
  { file: 'data/halal-directory-restaurants.json', label: 'Halal directories' },
  { file: 'data/halal-restaurants-seed.json', label: 'Atly/manual seed' },
];

function readJson(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.establishments || raw.rows || [];
  if (rel === 'data/osm-halal-restaurants.json') {
    return list.map((r) => {
      const q = r.sourceQuote || '';
      const halalStatus = /diet:halal=only/i.test(q) ? 'full' : 'options';
      return { ...r, halalStatus };
    });
  }
  if (rel === 'data/muis-halal-restaurants.json') {
    return list.map((r) => ({ ...r, halalStatus: 'full' }));
  }
  return list;
}

let merged = [];
const stats = [];

for (const src of SOURCES) {
  const rows = readJson(src.file);
  const { rows: next, added } = mergeRows(merged, rows);
  stats.push({ label: src.label, file: src.file, inFile: rows.length, added });
  merged = next;
}

fs.writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n');

console.log(`Halal import: ${merged.length} restaurants (non-default countries) → ${path.relative(ROOT, OUT)}`);
for (const s of stats) {
  console.log(`  ${s.label}: ${s.inFile} in file, +${s.added} new`);
}

const byCountry = {};
for (const r of merged) {
  const c = r.country || '(unknown)';
  byCountry[c] = (byCountry[c] || 0) + 1;
}
const top = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('  Top countries:', top.map(([c, n]) => `${c}(${n})`).join(', '));

const full = merged.filter((r) => r.halalStatus === 'full').length;
const opts = merged.filter((r) => r.halalStatus === 'options').length;
console.log(`  Fully halal: ${full} · Halal options: ${opts}`);

const zabihahRows = readJson('data/zabihah-halal-restaurants.json');
if (zabihahRows.length > 50) {
  const zFull = zabihahRows.filter((r) => r.halalStatus === 'full').length;
  const ratio = zFull / zabihahRows.length;
  if (ratio > 0.85) {
    console.warn(
      `  WARNING: ${Math.round(ratio * 100)}% of Zabihah rows are "fully halal" — run node scripts/reclassify-zabihah.cjs --import (or --instant for no network)`,
    );
  }
}

require('child_process').execSync('node scripts/embed-halal-seed.cjs', {
  cwd: ROOT,
  stdio: 'inherit',
});
