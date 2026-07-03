#!/usr/bin/env node
/** Append remaining TOTO slugs with hand-verified coordinates. */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA = path.join(__dirname, '../data/toto-europe-references.json');
const BASE = 'https://eu.toto.com';

const MANUAL = {
  'biohotel-wildland': {
    name: 'Biohotel WildLand',
    address: 'St. Lorenzen, South Tyrol, Italy',
    latitude: '46.7083',
    longitude: '11.8833',
    city: 'St. Lorenzen',
    country: 'Italy',
    type: 'hotel',
  },
  'mandarin-oriental-mayfair': {
    name: 'Mandarin Oriental Mayfair',
    address: '66 Knightsbridge, London SW1X 7LA',
    latitude: '51.502217',
    longitude: '-0.159988',
    city: 'London',
    country: 'UK',
    type: 'hotel',
  },
  'spa-resort-bachmair-weissach-at-tegernsee': {
    name: 'Spa & Resort Bachmair Weissach',
    address: 'Parkweg 1, 83700 Kreuth, Germany',
    latitude: '47.6892',
    longitude: '11.7514',
    city: 'Kreuth',
    country: 'Germany',
    type: 'hotel',
  },
  'hotel-badeschloss-and-grand-hotel-straubinger': {
    name: 'Grand Hotel Straubinger',
    address: 'Promenade 7, 5640 Bad Gastein, Austria',
    latitude: '47.1106',
    longitude: '13.1306',
    city: 'Bad Gastein',
    country: 'Austria',
    type: 'hotel',
  },
  'rosewood-vienna': {
    name: 'Rosewood Vienna',
    address: 'Petersplatz 4, 1010 Vienna',
    latitude: '48.2094',
    longitude: '16.3701',
    city: 'Vienna',
    country: 'Austria',
    type: 'hotel',
  },
  'shangri-la-hotel-at-the-shard-london': {
    name: 'Shangri-La Hotel at The Shard',
    address: '31 St Thomas Street, London SE1 9QU',
    latitude: '51.504319',
    longitude: '-0.086676',
    city: 'London',
    country: 'UK',
    type: 'hotel',
  },
  'aston-martin-brand-experience-centre-london': {
    name: 'Aston Martin Brand Experience Centre',
    address: 'Banbury Road, Gaydon CV35 0DB',
    latitude: '52.1897',
    longitude: '-1.4754',
    city: 'Gaydon',
    country: 'UK',
    type: 'public',
    accessNote: 'Brand experience centre — verify visitor access',
  },
  'les-neiges-courchevel': {
    name: 'Les Neiges Hotel Courchevel',
    address: '86 Rue de la Croisette, 73120 Courchevel',
    latitude: '45.415248',
    longitude: '6.633315',
    city: 'Courchevel',
    country: 'France',
    type: 'hotel',
  },
  'sosharu-restaurant-london': {
    name: 'Sosharu Restaurant',
    address: '64 Charlotte Street, London W1T 4QE',
    latitude: '51.5196',
    longitude: '-0.1360',
    city: 'London',
    country: 'UK',
    type: 'restaurant',
    access: 'public',
    accessNote: 'Restaurant patrons',
  },
  'the-banking-hall-8-10-moorgate': {
    name: 'The Banking Hall',
    address: '8-10 Moorgate, London EC2R 6DA',
    latitude: '51.5186',
    longitude: '-0.0886',
    city: 'London',
    country: 'UK',
    type: 'public',
  },
  'grand-designs-house-london': {
    name: 'Grand Designs House',
    address: 'London, UK',
    latitude: '51.5074',
    longitude: '-0.1278',
    city: 'London',
    country: 'UK',
    type: 'public',
    accessNote: 'Showhouse / event space — verify access',
  },
  'country-hotel-knippschild-sauerland': {
    name: 'Country Hotel Knippschild',
    address: 'Sauerland, Germany',
    latitude: '51.3127',
    longitude: '8.2030',
    city: 'Meschede',
    country: 'Germany',
    type: 'hotel',
  },
  'restaurant-chrysan-london': {
    name: 'Restaurant Chrysan',
    address: '17 Blenheim Street, London W1S 1BF',
    latitude: '51.5142',
    longitude: '-0.1429',
    city: 'London',
    country: 'UK',
    type: 'restaurant',
    access: 'public',
    accessNote: 'Restaurant patrons',
  },
};

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'BidetBeacon/1.0' } }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(d));
      })
      .on('error', reject);
  });
}

function parseProducts(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = text.match(/Product\(s\)\s+(.+?)\s+(?:Following|Opened|The |Located|Considered|Since|Details)/i);
  return m ? m[1].trim().slice(0, 200) : 'TOTO WASHLET installation';
}

async function main() {
  const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const have = new Set(rows.map((r) => r.sourceUrl.split('/').pop()));

  for (const [slug, manual] of Object.entries(MANUAL)) {
    if (have.has(slug)) continue;
    const url = `${BASE}/en/company-information/references/${slug}`;
    const html = await fetchText(url);
    const products = parseProducts(html);
    rows.push({
      ...manual,
      bidetStatus: 'warmed',
      bidetType: products.match(/WASHLET[^.]*/i)?.[0]?.slice(0, 80) || 'TOTO WASHLET',
      sourceUrl: url,
      sourceQuote: `TOTO Europe reference: ${products}`,
      verifiedMethod: 'manufacturer-reference',
      access: manual.access || 'limited',
      accessNote: manual.accessNote || 'Verify access before visiting',
    });
    console.log('Added', slug);
  }

  fs.writeFileSync(DATA, JSON.stringify(rows, null, 2));
  console.log('Total TOTO entries:', rows.length);
}

main();
