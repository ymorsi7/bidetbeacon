/**
 * Shared helpers for halal discovery crawlers (Reddit, web search, directories).
 */
const https = require('https');
const {
  fetchText,
  sleep,
  plainText,
  extractUrlsFromSearch,
  extractSchemaName,
  extractAddress,
  extractTitle,
  extractH1,
  hasVenueSchema,
  cleanVenueName,
  guessNameFromUrl,
  looksLikeShop,
} = require('./africa-web.cjs');
const { classifyHalalStatus } = require('./halal-web.cjs');
const { isHalalDefaultCountry } = require('./halal-default-countries.cjs');

const HALAL_KW =
  /\bhalal\b|zabiha|zabihah|hand[\s-]?slaughter|no\s+pork|muslim[\s-]?friendly\s+food|halal[\s-]?certif|halal[\s-]?menu|halal[\s-]?options|partially\s+halal|100%\s*halal|fully\s+halal/i;

const VENUE_CTX =
  /\b(restaurant|cafe|caf[eé]|eatery|grill|diner|kitchen|bistro|food\s+court|takeaway|take[\s-]?out|hotel|bakery|pizzeria|burger|shawarma|kebab|curry|buffet|brasserie)\b/i;

const NAME_BLOCKLIST =
  /\bhalal\b.*\b(list|guide|directory|finder|near me|top\s+\d+|best\s+\d+)\b|\b(zabihah|yelp|tripadvisor|google maps|facebook|instagram|reddit|wikipedia|blog|news|review site)\b|things to do|travel guide|food delivery|order online/i;

