#!/usr/bin/env node
/**
 * Long-running China bidet crawler — Chinese websites only.
 *
 * Sources: Ctrip/Trip, Flyert, Qunar, Dianping, Mafengwo, Baidu/DuckDuckGo discovery.
 *
 * Usage:
 *   node scripts/crawl-china-web.cjs --minutes=90
 *   node scripts/crawl-china-web.cjs --minutes=90 --import
 */
const fs = require('fs');
const path = require('path');
const {
  sleep,
  fetchText,
  dates,
  extractCtripIds,
  parseCtripDetail,
  parseGenericChinesePage,
  extractFlyertHotels,
  extractUrlsFromSearch,
  BIDET_KW,
} = require('./lib/china-web.cjs');

const OUT = path.join(__dirname, '../data/china-web-crawl-bidets.json');
const STATE = path.join(__dirname, '../data/china-crawl-state.json');
const CACHE = path.join(__dirname, '../data/china-geocode-cache.json');

const args = process.argv.slice(2);
const minArg = args.find((a) => a.startsWith('--minutes='));
const MINUTES = minArg ? Number(minArg.split('=')[1]) : 90;
const DO_IMPORT = args.includes('--import');

/** Tier-1/2 cities — Ctrip cityId + Chinese name */
const CITIES = [
  { city: 'Shanghai', cityCn: '上海', id: 2 },
  { city: 'Beijing', cityCn: '北京', id: 1 },
  { city: 'Guangzhou', cityCn: '广州', id: 32 },
  { city: 'Shenzhen', cityCn: '深圳', id: 30 },
  { city: 'Chengdu', cityCn: '成都', id: 28 },
  { city: 'Hangzhou', cityCn: '杭州', id: 17 },
  { city: 'Chongqing', cityCn: '重庆', id: 4 },
  { city: 'Nanjing', cityCn: '南京', id: 12 },
  { city: 'Suzhou', cityCn: '苏州', id: 14 },
  { city: 'Wuhan', cityCn: '武汉', id: 477 },
  { city: "Xi'an", cityCn: '西安', id: 10 },
  { city: 'Tianjin', cityCn: '天津', id: 3 },
  { city: 'Qingdao', cityCn: '青岛', id: 7 },
  { city: 'Dalian', cityCn: '大连', id: 6 },
  { city: 'Xiamen', cityCn: '厦门', id: 25 },
  { city: 'Kunming', cityCn: '昆明', id: 34 },
  { city: 'Changsha', cityCn: '长沙', id: 206 },
  { city: 'Zhengzhou', cityCn: '郑州', id: 559 },
  { city: 'Jinan', cityCn: '济南', id: 144 },
  { city: 'Harbin', cityCn: '哈尔滨', id: 5 },
  { city: 'Shenyang', cityCn: '沈阳', id: 451 },
  { city: 'Ningbo', cityCn: '宁波', id: 375 },
  { city: 'Foshan', cityCn: '佛山', id: 251 },
  { city: 'Dongguan', cityCn: '东莞', id: 223 },
  { city: 'Hefei', cityCn: '合肥', id: 278 },
  { city: 'Fuzhou', cityCn: '福州', id: 258 },
  { city: 'Wuxi', cityCn: '无锡', id: 13 },
  { city: 'Sanya', cityCn: '三亚', id: 43 },
  { city: 'Guiyang', cityCn: '贵阳', id: 38 },
  { city: 'Nanning', cityCn: '南宁', id: 380 },
  { city: 'Wenzhou', cityCn: '温州', id: 491 },
  { city: 'Changchun', cityCn: '长春', id: 158 },
  { city: 'Urumqi', cityCn: '乌鲁木齐', id: 39 },
  { city: 'Lanzhou', cityCn: '兰州', id: 231 },
  { city: 'Lhasa', cityCn: '拉萨', id: 36 },
];

const CHAIN_KW = [
  '亚朵', '全季', '桔子', '秋果', '美居', '维也纳', '如家', '万豪', '希尔顿', '洲际',
  '凯悦', '香格里拉', '丽思', '瑞吉', '柏悦', 'W酒店', '艾迪逊', '安达仕', '悦榕庄',
  '喜来登', '威斯汀', '智选假日', '皇冠假日', '诺富特', '温德姆', '凯宾斯基', '文华东方',
];

