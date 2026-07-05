#!/usr/bin/env node
/**
 * Scrape KAYAK city hotel pages for Bidet amenity listings across LATAM cities.
 * Output: data/kayak-latam-bidets.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '../data/kayak-latam-bidets.json');

const CITIES = [
  { country: 'Mexico', city: 'Mexico City, CDMX', lat: '19.4326', lon: '-99.1332', url: 'https://www.kayak.com/Mexico-City-Hotels.14778.hotel.ksp' },
  { country: 'Mexico', city: 'Cancún, Quintana Roo', lat: '21.1619', lon: '-86.8515', url: 'https://www.kayak.com/Cancun-Hotels.14776.hotel.ksp' },
  { country: 'Mexico', city: 'Guadalajara, Jalisco', lat: '20.6597', lon: '-103.3496', url: 'https://www.kayak.com/Guadalajara-Hotels.14777.hotel.ksp' },
  { country: 'Mexico', city: 'Monterrey, Nuevo León', lat: '25.6866', lon: '-100.3161', url: 'https://www.kayak.com/Monterrey-Hotels.14781.hotel.ksp' },
  { country: 'Mexico', city: 'Puerto Vallarta, Jalisco', lat: '20.6534', lon: '-105.2253', url: 'https://www.kayak.com/Puerto-Vallarta-Hotels.14782.hotel.ksp' },
  { country: 'Mexico', city: 'Los Cabos, B.C.S.', lat: '22.8905', lon: '-109.9167', url: 'https://www.kayak.com/Los-Cabos-Hotels.14783.hotel.ksp' },
  { country: 'Mexico', city: 'Playa del Carmen, Quintana Roo', lat: '20.6296', lon: '-87.0739', url: 'https://www.kayak.com/Playa-Del-Carmen-Hotels.14784.hotel.ksp' },
  { country: 'Mexico', city: 'Tijuana, B.C.', lat: '32.5149', lon: '-117.0382', url: 'https://www.kayak.com/Tijuana-Hotels.14785.hotel.ksp' },
  { country: 'Colombia', city: 'Bogotá, Cundinamarca', lat: '4.7110', lon: '-74.0721', url: 'https://www.kayak.com/Bogota-Hotels.14779.hotel.ksp' },
  { country: 'Colombia', city: 'Medellín, Antioquia', lat: '6.2476', lon: '-75.5658', url: 'https://www.kayak.com/Medellin-Hotels.14786.hotel.ksp' },
  { country: 'Colombia', city: 'Cartagena, Bolívar', lat: '10.3910', lon: '-75.4794', url: 'https://www.kayak.com/Cartagena-Hotels.14787.hotel.ksp' },
  { country: 'Venezuela', city: 'Caracas, Distrito Capital', lat: '10.4806', lon: '-66.9036', url: 'https://www.kayak.com/Caracas-Hotels.14780.hotel.ksp' },
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

function extractHotels(html, country, city, listUrl) {
  if (!/Bidet/i.test(html)) return [];

  const rows = [];
  const seen = new Set();

  // Pattern: hotel result blocks with name + amenities containing Bidet
  const chunks = html.split(/"localizedName"\s*:\s*"Bidet"/i);
  for (let i = 1; i < chunks.length; i++) {
    const before = chunks[i - 1].slice(-4000);
    // find nearest hotel name before Bidet
    const names = [...before.matchAll(/"name"\s*:\s*"([^"\\]{4,100})"/g)];
    if (!names.length) continue;
    const name = names[names.length - 1][1].replace(/\\u0026/g, '&').trim();
    if (seen.has(name.toLowerCase())) continue;
    if (/^(Bidet|Hotel|Restaurants?|Free|Wi-?Fi)$/i.test(name)) continue;
    seen.add(name.toLowerCase());

    rows.push({
      name,
      country,
      city,
      type: 'hotel',
      bidetStatus: 'internet',
      bidetType: 'Bidet',
      sourceUrl: listUrl,
      sourceQuote: `KAYAK ${city} hotel listing: "${name}" includes Bidet among listed bathroom amenities.`,
      verifiedMethod: 'web-source',
      access: 'limited',
      accessNote: 'Hotel guests; verify room type',
    });
  }

  // Also try hotel slug pattern: "hotelName":"..."
  const hotelRe = /"hotelName"\s*:\s*"([^"]{4,100})"[\s\S]{0,3000}?"localizedName"\s*:\s*"Bidet"/gi;
  let m;
  while ((m = hotelRe.exec(html))) {
    const name = m[1].replace(/\\u0026/g, '&').trim();
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    rows.push({
      name,
      country,
      city,
      type: 'hotel',
      bidetStatus: 'internet',
      bidetType: 'Bidet',
      sourceUrl: listUrl,
      sourceQuote: `KAYAK ${city}: "${name}" lists Bidet as a hotel amenity.`,
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
    address: [p.street, p.housenumber, p.city, p.state].filter(Boolean).join(', '),
    city: [p.city, p.state].filter(Boolean).join(', ') || city,
  };
}

async function main() {
  const prior = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const merged = new Map();
  for (const r of prior) merged.set(`${r.name}|${r.country}`, r);

  for (const c of CITIES) {
    process.stderr.write(`KAYAK: ${c.city}\n`);
    try {
      const html = await fetchText(c.url);
      const hotels = extractHotels(html, c.country, c.city, c.url);
      console.log(`  ${c.city}: ${hotels.length} bidet hotels`);
      for (const row of hotels) {
        const geo = await geocode(row.name, c.city, c.country);
        if (geo) Object.assign(row, geo);
        else {
          row.latitude = c.lat;
          row.longitude = c.lon;
        }
        merged.set(`${row.name}|${row.country}`, row);
        await sleep(350);
      }
      await sleep(500);
    } catch (e) {
      console.warn('Fail:', c.url, e.message);
    }
  }

  const out = [...merged.values()].sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  const by = out.reduce((a, r) => {
    a[r.country] = (a[r.country] || 0) + 1;
    return a;
  }, {});
  console.log(`Wrote ${out.length} KAYAK LATAM hotels to ${OUT}`, by);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
