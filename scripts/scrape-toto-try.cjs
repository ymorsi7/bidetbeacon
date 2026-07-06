#!/usr/bin/env node
/**
 * Parse the TOTO "Try WASHLET®" finder listing into candidate rows.
 * Source: https://eu.toto.com/en/service/try-washlettm (rendered page saved as markdown)
 *
 * These are TOTO showrooms / dealers / retailers where a specific WASHLET model
 * is installed "in the guest toilet" and can be tried in person — treated as
 * public spots with manufacturer-reference evidence.
 *
 * Usage:
 *   node scripts/scrape-toto-try.cjs [path/to/try-washlettm.md]
 *
 * Writes data/toto-try-washlet.json (candidates, no coordinates yet).
 * Run scripts/geocode-toto-try.cjs afterwards to fill in lat/lon.
 */
const fs = require('fs');
const path = require('path');
const {
  countryFromPhone,
  countryFromWebsite,
  countryFromPostcode,
  countryFromCity,
} = require('./lib/toto-try.cjs');

const DEFAULT_SRC =
  '/Users/yusufmorsi/.cursor/projects/Users-yusufmorsi-Documents-GitHub-bidetbeacon/uploads/try-washlettm-0.md';
const SRC = process.argv[2] || DEFAULT_SRC;
const OUT = path.join(__dirname, '../data/toto-try-washlet.json');
const SOURCE_URL = 'https://eu.toto.com/en/service/try-washlettm';

// Detect the "postcode + city" line and split it.
function parsePostcodeCity(line) {
  const s = line.trim();
  // UK: "SW8 3RE London"
  let m = s.match(/^([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s+(.+)$/i);
  if (m) return { postcode: m[1].trim(), city: m[2].trim() };
  // Netherlands: "1234 AB Amsterdam"
  m = s.match(/^(\d{4}\s?[A-Z]{2})\s+(.+)$/i);
  if (m) return { postcode: m[1].trim(), city: m[2].trim() };
  // Prefixed: "LV-1050 Riga" / "L-1234 Luxembourg" / "LT-01100 Vilnius"
  m = s.match(/^((?:LV|LT|L)-?\d{4,5})\s+(.+)$/i);
  if (m) return { postcode: m[1].trim(), city: m[2].trim() };
  // Czech: "110 00 Praha"
  m = s.match(/^(\d{3}\s\d{2})\s+(.+)$/);
  if (m) return { postcode: m[1].trim(), city: m[2].trim() };
  // Generic 4-5 digit: "41238 Mönchengladbach" / "8048 Zürich"
  m = s.match(/^(\d{4,5})\s+(.+)$/);
  if (m) return { postcode: m[1].trim(), city: m[2].trim() };
  return null;
}

function isNoise(line) {
  return (
    !line ||
    line === 'Show on map' ||
    line === 'Calculate Route' ||
    /^Share .* via (Mail|WhatsApp)$/.test(line)
  );
}

function looksLikePhone(line) {
  return /^\+?\d[\d\s()/-]{6,}$/.test(line.replace(/\s+/g, ' ').trim());
}

function looksLikeWebsite(line) {
  return (
    /^(https?:\/\/|www\.)/i.test(line) ||
    /^[a-z0-9-]+\.[a-z]{2,}(\.[a-z]{2})?\s*$/i.test(line)
  );
}

function main() {
  const raw = fs.readFileSync(SRC, 'utf8');
  const lines = raw.split('\n').map((l) => l.replace(/\s+$/g, '').trim());

  // Restrict to the results region.
  const startIdx = lines.findIndex((l) => l === 'Results');
  const endIdx = lines.findIndex((l) =>
    /^Unfortunately, no results could be found/.test(l)
  );
  const region = lines.slice(
    startIdx >= 0 ? startIdx + 1 : 0,
    endIdx >= 0 ? endIdx : lines.length
  );

  // Segment into blocks terminated by "Share <name> via WhatsApp".
  const rows = [];
  let block = [];
  let skippedNoAddress = 0;

  for (const line of region) {
    block.push(line);
    const wa = line.match(/^Share (.+) via WhatsApp$/);
    if (!wa) continue;

    const name = wa[1].trim();
    const body = block.filter((l) => l.length > 0);
    block = [];

    const smIdx = body.indexOf('Show on map');
    if (smIdx < 0) continue;

    // Lines before "Show on map", excluding repeated name occurrences.
    const head = body.slice(0, smIdx).filter((l) => l !== name && l !== name + ' ');

    // Find postcode/city line; street is the non-empty line just above it.
    let addr = null;
    let pcIdx = -1;
    for (let i = 0; i < head.length; i++) {
      const pc = parsePostcodeCity(head[i]);
      if (pc) {
        addr = pc;
        pcIdx = i;
        break;
      }
    }

    if (!addr) {
      skippedNoAddress++;
      continue;
    }

    const street = pcIdx > 0 ? head[pcIdx - 1].trim() : '';
    // Everything after postcode/city (before Show on map) is the model text.
    const model =
      head
        .slice(pcIdx + 1)
        .join(' ')
        .replace(/\s*\|\s*/g, ' ')
        .replace(/in the guest toilet/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'TOTO WASHLET';

    // Tail: phone + website between "Calculate Route" and share links.
    const crIdx = body.indexOf('Calculate Route');
    const tail = body
      .slice(crIdx + 1)
      .filter((l) => !/^Share .* via (Mail|WhatsApp)$/.test(l));
    let phone = null;
    let website = null;
    for (const t of tail) {
      if (!phone && looksLikePhone(t)) phone = t.trim();
      else if (!website && looksLikeWebsite(t)) website = t.trim();
    }

    const addressParts = [street, [addr.postcode, addr.city].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');

    const country =
      countryFromPhone(phone) ||
      countryFromWebsite(website) ||
      countryFromPostcode(addr.postcode, addr.city) ||
      countryFromCity(addr.city) ||
      null;

    rows.push({
      name,
      address: addressParts,
      postcode: addr.postcode,
      city: addr.city,
      country,
      bidetType: model,
      phone: phone || undefined,
      website: website || undefined,
      sourceUrl: SOURCE_URL,
      sourceQuote: `TOTO "Try WASHLET" finder: ${model} in the guest toilet`,
    });
  }

  // Report unresolved countries so they can be spot-fixed.
  const noCountry = rows.filter((r) => !r.country);
  const byCountry = rows.reduce((a, r) => {
    const k = r.country || '(unknown)';
    a[k] = (a[k] || 0) + 1;
    return a;
  }, {});

  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n');
  console.log(`Parsed ${rows.length} venues (skipped ${skippedNoAddress} without an address).`);
  console.log('By country:', byCountry);
  if (noCountry.length) {
    console.log(`\n${noCountry.length} rows still need a country (postcode ambiguous, no phone/website).`);
  }
  console.log(`\nWrote ${OUT}`);
}

main();
