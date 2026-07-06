#!/usr/bin/env node
/**
 * Long-running Germany bidet crawler — German websites only.
 *
 * Sources: TOTO eu.toto.com/de, Geberit.de references, German hotel sites,
 * DuckDuckGo discovery on .de domains, HRS/booking/holidaycheck/tripadvisor.de.
 *
 * Usage:
 *   node scripts/crawl-germany-web.cjs --minutes=90
 *   node scripts/crawl-germany-web.cjs --minutes=90 --import
 */
const fs = require('fs');
const path = require('path');
const {
  sleep,
  fetchText,
  parseGenericGermanPage,
  parseGeberitReference,
  parseTotoDeReference,
  extractTotoDeSlugs,
  extractGeberitRefUrls,
  extractUrlsFromSearch,
  isGermanDomain,
  isGermanyRelevant,
  hasBidetSignal,
  BIDET_KW,
} = require('./lib/germany-web.cjs');

const OUT = path.join(__dirname, '../data/germany-web-crawl-bidets.json');
const STATE = path.join(__dirname, '../data/germany-crawl-state.json');
const CACHE = path.join(__dirname, '../data/germany-geocode-cache.json');

const args = process.argv.slice(2);
const minArg = args.find((a) => a.startsWith('--minutes='));
const MINUTES = minArg ? Number(minArg.split('=')[1]) : 90;
const DO_IMPORT = args.includes('--import');

const TOTO_BASE = 'https://eu.toto.com';

/** Major German cities for search discovery */
const CITIES = [
  { city: 'Berlin', de: 'Berlin' },
  { city: 'Munich', de: 'München' },
  { city: 'Hamburg', de: 'Hamburg' },
  { city: 'Frankfurt', de: 'Frankfurt am Main' },
  { city: 'Cologne', de: 'Köln' },
  { city: 'Stuttgart', de: 'Stuttgart' },
  { city: 'Düsseldorf', de: 'Düsseldorf' },
  { city: 'Leipzig', de: 'Leipzig' },
  { city: 'Dresden', de: 'Dresden' },
  { city: 'Hanover', de: 'Hannover' },
  { city: 'Nuremberg', de: 'Nürnberg' },
  { city: 'Bremen', de: 'Bremen' },
  { city: 'Heidelberg', de: 'Heidelberg' },
  { city: 'Bonn', de: 'Bonn' },
  { city: 'Freiburg', de: 'Freiburg' },
  { city: 'Karlsruhe', de: 'Karlsruhe' },
  { city: 'Mannheim', de: 'Mannheim' },
  { city: 'Augsburg', de: 'Augsburg' },
  { city: 'Wiesbaden', de: 'Wiesbaden' },
  { city: 'Münster', de: 'Münster' },
  { city: 'Potsdam', de: 'Potsdam' },
  { city: 'Regensburg', de: 'Regensburg' },
  { city: 'Tübingen', de: 'Tübingen' },
  { city: 'Garmisch-Partenkirchen', de: 'Garmisch-Partenkirchen' },
  { city: 'Titisee-Neustadt', de: 'Titisee-Neustadt' },
  { city: 'Baden-Baden', de: 'Baden-Baden' },
  { city: 'Pfullendorf', de: 'Pfullendorf' },
  { city: 'Isenbüttel', de: 'Isenbüttel' },
  { city: 'Krün', de: 'Krün' },
  { city: 'Kreuth', de: 'Kreuth' },
];

const SEARCH_QUERIES = (cityDe) => [
  `site:geberit.de Dusch-WC Hotel ${cityDe}`,
  `site:eu.toto.com/de Washlet ${cityDe}`,
  `site:booking.com/de Dusch-WC ${cityDe}`,
  `site:holidaycheck.de Washlet ${cityDe}`,
  `site:holidaycheck.de Dusch-WC ${cityDe}`,
  `site:tripadvisor.de Washlet Hotel ${cityDe}`,
  `site:hotel.de Dusch-WC ${cityDe}`,
  `site:hrs.de AquaClean ${cityDe}`,
  `site:kurz-mal-weg.de Dusch-WC ${cityDe}`,
  `site:expedia.de Washlet ${cityDe}`,
  `Dusch-WC Hotel ${cityDe} site:.de`,
  `Washlet Zimmer ${cityDe} site:.de`,
  `AquaClean Hotel ${cityDe} site:.de`,
  `TOTO Washlet ${cityDe} Hotel site:.de`,
  `Geberit Dusch-WC ${cityDe} Zimmer`,
  `site:shk-profi.de Washlet ${cityDe}`,
  `site:baulinks.de Dusch-WC Hotel ${cityDe}`,
  `site:horizont.net Washlet Hotel ${cityDe}`,
  `site:aerztezeitung.de Dusch-WC Hotel`,
  `Japanisches WC Hotel ${cityDe}`,
];

