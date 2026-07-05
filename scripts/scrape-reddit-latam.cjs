#!/usr/bin/env node
/**
 * Reddit Pullpush scrape for Mexico, Colombia, Venezuela bidet mentions.
 * Output: data/reddit-latam-raw.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '../data/reddit-latam-raw.json');

const SUBREDDITS = [
  'mexicocity', 'Monterrey', 'Cancun', 'guadalajara', 'Puebla', 'Tijuana',
  'Colombia', 'bogota', 'medellin', 'cali', 'Cartagena',
  'vzla', 'caracas', 'maracaibo', 'venezuela',
  'latam', 'LatinAmerica', 'expats', 'digitalnomad',
  'bidets', 'travel', 'solotravel',
];

const QUERIES = [
  'bidet', 'bidé', 'washlet', 'toto toilet', 'inodoro japonés', 'shattaf',
  'bidet restaurant', 'bidet hotel', 'ducha de mano',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'BidetBudResearch/1.0' } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(data.slice(0, 120)));
          }
        });
      })
      .on('error', reject);
  });
}

function hasBidetEvidence(body) {
  return /bidet|bid[eé]|washlet|toto (?:bidet|smart|toilet)|smart toilet|japanese toilet|inodoro japon[eé]s|shattaf|ducha de mano|manguera/i.test(
    body
  );
}

function extractVenues(body, subreddit, permalink) {
  const hits = [];
  const seen = new Set();
  const patterns = [
    /\*\*([^*]{4,70})\*\*/g,
    /(?:at|went to|try|recommend|stayed at|ate at|comí en|fui a)\s+([A-ZÁÉÍÓÚÑ][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ '&./-]{3,60})/g,
    /([A-ZÁÉÍÓÚÑ][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ '&./-]{3,55})\s+has\s+(?:a\s+)?bidets?/gi,
    /([A-ZÁÉÍÓÚÑ][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ '&./-]{3,55})(?:'s)?\s+(?:restroom|bathroom|baño)s?\s+(?:have|tiene)\s+bidets?/gi,
    /(?:hotel|restaurant|restaurante|café|cafe)\s+([A-ZÁÉÍÓÚÑ][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ '&./-]{3,55})/gi,
  ];
  for (const pat of patterns) {
    for (const m of body.matchAll(pat)) {
      let name = m[1].trim().replace(/\s+/g, ' ');
      name = name.replace(/^(The|A|An|My|Their|This|That|El|La|Los|Las|Un|Una)\s+/i, '').trim();
      if (name.length < 4 || name.length > 70) continue;
      if (/^(Reddit|Google|Yelp|CDMX|Mexico|México|Colombia|Venezuela|Hotel|Restaurant)$/i.test(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        name,
        subreddit,
        permalink: permalink.startsWith('http') ? permalink : `https://reddit.com${permalink}`,
        snippet: body.replace(/\s+/g, ' ').slice(0, 320),
      });
    }
  }
  return hits;
}

async function main() {
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const seen = new Map(existing.map((r) => [r.name.toLowerCase() + '|' + r.subreddit, r]));
  let added = 0;

  for (const sub of SUBREDDITS) {
    for (const q of QUERIES) {
      const url =
        'https://api.pullpush.io/reddit/search/comment/?subreddit=' +
        encodeURIComponent(sub) +
        '&q=' +
        encodeURIComponent(q) +
        '&size=100';
      try {
        const data = await fetchJson(url);
        for (const c of data.data || []) {
          const body = c.body || '';
          if (!hasBidetEvidence(body)) continue;
          for (const hit of extractVenues(body, sub, c.permalink || '')) {
            const key = hit.name.toLowerCase() + '|' + hit.subreddit;
            if (seen.has(key)) continue;
            seen.set(key, hit);
            added++;
            process.stderr.write(`+ ${sub}: ${hit.name}\n`);
          }
        }
        await sleep(350);
      } catch (e) {
        process.stderr.write(`x ${sub}/${q}: ${e.message}\n`);
      }
    }
  }

  const out = [...seen.values()];
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`Reddit LATAM: ${out.length} leads (+${added} new)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
