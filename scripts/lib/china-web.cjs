/**
 * Shared Ctrip/Trip.com parsing for China hotel bidet discovery.
 */
const https = require('https');

const BIDET_KW = /智能马桶|卫洗丽|诺锐斯特|智能坐便器|电子马桶|洗便功能|坐浴器|科勒智能|全自动马桶|Smart Toilet|WASHLET|NEOREST/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchText(url, lang = 'zh-CN') {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : require('http');
    lib
      .get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': `${lang},zh;q=0.9,en;q=0.8`,
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const next = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, url).href;
            fetchText(next, lang).then(resolve).catch(reject);
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

function decodeHtml(s) {
  return String(s)
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripScripts(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
}

function dates() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  const cin = d.toISOString().slice(0, 10);
  const d2 = new Date(d);
  d2.setDate(d2.getDate() + 1);
  return { cin, cout: d2.toISOString().slice(0, 10) };
}

function extractCtripIds(html) {
  return [
    ...new Set([
      ...[...html.matchAll(/masterHotelId\\":\\"(\d+)\\"/g)].map((m) => m[1]),
      ...[...html.matchAll(/hotels\.ctrip\.com\/hotels\/(\d+)\.html/g)].map((m) => m[1]),
      ...[...html.matchAll(/hotelId["\s:=]+(\d{5,})/g)].map((m) => m[1]),
    ]),
  ];
}

function extractChineseSentences(text, keyword) {
  const out = [];
  const re = new RegExp(`[^。；!！?？\\n]{0,100}${keyword}[^。；!！?？\\n]{0,140}`, 'g');
  for (const m of text.matchAll(re)) {
    const s = m[0].trim();
    if (s.length < 10) continue;
    if (/key\.|webpack|function\s*\(|pluralsuffix/i.test(s)) continue;
    out.push(s.slice(0, 280));
  }
  return [...new Set(out)];
}

function extractEvidence(html) {
  const stripped = stripScripts(html);
  const text = decodeHtml(stripped.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

  const roomNames = [
    ...new Set(
      [...stripped.matchAll(/class="room-name">([^<]*(?:智能马桶|卫洗丽|Smart Toilet)[^<]*)/gi)].map((m) =>
        decodeHtml(m[1].trim())
      )
    ),
  ];

  const sentences = [
    ...extractChineseSentences(text, '智能马桶'),
    ...extractChineseSentences(text, '卫洗丽'),
    ...extractChineseSentences(text, '诺锐斯特'),
    ...extractChineseSentences(text, '智能坐便器'),
  ];

  const evidence = [];
  if (roomNames.length) evidence.push(`房型含智能马桶: ${roomNames.slice(0, 3).join('; ')}`);
  evidence.push(...sentences.slice(0, 4));
  return [...new Set(evidence)].filter((e) => e.length >= 10 && e.length <= 320);
}

function extractAddress(html, cityCn) {
  const texts = [
    ...html.matchAll(/"text":"([^"]{8,120})"/g),
    ...html.matchAll(/\\"text\\":\\"([^"\\]{8,120})\\"/g),
    ...html.matchAll(/酒店地址[：:]\s*([^<；;]+)/g),
    ...html.matchAll(/"address":"([^"]{8,120})"/g),
  ].map((m) => decodeHtml(m[1].trim()));

  const hit = texts.find((t) => (cityCn ? t.includes(cityCn) : true) && /[路街道弄号区县市省]/.test(t));
  return hit || texts.find((t) => /[路街道弄号]/.test(t)) || '';
}

function hasBidetSignal(html) {
  const s = stripScripts(html);
  if (BIDET_KW.test(s) && /房|卫生间|浴室|卫浴|厕所|马桶|room|bathroom|toilet/i.test(s)) return true;
  return extractEvidence(s).length > 0;
}

function cleanHotelTitle(name) {
  return decodeHtml(name)
    .replace(/预订价格.*$/i, '')
    .replace(/【携程酒店】/g, '')
    .replace(/[-_|].*携程.*$/i, '')
    .replace(/\s*-\s*Trip\.com.*$/i, '')
    .replace(/\(.*店\).*$/i, (m) => m) // keep branch in parens
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCtripDetail(html, hotelId) {
  const titleM = html.match(/<title>([^<]+)<\/title>/i);
  let name = titleM ? titleM[1].replace(/预订价格.*$/, '').replace(/\s*-\s*携程.*$/, '').trim() : '';
  name = cleanHotelTitle(name);
  const evidence = extractEvidence(html);
  const address = extractAddress(html);
  return {
    name,
    address,
    sourceUrl: `https://hotels.ctrip.com/hotels/${hotelId}.html`,
    sourceQuote: evidence[0] || null,
    evidence,
    hasBidet: hasBidetSignal(html) && evidence.length > 0,
  };
}

function parseGenericChinesePage(html, url) {
  const titleM = html.match(/<title>([^<]+)<\/title>/i);
  let name = titleM ? cleanHotelTitle(titleM[1].split(/[-_|]/)[0]) : '';
  if (name.length < 4 || /预订|携程|价格|【/.test(name)) {
    const h1 = html.match(/<h1[^>]*>([^<]{4,80})</i);
    if (h1) name = cleanHotelTitle(h1[1]);
  }
  const evidence = extractEvidence(html);
  if (!evidence.length || !hasBidetSignal(html)) return null;
  return {
    name,
    address: extractAddress(html),
    sourceUrl: url,
    sourceQuote: evidence[0],
    evidence,
    hasBidet: true,
  };
}

function extractFlyertHotels(html) {
  const rows = [];
  const text = decodeHtml(stripScripts(html).replace(/<[^>]+>/g, '\n'));
  const blocks = text.split(/\n+/).filter((l) => BIDET_KW.test(l) && l.length > 15 && l.length < 400);
  for (const block of blocks) {
    const hotelM = block.match(
      /([\u4e00-\u9fff]{2,30}(?:酒店|宾馆|饭店|万豪|希尔顿|洲际|凯悦|香格里拉|丽思|瑞吉|柏悦|W酒店|艾迪逊|安达仕|悦榕庄|喜来登|威斯汀|皇冠假日|智选假日|亚朵|全季|桔子|秋果|美居|维也纳|如家)[\u4e00-\u9fff]{0,20})/
    );
    if (!hotelM) continue;
    const cnName = hotelM[1].trim();
    if (/论坛|帖子|回复|收藏|分享/.test(cnName)) continue;
    rows.push({ cnName, quote: block.slice(0, 280) });
  }
  return rows;
}

function extractUrlsFromSearch(html) {
  const urls = new Set();
  for (const m of html.matchAll(/uddg=([^&"]+)/g)) {
    try {
      urls.add(decodeURIComponent(m[1]));
    } catch {
      /* skip */
    }
  }
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const u = m[1];
    if (/ctrip|trip\.com|flyert|qunar|dianping|mafengwo|toto\.com\.cn|booking/i.test(u)) urls.add(u);
  }
  return [...urls];
}

module.exports = {
  BIDET_KW,
  sleep,
  fetchText,
  decodeHtml,
  dates,
  extractCtripIds,
  extractEvidence,
  hasBidetSignal,
  parseCtripDetail,
  parseGenericChinesePage,
  extractFlyertHotels,
  extractUrlsFromSearch,
};
