#!/usr/bin/env node
/**
 * Fetch halal venues from public directory APIs / datasets (non-Zabihah).
 *
 *   node scripts/crawl-halal-directories.cjs
 *   node scripts/crawl-halal-directories.cjs --import
 *
 * Output: data/halal-directory-restaurants.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { USER_AGENT, classifyHalalStatus } = require('./lib/halal-web.cjs');
const { geocodeVenue, isHalalDefaultCountry, sleep } = require('./lib/halal-extra.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/halal-directory-restaurants.json');
const CACHE = path.join(ROOT, 'data/halal-directory-geocode-cache.json');

const args = process.argv.slice(2);
const DO_IMPORT = args.includes('--import');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON ${res.statusCode}: ${data.slice(0, 100)}`));
          }
        });
      })
      .on('error', reject);
  });
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
}

/** OpenStreetMap Overpass: amenity=restaurant + diet:halal in one bbox-free country query per region. */
async function fetchOsmHalalViaOverpass() {
  const rows = [];
  const query = `[out:json][timeout:120];
(
  node["amenity"~"restaurant|fast_food|cafe"]["diet:halal"](48.0,-10.0,62.0,2.0);
  way["amenity"~"restaurant|fast_food|cafe"]["diet:halal"](48.0,-10.0,62.0,2.0);
);
out center 500;`;
  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  for (const mirror of mirrors) {
    try {
      const body = await new Promise((resolve, reject) => {
        const req = https.request(
          mirror,
          { method: 'POST', headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' } },
          (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => resolve(d));
          },
        );
        req.on('error', reject);
        req.write('data=' + encodeURIComponent(query));
        req.end();
      });
      const j = JSON.parse(body);
      for (const el of j.elements || []) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        const tags = el.tags || {};
        const name = tags.name;
        if (!name || lat == null || lon == null) continue;
        const diet = tags['diet:halal'] || 'yes';
        rows.push({
          name,
          address: [tags['addr:street'], tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', '),
          latitude: String(lat),
          longitude: String(lon),
          city: tags['addr:city'] || tags['addr:suburb'] || '',
          country: 'UK',
          halalStatus: diet === 'only' ? 'full' : 'options',
          cuisine: tags.cuisine || '',
          sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
          sourceQuote: `OpenStreetMap diet:halal=${diet}`,
          verifiedMethod: 'web-source',
          source: 'osm-directory',
        });
      }
      if (rows.length) return rows;
    } catch (e) {
      console.warn('Overpass UK supplement:', e.message);
    }
  }
  return rows;
}

/** Try SPHERE halal restaurant API (Chulalongkorn Halal Science Center). */
async function fetchSphereRestaurants() {
  const endpoints = [
    'https://www.halalscience.org/sphere/api/restaurant',
    'https://www.halalscience.org/sphere/api/halal-restaurant',
    'https://sphere.halalscience.org/api/restaurant',
  ];
  for (const url of endpoints) {
    try {
      const j = await fetchJson(url);
      const list = Array.isArray(j) ? j : j.data || j.restaurants || j.results || [];
      if (!list.length) continue;
      return list
        .filter((r) => r.name || r.shop_name)
        .map((r) => ({
          name: r.name || r.shop_name,
          address: r.address || r.location || '',
          latitude: String(r.lat ?? r.latitude ?? ''),
          longitude: String(r.lon ?? r.longitude ?? r.lng ?? ''),
          city: r.city || r.province || '',
          country: r.country || 'Thailand',
          halalStatus: /full|certified|100/i.test(String(r.halal_status || r.status || '')) ? 'full' : 'options',
          cuisine: r.cuisine || r.type || '',
          sourceUrl: r.url || r.website || 'https://www.halalscience.org/en/sphere-en/',
          sourceQuote: `SPHERE halal directory: ${r.halal_status || r.status || 'halal restaurant listing'}`,
          verifiedMethod: 'web-source',
          source: 'sphere',
        }))
        .filter((r) => r.latitude && r.longitude);
    } catch {
      /* try next */
    }
  }
  return [];
}

/** Curated open GitHub halal datasets. */
async function fetchGithubHalalDatasets() {
  const urls = [
    'https://raw.githubusercontent.com/msocietyhq/muis-datasets-unofficial/main/halal-directory/data.json',
  ];
  const rows = [];
  for (const url of urls) {
    if (url.includes('muis')) continue; // handled by import-muis-halal.cjs
    try {
      const j = await fetchJson(url);
      const list = j.establishments || j.restaurants || j.data || [];
      for (const e of list) {
        const lat = e.coordinates?.lat ?? e.latitude ?? e.lat;
        const lon = e.coordinates?.lng ?? e.longitude ?? e.lon;
        if (lat == null || lon == null || !e.name) continue;
        rows.push({
          name: e.name,
          address: e.address || '',
          latitude: String(lat),
          longitude: String(lon),
          city: e.city || '',
          country: e.country || 'Singapore',
          halalStatus: 'full',
          cuisine: e.cuisine || '',
          sourceUrl: url,
          sourceQuote: 'Open halal directory dataset',
          verifiedMethod: 'web-source',
          source: 'github-dataset',
        });
      }
    } catch {
      /* skip */
    }
  }
  return rows;
}

async function main() {
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const byKey = new Map(existing.map((r) => [`${r.name}|${r.latitude}|${r.longitude}`, r]));
  const cache = loadCache();

  const sources = [
    { label: 'SPHERE API', fn: fetchSphereRestaurants },
    { label: 'GitHub datasets', fn: fetchGithubHalalDatasets },
  ];

  for (const { label, fn } of sources) {
    process.stdout.write(`${label}… `);
    try {
      const rows = await fn();
      let added = 0;
      for (const raw of rows) {
        if (isHalalDefaultCountry(raw.country)) continue;
        let row = { ...raw };
        if (!row.latitude || !row.longitude) {
          const cc = raw.country === 'UK' ? 'GB' : raw.country === 'USA' ? 'US' : '';
          const geo = await geocodeVenue(row, cc, raw.country, raw.city, cache);
          if (!geo) continue;
          row = { ...row, ...geo };
        }
        if (!row.sourceQuote) row.sourceQuote = 'Halal directory listing';
        if (!row.halalStatus) row.halalStatus = classifyHalalStatus(row.sourceQuote);
        const k = `${row.name}|${row.latitude}|${row.longitude}`;
        if (!byKey.has(k)) {
          byKey.set(k, row);
          added++;
        }
      }
      console.log(`${rows.length} fetched, ${added} new`);
    } catch (e) {
      console.log('ERR', e.message);
    }
    await sleep(500);
  }

  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2) + '\n');
  const out = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`Halal directories: ${out.length} restaurants → ${path.relative(ROOT, OUT)}`);

  if (DO_IMPORT) {
    require('child_process').execSync('node scripts/import-halal-all.cjs', { cwd: ROOT, stdio: 'inherit' });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
