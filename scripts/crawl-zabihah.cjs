#!/usr/bin/env node
/**
 * Crawl Zabihah.com restaurant sitemaps → venue pages with coords.
 * Resumable; parallel fetches (much faster than serial Crawl-delay).
 *
 * Rows stream to data/zabihah-halal-restaurants.ndjson (append-only) so crawls
 * do not OOM re-stringifying a 30k+ JSON array. State keeps queue only (no
 * per-URL "done" map — that grew to ~4 MB and blew the heap).
 *
 *   node scripts/crawl-zabihah.cjs --minutes=120
 *   node scripts/crawl-zabihah.cjs --minutes=120 --concurrency=20
 *   node scripts/crawl-zabihah.cjs --minutes=120 --no-import
 *   node scripts/crawl-zabihah.cjs --discover-only
 *
 * Output: data/zabihah-halal-restaurants.ndjson (+ .json compacted at end)
 * State:  data/zabihah-crawl-state.json
 */
const fs = require('fs');
const path = require('path');
const {
  fetchText,
  parseZabihahHtml,
  sleep,
  mapPool,
  ndjsonPath,
  countNdjsonRows,
  appendVenueRows,
  compactNdjsonToJson,
} = require('./lib/halal-web.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/zabihah-halal-restaurants.json');
const OUT_NDJSON = ndjsonPath(OUT);
const STATE = path.join(ROOT, 'data/zabihah-crawl-state.json');
const SITEMAP_INDEX = 'https://www.zabihah.com/sitemap.xml';
const SHARDS = [...Array.from({ length: 10 }, (_, i) => i), 1000, 1001, 1002];

const args = process.argv.slice(2);
const minutesArg = args.find((a) => a.startsWith('--minutes='));
const MINUTES = minutesArg ? Number(minutesArg.split('=')[1]) : 90;
const DISCOVER_ONLY = args.includes('--discover-only');
const SKIP_IMPORT = args.includes('--no-import');
const LIMIT_ARG = args.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : 0;
const concArg = args.find((a) => a.startsWith('--concurrency='));
const CONCURRENCY = concArg ? Number(concArg.split('=')[1]) : 15;
const importEveryArg = args.find((a) => a.startsWith('--import-every='));
const IMPORT_EVERY = SKIP_IMPORT ? 0 : importEveryArg ? Number(importEveryArg.split('=')[1]) : 100;

function migrateJsonToNdjson() {
  if (fs.existsSync(OUT_NDJSON) || !fs.existsSync(OUT)) return countNdjsonRows(OUT_NDJSON);
  console.log('Migrating existing zabihah-halal-restaurants.json → .ndjson (one-time)…');
  const rows = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  appendVenueRows(OUT, rows);
  fs.renameSync(OUT, OUT + '.bak');
  console.log(`  ${rows.length} rows migrated`);
  return rows.length;
}

function loadState() {
  if (!fs.existsSync(STATE)) {
    return { queue: [], discoveredAt: null, rowCount: 0, fetched: 0 };
  }
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  delete st.rows;
  delete st.done;
  st.queue = [...new Set(st.queue || [])];
  st.rowCount = st.rowCount || countNdjsonRows(OUT_NDJSON);
  st.fetched = st.fetched || 0;
  return st;
}

function saveState(st) {
  const slim = {
    queue: st.queue,
    discoveredAt: st.discoveredAt,
    rowCount: st.rowCount,
    fetched: st.fetched,
  };
  fs.writeFileSync(STATE, JSON.stringify(slim) + '\n');
}

function extractLocs(xml, pattern) {
  const re = new RegExp(`<loc>(${pattern}[^<]+)</loc>`, 'gi');
  const urls = [];
  let m;
  while ((m = re.exec(xml))) urls.push(m[1].trim());
  return urls;
}

function pullBatch(queue, size) {
  return queue.splice(0, size);
}

