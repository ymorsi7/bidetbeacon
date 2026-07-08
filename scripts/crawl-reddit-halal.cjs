#!/usr/bin/env node
/**
 * Mine Reddit for halal restaurant mentions (Pullpush API), geocode, save rows.
 *
 *   node scripts/crawl-reddit-halal.cjs
 *   node scripts/crawl-reddit-halal.cjs --import
 */
const fs = require('fs');
const path = require('path');
const {
  REDDIT_SUBREDDITS,
  REDDIT_QUERIES,
  fetchJson,
  sleep,
  extractRedditVenues,
  geocodeVenue,
  subredditMeta,
  countryCodeFromName,
  isHalalDefaultCountry,
  hasHalalEvidence,
} = require('./lib/halal-extra.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/halal-reddit-restaurants.json');
const CACHE = path.join(ROOT, 'data/halal-reddit-geocode-cache.json');

const args = process.argv.slice(2);
const DO_IMPORT = args.includes('--import');

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(c) {
  fs.writeFileSync(CACHE, JSON.stringify(c, null, 2) + '\n');
}

function rowKey(r) {
  return `${r.name.toLowerCase()}|${r.latitude}|${r.longitude}`;
}

async function main() {
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const byKey = new Map(existing.map((r) => [rowKey(r), r]));
  const cache = loadCache();
  let scraped = 0;
  let geocoded = 0;

  for (const sub of [...new Set(REDDIT_SUBREDDITS)]) {
    for (const q of REDDIT_QUERIES) {
      for (const kind of ['comment', 'submission']) {
        const url =
          `https://api.pullpush.io/reddit/search/${kind}/?subreddit=` +
          encodeURIComponent(sub) +
          '&q=' +
          encodeURIComponent(q) +
          '&size=100';
        try {
          const j = await fetchJson(url);
          for (const c of j.data || []) {
            const body = c.body || c.selftext || c.title || '';
            if (!hasHalalEvidence(body) && !/\bhalal\b/i.test(body)) continue;
            const permalink = c.permalink || c.url || '';
            for (const hit of extractRedditVenues(body, sub, permalink)) {
              scraped++;
              const meta = subredditMeta(sub);
              if (isHalalDefaultCountry(meta.country)) continue;
              const cc = countryCodeFromName(meta.country) || 'US';
              const geo = await geocodeVenue(
                { name: hit.name, address: '' },
                cc,
                meta.country,
                meta.city,
                cache,
              );
              if (!geo || !geo.latitude) continue;
              if (isHalalDefaultCountry(geo.country)) continue;

              const row = {
                name: hit.name,
                address: geo.address || '',
                latitude: geo.latitude,
                longitude: geo.longitude,
                city: geo.city || meta.city,
                country: geo.country || meta.country,
                halalStatus: hit.halalStatus,
                cuisine: '',
                sourceUrl: hit.permalink,
                sourceQuote: `Reddit r/${hit.subreddit}: ${hit.snippet.slice(0, 200)}`,
                verifiedMethod: 'web-source',
                source: 'reddit',
              };
              const k = rowKey(row);
              if (!byKey.has(k)) {
                byKey.set(k, row);
                geocoded++;
              }
            }
          }
          await sleep(400);
        } catch (e) {
          console.warn('Pullpush:', sub, q, kind, e.message);
          await sleep(800);
        }
      }
    }
  }

  saveCache(cache);
  const rows = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n');
  console.log(`Reddit halal: ${rows.length} restaurants (${geocoded} new · ${scraped} leads scanned)`);

  if (DO_IMPORT) {
    require('child_process').execSync('node scripts/import-halal-all.cjs', { cwd: ROOT, stdio: 'inherit' });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
