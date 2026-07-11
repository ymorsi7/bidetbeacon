#!/usr/bin/env node
/**
 * Bulk-extract Zabihah venues from subregion + city listing pages (~50–100 venues/page).
 * Much higher yield than re-fetching individual restaurant URLs already in the sitemap crawl.
 *
 *   node scripts/crawl-zabihah-listings.cjs --minutes=60
 *   node scripts/crawl-zabihah-listings.cjs --minutes=60 --no-import
 *   node scripts/crawl-zabihah-listings.cjs --discover-only
 *
 * Output: data/zabihah-halal-restaurants.ndjson (same file as crawl-zabihah.cjs)
 * State:  data/zabihah-listings-crawl-state.json
 */
const fs = require('fs');
const path = require('path');
const {
  fetchText,
  parseZabihahListingHtml,
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
const STATE = path.join(ROOT, 'data/zabihah-listings-crawl-state.json');
const SITEMAP_INDEX = 'https://www.zabihah.com/sitemap.xml';

const args = process.argv.slice(2);
const minutesArg = args.find((a) => a.startsWith('--minutes='));
const MINUTES = minutesArg ? Number(minutesArg.split('=')[1]) : 60;
const DISCOVER_ONLY = args.includes('--discover-only');
const REDISCOVER = args.includes('--rediscover');
const SKIP_IMPORT = args.includes('--no-import');
const concArg = args.find((a) => a.startsWith('--concurrency='));
const CONCURRENCY = concArg ? Number(concArg.split('=')[1]) : 8;

function loadState() {
  if (!fs.existsSync(STATE)) {
    return { queue: [], discoveredAt: null, rowCount: 0, pagesDone: 0 };
  }
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  st.queue = [...new Set(st.queue || [])];
  st.rowCount = st.rowCount || countNdjsonRows(OUT_NDJSON);
  st.pagesDone = st.pagesDone || 0;
  return st;
}

function saveState(st) {
  fs.writeFileSync(
    STATE,
    JSON.stringify({
      queue: st.queue,
      discoveredAt: st.discoveredAt,
      rowCount: st.rowCount,
      pagesDone: st.pagesDone,
    }) + '\n',
  );
}

function extractLocs(xml, pattern) {
  const re = new RegExp(`<loc>(${pattern}[^<]+)</loc>`, 'gi');
  const urls = [];
  let m;
  while ((m = re.exec(xml))) urls.push(m[1].trim());
  return urls;
}

function loadSeen() {
  const seenUrl = new Set();
  const seenId = new Set();
  if (!fs.existsSync(OUT_NDJSON)) return { seenUrl, seenId };
  for (const line of fs.readFileSync(OUT_NDJSON, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      const url = (r.sourceUrl || '').split('?')[0];
      if (url) seenUrl.add(url);
      const id = url.match(/\/restaurants\/([0-9a-f-]{36})\//i)?.[1];
      if (id) seenId.add(id);
    } catch {
      /* skip */
    }
  }
  return { seenUrl, seenId };
}

function filterNewRows(rows, seen) {
  const out = [];
  for (const r of rows) {
    const url = (r.sourceUrl || '').split('?')[0];
    const id = url.match(/\/restaurants\/([0-9a-f-]{36})\//i)?.[1];
    if (id && seen.seenId.has(id)) continue;
    if (url && seen.seenUrl.has(url)) continue;
    if (id) seen.seenId.add(id);
    if (url) seen.seenUrl.add(url);
    out.push(r);
  }
  return out;
}

async function discoverListingUrls() {
  console.log('Fetching Zabihah sitemap for listing pages…');
  const index = await fetchText(SITEMAP_INDEX);
  const shardUrls = extractLocs(index, 'https://www\\.zabihah\\.com/sitemap/[^<]+');
  const all = new Set();
  for (const shardUrl of shardUrls) {
    process.stdout.write(`  shard ${shardUrl.split('/').pop()}… `);
    try {
      const xml = await fetchText(shardUrl);
      extractLocs(xml, 'https://www\\.zabihah\\.com/subregion/[^<]+').forEach((u) => all.add(u.split('?')[0]));
      extractLocs(xml, 'https://www\\.zabihah\\.com/halal-restaurants/[^<]+').forEach((u) => all.add(u.split('?')[0]));
      console.log('ok');
    } catch (e) {
      console.log('ERR', e.message);
    }
    await sleep(400);
  }
  return [...all];
}

function embedHalalPage() {
  require('child_process').execSync('node scripts/import-halal-all.cjs', { cwd: ROOT, stdio: 'inherit' });
}

async function main() {
  const t0 = Date.now();
  const deadline = Date.now() + MINUTES * 60 * 1000;
  const st = loadState();
  const seen = loadSeen();
  st.rowCount = countNdjsonRows(OUT_NDJSON);
  let pendingRows = [];
  let pagesAtStart = st.pagesDone;

  if (!st.queue.length) {
    if (st.pagesDone > 0 && !REDISCOVER && !DISCOVER_ONLY) {
      console.log(`Zabihah listings crawl complete: ${st.pagesDone} pages, ${st.rowCount} total rows.`);
      console.log('Compacting .ndjson → .json…');
      await compactNdjsonToJson(OUT);
      if (!SKIP_IMPORT) embedHalalPage();
      return;
    }
    const all = await discoverListingUrls();
    st.queue = REDISCOVER ? all : all;
    st.discoveredAt = new Date().toISOString();
    console.log(`Discovered ${all.length} Zabihah listing pages (subregion + city)`);
    saveState(st);
    if (DISCOVER_ONLY) return;
  } else {
    console.log(`Resuming ${st.queue.length} listing pages (${st.pagesDone} done, ${st.rowCount} rows) · ${CONCURRENCY} parallel`);
  }

  while (st.queue.length && Date.now() < deadline) {
    const batch = st.queue.splice(0, CONCURRENCY);
    const results = await mapPool(
      batch,
      async (url) => {
        try {
          const html = await fetchText(url);
          const rows = parseZabihahListingHtml(html, url);
          return { url, rows, err: null };
        } catch (e) {
          return { url, rows: [], err: e };
        }
      },
      { concurrency: CONCURRENCY },
    );

    for (const { url, rows, err } of results) {
      st.pagesDone++;
      if (err) {
        st.queue.push(url);
        continue;
      }
      const fresh = filterNewRows(rows, seen);
      if (fresh.length) {
        pendingRows.push(...fresh);
        st.rowCount += fresh.length;
      }
    }

    if (st.pagesDone % 10 === 0 || pendingRows.length >= 200) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      const pagesThisRun = st.pagesDone - pagesAtStart;
      const rate = pagesThisRun ? (pagesThisRun / ((Date.now() - t0) / 60000)).toFixed(1) : '0';
      console.log(
        `  ${st.pagesDone} pages · ${st.rowCount} rows · +${pendingRows.length} pending · ${st.queue.length} left · ~${rate} pg/min · ${elapsed}s`,
      );
      if (pendingRows.length) {
        appendVenueRows(OUT, pendingRows);
        pendingRows = [];
      }
      saveState(st);
    }
  }

  if (pendingRows.length) appendVenueRows(OUT, pendingRows);
  saveState(st);

  console.log('Compacting .ndjson → .json…');
  await compactNdjsonToJson(OUT);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\nZabihah listings paused in ${elapsed}s: ${st.rowCount} rows · ${st.queue.length} pages remaining`,
  );
  if (!SKIP_IMPORT && st.rowCount) embedHalalPage();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
