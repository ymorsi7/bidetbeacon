#!/usr/bin/env node
/**
 * Long-running global bidet crawler — non-friendly countries only.
 *
 * Cycles: Atly sitemap discovery → list pages → location deep scan → Reddit intl.
 * Checkpointed; safe to stop/resume.
 *
 * Usage:
 *   node scripts/crawl-global-bidets.cjs --hours=6
 *   node scripts/crawl-global-bidets.cjs --hours=2 --import
 *
 * Output: data/global-crawler-bidets.json
 * State:  data/global-crawl-state.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { isFriendlyCountry, isFriendlyAtlyUrl, normalizeCountry } = require('./lib/non-friendly-countries.cjs');

const OUT = path.join(__dirname, '../data/global-crawler-bidets.json');
const STATE = path.join(__dirname, '../data/global-crawl-state.json');
const REDDIT_RAW = path.join(__dirname, '../data/global-crawler-reddit-raw.json');

const BIDET_RE =
  /\bbidet(s|\s+toilet|\s+attachment|\s+hand\s+shower|\s+functions?|-style|\s+and\s+wudu)?\b|\bbid[eé]\b|\bwashlet\b|\btoto[\s®™]*\s*(toilet|bidet|washlet|smart)?\b|\b(toilet|bathroom|baño)[^.\n]{0,40}\btoto\b|\bshattaf\b|\bhandheld sprayer\b|\bhand shower\b|\bjapanese toilet\b|\binodoro\s+(japon[eé]s|inteligente|autom[aá]tico)\b|\basiento\s+t[eé]rmico\b|\bducha\s+de\s+mano\b|\belectronic\s+bidet\b|\bheated\s+toilet[^.\n]{0,40}bidet/i;

const ATLY_SITEMAPS = [
  ...Array.from({ length: 5 }, (_, i) => `https://www.atly.com/static/sitemaps/gfe-steps-sitemap-${i}.xml`),
  ...Array.from({ length: 4 }, (_, i) => `https://www.atly.com/static/sitemaps/top-steps-sitemap-${i}.xml`),
];

const REDDIT_SUBS = [
  'AskUK', 'london', 'unitedkingdom', 'paris', 'france', 'berlin', 'germany', 'AskGermany',
  'sydney', 'australia', 'melbourne', 'toronto', 'askTO', 'vancouver', 'montreal',
  'mexicocity', 'Monterrey', 'Cancun', 'bogota', 'colombia', 'medellin',
  'vzla', 'caracas', 'venezuela', 'singapore', 'hongkong', 'China',
  'Moscow', 'russia', 'amsterdam', 'Netherlands', 'Zurich', 'austria',
  'AskNYC', 'LosAngeles', 'chicago', 'Seattle', 'boston', 'travel', 'solotravel', 'bidets',
];

/** Non-friendly country slugs for Atly URL discovery + probes. */
const NON_FRIENDLY_SLUGS = [
  'united-states', 'usa', 'canada', 'mexico', 'united-kingdom', 'uk', 'france', 'germany',
  'australia', 'netherlands', 'switzerland', 'austria', 'ireland', 'belgium', 'sweden',
  'norway', 'denmark', 'poland', 'czech-republic', 'hungary', 'romania', 'russia', 'china',
  'singapore', 'hong-kong', 'new-zealand', 'south-africa', 'israel', 'colombia', 'venezuela',
  'chile', 'peru', 'ecuador', 'costa-rica', 'panama', 'jamaica', 'cuba', 'dominican-republic',
];

const ATLY_CATS = [
  'best-bathroom-restaurant',
  'best-bathroom-coffee',
  'best-bathroom-hotel',
  'best-bathroom-halal',
  'best-bathroom-gluten-free',
  'best-bathroom-fine-dining',
  'best-bathroom-vegan-friendly',
  'best-bathroom-food',
  'best-bathroom-dinner-spots',
];

const ATLY_CITIES = {
  'united-states': ['new-york', 'los-angeles', 'chicago', 'san-francisco', 'seattle', 'boston', 'miami', 'austin', 'denver', 'portland'],
  'united-kingdom': ['london', 'manchester', 'edinburgh', 'birmingham', 'glasgow', 'bristol'],
  canada: ['toronto', 'vancouver', 'montreal', 'calgary', 'ottawa'],
  mexico: ['mexico-city', 'cancun', 'guadalajara', 'monterrey', 'puerto-vallarta'],
  france: ['paris', 'lyon', 'marseille', 'nice', 'bordeaux'],
  germany: ['berlin', 'munich', 'hamburg', 'frankfurt', 'cologne'],
  australia: ['sydney', 'melbourne', 'brisbane', 'perth'],
  netherlands: ['amsterdam', 'rotterdam', 'the-hague'],
  colombia: ['bogota', 'medellin', 'cali', 'cartagena'],
  venezuela: ['caracas', 'maracaibo', 'valencia'],
  china: ['beijing', 'shanghai', 'shenzhen', 'guangzhou'],
  russia: ['moscow', 'saint-petersburg'],
};