async function discoverRestaurantUrls() {
  console.log('Fetching Zabihah sitemap index…');
  const index = await fetchText(SITEMAP_INDEX);
  const shardUrls = extractLocs(index, 'https://www\\.zabihah\\.com/sitemap/[^<]+');
  const shards = shardUrls.length ? shardUrls : SHARDS.map((n) => `https://www.zabihah.com/sitemap/${n}.xml`);
  const all = new Set();
  for (const shardUrl of shards) {
    process.stdout.write(`  shard ${shardUrl.split('/').pop()}… `);
    try {
      const xml = await fetchText(shardUrl);
      const urls = extractLocs(xml, 'https://www\\.zabihah\\.com/restaurants/[^<]+');
      urls.forEach((u) => all.add(u.split('?')[0]));
      console.log(urls.length, 'restaurants');
    } catch (e) {
      console.log('ERR', e.message);
    }
    await sleep(500);
  }
  return [...all];
}

function embedHalalPage() {
  require('child_process').execSync('node scripts/import-halal-all.cjs', { cwd: ROOT, stdio: 'inherit' });
}

async function fetchVenue(url) {
  const html = await fetchText(url);
  return parseZabihahHtml(html, url);
}

async function main() {
  const t0 = Date.now();
  const deadline = Date.now() + MINUTES * 60 * 1000;
  migrateJsonToNdjson();
  const st = loadState();
  const retryOnce = new Set();
  let pendingRows = [];
  let rowsAtLastImport = st.rowCount;
  let errors = 0;
  let batchNum = 0;

  if (!st.queue.length) {
    st.queue = await discoverRestaurantUrls();
    st.discoveredAt = new Date().toISOString();
    console.log(`Discovered ${st.queue.length} Zabihah restaurant URLs`);
    saveState(st);
    if (DISCOVER_ONLY) return;
  } else {
    console.log(
      `Resuming queue of ${st.queue.length} URLs (${st.fetched} fetched, ${st.rowCount} rows) · ${CONCURRENCY} parallel`,
    );
  }

  while (st.queue.length && Date.now() < deadline) {
    if (LIMIT && st.rowCount >= LIMIT) break;

    const batch = pullBatch(st.queue, CONCURRENCY);
    if (!batch.length) continue;

    const results = await mapPool(
      batch,
      async (url) => {
        try {
          const row = await fetchVenue(url);
          return { url, row, err: null };
        } catch (e) {
          return { url, row: null, err: e };
        }
      },
      { concurrency: CONCURRENCY },
    );

    for (const { url, row, err } of results) {
      st.fetched++;
      if (err) {
        errors++;
        if (!retryOnce.has(url)) {
          retryOnce.add(url);
          st.queue.push(url);
        }
      } else if (row) {
        pendingRows.push(row);
        st.rowCount++;
      }
    }

    batchNum++;
    const newRows = st.rowCount - rowsAtLastImport;
    if (batchNum % 20 === 0 || pendingRows.length >= 50) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      const rate = st.rowCount ? (st.rowCount / ((Date.now() - t0) / 60000)).toFixed(0) : '0';
      console.log(
        `  ${st.rowCount} rows · ${st.fetched} fetched · ${st.queue.length} left · ~${rate}/min · ${elapsed}s`,
      );
      appendVenueRows(OUT, pendingRows);
      pendingRows = [];
      saveState(st);
      if (IMPORT_EVERY && newRows >= IMPORT_EVERY) {
        embedHalalPage();
        rowsAtLastImport = st.rowCount;
      }
    }
  }

  if (pendingRows.length) appendVenueRows(OUT, pendingRows);
  saveState(st);

  console.log('Compacting .ndjson → .json…');
  const compacted = await compactNdjsonToJson(OUT);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nZabihah crawl paused in ${elapsed}s: ${compacted || st.rowCount} restaurants → ${path.relative(ROOT, OUT)}`);
  console.log(`  ${st.queue.length} URLs remaining · ${errors} fetch errors`);

  if (!SKIP_IMPORT && st.rowCount) embedHalalPage();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
