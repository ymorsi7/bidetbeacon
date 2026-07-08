#!/usr/bin/env node
/**
 * Fetch halal-tagged restaurants from OpenStreetMap via Overpass (by country).
 * Tries multiple public mirrors; resumable.
 *
 *   node scripts/crawl-osm-halal.cjs --minutes=30
 *   node scripts/crawl-osm-halal.cjs --minutes=30 --import
 *
 * Output: data/osm-halal-restaurants.json
 * State:  data/osm-halal-crawl-state.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { USER_AGENT, countryFromCode, classifyHalalStatus, sleep } = require('./lib/halal-web.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/osm-halal-restaurants.json');
const STATE = path.join(ROOT, 'data/osm-halal-crawl-state.json');

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** Non-Muslim-default countries to query (ISO 3166-1 alpha-2). */
const COUNTRY_CODES = [
  'US', 'GB', 'CA', 'AU', 'NZ', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK', 'IE', 'PT', 'PL',
  'CZ', 'HU', 'RO', 'FI', 'GR', 'MX', 'BR', 'AR', 'CL', 'CO', 'VE', 'ZA', 'JP', 'KR', 'CN', 'HK', 'TW', 'SG', 'IN',
  'RU', 'UA', 'IL', 'TH', 'VN', 'PH',
];

const args = process.argv.slice(2);
const minutesArg = args.find((a) => a.startsWith('--minutes='));
const MINUTES = minutesArg ? Number(minutesArg.split('=')[1]) : 30;
const DO_IMPORT = args.includes('--import');

function loadState() {
  if (!fs.existsSync(STATE)) return { done: {}, rows: [] };
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}

function saveState(st) {
  fs.writeFileSync(STATE, JSON.stringify(st, null, 2) + '\n');
}

function overpassQuery(iso) {
  return `[out:json][timeout:180];
area["ISO3166-1"="${iso}"][admin_level=2]->.a;
(
  nwr(area.a)["amenity"~"restaurant|fast_food|cafe|food_court"]["diet:halal"~"yes|only"];
);
out center tags;`;
}

function postOverpass(url, query) {
  const body = `data=${encodeURIComponent(query)}`;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': USER_AGENT,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          if (data.trim().startsWith('<')) {
            reject(new Error(data.slice(0, 120).replace(/\s+/g, ' ')));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchCountry(iso) {
  const query = overpassQuery(iso);
  let lastErr;
  for (const mirror of MIRRORS) {
    try {
      return await postOverpass(mirror, query);
    } catch (e) {
      lastErr = e;
      await sleep(3000);
    }
  }
  throw lastErr;
}

function osmElementToRow(el, iso) {
  const tags = el.tags || {};
  const name = tags.name || tags['name:en'];
  if (!name) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;

  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const city = tags['addr:city'] || tags['addr:town'] || tags['addr:suburb'] || '';
  const region = tags['addr:state'] || tags['addr:province'] || '';
  const postcode = tags['addr:postcode'] || '';
  const address = [street, city, region, postcode].filter(Boolean).join(', ');
  const diet = tags['diet:halal'] || 'yes';
  const halalStatus = diet === 'only' ? 'full' : classifyHalalStatus(tags.description || tags.note || diet);

  const country = countryFromCode(iso) || iso;
  const osmType = el.type === 'node' ? 'node' : el.type === 'way' ? 'way' : 'relation';

  return {
    name,
    address,
    latitude: String(lat),
    longitude: String(lon),
    city: [city, region].filter(Boolean).join(', '),
    country,
    halalStatus,
    cuisine: tags.cuisine || '',
    sourceUrl: `https://www.openstreetmap.org/${osmType}/${el.id}`,
    sourceQuote: `OpenStreetMap diet:halal=${diet}`,
    verifiedMethod: 'web-source',
    source: 'osm',
  };
}

async function main() {
  const deadline = Date.now() + MINUTES * 60 * 1000;
  const st = loadState();

  for (const iso of COUNTRY_CODES) {
    if (Date.now() >= deadline) break;
    if (st.done[iso]) continue;
    process.stdout.write(`OSM ${iso}… `);
    try {
      const data = await fetchCountry(iso);
      const rows = (data.elements || []).map((el) => osmElementToRow(el, iso)).filter(Boolean);
      st.rows.push(...rows);
      st.done[iso] = rows.length;
      console.log(rows.length, 'restaurants');
    } catch (e) {
      st.done[iso] = `err: ${e.message}`;
      console.log('ERR', e.message);
    }
    saveState(st);
    fs.writeFileSync(OUT, JSON.stringify(st.rows, null, 2) + '\n');
    await sleep(5000);
  }

  console.log(`\nOSM halal: ${st.rows.length} rows → ${path.relative(ROOT, OUT)}`);
  if (DO_IMPORT) {
    require('child_process').execSync('node scripts/import-halal-all.cjs', { cwd: ROOT, stdio: 'inherit' });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
