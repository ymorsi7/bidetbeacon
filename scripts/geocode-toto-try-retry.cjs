#!/usr/bin/env node
/**
 * Smarter retry pass for rows in data/toto-try-washlet.json that the first
 * geocode couldn't resolve. Strategy per row:
 *   1. Re-derive a confident country (phone/website); fix earlier mislabels.
 *   2. Structured Nominatim search (street + postcode + base city).
 *   3. Structured Nominatim postcode centroid (very reliable for DE/UK/NL/CZ).
 *   4. Free-form Nominatim, then Photon, as last resorts.
 * Reads country back from the geocoder (addressdetails) when the row's country
 * was only a guess. Permanently-closed listings are skipped.
 *
 * Usage: node scripts/geocode-toto-try-retry.cjs
 */
const fs = require('fs');
const path = require('path');
const lib = require('./lib/toto-try.cjs');

const DATA = path.join(__dirname, '../data/toto-try-washlet.json');
const CACHE = path.join(__dirname, '../data/toto-try-geocode-cache.json');

const CODE_COUNTRY = Object.fromEntries(
  Object.entries(lib.COUNTRY_CODE).map(([name, code]) => [code, name])
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
}
function saveCache(c) {
  fs.writeFileSync(CACHE, JSON.stringify(c, null, 2));
}

async function nominatimStructured(params, cache) {
  const key = 'noms:' + JSON.stringify(params);
  if (key in cache) return cache[key];
  const qs = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    limit: '1',
    ...params,
  });
  let out = null;
  try {
    const res = await fetch(
      'https://nominatim.openstreetmap.org/search?' + qs.toString(),
      { headers: { 'User-Agent': 'BidetBud/1.0 (github.com/bidetbud)' } }
    );
    const j = await res.json();
    const hit = j[0];
    if (hit) {
      out = {
        lat: hit.lat,
        lon: hit.lon,
        cc: hit.address && hit.address.country_code,
      };
    }
  } catch {}
  cache[key] = out;
  saveCache(cache);
  await sleep(1100);
  return out;
}

async function photon(query, cache) {
  const key = 'photon:' + query;
  if (key in cache) return cache[key];
  let out = null;
  try {
    const res = await fetch(
      'https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(query)
    );
    const j = await res.json();
    const f = j.features?.[0];
    if (f) {
      const [lon, lat] = f.geometry.coordinates;
      out = { lat: String(lat), lon: String(lon), cc: f.properties?.countrycode };
    }
  } catch {}
  cache[key] = out;
  saveCache(cache);
  await sleep(250);
  return out;
}

async function resolveRow(row, cache) {
  const confident =
    lib.countryFromPhone(row.phone) || lib.countryFromWebsite(row.website);
  const country = confident || row.country || null;
  const cc = country ? lib.COUNTRY_CODE[country] : undefined;
  const city = lib.baseCity(row.city);
  let street = lib.expandStreet(row.street || (row.address || '').split(',')[0]);
  if (country === 'UK') street = lib.reorderUkStreet(street);
  const pc = row.postcode;

  const attempts = [];
  // 1. Precise: street + postcode + city
  if (street && (pc || city))
    attempts.push({
      street,
      ...(pc ? { postalcode: pc } : {}),
      ...(city ? { city } : {}),
      ...(cc ? { countrycodes: cc } : {}),
    });
  // 2. Postcode + city centroid
  if (pc && city)
    attempts.push({
      postalcode: pc,
      city,
      ...(cc ? { countrycodes: cc } : {}),
    });
  // 3. Pure postcode centroid (needs a country bias to be meaningful)
  if (pc && cc) attempts.push({ postalcode: pc, countrycodes: cc });
  // 4. City centroid
  if (city) attempts.push({ city, ...(cc ? { countrycodes: cc } : {}) });

  for (const params of attempts) {
    const hit = await nominatimStructured(params, cache);
    if (hit) return { ...hit, confident: !!confident };
  }

  // 5. Photon free-form fallback
  const q = [street, [pc, city].filter(Boolean).join(' '), country]
    .filter(Boolean)
    .join(', ');
  const p = await photon(q, cache);
  if (p) return { ...p, confident: !!confident };

  return null;
}

async function main() {
  const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const cache = loadCache();

  const todo = rows.filter((r) => !r.latitude || !r.longitude);
  let resolved = 0;
  let stillFail = 0;
  let skippedClosed = 0;
  let countryFixed = 0;
  let done = 0;

  for (const row of todo) {
    done++;
    if (lib.isClosed(row)) {
      row.closed = true;
      skippedClosed++;
      continue;
    }
    const hit = await resolveRow(row, cache);
    if (hit) {
      row.latitude = String(hit.lat);
      row.longitude = String(hit.lon);
      // Fix country when the earlier value was only a guess.
      if (!hit.confident && hit.cc && CODE_COUNTRY[hit.cc.toLowerCase()]) {
        const geoCountry = CODE_COUNTRY[hit.cc.toLowerCase()];
        if (geoCountry !== row.country) {
          row.country = geoCountry;
          countryFixed++;
        }
      }
      resolved++;
    } else {
      stillFail++;
    }
    if (done % 10 === 0) {
      fs.writeFileSync(DATA, JSON.stringify(rows, null, 2) + '\n');
      console.log(`  ${done}/${todo.length} (resolved ${resolved}, fail ${stillFail})`);
    }
  }

  fs.writeFileSync(DATA, JSON.stringify(rows, null, 2) + '\n');
  console.log(
    `\nDone. Retried ${todo.length}: resolved ${resolved}, still ${stillFail}, ` +
      `closed-skipped ${skippedClosed}, country-fixed ${countryFixed}.`
  );
}

main();
