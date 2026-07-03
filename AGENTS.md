# AGENTS.md — BidetBeacon

Guide for AI agents and contributors working in this repository.

## Project summary

**BidetBeacon** is a static, client-only map for finding bidet-equipped restrooms — masajid, restaurants, hotels, and public spots — in the **USA, UK, Canada, and Singapore**.

- **Live:** [bidetbeacon.netlify.app](https://bidetbeacon.netlify.app/)
- **Stack:** Single HTML page + CSS. No build step, no backend, no framework.
- **Map:** Leaflet + MarkerCluster (bundled inline in `index.html`)
- **Data:** Embedded JSON array `window.BIDETBEACON_SEED` (~998 entries)
- **Submissions:** Airtable form (opens in new tab; URL in `index.html`)
- **Analytics:** GoatCounter (`bidetbeacon.goatcounter.com`)

Related but separate project: [bidetbeacon.com](https://www.bidetbeacon.com/) is the Singapore-only PWA (“Bidet Beacon SG”). Singapore data for this repo is imported from its public JSON export.

---

## Repository layout

```
index.html                          App shell, inline JS, seed data (large file ~0.7 MB)
css/app.css                         All UI styles (Inter font, zinc palette)
css/github-star.css                 Footer link styles
images/                             Logo and favicons
data/singapore-bidets.geolocation.json   Cached SG source (community bidet sightings only)
data/france-verified-bidets.json         Curated FR rows with cited evidence (not bulk OSM)
scripts/
  apply-address-fixes.cjs           Re-geocode seed; manual coordinate overrides
  import-singapore.cjs              Merge @toiletswithbidetsg / Bidet Beacon SG JSON
  import-france.cjs                 Merge only rows from france-verified-bidets.json
  scrape-toto-references.cjs        Fetch all TOTO Europe WASHLET case studies
  finish-toto-references.cjs        Append manual coords for ambiguous TOTO venues
  import-toto-references.cjs        Merge TOTO references into BIDETBEACON_SEED
  address-fix-report.json           Output from geocode script (optional)
```

---

## Architecture constraints

**Keep it static.** Do not add:

- Node/npm build pipelines, React/Vue, or SSR
- Service workers, PWA manifests, or install prompts (removed intentionally)
- Backend APIs or server-side geocoding at runtime

**Do use:**

- Vanilla JS in `index.html` (inside the main `<script>` block after seed data)
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

## Seed data (`BIDETBEACON_SEED`)

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

- The seed is a **single minified JSON array** on one line in `index.html` (search for `window.BIDETBEACON_SEED =`).
- Prefer **scripts** for bulk adds (see `scripts/import-singapore.cjs`) rather than hand-editing hundreds of entries.
- After coordinate changes, run `node scripts/apply-address-fixes.cjs` and add `MANUAL` overrides in that script for known-good coords.
- Validate after edits: `node -e "JSON.parse(require('fs').readFileSync('index.html','utf8').match(/BIDETBEACON_SEED\\s*=\\s*(\\[[\\s\\S]*?\\]);/)[1])"`

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
| Analytics | `window.trackEvent(name, props)` — events: `bidetbeacon_view`, `bidetbeacon_add_open`, `bidetbeacon_promo_show`, `bidetbeacon_spot_open` |

---

## Copy and terminology

- Use **masajid** (not “masajed”) in all user-facing copy.
- Internal `type` value remains `mosque`; UI label is “Masjid”.
- Country filter chips: USA, UK, Canada, Singapore (`data-type` on chips doubles as country code for those four).

---

## Singapore data import

Source: `https://www.bidetbeacon.com/data/bidets.geolocation.json` (584 locations, synced from [@toiletswithbidetsg](https://www.instagram.com/toiletswithbidetsg/)).

This is a **bidet-only** community map — each row is a user-submitted sighting (photo + location), not a generic toilet directory. Safe to import in bulk.

```bash
curl -sL "https://www.bidetbeacon.com/data/bidets.geolocation.json" \
  -o data/singapore-bidets.geolocation.json
node scripts/import-singapore.cjs
```

Sets `bidetStatus: "internet"`, `verifiedMethod: "community-sighting"`, and replaces existing Singapore rows on re-run.

## France data import

**Do not** bulk-scrape OSM mosques. Add rows only to `data/france-verified-bidets.json` with explicit evidence, then:

```bash
node scripts/import-france.cjs
```

## TOTO Europe references (all WASHLET case studies)

TOTO publishes ~100 verified install locations at [eu.toto.com/references](https://eu.toto.com/en/company-information/references). Re-import with:

```bash
node scripts/scrape-toto-references.cjs
node scripts/finish-toto-references.cjs   # fills geocode gaps
node scripts/import-toto-references.cjs     # replaces prior eu.toto.com rows in seed
```

All get `bidetStatus: "warmed"`, `verifiedMethod: "manufacturer-reference"`, and the TOTO case study URL.

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
- Airtable: form opens in **new tab** via button (`AIRTABLE_FORM_URL`), not an embedded iframe.
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
| Add one verified spot | Append to `BIDETBEACON_SEED`; set coords; optional `MANUAL` override |
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