/** Non-Muslim-default countries + major cities for web search. */
const SEARCH_COUNTRIES = [
  { code: 'US', name: 'USA', cities: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'San Francisco', 'Dallas', 'Miami', 'Seattle', 'Boston', 'San Diego', 'Atlanta', 'Phoenix', 'Detroit', 'Minneapolis'] },
  { code: 'GB', name: 'UK', cities: ['London', 'Birmingham', 'Manchester', 'Leeds', 'Glasgow', 'Edinburgh', 'Bradford', 'Leicester'] },
  { code: 'CA', name: 'Canada', cities: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Edmonton', 'Ottawa'] },
  { code: 'AU', name: 'Australia', cities: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide'] },
  { code: 'NZ', name: 'New Zealand', cities: ['Auckland', 'Wellington', 'Christchurch'] },
  { code: 'FR', name: 'France', cities: ['Paris', 'Lyon', 'Marseille'] },
  { code: 'DE', name: 'Germany', cities: ['Berlin', 'Munich', 'Frankfurt', 'Hamburg', 'Cologne'] },
  { code: 'ES', name: 'Spain', cities: ['Madrid', 'Barcelona', 'Valencia'] },
  { code: 'IT', name: 'Italy', cities: ['Rome', 'Milan', 'Turin'] },
  { code: 'NL', name: 'Netherlands', cities: ['Amsterdam', 'Rotterdam', 'The Hague'] },
  { code: 'BE', name: 'Belgium', cities: ['Brussels', 'Antwerp'] },
  { code: 'CH', name: 'Switzerland', cities: ['Zurich', 'Geneva'] },
  { code: 'AT', name: 'Austria', cities: ['Vienna'] },
  { code: 'SE', name: 'Sweden', cities: ['Stockholm', 'Malmo'] },
  { code: 'NO', name: 'Norway', cities: ['Oslo'] },
  { code: 'DK', name: 'Denmark', cities: ['Copenhagen'] },
  { code: 'IE', name: 'Ireland', cities: ['Dublin'] },
  { code: 'PT', name: 'Portugal', cities: ['Lisbon'] },
  { code: 'PL', name: 'Poland', cities: ['Warsaw', 'Krakow'] },
  { code: 'JP', name: 'Japan', cities: ['Tokyo', 'Osaka', 'Kyoto'] },
  { code: 'KR', name: 'South Korea', cities: ['Seoul', 'Busan'] },
  { code: 'SG', name: 'Singapore', cities: ['Singapore'] },
  { code: 'IN', name: 'India', cities: ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad'] },
  { code: 'TH', name: 'Thailand', cities: ['Bangkok', 'Phuket'] },
  { code: 'MY', name: 'Malaysia', cities: ['Kuala Lumpur'] },
  { code: 'ZA', name: 'South Africa', cities: ['Cape Town', 'Johannesburg', 'Durban'] },
  { code: 'MX', name: 'Mexico', cities: ['Mexico City', 'Cancun'] },
  { code: 'BR', name: 'Brazil', cities: ['Sao Paulo', 'Rio de Janeiro'] },
  { code: 'RU', name: 'Russia', cities: ['Moscow', 'Saint Petersburg'] },
  { code: 'UA', name: 'Ukraine', cities: ['Kyiv'] },
  { code: 'PH', name: 'Philippines', cities: ['Manila'] },
  { code: 'HK', name: 'Hong Kong', cities: ['Hong Kong'] },
];

const CODE_TO_COUNTRY = Object.fromEntries(SEARCH_COUNTRIES.map((c) => [c.code, c.name]));

const SUBREDDIT_META = {
  halal: { country: 'USA', city: '' },
  HalalFood: { country: 'USA', city: '' },
  islam: { country: 'USA', city: '' },
  MuslimLounge: { country: 'USA', city: '' },
  AskNYC: { country: 'USA', city: 'New York, NY' },
  nyc: { country: 'USA', city: 'New York, NY' },
  Brooklyn: { country: 'USA', city: 'Brooklyn, NY' },
  AskLosAngeles: { country: 'USA', city: 'Los Angeles, CA' },
  LosAngeles: { country: 'USA', city: 'Los Angeles, CA' },
  sanfrancisco: { country: 'USA', city: 'San Francisco, CA' },
  bayarea: { country: 'USA', city: 'San Francisco Bay Area, CA' },
  SanDiego: { country: 'USA', city: 'San Diego, CA' },
  chicago: { country: 'USA', city: 'Chicago, IL' },
  boston: { country: 'USA', city: 'Boston, MA' },
  Seattle: { country: 'USA', city: 'Seattle, WA' },
  london: { country: 'UK', city: 'London' },
  London: { country: 'UK', city: 'London' },
  UKFood: { country: 'UK', city: 'London' },
  toronto: { country: 'Canada', city: 'Toronto, ON' },
  askTO: { country: 'Canada', city: 'Toronto, ON' },
  vancouver: { country: 'Canada', city: 'Vancouver, BC' },
  montreal: { country: 'Canada', city: 'Montreal, QC' },
  australia: { country: 'Australia', city: 'Sydney' },
  sydney: { country: 'Australia', city: 'Sydney' },
  melbourne: { country: 'Australia', city: 'Melbourne' },
  singapore: { country: 'Singapore', city: 'Singapore' },
  singaporefi: { country: 'Singapore', city: 'Singapore' },
  paris: { country: 'France', city: 'Paris' },
  berlin: { country: 'Germany', city: 'Berlin' },
  amsterdam: { country: 'Netherlands', city: 'Amsterdam' },
  tokyo: { country: 'Japan', city: 'Tokyo' },
  JapanTravel: { country: 'Japan', city: 'Tokyo' },
  korea: { country: 'South Korea', city: 'Seoul' },
  seoul: { country: 'South Korea', city: 'Seoul' },
  india: { country: 'India', city: 'Delhi' },
  mumbai: { country: 'India', city: 'Mumbai' },
  CapeTown: { country: 'South Africa', city: 'Cape Town' },
  johannesburg: { country: 'South Africa', city: 'Johannesburg' },
  europe: { country: 'France', city: 'Paris' },
  travel: { country: 'USA', city: '' },
  solotravel: { country: 'USA', city: '' },
};

const REDDIT_SUBREDDITS = Object.keys(SUBREDDIT_META).concat([
  'Queens', 'philadelphia', 'WashingtonDC', 'Miami', 'Atlanta', 'Austin', 'houston', 'dallas',
  'Denver', 'Phoenix', 'Minneapolis', 'Nashville', 'Portland', 'Calgary', 'Edmonton',
  'FoodNYC', 'FoodLosAngeles', 'food', 'FoodToronto', 'Brisbane', 'perth', 'auckland',
]);

const REDDIT_QUERIES = [
  'halal restaurant', 'halal food', 'zabiha', 'halal options', 'fully halal', 'halal burger',
  'halal pizza', 'halal certified', 'partial halal', 'halal chicken',
];

function hasHalalEvidence(text) {
  return HALAL_KW.test(text) && VENUE_CTX.test(text);
}

function extractHalalSentences(text) {
  const out = [];
  const re =
    /[^.!?\n]{0,120}(?:halal|zabiha|zabihah|hand[\s-]?slaughter|halal[\s-]?certif|halal[\s-]?menu|halal[\s-]?options|partially\s+halal|100%\s*halal)[^.!?\n]{0,160}/gi;
  for (const m of text.matchAll(re)) {
    const s = m[0].trim().replace(/\s+/g, ' ');
    if (s.length < 12) continue;
    if (/cookie|javascript|webpack|©|\{|\}/i.test(s)) continue;
    out.push(s.slice(0, 280));
  }
  return [...new Set(out)];
}

function classifyFromQuote(quote) {
  return classifyHalalStatus(quote);
}

function parseHalalVenuePage(html, url, ctx = {}) {
  if (looksLikeShop(html)) return null;
  const text = plainText(html);
  if (!HALAL_KW.test(text)) return null;
  const evidence = extractHalalSentences(text).filter((s) => VENUE_CTX.test(s) || /\b(restaurant|hotel|cafe|food)\b/i.test(s));
  if (!evidence.length && !hasVenueSchema(html)) return null;
  if (!evidence.length && hasVenueSchema(html) && HALAL_KW.test(text)) {
    evidence.push(text.match(HALAL_KW)?.[0] ? text.slice(0, 200) : 'Halal mentioned on venue page');
  }
  if (!evidence.length) return null;

  const candidates = [extractSchemaName(html), extractH1(html), extractTitle(html)].filter(Boolean);
  let name = '';
  for (const c of candidates) {
    const cleaned = cleanVenueName(c, ctx.cities, ctx.countryName);
    if (cleaned.length >= 3 && !NAME_BLOCKLIST.test(cleaned)) {
      name = cleaned;
      break;
    }
  }
  if (!name) {
    const first = cleanVenueName(candidates[0] || guessNameFromUrl(url), ctx.cities, ctx.countryName);
    if (first.length >= 3 && !NAME_BLOCKLIST.test(first)) name = first;
  }
  if (!name || name.length < 3) return null;

  const quote = evidence.find((s) => HALAL_KW.test(s)) || evidence[0];
  return {
    name,
    address: extractAddress(html),
    sourceUrl: url.split('?')[0],
    sourceQuote: quote.slice(0, 240),
    halalStatus: classifyFromQuote(quote),
    cuisine: '',
    verifiedMethod: 'web-source',
    source: ctx.source || 'web',
  };
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'HalalBud/1.0' } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(data.slice(0, 120)));
          }
        });
      })
      .on('error', reject);
  });
}

