#!/usr/bin/env node
/**
 * Merge china-web-crawl-bidets.json into china-verified-bidets.json (deduped).
 */
const fs = require('fs');
const path = require('path');

const VERIFIED = path.join(__dirname, '../data/china-verified-bidets.json');
const CRAWL = path.join(__dirname, '../data/china-web-crawl-bidets.json');

function normName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function load(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

const base = load(VERIFIED);
const crawl = load(CRAWL);
const seen = new Set(base.map((r) => normName(r.name)));
let added = 0;

for (const row of crawl) {
  if (!row.sourceUrl || !row.sourceQuote || !row.latitude) continue;
  const key = normName(row.name);
  if (seen.has(key)) continue;
  seen.add(key);
  const clean = { ...row };
  if (!clean.searchAliases) delete clean.searchAliases;
  base.push(clean);
  added++;
}

base.sort((a, b) => (a.city || '').localeCompare(b.city || '') || a.name.localeCompare(b.name));
fs.writeFileSync(VERIFIED, JSON.stringify(base, null, 2) + '\n');
console.log(`Merged +${added} new crawl rows. Total China verified: ${base.length}`);
