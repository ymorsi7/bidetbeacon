#!/usr/bin/env node
/**
 * Fetch known LATAM venue pages and extract explicit bidet/bidé/washlet evidence.
 * Output: data/mexico-web-bidets.json, data/colombia-web-bidets.json, data/venezuela-web-bidets.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const BIDET_RE =
  /\bbidet(s|\s+toilet)?\b|\bbid[eé]\b|\bwashlet\b|\btoto[\s®™]*\s*(bidet|toilet|smart)?\b|\binodoro\s+(japon[eé]s|inteligente|autom[aá]tico)\b|\basiento\s+t[eé]rmico\b|\bshattaf\b|\bhand shower\b|\bducha\s+de\s+mano\b|\bmanguera\s+higi[eé]nica\b|\belectronic\s+bidet\b|\bBA-3000/i;

const TARGETS = [
  {
    country: 'Mexico',
    outKey: 'mexico',
    urls: [
      'https://www.fujitaya.mx/',
      'https://www.fujitaya.mx/ja',
      'https://www.lasalcobas.com/our-property/services-amenities',
      'https://beachresortsinmexico.com/room/mousai-jacuzzi-suite',
      'https://www.taferresidenceclub.com/resorts/hotel-mousai',
      'https://www.hotelmousai.com/puerto-vallarta/suites',
      'https://hotel-plaza-garibaldi.mexico-hotels-mx.com/es/',
      'https://www.zabihah.com/halal-restaurants/ciudad-de-m%C3%A9xico-cdmx-mx',
    ],
  },
  {
    country: 'Colombia',
    outKey: 'colombia',
    urls: [
      'https://www.atly.com/best/gluten-free/dinner-colombia-bogota',
      'https://www.atly.com/best/gluten-free/colombia-bogota',
    ],
  },
  {
    country: 'Venezuela',
    outKey: 'venezuela',
    urls: [
      'https://www.atly.com/venezuela/best-bathroom-restaurant',
      'https://www.atly.com/venezuela/best-bathroom-coffee',
    ],
  },
];

/** Hand-verified when page fetch fails but evidence is documented */
const MANUAL = {
  mexico: [
    {
      name: 'Hotel MX Garibaldi CDMX, Trademark Collection by Wyndham',
      address: 'Honduras 11, Colonia Centro, Ciudad de México, CDMX 06010',
      latitude: '19.4412',
      longitude: '-99.1398',
      city: 'Mexico City, CDMX',
      country: 'Mexico',
      type: 'hotel',
      bidetStatus: 'internet',
      bidetType: 'Bidet (bidé)',
      sourceUrl: 'https://hotel-plaza-garibaldi.mexico-hotels-mx.com/es/',
      sourceQuote:
        'Guest review on hotel listing (ES): \"Realmente disfruté de un bidé en el baño personal\" — separate bidé fixture noted in room bathroom.',
      verifiedMethod: 'web-source',
      access: 'limited',
      accessNote: 'Hotel guests; verify room type',
    },
  ],
  colombia: [],
  venezuela: [],
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
            'User-Agent': 'BidetBud/1.0 (latam-web)',
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

function cleanQuote(raw) {
  return String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

function extractQuote(html) {
  const idx = html.search(BIDET_RE);
  if (idx < 0) return '';
  return cleanQuote(html.slice(Math.max(0, idx - 60), idx + 200));
}

function parseLdHotel(html, url, country) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const quote = extractQuote(html);
  if (!quote) return null;
  const addr = j.address || {};
  const cc = addr.addressCountry;
  if (cc && !String(cc).includes(country.slice(0, 2)) && cc !== country && cc !== 'MX' && cc !== 'CO' && cc !== 'VE')
    return null;
  const lat = j.geo?.latitude;
  const lon = j.geo?.longitude;
  if (lat == null || lon == null) return null;
  return {
    name: j.name,
    address: [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
      .filter(Boolean)
      .join(', '),
    latitude: String(lat),
    longitude: String(lon),
    city: [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', '),
    country,
    type: /hotel|lodging|resort/i.test(String(j['@type']) + j.name) ? 'hotel' : 'restaurant',
    bidetStatus: /toto|washlet|japon[eé]s|inteligente|autom[aá]tico|electronic/i.test(quote)
      ? 'warmed'
      : 'internet',
    bidetType: /toto|washlet|japon[eé]s/i.test(quote) ? 'TOTO / washlet bidet' : 'Bidet',
    sourceUrl: url.split('?')[0],
    sourceQuote: `Web source (ES/EN): ${quote}`,
    verifiedMethod: 'web-source',
    access: /hotel|resort|lodging/i.test(String(j['@type']) + j.name) ? 'limited' : 'public',
  };
}

async function geocode(name, city, country) {
  const q = encodeURIComponent(`${name}, ${city}, ${country}`);
  const json = await new Promise((resolve, reject) => {
    https
      .get(`https://photon.komoot.io/api/?q=${q}&limit=1`, { headers: { 'User-Agent': 'BidetBud/1.0' } }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
  const f = json.features?.[0];
  if (!f) return null;
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties;
  return {
    latitude: String(lat),
    longitude: String(lon),
    address: [p.street, p.housenumber, p.city, p.state].filter(Boolean).join(', '),
    city: [p.city, p.state].filter(Boolean).join(', '),
  };
}

async function main() {
  const results = { mexico: [...MANUAL.mexico], colombia: [...MANUAL.colombia], venezuela: [...MANUAL.venezuela] };
  const seen = new Set();

  for (const { country, outKey, urls } of TARGETS) {
    for (const url of urls) {
      process.stderr.write(`Fetch: ${url}\n`);
      try {
        const html = await fetchText(url);
        if (!BIDET_RE.test(html)) {
          await sleep(300);
          continue;
        }
        let row = parseLdHotel(html, url, country);
        if (!row) {
          const quote = extractQuote(html);
          if (!quote) continue;
          // Atly list page hit — skip, handled by scrape-atly-latam
          if (url.includes('atly.com/best/')) continue;
          row = {
            name: url.split('/').filter(Boolean).pop().replace(/-/g, ' '),
            country,
            type: 'hotel',
            bidetStatus: 'internet',
            bidetType: 'Bidet',
            sourceUrl: url.split('?')[0],
            sourceQuote: `Web source: ${quote}`,
            verifiedMethod: 'web-source',
            access: 'limited',
          };
          const geo = await geocode(row.name, country, country);
          if (geo) Object.assign(row, geo);
          else continue;
        }
        const key = `${row.name}|${row.latitude}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results[outKey].push(row);
        console.log(`+ ${country}: ${row.name}`);
        await sleep(400);
      } catch (e) {
        console.warn('Fail:', url, e.message);
      }
    }
  }

  for (const [key, rows] of Object.entries(results)) {
    const out = path.join(__dirname, `../data/${key}-web-bidets.json`);
    fs.writeFileSync(out, JSON.stringify(rows, null, 2) + '\n');
    console.log(`Wrote ${rows.length} → ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
