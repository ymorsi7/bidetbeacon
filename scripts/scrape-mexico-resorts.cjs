#!/usr/bin/env node
/**
 * Scrape Mexico resort/hotel sites (EN + ES) for explicit bidet/TOTO evidence.
 * Output: data/mexico-scraped-bidets.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '../data/mexico-scraped-bidets.json');

const BIDET_RE =
  /\bbidet(s|\s+toilet)?\b|\bbid[eé]\b|\bwashlet\b|\btoto[\s®™]*\s*(bidet|toilet|smart)?\b|\bneorest\b|\binodoro\s+(japon[eé]s|inteligente|autom[aá]tico)\b|\bsanitario\s+japon[eé]s\b|\basiento\s+t[eé]rmico\b|\bheated\s+toilet\b|\bautomated\s+bidet\b|\bstate-of-the-art\s+bidet\b|\belectronic\s+bidet\b|\bsmart\s+japanese\s+toilet\b|\bbid[eé]\s+toto\b|\btoto\s+bid[eé]\b|\binodoro\s+con\s+bid[eé]\b/i;

const SITEMAPS = [
  'https://www.garzablancaresort.com/sitemap-gbcorp-en.xml',
  'https://www.garzablancaresort.com/sitemap-gbcorp-es.xml',
  'https://www.garzablancaresort.com/sitemap-gbcn-en.xml',
  'https://www.garzablancaresort.com/sitemap-gbcn-es.xml',
  'https://www.garzablancaresort.com/sitemap-gblc-en.xml',
  'https://www.garzablancaresort.com/sitemap-gblc-es.xml',
  'https://www.garzablancaresort.com/sitemap-gbpv-en.xml',
  'https://www.garzablancaresort.com/sitemap-gbpv-es.xml',
  'https://cancun.hotelmousai.com/sitemap.xml',
  'https://puertovallarta.hotelmousai.com/sitemap.xml',
  'https://www.villapalmarcancun.com/sitemap.xml',
  'https://www.lasalcobas.com/sitemap.xml',
  'https://www.fujitaya.mx/sitemap.xml',
  'https://loscabos.villadelpalmar.com/sitemap.xml',
  'https://www.villadelpalmarloreto.com/sitemap.xml',
];

const LIST_PAGES = [
  'https://www.atly.com/mexico/best-bathroom-coffee',
  'https://www.atly.com/mexico/best-bathroom-hotel',
  'https://www.atly.com/mexico/best-bathroom-restaurant',
  'https://www.atly.com/mexico/cancun/best-bathroom-hotel',
  'https://www.atly.com/mexico/cdmx/best-bathroom-restaurant',
  'https://www.atly.com/mexico/ciudad-de-mexico/best-bathroom-coffee',
  'https://www.atly.com/mexico/mexico-city/best-bathroom-hotel',
  'https://www.atly.com/mexico/mexico-city/best-bathroom-restaurant',
  'https://www.atly.com/mexico/cancun/best-bathroom-restaurant',
  'https://www.atly.com/mexico/puerto-vallarta/best-bathroom-hotel',
  'https://www.atly.com/mexico/guadalajara/best-bathroom-hotel',
  'https://www.atly.com/mexico/monterrey/best-bathroom-hotel',
  'https://www.atly.com/mexico/queretaro/best-bathroom-hotel',
  'https://www.atly.com/mexico/san-miguel-de-allende/best-bathroom-hotel',
  'https://www.atly.com/mexico/los-cabos/best-bathroom-hotel',
  'https://www.atly.com/mexico/playa-del-carmen/best-bathroom-hotel',
  'https://www.atly.com/mexico/tulum/best-bathroom-hotel',
];

/** Resort-level coords when JSON-LD missing */
const RESORT_COORDS = {
  'garza-blanca-cancun': {
    name: 'Garza Blanca Resort & Spa Cancun',
    lat: '21.2106',
    lon: '-86.8028',
    city: 'Cancún, Quintana Roo',
    address: 'Carretera a Punta Sam Km 5.2, 77400 Cancún, Quintana Roo',
  },
  'garza-blanca-pv': {
    name: 'Garza Blanca Resort & Spa Puerto Vallarta',
    lat: '20.5490',
    lon: '-105.2670',
    city: 'Puerto Vallarta, Jalisco',
    address: 'Carretera a Barra de Navidad Km 7.5, 48399 Puerto Vallarta, Jalisco',
  },
  'garza-blanca-cabos': {
    name: 'Garza Blanca Resort & Spa Los Cabos',
    lat: '22.9765',
    lon: '-109.7920',
    city: 'San José del Cabo, B.C.S.',
    address: 'Carretera Transpeninsular Km 17.5, 23405 San José del Cabo, B.C.S.',
  },
  'hotel-mousai-cancun': {
    name: 'Hotel Mousai Cancun',
    lat: '21.0742',
    lon: '-86.7778',
    city: 'Cancún, Quintana Roo',
    address: 'Blvd. Kukulcan Km 16, Zona Hotelera, 77500 Cancún, Quintana Roo',
  },
  'hotel-mousai-pv': {
    name: 'Hotel Mousai Puerto Vallarta',
    lat: '20.5550',
    lon: '-105.2630',
    city: 'Puerto Vallarta, Jalisco',
    address: 'Carretera a Barra de Navidad Km 7.5, Mismaloya, 48294 Puerto Vallarta, Jalisco',
  },
  'villa-del-palmar-cancun': {
    name: 'Villa del Palmar Cancun Luxury Beach Resort & Spa',
    lat: '21.2095',
    lon: '-86.8035',
    city: 'Cancún, Quintana Roo',
    address: 'Carretera a Punta Sam Km 5.2, 77400 Cancún, Quintana Roo',
  },
  'las-alcobas-cdmx': {
    name: 'Las Alcobas, a Luxury Collection Hotel, Mexico City',
    lat: '19.4275',
    lon: '-99.1945',
    city: 'Mexico City, CDMX',
    address: 'Av. Presidente Masaryk 390, Polanco, Ciudad de México',
  },
  'fujitaya-queretaro': {
    name: 'Hotel FUJITAYA Querétaro',
    lat: '20.6904',
    lon: '-100.4414',
    city: 'Querétaro, Querétaro',
    address: 'Avenida Santa Rosa #5001, Privada Juriquilla, 76100 Querétaro',
  },
  'villa-del-palmar-los-cabos': {
    name: 'Villa del Palmar Beach Resort & Spa Los Cabos',
    lat: '22.9165',
    lon: '-109.8665',
    city: 'San José del Cabo, B.C.S.',
    address: 'Camino del Cerro s/n, Pedregal, 23400 San José del Cabo, B.C.S.',
  },
  'villa-del-palmar-loreto': {
    name: 'Villa del Palmar at the Islands of Loreto',
    lat: '25.7410',
    lon: '-111.2480',
    city: 'Loreto, B.C.S.',
    address: 'Carretera Transpeninsular Km 84, 23880 Loreto, B.C.S.',
  },
};

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
            'User-Agent': 'BidetBud/1.0 (mexico-scrape)',
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

