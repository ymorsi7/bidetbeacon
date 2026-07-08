#!/usr/bin/env node
/**
 * Crawl Zabihah.com restaurant sitemaps → venue pages with coords.
 * Resumable; parallel fetches (much faster than serial Crawl-delay).
 *
 *   node scripts/crawl-zabihah.cjs --minutes=120
 *   node scripts/crawl-zabihah.cjs --minutes=120 --concurrency=20
 *   node scripts/crawl-zabihah.cjs --minutes=120 --no-import          # fastest; import at end
 *   node scripts/crawl-zabihah.cjs --discover-only
 *
 * Output: data/zabihah-halal-restaurants.json
 * State:  data/zabihah-crawl-state.json
 */
const fs = require('fs');
const path = require('path');
const { fetchText, parseZabihahHtml, sleep, mapPool } = require('./lib/halal-web.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/zabihah-halal-restaurants.json');
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

function loadState() {
  if (!fs.existsSync(STATE)) {
    return { queue: [], done: {}, rows: [], discoveredAt: null };
  }
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}

function saveState(st) {
  fs.writeFileSync(STATE, JSON.stringify(st, null, 2) + '\n');
}

function saveRows(rows) {
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n');
}

function extractLocs(xml, pattern) {
  const re = new RegExp(`<loc>(${pattern}[^<]+)</loc>`, 'gi');
  const urls = [];
  let m;
  while ((m = re.exec(xml))) urls.push(m[1].trim());
  return urls;
}

function pullBatch(queue, done, size) {
  const batch = [];
  while (batch.length < size && queue.length) {
    const url = queue.shift();
    if (!done[url]) batch.push(url);
  }
  return batch;
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
  const st = loadState();

  if (!st.queue.length) {
    st.queue = await discoverRestaurantUrls();
    st.discoveredAt = new Date().toISOString();
    console.log(`Discovered ${st.queue.length} Zabihah restaurant URLs`);
    saveState(st);
    if (DISCOVER_ONLY) return;
  } else {
    console.log(
      `Resuming queue of ${st.queue.length} URLs (${Object.keys(st.done).length} done, ${st.rows.length} rows) · ${CONCURRENCY} parallel`,
    );
  }

  let batchNum = 0;
  let errors = 0;
  let rowsAtLastImport = st.rows.length;

  while (st.queue.length && Date.now() < deadline) {
    if (LIMIT && st.rows.length >= LIMIT) break;

    const batch = pullBatch(st.queue, st.done, CONCURRENCY);
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
      if (err) {
        st.done[url] = 'err';
        errors++;
      } else {
        st.done[url] = row ? 'ok' : 'skip';
        if (row) st.rows.push(row);
      }
    }

    batchNum++;
    const newRows = st.rows.length - rowsAtLastImport;
    if (batchNum % 5 === 0 || newRows >= IMPORT_EVERY) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      const rate = st.rows.length ? (st.rows.length / ((Date.now() - t0) / 60000)).toFixed(0) : '0';
      console.log(
        `  ${st.rows.length} rows · ${Object.keys(st.done).length} fetched · ${st.queue.length} left · ~${rate}/min · ${elapsed}s`,
      );
      saveState(st);
      saveRows(st.rows);
      if (IMPORT_EVERY && newRows >= IMPORT_EVERY) {
        embedHalalPage();
        rowsAtLastImport = st.rows.length;
      }
    }
  }

  saveState(st);
  saveRows(st.rows);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nZabihah crawl paused in ${elapsed}s: ${st.rows.length} restaurants → ${path.relative(ROOT, OUT)}`);
  console.log(`  ${st.queue.length} URLs remaining · ${errors} fetch errors`);

  if (!SKIP_IMPORT && st.rows.length) embedHalalPage();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
