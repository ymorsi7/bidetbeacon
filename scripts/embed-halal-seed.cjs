#!/usr/bin/env node
/**
 * Embed halal restaurant data inline in halal.html (static site — no fetch).
 *
 *   node scripts/embed-halal-seed.cjs
 *   node scripts/embed-halal-seed.cjs path/to/rows.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'halal.html');
const DEFAULT_JSON = path.join(ROOT, 'data/halal-restaurants.json');

const src = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_JSON;
if (!fs.existsSync(src)) {
  console.error('No seed file:', src);
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(src, 'utf8'));
if (!Array.isArray(rows)) {
  console.error('Expected JSON array');
  process.exit(1);
}

// Drop internal import-only field before embed.
const seed = rows.map(({ source, ...rest }) => rest);

let html = fs.readFileSync(HTML, 'utf8');
const marker = 'window.HALALBUD_SEED = ';
const re = /window\.HALALBUD_SEED\s*=\s*\[[\s\S]*?\];/;

if (!re.test(html)) {
  const insert = `<script>\n${marker}${JSON.stringify(seed)};\n</script>\n`;
  const needle = '<script src="https://unpkg.com/leaflet.markercluster';
  if (!html.includes(needle)) {
    console.error('Could not find insertion point in halal.html');
    process.exit(1);
  }
  html = html.replace(needle, insert + needle);
} else {
  html = html.replace(re, `${marker}${JSON.stringify(seed)};`);
}

fs.writeFileSync(HTML, html);
const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(`Embedded ${seed.length} restaurants into halal.html (${kb} KB)`);
