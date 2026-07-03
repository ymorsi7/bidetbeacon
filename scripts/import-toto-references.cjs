#!/usr/bin/env node
/**
 * Import all TOTO Europe WASHLET references into BIDETBEACON_SEED.
 * Source: data/toto-europe-references.json (from scrape-toto-references.cjs)
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '../index.html');
const dataPath = path.join(__dirname, '../data/toto-europe-references.json');

function dedupeKey(row) {
  return [
    row.name.toLowerCase(),
    Number(row.latitude).toFixed(5),
    Number(row.longitude).toFixed(5),
  ].join('|');
}

function toSeedRow(row) {
  return {
    name: row.name,
    address: row.address || '',
    latitude: String(row.latitude),
    longitude: String(row.longitude),
    city: row.city,
    country: row.country,
    type: row.type || 'public',
    bidetStatus: 'warmed',
    bidetType: row.bidetType || 'TOTO WASHLET',
    sourceUrl: row.sourceUrl,
    sourceQuote: row.sourceQuote,
    verifiedMethod: 'manufacturer-reference',
    access: row.access || 'limited',
    ...(row.accessNote ? { accessNote: row.accessNote } : {}),
  };
}

if (!fs.existsSync(dataPath)) {
  console.error('Run: node scripts/scrape-toto-references.cjs first');
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/window\.BIDETBEACON_SEED\s*=\s*(\[[\s\S]*?\]);/);
if (!match) {
  console.error('BIDETBEACON_SEED not found');
  process.exit(1);
}

const existing = JSON.parse(match[1]);
const toto = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Drop prior TOTO manufacturer-reference rows to avoid stale duplicates on re-import
const withoutToto = existing.filter(
  (r) =>
    r.verifiedMethod !== 'manufacturer-reference' ||
    !String(r.sourceUrl || '').includes('eu.toto.com')
);

const seen = new Set(withoutToto.map(dedupeKey));
const seenUrl = new Set(
  withoutToto.filter((r) => r.sourceUrl).map((r) => r.sourceUrl)
);

let added = 0;
const merged = [...withoutToto];

for (const item of toto) {
  if (!item.sourceUrl || !item.latitude) continue;
  const row = toSeedRow(item);
  const key = dedupeKey(row);
  if (seenUrl.has(row.sourceUrl) || seen.has(key)) continue;
  seen.add(key);
  seenUrl.add(row.sourceUrl);
  merged.push(row);
  added++;
}

const newHtml = html.replace(
  /window\.BIDETBEACON_SEED\s*=\s*\[[\s\S]*?\];/,
  `window.BIDETBEACON_SEED = ${JSON.stringify(merged)};`
);
fs.writeFileSync(htmlPath, newHtml);

const byCountry = merged
  .filter((r) => String(r.sourceUrl || '').includes('eu.toto.com'))
  .reduce((a, r) => {
    a[r.country] = (a[r.country] || 0) + 1;
    return a;
  }, {});

console.log(`Added ${added} TOTO locations (${toto.length} in source file).`);
console.log('TOTO entries by country:', byCountry);
console.log(`Total seed entries: ${merged.length}`);
