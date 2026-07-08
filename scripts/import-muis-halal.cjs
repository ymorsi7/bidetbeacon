#!/usr/bin/env node
/**
 * Import MUIS Singapore halal certified establishments (official government data).
 * https://github.com/msocietyhq/muis-datasets-unofficial
 *
 *   node scripts/import-muis-halal.cjs
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { USER_AGENT } = require('./lib/halal-web.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/muis-halal-restaurants.json');
const URL =
  'https://raw.githubusercontent.com/msocietyhq/muis-datasets-unofficial/main/halal-directory/data.json';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function main() {
  const data = await fetchJson(URL);
  const list = data.establishments || [];
  const rows = list
    .filter((e) => e.coordinates?.lat != null && e.coordinates?.lng != null)
    .map((e) => ({
      name: e.name,
      address: e.address || '',
      latitude: String(e.coordinates.lat),
      longitude: String(e.coordinates.lng),
      city: 'Singapore',
      country: 'Singapore',
      halalStatus: 'full',
      cuisine: e.sub_scheme?.name || e.scheme?.name || '',
      sourceUrl: `https://halal.muis.gov.sg/halal/establishments?id=${encodeURIComponent(e.id || e.certificate_number || '')}`,
      sourceQuote: `MUIS halal certified (${e.certificate_number || 'certified establishment'})`,
      verifiedMethod: 'web-source',
      source: 'muis',
    }));

  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n');
  console.log(`Wrote ${rows.length} MUIS establishments → ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
