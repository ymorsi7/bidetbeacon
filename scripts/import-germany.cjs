#!/usr/bin/env node
/**
 * Import Germany bidet locations — VERIFIED SOURCES ONLY.
 *
 * Allowed sources:
 * - TOTO Europe / Geberit manufacturer references
 * - Official German hotel sites with explicit Dusch-WC/Washlet mentions
 * - Curated rows in data/germany-verified-bidets.json (each must cite evidence)
 *
 * Re-import replaces all existing Germany rows so addresses/coords stay in sync.
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '../index.html');
const verifiedPath = path.join(
  __dirname,
  '../data/germany-verified-bidets.json'
);

function toSeedRow(row) {
  const isWarm =
    row.bidetStatus === 'warmed' ||
    /washlet|toto|heated|electronic bidet|dusch-wc|aquaclean|neorest/i.test(
      row.bidetType || ''
    );

  return {
    name: row.name,
    address: row.address,
    latitude: String(row.latitude),
    longitude: String(row.longitude),
    city: row.city,
    country: 'Germany',
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

function dedupeKey(row) {
  return [
    row.name.toLowerCase(),
    Number(row.latitude).toFixed(5),
    Number(row.longitude).toFixed(5),
  ].join('|');
}

if (!fs.existsSync(verifiedPath)) {
  console.error('Missing', verifiedPath);
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/window\.BIDETBUD_SEED\s*=\s*(\[[\s\S]*?\]);/);
if (!match) {
  console.error('BIDETBUD_SEED not found');
  process.exit(1);
}

const existing = JSON.parse(match[1]);
const verified = JSON.parse(fs.readFileSync(verifiedPath, 'utf8'));

const withoutGermany = existing.filter((row) => row.country !== 'Germany');
const seen = new Set(withoutGermany.map(dedupeKey));
let added = 0;

for (const item of verified) {
  if (!item.sourceUrl || !item.sourceQuote) {
    console.warn('Skipping (no source evidence):', item.name);
    continue;
  }
  const row = toSeedRow(item);
  const key = dedupeKey(row);
  if (seen.has(key)) continue;
  seen.add(key);
  withoutGermany.push(row);
  added++;
}

const newHtml = html.replace(
  /window\.BIDETBUD_SEED\s*=\s*\[[\s\S]*?\];/,
  `window.BIDETBUD_SEED = ${JSON.stringify(withoutGermany)};`
);
fs.writeFileSync(htmlPath, newHtml);

console.log(
  `Germany import: ${added} locations (${verified.length} in source). Removed ${existing.filter((r) => r.country === 'Germany').length} prior Germany row(s).`
);
console.log(`Total seed entries: ${withoutGermany.length}`);
