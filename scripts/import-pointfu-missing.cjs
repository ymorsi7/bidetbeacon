#!/usr/bin/env node
/**
 * Geocode and import PointFu missing washlet hotels into BIDETBEACON_SEED.
 * Reads data/pointfu-missing-bidets.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const htmlPath = path.join(__dirname, '../index.html');
const dataPath = path.join(__dirname, '../data/pointfu-missing-bidets.json');
const CACHE = path.join(__dirname, '../data/pointfu-geocode-cache.json');

const CC_MAP = {
  US: 'USA',
  CA: 'Canada',
  MX: 'Mexico',
  UY: 'Uruguay',
  TH: 'Thailand',
  CN: 'China',
  HK: 'Hong Kong',
  TW: 'Taiwan',
  MY: 'Malaysia',
  NZ: 'New Zealand',
  KR: 'South Korea',
  SG: 'Singapore',
  AU: 'Australia',
  DE: 'Germany',
};

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

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(c) {
  fs.writeFileSync(CACHE, JSON.stringify(c, null, 2));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'BidetBeacon/1.0 (pointfu-import)' } }, (res) => {
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

async function geocode(query, expectedCountry, cache) {
  if (cache[query]) return cache[query];

  const url = 'https://photon.komoot.io/api/?limit=3&q=' + encodeURIComponent(query);
  let result = null;
  try {
    const j = await fetchJson(url);
    for (const f of j.features || []) {
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties;
      const cc = CC_MAP[p.countrycode] || p.country;
      if (expectedCountry && cc !== expectedCountry) continue;
      result = {
        lat: String(lat),
        lon: String(lon),
        address: [p.housenumber, p.street, p.city, p.state, p.postcode, p.country]
          .filter(Boolean)
          .join(', '),
        city: [p.city, p.state].filter(Boolean).join(', ') || expectedCountry,
        country: cc || expectedCountry,
      };
      break;
    }
    if (!result && j.features?.[0]) {
      const f = j.features[0];
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties;
      result = {
        lat: String(lat),
        lon: String(lon),
        address: [p.housenumber, p.street, p.city, p.state, p.postcode, p.country]
          .filter(Boolean)
          .join(', '),
        city: [p.city, p.state].filter(Boolean).join(', ') || expectedCountry,
        country: CC_MAP[p.countrycode] || p.country || expectedCountry,
      };
    }
  } catch {
    /* ignore */
  }
  await sleep(300);
  cache[query] = result;
  saveCache(cache);
  return result;
}

function toSeedRow(item, geo) {
  return {
    name: item.name,
    address: geo.address || item.geocodeQuery,
    latitude: geo.lat,
    longitude: geo.lon,
    city: item.city || geo.city,
    country: item.country,
    type: item.type || 'hotel',
    bidetStatus: item.bidetStatus || 'internet',
    bidetType: item.bidetType || 'TOTO WASHLET',
    sourceUrl: item.sourceUrl,
    sourceQuote: item.sourceQuote,
    verifiedMethod: 'web-source',
    access: item.access || 'limited',
    ...(item.accessNote ? { accessNote: item.accessNote } : {}),
  };
}

async function main() {
  if (!fs.existsSync(dataPath)) {
    console.error('Missing', dataPath);
    process.exit(1);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/window\.BIDETBEACON_SEED\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    console.error('BIDETBEACON_SEED not found');
    process.exit(1);
  }

  const existing = JSON.parse(match[1]);
  const batch = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const cache = loadCache();
  const seen = new Set(existing.map(dedupeKey));
  const seenUrl = new Set(existing.filter((r) => r.sourceUrl).map((r) => r.sourceUrl));

  let added = 0;
  let skipped = 0;
  let geocodeFail = 0;
  const merged = [...existing];
  const failed = [];

  for (const item of batch) {
    if (!item.sourceUrl || !item.sourceQuote) {
      skipped++;
      continue;
    }

    let geo;
    if (item.latitude && item.longitude) {
      geo = {
        lat: String(item.latitude),
        lon: String(item.longitude),
        address: item.address || item.geocodeQuery,
        city: item.city,
        country: item.country,
      };
    } else {
      geo = await geocode(item.geocodeQuery, item.country, cache);
    }
    if (!geo?.lat) {
      geocodeFail++;
      failed.push(item.name);
      continue;
    }

    const row = toSeedRow(item, geo);
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
    merged.push(row);
    added++;
    process.stderr.write(`+ ${row.name} [${row.country}]\n`);
  }

  const newHtml = html.replace(
    /window\.BIDETBEACON_SEED\s*=\s*\[[\s\S]*?\];/,
    `window.BIDETBEACON_SEED = ${JSON.stringify(merged)};`
  );
  fs.writeFileSync(htmlPath, newHtml);

  const byCountry = {};
  merged.forEach((r) => {
    byCountry[r.country] = (byCountry[r.country] || 0) + 1;
  });

  console.log(`PointFu import: +${added} new (${skipped} skipped dupes, ${geocodeFail} geocode fails).`);
  if (failed.length) console.log('Geocode failed:', failed.join(', '));
  console.log('Country totals:', byCountry);
  console.log(`Total seed entries: ${merged.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