function extractQuote(html) {
  const amenity = html.match(
    /(?:amenity-label|TOTO Bidet|Bid[eé] TOTO|Automated bidet|inodoro autom[aá]tico|state-of-the-art bidet)[^<]{0,200}/gi
  );
  if (amenity) {
    const q = cleanQuote(amenity[0]);
    if (BIDET_RE.test(q)) return q;
  }

  const jsonName = html.match(
    /"name"\s*:\s*"(Toto bidet|TOTO Bidet|Automated bidet toilet|Bid[eé] TOTO|inodoro autom[aá]tico[^"]*)"/i
  );
  if (jsonName) return cleanQuote(jsonName[1]);

  const bath = html.match(/editorial-section-label-v2">(?:Bathroom|Baño)<\/div><p>([\s\S]*?)<\/p>/i);
  if (bath && BIDET_RE.test(bath[1])) return cleanQuote(bath[1]);

  const idx = html.search(BIDET_RE);
  if (idx >= 0) return cleanQuote(html.slice(Math.max(0, idx - 50), idx + 200));
  return '';
}

function resortKey(url) {
  const u = url.toLowerCase();
  if (/hotelmousai\.com|cancun\.hotelmousai/.test(u) && /cancun|kukulcan/.test(u)) return 'hotel-mousai-cancun';
  if (/hotelmousai\.com|puertovallarta\.hotelmousai/.test(u)) return 'hotel-mousai-pv';
  if (/villapalmarcancun|villa-del-palmar.*cancun/.test(u)) return 'villa-del-palmar-cancun';
  if (/loscabos\.villadelpalmar|villadelpalmar.*los-cabos/.test(u)) return 'villa-del-palmar-los-cabos';
  if (/villadelpalmarloreto|loreto.*villadelpalmar/.test(u)) return 'villa-del-palmar-loreto';
  if (/fujitaya\.mx/.test(u)) return 'fujitaya-queretaro';
  if (/lasalcobas/.test(u)) return 'las-alcobas-cdmx';
  if (/\/cancun\/|gbcn|punta-sam/.test(u)) return 'garza-blanca-cancun';
  if (/\/puerto-vallarta\/|gbpv|barra-de-navidad/.test(u)) return 'garza-blanca-pv';
  if (/\/los-cabos\/|gblc|san-jose-del-cabo/.test(u)) return 'garza-blanca-cabos';
  return null;
}

