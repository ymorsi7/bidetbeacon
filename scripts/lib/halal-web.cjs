/**
 * Shared helpers for halal restaurant crawlers / importers.
 */
const fs = require('fs');
const readline = require('readline');
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
  DZ: 'Algeria',
  TN: 'Tunisia',
  QA: 'Qatar',
  KW: 'Kuwait',
  BH: 'Bahrain',
  OM: 'Oman',
  JO: 'Jordan',
  LB: 'Lebanon',
  IQ: 'Iraq',
  IR: 'Iran',
  AF: 'Afghanistan',
  AL: 'Albania',
  AZ: 'Azerbaijan',
  BA: 'Bosnia and Herzegovina',
  BN: 'Brunei',
  TD: 'Chad',
  DJ: 'Djibouti',
  GM: 'Gambia',
  GN: 'Guinea',
  KZ: 'Kazakhstan',
  KG: 'Kyrgyzstan',
  LY: 'Libya',
  ML: 'Mali',
  MR: 'Mauritania',
  NE: 'Niger',
  SN: 'Senegal',
  SO: 'Somalia',
  SD: 'Sudan',
  SY: 'Syria',
  TJ: 'Tajikistan',
  TM: 'Turkmenistan',
  UZ: 'Uzbekistan',
  YE: 'Yemen',
  PS: 'West Bank',
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

const STORE_ZABIHAH_CATEGORIES = new Set([
  'groceries',
  'grocery',
  'halal meat',
  'meat',
  'butcher',
  'butchers',
  'supermarket',
  'supermarkets',
  'deli',
  'bakery',
  'catering',
  'wholesale',
  'food store',
  'convenience store',
  'grocery store',
  'meat market',
  'fish market',
  'spices',
  'sweets',
  'health food',
  'international grocery',
]);

/** Grocery / retail chains — name is often just "Safeway" or "Costco" with no other hint. */
const STORE_CHAIN_NAMES = [
  'safeway',
  'costco',
  'walmart',
  'kroger',
  'target',
  'trader joe',
  "trader joe's",
  'whole foods',
  'whole foods market',
  'aldi',
  'lidl',
  'publix',
  'wegmans',
  "sam's club",
  'food lion',
  'giant food',
  'giant eagle',
  'stop & shop',
  'sprouts',
  'h-e-b',
  'heb',
  'meijer',
  'winco',
  'food 4 less',
  'smart & final',
  'ralphs',
  'vons',
  'pavilions',
  'tom thumb',
  'albertsons',
  'jewel-osco',
  'acme markets',
  'acme',
  'shaws',
  'star market',
  'hannaford',
  'sobeys',
  'loblaws',
  'no frills',
  'metro',
  'tesco',
  'sainsbury',
  "sainsbury's",
  'asda',
  'morrisons',
  'carrefour',
  '7-eleven',
  '7 eleven',
  'circle k',
  'cvs',
  'walgreens',
  'dollar general',
  'family dollar',
  'dollar tree',
  'shoprite',
  'food basics',
  'freshco',
  'super c',
  'iga',
  'save-on-foods',
  'co-op food',
  'marks & spencer',
  'waitrose',
  'iceland',
  'spar',
  'rewe',
  'edeka',
  'penny',
  'netto',
  'kaufland',
  'intermarche',
  'auchan',
  'monoprix',
  'franprix',
  'coles',
  'woolworths',
  'countdown',
  'pak n save',
  'new world',
];

const STORE_SLUG_TOKENS = new Set([
  'grocery',
  'groceries',
  'butcher',
  'butchery',
  'boucherie',
  'supermarket',
  'deli',
  'meat',
  'store',
  'shop',
  'mart',
  'bakery',
  'catering',
  'wholesale',
  'minimart',
  'epicerie',
  'markt',
  'provision',
  'provisions',
  'safeway',
  'costco',
  'walmart',
  'kroger',
  'target',
  'aldi',
  'lidl',
  'publix',
  'wegmans',
  'tesco',
  'asda',
  'morrisons',
  'sainsburys',
  'loblaws',
  'sobeys',
  'coles',
  'woolworths',
]);

const STORE_NAME_RE =
  /\b(butcher|boucherie|grocer(?:y|ies)|supermarket|hypermarket|food\s*store|food\s*mart|meat\s*market|halal\s*meat|halal\s*store|halal\s*shop|convenience\s*store|mini\s*mart|minimart|fish\s*market|spice\s*(?:shop|store)|sweet\s*shop|cash\s*&\s*carry|wholesale|patisserie|épicerie|epicerie|provisions?|delicatessen|charcuterie)\b/i;

