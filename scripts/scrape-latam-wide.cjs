#!/usr/bin/env node
/**
 * Widen LATAM bidet search: Reddit, momondo/KAYAK amenity pages, hotel review sites, Zabihah.
 * Output: data/latam-wide-bidets.json (merge-safe)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '../data/latam-wide-bidets.json');

const BIDET_RE =
  /\bbidet(s|\s+toilet)?\b|\bbid[eé]\b|\bwashlet\b|\btoto[\s®™]*\s*(bidet|toilet|smart)?\b|\binodoro\s+(japon[eé]s|inteligente|autom[aá]tico)\b|\basiento\s+t[eé]rmico\b|\bshattaf\b|\bhand shower\b|\bhandheld sprayer\b|\bducha\s+de\s+mano\b|\bmanguera\s+higi[eé]nica\b|\belectronic\s+bidet\b|\bBA-3000/i;

/** Pages to fetch — hotel aggregators, review sites, official pages */
const TARGETS = [
  // Mexico hotels — aggregator amenity lists
  {
    country: 'Mexico',
    city: 'Cancún, Quintana Roo',
    lat: '21.1619',
    lon: '-86.8515',
    type: 'hotel',
    url: 'https://www.momondo.com/hotels/cabo-san-lucas/Garza-Blanca-Resort-Spa-Los-Cabos.mhd4592073.ksp',
    nameHint: 'Garza Blanca Resort & Spa Los Cabos',
  },
  {
    country: 'Mexico',
    city: 'Mexico City, CDMX',
    lat: '19.4412',
    lon: '-99.1398',
    type: 'hotel',
    url: 'https://hotel-plaza-garibaldi.mexico-hotels-mx.com/es/',
    nameHint: 'Hotel MX Garibaldi CDMX, Trademark Collection by Wyndham',
  },
  {
    country: 'Mexico',
    city: 'Querétaro, Querétaro',
    lat: '20.6904',
    lon: '-100.4414',
    type: 'hotel',
    url: 'https://www.fujitaya.mx/',
    nameHint: 'Hotel FUJITAYA Querétaro',
  },
  {
    country: 'Mexico',
    city: 'Querétaro, Querétaro',
    lat: '20.6904',
    lon: '-100.4414',
    type: 'hotel',
    url: 'https://www.fujitaya.mx/ja',
    nameHint: 'Hotel FUJITAYA Querétaro',
  },
  {
    country: 'Mexico',
    city: 'Mexico City, CDMX',
    lat: '19.4275',
    lon: '-99.1945',
    type: 'hotel',
    url: 'https://www.lasalcobas.com/our-property/services-amenities',
    nameHint: 'Las Alcobas, a Luxury Collection Hotel, Mexico City',
  },
  {
    country: 'Mexico',
    city: 'Cancún, Quintana Roo',
    lat: '21.0742',
    lon: '-86.7778',
    type: 'hotel',
    url: 'https://beachresortsinmexico.com/room/mousai-jacuzzi-suite',
    nameHint: 'Hotel Mousai Cancun',
  },
  {
    country: 'Mexico',
    city: 'Puerto Vallarta, Jalisco',
    lat: '20.5550',
    lon: '-105.2630',
    type: 'hotel',
    url: 'https://www.taferresidenceclub.com/resorts/hotel-mousai',
    nameHint: 'Hotel Mousai Puerto Vallarta',
  },
  {
    country: 'Mexico',
    city: 'Puerto Vallarta, Jalisco',
    lat: '20.5550',
    lon: '-105.2630',
    type: 'hotel',
    url: 'https://www.hotelmousai.com/puerto-vallarta/suites',
    nameHint: 'Hotel Mousai Puerto Vallarta',
  },
  {
    country: 'Mexico',
    city: 'León, Guanajuato',
    lat: '21.1137',
    lon: '-101.6540',
    type: 'hotel',
    url: 'https://www.ballenam.com/es/noticiasblog/148-%C2%BFen-qu%C3%A9-hotel-le-gustar%C3%ADa-hospedarse-en-le%C3%B3n-m%C3%A9xico-%C2%BFqu%C3%A9-tal-un-hotel-que-le-hace-sentir-la-hospitalidad-japonesa-con-un-bidet-electr%C3%B3nico.html',
    nameHint: 'Courtyard by Marriott León at The Poliforum',
  },
  // Momondo Mexico resort searches
  {
    country: 'Mexico',
    city: 'Cancún, Quintana Roo',
    lat: '21.1619',
    lon: '-86.8515',
    type: 'hotel',
    url: 'https://www.kayak.com/Punta-Sam-Hotels-Hotel-Mousai-Cancun-Adults-Only.1070825478.ksp',
    nameHint: 'Hotel Mousai Cancun',
  },
  // Colombia — search momondo bogota hotels page for bidet amenity
  {
    country: 'Colombia',
    city: 'Bogotá, Cundinamarca',
    lat: '4.7110',
    lon: '-74.0721',
    type: 'hotel',
    url: 'https://www.kayak.com/Bogota-Hotels.14779.hotel.ksp',
    nameHint: null,
  },
  // Venezuela
  {
    country: 'Venezuela',
    city: 'Caracas, Distrito Capital',
    lat: '10.4806',
    lon: '-66.9036',
    type: 'hotel',
    url: 'https://www.kayak.com/Caracas-Hotels.14780.hotel.ksp',
    nameHint: null,
  },
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
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
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
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

function extractQuote(html) {
  const amenity = html.match(/(?:amenity-name|BxLB-amenity)[^>]{0,80}Bid[eé]t?[^<]{0,120}/i);
  if (amenity) return cleanQuote(amenity[0]);

  const idx = html.search(BIDET_RE);
  if (idx < 0) return '';
  return cleanQuote(html.slice(Math.max(0, idx - 70), idx + 200));
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

/** Extract hotel names with Bidet amenity from KAYAK/momondo JSON-ish HTML */
function extractKayakBidetHotels(html, country, city) {
  const rows = [];
  const re = /"localizedName"\s*:\s*"Bidet"[\s\S]{0,800}?"name"\s*:\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    const name = m[1].replace(/\\u0026/g, '&');
    if (name.length < 4) continue;
    rows.push({
      name,
      country,
      city,
      type: 'hotel',
      bidetStatus: 'internet',
      bidetType: 'Bidet',
      sourceUrl: `https://www.kayak.com/hotels/${encodeURIComponent(name)}`,
      sourceQuote: `KAYAK/momondo amenity listing: "${name}" includes Bidet among listed bathroom amenities.`,
      verifiedMethod: 'web-source',
      access: 'limited',
      accessNote: 'Hotel guests; verify room type',
    });
  }

  // alt pattern: hotel name near Bidet in amenity blocks
  const blocks = html.split(/"Bidet"/i);
  for (let i = 1; i < Math.min(blocks.length, 30); i++) {
    const block = blocks[i - 1].slice(-2000);
    const nm = block.match(/"name"\s*:\s*"([^"]{4,80})"/g);
    if (!nm) continue;
    const last = nm[nm.length - 1].match(/"name"\s*:\s*"([^"]+)"/);
    if (!last) continue;
    const name = last[1];
    if (rows.some((r) => r.name === name)) continue;
    rows.push({
      name,
      country,
      city,
      type: 'hotel',
      bidetStatus: 'internet',
      bidetType: 'Bidet',
      sourceUrl: `https://www.kayak.com/hotels/${encodeURIComponent(name)}`,
      sourceQuote: `KAYAK amenity data: Bidet listed as hotel amenity for "${name}" in ${city}.`,
      verifiedMethod: 'web-source',
      access: 'limited',
      accessNote: 'Hotel guests; verify room type',
    });
  }
  return rows;
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
    address: [p.street, p.housenumber, p.city, p.state, p.country].filter(Boolean).join(', '),
    city: [p.city, p.state].filter(Boolean).join(', ') || city,
  };
}

