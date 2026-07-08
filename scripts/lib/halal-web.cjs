/**
 * Shared helpers for halal restaurant crawlers / importers.
 */
const https = require('https');
const { isHalalDefaultCountry } = require('./halal-default-countries.cjs');

const USER_AGENT = 'HalalBud/1.0 (+https://bidetbud.com/halal.html; community halal map)';

const ISO_TO_COUNTRY = {
  US: 'USA',
  GB: 'UK',
  UK: 'UK',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  SG: 'Singapore',
  MY: 'Malaysia',
  ID: 'Indonesia',
  FR: 'France',
  DE: 'Germany',
  ES: 'Spain',
  IT: 'Italy',
  NL: 'Netherlands',
  BE: 'Belgium',
  CH: 'Switzerland',
  AT: 'Austria',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  IE: 'Ireland',
  PT: 'Portugal',
  PL: 'Poland',
  CZ: 'Czech Republic',
  MX: 'Mexico',
  BR: 'Brazil',
  AR: 'Argentina',
  CL: 'Chile',
  CO: 'Colombia',
  VE: 'Venezuela',
  ZA: 'South Africa',
  AE: 'UAE',
  SA: 'Saudi Arabia',
  TR: 'Turkey',
  IN: 'India',
  PK: 'Pakistan',
  BD: 'Bangladesh',
  JP: 'Japan',
  KR: 'South Korea',
  CN: 'China',
  HK: 'Hong Kong',
  TW: 'Taiwan',
  PH: 'Philippines',
  TH: 'Thailand',
  VN: 'Vietnam',
  EG: 'Egypt',
  MA: 'Morocco',
  NG: 'Nigeria',
  KE: 'Kenya',
  RU: 'Russia',
  UA: 'Ukraine',
  GR: 'Greece',
  FI: 'Finland',
  HU: 'Hungary',
  RO: 'Romania',
};

const US_STATE_SUFFIX = new Set([
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi',
  'mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut',
  'vt','va','wa','wv','wi','wy','dc',
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run async work over items with a fixed concurrency limit. */
async function mapPool(items, worker, { concurrency = 12 } = {}) {
  const out = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  async function run() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: n }, run));
  return out;
}

