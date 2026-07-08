#!/usr/bin/env node
/**
 * Fix Zabihah halalStatus (full vs options).
 *
 *   node scripts/reclassify-zabihah.cjs --import              # parallel re-fetch (~3 min)
 *   node scripts/reclassify-zabihah.cjs --instant --import    # no network (<1 sec)
 *   node scripts/reclassify-zabihah.cjs --concurrency=20 --import
 */
const fs = require('fs');
const path = require('path');
const { fetchText, parseZabihahHtml, heuristicZabihahRow, mapPool } = require('./lib/halal-web.cjs');

const ROOT = path.join(__dirname, '..');
const IN = path.join(ROOT, 'data/zabihah-halal-restaurants.json');
const OUT = IN;

const args = process.argv.slice(2);
const DO_IMPORT = args.includes('--import');
const INSTANT = args.includes('--instant');
const concArg = args.find((a) => a.startsWith('--concurrency='));
const CONCURRENCY = concArg ? Number(concArg.split('=')[1]) : 15;

function countStatus(rows) {
  return {
    full: rows.filter((r) => r.halalStatus === 'full').length,
    options: rows.filter((r) => r.halalStatus === 'options').length,
  };
}

async function reclassifyFetch(rows) {
  const t0 = Date.now();
  let changed = 0;
  let errors = 0;
  let done = 0;
  const total = rows.length;

  console.log(`Re-fetching ${total} Zabihah pages (${CONCURRENCY} parallel)…`);

  const updated = await mapPool(
    rows,
    async (row) => {
      const url = row.sourceUrl;
      if (!url) {
        done++;
        return row;
      }
      try {
        const html = await fetchText(url);
        const parsed = parseZabihahHtml(html, url);
        if (!parsed) {
          done++;
          return row;
        }
        const before = row.halalStatus;
        const next = { ...row, ...parsed };
        if (before !== next.halalStatus) changed++;
        done++;
        if (done % 50 === 0 || done === total) {
          const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
          const pct = Math.round((done / total) * 100);
          process.stdout.write(`\r  ${done}/${total} (${pct}%) · ${changed} changed · ${errors} errors · ${elapsed}s`);
        }
        return next;
      } catch {
        errors++;
        done++;
        return row;
      }
    },
    { concurrency: CONCURRENCY },
  );

  console.log('');
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const { full, options } = countStatus(updated);
  console.log(
    `Reclassified ${rows.length} Zabihah rows in ${elapsed}s (${CONCURRENCY} parallel) · ${changed} status changes · ${errors} fetch errors`,
  );
  console.log(`  Fully halal: ${full} · Halal options: ${options}`);
  return updated;
}

function reclassifyInstant(rows) {
  let changed = 0;
  const updated = rows.map((row) => {
    const next = heuristicZabihahRow(row);
    if (next.halalStatus !== row.halalStatus) changed++;
    return next;
  });
  const { full, options } = countStatus(updated);
  console.log(`Heuristic reclassify: ${rows.length} rows · ${changed} status changes (no network)`);
  console.log(`  Fully halal: ${full} · Halal options: ${options}`);
  return updated;
}

async function main() {
  if (!fs.existsSync(IN)) {
    console.error('Missing', IN);
    process.exit(1);
  }
  const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const updated = INSTANT ? reclassifyInstant(rows) : await reclassifyFetch(rows);

  fs.writeFileSync(OUT, JSON.stringify(updated, null, 2) + '\n');

  if (DO_IMPORT) {
    require('child_process').execSync('node scripts/import-halal-all.cjs', { cwd: ROOT, stdio: 'inherit' });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