const SEARCH_QUERIES = (cityCn) => [
  `site:hotels.ctrip.com ${cityCn} 智能马桶`,
  `site:hotels.ctrip.com ${cityCn} 卫洗丽`,
  `site:flyert.com.cn ${cityCn} 智能马桶 酒店`,
  `site:flyert.com.cn ${cityCn} 卫洗丽`,
  `site:dianping.com ${cityCn} 智能马桶 酒店`,
  `site:mafengwo.cn ${cityCn} 智能马桶 酒店`,
  `site:hotel.qunar.com ${cityCn} 智能马桶`,
  `site:trip.com ${cityCn} smart toilet hotel`,
  `site:toto.com.cn ${cityCn} 卫洗丽`,
];

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return {
      hotelQueue: [],
      urlQueue: [],
      processedHotels: {},
      processedUrls: {},
      cityIndex: 0,
      queryIndex: 0,
      stats: { ctrip: 0, flyert: 0, generic: 0, added: 0 },
    };
  }
}

function saveState(s) {
  s.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n');
}

function loadOut() {
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    return [];
  }
}

function saveOut(rows) {
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n');
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

function normName(n) {
  return String(n).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function mergeRow(rows, row) {
  const key = `${normName(row.name)}|${Number(row.latitude).toFixed(4)}|${Number(row.longitude).toFixed(4)}`;
  const map = new Map(
    rows.map((r) => [`${normName(r.name)}|${Number(r.latitude).toFixed(4)}|${Number(r.longitude).toFixed(4)}`, r])
  );
  if (!map.has(key)) map.set(key, row);
  return [...map.values()];
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
  const cc = p.countrycode === 'CN' ? 'China' : p.country;
  if (cc !== 'China' && p.countrycode !== 'CN') return null;
  const result = {
    lat: String(lat),
    lon: String(lon),
    display: [p.name, p.street, p.city, p.state, p.country].filter(Boolean).join(', '),
    city: p.city || '',
  };
  cache[query] = result;
  saveCache(cache);
  await sleep(200);
  return result;
}

async function geocodeRow(name, address, city, cityCn, cache) {
  const queries = [
    address ? `${address}, China` : null,
    `${name}, ${cityCn || city}, China`,
    `${name}, ${city}, China`,
    `${name} hotel China`,
  ].filter(Boolean);
  for (const q of queries) {
    const g = await geocode(q, cache);
    if (g) return g;
  }
  return null;
}

function toRow(parsed, city, sourceLabel, cnName) {
  return {
    name: parsed.name || cnName,
    address: parsed.address || '',
    city: city.city,
    type: /机场|航站楼/.test(parsed.name || cnName || '') ? 'public' : 'hotel',
    bidetStatus: 'warmed',
    bidetType: /卫洗丽|WASHLET|TOTO/i.test(parsed.sourceQuote || '') ? 'TOTO WASHLET (卫洗丽)' : 'Smart toilet (智能马桶)',
    sourceUrl: parsed.sourceUrl,
    sourceQuote: `${sourceLabel}: ${parsed.sourceQuote}`,
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only — verify before visiting',
    ...(cnName && cnName !== parsed.name ? { searchAliases: [cnName] } : {}),
  };
}

async function discoverCtripCity(city, state) {
  const { cin, cout } = dates();
  const known = new Set(state.hotelQueue.map((h) => h.id));
  let added = 0;

  const keywords = ['智能马桶', '卫洗丽', '智能坐便器', ...CHAIN_KW.slice(0, 8).map((c) => `${c} 智能马桶`)];
  for (const kw of keywords) {
    const url =
      `https://hotels.ctrip.com/hotels/list?city=${city.id}&checkin=${cin}&checkout=${cout}` +
      `&optionId=${city.id}&optionType=City&keyword=${encodeURIComponent(kw)}`;
    try {
      const html = await fetchText(url);
      for (const id of extractCtripIds(html)) {
        if (state.processedHotels[id] || known.has(id)) continue;
        known.add(id);
        state.hotelQueue.push({ id, city: city.city, cityCn: city.cityCn, via: `ctrip:${kw.slice(0, 8)}` });
        added++;
      }
      await sleep(400);
    } catch (e) {
      console.warn('Ctrip list:', city.cityCn, kw.slice(0, 6), e.message);
    }
  }

  const tripUrl =
    `https://www.trip.com/hotels/list?city=${city.id}&cityName=${encodeURIComponent(city.city)}` +
    `&checkIn=${cin}&checkOut=${cout}&searchWord=${encodeURIComponent('智能马桶')}`;
  try {
    const html = await fetchText(tripUrl);
    for (const id of extractCtripIds(html)) {
      if (state.processedHotels[id] || known.has(id)) continue;
      known.add(id);
      state.hotelQueue.push({ id, city: city.city, cityCn: city.cityCn, via: 'trip' });
      added++;
    }
    await sleep(400);
  } catch {
    /* skip */
  }

  console.log(`Discover ${city.cityCn}: +${added} hotel IDs (queue ${state.hotelQueue.length})`);
}

async function processHotelBatch(state, rows, cache, batch = 12) {
  const batchItems = state.hotelQueue.splice(0, batch);
  for (const item of batchItems) {
    if (state.processedHotels[item.id]) continue;
    state.processedHotels[item.id] = Date.now();

    let parsed = null;
    try {
      const html = await fetchText(`https://hotels.ctrip.com/hotels/${item.id}.html`);
      parsed = parseCtripDetail(html, item.id);
      await sleep(300);
    } catch (e) {
      console.warn('Ctrip detail', item.id, e.message);
    }

    if (!parsed?.hasBidet) continue;
    state.stats.ctrip++;

    const geo = await geocodeRow(parsed.name, parsed.address, item.city, item.cityCn, cache);
    if (!geo) {
      console.warn('No geocode:', parsed.name);
      continue;
    }

    const row = {
      ...toRow(parsed, { city: item.city }, '携程 Ctrip', null),
      latitude: geo.lat,
      longitude: geo.lon,
      address: parsed.address || geo.display.split(',').slice(0, 5).join(', '),
      city: item.city,
    };

    const merged = mergeRow(rows, row);
    rows.length = 0;
    rows.push(...merged);
    state.stats.added++;
    console.log(`+ [${item.city}] ${row.name}`);
    saveOut(rows);
  }
}

async function searchDiscovery(state) {
  const city = CITIES[state.cityIndex % CITIES.length];
  const queries = SEARCH_QUERIES(city.cityCn);
  const q = queries[state.queryIndex % queries.length];
  state.queryIndex++;

  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const html = await fetchText(url);
    const urls = extractUrlsFromSearch(html).filter((u) => !state.processedUrls[u]);
    let added = 0;
    for (const u of urls) {
      if (state.processedUrls[u]) continue;
      if (!/ctrip|trip\.com|flyert|qunar|dianping|mafengwo|toto\.com\.cn/i.test(u)) continue;
      state.urlQueue.push({ url: u, city: city.city, cityCn: city.cityCn, query: q });
      added++;
    }
    console.log(`Search [${city.cityCn}] "${q.slice(0, 40)}…" → +${added} URLs`);
    await sleep(1200);
  } catch (e) {
    console.warn('Search fail:', e.message);
  }

  if (state.queryIndex % queries.length === 0) state.cityIndex++;
}

async function processUrlBatch(state, rows, cache, batch = 8) {
  const items = state.urlQueue.splice(0, batch);
  for (const item of items) {
    if (state.processedUrls[item.url]) continue;
    state.processedUrls[item.url] = Date.now();

    try {
      if (/flyert\.com\.cn/i.test(item.url)) {
        const html = await fetchText(item.url);
        const hotels = extractFlyertHotels(html);
        for (const h of hotels) {
          state.stats.flyert++;
          const geo = await geocodeRow(h.cnName, '', item.city, item.cityCn, cache);
          if (!geo) continue;
          const row = {
            name: h.cnName,
            address: geo.display.split(',').slice(0, 5).join(', '),
            latitude: geo.lat,
            longitude: geo.lon,
            city: item.city,
            type: 'hotel',
            bidetStatus: 'warmed',
            bidetType: BIDET_KW.test(h.quote) && /卫洗丽|TOTO/i.test(h.quote) ? 'TOTO WASHLET (卫洗丽)' : 'Smart toilet (智能马桶)',
            sourceUrl: item.url,
            sourceQuote: `飞客 Flyert: ${h.quote}`,
            verifiedMethod: 'web-source',
            access: 'limited',
            accessNote: 'Hotel guests only',
            searchAliases: [h.cnName],
          };
          const merged = mergeRow(rows, row);
          rows.length = 0;
          rows.push(...merged);
          state.stats.added++;
          console.log(`+ [Flyert ${item.city}] ${h.cnName}`);
          saveOut(rows);
        }
        await sleep(400);
        continue;
      }

      const html = await fetchText(item.url);
      const parsed = parseGenericChinesePage(html, item.url);
      if (!parsed?.hasBidet) continue;
      state.stats.generic++;

      const geo = await geocodeRow(parsed.name, parsed.address, item.city, item.cityCn, cache);
      if (!geo) continue;

      const label = /ctrip/i.test(item.url)
        ? '携程 Ctrip'
        : /qunar/i.test(item.url)
          ? '去哪儿 Qunar'
          : /dianping/i.test(item.url)
            ? '大众点评 Dianping'
            : /mafengwo/i.test(item.url)
              ? '马蜂窝 Mafengwo'
              : 'Chinese web';

      const row = {
        ...toRow(parsed, { city: item.city }, label, null),
        latitude: geo.lat,
        longitude: geo.lon,
        address: parsed.address || geo.display.split(',').slice(0, 5).join(', '),
        city: item.city,
      };
      const merged = mergeRow(rows, row);
      rows.length = 0;
      rows.push(...merged);
      state.stats.added++;
      console.log(`+ [${label} ${item.city}] ${row.name}`);
      saveOut(rows);
      await sleep(350);
    } catch (e) {
      console.warn('URL fail:', item.url.slice(0, 60), e.message);
    }
  }
}

async function flyertSearchBatch(state, rows, cache) {
  const pages = [
    'https://www.flyert.com.cn/search.php?mod=forum&srchtxt=' + encodeURIComponent('智能马桶 酒店'),
    'https://www.flyert.com.cn/search.php?mod=forum&srchtxt=' + encodeURIComponent('卫洗丽 酒店'),
    'https://www.flyert.com.cn/search.php?mod=forum&srchtxt=' + encodeURIComponent('智能马桶 亚朵'),
    'https://www.flyert.com.cn/search.php?mod=forum&srchtxt=' + encodeURIComponent('智能马桶 万豪'),
  ];
  const page = pages[state.stats.flyert % pages.length];
  try {
    const html = await fetchText(page);
    const threadUrls = [...new Set([...html.matchAll(/flyert\.com\.cn\/(?:forum\.php\?mod=viewthread[^"']+|a-\d+[^"']*)/gi)].map((m) => {
      const u = m[0];
      return u.startsWith('http') ? u : `https://www.${u}`;
    }))];
    for (const u of threadUrls.slice(0, 15)) {
      if (state.processedUrls[u]) continue;
      state.urlQueue.push({ url: u, city: 'China', cityCn: '中国', query: 'flyert-search' });
    }
    console.log(`Flyert search → +${Math.min(threadUrls.length, 15)} thread URLs`);
    await sleep(800);
  } catch (e) {
    console.warn('Flyert search:', e.message);
  }
}

function runImport() {
  const { execFileSync } = require('child_process');
  try {
    execFileSync('node', [path.join(__dirname, 'merge-china-crawl.cjs')], { stdio: 'inherit' });
    execFileSync('node', [path.join(__dirname, 'import-china.cjs')], { stdio: 'inherit' });
  } catch (e) {
    console.warn('Import failed:', e.message);
  }
}

async function main() {
  const end = Date.now() + MINUTES * 60 * 1000;
  const state = loadState();
  let rows = loadOut();
  const cache = loadCache();
  let cycle = 0;

  console.log(`China web crawler — ${MINUTES} min, Chinese sources focus`);
  console.log(`Output: ${OUT} | existing: ${rows.length} | hotel queue: ${state.hotelQueue.length}`);

  while (Date.now() < end) {
    cycle++;
    console.log(`\n=== Cycle ${cycle} ===`);

    const city = CITIES[state.cityIndex % CITIES.length];
    await discoverCtripCity(city, state);
    state.cityIndex++;

    await processHotelBatch(state, rows, cache, 15);
    await searchDiscovery(state);
    await processUrlBatch(state, rows, cache, 10);
    if (cycle % 3 === 0) await flyertSearchBatch(state, rows, cache);

    saveState(state);
    console.log(
      `Stats: ctrip=${state.stats.ctrip} flyert=${state.stats.flyert} generic=${state.stats.generic} ` +
        `added=${state.stats.added} rows=${rows.length} hQ=${state.hotelQueue.length} uQ=${state.urlQueue.length}`
    );

    if (DO_IMPORT && cycle % 5 === 0) runImport();
    await sleep(300);
  }

  saveState(state);
  saveOut(rows);
  console.log(`\nDone ${cycle} cycles. Total rows: ${rows.length}`);
  if (DO_IMPORT) runImport();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
