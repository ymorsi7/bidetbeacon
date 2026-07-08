/**
 * Muslim-majority / halal-by-default countries — shaded green on halal.html.
 * Pins are only shown outside these countries.
 *
 * NOT halal-by-default (show pins, never green): Singapore, India, Thailand, etc.
 */
const HALAL_DEFAULT_COUNTRIES = [
  'Afghanistan',
  'Albania',
  'Algeria',
  'Azerbaijan',
  'Bahrain',
  'Bangladesh',
  'Bosnia and Herzegovina',
  'Brunei',
  'Chad',
  'Djibouti',
  'Egypt',
  'Gambia',
  'Guinea',
  'Indonesia',
  'Iran',
  'Iraq',
  'Jordan',
  'Kazakhstan',
  'Kosovo',
  'Kuwait',
  'Kyrgyzstan',
  'Lebanon',
  'Libya',
  'Malaysia',
  'Mali',
  'Mauritania',
  'Morocco',
  'Niger',
  'Oman',
  'Pakistan',
  'Qatar',
  'Saudi Arabia',
  'Senegal',
  'Somalia',
  'Sudan',
  'Syria',
  'Tajikistan',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'United Arab Emirates',
  'Uzbekistan',
  'West Bank',
  'Yemen',
  'Northern Cyprus',
];

/** Natural Earth `properties.name` overrides (same GeoJSON as index.html). */
const GEO_NAME_OVERRIDES = {
  UAE: 'United Arab Emirates',
  Palestine: 'West Bank',
};

const HALAL_DEFAULT_COUNTRY_SET = new Set(
  HALAL_DEFAULT_COUNTRIES.concat(['UAE', 'Palestine']).map((c) => c.toLowerCase())
);

function isHalalDefaultCountry(country) {
  return HALAL_DEFAULT_COUNTRY_SET.has(String(country || '').trim().toLowerCase());
}

function toGeoName(country) {
  return GEO_NAME_OVERRIDES[country] || country;
}

const HALAL_DEFAULT_GEO_NAMES = new Set(HALAL_DEFAULT_COUNTRIES.map(toGeoName));

module.exports = {
  HALAL_DEFAULT_COUNTRIES,
  HALAL_DEFAULT_COUNTRY_SET,
  HALAL_DEFAULT_GEO_NAMES,
  isHalalDefaultCountry,
  toGeoName,
};
