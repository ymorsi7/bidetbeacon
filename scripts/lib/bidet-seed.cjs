/**
 * Read/write BIDETBUD_SEED for import scripts.
 * Full rows live in data/bidet-restaurants.json; the browser loads slim bidet-seed.js.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HTML = path.join(ROOT, 'index.html');
const SEED_JS = path.join(ROOT, 'bidet-seed.js');
const SEED_JSON = path.join(ROOT, 'bidet-seed.json');
const FULL_JSON = path.join(ROOT, 'data/bidet-restaurants.json');
const SEED_TAG = '<script src="bidet-seed.js"></script>';
const SEED_FETCH_MARK = "__BIDET_SEED_P";
const ISRAEL_NOTE = `<script>
// Israel entries disabled — not recognized as a country
// See data/israel-bidets-disabled.json (6 entries)
</script>
`;

function parseSeedJs(raw) {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('Invalid bidet-seed.js');
  return JSON.parse(raw.slice(start, end + 1));
}

/** Slim row for the client bundle — drops empty fields and truncates long quotes. */
function slimRow(r) {
  const out = {
    name: r.name,
    latitude: String(r.latitude),
    longitude: String(r.longitude),
    bidetStatus: r.bidetStatus,
  };
  if (r.address) out.address = r.address;
  if (r.city) out.city = r.city;
  if (r.country) out.country = r.country;
  if (r.type) out.type = r.type;
  if (r.bidetType) out.bidetType = String(r.bidetType).slice(0, 80);
  if (r.sourceUrl) out.sourceUrl = r.sourceUrl;
  if (r.sourceQuote) out.sourceQuote = String(r.sourceQuote).slice(0, 80);
  if (r.searchAliases) out.searchAliases = String(r.searchAliases).slice(0, 120);
  // Public is the default in normalizeSeed — omit to shrink the download.
  if (r.access === 'limited') {
    out.access = 'limited';
    if (r.accessNote) out.accessNote = String(r.accessNote).slice(0, 80);
  }
  return out;
}

function readSeedFromHtml(html) {
  const marker = 'window.BIDETBUD_SEED';
  const assign = html.indexOf(marker);
  if (assign < 0) throw new Error('BIDETBUD_SEED not found in index.html');
  const arrStart = html.indexOf('[', html.indexOf('=', assign));
  let depth = 0;
  let inStr = false;
  let esc = false;
  let i = arrStart;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return JSON.parse(html.slice(arrStart, i));
}

function readSeed() {
  if (fs.existsSync(FULL_JSON)) {
    return JSON.parse(fs.readFileSync(FULL_JSON, 'utf8'));
  }
  if (fs.existsSync(SEED_JS)) {
    return parseSeedJs(fs.readFileSync(SEED_JS, 'utf8'));
  }
  const html = fs.readFileSync(HTML, 'utf8');
  return readSeedFromHtml(html);
}

function stripInlineSeed(html) {
  const marker = 'window.BIDETBUD_SEED';
  const assign = html.indexOf(marker);
  if (assign < 0) return html;

  const scriptOpen = html.lastIndexOf('<script>', assign);
  if (scriptOpen < 0) return html;

  const scriptBody = html.slice(scriptOpen + '<script>'.length, assign);
  const comments = (scriptBody.match(/^(\s*\/\/[^\n]*\n)+/) || [''])[0];

  const arrStart = html.indexOf('[', html.indexOf('=', assign));
  let depth = 0;
  let inStr = false;
  let esc = false;
  let i = arrStart;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  while (i < html.length && /[\s;]/.test(html[i])) i++;
  const scriptClose = html.indexOf('</script>', i);
  if (scriptClose < 0) return html;

  const before = html.slice(0, scriptOpen);
  let after = html.slice(scriptClose + '</script>'.length).replace(/^\s*/, '');
  const noteBlock = comments.trim()
    ? `<script>\n${comments.trimEnd()}\n</script>\n`
    : ISRAEL_NOTE;
  if (after.startsWith(SEED_TAG)) {
    return before + noteBlock + after;
  }
  return before + noteBlock + SEED_TAG + '\n' + after;
}

function ensureHtmlUsesExternalSeed() {
  let html = fs.readFileSync(HTML, 'utf8');
  if (html.includes('window.BIDETBUD_SEED = [') || html.includes('window.BIDETBUD_SEED=[')) {
    html = stripInlineSeed(html);
  }
  // Prefer async JSON fetch (mark already in index.html). Do not re-insert the blocking script tag.
  if (!html.includes(SEED_FETCH_MARK) && !html.includes(SEED_TAG) && !html.includes('bidet-seed.json')) {
    const needle = '<script src="js/app.js" defer></script>';
    if (html.includes(needle)) {
      html = html.replace(
        needle,
        `<link rel="preload" href="bidet-seed.json" as="fetch" crossorigin>
<script>
window.__BIDET_SEED_P = fetch('bidet-seed.json', { credentials: 'same-origin' })
  .then(function (r) { if (!r.ok) throw new Error('Could not load map data'); return r.json(); });
</script>
` + needle
      );
    }
  }
  // Strip legacy blocking seed script if JSON loader is present.
  if (html.includes(SEED_FETCH_MARK) || html.includes('bidet-seed.json')) {
    html = html.replace(/<script src="bidet-seed\.js"><\/script>\n?/, '');
    html = html.replace(/<link rel="preload" href="bidet-seed\.js" as="script">\n?/, '');
  }
  fs.writeFileSync(HTML, html);
}

function writeSeed(rows) {
  if (!Array.isArray(rows)) throw new Error('writeSeed expects an array');
  fs.mkdirSync(path.dirname(FULL_JSON), { recursive: true });
  fs.writeFileSync(FULL_JSON, JSON.stringify(rows));
  const slim = rows.map(slimRow);
  const json = JSON.stringify(slim);
  fs.writeFileSync(SEED_JSON, json + '\n');
  // Keep legacy .js for any old bookmarks/scripts; browser boot uses .json.
  fs.writeFileSync(SEED_JS, 'window.BIDETBUD_SEED=' + json + ';\n');
  ensureHtmlUsesExternalSeed();
}

module.exports = {
  ROOT,
  HTML,
  SEED_JS,
  SEED_JSON,
  FULL_JSON,
  readSeed,
  writeSeed,
  slimRow,
};