async function geocodePhoton(query, countryCode, cache) {
  const ck = `${countryCode}|${query}`;
  if (cache[ck] !== undefined) return cache[ck];
  try {
    const url = 'https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(query);
    const j = await fetchJson(url);
    const f = j.features?.[0];
    if (!f) {
      cache[ck] = null;
      return null;
    }
    const p = f.properties;
    if (countryCode && p.countrycode !== countryCode) {
      cache[ck] = null;
      return null;
    }
    const [lon, lat] = f.geometry.coordinates;
    const country = CODE_TO_COUNTRY[p.countrycode] || p.country || '';
    const result = {
      latitude: String(lat),
      longitude: String(lon),
      address: [p.housenumber, p.street, p.city, p.state, p.postcode].filter(Boolean).join(', '),
      city: [p.city, p.state].filter(Boolean).join(', '),
      country,
    };
    cache[ck] = result;
    await sleep(150);
    return result;
  } catch {
    cache[ck] = null;
    return null;
  }
}

async function geocodeVenue(parsed, countryCode, countryName, cityHint, cache) {
  const queries = [
    parsed.address ? `${parsed.address}, ${countryName}` : null,
    `${parsed.name}, ${cityHint}, ${countryName}`.replace(/,\s*,/g, ','),
    `${parsed.name}, ${countryName}`,
  ].filter(Boolean);
  for (const q of queries) {
    const g = await geocodePhoton(q, countryCode, cache);
    if (g) return g;
  }
  return null;
}

function halalSearchQueries(city, countryName) {
  const c = city;
  return [
    `halal restaurant ${c} ${countryName}`,
    `zabiha restaurant ${c}`,
    `halal food ${c} ${countryName}`,
    `site:yelp.com halal ${c}`,
    `site:tripadvisor.com halal restaurant ${c}`,
    `site:google.com/maps halal restaurant ${c}`,
    `site:reddit.com halal restaurant ${c}`,
    `site:facebook.com halal restaurant ${c}`,
    `site:instagram.com halal ${c} restaurant`,
    `halal options restaurant ${c}`,
  ];
}

