#!/usr/bin/env node
/**
 * Import Mexico / Colombia / Venezuela bidet rows into BIDETBUD_SEED.
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '../index.html');
const SOURCES = [
  path.join(__dirname, '../data/atly-latam-bidets.json'),
  path.join(__dirname, '../data/mexico-scraped-bidets.json'),
  path.join(__dirname, '../data/mexico-verified-bidets.json'),
  path.join(__dirname, '../data/mexico-supplemental-bidets.json'),
  path.join(__dirname, '../data/mexico-web-bidets.json'),
  path.join(__dirname, '../data/colombia-web-bidets.json'),
  path.join(__dirname, '../data/venezuela-web-bidets.json'),
  path.join(__dirname, '../data/latam-wide-bidets.json'),
  path.join(__dirname, '../data/kayak-latam-bidets.json'),
  path.join(__dirname, '../data/na-supplemental-bidets.json'),
];

const LATAM = new Set(['Mexico', 'Colombia', 'Venezuela']);

function normName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function dedupeKey(row) {
  return [normName(row.name), Number(row.latitude).toFixed(5), Number(row.longitude).toFixed(5)].join('|');
}

function isNearDuplicate(existing, candidate) {
  if (existing.country !== candidate.country) return false;
  const a = normName(existing.name);
  const b = normName(candidate.name);
  if (a === b) return true;
  const min = Math.min(a.length, b.length, 14);
  if (min >= 8 && (a.includes(b.slice(0, min)) || b.includes(a.slice(0, min)))) {
    const dLat = Math.abs(Number(existing.latitude) - Number(candidate.latitude));
    const dLon = Math.abs(Number(existing.longitude) - Number(candidate.longitude));
    if (dLat < 0.03 && dLon < 0.03) return true;
  }
  return false;
}

function toSeedRow(row) {
  const isWarm =
    row.bidetStatus === 'warmed' ||
    /washlet|toto|heated|electronic bidet|smart toilet|neorest|japon[eé]s|autom[aá]tico|inteligente/i.test(
      row.bidetType || ''
    );

  return {
    name: row.name,
    address: row.address || '',
    latitude: String(row.latitude),
    longitude: String(row.longitude),
    city: row.city,
    country: row.country,
    type: row.type || 'restaurant',
    bidetStatus: row.bidetStatus || (isWarm ? 'warmed' : 'internet'),
    bidetType: row.bidetType || (isWarm ? 'TOTO / washlet bidet' : 'Bidet'),
    sourceUrl: row.sourceUrl,
    sourceQuote: row.sourceQuote,
    verifiedMethod: row.verifiedMethod || 'web-source',
    access: row.access || (row.type === 'hotel' ? 'limited' : 'public'),
    ...(row.accessNote ? { accessNote: row.accessNote } : {}),
  };
}

const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/window\.BIDETBUD_SEED\s*=\s*(\[[\s\S]*?\]);/);
if (!match) {
  console.error('BIDETBUD_SEED not found');
  process.exit(1);
}

const existing = JSON.parse(match[1]);
const seen = new Set(existing.map(dedupeKey));
const seenUrl = new Set(existing.filter((r) => r.sourceUrl).map((r) => r.sourceUrl));

let added = 0;
let skipped = 0;
const merged = [...existing];
const byCountry = { Mexico: 0, Colombia: 0, Venezuela: 0 };

for (const dataPath of SOURCES) {
  if (!fs.existsSync(dataPath)) {
    console.warn('Skip missing:', dataPath);
    continue;
  }
  const batch = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  for (const item of batch) {
    if (!LATAM.has(item.country)) {
      skipped++;
      continue;
    }
    if (!item.sourceUrl || !item.sourceQuote || !item.latitude) {
      skipped++;
      continue;
    }
    const row = toSeedRow(item);
    if (seenUrl.has(row.sourceUrl) && existing.some((e) => isNearDuplicate(e, row))) {
      skipped++;
      continue;
    }
    const key = dedupeKey(row);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    if (existing.some((e) => isNearDuplicate(e, row))) {
      skipped++;
      continue;
    }
    seen.add(key);
    seenUrl.add(row.sourceUrl);
    merged.push(row);
    added++;
    byCountry[row.country] = (byCountry[row.country] || 0) + 1;
    process.stderr.write(`+ [${row.country}] ${row.name}\n`);
  }
}

const newHtml = html.replace(
  /window\.BIDETBUD_SEED\s*=\s*\[[\s\S]*?\];/,
  `window.BIDETBUD_SEED = ${JSON.stringify(merged)};`
);
fs.writeFileSync(htmlPath, newHtml);

console.log(`LATAM import: +${added} new (${skipped} skipped). Total seed: ${merged.length}`);
console.log('Added by country:', byCountry);
for (const c of LATAM) {
  console.log(`${c} total:`, merged.filter((r) => r.country === c).length);
}
