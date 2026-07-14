# BidetBud

A free map of places with bidets — masajid, restaurants, hotels, and public restrooms.

**Live:** [bidetbud.com](https://bidetbud.com/)

Started as a US / UK / Canada / Singapore map. Coverage has grown a lot since (Europe, Russia, China, parts of Africa, and more), but every pin still needs real evidence that a bidet, washlet, or handheld sprayer is there. No guessing.

If this has saved you a stop, star the repo so other people can find it.

## What’s here

- Static site. No build step, no backend, no accounts.
- Map: Leaflet + MarkerCluster
- Data: `bidet-seed.json` (async client load) and `data/bidet-restaurants.json` (full rows for scripts)
- Submissions: in-page form → Web3Forms (email)
- Analytics: GoatCounter

Statuses on the map:

| Status | Meaning |
|--------|---------|
| Verified | Someone confirmed it in person |
| Heated | Manufacturer install (TOTO WASHLET, Geberit AquaClean, etc.) |
| Web | Cited online source — not yet personally checked |

## Run locally

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Don’t open `index.html` as a `file://` URL — some assets and GeoJSON need HTTP.

## Layout

```
index.html              App shell
js/app.js               UI logic
bidet-seed.json         Slim seed (fetched async)
vendor/                 Leaflet + MarkerCluster
css/app.css             Styles
data/bidet-restaurants.json   Full location rows
scripts/                One-off import / geocode / crawl helpers
images/                 Logo + favicons
```

## Add a spot

Prefer a personal check. For web-sourced entries, include `sourceUrl` and a short `sourceQuote`.

Example:

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

`type` is one of: `mosque`, `restaurant`, `hotel`, `public`.  
`bidetStatus` must be `verified`, `warmed`, or `internet` to show on the map.

After bulk edits, regenerate the client seed through the helpers in `scripts/` (see `scripts/lib/bidet-seed.cjs`). Don’t bulk-import mosques or restaurants just because “they probably have one.”

## Contributing

PRs welcome for:

- New verified or well-sourced locations
- Coordinate / address fixes
- UI polish

Please keep diffs focused. Only add places with explicit bidet evidence.

## License

MIT — see [LICENSE](LICENSE).
