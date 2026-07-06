#!/usr/bin/env node
/**
 * Long-running Iceland + Greenland bidet crawler.
 *
 * Iceland (IS) and Greenland (GL) are NOT bidet-friendly by default, so every row
 * must carry an explicit per-venue bidet mention (bidet / washlet / neorest /
 * Geberit AquaClean / handheld sprayer / "bidet shower"). We reuse the generic
 * Africa web-parsing helpers (venue-schema requirement, e-commerce filtering,
 * evidence-sentence extraction) and geocode with photon restricted to IS/GL.
 *
 * Usage:
 *   node scripts/crawl-nordic-web.cjs --minutes=90
 *   node scripts/crawl-nordic-web.cjs --minutes=90 --import
 *   node scripts/crawl-nordic-web.cjs --reset          # clear queue/state
 */
const fs = require('fs');
const path = require('path');
const {
  sleep,
  fetchText,
  hasBidetSignal,
  hasVenueSchema,
  parseVenuePage,
  extractUrlsFromSearch,
} = require('./lib/africa-web.cjs');

const OUT = path.join(__dirname, '../data/nordic-web-crawl-bidets.json');
const STATE = path.join(__dirname, '../data/nordic-crawl-state.json');
const CACHE = path.join(__dirname, '../data/nordic-geocode-cache.json');

const args = process.argv.slice(2);
const minArg = args.find((a) => a.startsWith('--minutes='));
const MINUTES = minArg ? Number(minArg.split('=')[1]) : 90;
const DO_IMPORT = args.includes('--import');
const RESET = args.includes('--reset');

/** Target countries: ISO code, display name, and cities/regions to search. */
const COUNTRIES = [
  {
    code: 'IS',
    name: 'Iceland',
    lang: 'en',
    cities: [
      'Reykjavik',
      'Kopavogur',
      'Hafnarfjordur',
      'Akureyri',
      'Reykjanesbaer',
      'Keflavik',
      'Selfoss',
      'Vik',
      'Hofn',
      'Egilsstadir',
      'Isafjordur',
      'Husavik',
      'Borgarnes',
      'Golden Circle',
      'Blue Lagoon',
    ],
  },
  {
    code: 'GL',
    name: 'Greenland',
    lang: 'en',
    cities: [
      'Nuuk',
      'Ilulissat',
      'Sisimiut',
      'Qaqortoq',
      'Kangerlussuaq',
      'Tasiilaq',
      'Narsarsuaq',
      'Maniitsoq',
      'Aasiaat',
      'Uummannaq',
    ],
  },
];

/** Danish phrasing helps for Greenland (Kingdom of Denmark). */
function queriesFor(country, city) {
  const c = `${city}`;
  const base = [
    `bidet hotel ${c} ${country.name}`,
    `"bidet" room ${c} bathroom`,
    `bidet suite ${c} ${country.name}`,
    `bidet guesthouse ${c} ${country.name}`,
    `washlet OR neorest hotel ${c} ${country.name}`,
    `"Geberit AquaClean" hotel ${c} ${country.name}`,
    `"shower toilet" hotel ${c} ${country.name}`,
    `bidet ${c} site:booking.com`,
    `bidet ${c} hotel site:tripadvisor.com`,
    `bidet ${c} restaurant ${country.name}`,
    `"private bathroom with a bidet" ${c} ${country.name}`,
  ];
  if (country.code === 'GL') {
    base.push(
      `bidet hotel ${c} Grønland`,
      `bidet værelse ${c} badeværelse`,
      `"Geberit AquaClean" hotel ${c} Grønland`
    );
  }
  if (country.code === 'IS') {
    base.push(
      `bidet hótel ${c}`,
      `bidet herbergi ${c} baðherbergi`,
      `bidet ${c} site:.is`
    );
  }
  return base;
}

/**
 * Curated seed URLs (country-pinned so geocoding stays in-country). Discovery
 * starting points — TOTO/Geberit references + known Nordic hotel review hubs.
 */
const SEED_URLS = [
  { url: 'https://www.tripadvisor.com/Hotels-g189970-Reykjavik_Capital_Region-Hotels.html', country: 'IS', city: 'Reykjavik' },
  { url: 'https://www.booking.com/country/is.html', country: 'IS', city: 'Reykjavik' },
  { url: 'https://www.booking.com/country/gl.html', country: 'GL', city: 'Nuuk' },
];

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadState() {
  const s = loadJson(STATE, null);
  if (s) return s;
  return {
    urlQueue: [],
    processedUrls: {},
    countryIndex: 0,
    cityIndex: 0,
    queryIndex: 0,
    seedsDone: false,
    stats: { pages: 0, hits: 0, added: 0, geoFail: 0, searches: 0 },
  };
}

