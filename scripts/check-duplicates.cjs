#!/usr/bin/env node
/**
 * Detect duplicate entries in BIDETBUD_SEED (index.html).
 *
 * Reports three classes of likely-duplicate:
 *   1. Exact coordinate collisions (rounded to 5 decimals)
 *   2. Same normalized name AND near-identical coordinates (~<75m)
 *   3. Same normalized name AND same city/country
 *
 * Read-only: prints a report, does not modify any files.
 *
 * Usage: node scripts/check-duplicates.cjs
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '../index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/window\.BIDETBUD_SEED\s*=\s*(\[[\s\S]*?\]);/);
if (!match) {
  console.error('BIDETBUD_SEED not found');
  process.exit(1);
}
const seed = JSON.parse(match[1]);
console.log(`Total seed entries: ${seed.length}\n`);

function nameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/["'’.,]/g, '')
    .replace(
      /\b(hotel|hôtel|resort|the|le|la|das|der|die|gmbh|restaurant|masjid|mosque|islamic|center|centre|cafe|café|inn|and|&)\b/g,
      ''
    )
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function coordKey(row, dp = 5) {
  return [Number(row.latitude).toFixed(dp), Number(row.longitude).toFixed(dp)].join('|');
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(Number(b.latitude) - Number(a.latitude));
  const dLon = toRad(Number(b.longitude) - Number(a.longitude));
  const la1 = toRad(Number(a.latitude));
  const la2 = toRad(Number(b.latitude));
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const groups = new Map();
let missingCoords = 0;

seed.forEach((row, i) => {
  const rowWithIdx = { ...row, __i: i };
  if (
    row.latitude == null ||
    row.longitude == null ||
    Number.isNaN(Number(row.latitude)) ||
    Number.isNaN(Number(row.longitude))
  ) {
    missingCoords++;
  }
  const nk = nameKey(row.name);
  if (!groups.has(nk)) groups.set(nk, []);
  groups.get(nk).push(rowWithIdx);
});

// --- 1. Exact coordinate collisions ---
const byCoord = new Map();
seed.forEach((row, i) => {
  if (Number.isNaN(Number(row.latitude)) || Number.isNaN(Number(row.longitude))) return;
  const ck = coordKey(row);
  if (!byCoord.has(ck)) byCoord.set(ck, []);
  byCoord.get(ck).push({ ...row, __i: i });
});

const exactCoordDups = [...byCoord.values()].filter((g) => g.length > 1);
console.log(`=== 1. Exact coordinate collisions (5dp): ${exactCoordDups.length} groups ===`);
exactCoordDups.forEach((g) => {
  console.log(`  @ ${g[0].latitude},${g[0].longitude}`);
  g.forEach((r) => console.log(`     [#${r.__i}] ${r.name} — ${r.city || ''}, ${r.country || ''} (${r.bidetStatus})`));
});
console.log();

// --- 2. Same name + near-identical coords (<75m) ---
console.log('=== 2. Same normalized name + within ~75m ===');
let nameCoordDupCount = 0;
for (const [nk, rows] of groups) {
  if (!nk || rows.length < 2) continue;
  for (let a = 0; a < rows.length; a++) {
    for (let b = a + 1; b < rows.length; b++) {
      const ra = rows[a];
      const rb = rows[b];
      if (Number.isNaN(Number(ra.latitude)) || Number.isNaN(Number(rb.latitude))) continue;
      const d = haversine(ra, rb);
      if (d < 75) {
        nameCoordDupCount++;
        console.log(`  ~${Math.round(d)}m apart:`);
        console.log(`     [#${ra.__i}] ${ra.name} — ${ra.city || ''}, ${ra.country || ''} @ ${ra.latitude},${ra.longitude} (${ra.bidetStatus})`);
        console.log(`     [#${rb.__i}] ${rb.name} — ${rb.city || ''}, ${rb.country || ''} @ ${rb.latitude},${rb.longitude} (${rb.bidetStatus})`);
      }
    }
  }
}
if (nameCoordDupCount === 0) console.log('  none');
console.log();

// --- 3. Same name + same city/country (regardless of distance) ---
console.log('=== 3. Same normalized name + same city + country (possible dup) ===');
let nameCityDupCount = 0;
for (const [nk, rows] of groups) {
  if (!nk || rows.length < 2) continue;
  const seen = new Map();
  for (const r of rows) {
    const key = `${String(r.city || '').toLowerCase().trim()}|${String(r.country || '').toLowerCase().trim()}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(r);
  }
  for (const [key, rs] of seen) {
    if (rs.length < 2) continue;
    // Skip ones already reported as within-75m (they'd overlap) — still show for completeness
    nameCityDupCount++;
    console.log(`  "${rs[0].name}" (${rs[0].city}, ${rs[0].country}) x${rs.length}`);
    rs.forEach((r) => console.log(`     [#${r.__i}] @ ${r.latitude},${r.longitude} (${r.bidetStatus})`));
  }
}
if (nameCityDupCount === 0) console.log('  none');
console.log();

console.log('=== Summary ===');
console.log(`  Entries: ${seed.length}`);
console.log(`  Missing/invalid coords: ${missingCoords}`);
console.log(`  Exact-coord dup groups: ${exactCoordDups.length}`);
console.log(`  Name+<75m dup pairs: ${nameCoordDupCount}`);
console.log(`  Name+city dup groups: ${nameCityDupCount}`);