const REST_NAME_RE =
  /\b(restaurant|resto\b|grill|kitchen|cafe|café|diner|bistro|eatery|pizzeria|shawarma|kebab|kabob|döner|doner|gyro|bbq|barbecue|steakhouse|buffet|trattoria|sushi|ramen|noodle|tandoori|dhaba|wings|taqueria|brasserie|cantina|dining)\b/i;

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');
}

function slugTokens(url) {
  const slug = String(url || '').split('/').pop() || '';
  return slug.toLowerCase().split('-').filter(Boolean);
}

function isStoreChainName(name) {
  const n = decodeHtmlEntities(name).toLowerCase().trim();
  if (!n) return false;
  return STORE_CHAIN_NAMES.some((chain) => n === chain || n.startsWith(`${chain} `) || n.startsWith(`${chain}#`));
}

function zabihahCategoryFromTitle(html) {
  const title = html.match(/<title>([^<]+)/)?.[1]?.trim();
  if (!title) return '';
  const part = title.split('|')[1] || '';
  const m = part.match(/Halal\s+(.+?)\s+in\s+/i);
  return m ? m[1].trim() : '';
}

function hasStoreSignal(hay, name, slug) {
  if (isStoreChainName(name)) return true;
  if (STORE_NAME_RE.test(hay)) return true;
  if (slug.some((t) => STORE_SLUG_TOKENS.has(t))) return true;
  if (
    /\b(market|markt)\b/.test(hay) &&
    /\b(halal|grocery|meat|food|international|oriental|desi|asian|african|middle)\b/.test(hay)
  ) {
    return true;
  }
  return false;
}

function hasRestaurantSignal(hay, name) {
  if (REST_NAME_RE.test(hay)) return true;
  if (/\brestaurant\b/i.test(decodeHtmlEntities(name))) return true;
  return false;
}

function classifyVenueType(row) {
  const cat = String(row.zabihahCategory || '').toLowerCase().trim();
  if (cat) {
    if (STORE_ZABIHAH_CATEGORIES.has(cat)) return 'store';
    return 'restaurant';
  }

  const name = decodeHtmlEntities(row.name);
  const slug = slugTokens(row.sourceUrl);
  const cuisine = String(row.cuisine || '');
  const hay = `${name} ${cuisine} ${slug.join(' ')}`.toLowerCase();

  const storeHit = hasStoreSignal(hay, name, slug);
  const restHit = hasRestaurantSignal(hay, name);

  if (storeHit && restHit) {
    // "Adan Restaurant & Halal Grocery" → restaurant; "Safeway" → store only
    if (/\brestaurant\b/i.test(name)) return 'restaurant';
    if (isStoreChainName(name)) return 'store';
    if (/\b(grill|cafe|kitchen|diner|bistro|eatery|shawarma|kebab)\b/i.test(name)) return 'restaurant';
    return 'store';
  }
  if (storeHit) return 'store';
  if (restHit) return 'restaurant';

  return 'restaurant';
}

const CA_PROVINCE = new Set(['on', 'bc', 'ab', 'qc', 'mb', 'sk', 'ns', 'nb', 'nl', 'pe', 'nt', 'nu', 'yt']);

function countryFromStateRegion(state) {
  const s = String(state || '').trim().toLowerCase();
  if (!s) return '';
  if (US_STATE_SUFFIX.has(s)) return 'USA';
  if (CA_PROVINCE.has(s)) return 'Canada';
  return '';
}