function saveState(s) {
  s.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n');
}

function saveOut(rows) {
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n');
}

function saveCache(c) {
  fs.writeFileSync(CACHE, JSON.stringify(c, null, 2));
}

function normName(n) {
  return String(n).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function rowKey(r) {
  return `${normName(r.name)}|${Number(r.latitude || 0).toFixed(4)}|${Number(r.longitude || 0).toFixed(4)}`;
}

async function geocode(query, code, cache) {
  const ck = `${code}|${query}`;
  if (cache[ck] !== undefined) return cache[ck];
  try {
    const url = 'https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(query);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BidetBud-Research/1.0 (+https://bidetbud.com)' },
    });
    const j = await res.json();
    const f = j.features?.[0];
    if (!f) {
      cache[ck] = null;
      saveCache(cache);
      return null;
    }
    const p = f.properties;
    if (p.countrycode !== code) {
      cache[ck] = null;
      saveCache(cache);
      await sleep(200);
      return null;
    }
    const [lon, lat] = f.geometry.coordinates;
    const result = {
      lat: String(lat),
      lon: String(lon),
      city: p.city || p.county || p.state || '',
      display: [p.name, p.street, p.city, p.state, p.country].filter(Boolean).join(', '),
    };
    cache[ck] = result;
    saveCache(cache);
    await sleep(250);
    return result;
  } catch (e) {
    return null;
  }
}

async function geocodeRow(parsed, country, city, cache) {
  const queries = [
    parsed.address ? `${parsed.address}` : null,
    `${parsed.name}, ${city}, ${country.name}`,
    `${parsed.name}, ${country.name}`,
    `${city}, ${country.name}`,
  ].filter(Boolean);
  for (const q of queries) {
    const g = await geocode(q, country.code, cache);
    if (g) return g;
  }
  return null;
}

function enqueueSeeds(state) {
  if (state.seedsDone) return;
  for (const s of SEED_URLS) {
    if (!state.processedUrls[s.url]) {
      state.urlQueue.push({ url: s.url, city: s.city || '', country: s.country, via: 'seed' });
    }
  }
  state.seedsDone = true;
  console.log(`Seeds: queued ${SEED_URLS.length} curated URLs`);
}

const JUNK_HOST_RE =
  /facebook|instagram|youtube|twitter|linkedin|wikipedia|pinterest|tiktok|amazon|aliexpress|alibaba|reddit|quora|yelp|google\.|bing\.|duckduckgo|maps\./i;

const JUNK_PATH_RE =
  /\/(?:business-directory|directory|tag|tags|category|categories|search|find|listings?|blog|news|articles?|guide|guides|best-|top-|things-to-do|travel-guide|deals?|offers?)(?:\/|-|$|\?)/i;

function cleanSearchUrls(html, state) {
  return extractUrlsFromSearch(html).filter((u) => {
    if (state.processedUrls[u]) return false;
    if (JUNK_HOST_RE.test(u)) return false;
    if (JUNK_PATH_RE.test(u)) return false;
    if (/\.(?:jpg|jpeg|png|gif|pdf|zip|mp4|webp|css|js)(?:$|\?)/i.test(u)) return false;
    return true;
  });
}

