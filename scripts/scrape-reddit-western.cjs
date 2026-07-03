#!/usr/bin/env node
/**
 * Mine Reddit (Pullpush API) for explicit bidet/washlet venue mentions in US/UK/Canada.
 * Output: data/reddit-western-raw.json (candidates for manual curation).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '../data/reddit-western-raw.json');

const SUBREDDITS = [
  'AskNYC', 'nyc', 'chicago', 'LosAngeles', 'sanfrancisco', 'Seattle', 'Portland',
  'Austin', 'boston', 'philadelphia', 'pittsburgh', 'bayarea', 'toronto', 'vancouver',
  'montreal', 'Canada', 'unitedkingdom', 'london', 'travel', 'solotravel', 'bidets',
  'Hotels', 'FoodNYC', 'chicagofood', 'AskSF', 'AskLosAngeles', 'AskChicago',
];

const QUERIES = [
  'bidet restaurant',
  'washlet hotel',
  'bidet bathroom restaurant',
  'has a bidet',
  'toto bidet',
  'bidet toilet hotel',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'BidetBeaconResearch/1.0' } }, (res) => {
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

function extractVenues(body, subreddit, permalink) {
  const hits = [];
  const patterns = [
    /\*\*([^*]{4,70})\*\*/g,
    /(?:at|stayed at|went to|recommend)\s+([A-Z][A-Za-z0-9 '&.-]{3,55}(?:Hotel|Restaurant|Resort|Inn|Diner|Bar|Sushi|Ramen|Grill|Cafe|Lounge))/g,
    /([A-Z][A-Za-z0-9 '&.-]{3,50})\s+has\s+(?:a\s+)?bidets?/gi,
    /([A-Z][A-Za-z0-9 '&.-]{3,50})\s+has\s+(?:a\s+)?(?:japanese|toto|smart)\s+toilet/gi,
    /bidets?\s+in\s+(?:the\s+)?(?:bathrooms?\s+)?(?:at\s+)?([A-Z][A-Za-z0-9 '&.-]{3,50})/gi,
  ];
  for (const pat of patterns) {
    for (const m of body.matchAll(pat)) {
      const name = m[1].trim().replace(/\s+/g, ' ');
      if (name.length < 4 || name.length > 70) continue;
      if (/^(I|We|They|It|This|That|The|My|Your|Reddit|Google|Yelp)$/i.test(name)) continue;
      hits.push({ name, subreddit, permalink, snippet: body.slice(0, 280) });
    }
  }
  return hits;
}

function hasBidetEvidence(body) {
  return /bidet|washlet|toto (?:bidet|smart|toilet)|smart toilet|heated seat.*bidet|built.?in bidet|japanese toilet/i.test(
    body
  );
}

async function main() {
  const seen = new Map();

  for (const sub of SUBREDDITS) {
    for (const q of QUERIES) {
      const url =
        'https://api.pullpush.io/reddit/search/comment/?subreddit=' +
        encodeURIComponent(sub) +
        '&q=' +
        encodeURIComponent(q) +
        '&size=50';
      try {
        const j = await fetchJson(url);
        for (const c of j.data || []) {
          const body = c.body || '';
          if (!hasBidetEvidence(body)) continue;
          for (const hit of extractVenues(body, sub, c.permalink)) {
            const key = hit.name.toLowerCase();
            if (!seen.has(key)) seen.set(key, hit);
          }
        }
        await sleep(400);
      } catch (e) {
        console.warn('fail', sub, q, e.message);
      }
    }
  }

  const rows = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n');
  console.log('Wrote', rows.length, 'raw Reddit venue candidates to', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