function pageTitle(html) {
  const og = html.match(/property="og:title"\s+content="([^"]+)"/i);
  if (og) return stripHtml(og[1]).replace(/\s*\|\s*.+$/, '').trim();
  const t = html.match(/<title>([^<]+)<\/title>/i);
  return t ? stripHtml(t[1]).split('|')[0].trim() : '';
}

function parseLdJson(html) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function isRelevantUrl(url) {
  return /\/(suites?|ultra-suites?|habitaciones?|rooms?|accommodations?|room)\//i.test(url);
}

async function collectSitemapUrls() {
  const urls = new Set();
  for (const sm of SITEMAPS) {
    try {
      const xml = await fetchText(sm);
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const u = m[1];
        if (
          isRelevantUrl(u) ||
          /garzablancaresort\.com|hotelmousai|villapalmarcancun|villadelpalmar|lasalcobas|fujitaya\.mx/.test(u)
        ) {
          if (!/blog|gallery|press|news|cookie|privacy|terms|contact|faq|career/i.test(u)) urls.add(u);
        }
      }
      await sleep(200);
    } catch (e) {
      console.warn('Sitemap fail:', sm, e.message);
    }
  }
  return [...urls];
}

function extractAtlyCandidates(html, listUrl) {
  const out = new Map();
  const slugRe = /\/location\/([A-Za-z0-9_-]+)/g;
  let m;
  while ((m = slugRe.exec(html))) {
    const url = `https://www.atly.com/location/${m[1]}`;
    const start = Math.max(0, m.index - 4000);
    const end = Math.min(html.length, m.index + 20000);
    const window = html.slice(start, end);
    if (!BIDET_RE.test(window)) continue;
    let quote = '';
    const bath = window.match(/editorial-section-label-v2">(?:Bathroom|Baño)<\/div><p>([\s\S]*?)<\/p>/i);
    if (bath && BIDET_RE.test(bath[1])) quote = cleanQuote(bath[1]);
    if (!quote) {
      const idx = window.search(BIDET_RE);
      quote = cleanQuote(window.slice(Math.max(0, idx - 60), idx + 180));
    }
    if (quote) out.set(url, { url, quote, listUrl });
  }
  const walk = new RegExp(BIDET_RE.source, 'gi');
  let bm;
  while ((bm = walk.exec(html))) {
    const w = html.slice(Math.max(0, bm.index - 12000), Math.min(html.length, bm.index + 12000));
    const sm = w.match(/\/location\/([A-Za-z0-9_-]+)/);
    if (!sm) continue;
    const url = `https://www.atly.com/location/${sm[1]}`;
    if (out.has(url)) continue;
    const idx = w.search(BIDET_RE);
    const quote = cleanQuote(w.slice(Math.max(0, idx - 60), idx + 180));
    if (quote) out.set(url, { url, quote, listUrl });
  }
  return [...out.values()];
}

async function parseAtlyLocation(cand) {
  try {
    const html = await fetchText(cand.url);
    await sleep(200);
    const j = parseLdJson(html);
    if (!j) return null;
    const country = j.address?.addressCountry;
    if (country !== 'Mexico' && country !== 'MX' && country !== 'México') return null;
    const lat = j.geo?.latitude;
    const lon = j.geo?.longitude;
    if (lat == null || lon == null) return null;
    const quote = extractQuote(html) || cand.quote;
    if (!quote || !BIDET_RE.test(quote)) return null;
    return {
      name: j.name,
      address: [j.address?.streetAddress, j.address?.addressLocality, j.address?.addressRegion, j.address?.postalCode]
        .filter(Boolean)
        .join(', '),
      latitude: String(lat),
      longitude: String(lon),
      city: [j.address?.addressLocality, j.address?.addressRegion].filter(Boolean).join(', '),
      country: 'Mexico',
      type: /hotel|lodging|resort/i.test(String(j['@type']) + j.name) ? 'hotel' : 'restaurant',
      bidetStatus: /toto|washlet|heated|automated|japon[eé]s/i.test(quote) ? 'warmed' : 'internet',
      bidetType: /toto|washlet|japon[eé]s/i.test(quote) ? 'TOTO / washlet bidet' : 'Bidet',
      sourceUrl: j.url || cand.url,
      sourceQuote: `Atly (ES/EN): ${quote}`,
      verifiedMethod: 'web-source',
      access: 'public',
    };
  } catch {
    return null;
  }
}

async function scrapePage(url) {
  try {
    const html = await fetchText(url);
    if (!BIDET_RE.test(html)) return null;
    const quote = extractQuote(html);
    if (!quote || !BIDET_RE.test(quote)) return null;

    const key = resortKey(url);
    const resort = key ? RESORT_COORDS[key] : null;
    const j = parseLdJson(html);
    const title = pageTitle(html);

    let name = resort?.name || j?.name || title;
    if (!name || name.length < 4) return null;

    // Prefer resort-level name for suite pages (dedupe by property)
    if (resort) name = resort.name;

    const lat = j?.geo?.latitude != null ? String(j.geo.latitude) : resort?.lat;
    const lon = j?.geo?.longitude != null ? String(j.geo.longitude) : resort?.lon;
    if (!lat || !lon) return null;

    const addr = j?.address
      ? [j.address.streetAddress, j.address.addressLocality, j.address.addressRegion, j.address.postalCode]
          .filter(Boolean)
          .join(', ')
      : resort?.address || '';

    const city = resort?.city || [j?.address?.addressLocality, j?.address?.addressRegion].filter(Boolean).join(', ');

    const isWarm = /toto|washlet|heated|automated|japon[eé]s|neorest|inteligente/i.test(quote + name);

    return {
      name,
      address: addr,
      latitude: lat,
      longitude: lon,
      city,
      country: 'Mexico',
      type: 'hotel',
      bidetStatus: isWarm ? 'warmed' : 'internet',
      bidetType: isWarm ? 'TOTO / washlet bidet' : 'Bidet toilet',
      sourceUrl: url.split('?')[0],
      sourceQuote: /[\u0300-\u036f\u00c0-\u024f]/.test(quote) || /bid[eé]|inodoro|autom[aá]tico/i.test(quote)
        ? `Sitio oficial (ES): ${quote}`
        : `Official site: ${quote}`,
      verifiedMethod: 'web-source',
      access: 'limited',
      accessNote: 'Hotel guests; verify room category before booking',
      resortKey: key || normResort(name),
    };
  } catch (e) {
    return null;
  }
}

function normResort(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24);
}