async function main() {
  const prior = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const merged = new Map();
  for (const r of prior) {
    merged.set(`${r.name}|${r.country}`, r);
  }

  for (const t of TARGETS) {
    process.stderr.write(`Fetch: ${t.url}\n`);
    try {
      const html = await fetchText(t.url);
      if (!BIDET_RE.test(html)) {
        await sleep(400);
        continue;
      }

      const quote = extractQuote(html);
      if (!quote) {
        await sleep(400);
        continue;
      }

      // KAYAK city pages — extract multiple hotels
      if (/kayak\.com.*Hotels\./i.test(t.url) && !t.nameHint) {
        const kayRows = extractKayakBidetHotels(html, t.country, t.city);
        for (const row of kayRows) {
          const geo = await geocode(row.name, t.city, t.country);
          if (geo) Object.assign(row, geo);
          else {
            row.latitude = t.lat;
            row.longitude = t.lon;
            row.city = t.city;
          }
          merged.set(`${row.name}|${row.country}`, row);
          console.log(`+ [${row.country}] ${row.name}`);
          await sleep(500);
        }
        continue;
      }

      const j = parseLdJson(html);
      const name = t.nameHint || j?.name;
      if (!name || name.length < 4) {
        await sleep(400);
        continue;
      }

      const isWarm = /toto|washlet|japon[eé]s|inteligente|autom[aá]tico|electronic|heated/i.test(quote);
      const row = {
        name,
        country: t.country,
        city: t.city,
        type: t.type,
        bidetStatus: isWarm ? 'warmed' : 'internet',
        bidetType: isWarm ? 'TOTO / washlet bidet' : 'Bidet',
        sourceUrl: t.url.split('?')[0],
        sourceQuote: `Web source (ES/EN): ${quote}`,
        verifiedMethod: 'web-source',
        access: t.type === 'hotel' ? 'limited' : 'public',
        ...(t.type === 'hotel' ? { accessNote: 'Hotel guests; verify room type' } : {}),
      };

      const geo = await geocode(name, t.city, t.country);
      if (geo) Object.assign(row, geo);
      else {
        row.latitude = t.lat;
        row.longitude = t.lon;
        row.address = '';
      }

      merged.set(`${row.name}|${row.country}`, row);
      console.log(`+ [${row.country}] ${row.name}`);
      await sleep(400);
    } catch (e) {
      console.warn('Fail:', t.url, e.message);
    }
  }

  const out = [...merged.values()].sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  const by = out.reduce((a, r) => {
    a[r.country] = (a[r.country] || 0) + 1;
    return a;
  }, {});
  console.log(`Wrote ${out.length} wide-search entries to ${OUT}`, by);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
