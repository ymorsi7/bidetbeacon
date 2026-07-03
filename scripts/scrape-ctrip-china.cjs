#!/usr/bin/env node
/**
 * Discover + scrape Ctrip/Trip.com hotels with explicit 智能马桶 / Smart Toilet evidence.
 * Cities: Shanghai (cityId 2), Beijing (cityId 1).
 *
 * Discovery: Trip.com list search + Ctrip list HTML + DuckDuckGo site search.
 * Evidence: hotel detail pages — room names, hotel description, facility lists.
 *
 * Output: data/china-ctrip-bidets.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '../data/china-ctrip-bidets.json');
const CACHE = path.join(__dirname, '../data/china-geocode-cache.json');

const CITIES = [
  { city: 'Shanghai', cityCn: '上海', ctripCityId: 2, tripCityId: 2 },
  { city: 'Beijing', cityCn: '北京', ctripCityId: 1, tripCityId: 1 },
];

/** Extra Ctrip hotel IDs from indexed search results (explicit 智能马桶 evidence). */
const SEED_IDS = {
  Shanghai: [
    '83987672', '52664875', '114501164', '470967', '109246526',
    '85469499', '67226468', '107335671', '116486898',
  ],
  Beijing: [
    '48611068', '113580910', '2306945', '2299625', '113612942',
  ],
};
const DDG_QUERIES = (cityCn) => [
  `site:hotels.ctrip.com/hotels ${cityCn} 智能马桶`,
  `site:hotels.ctrip.com/hotels ${cityCn} 智能马桶 亚朵`,
  `site:hotels.ctrip.com/hotels ${cityCn} 智能马桶 全季`,
  `site:hotels.ctrip.com/hotels ${cityCn} 智能马桶 桔子`,
  `site:hotels.ctrip.com/hotels ${cityCn} 智能马桶 秋果`,
  `site:hotels.ctrip.com/hotels ${cityCn} 智能马桶 美居`,
  `site:hotels.ctrip.com/hotels ${cityCn} 智能马桶 维也纳`,
  `site:hotels.ctrip.com/hotels ${cityCn} 智能马桶 如家`,
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : require('http');
    lib
      .get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
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

function decodeHtml(s) {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function dates() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const cin = d.toISOString().slice(0, 10);
  const d2 = new Date(d);
  d2.setDate(d2.getDate() + 1);
  const cout = d2.toISOString().slice(0, 10);
  return { cin, cout };
}

function extractCtripListHotels(html) {
  const ids = [...html.matchAll(/masterHotelId\\":\\"(\d+)\\"/g)].map((m) => m[1]);
  const names = [...html.matchAll(/class="hotelName[^"]*">([^<]+)</g)].map((m) =>
    decodeHtml(m[1].trim())
  );
  const out = [];
  for (let i = 0; i < Math.min(ids.length, names.length); i++) {
    out.push({ id: ids[i], name: names[i] });
  }
  return out;
}

function extractTripListHotels(html) {
  const ids = [
    ...new Set([
      ...[...html.matchAll(/hotelId["\s:=]+(\d{5,})/g)].map((m) => m[1]),
      ...[...html.matchAll(/hotel-detail-(\d+)/g)].map((m) => m[1]),
    ]),
  ];
  const names = [...html.matchAll(/class="[^"]*hotelName[^"]*"[^>]*>([^<]+)/gi)].map((m) =>
    decodeHtml(m[1].trim())
  );
  const out = ids.map((id, i) => ({ id, name: names[i] || '' }));
  return out;
}

function extractDdgHotelIds(html) {
  return [...new Set([...html.matchAll(/hotels\.ctrip\.com\/hotels\/(\d+)\.html/g)].map((m) => m[1]))];
}

function stripScripts(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
}

function extractChineseSentences(html, keyword) {
  const text = decodeHtml(stripScripts(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  const out = [];
  const re = new RegExp(`[^。；!！?？\n]{0,80}${keyword}[^。；!！?？\n]{0,120}`, 'g');
  for (const m of text.matchAll(re)) {
    const s = m[0].trim();
    if (s.length < 12) continue;
    if (/key\.|pluralsuffix|\\\\u|webpack|function\s*\(/i.test(s)) continue;
    if ((s.match(/[\u4e00-\u9fff]/g) || []).length < 4 && !/smart toilet|bidet/i.test(s)) continue;
    out.push(s.slice(0, 280));
  }
  return [...new Set(out)];
}

function extractAddress(html) {
  const texts = [
    ...html.matchAll(/"text":"((?:上海|北京)[^"]{6,100})"/g),
    ...html.matchAll(/\\"text\\":\\"((?:上海|北京)[^"\\]{6,100})\\"/g),
  ].map((m) => decodeHtml(m[1].trim()));

  const street = texts.find((t) => /[区县].*[路街道弄号院楼]/.test(t));
  if (street) return street;

  const intro = html.match(/酒店地址[：:]\s*([^<；;]+)/);
  if (intro) return decodeHtml(intro[1].trim());

  const jsonAddr = html.match(/"address":"([^"]{8,120})"/);
  if (jsonAddr) return decodeHtml(jsonAddr[1].trim());

  return texts.find((t) => /酒店|宾馆|饭店/.test(t)) || '';
}

function extractEvidence(html) {
  const roomNames = [
    ...new Set(
      [...html.matchAll(/class="room-name">([^<]*(?:智能马桶|Smart Toilet)[^<]*)/gi)].map((m) =>
        decodeHtml(m[1].trim())
      )
    ),
  ];

  const sentences = [
    ...extractChineseSentences(html, '智能马桶'),
    ...extractChineseSentences(html, 'Smart Toilet'),
  ];

  const evidence = [];
  if (roomNames.length) {
    evidence.push(`Room types list smart toilet: ${roomNames.slice(0, 3).join('; ')}`);
  }
  evidence.push(...sentences.slice(0, 3));
  return [...new Set(evidence)].filter((e) => e.length >= 12 && e.length <= 320);
}

function cleanQuote(q) {
  if (!q) return null;
  const s = q.replace(/\s+/g, ' ').trim();
  if (s.length < 12) return null;
  if (/key\.|pluralsuffix|webpack|function\s*\(/i.test(s)) return null;
  if (s.length > 200 && !/智能马桶/.test(s) && !/smart toilet/i.test(s)) return null;
  return s.slice(0, 280);
}

function hasBidetSignal(html) {
  const stripped = stripScripts(html);
  if (/class="room-name">[^<]*智能马桶/.test(stripped)) return true;
  if (/所有房间标配智能马桶|配备智能马桶|标配智能马桶|智能马桶，|智能马桶。/.test(stripped)) return true;
  if (/Smart Toilet/i.test(stripped) && /room|bathroom|toilet/i.test(stripped)) return true;
  const sentences = extractChineseSentences(stripped, '智能马桶');
  return sentences.length > 0;
}

function parseCtripDetail(html, hotelId) {
  const titleM = html.match(/<title>([^<]+)<\/title>/i);
  let name = titleM ? titleM[1].replace(/预订价格.*$/, '').trim() : '';
  name = decodeHtml(name);

  const address = extractAddress(html);
  const roomNames = [
    ...new Set(
      [...html.matchAll(/class="room-name">([^<]*(?:智能马桶|Smart Toilet)[^<]*)/gi)].map((m) =>
        decodeHtml(m[1].trim())
      )
    ),
  ];
  const evidence = extractEvidence(html).map(cleanQuote).filter(Boolean);

  return {
    name,
    address,
    sourceUrl: `https://hotels.ctrip.com/hotels/${hotelId}.html`,
    sourceQuote: evidence[0] || null,
    evidence,
    roomNames,
    hasBidet: hasBidetSignal(html),
  };
}

function parseTripDetail(html, hotelId, city) {
  const titleM = html.match(/<title>([^<]+)<\/title>/i);
  let name = titleM ? titleM[1].split('|')[0].split('-')[0].trim() : '';
  name = decodeHtml(name);

  const address = extractAddress(html);
  const evidence = extractEvidence(html).map(cleanQuote).filter(Boolean);
  const roomNames = [
    ...new Set(
      [...html.matchAll(/(?:Smart Toilet|智能马桶)[^<]{0,60}/gi)].map((m) =>
        decodeHtml(m[0].trim())
      ).filter((s) => s.length < 80 && !/key\./i.test(s))
    ),
  ];

  const slug = city === 'Shanghai' ? 'shanghai' : city === 'Beijing' ? 'beijing' : city.toLowerCase();
  return {
    name,
    address,
    sourceUrl: `https://www.trip.com/hotels/${slug}-hotel-detail-${hotelId}/`,
    sourceQuote: evidence[0] || null,
    evidence,
    roomNames,
    hasBidet: hasBidetSignal(html),
  };
}

async function geocode(query, cache) {
  if (cache[query]) return cache[query];
  const url = 'https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(query);
  const res = await fetch(url);
  const j = await res.json();
  const f = j.features?.[0];
  if (!f) return null;
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties;
  const display = [p.name, p.street, p.city, p.country].filter(Boolean).join(', ');
  const result = { lat: String(lat), lon: String(lon), display: display || query };
  cache[query] = result;
  saveCache(cache);
  await sleep(180);
  return result;
}

async function discoverHotelIds(city) {
  const { cin, cout } = dates();
  const seen = new Map();

  const tripUrl =
    `https://www.trip.com/hotels/list?city=${city.tripCityId}&cityName=${encodeURIComponent(city.city)}` +
    `&checkIn=${cin}&checkOut=${cout}&crn=1&adult=1&children=0&searchType=CT&optionId=${city.tripCityId}` +
    `&optionType=City&searchWord=${encodeURIComponent('smart toilet')}`;
  try {
    const html = await fetchText(tripUrl);
    for (const h of extractTripListHotels(html)) {
      if (h.id) seen.set(h.id, { ...h, via: 'trip-list' });
    }
    await sleep(400);
  } catch (e) {
    console.warn('Trip list failed:', city.city, e.message);
  }

  const ctripUrl =
    `https://hotels.ctrip.com/hotels/list?city=${city.ctripCityId}&checkin=${cin}&checkout=${cout}` +
    `&optionId=${city.ctripCityId}&optionType=City&keyword=${encodeURIComponent('智能马桶')}`;
  try {
    const html = await fetchText(ctripUrl);
    for (const h of extractCtripListHotels(html)) {
      if (h.id) seen.set(h.id, { ...h, via: 'ctrip-list' });
    }
    await sleep(400);
  } catch (e) {
    console.warn('Ctrip list failed:', city.city, e.message);
  }

  for (const q of DDG_QUERIES(city.cityCn)) {
    try {
      const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
      const html = await fetchText(url);
      for (const id of extractDdgHotelIds(html)) {
        if (!seen.has(id)) seen.set(id, { id, name: '', via: 'ddg' });
      }
      await sleep(1200);
    } catch (e) {
      console.warn('DDG failed:', q, e.message);
    }
  }

  for (const id of SEED_IDS[city.city] || []) {
    if (!seen.has(id)) seen.set(id, { id, name: '', via: 'seed' });
  }

  return [...seen.values()];
}

function normName(n) {
  return n.toLowerCase().replace(/[''`]/g, '').replace(/\s+/g, ' ').trim();
}

async function main() {
  const cache = loadCache();
  const rows = [];
  const seenNames = new Set();

  for (const city of CITIES) {
    console.log(`\n=== ${city.city} ===`);
    const hotels = await discoverHotelIds(city);
    console.log(`Discovered ${hotels.length} candidate hotel IDs`);

    for (let i = 0; i < hotels.length; i++) {
      const { id, name: hintName } = hotels[i];
      process.stderr.write(`[${i + 1}/${hotels.length}] ${city.city} #${id} ${hintName || ''}\n`);

      let parsed = null;
      try {
        const html = await fetchText(`https://hotels.ctrip.com/hotels/${id}.html`);
        parsed = parseCtripDetail(html, id);
        await sleep(350);
      } catch (e) {
        console.warn('Ctrip detail failed', id, e.message);
      }

      if (!parsed?.hasBidet || !parsed?.sourceQuote) {
        try {
          const slug = city.city === 'Shanghai' ? 'shanghai' : 'beijing';
          const html = await fetchText(`https://www.trip.com/hotels/${slug}-hotel-detail-${id}/`);
          const tripParsed = parseTripDetail(html, id, city.city);
          if (tripParsed.hasBidet && tripParsed.sourceQuote) parsed = tripParsed;
          await sleep(350);
        } catch {
          /* ignore */
        }
      }

      if (!parsed?.hasBidet || !parsed?.sourceQuote) continue;

      const name = parsed.name || hintName;
      if (!name) continue;
      const key = normName(name);
      if (seenNames.has(key)) continue;
      seenNames.add(key);

      const addrClean = (parsed.address || '').trim();
      let geo = await geocode(
        addrClean ? `${addrClean}, China` : `${name}, ${city.city}, China`,
        cache
      );
      if (!geo) {
        geo = await geocode(`${name}, ${city.city}, China`, cache);
      }
      if (!geo) {
        console.warn('No geocode:', name);
        continue;
      }

      rows.push({
        name,
        address: addrClean || geo.display.split(',').slice(0, 4).join(', '),
        latitude: geo.lat,
        longitude: geo.lon,
        city: city.city,
        type: 'hotel',
        bidetStatus: 'warmed',
        bidetType: parsed.roomNames?.length
          ? 'Smart toilet (智能马桶)'
          : 'Smart toilet / bidet seat',
        sourceUrl: parsed.sourceUrl,
        sourceQuote: `Ctrip/Trip.com listing: ${parsed.sourceQuote}`,
        verifiedMethod: 'web-source',
        access: 'limited',
        accessNote: 'Hotel guests only',
        ...(hintName && hintName !== name ? { searchAliases: [hintName] } : {}),
      });
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n');
  console.log(`\nWrote ${rows.length} Ctrip/Trip.com entries to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
