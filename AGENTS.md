# AGENTS.md — BidetBud

Guide for AI agents and contributors working in this repository.

## Project summary

**BidetBud** is a static, client-only map for finding bidet-equipped restrooms — masajid, restaurants, hotels, and public spots — in the **USA, UK, Canada, and Singapore**.

- **Live:** [bidetbud.com](https://bidetbud.com/)
- **Stack:** Single HTML page + CSS. No build step, no backend, no framework.
- **Map:** Leaflet + MarkerCluster (bundled inline in `index.html`)
- **Data:** `bidet-seed.json` fetched async at boot (`data/bidet-restaurants.json` is the full source of truth)
- **Submissions:** In-page form via Web3Forms (`WEB3FORMS_ACCESS_KEY` in `index.html`)
- **Analytics:** GoatCounter (`bidetbud.goatcounter.com`)

Related but separate project: [bidetbud.com](https://www.bidetbud.com/) is the Singapore-only PWA (“Bidet Bud SG”). Singapore data for this repo is imported from its public JSON export.

---

## Repository layout

```
index.html                          App shell (~22 KB); logic in js/app.js; seed in bidet-seed.json
css/app.css                         All UI styles (Inter font, zinc palette)
css/github-star.css                 Footer link styles
images/                             Logo and favicons
data/singapore-bidets.geolocation.json   Cached SG source (community bidet sightings only)
data/france-verified-bidets.json         Curated FR rows with cited evidence (not bulk OSM)
data/russia-verified-bidets.json         Curated RU rows with cited evidence (Russian sources preferred)
data/russia-scrape-candidates.json       Auto-scrape hits from scripts/scrape-russia-sources.cjs (review only)
scripts/
  apply-address-fixes.cjs           Re-geocode seed; manual coordinate overrides
  import-singapore.cjs              Merge @toiletswithbidetsg / Bidet Bud SG JSON
  import-france.cjs                 Merge only rows from france-verified-bidets.json
  import-russia.cjs                 Replace all Russia rows from russia-verified-bidets.json
  scrape-russia-sources.cjs         Crawl Russian booking/review sites for bidet mentions
  scrape-russia-exhaustive.cjs      90-min exhaustive crawl with URL discovery
  merge-russia-candidates.cjs      Bulk-merge 101hotels scrape hits into verified JSON
  geocode-russia.cjs                  Apply manual GPS overrides for Russia curated rows
  scrape-toto-references.cjs        Fetch all TOTO Europe WASHLET case studies
  finish-toto-references.cjs        Append manual coords for ambiguous TOTO venues
  import-toto-references.cjs        Merge TOTO references into BIDETBUD_SEED
  scrape-toto-try.cjs               Parse eu.toto.com "Try WASHLET" finder listing
  geocode-toto-try.cjs              Geocode Try-WASHLET rows (Photon/Nominatim, cached)
  geocode-toto-try-retry.cjs        Smarter retry for unresolved Try-WASHLET rows
  import-toto-try.cjs               Merge Try-WASHLET showrooms/dealers into BIDETBUD_SEED
  lib/toto-try.cjs                  Shared country inference + address helpers
  address-fix-report.json           Output from geocode script (optional)
```

---

## Architecture constraints

**Keep it static.** Do not add:

- Node/npm build pipelines, React/Vue, or SSR
- Service workers, PWA manifests, or install prompts (removed intentionally)
- Backend APIs or server-side geocoding at runtime

**Do use:**

- Vanilla JS in `js/app.js` (loaded deferred after Leaflet)
- Styles in `css/app.css` — avoid large new inline style blocks
- Node scripts in `scripts/` for one-off data maintenance only

---

## Verification policy (critical)

**Only add locations where a bidet is explicitly confirmed — never assume.**

| OK | Not OK |
|----|--------|
| User personally verified (`bidetStatus: "verified"`) | Bulk-importing all mosques from OSM “because wudu exists” |
| Community bidet-only lists (e.g. [@toiletswithbidetsg](https://www.instagram.com/toiletswithbidetsg/)) | Generic halal restaurant or public toilet directories |
| Manufacturer case studies naming WASHLET/bidet install | Places “likely” to have bidets based on country/culture |
| Reviews/articles that explicitly mention bidet, washlet, douchette, or handheld spray | Ablution/wudu alone without bidet/spray evidence |

Every `internet` or `warmed` entry **must** have `sourceUrl` + `sourceQuote` citing the evidence. Use `verifiedMethod` when helpful (`community-sighting`, `manufacturer-reference`, `web-source`).

---

## Seed data (`BIDETBUD_SEED`)

Each location is a JSON object. Only entries with `bidetStatus` of `verified`, `warmed`, or `internet` appear on the map.

### Required / common fields

| Field | Notes |
|-------|-------|
| `name` | Display name |
| `address` | Street address |
| `latitude`, `longitude` | Strings (e.g. `"37.8619778"`) |
| `city` | e.g. `"Berkeley, CA"` or `"East"` (SG region) |
| `country` | `USA`, `UK`, `Canada`, or `Singapore` |
| `type` | `mosque`, `restaurant`, `hotel`, or `public` |
| `bidetStatus` | `verified` (user), `warmed` (heated/TOTO), `internet` (web source) |
| `access` | `public` or `limited` |

### Optional fields

| Field | Notes |
|-------|-------|
| `bidetType` | e.g. `"Handheld sprayer"`, `"Heated seat"` |
| `sourceUrl` | Required for `internet` entries |
| `sourceQuote` | Short attribution |
| `verifiedMethod` | How a verified spot was confirmed |
| `searchAliases` | Extra search tokens; supports acronym matching (e.g. `ICSD` → Islamic Center of San Diego) |
| `accessNote` | Shown when `access` is `limited` |

### Example — verified masjid

```js
{
  "name": "Example Masjid",
  "address": "123 Main St, City, ST 12345",
  "latitude": "37.0000000",
  "longitude": "-122.0000000",
  "city": "City, ST",
  "country": "USA",
  "type": "mosque",
  "bidetStatus": "verified",
  "access": "public",
  "bidetType": "Handheld sprayer"
}
```

### Editing the seed

- Full rows live in `data/bidet-restaurants.json`; the browser loads slim `bidet-seed.json`.
- Prefer **scripts** for bulk adds (see `scripts/import-singapore.cjs`) rather than hand-editing hundreds of entries. Use `scripts/lib/bidet-seed.cjs` (`writeSeed`) so both files stay in sync.
- After coordinate changes, run `node scripts/apply-address-fixes.cjs` and add `MANUAL` overrides in that script for known-good coords.
- Validate after edits: `node -e "JSON.parse(require('fs').readFileSync('bidet-seed.json','utf8'))"`

---

## Key application logic (in `index.html`)

| Area | Functions / constants |
|------|----------------------|
| Normalization | `normalizeSeed`, `stableSeedId`, `HAS_BIDET` |
| Search | `searchScore`, `matchesSearch`, acronym/`searchAliases` support |
| Filters | `placeFilter` (all/mosque/restaurant), `extraFilter`, `countryFilter` |
| URL state | `syncUrlFromState`, `applyUrlState` — params: `q`, `type`, `filter`, `country`, `near`, `radius`, `spot` |
| Map | Leaflet map, `createIcon`, cluster group |
| Types UI | `typeLabel` — maps `mosque` / `restaurant` / `hotel` / `public` |
| Friendly countries | `BIDET_FRIENDLY_COUNTRIES` + GeoJSON overlay (bidets common nationally) |
| Analytics | `window.trackEvent(name, props)` — events: `bidetbud_view`, `bidetbud_add_open`, `bidetbud_promo_show`, `bidetbud_spot_open` |

---

## Copy and terminology

- Use **masajid** (not “masajed”) in all user-facing copy.
- Internal `type` value remains `mosque`; UI label is “Masjid”.
- Country filter chips: USA, UK, Canada, Singapore (`data-type` on chips doubles as country code for those four).

---

## Singapore data import

Source: `https://www.bidetbud.com/data/bidets.geolocation.json` (584 locations, synced from [@toiletswithbidetsg](https://www.instagram.com/toiletswithbidetsg/)).

This is a **bidet-only** community map — each row is a user-submitted sighting (photo + location), not a generic toilet directory. Safe to import in bulk.

```bash
curl -sL "https://www.bidetbud.com/data/bidets.geolocation.json" \
  -o data/singapore-bidets.geolocation.json
node scripts/import-singapore.cjs
```

Sets `bidetStatus: "internet"`, `verifiedMethod: "community-sighting"`, and replaces existing Singapore rows on re-run.

## France data import

**Do not** bulk-scrape OSM mosques. Add rows only to `data/france-verified-bidets.json` with explicit evidence, then:

```bash
node scripts/import-france.cjs
```

## Russia data import

**Prefer Russian-language sources** (newtoto.ru, broni.travel, 101hotels.com, tutu.ru,
travel.yandex.ru, level.travel, irecommend.ru, official `.ru` hotel sites). Each row in
`data/russia-verified-bidets.json` must cite explicit bidet/washlet evidence. Do **not**
bulk-import mosques or generic restrooms from OSM.

```bash
node scripts/scrape-russia-sources.cjs      # quick curated crawl
node scripts/scrape-russia-exhaustive.cjs --minutes 90   # full 90-min scrape
node scripts/merge-russia-candidates.cjs --limit 70   # merge scrape hits into verified JSON
node scripts/geocode-russia.cjs          # apply manual coords after adding rows
node scripts/import-russia.cjs           # replaces all prior Russia rows in seed
```

TOTO Russia dealer projects: [newtoto.ru/category/projects](https://newtoto.ru/category/projects/)

## Africa data import

African venues are **not** bidet-friendly by default, so each row needs explicit
per-venue evidence (a web source that names a bidet in the bathroom). Add rows to
`data/africa-verified-bidets.json` (with `sourceUrl` + `sourceQuote`), then:

```bash
node scripts/import-africa.cjs
```

Sets `bidetStatus: "internet"`, `verifiedMethod: "web-source"`, and only adds
net-new rows (dedupes on name+coords and on `sourceUrl`). `import-africa.cjs` merges
two sources: the curated `africa-verified-bidets.json` **and** the crawler output
`africa-web-crawl-bidets.json` (below). Do **not** bulk-import from generic hotel
directories — only rows where the source explicitly mentions a bidet.

### Africa web crawler (long-running, "leave no stone unturned")

`scripts/crawl-africa-web.cjs` discovers venues across ~21 non-bidet-friendly
African countries whose pages explicitly name a bidet / shattaf / Arabic shower /
douchette / washlet. It filters out e-commerce/product pages (sprayer shops),
listicles, and directory pages, requires structured venue data (schema.org
lodging/restaurant or a street address), and geocodes via photon **restricted to
the searched country's code** (so venues can't drift into the wrong nation).

```bash
# 90-minute crawl, then merge results into the seed:
node scripts/crawl-africa-web.cjs --minutes=90 --import

# crawl only (writes data/africa-web-crawl-bidets.json), import later:
node scripts/crawl-africa-web.cjs --minutes=90
node scripts/import-africa.cjs

# start over (clears queue/state):
node scripts/crawl-africa-web.cjs --reset --minutes=90
```

It is **resumable**: progress lives in `data/africa-crawl-state.json` and the
geocode cache in `data/africa-geocode-cache.json`; rows stream to
`data/africa-web-crawl-bidets.json` as they're found. Discovery rotates across
multiple search front-ends (DuckDuckGo Lite/HTML, Mojeek, Marginalia) with
exponential backoff when rate-limited. Shared parsing/geocoding logic lives in
`scripts/lib/africa-web.cjs`. To add countries, extend `COUNTRIES` in the crawler
and the `AFRICA` set in `import-africa.cjs`.

## Iceland & Greenland data import

Iceland (IS) and Greenland (GL) are **not** bidet-friendly by default, so each row
needs explicit per-venue evidence (a web source that names a bidet in the
bathroom). Curated rows live in `data/iceland-greenland-verified-bidets.json`
(each with `sourceUrl` + `sourceQuote` + country-verified coords), then:

```bash
node scripts/import-iceland-greenland.cjs
```

Sets `bidetStatus: "internet"`, `verifiedMethod: "web-source"`, and only adds
net-new rows (dedupes on name+coords, on `sourceUrl`, and on a normalized name
key). `import-iceland-greenland.cjs` merges two sources: the curated
`iceland-greenland-verified-bidets.json` **and** the crawler output
`nordic-web-crawl-bidets.json` (below). Do **not** bulk-import from generic hotel
directories — only rows where the source explicitly mentions a bidet. Bidets are
rare here (mostly a handful of Reykjavik/Golden-Circle hotels and the Ilulissat
hotels in Greenland).

### Nordic web crawler (long-running, "leave no stone unturned")

`scripts/crawl-nordic-web.cjs` discovers hotels/guesthouses/restaurants across
Iceland and Greenland whose pages explicitly name a bidet / washlet / neorest /
Geberit AquaClean / handheld sprayer. It reuses the generic Africa web-parsing
helpers (`scripts/lib/africa-web.cjs`) — venue-schema requirement, e-commerce
filtering, evidence-sentence extraction — and geocodes via photon **restricted to
IS/GL** so venues can't drift into the wrong nation.

```bash
# 90-minute crawl, then merge results into the seed:
node scripts/crawl-nordic-web.cjs --minutes=90 --import

# crawl only (writes data/nordic-web-crawl-bidets.json), import later:
node scripts/crawl-nordic-web.cjs --minutes=90
node scripts/import-iceland-greenland.cjs

# start over (clears queue/state):
node scripts/crawl-nordic-web.cjs --reset --minutes=90
```

It is **resumable**: progress lives in `data/nordic-crawl-state.json` and the
geocode cache in `data/nordic-geocode-cache.json`; rows stream to
`data/nordic-web-crawl-bidets.json` as they're found.

## UK data import (TOTO "Try WASHLET" finder)

UK WASHLET showrooms/hotels listed on TOTO's [Try WASHLET finder](https://eu.toto.com/en/service/try-washlettm) live in `data/uk-toto-finder.json` (each row has coords geocoded from its postcode via api.postcodes.io + a `sourceQuote`). Import with:

```bash
node scripts/import-uk.cjs
```

Sets `bidetStatus: "warmed"`, `verifiedMethod: "manufacturer-reference"`, and the finder URL. Dedupes on name+coords **and** a normalized name key so venues already in the seed under a different label (e.g. "The Connaught" vs "Hotel Connaught, London") are not re-added.

## TOTO Europe references (all WASHLET case studies)

TOTO publishes ~100 verified install locations at [eu.toto.com/references](https://eu.toto.com/en/company-information/references). Re-import with:

```bash
node scripts/scrape-toto-references.cjs
node scripts/finish-toto-references.cjs   # fills geocode gaps
node scripts/import-toto-references.cjs     # replaces prior eu.toto.com rows in seed
```

All get `bidetStatus: "warmed"`, `verifiedMethod: "manufacturer-reference"`, and the TOTO case study URL.

## TOTO "Try WASHLET" finder (showrooms & dealers)

TOTO lists ~1,300 showrooms/dealers where a WASHLET is installed "in the guest
toilet" and can be tried in person at [eu.toto.com/en/service/try-washlettm](https://eu.toto.com/en/service/try-washlettm)
(rendered page saved as markdown; the finder loads results via JS so it can't be
plain-fetched). Re-import with:

```bash
node scripts/scrape-toto-try.cjs [path/to/try-washlettm.md]  # parse -> data/toto-try-washlet.json
node scripts/geocode-toto-try.cjs                            # fill lat/lon (cached)
node scripts/geocode-toto-try-retry.cjs                      # smarter pass for stragglers
node scripts/import-toto-try.cjs                             # replaces prior try-washlettm rows in seed
```

The retry pass uses structured Nominatim queries (street + postcode + base
city), a postcode-centroid fallback, German street-abbreviation and city-district
cleanup, and UK house-number reordering; it also re-reads the country from the
geocoder to fix guesses and skips permanently-closed ("geschlossen") listings.

All get `type: "public"`, `bidetStatus: "warmed"`, `verifiedMethod: "manufacturer-reference"`,
`access: "public"` with a showroom `accessNote`, and the finder URL. Country is
inferred per row from phone dialling code, then website TLD, then postcode/city.

## Geberit AquaClean hotels import

Geberit's interactive AquaClean **Hotel Locator** (the Google-Maps widget that
advertises "500+ hotels") is powered by a single **static JSON feed** — the
complete European dataset of ~495 venues across ~17 countries, each row already
carrying name, address, coordinates, phone, website and the installed AquaClean
models. Every locale site serves an identical copy, e.g.
`https://www.geberit.de/_assets/local-media/locators/2026-q2-hotellocator-de.json`
(candidates listed in `LOCATOR_URLS` in `scripts/lib/geberit-web.cjs`). No
headless browser or geocoding is needed — coordinates come straight from the feed.

```bash
node scripts/scrape-geberit-locator.cjs   # fetch feed -> data/geberit-locator-hotels.json (~495 rows, w/ coords)
node scripts/import-geberit-hotels.cjs     # merge into BIDETBUD_SEED (idempotent)
```

All get `type: "hotel"`, `bidetStatus: "warmed"`,
`verifiedMethod: "manufacturer-reference"`, `access: "limited"` (hotel guests),
`bidetType` set to the installed AquaClean model, and the Hotel-Locator page as
`sourceUrl`. `import-geberit-hotels.cjs` **purges** previously-imported locator
rows first (identified by the `AquaClean Hotel Locator` marker in `sourceQuote`)
so re-running replaces them with the latest feed, then merges the locator rows
with the curated `data/geberit-france-hotels.json` and the legacy reference-page
scrape, deduping on coords **and** a normalized name key (so venues already
present from the TOTO references or reference pages aren't re-added). The feed's
`zip_location` ("ZIP City") is parsed to a clean city (postcode stripped without
slicing city letters; falls back to the address town when the field is
postcode-only), and dirty coordinate strings (e.g. a stray trailing comma) are
sanitized in `locatorRowToSeed`.

**Legacy secondary source (optional):** per-country reference pages (Netherlands,
Germany, Denmark, Austria, Switzerland — `SOURCES` in `geberit-web.cjs`) are
still parseable as a human-readable cross-check via
`scrape-geberit-hotels.cjs` + `geocode-geberit-hotels.cjs`, but the locator feed
supersedes them (more venues, exact coordinates). Curated French hotels remain in
`scrape-geberit-france-hotels.cjs`.

---

## Local development

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

**Do not** open `index.html` via `file://` — GeoJSON fetch and some assets need HTTP.

---

## UI / CSS conventions

- Design: minimal 2026-style UI — Inter font, zinc/neutral palette, defined in `css/app.css`.
- Dropdowns/menus: use the `[hidden]` attribute; CSS must not override `display` on `[hidden]` elements (see `.menu-drop[hidden]` fix).
- Search autocomplete: `#searchAc` needs high `z-index` (above map).
- Add spot: native form + mini-map pin, submitted through Web3Forms (same key as report-incorrect).
- Mobile: detail panel uses bottom-sheet pattern (`.detail-sheet`).

When changing layout, test filter chips, three-dots menu, search dropdown, and mobile detail sheet.

---

## What to avoid

- Re-introducing PWA/service worker/install banner unless explicitly requested
- Committing unless the user asks
- Adding secrets (.env, API keys) to the repo
- Bloating `index.html` with unrelated refactors — keep diffs focused
- Using `type: "restaurant"` for SG public restrooms — use `public` or `hotel` as appropriate
- Bulk-importing places of worship or restaurants without bidet-specific evidence

---

## Common tasks

| Task | Approach |
|------|----------|
| Add one verified spot | Append to `BIDETBUD_SEED`; set coords; optional `MANUAL` override |
| Bulk import region | Write a `scripts/import-*.cjs` patterned on `import-singapore.cjs` |
| Fix coordinates | `MANUAL` in `apply-address-fixes.cjs`, then run script |
| New filter/country | Update chip HTML, `updateFilterUi`, click handler, and `applyUrlState` |
| UI change | Edit `css/app.css` + minimal HTML/JS in `index.html` |

---

## Deployment

Static files deployed to Netlify. No build command — publish repo root as-is.

---

## License

MIT — see [LICENSE](LICENSE).
