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
  // Muslim-majority / halal-by-default (included on map)
  'AF', 'AL', 'DZ', 'AZ', 'BH', 'BD', 'BA', 'BN', 'TD', 'DJ', 'EG', 'GM', 'GN', 'ID', 'IR', 'IQ', 'JO', 'KZ', 'KW',
  'KG', 'LB', 'LY', 'MY', 'ML', 'MR', 'MA', 'NE', 'OM', 'PK', 'QA', 'SA', 'SN', 'SO', 'SD', 'SY', 'TJ', 'TN', 'TR',
  'TM', 'AE', 'UZ', 'YE', 'PS',
];

const args = process.argv.slice(2);
const minutesArg = args.find((a) => a.startsWith('--minutes='));
const MINUTES = minutesArg ? Number(minutesArg.split('=')[1]) : 30;
const DO_IMPORT = args.includes('--import');
const EXTENDED_ONLY = args.includes('--extended-only');
const DIET_ONLY = args.includes('--diet-only');

function loadState() {
  if (!fs.existsSync(STATE)) return { done: {}, rows: [] };
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}

function saveState(st) {
  fs.writeFileSync(STATE, JSON.stringify(st, null, 2) + '\n');
}

/** Large countries: single-country Overpass queries time out → query ISO3166-2 subdivisions. */
const SPLIT_REGIONS = {
  US: 'AL AK AZ AR CA CO CT DC DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(
    ' ',
  ).map((s) => `US-${s}`),
  CA: 'AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' ').map((s) => `CA-${s}`),
  GB: ['GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR'],
  FR: 'ARA BFC BRE CVL GES HDF IDF NOR NAQ OCC PAC PDL'.split(' ').map((s) => `FR-${s}`),
  DE: 'BW BY BE BB HB HH HE MV NI NW RP SL SN ST SH TH'.split(' ').map((s) => `DE-${s}`),
};

function isDone(st, key) {
  if (!Object.prototype.hasOwnProperty.call(st.done, key)) return false;
  const v = st.done[key];
  if (typeof v === 'string' && v.startsWith('err:')) return false;
  return true;
}

function overpassQuery(iso) {
  return `[out:json][timeout:180];
area["ISO3166-1"="${iso}"][admin_level=2]->.a;
(
  nwr(area.a)["amenity"~"restaurant|fast_food|cafe|food_court"]["diet:halal"~"yes|only"];
);
out center tags;`;
}

function overpassQueryRegion(iso3166_2) {
  return `[out:json][timeout:120];
area["ISO3166-2"="${iso3166_2}"][admin_level=4]->.a;
(
  nwr(area.a)["amenity"~"restaurant|fast_food|cafe|food_court"]["diet:halal"~"yes|only"];
);
out center tags;`;
}

/** Broader pass: cuisine=halal tags + halal shops (not caught by diet:halal alone). */
function overpassQueryExtended(iso) {
  return `[out:json][timeout:180];
area["ISO3166-1"="${iso}"][admin_level=2]->.a;
(
  nwr(area.a)["amenity"~"restaurant|fast_food|cafe|food_court"]["cuisine"~"halal",i];
  nwr(area.a)["shop"~"butcher|supermarket|convenience|greengrocer|deli|general|department_store"]["diet:halal"~"yes|only"];
  nwr(area.a)["shop"~"butcher|supermarket|convenience|deli"]["name"~"halal",i];
);
out center tags;`;
}

function overpassQueryExtendedRegion(iso3166_2) {
  return `[out:json][timeout:120];
area["ISO3166-2"="${iso3166_2}"][admin_level=4]->.a;
(
  nwr(area.a)["amenity"~"restaurant|fast_food|cafe|food_court"]["cuisine"~"halal",i];
  nwr(area.a)["shop"~"butcher|supermarket|convenience|greengrocer|deli|general|department_store"]["diet:halal"~"yes|only"];
  nwr(area.a)["shop"~"butcher|supermarket|convenience|deli"]["name"~"halal",i];
);
out center tags;`;
}

