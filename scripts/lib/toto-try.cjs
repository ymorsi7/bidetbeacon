/**
 * Shared helpers for the TOTO "Try WASHLET" finder import.
 * Country inference + address normalisation used by both the parser and the
 * geocoders so the logic stays consistent.
 */

// Phone dialling code -> country name
const PHONE_COUNTRY = {
  '49': 'Germany',
  '33': 'France',
  '44': 'UK',
  '41': 'Switzerland',
  '43': 'Austria',
  '31': 'Netherlands',
  '352': 'Luxembourg',
  '420': 'Czech Republic',
  '421': 'Slovakia',
  '45': 'Denmark',
  '353': 'Ireland',
  '371': 'Latvia',
  '370': 'Lithuania',
};

// Website TLD -> country name (fallback when no phone)
const TLD_COUNTRY = {
  de: 'Germany',
  fr: 'France',
  ch: 'Switzerland',
  at: 'Austria',
  nl: 'Netherlands',
  lu: 'Luxembourg',
  cz: 'Czech Republic',
  sk: 'Slovakia',
  dk: 'Denmark',
  ie: 'Ireland',
  lv: 'Latvia',
  lt: 'Lithuania',
};

// ISO country code for geocoder biasing
const COUNTRY_CODE = {
  Germany: 'de',
  France: 'fr',
  UK: 'gb',
  Switzerland: 'ch',
  Austria: 'at',
  Netherlands: 'nl',
  Luxembourg: 'lu',
  'Czech Republic': 'cz',
  Slovakia: 'sk',
  Denmark: 'dk',
  Ireland: 'ie',
  Latvia: 'lv',
  Lithuania: 'lt',
};

// Cities whose postcode format collides between countries.
const CITY_COUNTRY = [
  [/kopenhagen|k\u00f8benhavn|copenhagen|aarhus|odense|aalborg/i, 'Denmark'],
  [/gen[f\u00e8]ve|genf|carouge|z\u00fcrich|zurich|bern|basel|lausanne|luzern|lugano/i, 'Switzerland'],
  [/wien|vienna|salzburg|graz|linz|innsbruck/i, 'Austria'],
];

function countryFromPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '').replace(/^00/, '+');
  const m = digits.match(/^\+(\d+)/);
  if (!m) return null;
  const rest = m[1];
  for (const len of [3, 2]) {
    const code = rest.slice(0, len);
    if (PHONE_COUNTRY[code]) return PHONE_COUNTRY[code];
  }
  return null;
}

function countryFromWebsite(site) {
  if (!site) return null;
  if (/\.co\.uk/i.test(site)) return 'UK';
  const m = site.toLowerCase().match(/\.([a-z]{2})(?:\/|$|\s)/);
  if (m && TLD_COUNTRY[m[1]]) return TLD_COUNTRY[m[1]];
  return null;
}

function countryFromCity(city) {
  const c = city || '';
  for (const [re, country] of CITY_COUNTRY) if (re.test(c)) return country;
  return null;
}

function countryFromPostcode(pc) {
  const p = (pc || '').trim();
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(p)) return 'UK';
  if (/^L-?\d{4}$/i.test(p)) return 'Luxembourg';
  if (/^LV-?\d{4}$/i.test(p)) return 'Latvia';
  if (/^LT-?\d{5}$/i.test(p)) return 'Lithuania';
  if (/^\d{4}\s?[A-Z]{2}$/i.test(p)) return 'Netherlands';
  // Czech/Slovak postcodes are written with a MANDATORY space ("110 00").
  // Without the space it's a German 5-digit code, so require the space here.
  if (/^\d{3}\s\d{2}$/.test(p)) return 'Czech Republic';
  // 4-digit (CH/AT/DK) and 5-digit contiguous (DE/FR) are ambiguous.
  return null;
}

/** Best-effort country for a parsed row (phone > website > postcode > city). */
function inferCountry(row) {
  return (
    countryFromPhone(row.phone) ||
    countryFromWebsite(row.website) ||
    countryFromPostcode(row.postcode) ||
    countryFromCity(row.city) ||
    row.country || // keep any country already assigned by other means
    null
  );
}

/** Permanently closed listings on the finder are marked in German. */
function isClosed(row) {
  return /geschlossen|permanently closed|closed down/i.test(row.name || '');
}

/** Expand common German street abbreviations so geocoders match. */
function expandStreet(street) {
  return (street || '')
    .replace(/\bStr\.\s*/g, 'Straße ')
    .replace(/([a-zäöü])str\.\s*/g, '$1straße ')
    .replace(/\bstr\.\s*$/g, 'straße')
    .replace(/\s+/g, ' ')
    .trim();
}

/** TOTO lists UK addresses German-style ("Queenstown Road 41b"); flip it. */
function reorderUkStreet(street) {
  const m = (street || '').match(/^(.*?)[\s,]+(\d+[a-z]?)$/i);
  if (m) return `${m[2]} ${m[1]}`.trim();
  return street;
}

/** Strip district / Ortsteil suffixes to get the base municipality. */
function baseCity(city) {
  let c = (city || '').trim();
  c = c.replace(/\s*[\/,]?\s*OT\s+.+$/i, ''); // "Borna/OT Zedtlitz" -> "Borna"
  c = c.replace(/\s*-\s*OT\s+.+$/i, '');
  c = c.replace(/,.*$/, ''); // "Bray, Berkshire" -> "Bray"
  return c.trim();
}

module.exports = {
  PHONE_COUNTRY,
  TLD_COUNTRY,
  COUNTRY_CODE,
  countryFromPhone,
  countryFromWebsite,
  countryFromCity,
  countryFromPostcode,
  inferCountry,
  isClosed,
  expandStreet,
  reorderUkStreet,
  baseCity,
};