/** Curated German hotel / manufacturer pages with known bidet mentions */
const SEED_URLS = [
  // Geberit manufacturer references (Germany)
  'https://www.geberit.de/know-how/referenzen/the-fontenay-hamburg/',
  'https://www.geberit.de/know-how/referenzen/riku-hotel-pfullendorf/',
  'https://www.geberit.de/know-how/referenzen/hotel-hoeri/',
  'https://www.geberit.de/know-how/referenzen/hotel-rosenhof/',
  'https://www.geberit.de/badezimmerprodukte/wcs-urinale/dusch-wcs-geberit-aquaclean/testen/hotels-mit-dusch-wc/',
  // TOTO Germany references
  'https://eu.toto.com/de/unternehmen/referenzen/jw-marriott-hotel-frankfurt',
  'https://eu.toto.com/de/unternehmen/referenzen/marriott-hotel-city-west-munchen',
  'https://eu.toto.com/de/unternehmen/referenzen/vier-jahreszeiten-kempinski-munchen',
  'https://eu.toto.com/de/unternehmen/referenzen/sofitel-bayernpost-munich',
  'https://eu.toto.com/de/unternehmen/referenzen/mandarin-oriental-munchen',
  'https://eu.toto.com/de/unternehmen/referenzen/schwarzwaldhotel-treschers-titisee-neustadt',
  'https://eu.toto.com/de/unternehmen/referenzen/hotel-schloss-elmau',
  'https://eu.toto.com/de/unternehmen/referenzen/spa-resort-bachmair-weissach-am-tegernsee',
  'https://eu.toto.com/de/unternehmen/referenzen/badeparadies-schwarzwald',
  'https://eu.toto.com/de/unternehmen/referenzen/jal-lounge-airport-frankfurt',
  'https://eu.toto.com/de/unternehmen/referenzen/langham-nymphenburg-residence-munchen',
  'https://eu.toto.com/de/unternehmen/referenzen/klinikum-darmstadt-gmbh',
  'https://eu.toto.com/de/unternehmen/referenzen/seegalerie-berlin-tegel',
  'https://eu.toto.com/de/unternehmen/referenzen/die-komische-oper-berlin',
  'https://eu.toto.com/de/unternehmen/referenzen/dahlem-paradise-berlin',
  'https://eu.toto.com/de/unternehmen/referenzen/ko-19-berlin',
  'https://eu.toto.com/de/unternehmen/referenzen/the-metropolitan-gardens-berlin-dahlem',
  'https://eu.toto.com/de/unternehmen/referenzen/deutsches-krebsforschungszentrum',
  'https://eu.toto.com/de/unternehmen/referenzen/mods-hair-salon-dusseldorf',
  'https://eu.toto.com/de/unternehmen/referenzen/schlosshotel-velen',
  'https://eu.toto.com/de/unternehmen/referenzen/franziskus-hospital-bielefeld',
  'https://eu.toto.com/de/unternehmen/referenzen/generationen-kult-haus-geku-haus-essen',
  'https://eu.toto.com/de/unternehmen/referenzen/landhotel-knippschild-sauerland',
  'https://eu.toto.com/de/unternehmen/referenzen/weberhaus',
  // German trade press / blogs citing hotels
  'https://www.shk-profi.de/artikel/shk_Dusch-WC_im_Luxus-Hotel-3052137.html',
  'https://www.baulinks.de/badezimmer/dusch-wc.php',
  'https://www.wasnichtpasst-wirdpassendgemacht.de/unser-dusch-wc-washlet-als-echtes-super-klo-der-spitzenklasse/',
  // Official German hotel sites
  'https://www.thefontenay.de/',
  'https://www.thefontenay.de/zimmer/',
  'https://www.sofitel-munich.com/de/zimmer/',
  'https://www.kempinski.com/de/munich/hotel-vier-jahreszeiten/',
  'https://www.mandarinoriental.com/de/munich/alter-hof',
  'https://www.schloss-elmau.de/de/zimmer-suiten',
  'https://www.bachmair-weissach.de/zimmer-suiten',
  'https://www.badeparadies-schwarzwald.de/',
  'https://www.riku-hotel.de/',
  'https://www.hotel-rosenhof.de/',
  'https://www.hotel-hoeri.de/',
  'https://www.radissonhotels.com/de-de/hotels/radisson-blu-koeln',
  'https://www.marriott.com/de/hotels/mucwi-munich-marriott-hotel-city-west/rooms/',
  'https://www.marriott.com/de/hotels/frajw-jw-marriott-hotel-frankfurt/rooms/',
  'https://www.treschers-schwarzwaldhotel.de/zimmer-preise/',
  'https://www.schlosshotel-velen.de/zimmer/',
  // German booking / review portals (specific hotel pages)
  'https://www.holidaycheck.de/hi/sofitel-muenchen-bayerpost/0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a',
];