function zabihahVenueSlug(name, city, state) {
  return [name, city, state]
    .map((p) =>
      String(p || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter(Boolean)
    .join('-');
}

function classifyZabihahVenueSummary(venue) {
  const meat = String(venue?.halalSummary?.meatHalalStatus || '');
  const alcohol = String(venue?.halalSummary?.alcoholPolicy || '');
  if (/fully halal/i.test(meat)) return 'full';
  if (/partial/i.test(meat)) return 'options';
  if (/alcohol available/i.test(alcohol)) return 'options';
  return 'options';
}

function zabihahVenueQuote(venue) {
  const meat = venue?.halalSummary?.meatHalalStatus;
  if (meat) return `Zabihah: ${meat}`;
  return 'Zabihah: halal listing';
}

function countryFromListingUrl(listingUrl) {
  const slug = String(listingUrl || '').split('/').pop() || '';
  return countryFromSlug(slug);
}

/** Extract a Next.js RSC JSON array keyed by `initialRestaurants`, etc. */
function extractRscArray(html, key) {
  const marker = `${key}\\":`;
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const start = html.indexOf('[', idx);
  if (start < 0) return null;
  const stops = [
    '],\\"initialMosques\\":',
    '],\\"initialStores\\":',
    '],\\"searchQuery\\":',
    '],\\"selectedCuisine\\":',
    '],\\"defaultTab\\":',
  ];
  let end = -1;
  for (const stop of stops) {
    const p = html.indexOf(stop, start);
    if (p > start && (end < 0 || p < end)) end = p;
  }
  if (end < 0) return null;
  return html.slice(start, end + 1);
}

function parseRscJsonArray(text) {
  if (!text) return [];
  const unescaped = text.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  try {
    return JSON.parse(unescaped);
  } catch {
    try {
      return JSON.parse(text);
    } catch {
      return [];
    }
  }
}

/** Fallback when RSC keys differ (halal-restaurants/* city pages use deeper escaping). */
function extractZabihahVenuesRegex(html) {
  const venues = [];
  const seen = new Set();
  const unesc = (s) =>
    String(s || '')
      .replace(/\\"/g, '"')
      .replace(/\\u0026/g, '&')
      .replace(/\\\\/g, '\\');
  const idRe = /\\"id\\":\\"([0-9a-f-]{36})\\",\\"name\\":\\"([^\\"]*)\\"/g;
  let m;
  while ((m = idRe.exec(html))) {
    const id = m[1];
    if (seen.has(id)) continue;
    const window = html.slice(m.index, m.index + 3000);
    const lat = window.match(/\\"latitude\\":\\"([^"\\]+)/)?.[1];
    const lng = window.match(/\\"longitude\\":\\"([^"\\]+)/)?.[1];
    if (!lat || !lng) continue;
    seen.add(id);
    const address = unesc(window.match(/\\"address\\":\\"([^\\"]*)\\"/)?.[1]);
    const city = unesc(window.match(/\\"city\\":\\"([^\\"]*)\\"/)?.[1]);
    const state = unesc(window.match(/\\"state\\":\\"([^\\"]*)\\"/)?.[1]);
    const meat = unesc(window.match(/\\"meatHalalStatus\\":\\"([^"\\]+)/)?.[1]);
    const alcohol = unesc(window.match(/\\"alcoholPolicy\\":\\"([^"\\]+)/)?.[1]);
    const cuisineBlock = window.match(/\\"cuisine\\":\[(.*?)\]/);
    let cuisine = [];
    if (cuisineBlock) {
      cuisine = [...cuisineBlock[1].matchAll(/\\"([^\\"]*)\\"/g)].map((x) => unesc(x[1]));
    }
    venues.push({
      id,
      name: unesc(m[2]),
      latitude: lat,
      longitude: lng,
      address,
      city,
      state,
      cuisine,
      halalSummary: meat || alcohol ? { meatHalalStatus: meat, alcoholPolicy: alcohol } : undefined,
    });
  }
  return venues;
}

function listingVenueToRow(venue, listingUrl) {
  if (!venue?.id || !venue?.name || !venue?.latitude || !venue?.longitude) return null;
  const state = String(venue.state || '').trim();
  const city = String(venue.city || '').trim();
  const slug = zabihahVenueSlug(venue.name, city, state);
  const sourceUrl = `https://www.zabihah.com/restaurants/${venue.id}/${slug}`;
  let country = countryFromStateRegion(state) || countryFromListingUrl(listingUrl);
  const cuisine = Array.isArray(venue.cuisine) ? venue.cuisine.join(', ') : String(venue.cuisine || '');
  const halalStatus = classifyZabihahVenueSummary(venue);
  const address = [venue.address, city, state].filter(Boolean).join(', ');
  const cityLabel = [city, state].filter(Boolean).join(', ');

  const row = {
    name: String(venue.name).trim(),
    address,
    latitude: String(venue.latitude),
    longitude: String(venue.longitude),
    city: cityLabel,
    country,
    halalStatus,
    cuisine,
    sourceUrl,
    sourceQuote: zabihahVenueQuote(venue),
    verifiedMethod: 'web-source',
    source: 'zabihah',
  };
  row.venueType = classifyVenueType(row);
  return row;
}