async function searchWeb(q, lang, state) {
  const providers = [
    async () =>
      fetchText('https://lite.duckduckgo.com/lite/', {
        lang,
        method: 'POST',
        body: { q },
        extraHeaders: { Referer: 'https://lite.duckduckgo.com/' },
      }),
    async () => fetchText('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { lang }),
    async () => fetchText('https://www.mojeek.com/search?q=' + encodeURIComponent(q), { lang }),
    async () => fetchText('https://search.marginalia.nu/search?query=' + encodeURIComponent(q), { lang }),
  ];
  for (let i = 0; i < providers.length; i++) {
    try {
      const html = await providers[i]();
      const urls = cleanSearchUrls(html, state);
      if (urls.length) {
        state.searchBackoff = 0;
        return urls;
      }
    } catch (e) {
      /* provider rate-limited; try next */
    }
    await sleep(600);
  }
  state.searchBackoff = Math.min((state.searchBackoff || 0) + 1, 6);
  const wait = 3000 * 2 ** (state.searchBackoff - 1);
  console.warn(`All search providers blocked; backing off ${Math.round(wait / 1000)}s`);
  await sleep(wait);
  return [];
}

async function searchDiscovery(state) {
  const country = COUNTRIES[state.countryIndex % COUNTRIES.length];
  const city = country.cities[state.cityIndex % country.cities.length];
  const queries = queriesFor(country, city);
  const q = queries[state.queryIndex % queries.length];

  const urls = await searchWeb(q, country.lang, state);
  let added = 0;
  for (const u of urls.slice(0, 12)) {
    state.urlQueue.push({ url: u.split('#')[0], city, country: country.code, via: `q:${q.slice(0, 28)}` });
    added++;
  }
  state.stats.searches++;
  console.log(`Search [${country.name}/${city}] "${q.slice(0, 42)}…" → +${added}`);
  await sleep(1200);

  state.queryIndex++;
  if (state.queryIndex % queries.length === 0) {
    state.cityIndex++;
    if (state.cityIndex % country.cities.length === 0) {
      state.countryIndex++;
    }
  }
}

function countryFromCode(code) {
  return COUNTRIES.find((c) => c.code === code) || null;
}

async function processUrlBatch(state, rows, rowMap, cache, batch = 10) {
  const items = state.urlQueue.splice(0, batch);
  for (const item of items) {
    const url = item.url.split('#')[0];
    if (state.processedUrls[url]) continue;
    state.processedUrls[url] = Date.now();

    try {
      const html = await fetchText(url, item.country === 'GL' ? 'da' : 'en');
      state.stats.pages++;
      if (!hasBidetSignal(html)) continue;
      if (!hasVenueSchema(html)) continue;

      const country = item.country ? countryFromCode(item.country) : null;
      if (!country) continue; // no cross-country guessing

      const parsed = parseVenuePage(html, url, {
        cities: country.cities || (item.city ? [item.city] : []),
        countryName: country.name,
      });
      if (!parsed?.hasBidet) continue;
      state.stats.hits++;

      const geo = await geocodeRow(parsed, country, item.city || '', cache);
      if (!geo) {
        state.stats.geoFail++;
        console.warn('No geocode:', parsed.name.slice(0, 50));
        continue;
      }

      const row = {
        name: parsed.name,
        address: parsed.address || geo.display.split(',').slice(0, 5).join(', '),
        latitude: geo.lat,
        longitude: geo.lon,
        city: item.city || geo.city || '',
        country: country.name,
        type: parsed.type || 'hotel',
        bidetStatus: 'internet',
        bidetType: parsed.bidetType || 'Bidet',
        sourceUrl: parsed.sourceUrl,
        sourceQuote: parsed.sourceQuote,
        verifiedMethod: 'web-source',
        access: 'limited',
        accessNote: 'Verify before visiting',
      };
      const key = rowKey(row);
      if (rowMap.has(key)) continue;
      rowMap.set(key, row);
      rows.push(row);
      state.stats.added++;
      console.log(`+ [${country.name}] ${row.name} (${row.city})`);
      saveOut(rows);
      await sleep(300);
    } catch (e) {
      console.warn('URL fail:', url.slice(0, 60), '-', e.message);
    }
  }
}

function runImport() {
  const { execFileSync } = require('child_process');
  try {
    execFileSync('node', [path.join(__dirname, 'import-iceland-greenland.cjs')], { stdio: 'inherit' });
  } catch (e) {
    console.warn('Import failed:', e.message);
  }
}

async function main() {
  if (RESET) {
    for (const p of [STATE]) if (fs.existsSync(p)) fs.unlinkSync(p);
    console.log('State reset.');
  }
  const end = Date.now() + MINUTES * 60 * 1000;
  const state = loadState();
  const rows = loadJson(OUT, []);
  const cache = loadJson(CACHE, {});
  const rowMap = new Map(rows.map((r) => [rowKey(r), r]));
  let cycle = 0;

  console.log(`Nordic web crawler — ${MINUTES} min across ${COUNTRIES.length} countries (IS, GL)`);
  console.log(`Output: ${OUT} | existing rows: ${rows.length} | queue: ${state.urlQueue.length}`);

  enqueueSeeds(state);

  while (Date.now() < end) {
    cycle++;
    if (state.urlQueue.length < 20) {
      await searchDiscovery(state);
      await searchDiscovery(state);
    }
    await processUrlBatch(state, rows, rowMap, cache, 10);

    saveState(state);
    if (cycle % 5 === 0) {
      const s = state.stats;
      console.log(
        `\n[cycle ${cycle}] pages=${s.pages} hits=${s.hits} added=${s.added} ` +
          `geoFail=${s.geoFail} searches=${s.searches} rows=${rows.length} queue=${state.urlQueue.length}\n`
      );
    }
    if (DO_IMPORT && cycle % 25 === 0) runImport();
    await sleep(300);
  }

  saveState(state);
  saveOut(rows);
  console.log(`\nDone: ${cycle} cycles, ${rows.length} rows in ${OUT}`);
  console.log('Stats:', state.stats);
  if (DO_IMPORT) runImport();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
