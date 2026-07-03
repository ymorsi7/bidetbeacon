#!/usr/bin/env node
/**
 * Scrape all TOTO Europe WASHLET reference case studies and geocode them.
 * Output: data/toto-europe-references.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '../data/toto-europe-references.json');
const CACHE = path.join(__dirname, '../data/toto-geocode-cache.json');
const BASE = 'https://eu.toto.com';

const SKIP_SLUGS = new Set([
  'sir-stirling-moss-private-house-london',
  'david-morley-architects',
]);

/** Better geocode queries for ambiguous venue names */
const GEO_QUERY = {
  'hotel-chouchou-paris': 'Hotel Chouchou 10 Rue Saint-Marc 75002 Paris',
  'colette-boutique-paris': '213 Rue Saint-Honoré Paris',
  'the-restaurant-blanc-paris-16e': 'Restaurant Blanc 52 Rue de Longchamp Paris',
  'lagape-restaurant-paris': "L'Agapé 51 Rue Jouffroy-d'Abbans Paris",
  'les-neiges-courchevel': 'Hotel Barrière Les Neiges Courchevel',
  'biohotel-wildland': 'Biohotel WildLand St. Lorenzen Austria',
  'restaurant-yen-paris': 'Restaurant Yen 22 Rue Saint-Benoît Paris',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'BidetBeacon/1.0 (github.com/bidetbeacon; toto-import)',
            Accept: 'text/html',
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            fetchText(res.headers.location.startsWith('http') ? res.headers.location : BASE + res.headers.location)
              .then(resolve)
              .catch(reject);
            return;
          }
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(data));
        }
      )
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

function saveCache(c) {
  fs.writeFileSync(CACHE, JSON.stringify(c, null, 2));
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function geocodePhoton(query) {
  const url =
    'https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(query);
  const res = await fetch(url);
  const j = await res.json();
  const f = j.features?.[0];
  if (!f) return null;
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties;
  const display = [p.name, p.street, p.city, p.country].filter(Boolean).join(', ');
  return { lat: String(lat), lon: String(lon), display: display || query };
}

async function geocode(query, cache) {
  if (cache[query]) return cache[query];
  let result = await geocodePhoton(query);
  if (!result) {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
      encodeURIComponent(query);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BidetBeacon/1.0 (github.com/bidetbeacon)' },
    });
    const j = await res.json();
    const hit = j[0];
    if (hit) result = { lat: hit.lat, lon: hit.lon, display: hit.display_name };
    await sleep(1100);
  } else {
    await sleep(200);
  }
  cache[query] = result;
  saveCache(cache);
  return result;
}

