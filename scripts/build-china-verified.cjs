#!/usr/bin/env node
/**
 * Merge TOTO China scrape + supplemental web/community sources into
 * data/china-verified-bidets.json (deduped by normalized name).
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '../data/china-verified-bidets.json');
const TOTO = path.join(__dirname, '../data/china-toto-projects.json');
const CTRIP = path.join(__dirname, '../data/china-ctrip-bidets.json');

/** Guest reviews, Flyert, official amenity pages — explicit 智能马桶/bidet evidence */
const SUPPLEMENTAL = [
  {
    name: 'The St. Regis Shanghai Jing An',
    address: '1008 West Beijing Road, Jing\'an District, Shanghai',
    latitude: '31.242800',
    longitude: '121.445500',
    city: 'Shanghai',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Smart toilet (智能马桶)',
    sourceUrl: 'http://www.qiantaohotel.com/homeweb/NewHomeWeb/M1362197.html',
    sourceQuote:
      'Qiantao hotel listing for St. Regis Shanghai Jing An: bathroom amenities include 智能马桶 across room categories',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
    searchAliases: ['上海静安瑞吉酒店', 'St Regis Jing An'],
  },
  {
    name: 'Capella Sanya',
    address: 'Tufu Bay, Haitang Bay, Sanya, Hainan',
    latitude: '18.312000',
    longitude: '109.742000',
    city: 'Sanya',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Smart toilet (智能马桶)',
    sourceUrl: 'https://www.flyert.com.cn/forum.php?mod=viewthread&tid=4709663',
    sourceQuote:
      'Flyert review (pool villa): smart toilet is standard in luxury hotel bathrooms (智能马桶也是奢华酒店的标配)',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
    searchAliases: ['三亚嘉佩乐', '土福湾嘉佩乐', 'Capella Tufu Bay'],
  },
  {
    name: 'JW Marriott Hotel Xi\'an Gaoxin',
    address: '333 Fengcheng 9th Road, High-tech Zone, Xi\'an',
    latitude: '34.232000',
    longitude: '108.895000',
    city: 'Xi\'an',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Smart toilet (智能马桶)',
    sourceUrl: 'https://www.flyert.com.cn/a-525646-1.html',
    sourceQuote:
      'Flyert review: bathroom has smart toilet that works well (智能马桶好用), plus separate tub and rain shower',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
    searchAliases: ['西安高新JW万豪酒店'],
  },
  {
    name: 'InterContinental Chongqing TFT',
    address: 'TFT Building, Yuzhong District, Chongqing',
    latitude: '29.556000',
    longitude: '106.578000',
    city: 'Chongqing',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Smart toilet',
    sourceUrl: 'https://www.flyert.com.cn/portal.php?aid=521545&mod=view',
    sourceQuote:
      'Flyert review: all guest rooms include smart toilets (智能马桶) as standard in-room amenity',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
    searchAliases: ['洲至奢选重庆TFT酒店', '重庆TFT酒店'],
  },
  {
    name: 'Sheraton Xi\'an Chanba',
    address: '8 Chanhe East Road, Chanba Ecological District, Xi\'an',
    latitude: '34.320000',
    longitude: '109.060000',
    city: 'Xi\'an',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Smart toilet (智能马桶)',
    sourceUrl: 'https://www.flyert.com.cn/forum.php?mod=viewthread&tid=4844472',
    sourceQuote:
      'Flyert review: ensuite has separate bathtub plus smart toilet (智能马桶); Dyson hair dryer also noted',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
    searchAliases: ['西安浐灞喜来登酒店', '西安灞河喜来登'],
  },
  {
    name: 'Hyatt Centric The Langbo Chengdu',
    address: 'Near Chunxi Road, Jinjiang District, Chengdu',
    latitude: '30.657000',
    longitude: '104.080000',
    city: 'Chengdu',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Smart toilet',
    sourceUrl: 'https://www.flyert.com.cn/portal.php?aid=521490&mod=view',
    sourceQuote:
      'Flyert review: ensuite bathroom equipped with smart toilet (智能马桶)',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
    searchAliases: ['成都瑯珀凯悦臻选酒店', '成都瑯珀酒店'],
  },
  {
    name: 'Hyatt Regency Jingdezhen Taoxichuan',
    address: 'Taoxichuan, Jingdezhen, Jiangxi',
    latitude: '29.293000',
    longitude: '117.214000',
    city: 'Jingdezhen',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Kohler smart toilet',
    sourceUrl: 'https://www.flyert.com.cn/forum.php?mod=viewthread&tid=4568783',
    sourceQuote:
      'Flyert review: bathroom has fully sensor-activated Kohler smart toilet (科勒智能马桶) with full washlet functions',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
    searchAliases: ['景德镇陶溪川凯悦臻选酒店'],
  },
  {
    name: 'Courtyard by Marriott Nanjing Jiangning',
    address: '88 Shengzhou Road, Jiangning District, Nanjing',
    latitude: '31.953000',
    longitude: '118.839000',
    city: 'Nanjing',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'TOTO smart toilet',
    sourceUrl: 'https://www.flyert.com.cn/portal.php?aid=497809&mod=view',
    sourceQuote:
      'Flyert review: executive suite has smart toilets in both guest and main bathrooms; main bath fixtures are TOTO',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
    searchAliases: ['南京金轮万怡酒店'],
  },
  {
    name: 'Holiday Inn Express Guangzhou Baiyun Airport T2',
    address: 'Guangzhou Baiyun International Airport Terminal 2, Guangzhou',
    latitude: '23.392000',
    longitude: '113.299000',
    city: 'Guangzhou',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'TOTO Washlet (卫洗丽)',
    sourceUrl: 'https://www.flyert.com.cn/a-527614-1.html',
    sourceQuote:
      'Flyert review: even standard HIX rooms include TOTO Washlet smart toilet (智能马桶卫洗丽) with auto lid, wash, and warm-air dry',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
    searchAliases: ['广州白云机场智选假日'],
  },
  {
    name: 'Holiday Inn Express Taizhou Jiaoji',
    address: 'Jiaoji, Taizhou, Zhejiang',
    latitude: '28.656000',
    longitude: '121.420000',
    city: 'Taizhou',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Smart toilet',
    sourceUrl: 'https://www.flyert.com.cn/portal.php?aid=521794&mod=view',
    sourceQuote:
      'Flyert review: newly opened hotel rooms include smart toilet (智能马桶) in bathroom',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
    searchAliases: ['台州椒江智选假日酒店'],
  },
  {
    name: 'The Langham, Shanghai, Xintiandi',
    address: '99 Madang Road, Huangpu District, Shanghai',
    latitude: '31.221500',
    longitude: '121.475800',
    city: 'Shanghai',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Automated bidet toilet',
    sourceUrl: 'https://www.forbestravelguide.com/hotels/shanghai-china/the-langham-shanghai-xintiandi',
    sourceQuote:
      'Forbes Travel Guide: bathroom includes an automated toilet (bidet-style smart seat)',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
  },
  {
    name: 'Amara Shanghai',
    address: 'Jing\'an District, Shanghai',
    latitude: '31.247000',
    longitude: '121.440000',
    city: 'Shanghai',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Smart toilet',
    sourceUrl: 'https://www.laughtraveleat.com/asia/amara-shanghai-hotel-review/',
    sourceQuote:
      'Travel review: all rooms include a smart toilet in the bathroom',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
  },
  {
    name: 'Conrad Shanghai',
    address: 'Shimao International Plaza, 5 Nanjing East Road, Shanghai',
    latitude: '31.234500',
    longitude: '121.473800',
    city: 'Shanghai',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Japanese bidet toilet seat',
    sourceUrl: 'https://www.theflightclub.it/en/2025/04/conrad-shanghai-review/',
    sourceQuote:
      'Hotel review (2025): circular bathroom includes Japanese toilet seat with bidet/washlet functions',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
  },
  {
    name: 'Howard Johnson Huaihai Hotel Shanghai',
    address: '1 Fenyang Road, Xuhui District, Shanghai 200031',
    latitude: '31.210000',
    longitude: '121.447000',
    city: 'Shanghai',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Smart toilet / electronic bidet seat',
    sourceUrl: 'https://us.trip.com/hotels/shanghai-hotel-detail-427622/howard-johnson-huaihai-hotel-shanghai/',
    sourceQuote:
      'Trip.com room categories list Smart Toilet; guest review: updated room with automatic toilet (electronic bidet seat)',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
    searchAliases: ['上海淮海宾馆', 'Huai Hai Hotel Shanghai'],
  },
  {
    name: 'Shanghai Rezen Estelle Hotel (Nanjing Road)',
    address: '337 Shandong Middle Road, Huangpu District, Shanghai',
    latitude: '31.2381767',
    longitude: '121.4798713',
    city: 'Shanghai',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Smart toilet with bidet function',
    sourceUrl: 'https://rezenestellehotel.com/ux_room/tranquil-double-bed-room/',
    sourceQuote:
      'Official hotel site: room bathroom has smart toilet with heated seat, bidet function, and auto-flush',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
    searchAliases: ['Rezen Estelle Bund', '丽呈东谷酒店'],
  },
  {
    name: 'Park Hyatt Shanghai',
    address: '100 Century Avenue, Pudong, Shanghai (check-in 87th floor)',
    latitude: '31.2365768',
    longitude: '121.5030406',
    city: 'Shanghai',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'TOTO Washlet',
    sourceUrl: 'https://onetechtraveller.com/park-hyatt-shanghai-review/',
    sourceQuote:
      'Guest review: rooms fitted with automatic bidet toilets (Toto washlet) that lift the lid when you enter; separate powder room houses Toto washlet',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
  },
  {
    name: 'The St. Regis Shanghai Pudong',
    address: '528 Pudong South Road, Pudong, Shanghai',
    latitude: '31.228500',
    longitude: '121.505500',
    city: 'Shanghai',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'Japanese-style smart toilet',
    sourceUrl: 'https://www.travelarbitrage.net/en/blog/st-regis-shanghai-pudong-2026/',
    sourceQuote:
      'Travel review (2026): Grand Deluxe rooms and above include a Japanese-style smart toilet in the bathroom',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only; Grand Deluxe category and above',
  },
  {
    name: 'Andaz Xintiandi, Shanghai',
    address: '88 Songshan Road, Huangpu District, Shanghai',
    latitude: '31.222800',
    longitude: '121.473500',
    city: 'Shanghai',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'TOTO electronic bidet toilet',
    sourceUrl: 'https://www.luxurytraveldiary.com/2022/11/andaz-xintiandi-shanghai-review/',
    sourceQuote:
      'Travel review: bathroom outfitted with electronic Toto toilet (bidet seat); motion-controlled lid and wash functions',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
  },
  {
    name: 'Bvlgari Hotel Shanghai',
    address: '108 North Shanxi Road, Jing\'an District, Shanghai',
    latitude: '31.247500',
    longitude: '121.454800',
    city: 'Shanghai',
    type: 'hotel',
    bidetStatus: 'warmed',
    bidetType: 'TOTO smart toilet',
    sourceUrl: 'https://www.michelinkeyhotels.com/hotels/bvlgari-hotel-shanghai',
    sourceQuote:
      'Michelin Keys hotel guide: marble bathrooms feature Toto smart toilets (bidet-style electronic seats)',
    verifiedMethod: 'web-source',
    access: 'limited',
    accessNote: 'Hotel guests only',
  },
];

function normName(name) {
  return name
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeKey(row) {
  return normName(row.name);
}

const toto = fs.existsSync(TOTO) ? JSON.parse(fs.readFileSync(TOTO, 'utf8')) : [];
const ctrip = fs.existsSync(CTRIP) ? JSON.parse(fs.readFileSync(CTRIP, 'utf8')) : [];
const merged = [];
const seen = new Set();

for (const row of [...toto, ...ctrip, ...SUPPLEMENTAL]) {
  if (!row.sourceUrl || !row.sourceQuote) continue;
  const key = dedupeKey(row);
  if (seen.has(key)) continue;
  seen.add(key);
  const clean = { ...row };
  if (!clean.searchAliases) delete clean.searchAliases;
  merged.push(clean);
}

merged.sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
fs.writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n');
console.log(
  `Wrote ${merged.length} China entries to ${OUT} (${toto.length} TOTO + ${ctrip.length} Ctrip + ${SUPPLEMENTAL.length} supplemental, deduped)`
);
