#!/usr/bin/env node
/**
 * Remove high-confidence duplicate entries from BIDETBUD_SEED (index.html).
 *
 * A "duplicate" = two+ rows that are the SAME real venue. We only merge rows
 * that share a normalized name AND country, and are either:
 *   - within ~300m of each other (same spot, geocoding jitter), or
 *   - in the same (non-empty) city (same named venue, coordinate discrepancy).
 *
 * This deliberately does NOT touch:
 *   - Singapore "(Male Toilet)" / "(Female Toilet)" pairs (different names)
 *   - Different venues geocoded to the same imprecise point (different names)
 *
 * Representative kept per duplicate group (in priority order):
 *   1. verified status beats warmed/internet
 *   2. member of the largest proximity cluster (majority coordinate)
 *   3. most populated record (field count)
 *   4. lowest original index
 *
 * Usage:
 *   node scripts/dedupe-seed.cjs           # preview only (no writes)
 *   node scripts/dedupe-seed.cjs --apply   # rewrite index.html
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const htmlPath = path.join(__dirname, '../index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/window\.BIDETBUD_SEED\s*=\s*(\[[\s\S]*?\]);/);
if (!match) {
  console.error('BIDETBUD_SEED not found');
  process.exit(1);
}
const seed = JSON.parse(match[1]);

const stripDiacritics = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function nameKey(name) {
  return stripDiacritics(String(name || '').toLowerCase())
    .replace(/["'’`.,]/g, '')
    .replace(/\b(hotel|resort|the|le|la|and)\b/g, '')
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function cityKey(city) {
  return stripDiacritics(String(city || '').toLowerCase())
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const la1 = num(a.latitude);
  const lo1 = num(a.longitude);
  const la2 = num(b.latitude);
  const lo2 = num(b.longitude);
  if (la1 == null || lo1 == null || la2 == null || lo2 == null) return Infinity;
  const dLat = toRad(la2 - la1);
  const dLon = toRad(lo2 - lo1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Group candidate rows by normalized name + country.
const groups = new Map();
seed.forEach((row, i) => {
  const nk = nameKey(row.name);
  if (nk.length < 4) return; // skip too-generic / empty keys
  const ck = String(row.country || '').toLowerCase().trim();
  const gk = `${nk}||${ck}`;
  if (!groups.has(gk)) groups.set(gk, []);
  groups.get(gk).push(i);
});

// Union-Find over a group's members.
function unionFind(indices) {
  const parent = new Map(indices.map((i) => [i, i]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => parent.set(find(a), find(b));
  return { find, union };
}

const removeIdx = new Set();
const report = [];

const PROX_M = 300;

for (const [gk, indices] of groups) {
  if (indices.length < 2) continue;

  // Proximity clusters (for majority-coordinate voting).
  const proxUF = unionFind(indices);
  for (let a = 0; a < indices.length; a++) {
    for (let b = a + 1; b < indices.length; b++) {
      if (haversine(seed[indices[a]], seed[indices[b]]) <= PROX_M) {
        proxUF.union(indices[a], indices[b]);
      }
    }
  }
  const clusterSize = new Map();
  indices.forEach((i) => {
    const r = proxUF.find(i);
    clusterSize.set(r, (clusterSize.get(r) || 0) + 1);
  });

  // Merge components: same proximity cluster OR same non-empty city.
  const mergeUF = unionFind(indices);
  for (let a = 0; a < indices.length; a++) {
    for (let b = a + 1; b < indices.length; b++) {
      const ia = indices[a];
      const ib = indices[b];
      const sameProx = proxUF.find(ia) === proxUF.find(ib);
      const ca = cityKey(seed[ia].city);
      const cb = cityKey(seed[ib].city);
      const sameCity = ca && cb && ca === cb;
      if (sameProx || sameCity) mergeUF.union(ia, ib);
    }
  }

  const components = new Map();
  indices.forEach((i) => {
    const r = mergeUF.find(i);
    if (!components.has(r)) components.set(r, []);
    components.get(r).push(i);
  });

  for (const members of components.values()) {
    if (members.length < 2) continue;

    const statusRank = (s) => (s === 'verified' ? 2 : 1);
    const keep = members.slice().sort((x, y) => {
      const rx = seed[x];
      const ry = seed[y];
      if (statusRank(ry.bidetStatus) !== statusRank(rx.bidetStatus))
        return statusRank(ry.bidetStatus) - statusRank(rx.bidetStatus);
      const csx = clusterSize.get(proxUF.find(x)) || 0;
      const csy = clusterSize.get(proxUF.find(y)) || 0;
      if (csy !== csx) return csy - csx;
      const kx = Object.keys(rx).length;
      const ky = Object.keys(ry).length;
      if (ky !== kx) return ky - kx;
      return x - y;
    })[0];

    const dropped = members.filter((m) => m !== keep);
    dropped.forEach((d) => removeIdx.add(d));
    report.push({ keep, dropped, members });
  }
}

// Print report.
report.sort((a, b) => a.keep - b.keep);
console.log(`Duplicate groups found: ${report.length}`);
console.log(`Rows to remove: ${removeIdx.size}\n`);
for (const g of report) {
  const k = seed[g.keep];
  console.log(
    `KEEP  [#${g.keep}] ${k.name} — ${k.city || ''}, ${k.country} @ ${k.latitude},${k.longitude} (${k.bidetStatus})`
  );
  for (const d of g.dropped) {
    const r = seed[d];
    console.log(
      `  DROP[#${d}] ${r.name} — ${r.city || ''}, ${r.country} @ ${r.latitude},${r.longitude} (${r.bidetStatus})`
    );
  }
}

if (!APPLY) {
  console.log('\n(preview only — re-run with --apply to rewrite index.html)');
  process.exit(0);
}

const deduped = seed.filter((_, i) => !removeIdx.has(i));
const newHtml = html.replace(
  /window\.BIDETBUD_SEED\s*=\s*\[[\s\S]*?\];/,
  `window.BIDETBUD_SEED = ${JSON.stringify(deduped)};`
);
fs.writeFileSync(htmlPath, newHtml);
console.log(`\nApplied. Seed: ${seed.length} -> ${deduped.length} (removed ${removeIdx.size}).`);