const GEBERIT_KNOWN = [
  'the-fontenay-hamburg',
  'riku-hotel-pfullendorf',
  'hotel-hoeri',
  'hotel-rosenhof',
];

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return {
      urlQueue: [],
      totoQueue: [],
      geberitQueue: [],
      processedUrls: {},
      processedToto: {},
      processedGeberit: {},
      cityIndex: 0,
      queryIndex: 0,
      seedsDone: false,
      stats: { toto: 0, geberit: 0, generic: 0, added: 0 },
    };
  }
}

function saveState(s) {
  s.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n');
}

function loadOut() {
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    return [];
  }
}

function saveOut(rows) {
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n');
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

function normName(n) {
  return String(n).toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
}

function mergeRow(rows, row) {
  const key = `${normName(row.name)}|${Number(row.latitude || 0).toFixed(4)}|${Number(row.longitude || 0).toFixed(4)}`;
  const map = new Map(
    rows.map((r) => [`${normName(r.name)}|${Number(r.latitude || 0).toFixed(4)}|${Number(r.longitude || 0).toFixed(4)}`, r])
  );
  if (!map.has(key)) map.set(key, row);
  return [...map.values()];
}

async function geocode(query, cache) {
  if (cache[query]) return cache[query];
  const url = 'https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(query);
  const res = await fetch(url);
  const j = await res.json();
  const f = j.features?.[0];
  if (!f) return null;
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties;
  if (p.countrycode !== 'DE') return null;
  const result = {
    lat: String(lat),
    lon: String(lon),
    display: [p.name, p.street, p.city, p.state, p.country].filter(Boolean).join(', '),
    city: p.city || '',
  };
  cache[query] = result;
  saveCache(cache);
  await sleep(200);
  return result;
}

async function geocodeRow(name, address, city, cache) {
  const queries = [
    address ? `${address}, Deutschland` : null,
    `${name}, ${city}, Deutschland`,
    `${name}, Germany`,
    `${name} Hotel Deutschland`,
  ].filter(Boolean);
  for (const q of queries) {
    const g = await geocode(q, cache);
    if (g) return g;
  }
  return null;
}

function toRow(parsed, city, sourceLabel) {
  const isMfr = parsed.verifiedMethod === 'manufacturer-reference' || /toto|geberit/i.test(parsed.sourceUrl || '');
  return {
    name: parsed.name,
    address: parsed.address || '',
    city: city.city || city || '',
    type: /restaurant|gastronomie|lounge|oper|salon/i.test(parsed.name || '') ? 'restaurant' : /klinik|hospital|zentrum|forschung/i.test(parsed.name || '') ? 'public' : 'hotel',
    bidetStatus: parsed.bidetStatus || (isMfr ? 'warmed' : 'internet'),
    bidetType: parsed.bidetType || 'Dusch-WC',
    sourceUrl: parsed.sourceUrl,
    sourceQuote: parsed.sourceQuote.startsWith(sourceLabel) ? parsed.sourceQuote : `${sourceLabel}: ${parsed.sourceQuote}`,
    verifiedMethod: parsed.verifiedMethod || (isMfr ? 'manufacturer-reference' : 'web-source'),
    access: 'limited',
    accessNote: 'Hotel guests and patrons — verify before visiting',
  };
}

async function discoverTotoDe(state) {
  if (state.totoDiscovered) return;
  try {
    const html = await fetchText(`${TOTO_BASE}/de/unternehmen/referenzen`);
    const slugs = extractTotoDeSlugs(html);
    const germanySlugs = slugs.filter((s) =>
      /munich|munchen|münchen|berlin|frankfurt|hamburg|dusseldorf|duesseldorf|essen|bielefeld|darmstadt|elmau|tegernsee|titisee|schwarzwald|velen|sauerland|knippschild|heidelberg|krebs|weberhaus|geku|koln|koeln|köln|stuttgart|hannover|leipzig|dresden|bremen|heidelberg|baden|garmisch|pfullendorf|rosenhof|fontenay/i.test(s)
    );
    for (const slug of [...new Set([...germanySlugs, ...slugs])]) {
      if (state.processedToto[slug]) continue;
      state.totoQueue.push(slug);
    }
    state.totoDiscovered = true;
    console.log(`TOTO DE: queued ${state.totoQueue.length} reference slugs`);
    await sleep(500);
  } catch (e) {
    console.warn('TOTO index:', e.message);
  }
}

async function discoverGeberit(state) {
  if (state.geberitDiscovered) return;
  for (const slug of GEBERIT_KNOWN) {
    const url = `https://www.geberit.de/know-how/referenzen/${slug}/`;
    if (!state.processedGeberit[url]) state.geberitQueue.push(url);
  }
  try {
    const html = await fetchText(
      'https://www.geberit.de/badezimmerprodukte/wcs-urinale/dusch-wcs-geberit-aquaclean/testen/hotels-mit-dusch-wc/'
    );
    for (const u of extractGeberitRefUrls(html)) {
      if (!state.processedGeberit[u]) state.geberitQueue.push(u);
    }
    // Scrape Geberit referenzen index
    const idx = await fetchText('https://www.geberit.de/know-how/referenzen/');
    for (const m of idx.matchAll(/href="(\/know-how\/referenzen\/[^"#?]+)"/g)) {
      const u = 'https://www.geberit.de' + m[1];
      if (/hotel|fontenay|riku|rosenhof|hoeri/i.test(u) && !state.processedGeberit[u]) {
        state.geberitQueue.push(u);
      }
    }
    state.geberitDiscovered = true;
    console.log(`Geberit: queued ${state.geberitQueue.length} reference URLs`);
    await sleep(500);
  } catch (e) {
    console.warn('Geberit index:', e.message);
  }
}

function enqueueSeeds(state) {
  if (state.seedsDone) return;
  for (const url of SEED_URLS) {
    if (!state.processedUrls[url]) state.urlQueue.push({ url, city: '', via: 'seed' });
  }
  state.seedsDone = true;
  console.log(`Seeds: queued ${SEED_URLS.length} curated German URLs`);
}

async function processTotoBatch(state, rows, cache, batch = 8) {
  const items = state.totoQueue.splice(0, batch);
  for (const slug of items) {
    if (state.processedToto[slug]) continue;
    state.processedToto[slug] = Date.now();
    const url = `${TOTO_BASE}/de/unternehmen/referenzen/${slug}`;
    try {
      const html = await fetchText(url);
      const parsed = parseTotoDeReference(html, slug, url);
      if (!parsed?.hasBidet) continue;
      if (!isGermanyRelevant(html, '')) continue;
      state.stats.toto++;

      const geo = await geocodeRow(parsed.name, parsed.address, '', cache);
      if (!geo) {
        console.warn('No geocode (TOTO):', parsed.name);
        continue;
      }

      const cityEntry = CITIES.find((c) => geo.display.toLowerCase().includes(c.de.toLowerCase())) || { city: geo.city || '' };
      const row = {
        ...toRow(parsed, cityEntry, 'TOTO Europe DE'),
        latitude: geo.lat,
        longitude: geo.lon,
        address: parsed.address || geo.display.split(',').slice(0, 5).join(', '),
        city: cityEntry.city || geo.city,
      };
      const merged = mergeRow(rows, row);
      rows.length = 0;
      rows.push(...merged);
      state.stats.added++;
      console.log(`+ [TOTO] ${row.name}`);
      saveOut(rows);
      await sleep(400);
    } catch (e) {
      console.warn('TOTO fail:', slug, e.message);
    }
  }
}

async function processGeberitBatch(state, rows, cache, batch = 5) {
  const items = state.geberitQueue.splice(0, batch);
  for (const url of items) {
    if (state.processedGeberit[url]) continue;
    state.processedGeberit[url] = Date.now();
    try {
      const html = await fetchText(url);
      const parsed = parseGeberitReference(html, url);
      if (!parsed?.hasBidet) continue;
      state.stats.geberit++;

      const geo = await geocodeRow(parsed.name, parsed.address, '', cache);
      if (!geo) {
        console.warn('No geocode (Geberit):', parsed.name);
        continue;
      }

      const cityEntry = CITIES.find((c) => geo.display.toLowerCase().includes(c.de.toLowerCase())) || { city: geo.city || '' };
      const row = {
        ...toRow(parsed, cityEntry, 'Geberit DE'),
        latitude: geo.lat,
        longitude: geo.lon,
        address: parsed.address || geo.display.split(',').slice(0, 5).join(', '),
        city: cityEntry.city || geo.city,
      };
      const merged = mergeRow(rows, row);
      rows.length = 0;
      rows.push(...merged);
      state.stats.added++;
      console.log(`+ [Geberit] ${row.name}`);
      saveOut(rows);
      await sleep(400);
    } catch (e) {
      console.warn('Geberit fail:', url.slice(0, 60), e.message);
    }
  }
}

async function searchDiscovery(state) {
  const city = CITIES[state.cityIndex % CITIES.length];
  const queries = SEARCH_QUERIES(city.de);
  const q = queries[state.queryIndex % queries.length];
  state.queryIndex++;

  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const html = await fetchText(url, 'de-DE');
    const urls = extractUrlsFromSearch(html).filter((u) => {
      if (state.processedUrls[u]) return false;
      if (!isGermanDomain(u)) return false;
      if (/facebook|instagram|youtube|twitter|linkedin|wikipedia|amazon\.de\/(?!.*hotel)/i.test(u)) return false;
      return true;
    });
    let added = 0;
    for (const u of urls.slice(0, 12)) {
      state.urlQueue.push({ url: u, city: city.city, via: `search:${q.slice(0, 30)}` });
      added++;
    }
    console.log(`Search [${city.de}] "${q.slice(0, 45)}…" → +${added} URLs`);
    await sleep(1400);
  } catch (e) {
    console.warn('Search fail:', e.message);
  }

  if (state.queryIndex % queries.length === 0) state.cityIndex++;
}

async function processUrlBatch(state, rows, cache, batch = 10) {
  const items = state.urlQueue.splice(0, batch);
  for (const item of items) {
    const url = item.url.split('#')[0];
    if (state.processedUrls[url]) continue;
    state.processedUrls[url] = Date.now();

    try {
      if (/geberit\.de\/know-how\/referenzen/i.test(url)) {
        const html = await fetchText(url);
        const parsed = parseGeberitReference(html, url);
        if (!parsed?.hasBidet) continue;
        state.stats.geberit++;
        const geo = await geocodeRow(parsed.name, parsed.address, item.city, cache);
        if (!geo) continue;
        const row = {
          ...toRow(parsed, { city: item.city || geo.city }, 'Geberit DE'),
          latitude: geo.lat,
          longitude: geo.lon,
          address: parsed.address || geo.display.split(',').slice(0, 5).join(', '),
          city: item.city || geo.city,
        };
        const merged = mergeRow(rows, row);
        rows.length = 0;
        rows.push(...merged);
        state.stats.added++;
        console.log(`+ [Geberit URL] ${row.name}`);
        saveOut(rows);
        await sleep(400);
        continue;
      }

      if (/eu\.toto\.com\/de\/unternehmen\/referenzen/i.test(url)) {
        const slug = url.split('/').pop();
        const html = await fetchText(url);
        const parsed = parseTotoDeReference(html, slug, url);
        if (!parsed?.hasBidet || !isGermanyRelevant(html, item.city)) continue;
        state.stats.toto++;
        const geo = await geocodeRow(parsed.name, parsed.address, item.city, cache);
        if (!geo) continue;
        const row = {
          ...toRow(parsed, { city: item.city || geo.city }, 'TOTO Europe DE'),
          latitude: geo.lat,
          longitude: geo.lon,
          address: parsed.address || geo.display.split(',').slice(0, 5).join(', '),
          city: item.city || geo.city,
        };
        const merged = mergeRow(rows, row);
        rows.length = 0;
        rows.push(...merged);
        state.stats.added++;
        console.log(`+ [TOTO URL] ${row.name}`);
        saveOut(rows);
        await sleep(400);
        continue;
      }

      const html = await fetchText(url);
      if (!hasBidetSignal(html)) continue;
      const parsed = parseGenericGermanPage(html, url);
      if (!parsed?.hasBidet) continue;
      if (!isGermanyRelevant(html + parsed.name, item.city)) continue;
      state.stats.generic++;

      const geo = await geocodeRow(parsed.name, parsed.address, item.city, cache);
      if (!geo) {
        console.warn('No geocode:', parsed.name);
        continue;
      }

      const label = /shk-profi|baulinks/i.test(url)
        ? 'SHK Fachpresse DE'
        : /holidaycheck/i.test(url)
          ? 'HolidayCheck DE'
          : /tripadvisor\.de/i.test(url)
            ? 'TripAdvisor DE'
            : /booking\.com/i.test(url)
              ? 'Booking.com DE'
              : /hrs\./i.test(url)
                ? 'HRS DE'
                : /hotel\.de/i.test(url)
                  ? 'hotel.de'
                  : 'Deutsche Webquelle';

      const row = {
        ...toRow(parsed, { city: item.city || geo.city }, label),
        latitude: geo.lat,
        longitude: geo.lon,
        address: parsed.address || geo.display.split(',').slice(0, 5).join(', '),
        city: item.city || geo.city,
      };
      const merged = mergeRow(rows, row);
      rows.length = 0;
      rows.push(...merged);
      state.stats.added++;
      console.log(`+ [${label}] ${row.name}`);
      saveOut(rows);
      await sleep(450);
    } catch (e) {
      console.warn('URL fail:', url.slice(0, 70), e.message);
    }
  }
}

function runImport() {
  const { execFileSync } = require('child_process');
  try {
    execFileSync('node', [path.join(__dirname, 'merge-germany-crawl.cjs')], { stdio: 'inherit' });
    execFileSync('node', [path.join(__dirname, 'import-germany.cjs')], { stdio: 'inherit' });
  } catch (e) {
    console.warn('Import failed:', e.message);
  }
}

async function main() {
  const end = Date.now() + MINUTES * 60 * 1000;
  const state = loadState();
  let rows = loadOut();
  const cache = loadCache();
  let cycle = 0;

  console.log(`Germany web crawler — ${MINUTES} min, German sources focus`);
  console.log(`Output: ${OUT} | existing: ${rows.length} | url queue: ${state.urlQueue.length}`);

  enqueueSeeds(state);
  await discoverTotoDe(state);
  await discoverGeberit(state);

  while (Date.now() < end) {
    cycle++;
    console.log(`\n=== Cycle ${cycle} ===`);

    await processTotoBatch(state, rows, cache, 6);
    await processGeberitBatch(state, rows, cache, 4);
    await processUrlBatch(state, rows, cache, 12);
    await searchDiscovery(state);

    saveState(state);
    console.log(
      `Stats: toto=${state.stats.toto} geberit=${state.stats.geberit} generic=${state.stats.generic} ` +
        `added=${state.stats.added} rows=${rows.length} uQ=${state.urlQueue.length} ` +
        `tQ=${state.totoQueue.length} gQ=${state.geberitQueue.length}`
    );

    if (DO_IMPORT && cycle % 5 === 0) runImport();
    await sleep(400);
  }

  saveState(state);
  saveOut(rows);
  console.log(`\nDone ${cycle} cycles. Total rows: ${rows.length}`);
  if (DO_IMPORT) runImport();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