/** Bulk-extract venues embedded in Zabihah subregion / city listing pages (~50–100 per fetch). */
function parseZabihahListingHtml(html, listingUrl) {
  if (!html || html.length < 5000) return [];
  const rows = [];
  const seen = new Set();
  const venues = [];
  for (const key of ['initialRestaurants', 'initialStores']) {
    const arrText = extractRscArray(html, key);
    const parsed = parseRscJsonArray(arrText);
    if (parsed.length) venues.push(...parsed);
  }
  if (!venues.length) venues.push(...extractZabihahVenuesRegex(html));
  for (const venue of venues) {
    const row = listingVenueToRow(venue, listingUrl);
    if (!row) continue;
    const id = venue.id;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(row);
  }
  return rows;
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
  const zabihahCategory = zabihahCategoryFromTitle(html);

  const row = {
    name,
    address: addressParts.join(', '),
    latitude: String(lat),
    longitude: String(lng),
    city: cityLabel,
    country,
    halalStatus,
    cuisine,
    zabihahCategory,
    sourceUrl: url.split('?')[0],
    sourceQuote: zabihahEvidenceQuote(html, halalStatus),
    verifiedMethod: 'web-source',
    source: 'zabihah',
  };
  row.venueType = classifyVenueType(row);
  return row;
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
  const base = {
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
  if (r.zabihahCategory) base.zabihahCategory = String(r.zabihahCategory).trim();
  base.venueType = classifyVenueType({ ...base, zabihahCategory: r.zabihahCategory });
  return base;
}

function mergeRows(existing, incoming, { keepNonDefaultOnly = false } = {}) {
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
  let skippedDefault = 0;
  let skippedDupe = 0;
  let skippedInvalid = 0;
  for (const raw of incoming) {
    const r = normalizeRow(raw);
    if (keepNonDefaultOnly && isHalalDefaultCountry(r.country)) {
      skippedDefault++;
      continue;
    }
    if (!r.latitude || !r.longitude || !r.name) {
      skippedInvalid++;
      continue;
    }
    const uk = r.sourceUrl ? sourceUrlKey(r) : '';
    const rk = rowKey(r);
    if (uk && !isGenericListUrl(uk) && byUrl.has(uk)) {
      skippedDupe++;
      continue;
    }
    if (byKey.has(rk)) {
      skippedDupe++;
      continue;
    }
    byKey.set(rk, r);
    if (uk) byUrl.set(uk, r);
    added++;
  }
  return {
    rows: [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name)),
    added,
    skippedDefault,
    skippedDupe,
    skippedInvalid,
  };
}

function ndjsonPath(jsonPath) {
  return jsonPath.replace(/\.json$/i, '.ndjson');
}

function countNdjsonRows(ndPath) {
  if (!fs.existsSync(ndPath)) return 0;
  const data = fs.readFileSync(ndPath, 'utf8');
  if (!data.trim()) return 0;
  let n = 0;
  for (let i = 0; i < data.length; i++) if (data[i] === '\n') n++;
  return data.endsWith('\n') ? n : n + 1;
}

/** Read venue rows from companion .ndjson (preferred) or a JSON array file. */
function readVenueRows(jsonPath) {
  const nd = ndjsonPath(jsonPath);
  if (fs.existsSync(nd)) {
    return fs
      .readFileSync(nd, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  if (!fs.existsSync(jsonPath)) return [];
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  return Array.isArray(raw) ? raw : raw.rows || raw.establishments || [];
}

/** Append rows to .ndjson sidecar (O(new rows) memory — safe for large crawls). */
function appendVenueRows(jsonPath, rows) {
  if (!rows.length) return;
  const nd = ndjsonPath(jsonPath);
  fs.appendFileSync(nd, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/** Stream-compact .ndjson → JSON array without holding all rows in memory. */
async function compactNdjsonToJson(jsonPath) {
  const nd = ndjsonPath(jsonPath);
  if (!fs.existsSync(nd)) return 0;
  const tmp = jsonPath + '.tmp';
  const out = fs.createWriteStream(tmp);
  out.write('[');
  let first = true;
  let count = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(nd), crlfDelay: Infinity });
  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    if (!first) out.write(',');
    first = false;
    out.write(s);
    count++;
  }
  out.write(']\n');
  await new Promise((resolve, reject) => {
    out.end((err) => (err ? reject(err) : resolve()));
  });
  fs.renameSync(tmp, jsonPath);
  return count;
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
  parseZabihahListingHtml,
  classifyVenueType,
  zabihahCategoryFromTitle,
  rowKey,
  sourceUrlKey,
  normalizeRow,
  mergeRows,
  isHalalDefaultCountry,
  ndjsonPath,
  countNdjsonRows,
  readVenueRows,
  appendVenueRows,
  compactNdjsonToJson,
};
