#!/usr/bin/env node
/**
 * Discover Atly list URLs for Mexico, Colombia, Venezuela from sitemaps + probes.
 * Output: data/atly-latam-discovered-urls.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '../data/atly-latam-discovered-urls.json');

const SITEMAPS = [
  ...Array.from({ length: 5 }, (_, i) => `https://www.atly.com/static/sitemaps/gfe-steps-sitemap-${i}.xml`),
  ...Array.from({ length: 4 }, (_, i) => `https://www.atly.com/static/sitemaps/top-steps-sitemap-${i}.xml`),
];

const PROBE = [];
const COUNTRIES = ['mexico', 'colombia', 'venezuela'];
const CATS = [
  'best-bathroom-restaurant',
  'best-bathroom-coffee',
  'best-bathroom-hotel',
  'best-bathroom-halal',
  'best-bathroom-gluten-free',
  'best-bathroom-fine-dining',
  'best-bathroom-vegan-friendly',
  'best-bathroom-food',
  'best-bathroom-dinner-spots',
  'best-bathroom-tasting-menu',
];
const CITIES = {
  mexico: [
    'mexico-city',
    'ciudad-de-mexico',
    'cdmx',
    'cancun',
    'guadalajara',
    'monterrey',
    'puebla',
    'tijuana',
    'merida',
    'oaxaca',
    'playa-del-carmen',
    'tulum',
    'puerto-vallarta',
    'los-cabos',
    'san-miguel-de-allende',
    'queretaro',
    'leon',
    'polanco',
    'condesa',
    'coyoacan',
    'roma',
  ],
  colombia: ['bogota', 'medellin', 'cali', 'cartagena', 'barranquilla', 'bucaramanga', 'pereira'],
  venezuela: ['caracas', 'maracaibo', 'valencia', 'barquisimeto', 'merida', 'margarita'],
};

for (const country of COUNTRIES) {
  for (const cat of CATS) PROBE.push(`https://www.atly.com/${country}/${cat}`);
  for (const city of CITIES[country]) {
    for (const cat of CATS) PROBE.push(`https://www.atly.com/${country}/${city}/${cat}`);
  }
}

const GLUTEN = [
  'https://www.atly.com/best/gluten-free/hotel-mexico',
  'https://www.atly.com/best/gluten-free/mexico',
  'https://www.atly.com/best/gluten-free/colombia',
  'https://www.atly.com/best/gluten-free/colombia-bogota',
  'https://www.atly.com/best/halal/hotel-mexico',
  'https://www.atly.com/best/halal/dinner-mexico-ciudad-de-mexico',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'BidetBud/1.0 (atly-latam-discover)' } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

async function main() {
  const urls = new Set();

  for (const sm of SITEMAPS) {
    try {
      const xml = await fetchText(sm);
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const u = m[1];
        const pathPart = u.replace('https://www.atly.com/', '');
        if (/(?:^|\/)mexico(?:-|\/|$)/i.test(pathPart)) urls.add(u);
        if (/(?:^|\/)colombia(?:-|\/|$)/i.test(pathPart)) urls.add(u);
        if (/(?:^|\/)venezuela(?:-|\/|$)/i.test(pathPart)) urls.add(u);
      }
      await sleep(150);
    } catch (e) {
      console.warn('Sitemap fail:', sm, e.message);
    }
  }

  for (const u of [...PROBE, ...GLUTEN]) {
    try {
      const html = await fetchText(u);
      if (html.length > 8000 && !html.includes('Page not found')) urls.add(u);
      await sleep(100);
    } catch {
      /* skip */
    }
  }

  const arr = [...urls].sort();
  fs.writeFileSync(OUT, JSON.stringify(arr, null, 2) + '\n');
  const by = { Mexico: 0, Colombia: 0, Venezuela: 0 };
  for (const u of arr) {
    if (/\/mexico[-\/]|[-\/]mexico[-\/]/i.test(u)) by.Mexico++;
    else if (/\/colombia[-\/]|[-\/]colombia[-\/]/i.test(u)) by.Colombia++;
    else if (/\/venezuela[-\/]|[-\/]venezuela[-\/]/i.test(u)) by.Venezuela++;
  }
  console.log(`Wrote ${arr.length} LATAM Atly list URLs to ${OUT}`, by);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
