#!/usr/bin/env node
/**
 * Discover halal restaurants via web search (DDG/Mojeek) — finds Yelp, TripAdvisor,
 * Google Maps, Reddit, Facebook, and venue pages that explicitly mention halal.
 *
 *   node scripts/crawl-halal-web.cjs --minutes=60
 *   node scripts/crawl-halal-web.cjs --minutes=60 --import
 *   node scripts/crawl-halal-web.cjs --reset
 */
const fs = require('fs');
const path = require('path');
const {
  SEARCH_COUNTRIES,
  fetchText,
  sleep,
  extractUrlsFromSearch,
  halalSearchQueries,
  isHalalCandidateUrl,
  parseHalalVenuePage,
  geocodeVenue,
  isHalalDefaultCountry,
} = require('./lib/halal-extra.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/halal-web-crawl-restaurants.json');
const STATE = path.join(ROOT, 'data/halal-web-crawl-state.json');
const CACHE = path.join(ROOT, 'data/halal-web-geocode-cache.json');

const args = process.argv.slice(2);
const minArg = args.find((a) => a.startsWith('--minutes='));
const MINUTES = minArg ? Number(minArg.split('=')[1]) : 60;
const DO_IMPORT = args.includes('--import');
const RESET = args.includes('--reset');

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

async function searchDdg(q) {
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
  return fetchText(url);
}

async function searchMojeek(q) {
  const url = 'https://www.mojeek.com/search?q=' + encodeURIComponent(q);
  return fetchText(url);
}

function buildQueue() {
  const queue = [];
  for (const country of SEARCH_COUNTRIES) {
    if (isHalalDefaultCountry(country.name)) continue;
    for (const city of country.cities) {
      for (const q of halalSearchQueries(city, country.name)) {
        queue.push({ type: 'search', q, country, city, engine: 'ddg' });
        queue.push({ type: 'search', q, country, city, engine: 'mojeek' });
      }
    }
  }
  return queue;
}

async function runSearch(item, state) {
  const sk = `${item.engine}|${item.q}`;
  if (state.searchesDone[sk]) return;
  let html;
  try {
    html = item.engine === 'mojeek' ? await searchMojeek(item.q) : await searchDdg(item.q);
  } catch {
    return;
  }
  const urls = extractUrlsFromSearch(html).filter(isHalalCandidateUrl);
  for (const u of urls) {
    if (!state.fetched[u]) state.urlQueue.push({ url: u, country: item.country, city: item.city });
  }
  state.searchesDone[sk] = true;
  await sleep(600);
}

async function fetchPage(item, cache) {
  let parsed;
  try {
    const html = await fetchText(item.url);
    parsed = parseHalalVenuePage(html, item.url, {
      countryName: item.country.name,
      cities: item.country.cities,
      source: 'web-search',
    });
  } catch {
    return null;
  }
  if (!parsed) return null;

  let lat = parsed.latitude;
  let lon = parsed.longitude;
  let address = parsed.address;
  let city = item.city;
  let country = item.country.name;

  if (!lat || !lon) {
    const geo = await geocodeVenue(parsed, item.country.code, item.country.name, item.city, cache);
    if (!geo) return null;
    lat = geo.latitude;
    lon = geo.longitude;
    address = geo.address || address;
    city = geo.city || city;
    country = geo.country || country;
  }

  if (isHalalDefaultCountry(country)) return null;

  return {
    name: parsed.name,
    address: address || '',
    latitude: String(lat),
    longitude: String(lon),
    city,
    country,
    halalStatus: parsed.halalStatus,
    cuisine: parsed.cuisine || '',
    sourceUrl: parsed.sourceUrl,
    sourceQuote: parsed.sourceQuote,
    verifiedMethod: 'web-source',
    source: 'web-search',
  };
}

function rowKey(r) {
  return `${r.name.toLowerCase()}|${r.latitude}|${r.longitude}`;
}

async function main() {
  let state = RESET
    ? { searchesDone: {}, fetched: {}, urlQueue: [], searchQueue: buildQueue(), rows: [] }
    : loadJson(STATE, { searchesDone: {}, fetched: {}, urlQueue: [], searchQueue: [], rows: [] });

  if (!state.searchQueue?.length) state.searchQueue = buildQueue();
  if (!state.rows) state.rows = loadJson(OUT, []);
  const byKey = new Map(state.rows.map((r) => [rowKey(r), r]));
  const cache = loadJson(CACHE, {});

  const deadline = Date.now() + MINUTES * 60 * 1000;
  console.log(
    `Halal web crawl: ${state.searchQueue.length} searches queued · ${state.urlQueue.length} URLs · ${byKey.size} rows`,
  );

  while (Date.now() < deadline) {
    if (state.searchQueue.length) {
      const item = state.searchQueue.shift();
      await runSearch(item, state);
      if ((Object.keys(state.searchesDone).length % 20) === 0) saveJson(STATE, state);
      continue;
    }
    if (!state.urlQueue.length) break;

    const item = state.urlQueue.shift();
    if (state.fetched[item.url]) continue;
    state.fetched[item.url] = 'ok';

    const row = await fetchPage(item, cache);
    if (row) byKey.set(rowKey(row), row);
    await sleep(300);

    if (byKey.size % 25 === 0) {
      state.rows = [...byKey.values()];
      saveJson(OUT, state.rows);
      saveJson(STATE, state);
      saveJson(CACHE, cache);
      console.log(`  ${byKey.size} rows · ${state.urlQueue.length} URLs left · ${state.searchQueue.length} searches left`);
    }
  }

  state.rows = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  saveJson(OUT, state.rows);
  saveJson(STATE, state);
  saveJson(CACHE, cache);
  console.log(`\nHalal web crawl paused: ${state.rows.length} restaurants → ${path.relative(ROOT, OUT)}`);

  if (DO_IMPORT) {
    require('child_process').execSync('node scripts/import-halal-all.cjs', { cwd: ROOT, stdio: 'inherit' });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