const PROBE_URLS = [];
for (const country of NON_FRIENDLY_SLUGS) {
  for (const cat of ATLY_CATS) PROBE_URLS.push(`https://www.atly.com/${country}/${cat}`);
  for (const city of ATLY_CITIES[country] || []) {
    for (const cat of ATLY_CATS) PROBE_URLS.push(`https://www.atly.com/${country}/${city}/${cat}`);
  }
}
for (const country of NON_FRIENDLY_SLUGS) {
  PROBE_URLS.push(`https://www.atly.com/best/gluten-free/${country}`);
  PROBE_URLS.push(`https://www.atly.com/best/halal/hotel-${country}`);
}

const args = process.argv.slice(2);
const hoursArg = args.find((a) => a.startsWith('--hours='));
const HOURS = hoursArg ? Number(hoursArg.split('=')[1]) : 6;
const DO_IMPORT = args.includes('--import');

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
            'User-Agent': 'BidetBud/1.0 (global-crawler)',
            'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const next = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, url).href;
            fetchText(next).then(resolve).catch(reject);
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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'BidetBud/1.0 (global-crawler)' } }, (res) => {
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

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return {
      listQueue: [],
      slugQueue: [],
      processedLists: {},
      processedLocs: {},
      processedSlugs: {},
      stats: { lists: 0, locations: 0, reddit: 0, discovered: 0, added: 0 },
      startedAt: new Date().toISOString(),
    };
  }
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
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

function mergeRow(rows, row) {
  const key = `${row.name}|${row.country}|${Number(row.latitude).toFixed(5)}|${Number(row.longitude).toFixed(5)}`;
  const map = new Map(rows.map((r) => [`${r.name}|${r.country}|${Number(r.latitude).toFixed(5)}|${Number(r.longitude).toFixed(5)}`, r]));
  if (!map.has(key)) map.set(key, row);
  return [...map.values()];
}