function crawlTasks() {
  const tasks = [];
  for (const iso of COUNTRY_CODES) {
    const regions = SPLIT_REGIONS[iso];
    if (regions) {
      for (const reg of regions) {
        if (!DIET_ONLY) tasks.push({ key: `${reg}#ext`, countryIso: iso, pass: 'extended' });
        if (!EXTENDED_ONLY) tasks.push({ key: reg, countryIso: iso, pass: 'diet' });
      }
    } else {
      if (!DIET_ONLY) tasks.push({ key: `${iso}#ext`, countryIso: iso, pass: 'extended' });
      if (!EXTENDED_ONLY) tasks.push({ key: iso, countryIso: iso, pass: 'diet' });
    }
  }
  return tasks;
}

function rowUrlKey(r) {
  return r.sourceUrl || `${r.name}|${r.latitude}|${r.longitude}`;
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

async function fetchOverpass(query) {
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
  const diet = tags['diet:halal'] || '';
  const cuisine = tags.cuisine || '';
  let halalStatus = 'options';
  if (diet === 'only') halalStatus = 'full';
  else if (diet === 'yes') halalStatus = 'options';
  else if (/halal/i.test(cuisine)) halalStatus = classifyHalalStatus(cuisine);
  else if (/halal/i.test(name)) halalStatus = 'options';
  else if (diet) halalStatus = classifyHalalStatus(tags.description || tags.note || diet);
  else halalStatus = 'options';

  const country = countryFromCode(iso) || iso;
  const osmType = el.type === 'node' ? 'node' : el.type === 'way' ? 'way' : 'relation';
  const shop = tags.shop || '';
  const evidence = diet
    ? `OpenStreetMap diet:halal=${diet}`
    : /halal/i.test(cuisine)
      ? `OpenStreetMap cuisine=${cuisine}`
      : /halal/i.test(name)
        ? 'OpenStreetMap name mentions halal'
        : `OpenStreetMap shop=${shop || tags.amenity || 'venue'}`;

  const row = {
    name,
    address,
    latitude: String(lat),
    longitude: String(lon),
    city: [city, region].filter(Boolean).join(', '),
    country,
    halalStatus,
    cuisine,
    sourceUrl: `https://www.openstreetmap.org/${osmType}/${el.id}`,
    sourceQuote: evidence,
    verifiedMethod: 'web-source',
    source: 'osm',
  };
  if (shop) row.venueType = 'store';
  return row;
}

async function main() {
  const deadline = Date.now() + MINUTES * 60 * 1000;
  const st = loadState();
  const seen = new Set(st.rows.map(rowUrlKey));
  let added = 0;

  for (const { key, countryIso, pass } of crawlTasks()) {
    if (Date.now() >= deadline) break;
    if (isDone(st, key)) continue;
    const baseKey = key.replace(/#ext$/, '');
    const isRegion = baseKey.includes('-') && SPLIT_REGIONS[countryIso];
    const label = isRegion ? `${countryIso}/${baseKey}${pass === 'extended' ? ' ext' : ''}` : `${baseKey}${pass === 'extended' ? ' ext' : ''}`;
    process.stdout.write(`OSM ${label}… `);
    try {
      let query;
      if (pass === 'extended') {
        query = isRegion ? overpassQueryExtendedRegion(baseKey) : overpassQueryExtended(countryIso);
      } else {
        query = isRegion ? overpassQueryRegion(baseKey) : overpassQuery(countryIso);
      }
      const data = await fetchOverpass(query);
      const rows = (data.elements || []).map((el) => osmElementToRow(el, countryIso)).filter(Boolean);
      let regionNew = 0;
      for (const row of rows) {
        const k = rowUrlKey(row);
        if (seen.has(k)) continue;
        seen.add(k);
        st.rows.push(row);
        added++;
        regionNew++;
      }
      st.done[key] = rows.length;
      console.log(rows.length, 'restaurants', regionNew ? `(+${regionNew} new)` : '');
    } catch (e) {
      st.done[key] = `err: ${e.message}`;
      console.log('ERR', e.message);
    }
    saveState(st);
    fs.writeFileSync(OUT, JSON.stringify(st.rows, null, 2) + '\n');
    await sleep(4000);
  }

  console.log(`\nOSM halal: ${st.rows.length} rows (+${added} this run) → ${path.relative(ROOT, OUT)}`);
  if (DO_IMPORT) {
    require('child_process').execSync('node scripts/import-halal-all.cjs', { cwd: ROOT, stdio: 'inherit' });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
