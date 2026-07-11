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
const REDISCOVER = args.includes('--rediscover');
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

function loadSeenFromNdjson() {
  const seenUrl = new Set();
  const seenKey = new Set();
  if (!fs.existsSync(OUT_NDJSON)) return { seenUrl, seenKey };
  for (const line of fs.readFileSync(OUT_NDJSON, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      const url = (r.sourceUrl || '').split('?')[0];
      if (url) seenUrl.add(url);
      seenKey.add(`${(r.name || '').toLowerCase()}|${r.latitude}|${r.longitude}`);
    } catch {
      /* skip bad line */
    }
  }
  return { seenUrl, seenKey };
}

function filterNewRows(rows, seen) {
  const out = [];
  for (const r of rows) {
    const url = (r.sourceUrl || '').split('?')[0];
    const key = `${(r.name || '').toLowerCase()}|${r.latitude}|${r.longitude}`;
    if (url && seen.seenUrl.has(url)) continue;
    if (seen.seenKey.has(key)) continue;
    if (url) seen.seenUrl.add(url);
    seen.seenKey.add(key);
    out.push(r);
  }
  return out;
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
  const seen = loadSeenFromNdjson();
  st.rowCount = countNdjsonRows(OUT_NDJSON);
  const retryOnce = new Set();
  let pendingRows = [];
  let rowsAtLastImport = st.rowCount;
  let errors = 0;
  let batchNum = 0;
  let skippedDupes = 0;

  if (!st.queue.length) {
    if (st.rowCount > 0 && !REDISCOVER && !DISCOVER_ONLY) {
      console.log(`Zabihah crawl complete: ${st.rowCount} rows in ndjson.`);
      console.log('  Use --rediscover to re-scan sitemap for new listings.');
      console.log('  For venues BEYOND Zabihah: node scripts/crawl-halal-all.cjs --minutes=120 --extras-only');
      console.log('Compacting .ndjson → .json…');
      await compactNdjsonToJson(OUT);
      if (!SKIP_IMPORT) embedHalalPage();
      return;
    }
    const all = await discoverRestaurantUrls();
    const fresh = all.filter((u) => !seen.seenUrl.has(u.split('?')[0]));
    st.queue = REDISCOVER ? all : fresh.length ? fresh : all;
    st.discoveredAt = new Date().toISOString();
    console.log(
      `Discovered ${all.length} Zabihah URLs · ${fresh.length} not yet crawled · queue ${st.queue.length}`,
    );
    saveState(st);
    if (DISCOVER_ONLY) return;
  } else {
    console.log(
      `Resuming queue of ${st.queue.length} URLs (${st.fetched} fetched, ${st.rowCount} rows) · ${CONCURRENCY} parallel`,
    );
  }

  const beforePrune = st.queue.length;
  st.queue = st.queue.filter((u) => !seen.seenUrl.has(u.split('?')[0]));
  if (beforePrune !== st.queue.length) {
    console.log(`  Pruned ${beforePrune - st.queue.length} already-scraped URLs (${st.queue.length} fresh left)`);
    saveState(st);
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
        const [rowOnly] = filterNewRows([row], seen);
        if (rowOnly) {
          pendingRows.push(rowOnly);
          st.rowCount++;
        } else {
          skippedDupes++;
        }
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
  console.log(`  ${st.queue.length} URLs remaining · ${errors} fetch errors · ${skippedDupes} duplicate skips`);

  if (!SKIP_IMPORT && st.rowCount) embedHalalPage();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
