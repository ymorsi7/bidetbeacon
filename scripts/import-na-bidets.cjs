#!/usr/bin/env node
/**
 * Append verified North America bidet rows (USA, Canada, Mexico) with dedupe.
 * Reads data/atly-na-bidets.json, data/mexico-verified-bidets.json, data/coast-hotels-na.json
 */
const fs = require('fs');
const { readSeed, writeSeed } = require('./lib/bidet-seed.cjs');
const path = require('path');

const SOURCES = [
  path.join(__dirname, '../data/atly-na-bidets.json'),
  path.join(__dirname, '../data/mexico-verified-bidets.json'),
  path.join(__dirname, '../data/coast-hotels-na.json'),
  path.join(__dirname, '../data/canada-atly-bidets.json'),
  path.join(__dirname, '../data/na-supplemental-bidets.json'),
];

const { inferType } = require('./lib/infer-type.cjs');

const NA = new Set(['USA', 'Canada', 'Mexico']);

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
    /washlet|toto|heated|electronic bidet|smart toilet|neorest/i.test(row.bidetType || '');

  return {
    name: row.name,
    address: row.address,
    latitude: String(row.latitude),
    longitude: String(row.longitude),
    city: row.city,
    country: row.country,
    type: row.type || inferType(row),
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

const existing = readSeed();
const seen = new Set(existing.map(dedupeKey));
const seenUrl = new Set(existing.filter((r) => r.sourceUrl).map((r) => r.sourceUrl));

let added = 0;
let skipped = 0;
const merged = [...existing];

for (const dataPath of SOURCES) {
  if (!fs.existsSync(dataPath)) {
    console.warn('Skip missing:', dataPath);
    continue;
  }
  const batch = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  for (const item of batch) {
    if (!NA.has(item.country)) {
      skipped++;
      continue;
    }
    if (!item.sourceUrl || !item.sourceQuote || !item.latitude) {
      skipped++;
      continue;
    }
    const row = toSeedRow(item);
    if (seenUrl.has(row.sourceUrl)) {
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
  }
}

writeSeed(merged);

const counts = { USA: 0, Canada: 0, Mexico: 0 };
merged.filter((r) => NA.has(r.country)).forEach((r) => {
  counts[r.country]++;
});

console.log(`NA import: +${added} new (${skipped} skipped).`);
console.log('NA totals:', counts);
console.log(`Total seed entries: ${merged.length}`);
