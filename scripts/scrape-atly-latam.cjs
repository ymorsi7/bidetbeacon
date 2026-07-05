#!/usr/bin/env node
/**
 * Scrape Atly LATAM list pages (MX/CO/VE) for bidet evidence, fetch location JSON-LD.
 * Output: data/atly-latam-bidets.json (merge-safe)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '../data/atly-latam-bidets.json');
const DISCOVERED = path.join(__dirname, '../data/atly-latam-discovered-urls.json');

const COUNTRY_MAP = {
  Mexico: 'Mexico',
  MX: 'Mexico',
  México: 'Mexico',
  Colombia: 'Colombia',
  CO: 'Colombia',
  Venezuela: 'Venezuela',
  VE: 'Venezuela',
};

const BIDET_RE =
  /\bbidet(s|\s+toilet|\s+attachment|\s+hand\s+shower|\s+functions?|-style|\s+and\s+wudu)?\b|\bbid[eé]\b|\bwashlet\b|\btoto[\s®™]*\s*(toilet|bidet|washlet|smart)?\b|\b(toilet|bathroom|baño)[^.\n]{0,40}\btoto\b|\bshattaf\b|\bhandheld sprayer\b|\bhand shower\b|\bhand-held\b|\bjapanese toilet\b|\binodoro\s+(japon[eé]s|inteligente|autom[aá]tico)\b|\bsanitario\s+japon[eé]s\b|\basiento\s+t[eé]rmico\b|\bducha\s+de\s+mano\b|\bmanguera\s+higi[eé]nica\b|\belectronic\s+bidet\b|\bsmart\s+japanese\s+toilet\b|\bheated\s+toilet[^.\n]{0,40}bidet/i;

const BASE_LISTS = [
  'https://www.atly.com/mexico/best-bathroom-coffee',
  'https://www.atly.com/mexico/best-bathroom-food',
  'https://www.atly.com/mexico/best-bathroom-restaurant',
  'https://www.atly.com/mexico/best-bathroom-hotel',
  'https://www.atly.com/mexico/best-bathroom-halal',
  'https://www.atly.com/mexico/best-bathroom-gluten-free',
  'https://www.atly.com/best/gluten-free/hotel-mexico',
  'https://www.atly.com/best/gluten-free/mexico',
  'https://www.atly.com/best/gluten-free/dinner-mexico-baja-california-tijuana',
  'https://www.atly.com/best/gluten-free/dinner-colombia-bogota',
  'https://www.atly.com/best/gluten-free/colombia',
  'https://www.atly.com/best/gluten-free/colombia-bogota',
  'https://www.atly.com/colombia/best-bathroom-restaurant',
  'https://www.atly.com/colombia/best-bathroom-coffee',
  'https://www.atly.com/colombia/best-bathroom-hotel',
  'https://www.atly.com/venezuela/best-bathroom-restaurant',
  'https://www.atly.com/venezuela/best-bathroom-coffee',
  'https://www.atly.com/venezuela/best-bathroom-hotel',
];

const LIST_URLS = [
  ...new Set([
    ...BASE_LISTS,
    ...(fs.existsSync(DISCOVERED) ? JSON.parse(fs.readFileSync(DISCOVERED, 'utf8')) : []),
  ]),
];

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
            'User-Agent': 'BidetBud/1.0 (atly-latam)',
            'Accept-Language': 'es-MX,es;q=0.9,en-US,en;q=0.8',
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

  function addFromWindow(window, url) {
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
    addFromWindow(html.slice(start, end), url);
  }

  const bidetWalk = new RegExp(BIDET_RE.source, 'gi');
  let bm;
  while ((bm = bidetWalk.exec(html))) {
    const start = Math.max(0, bm.index - 12000);
    const end = Math.min(html.length, bm.index + 12000);
    const window = html.slice(start, end);
    const slugMatch = window.match(/\/location\/([A-Za-z0-9_-]+)/);
    if (!slugMatch) continue;
    const url = `https://www.atly.com/location/${slugMatch[1]}`;
    addFromWindow(window, url);
  }

  return [...candidates.values()];
}

function extractAllSlugs(html) {
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
  const addr = j.address || {};
  const country = COUNTRY_MAP[addr.addressCountry] || addr.addressCountry;
  if (!['Mexico', 'Colombia', 'Venezuela'].includes(country)) return null;
  const lat = j.geo?.latitude;
  const lon = j.geo?.longitude;
  if (lat == null || lon == null) return null;

  const finalQuote = quote || quoteFromLocationHtml(html);
  if (!finalQuote || !BIDET_RE.test(finalQuote)) return null;

  const street = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
    .filter(Boolean)
    .join(', ');
  const city = [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ');
  const schemaType = String(j['@type'] || '').toLowerCase();
  let type = 'restaurant';
  if (/hotel|lodging|resort|motel|inn/.test(schemaType + ' ' + j.name)) type = 'hotel';
  if (/cafe|coffee|bakery/.test(schemaType + ' ' + j.name)) type = 'restaurant';

  return {
    name: j.name,
    address: street,
    latitude: String(lat),
    longitude: String(lon),
    city,
    country,
    type,
    bidetStatus: 'internet',
    bidetType: /toto|washlet|japon[eé]s|inteligente|autom[aá]tico|electronic/i.test(finalQuote)
      ? 'TOTO / washlet bidet'
      : 'Bidet',
    sourceUrl: j.url || locUrl,
    sourceQuote: `Atly (ES/EN): ${finalQuote}`,
    verifiedMethod: 'web-source',
    access: type === 'hotel' ? 'limited' : 'public',
    ...(type === 'hotel' ? { accessNote: 'Hotel guests' } : {}),
  };
}

async function main() {
  const prior = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const knownLocUrls = new Set(
    prior.filter((r) => r.sourceUrl).map((r) => r.sourceUrl.replace(/\/$/, ''))
  );

  const listCandidates = new Map();
  const deepSlugs = new Map();

  for (const listUrl of LIST_URLS) {
    process.stderr.write(`List: ${listUrl}\n`);
    try {
      const html = await fetchText(listUrl);
      if (html.length < 8000 || html.includes('Page not found')) continue;
      for (const c of extractBidetCandidates(html, listUrl)) {
        if (!listCandidates.has(c.url)) listCandidates.set(c.url, c);
      }
      for (const slug of extractAllSlugs(html)) {
        if (!deepSlugs.has(slug)) deepSlugs.set(slug, listUrl);
      }
      await sleep(200);
    } catch (e) {
      console.warn('List fail:', listUrl, e.message);
    }
  }

  console.log('List bidet candidates:', listCandidates.size, '| slugs for deep scan:', deepSlugs.size);

  const rows = [];
  const fetched = new Set();

  async function fetchLoc(cand) {
    const locKey = cand.url.replace(/\/$/, '');
    if (knownLocUrls.has(locKey) || fetched.has(locKey)) return;
    fetched.add(locKey);
    try {
      const html = await fetchText(cand.url);
      const loc = parseLocationPage(html, cand.url, cand.listUrl, cand.quote);
      await sleep(180);
      if (loc) rows.push(loc);
    } catch (e) {
      console.warn('Location fail:', cand.url, e.message);
    }
  }

  for (const cand of listCandidates.values()) await fetchLoc(cand);

  // Deep scan: location pages from LATAM lists even if list HTML lacked bidet keyword
  let i = 0;
  for (const [slug, listUrl] of deepSlugs) {
    i++;
    if (i % 100 === 0) process.stderr.write(`Deep ${i}/${deepSlugs.size}\n`);
    const url = `https://www.atly.com/location/${slug}`;
    if (fetched.has(url.replace(/\/$/, ''))) continue;
    await fetchLoc({ url, listUrl, quote: '' });
  }

  const merged = new Map();
  for (const row of prior) {
    const key = `${row.name}|${Number(row.latitude).toFixed(5)}|${Number(row.longitude).toFixed(5)}`;
    merged.set(key, row);
  }
  for (const row of rows) {
    const key = `${row.name}|${Number(row.latitude).toFixed(5)}|${Number(row.longitude).toFixed(5)}`;
    if (!merged.has(key)) merged.set(key, row);
  }

  const outRows = [...merged.values()];
  fs.writeFileSync(OUT, JSON.stringify(outRows, null, 2) + '\n');
  const byCountry = outRows.reduce((a, r) => {
    a[r.country] = (a[r.country] || 0) + 1;
    return a;
  }, {});
  console.log(`Wrote ${outRows.length} LATAM Atly entries (+${outRows.length - prior.length} new)`, byCountry);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
