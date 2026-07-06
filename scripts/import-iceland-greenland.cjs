#!/usr/bin/env node
/**
 * Append verified Iceland + Greenland bidet locations into BIDETBUD_SEED.
 *
 * Sources (merged, in order):
 *   1. data/iceland-greenland-verified-bidets.json — hand-curated, cited rows
 *   2. data/nordic-web-crawl-bidets.json           — output of crawl-nordic-web.cjs (optional)
 *
 * Iceland/Greenland are NOT bidet-friendly, so every row must carry explicit
 * source evidence (sourceUrl + sourceQuote). Only net-new rows are added; existing
 * rows are never replaced. Dedupes on coords+name, on sourceUrl, and on a
 * normalized name key.
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '../index.html');
const SOURCES = [
  path.join(__dirname, '../data/iceland-greenland-verified-bidets.json'),
  path.join(__dirname, '../data/nordic-web-crawl-bidets.json'),
];

const NORDIC = new Set(['Iceland', 'Greenland']);

function toSeedRow(row) {
  const isWarm =
    row.bidetStatus === 'warmed' ||
    /washlet|toto|heated|electronic bidet|smart toilet|neorest|aquaclean|shower toilet/i.test(
      row.bidetType || ''
    );

  return {
    name: row.name,
    address: row.address,
    latitude: String(row.latitude),
    longitude: String(row.longitude),
    city: row.city,
    country: row.country,
    type: row.type || 'hotel',
    bidetStatus: row.bidetStatus || (isWarm ? 'warmed' : 'internet'),
    bidetType: row.bidetType,
    sourceUrl: row.sourceUrl,
    sourceQuote: row.sourceQuote,
    verifiedMethod: row.verifiedMethod || 'web-source',
    access: row.access || 'public',
    ...(row.accessNote ? { accessNote: row.accessNote } : {}),
    ...(row.searchAliases ? { searchAliases: row.searchAliases } : {}),
  };
}

function normName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function dedupeKey(row) {
  return [
    normName(row.name),
    Number(row.latitude).toFixed(5),
    Number(row.longitude).toFixed(5),
  ].join('|');
}

function isNearDuplicate(existing, candidate) {
  if (existing.country !== candidate.country) return false;
  const a = normName(existing.name);
  const b = normName(candidate.name);
  if (a === b) return true;
  if (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a))) {
    const dLat = Math.abs(Number(existing.latitude) - Number(candidate.latitude));
    const dLon = Math.abs(Number(existing.longitude) - Number(candidate.longitude));
    if (dLat < 0.02 && dLon < 0.02) return true;
  }
  return false;
}

const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/window\.BIDETBUD_SEED\s*=\s*(\[[\s\S]*?\]);/);
if (!match) {
  console.error('BIDETBUD_SEED not found');
  process.exit(1);
}

const existing = JSON.parse(match[1]);
const verified = [];
for (const src of SOURCES) {
  if (!fs.existsSync(src)) continue;
  try {
    const rows = JSON.parse(fs.readFileSync(src, 'utf8'));
    verified.push(...rows);
    console.log(`Loaded ${rows.length} rows from ${path.basename(src)}`);
  } catch (e) {
    console.warn(`Skipping ${path.basename(src)}: ${e.message}`);
  }
}
if (!verified.length) {
  console.error('No source rows found in', SOURCES.map((s) => path.basename(s)).join(', '));
  process.exit(1);
}

const seen = new Set(existing.map(dedupeKey));
const seenUrl = new Set(existing.filter((r) => r.sourceUrl).map((r) => r.sourceUrl));

let added = 0;
let skipped = 0;
const merged = [...existing];

for (const item of verified) {
  if (!item.sourceUrl || !item.sourceQuote) {
    console.warn('Skipping (no source evidence):', item.name);
    continue;
  }
  if (!NORDIC.has(item.country)) {
    console.warn('Skipping (not Iceland/Greenland):', item.name);
    continue;
  }
  const lat = Number(item.latitude);
  const lon = Number(item.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    console.warn('Skipping (bad coords):', item.name);
    continue;
  }

  const row = toSeedRow(item);
  const key = dedupeKey(row);

  if (seenUrl.has(row.sourceUrl)) {
    console.log('Skip (sourceUrl exists):', row.name);
    skipped++;
    continue;
  }
  if (seen.has(key)) {
    console.log('Skip (coords+name):', row.name);
    skipped++;
    continue;
  }
  if (existing.some((e) => isNearDuplicate(e, row))) {
    console.log('Skip (near duplicate):', row.name);
    skipped++;
    continue;
  }

  seen.add(key);
  seenUrl.add(row.sourceUrl);
  merged.push(row);
  added++;
}

const newHtml = html.replace(
  /window\.BIDETBUD_SEED\s*=\s*\[[\s\S]*?\];/,
  `window.BIDETBUD_SEED = ${JSON.stringify(merged)};`
);
fs.writeFileSync(htmlPath, newHtml);

const counts = {};
merged
  .filter((r) => NORDIC.has(r.country))
  .forEach((r) => {
    counts[r.country] = (counts[r.country] || 0) + 1;
  });

console.log(`Iceland/Greenland import: +${added} new (${skipped} skipped, ${verified.length} in source).`);
console.log('Nordic totals:', counts);
console.log(`Total seed entries: ${merged.length}`);