function fetchText(url, opts = {}) {
  const maxRedirects = opts.maxRedirects ?? 5;
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? require('http') : https;
    lib
      .get(
        url,
        {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            ...(opts.headers || {}),
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
            const next = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, url).href;
            fetchText(next, { ...opts, maxRedirects: maxRedirects - 1 }).then(resolve).catch(reject);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            res.resume();
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

function countryFromCode(code) {
  if (!code) return '';
  const c = String(code).trim().toUpperCase();
  return ISO_TO_COUNTRY[c] || c;
}

function countryFromSlug(slug) {
  if (!slug) return '';
  const parts = slug.toLowerCase().split('-').filter(Boolean);
  if (!parts.length) return '';
  const last = parts[parts.length - 1];
  if (last.length === 2 && US_STATE_SUFFIX.has(last)) return 'USA';
  const tail2 = parts.slice(-2).join('-');
  const slugCountry = {
    uae: 'UAE',
    uk: 'UK',
    usa: 'USA',
    us: 'USA',
    mx: 'Mexico',
    ca: 'Canada',
    au: 'Australia',
    sg: 'Singapore',
    my: 'Malaysia',
    de: 'Germany',
    fr: 'France',
    es: 'Spain',
    it: 'Italy',
    nl: 'Netherlands',
    jp: 'Japan',
    kr: 'South Korea',
    cn: 'China',
    in: 'India',
    pk: 'Pakistan',
    bd: 'Bangladesh',
    tr: 'Turkey',
    sa: 'Saudi Arabia',
    qa: 'Qatar',
    kw: 'Kuwait',
    bh: 'Bahrain',
    om: 'Oman',
    eg: 'Egypt',
    ma: 'Morocco',
    ng: 'Nigeria',
    za: 'South Africa',
    br: 'Brazil',
    ar: 'Argentina',
    cl: 'Chile',
    co: 'Colombia',
    ve: 'Venezuela',
    ru: 'Russia',
    nz: 'New Zealand',
    ie: 'Ireland',
    be: 'Belgium',
    ch: 'Switzerland',
    at: 'Austria',
    se: 'Sweden',
    no: 'Norway',
    dk: 'Denmark',
    pl: 'Poland',
    pt: 'Portugal',
    gr: 'Greece',
    fi: 'Finland',
    hu: 'Hungary',
    ro: 'Romania',
    cz: 'Czech Republic',
    hk: 'Hong Kong',
    tw: 'Taiwan',
    th: 'Thailand',
    vn: 'Vietnam',
    ph: 'Philippines',
    id: 'Indonesia',
  };
  if (slugCountry[last]) return slugCountry[last];
  if (slugCountry[tail2]) return slugCountry[tail2];
  return '';
}

function classifyHalalStatus(text) {
  const t = String(text || '');
  if (/partial(?:ly)?\s*halal|halal options|some halal|select halal|halal dishes available|halal menu section|upon request/i.test(t)) {
    return 'options';
  }
  if (/certified halal|100%\s*halal|all food.*certified halal|fully halal|zabiha|everything.*halal|diet:halal.?only/i.test(t)) {
    return 'full';
  }
  // OSM diet:halal=yes and other weak signals — not fully halal unless proven.
  return 'options';
}

/** Parse Zabihah venue HTML — UI badges beat generic schema text. */
function classifyZabihahHtml(html, name) {
  const t = String(html || '');
  const n = String(name || '');

  const meatField = t.match(/meatHalalStatus\\":\\"([^\\"]+)/i)?.[1] || '';

  // Zabihah UI badges (most reliable).
  if (/Partially halal|Partial halal/i.test(t) || /partial/i.test(meatField)) {
    return 'options';
  }

  if (
    /Alcohol served|serves alcohol|wine bar|brewery|brewing company|distillery/i.test(t) ||
    /\\"alcoholPolicy\\":\\"Alcohol/i.test(t) ||
    /\bbrew(?:ery|ing)?\b/i.test(n)
  ) {
    return 'options';
  }

  if (/halal options|upon request|some menu|not all menu|mixed menu/i.test(t)) {
    return 'options';
  }

  if (
    /Fully halal/i.test(meatField) ||
    /all food at this restaurant is certified halal|100%\s*halal|zabiha certified|everything is halal/i.test(t)
  ) {
    return 'full';
  }

  if (/unverified|reported to be halal by our readers/i.test(t)) {
    return 'options';
  }

  return 'options';
}

/** Offline fix for rows scraped with the old default-to-full parser (no network). */
function heuristicZabihahRow(row) {
  const q = String(row.sourceQuote || '');
  const n = String(row.name || '');
  const r = { ...row };

  if (/Zabihah: (partially halal|halal options|fully halal)/i.test(q)) return r;

  if (
    /brew(?:ery|ing)?|distillery|taproom|wine bar|bar & grill|brewing company|beer hall|cocktail/i.test(
      n,
    )
  ) {
    r.halalStatus = 'options';
    r.sourceQuote = 'Zabihah: halal options (alcohol likely)';
    return r;
  }

  if (/Zabihah listing — halal restaurant/i.test(q) || (r.halalStatus === 'full' && !q)) {
    r.halalStatus = 'options';
    r.sourceQuote = 'Zabihah: halal options (conservative default)';
    return r;
  }

  if (r.halalStatus === 'full' && !/fully halal|certified|zabiha|100%/i.test(q)) {
    r.halalStatus = 'options';
    r.sourceQuote = r.sourceQuote || 'Zabihah: halal options';
  }
  return r;
}

function zabihahEvidenceQuote(html, halalStatus) {
  const t = String(html || '');
  if (/Partially halal|Partial halal/i.test(t)) return 'Zabihah: partially halal';
  if (/Alcohol served|serves alcohol/i.test(t)) return 'Zabihah: halal options (alcohol served)';
  if (/halal options|upon request/i.test(t)) return 'Zabihah: halal options available';
  const meat = t.match(/meatHalalStatus\\":\\"([^\\"]+)/i)?.[1];
  if (meat) return `Zabihah: ${meat}`;
  if (halalStatus === 'full') return 'Zabihah: fully halal listing';
  return 'Zabihah: halal options';
}

function parseZabihahHtml(html, url) {
  if (!html || html.length < 500) return null;
  const title = html.match(/<title>([^<|]+)/)?.[1]?.trim();
  const name = title?.split('|')[0]?.trim();
  if (!name) return null;

  const street = html.match(/\\"streetAddress\\":\s*\\"([^\\"]+)/)?.[1];
  const city = html.match(/\\"addressLocality\\":\s*\\"([^\\"]+)/)?.[1];
  const region = html.match(/\\"addressRegion\\":\s*\\"([^\\"]+)/)?.[1];
  const postal = html.match(/\\"postalCode\\":\s*\\"([^\\"]+)/)?.[1];
  const countryCode = html.match(/\\"addressCountry\\":\s*\\"([^\\"]+)/)?.[1];
  const lat = html.match(/\\"latitude\\":\s*([0-9.-]+)/)?.[1];
  const lng = html.match(/\\"longitude\\":\s*([0-9.-]+)/)?.[1];
  if (!lat || !lng) return null;

  const cuisineMatch = html.match(/\\"servesCuisine\\":\s*\[\s*\\"([^\\"]+)/);
  const cuisine = cuisineMatch?.[1] || '';

  const slug = url.split('/restaurants/')[1]?.split('/')[1] || '';
  let country = countryFromCode(countryCode) || countryFromSlug(slug);
  if (!country && region && US_STATE_SUFFIX.has(String(region).toLowerCase())) country = 'USA';

  const addressParts = [street, city, region, postal].filter(Boolean);
  const halalStatus = classifyZabihahHtml(html, name);
  const cityLabel = [city, region].filter(Boolean).join(', ');

  return {
    name,
    address: addressParts.join(', '),
    latitude: String(lat),
    longitude: String(lng),
    city: cityLabel,
    country,
    halalStatus,
    cuisine,
    sourceUrl: url.split('?')[0],
    sourceQuote: zabihahEvidenceQuote(html, halalStatus),
    verifiedMethod: 'web-source',
    source: 'zabihah',
  };
}

