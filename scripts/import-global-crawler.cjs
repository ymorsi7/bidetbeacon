#!/usr/bin/env node
/**
 * Import global-crawler-bidets.json + geocoded Reddit leads into BIDETBUD_SEED.
 * Skips bidet-friendly countries (matches index.html overlay).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { isFriendlyCountry, normalizeCountry } = require('./lib/non-friendly-countries.cjs');

const htmlPath = path.join(__dirname, '../index.html');
const crawlerPath = path.join(__dirname, '../data/global-crawler-bidets.json');
const redditPath = path.join(__dirname, '../data/global-crawler-reddit-raw.json');
const redditCache = path.join(__dirname, '../data/global-crawler-reddit-geocode.json');

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
    /washlet|toto|heated|electronic bidet|smart toilet|neorest|japon[eé]s/i.test(row.bidetType || '');

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

const SUB_COUNTRY = {
  AskUK: 'UK', london: 'UK', unitedkingdom: 'UK', paris: 'France', france: 'France',
  berlin: 'Germany', AskGermany: 'Germany', sydney: 'Australia', australia: 'Australia',
  melbourne: 'Australia', toronto: 'Canada', askTO: 'Canada', vancouver: 'Canada',
  montreal: 'Canada', mexicocity: 'Mexico', Monterrey: 'Mexico', Cancun: 'Mexico',
  bogota: 'Colombia', colombia: 'Colombia', medellin: 'Colombia',
  vzla: 'Venezuela', caracas: 'Venezuela', venezuela: 'Venezuela',
  singapore: 'Singapore', hongkong: 'Hong Kong', China: 'China',
  Moscow: 'Russia', russia: 'Russia', amsterdam: 'Netherlands', Netherlands: 'Netherlands',
  Zurich: 'Switzerland', austria: 'Austria',
  AskNYC: 'USA', LosAngeles: 'USA', chicago: 'USA', Seattle: 'USA', boston: 'USA',
};

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(redditCache, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(c) {
  fs.writeFileSync(redditCache, JSON.stringify(c, null, 2));
}

function geocode(query) {
  return new Promise((resolve, reject) => {
    https
      .get(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`,
        { headers: { 'User-Agent': 'BidetBud/1.0' } },
        (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(d));
            } catch (e) {
              reject(e);
            }
          });
        }
      )
      .on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function redditToRows() {
  if (!fs.existsSync(redditPath)) return [];
  const raw = JSON.parse(fs.readFileSync(redditPath, 'utf8'));
  const cache = loadCache();
  const rows = [];

  for (const lead of raw) {
    const country = SUB_COUNTRY[lead.subreddit];
    if (!country || isFriendlyCountry(country)) continue;
    if (!/bidet|washlet|toto|japanese toilet|shattaf/i.test(lead.snippet)) continue;
    if (lead.name.length < 4 || lead.name.length > 70) continue;

    const cacheKey = `${lead.name}|${country}`;
    let geo = cache[cacheKey];
    if (!geo) {
      try {
        const json = await geocode(`${lead.name}, ${country}`);
        const f = json.features?.[0];
        if (!f) continue;
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties;
        geo = {
          latitude: String(lat),
          longitude: String(lon),
          address: [p.street, p.housenumber, p.city, p.state].filter(Boolean).join(', '),
          city: [p.city, p.state].filter(Boolean).join(', ') || country,
        };
        cache[cacheKey] = geo;
        saveCache(cache);
        await sleep(350);
      } catch {
        continue;
      }
    }

    rows.push({
      name: lead.name,
      ...geo,
      country,
      type: /hotel|resort/i.test(lead.snippet) ? 'hotel' : 'restaurant',
      bidetStatus: 'internet',
      bidetType: /washlet|toto/i.test(lead.snippet) ? 'TOTO / washlet bidet' : 'Bidet',
      sourceUrl: lead.permalink,
      sourceQuote: `Reddit r/${lead.subreddit}: ${lead.snippet.slice(0, 220)}`,
      verifiedMethod: 'web-source',
      access: 'public',
    });
  }
  return rows;
}

async function main() {
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

  const batches = [];
  if (fs.existsSync(crawlerPath)) batches.push(JSON.parse(fs.readFileSync(crawlerPath, 'utf8')));
  batches.push(...(await redditToRows()));

  for (const item of batches.flat()) {
    const country = normalizeCountry(item.country);
    if (!country || isFriendlyCountry(country)) {
      skipped++;
      continue;
    }
    if (!item.sourceUrl || !item.sourceQuote || !item.latitude) {
      skipped++;
      continue;
    }
    const row = toSeedRow({ ...item, country });
    if (seenUrl.has(row.sourceUrl) && existing.some((e) => isNearDuplicate(e, row))) {
      skipped++;
      continue;
    }
    const key = dedupeKey(row);
    if (seen.has(key) || existing.some((e) => isNearDuplicate(e, row))) {
      skipped++;
      continue;
    }
    seen.add(key);
    seenUrl.add(row.sourceUrl);
    merged.push(row);
    added++;
    process.stderr.write(`+ [${row.country}] ${row.name}\n`);
  }

  const newHtml = html.replace(
    /window\.BIDETBUD_SEED\s*=\s*\[[\s\S]*?\];/,
    `window.BIDETBUD_SEED = ${JSON.stringify(merged)};`
  );
  fs.writeFileSync(htmlPath, newHtml);
  console.log(`Global crawler import: +${added} new (${skipped} skipped). Total: ${merged.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
