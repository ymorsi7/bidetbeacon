#!/usr/bin/env node
/**
 * Geocode and import Reddit LATAM leads into BIDETBUD_SEED.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const htmlPath = path.join(__dirname, '../index.html');
const rawPath = path.join(__dirname, '../data/reddit-latam-raw.json');
const CACHE = path.join(__dirname, '../data/reddit-latam-geocode-cache.json');

const SUB_COUNTRY = {
  mexicocity: 'Mexico', Monterrey: 'Mexico', Cancun: 'Mexico', guadalajara: 'Mexico',
  Puebla: 'Mexico', Tijuana: 'Mexico',
  Colombia: 'Colombia', bogota: 'Colombia', medellin: 'Colombia', cali: 'Colombia', Cartagena: 'Colombia',
  vzla: 'Venezuela', caracas: 'Venezuela', maracaibo: 'Venezuela', venezuela: 'Venezuela',
  latam: null, LatinAmerica: null, expats: null, digitalnomad: null,
  bidets: null, travel: null, solotravel: null,
};

const SUB_CITY = {
  mexicocity: 'Mexico City, Mexico', Monterrey: 'Monterrey, Mexico', Cancun: 'Cancún, Mexico',
  guadalajara: 'Guadalajara, Mexico', Puebla: 'Puebla, Mexico', Tijuana: 'Tijuana, Mexico',
  bogota: 'Bogotá, Colombia', medellin: 'Medellín, Colombia', cali: 'Cali, Colombia',
  Cartagena: 'Cartagena, Colombia', caracas: 'Caracas, Venezuela', maracaibo: 'Maracaibo, Venezuela',
};

const COUNTRY_KEYWORDS = {
  Mexico: /\bmexico\b|méxico|cdmx|ciudad de méxico|cancún|cancun|guadalajara|monterrey|tijuana|querétaro|queretaro|puebla|oaxaca|merida|mérida/i,
  Colombia: /\bcolombia\b|bogot[aá]|medell[ií]n|cali|cartagena|barranquilla/i,
  Venezuela: /\bvenezuela\b|caracas|maracaibo|valencia|barquisimeto|margarita/i,
};

function inferCountry(subreddit, snippet) {
  if (SUB_COUNTRY[subreddit]) return SUB_COUNTRY[subreddit];
  for (const [country, re] of Object.entries(COUNTRY_KEYWORDS)) {
    if (re.test(snippet)) return country;
  }
  return null;
}

function hasBidetInSnippet(s) {
  return /bidet|bid[eé]|washlet|toto (?:bidet|smart|toilet)|smart toilet|japanese toilet|inodoro japon[eé]s|shattaf|ducha de mano/i.test(s);
}

function isBadLeadName(name) {
  return /^(their|this|that|every|each|some|any|not|also|just|only|even|still|room|bathroom|restroom|toilet|seat|place|spot|one|two|both|hotel|restaurant|bar|cafe|restaurante|café)$/i.test(
    name.trim()
  );
}

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
  const min = Math.min(a.length, b.length, 12);
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

function inferType(name, snippet) {
  if (/hotel|resort|hostal|inn|suites|marriott|hyatt|hilton|fourseasons/i.test(name + snippet)) return 'hotel';
  if (/mosque|masjid|mezquita|islamic/i.test(name + snippet)) return 'mosque';
  if (/café|cafe|coffee|starbucks/i.test(name + snippet)) return 'restaurant';
  return 'restaurant';
}

async function main() {
  if (!fs.existsSync(rawPath)) {
    console.error('Missing', rawPath);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const cache = loadCache();
  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/window\.BIDETBUD_SEED\s*=\s*(\[[\s\S]*?\]);/);
  const existing = JSON.parse(match[1]);
  const seen = new Set(existing.map(dedupeKey));
  let added = 0;
  let skipped = 0;
  const merged = [...existing];

  for (const lead of raw) {
    if (!hasBidetInSnippet(lead.snippet) || isBadLeadName(lead.name)) {
      skipped++;
      continue;
    }
    const country = inferCountry(lead.subreddit, lead.snippet);
    if (!country) {
      skipped++;
      continue;
    }
    const city = SUB_CITY[lead.subreddit] || country;
    const cacheKey = `${lead.name}|${city}`;
    let geo = cache[cacheKey];
    if (!geo) {
      try {
        const json = await geocode(`${lead.name}, ${city}`);
        const f = json.features?.[0];
        if (!f) {
          skipped++;
          continue;
        }
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties;
        geo = {
          latitude: String(lat),
          longitude: String(lon),
          address: [p.street, p.housenumber, p.city, p.state].filter(Boolean).join(', '),
          city: [p.city, p.state].filter(Boolean).join(', ') || city,
        };
        cache[cacheKey] = geo;
        saveCache(cache);
        await sleep(400);
      } catch {
        skipped++;
        continue;
      }
    }

    const type = inferType(lead.name, lead.snippet);
    const row = {
      name: lead.name,
      address: geo.address || '',
      latitude: geo.latitude,
      longitude: geo.longitude,
      city: geo.city,
      country,
      type,
      bidetStatus: 'internet',
      bidetType: /washlet|toto|japon[eé]s/i.test(lead.snippet) ? 'TOTO / washlet bidet' : 'Bidet',
      sourceUrl: lead.permalink,
      sourceQuote: `Reddit r/${lead.subreddit}: ${lead.snippet.slice(0, 220)}`,
      verifiedMethod: 'web-source',
      access: type === 'hotel' ? 'limited' : 'public',
    };

    const key = dedupeKey(row);
    if (seen.has(key) || existing.some((e) => isNearDuplicate(e, row))) {
      skipped++;
      continue;
    }
    seen.add(key);
    merged.push(row);
    added++;
    process.stderr.write(`+ [${country}] ${row.name}\n`);
  }

  const newHtml = html.replace(
    /window\.BIDETBUD_SEED\s*=\s*\[[\s\S]*?\];/,
    `window.BIDETBUD_SEED = ${JSON.stringify(merged)};`
  );
  fs.writeFileSync(htmlPath, newHtml);
  console.log(`Reddit LATAM import: +${added} new (${skipped} skipped). Total: ${merged.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