async function main() {
  const rows = new Map();

  const urls = await collectSitemapUrls();
  console.log('Resort URLs to scan:', urls.length);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (
      !isRelevantUrl(url) &&
      !/lasalcobas\.com\/(accommodations|our-property)/.test(url) &&
      !/fujitaya\.mx\/?$|fujitaya\.mx\/(ja|en|rooms|habitaciones)/.test(url)
    )
      continue;
    process.stderr.write(`[${i + 1}/${urls.length}] ${url}\n`);
    const row = await scrapePage(url);
    await sleep(180);
    if (!row) continue;
    const key = row.resortKey || `${normResort(row.name)}|${Number(row.latitude).toFixed(4)}`;
    delete row.resortKey;
    if (!rows.has(key) || row.sourceQuote.length > (rows.get(key).sourceQuote?.length || 0)) {
      rows.set(key, row);
    }
  }

  for (const listUrl of LIST_PAGES) {
    process.stderr.write(`Atly list: ${listUrl}\n`);
    try {
      const html = await fetchText(listUrl);
      if (html.length < 5000 || html.includes('Page not found')) continue;
      const cands = extractAtlyCandidates(html, listUrl);
      console.log('  Atly candidates:', cands.length);
      for (const cand of cands) {
        const row = await parseAtlyLocation(cand);
        await sleep(200);
        if (!row) continue;
        const key = `${normResort(row.name)}|${Number(row.latitude).toFixed(4)}`;
        if (!rows.has(key)) rows.set(key, row);
      }
      await sleep(250);
    } catch (e) {
      console.warn('Atly list fail:', listUrl, e.message);
    }
  }

  // Manual high-confidence sources not always in sitemap
  const MANUAL = [
    {
      name: 'Las Alcobas, a Luxury Collection Hotel, Mexico City',
      address: 'Av. Presidente Masaryk 390, Polanco, Ciudad de México',
      latitude: '19.4275',
      longitude: '-99.1945',
      city: 'Mexico City, CDMX',
      country: 'Mexico',
      type: 'hotel',
      bidetStatus: 'warmed',
      bidetType: 'TOTO water closets / washlet-style toilets',
      sourceUrl: 'https://www.lasalcobas.com/our-property/services-amenities',
      sourceQuote:
        'Las Alcobas official amenities (ES/EN): \"Inodoros TOTO con bidé integrado\" / \"TOTO water closets with integrated bidets\" listed among spa-inspired bathroom features.',
      verifiedMethod: 'web-source',
      access: 'limited',
      accessNote: 'Hotel guests',
    },
    {
      name: 'Villa del Palmar Cancun Luxury Beach Resort & Spa',
      address: 'Carretera a Punta Sam Km 5.2, 77400 Cancún, Quintana Roo',
      latitude: '21.2095',
      longitude: '-86.8035',
      city: 'Cancún, Quintana Roo',
      country: 'Mexico',
      type: 'hotel',
      bidetStatus: 'internet',
      bidetType: 'Bidet (bidé)',
      sourceUrl: 'https://www.villapalmarcancun.com/',
      sourceQuote:
        'Villa del Palmar Cancún room listings include \"Bidé\" among in-room bathroom amenities (separate bidet fixture listed alongside private bathroom fixtures).',
      verifiedMethod: 'web-source',
      access: 'limited',
      accessNote: 'Hotel guests; verify room type',
    },
    {
      name: 'Hotel FUJITAYA Querétaro',
      address: 'Avenida Santa Rosa #5001, Privada Juriquilla, 76100 Querétaro',
      latitude: '20.6904',
      longitude: '-100.4414',
      city: 'Querétaro, Querétaro',
      country: 'Mexico',
      type: 'hotel',
      bidetStatus: 'warmed',
      bidetType: 'TOTO Washlet (inodoro automatizado)',
      sourceUrl: 'https://www.fujitaya.mx/',
      sourceQuote:
        'Sitio oficial (ES): \"Nuestros departamentos cuentan con electrodomésticos de uso diario, refrigerador e inodoro automatizado\"; página JA confirma TOTO Washlet en todas las habitaciones.',
      verifiedMethod: 'web-source',
      access: 'limited',
      accessNote: 'Hotel guests; Japanese-style automated toilets in all rooms',
    },
    {
      name: 'Courtyard by Marriott León at The Poliforum',
      address: 'Boulevard General Francisco Villa 900, Colonia La Granja, 37160 León, Guanajuato',
      latitude: '21.1137',
      longitude: '-101.6540',
      city: 'León, Guanajuato',
      country: 'Mexico',
      type: 'hotel',
      bidetStatus: 'warmed',
      bidetType: 'Electronic bidet toilet (Ballenam BA-3000R)',
      sourceUrl:
        'https://www.ballenam.com/es/noticiasblog/148-%C2%BFen-qu%C3%A9-hotel-le-gustar%C3%ADa-hospedarse-en-le%C3%B3n-m%C3%A9xico-%C2%BFqu%C3%A9-tal-un-hotel-que-le-hace-sentir-la-hospitalidad-japonesa-con-un-bidet-electr%C3%B3nico.html',
      sourceQuote:
        'Ballenam (ES): \"El hotel Courtyard by Marriott León at the Poliforum tiene los modelos BA-3000R instalados en 40 habitaciones\" para huéspedes de negocios japoneses.',
      verifiedMethod: 'web-source',
      access: 'limited',
      accessNote: '40 rooms with electronic bidets; request when booking',
    },
  ];

  for (const m of MANUAL) {
    const key = `${normResort(m.name)}|${Number(m.latitude).toFixed(4)}`;
    if (!rows.has(key)) rows.set(key, m);
  }

  const out = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

  const byType = out.reduce((a, r) => {
    a[r.type] = (a[r.type] || 0) + 1;
    return a;
  }, {});
  console.log(`Wrote ${out.length} Mexico entries to ${OUT}`, byType);
  out.forEach((r) => console.log(' •', r.name));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