function stripHtml(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanQuote(raw) {
  let q = stripHtml(raw);
  q = q.replace(/^\W+|\W+$/g, '');
  if (q.length > 280) q = q.slice(0, 277) + '…';
  return q;
}

function quoteFromWindow(window) {
  let quote = '';
  const bathPara = window.match(
    /editorial-section-label-v2">(?:Bathroom|Baño)<\/div><p>([\s\S]*?)<\/p>/i
  );
  if (bathPara && BIDET_RE.test(bathPara[1])) quote = cleanQuote(bathPara[1]);
  if (!quote) {
    const stmt = window.match(/statement-content"><p>&quot;([\s\S]*?)&quot;<\/p>/i);
    if (stmt && BIDET_RE.test(stmt[1])) quote = cleanQuote(stmt[1]);
  }
  if (!quote) {
    const blurb = window.match(/"blurb":"([^"]{20,400})"/);
    if (blurb && BIDET_RE.test(blurb[1])) quote = cleanQuote(blurb[1]);
  }
  if (!quote) {
    const idx = window.search(BIDET_RE);
    if (idx >= 0) quote = cleanQuote(window.slice(Math.max(0, idx - 60), idx + 180));
  }
  return quote && BIDET_RE.test(quote) ? quote : '';
}

function extractBidetCandidates(html, listUrl) {
  const candidates = new Map();
  function add(window, url) {
    if (candidates.has(url)) return;
    if (!BIDET_RE.test(window)) return;
    const quote = quoteFromWindow(window);
    if (!quote) return;
    candidates.set(url, { url, quote, listUrl });
  }
  const slugRe = /\/location\/([A-Za-z0-9_-]+)/g;
  let m;
  while ((m = slugRe.exec(html))) {
    const url = `https://www.atly.com/location/${m[1]}`;
    const start = Math.max(0, m.index - 4000);
    const end = Math.min(html.length, m.index + 20000);
    add(html.slice(start, end), url);
  }
  const walk = new RegExp(BIDET_RE.source, 'gi');
  let bm;
  while ((bm = walk.exec(html))) {
    const w = html.slice(Math.max(0, bm.index - 12000), Math.min(html.length, bm.index + 12000));
    const sm = w.match(/\/location\/([A-Za-z0-9_-]+)/);
    if (!sm) continue;
    add(w, `https://www.atly.com/location/${sm[1]}`);
  }
  return [...candidates.values()];
}

function extractSlugs(html) {
  return [...new Set([...html.matchAll(/\/location\/([A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
}

function quoteFromLocationHtml(html) {
  const bathPara = html.match(
    /editorial-section-label-v2">(?:Bathroom|Baño)<\/div><p>([\s\S]*?)<\/p>/i
  );
  if (bathPara && BIDET_RE.test(bathPara[1])) return cleanQuote(bathPara[1]);
  const idx = html.search(BIDET_RE);
  if (idx >= 0) return cleanQuote(html.slice(Math.max(0, idx - 80), idx + 200));
  return '';
}

function parseLocationPage(html, locUrl, listUrl, quote) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const country = normalizeCountry(j.address?.addressCountry);
  if (!country || isFriendlyCountry(country)) return null;
  const lat = j.geo?.latitude;
  const lon = j.geo?.longitude;
  if (lat == null || lon == null) return null;

  const finalQuote = quote || quoteFromLocationHtml(html);
  if (!finalQuote || !BIDET_RE.test(finalQuote)) return null;

  const addr = j.address || {};
  const street = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
    .filter(Boolean)
    .join(', ');
  const city = [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ');
  const schemaType = String(j['@type'] || '').toLowerCase();
  let type = 'restaurant';
  if (/hotel|lodging|resort|motel|inn/.test(schemaType + ' ' + j.name)) type = 'hotel';

  return {
    name: j.name,
    address: street,
    latitude: String(lat),
    longitude: String(lon),
    city,
    country,
    type,
    bidetStatus: 'internet',
    bidetType: /toto|washlet|japon[eé]s|inteligente/i.test(finalQuote) ? 'TOTO / washlet bidet' : 'Bidet',
    sourceUrl: j.url || locUrl,
    sourceQuote: `Atly global crawl: ${finalQuote}`,
    verifiedMethod: 'web-source',
    access: type === 'hotel' ? 'limited' : 'public',
    ...(type === 'hotel' ? { accessNote: 'Hotel guests' } : {}),
  };
}

function isNonFriendlyListUrl(url) {
  if (isFriendlyAtlyUrl(url)) return false;
  if (url.includes('/location/')) return false;
  const path = url.replace('https://www.atly.com/', '').toLowerCase();
  if (/\/(best-|best\/|gluten-free|halal|bathroom)/i.test(path)) return true;
  return NON_FRIENDLY_SLUGS.some((slug) => path.startsWith(`${slug}/`) || path.includes(`/${slug}/`));
}

async function discoverAtlyLists(state) {
  const known = new Set(state.listQueue);
  let added = 0;

  for (const u of PROBE_URLS) {
    if (state.processedLists[u] || known.has(u)) continue;
    known.add(u);
    state.listQueue.push(u);
    added++;
  }

  for (const sm of ATLY_SITEMAPS) {
    try {
      const xml = await fetchText(sm);
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const u = m[1];
        if (!u.startsWith('https://www.atly.com/')) continue;
        if (!isNonFriendlyListUrl(u)) continue;
        if (state.processedLists[u]) continue;
        if (known.has(u)) continue;
        known.add(u);
        state.listQueue.push(u);
        added++;
      }
      await sleep(150);
    } catch (e) {
      console.warn('Sitemap fail:', sm, e.message);
    }
  }
  state.stats.discovered += added;
  console.log(`Discover: +${added} list URLs (queue ${state.listQueue.length})`);
}

async function processListBatch(state, rows, batchSize = 15) {
  let added = 0;
  const batch = state.listQueue.splice(0, batchSize);
  for (const listUrl of batch) {
    if (state.processedLists[listUrl]) continue;
    state.processedLists[listUrl] = Date.now();
    try {
      const html = await fetchText(listUrl);
      if (html.length < 8000 || html.includes('Page not found')) continue;
      for (const c of extractBidetCandidates(html, listUrl)) {
        if (!state.processedLocs[c.url]) {
          await processLocation(state, rows, c);
          added++;
        }
      }
      for (const slug of extractSlugs(html)) {
        if (!state.processedSlugs[slug]) state.slugQueue.push(slug);
      }
      state.stats.lists++;
      await sleep(200);
    } catch (e) {
      console.warn('List fail:', listUrl, e.message);
    }
  }
  return added;
}

async function processLocation(state, rows, cand) {
  const key = cand.url.replace(/\/$/, '');
  if (state.processedLocs[key]) return false;
  state.processedLocs[key] = Date.now();
  try {
    const html = await fetchText(cand.url);
    const row = parseLocationPage(html, cand.url, cand.listUrl, cand.quote);
    await sleep(180);
    if (!row) return false;
    const merged = mergeRow(rows, row);
    rows.length = 0;
    rows.push(...merged);
    state.stats.locations++;
    state.stats.added++;
    console.log(`+ [${row.country}] ${row.name}`);
    saveOut(rows);
    return true;
  } catch (e) {
    console.warn('Loc fail:', cand.url, e.message);
    return false;
  }
}

async function deepScanSlugBatch(state, rows, batchSize = 40) {
  const batch = state.slugQueue.splice(0, batchSize);
  for (const slug of batch) {
    if (state.processedSlugs[slug]) continue;
    state.processedSlugs[slug] = Date.now();
    const url = `https://www.atly.com/location/${slug}`;
    if (state.processedLocs[url]) continue;
    await processLocation(state, rows, { url, listUrl: 'deep-scan', quote: '' });
    await sleep(150);
  }
}

async function redditBatch(state, rows) {
  const queries = ['bidet', 'washlet', 'toto toilet', 'japanese toilet'];
  const raw = fs.existsSync(REDDIT_RAW) ? JSON.parse(fs.readFileSync(REDDIT_RAW, 'utf8')) : [];
  const seen = new Set(raw.map((r) => `${r.name}|${r.subreddit}`.toLowerCase()));
  let added = 0;

  for (const sub of REDDIT_SUBS) {
    for (const q of queries) {
      const url = `https://api.pullpush.io/reddit/search/comment/?subreddit=${encodeURIComponent(sub)}&q=${encodeURIComponent(q)}&size=50`;
      try {
        const data = await fetchJson(url);
        for (const c of data.data || []) {
          const body = c.body || '';
          if (!BIDET_RE.test(body)) continue;
          const m = body.match(/(?:at|went to|stayed at|recommend)\s+([A-Z][A-Za-z0-9 '&./-]{3,55})/i);
          if (!m) continue;
          const name = m[1].trim();
          const key = `${name}|${sub}`.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          raw.push({
            name,
            subreddit: sub,
            permalink: c.permalink?.startsWith('http') ? c.permalink : `https://reddit.com${c.permalink}`,
            snippet: body.replace(/\s+/g, ' ').slice(0, 280),
          });
          added++;
        }
        await sleep(400);
      } catch {
        /* skip */
      }
    }
  }
  fs.writeFileSync(REDDIT_RAW, JSON.stringify(raw, null, 2) + '\n');
  state.stats.reddit += added;
  if (added) console.log(`Reddit raw: +${added} leads (total ${raw.length})`);
}

function runImport() {
  const { execFileSync } = require('child_process');
  try {
    execFileSync('node', [path.join(__dirname, 'import-global-crawler.cjs')], { stdio: 'inherit' });
  } catch (e) {
    console.warn('Import failed:', e.message);
  }
}

async function main() {
  const endTime = Date.now() + HOURS * 3600 * 1000;
  const state = loadState();
  let rows = loadOut();
  let cycle = 0;

  console.log(`Global crawler starting — ${HOURS}h, non-friendly countries only`);
  console.log(`Output: ${OUT}`);
  console.log(`Existing rows: ${rows.length}, list queue: ${state.listQueue.length}, slug queue: ${state.slugQueue.length}`);

  while (Date.now() < endTime) {
    cycle++;
    console.log(`\n=== Cycle ${cycle} ===`);

    await discoverAtlyLists(state);
    await processListBatch(state, rows, 20);
    await deepScanSlugBatch(state, rows, 50);
    if (cycle % 2 === 0) await redditBatch(state, rows);

    saveState(state);
    console.log(
      `Stats: lists=${state.stats.lists} locs=${state.stats.locations} added=${state.stats.added} ` +
        `queue=${state.listQueue.length} slugs=${state.slugQueue.length}`
    );

    if (DO_IMPORT && cycle % 3 === 0) runImport();
    await sleep(500);
  }

  saveState(state);
  saveOut(rows);
  console.log(`\nDone after ${cycle} cycles. Total rows: ${rows.length}`);
  if (DO_IMPORT) runImport();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