function rowKey(r) {
  return `${(r.name || '').toLowerCase()}|${r.latitude}|${r.longitude}`;
}

function isGenericListUrl(url) {
  const u = String(url || '').toLowerCase().split('#')[0].split('?')[0];
  return (
    u.endsWith('/halal/establishments') ||
    u.endsWith('/halal-restaurants') ||
    u.endsWith('/best-bathroom-halal')
  );
}

function sourceUrlKey(r) {
  return (r.sourceUrl || '').split('?')[0].toLowerCase();
}

function normalizeRow(r) {
  return {
    name: String(r.name || '').trim(),
    address: String(r.address || '').trim(),
    latitude: String(r.latitude),
    longitude: String(r.longitude),
    city: String(r.city || '').trim(),
    country: String(r.country || '').trim(),
    halalStatus: r.halalStatus === 'full' ? 'full' : 'options',
    cuisine: String(r.cuisine || '').trim(),
    sourceUrl: String(r.sourceUrl || '').trim(),
    sourceQuote: String(r.sourceQuote || '').trim(),
    verifiedMethod: r.verifiedMethod || 'web-source',
    source: r.source || 'unknown',
  };
}

function mergeRows(existing, incoming, { keepNonDefaultOnly = true } = {}) {
  const byUrl = new Map();
  const byKey = new Map();
  for (const raw of existing) {
    const r = normalizeRow(raw);
    if (keepNonDefaultOnly && isHalalDefaultCountry(r.country)) continue;
    if (!r.latitude || !r.longitude || !r.name) continue;
    byKey.set(rowKey(r), r);
    if (r.sourceUrl) byUrl.set(sourceUrlKey(r), r);
  }
  let added = 0;
  for (const raw of incoming) {
    const r = normalizeRow(raw);
    if (keepNonDefaultOnly && isHalalDefaultCountry(r.country)) continue;
    if (!r.latitude || !r.longitude || !r.name) continue;
    const uk = r.sourceUrl ? sourceUrlKey(r) : '';
    const rk = rowKey(r);
    if (uk && !isGenericListUrl(uk) && byUrl.has(uk)) continue;
    if (byKey.has(rk)) continue;
    byKey.set(rk, r);
    if (uk) byUrl.set(uk, r);
    added++;
  }
  return { rows: [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name)), added };
}

module.exports = {
  USER_AGENT,
  ISO_TO_COUNTRY,
  sleep,
  mapPool,
  fetchText,
  countryFromCode,
  countryFromSlug,
  classifyHalalStatus,
  classifyZabihahHtml,
  heuristicZabihahRow,
  zabihahEvidenceQuote,
  parseZabihahHtml,
  rowKey,
  sourceUrlKey,
  normalizeRow,
  mergeRows,
  isHalalDefaultCountry,
};
