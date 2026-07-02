#!/usr/bin/env node
/**
 * Geocode all seed entries and fix lat/lng (and some addresses) when >150m off.
 * Authoritative manual overrides for mosques with known-good coordinates.
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '../index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const seed = JSON.parse(html.match(/window\.BIDETBEACON_SEED\s*=\s*(\[[\s\S]*?\]);/)[1]);

/** Official / verified coordinates — override geocoder when present */
const MANUAL = {
  'Berkeley Masjid': {
    latitude: '37.8619778',
    longitude: '-122.2526999',
  },
  'Islamic Society of Colorado Springs': {
    latitude: '38.8639254',
    longitude: '-104.8359241',
  },
  'London Central Mosque': {
    latitude: '51.529167',
    longitude: '-0.165278',
  },
  'Masjid Al Ansar': {
    address: '1717 S Brookhurst St, Anaheim, CA 92804',
    city: 'Anaheim, CA',
    latitude: '33.8056321',
    longitude: '-117.9593752',
  },
  'Cairo Restaurant and Cafe': {
    address: '10832 W Katella Ave, Anaheim, CA 92804',
    city: 'Anaheim, CA',
    latitude: '33.8033311',
    longitude: '-117.9593359',
  },
  'Muslim Community Center San Diego': {
    address: '14698 Via Fiesta, San Diego, CA 92127',
    city: 'San Diego, CA',
    latitude: '32.9918672',
    longitude: '-117.164856',
  },
  'Islamic Center of San Diego': {
    latitude: '32.8205714',
    longitude: '-117.1654667',
  },
  'King Fahad Mosque': {
    latitude: '34.011522',
    longitude: '-118.410197',
  },
  'Islamic Society of Orange County': {
    latitude: '33.755813',
    longitude: '-117.9570504',
  },
  'Islamic Center of Irvine': {
    address: '2 Truman St, Irvine, CA 92620',
    latitude: '33.696526',
    longitude: '-117.765513',
  },
  'Muslim Community Association': {
    latitude: '37.3772243',
    longitude: '-121.959468',
  },
  'Islamic Society of Baltimore': {
    latitude: '39.3034924',
    longitude: '-76.7480395',
  },
  'Dar Al Taqwa': {
    latitude: '39.2367098',
    longitude: '-76.8845055',
  },
  'Masjid Esa Ibn Maryam': {
    latitude: '41.2053491',
    longitude: '-73.1183201',
  },
  'Islamic Center of Wallingford': {
    latitude: '41.4504216',
    longitude: '-72.8228924',
  },
  'Islamic Center of Riverside': {
    latitude: '33.9788570',
    longitude: '-117.3344300',
  },
  'Milpitas Musallah': {
    latitude: '37.4335176',
    longitude: '-121.8855331',
  },
  'Islamic Community of Salinas (Salinas Masjid)': {
    latitude: '36.6776547',
    longitude: '-121.6564408',
  },
};

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(n) {
  return String(+n.toFixed(7));
}

async function photon(q) {
  const url = 'https://photon.komoot.io/api/?' + new URLSearchParams({ q, limit: '1' });
  const r = await fetch(url);
  const d = await r.json();
  if (!d.features[0]) return null;
  const [lng, lat] = d.features[0].geometry.coordinates;
  return { lat, lng };
}

async function nominatim(q) {
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({ q, format: 'json', limit: '1' });
  const r = await fetch(url, {
    headers: { 'User-Agent': 'BidetBeacon-Validator/1.0 (bidetbeacon)' },
  });
  const d = await r.json();
  if (!d[0]) return null;
  return { lat: +d[0].lat, lng: +d[0].lon };
}

async function geocodeEntry(x) {
  let q = x.address;
  if (x.city && !q.includes(x.city.split(',')[0])) q += ', ' + x.city;
  if (x.country && !/USA|UK|Canada/i.test(q)) q += ', ' + x.country;
  let g = await photon(q);
  if (!g) {
    await sleep(1100);
    g = await nominatim(q);
  }
  return g;
}

(async () => {
  const changes = [];
  const noGeocode = [];

  for (let i = 0; i < seed.length; i++) {
    const x = seed[i];
    const manual = MANUAL[x.name];
    if (manual) {
      const before = { ...x };
      Object.assign(x, manual);
      if (manual.latitude) x.latitude = fmt(+manual.latitude);
      if (manual.longitude) x.longitude = fmt(+manual.longitude);
      changes.push({ name: x.name, source: 'manual', before, after: { lat: x.latitude, lng: x.longitude, address: x.address } });
      continue;
    }

    const g = await geocodeEntry(x);
    if (!g) {
      noGeocode.push(x.name);
      await sleep(200);
      continue;
    }
    const dist = haversine(+x.latitude, +x.longitude, g.lat, g.lng);
    if (dist > 150) {
      const before = { lat: x.latitude, lng: x.longitude };
      x.latitude = fmt(g.lat);
      x.longitude = fmt(g.lng);
      changes.push({ name: x.name, source: 'geocode', distM: Math.round(dist), before, after: { lat: x.latitude, lng: x.longitude } });
    }
    await sleep(200);
    if ((i + 1) % 50 === 0) console.error(`progress ${i + 1}/${seed.length}`);
  }

  const newSeedJson = JSON.stringify(seed);
  const newHtml = html.replace(
    /window\.BIDETBEACON_SEED\s*=\s*\[[\s\S]*?\];/,
    `window.BIDETBEACON_SEED = ${newSeedJson};`
  );
  fs.writeFileSync(htmlPath, newHtml);

  const reportPath = path.join(__dirname, 'address-fix-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ changes, noGeocode }, null, 2));

  console.log('Updated', htmlPath);
  console.log('Changes:', changes.length, '(manual:', changes.filter((c) => c.source === 'manual').length + ')');
  console.log('No geocode:', noGeocode.length, noGeocode.slice(0, 20));
})();
