#!/usr/bin/env node
/**
 * Extract halal restaurants from Atly bidet crawl JSON (explicit halal evidence only).
 * Writes data/halal-restaurants-seed.json only — run import-halal-all.cjs to embed.
 *
 *   node scripts/import-halal-atly.cjs
 */
const fs = require('fs');
const path = require('path');
const { isHalalDefaultCountry } = require('./lib/halal-default-countries.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/halal-restaurants-seed.json');

const SOURCES = [
  'data/atly-na-bidets.json',
  'data/global-crawler-bidets.json',
  'data/canada-atly-bidets.json',
];

function classifyHalal(quote, name) {
  const t = `${quote} ${name}`;
  if (/100%\s*halal|zabiha|fully halal|everything served is|all halal/i.test(t)) return 'full';
  if (/halal options|offers halal|halal meat|halal chicken|partial/i.test(t)) return 'options';
  if (/\bhalal\b/i.test(name)) return 'options';
  return null;
}

function rowKey(r) {
  return `${r.name}|${r.latitude}|${r.longitude}`;
}

const seen = new Set();
const rows = [];

for (const rel of SOURCES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const r of list) {
    if (r.type !== 'restaurant') continue;
    const quote = r.sourceQuote || '';
    const halalStatus = classifyHalal(quote, r.name || '');
    if (!halalStatus) continue;
    const key = rowKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    const country = r.country || 'USA';
    if (isHalalDefaultCountry(country)) continue;
    rows.push({
      name: r.name,
      address: r.address || '',
      latitude: String(r.latitude),
      longitude: String(r.longitude),
      city: r.city || '',
      country,
      halalStatus,
      sourceUrl: r.sourceUrl || '',
      sourceQuote: quote.slice(0, 240),
      verifiedMethod: r.verifiedMethod || 'web-source',
    });
  }
}

rows.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n');
console.log(`Wrote ${rows.length} halal restaurants → ${path.relative(ROOT, OUT)}`);
console.log('Run node scripts/import-halal-all.cjs to merge into halal.html');