function parsePage(html, slug) {
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const name = decodeHtml(titleMatch ? titleMatch[1].trim() : slug.replace(/-/g, ' '));

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  const detail = text.match(/A detailed look([\s\S]{0,4000}?)Read more Close/i);
  const block = detail ? detail[1] : text;

  const category = (block.match(/Category\s+(.+?)\s+(?:Owner|Rooms|Architect|Opened|Web|Product)/i) || [])[1]?.trim() || '';
  const products = (block.match(/Product\(s\)\s+(.+?)\s+(?:Following|Opened|The |Located|Considered|Since|In |After|Details|Category)/i) || [])[1]?.trim() || '';
  const webMatch = block.match(/Web\s+(?:Visit website\s+)?(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  const website = webMatch ? webMatch[1].replace(/www\./, 'https://www.') : '';

  const descMatch = block.match(/Product\(s\)\s+.+?\s+(Following its opening[\s\S]{0,400}?\.|Opened[\s\S]{0,400}?\.|The [\s\S]{0,400}?\.|Located[\s\S]{0,400}?\.|Considered[\s\S]{0,400}?\.|Since[\s\S]{0,400}?\.)/i);
  const description = descMatch ? descMatch[1].trim().slice(0, 280) : '';

  const bidetType = products.match(/WASHLET[^.]*/i)?.[0]?.slice(0, 80) || 'TOTO WASHLET';

  return { name, category, products, website, description, bidetType };
}

function inferLocation(name, slug) {
  const s = `${name} ${slug}`.toLowerCase();
  const rules = [
    [/courchevel|les-neiges/i, 'Courchevel', 'France'],
    [/saint-gervais|armancette|larmancette/i, 'Saint-Gervais-les-Bains', 'France'],
    [/imperator|nimes/i, 'Nîmes', 'France'],
    [/paris|fouquet|fauchon|chouchou|vernet|meurice|agape|blanc|yen|louvre|colette|buddha-bar|plaza-athenee|maison-albar|pont-neuf|viparis/i, 'Paris', 'France'],
    [/london|mayfair|shard|soho|claridge|berkeley|peninsula|connaught|stafford|scotland-yard|akatoki|araki|chrysan|sosharu|yo-sushi|marriott-county|marriott-park|hilton-on-park|biltmore|building-centre|wedding-gallery|banking-hall|hurlingham|jumeirah|radisson|eccleston|courthouse|lalit|rosewood|chugai|aldwych|jack-barclay|aston-martin|grand-designs|generationen|moorgate/i, 'London', 'UK'],
    [/kinsale|trident|actons/i, 'Kinsale', 'Ireland'],
    [/munich|munchen|bayernpost|vier-jahreszeiten|langham-nymphenburg|marriott-hotel-city-west|mandarin-oriental-munich/i, 'Munich', 'Germany'],
    [/berlin|dahlem|komische|seegalerie|ko-19|metropolitan-gardens/i, 'Berlin', 'Germany'],
    [/frankfurt|jw-marriott-hotel-frankfurt|jal-lounge/i, 'Frankfurt', 'Germany'],
    [/dusseldorf|duesseldorf|mods-hair/i, 'Düsseldorf', 'Germany'],
    [/essen|geku-haus/i, 'Essen', 'Germany'],
    [/bielefeld|franziskus/i, 'Bielefeld', 'Germany'],
    [/darmstadt|klinikum-darmstadt/i, 'Darmstadt', 'Germany'],
    [/sauerland|knippschild/i, 'Sauerland', 'Germany'],
    [/velen|schlosshotel-velen/i, 'Velen', 'Germany'],
    [/rosewood-vienna|vienna|wien|belvedere|park-hyatt-vienna|sans-souci|philsplace|andaz-vienna|hotel-daniel|parkapartments/i, 'Vienna', 'Austria'],
    [/zurich|zürich|park-hyatt-zurich/i, 'Zurich', 'Switzerland'],
    [/st-moritz|badrutt/i, 'St. Moritz', 'Switzerland'],
    [/vals|7132/i, 'Vals', 'Switzerland'],
    [/soelden|das-central/i, 'Sölden', 'Austria'],
    [/bad-ischl|goldenes-schiff/i, 'Bad Ischl', 'Austria'],
    [/tegernsee|bachmair/i, 'Tegernsee', 'Germany'],
    [/titisee|treschers/i, 'Titisee-Neustadt', 'Germany'],
    [/salzburg|gmachl/i, 'Salzburg', 'Austria'],
    [/schloss-elmau|elmau/i, 'Elmau', 'Germany'],
    [/badeparadies|schwarzwald/i, 'Titisee-Neustadt', 'Germany'],
    [/dolomites|paradiso-pure/i, 'South Tyrol', 'Italy'],
    [/riga|gastronome/i, 'Riga', 'Latvia'],
    [/moscow|moskva|lotte-hotel-moscow/i, 'Moscow', 'Russia'],
    [/amsterdam|sofitel-amsterdam/i, 'Amsterdam', 'Netherlands'],
    [/wildland|biohotel/i, 'Austria', 'Austria'],
    [/viparis/i, 'Paris', 'France'],
    [/weberhaus/i, 'Germany', 'Germany'],
    [/german-cancer|dkfz|heidelberg/i, 'Heidelberg', 'Germany'],
  ];
  for (const [re, city, country] of rules) {
    if (re.test(s)) return { city, country };
  }
  return { city: '', country: '' };
}

function mapType(category, name) {
  const c = `${category} ${name}`.toLowerCase();
  if (/restaurant|agapé|agape|sosharu|chrysan|gastronome|yo sushi|yen|blanc/i.test(c)) return 'restaurant';
  if (/hotel|palace|resort|inn|hôtel|suites|mayfair|rosewood|hyatt|marriott|hilton|four seasons|peninsula|claridge|connaught|sofitel|kempinski|andaz|langham/i.test(c)) return 'hotel';
  return 'public';
}

function mapAccess(type, category) {
  const c = category.toLowerCase();
  if (/health|hospital|klinikum|pharma|cancer|office|living|architect/i.test(c)) {
    return { access: 'limited', accessNote: 'Not a general public restroom — verify access before visiting' };
  }
  if (type === 'hotel') {
    return { access: 'limited', accessNote: 'Hotel guests and patrons' };
  }
  if (type === 'restaurant') {
    return { access: 'public', accessNote: 'Restaurant patrons' };
  }
  if (/shop|boutique|salon|showroom|centre|museum|louvre|oper|opera|lounge|club|viparis|weberhaus/i.test(c)) {
    return { access: 'public', accessNote: 'Public venue — hours and access may vary' };
  }
  return { access: 'limited', accessNote: 'Verify public access before visiting' };
}

async function main() {
  const listHtml = await fetchText(BASE + '/en/company-information/references');
  const slugs = [
    ...new Set(
      [...listHtml.matchAll(/href="(\/en\/company-information\/references\/[^"]+)"/g)]
        .map((m) => m[1].replace('/en/company-information/references/', ''))
        .filter((s) => s.includes('-') && !/^(health|hotel|leisure|living|office|public|restaurant|shops)$/.test(s))
    ),
  ];
  console.log('Found', slugs.length, 'TOTO reference slugs');

  const cache = loadCache();
  const rows = [];
  let skipped = 0;

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    if (SKIP_SLUGS.has(slug)) {
      skipped++;
      continue;
    }
    process.stderr.write(`[${i + 1}/${slugs.length}] ${slug}\n`);
    const url = `${BASE}/en/company-information/references/${slug}`;
    let html;
    try {
      html = await fetchText(url);
      await sleep(400);
    } catch (e) {
      console.warn('Fetch failed', slug, e.message);
      continue;
    }

    const parsed = parsePage(html, slug);
    const loc = inferLocation(parsed.name, slug);
    const type = mapType(parsed.category, parsed.name);
    const accessInfo = mapAccess(type, parsed.category);

    const geoQuery = GEO_QUERY[slug] || (loc.city
      ? `${parsed.name.replace(/[–—].*$/, '').trim()}, ${loc.city}, ${loc.country}`
      : parsed.name);
    const geo = await geocode(geoQuery, cache);
    if (!geo) {
      console.warn('No geocode:', geoQuery);
      continue;
    }

    rows.push({
      name: parsed.name,
      address: geo.display.split(',').slice(0, 4).join(', '),
      latitude: geo.lat,
      longitude: geo.lon,
      city: loc.city || geo.display.split(',')[0].trim(),
      country: loc.country || 'Europe',
      type,
      bidetStatus: 'warmed',
      bidetType: parsed.bidetType,
      sourceUrl: url,
      sourceQuote: `TOTO Europe reference: ${parsed.products.slice(0, 200) || 'WASHLET installation documented'}`,
      verifiedMethod: 'manufacturer-reference',
      access: accessInfo.access,
      accessNote: accessInfo.accessNote,
      totoCategory: parsed.category,
      website: parsed.website,
    });
  }

  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
  console.log(`Wrote ${rows.length} entries to ${OUT} (skipped ${skipped} private slugs)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