/** URLs worth fetching from search results. */
function isHalalCandidateUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '');
    if (/zabihah\.com|duckduckgo|google\.|bing\.|yahoo\.|wikipedia\.org|youtube\.com|amazon\.|ebay\./i.test(h))
      return false;
    if (/yelp\.com\/biz/i.test(url)) return true;
    if (/tripadvisor\.(com|co\.\w+)\/(Restaurant|Restaurant_Review)/i.test(url)) return true;
    if (/google\.com\/maps\/place/i.test(url)) return true;
    if (/facebook\.com\/[^/]+\/?$|facebook\.com\/pages\//i.test(url)) return true;
    if (/instagram\.com\/p\/|instagram\.com\/reel\//i.test(url)) return false;
    if (/reddit\.com\/r\//i.test(url)) return true;
    if (/\.(restaurant|cafe|kitchen|grill|bistro|hotel|co|com)\//i.test(url) && !/blog|news|list|top-\d+|best-\d+/i.test(url))
      return true;
    return false;
  } catch {
    return false;
  }
}

function isBadVenueName(name) {
  return (
    name.length < 4 ||
    /^(note that|specific|almost|pretty much|there|here|this|that|they|some|many|most|all the|the only|one of|if you|when you|also|just|only|even|still|however|although|because|since|while|where|what|which|who|food|halal|restaurant|place|spot|options|menu|meat|chicken|lamb|beef|fish|pork|alcohol|beer|wine)$/i.test(
      name.trim(),
    ) ||
    /^(note|specific|almost|pretty|there|also|just|only|even|still|however|although|because|since|while|where|what|which|who)\b/i.test(
      name.trim(),
    ) ||
    /\b(options|note that|pretty much|almost all|specific way)\b/i.test(name)
  );
}

function extractRedditVenues(body, subreddit, permalink) {
  if (!HALAL_KW.test(body)) return [];
  const hits = [];
  const seen = new Set();
  const patterns = [
    /\*\*([^*]{4,70})\*\*/g,
    /(?:at|try|went to|recommend|ate at|order from|love)\s+([A-Z][A-Za-z0-9 '&./-]{3,60})/g,
    /([A-Z][A-Za-z0-9 '&./-]{3,55})\s+(?:is|has|serves|offers)\s+(?:\w+\s+){0,3}halal/gi,
    /halal\s+(?:at|from|in)\s+([A-Z][A-Za-z0-9 '&./-]{3,55})/gi,
  ];
  for (const pat of patterns) {
    for (const m of body.matchAll(pat)) {
      let name = m[1].trim().replace(/\s+/g, ' ');
      name = name.replace(/^(The|A|An|My|Their|This|That|It|We|I|They)\s+/i, '').trim();
      if (isBadVenueName(name)) continue;
      if (/^(Reddit|Google|Yelp|Halal|Food|Restaurant|NYC|USA|UK)$/i.test(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const snippet = body.replace(/\s+/g, ' ').slice(0, 320);
      hits.push({
        name,
        subreddit,
        permalink: permalink.startsWith('http') ? permalink : `https://reddit.com${permalink}`,
        snippet,
        halalStatus: classifyFromQuote(snippet),
      });
    }
  }
  return hits;
}

function subredditMeta(sub) {
  return SUBREDDIT_META[sub] || { country: 'USA', city: '' };
}

function countryCodeFromName(name) {
  const hit = SEARCH_COUNTRIES.find((c) => c.name === name);
  return hit?.code || '';
}

module.exports = {
  HALAL_KW,
  SEARCH_COUNTRIES,
  REDDIT_SUBREDDITS,
  REDDIT_QUERIES,
  fetchText,
  sleep,
  fetchJson,
  extractUrlsFromSearch,
  hasHalalEvidence,
  extractHalalSentences,
  classifyFromQuote,
  parseHalalVenuePage,
  geocodePhoton,
  geocodeVenue,
  halalSearchQueries,
  isHalalCandidateUrl,
  extractRedditVenues,
  subredditMeta,
  countryCodeFromName,
  isHalalDefaultCountry,
  CODE_TO_COUNTRY,
};
