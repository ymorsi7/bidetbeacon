(function(){
  // Web3Forms access key (public, safe in client code). Get a free key at https://web3forms.com
  // Submissions and reports are emailed to the address tied to this key.
  const WEB3FORMS_ACCESS_KEY = 'b0f5343d-1608-4224-a49a-d32d13fbbdfe';
  const SITE_URL = 'https://bidetbud.com/';
  const COUNTRY_FILTERS = ['USA', 'UK', 'Canada', 'France', 'Russia', 'China'];
  const POPULAR_CITIES = ['Bay Area', 'Houston', 'London', 'Toronto', 'Los Angeles', 'Chicago', 'Ellicott City'];
  const RADIUS_OPTIONS = [25, 50, 100];
  const MAP_MIN_ZOOM = 3;
  const DEFAULT_MAP_CENTER = { lat: 39.8283, lng: -98.5795 };
  const DEFAULT_MAP_ZOOM = 4;

  const HAS_BIDET = s => s === 'verified' || s === 'warmed' || s === 'internet';
  const NO_BIDET = s => s === 'none';
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  let allLocations = [], userLocation = null, map, clusterGroup, pickMarker, countriesLayer;
  let lastFiltered = [];
  let refreshTimer = null;
  let mapMoveTimer = null;
  const LIST_CAP = 200;
  const MAP_MARKER_CAP = 2500;
  let addPickMap, addPickMapMarker;
  let placeFilter = 'all', extraFilter = null, countryFilter = null, noBidetMode = false, showLimitedAccess = false;
  let nearMe = false, radiusMi = 50;
  let suppressUrlWrite = false, initialBoundsDone = false, activeSpotId = null;

  // Countries where bidets, washlets, or handheld sprayers are the norm — not spot-level exceptions.
  const BIDET_FRIENDLY_COUNTRIES = [
    'Japan', 'South Korea', 'Taiwan',
    'Italy', 'Greece',
    // Middle East & North Africa — shattaf / handheld sprayers are standard
    'Turkey', 'Syria', 'Lebanon', 'Jordan', 'Palestine', 'Iraq', 'Iran', 'Yemen',
    'Saudi Arabia', 'United Arab Emirates', 'Kuwait', 'Qatar', 'Bahrain', 'Oman',
    'Egypt', 'Libya', 'Tunisia', 'Algeria', 'Morocco', 'Sudan',
    // South & Southeast Asia — sprayers / water cleansing are standard
    'India', 'Pakistan', 'Bangladesh', 'Nepal', 'Sri Lanka', 'Afghanistan',
    'Malaysia', 'Indonesia', 'Thailand', 'Vietnam', 'Philippines', 'Cambodia',
    'Brunei', 'Laos', 'Myanmar', 'Maldives', 'East Timor',
    'Argentina', 'Uruguay', 'Brazil'
  ];
  const BIDET_FRIENDLY_GEO_NAMES = new Set(BIDET_FRIENDLY_COUNTRIES.map(name => ({
    Serbia: 'Republic of Serbia'
  }[name] || name)));
  // Bidets are common nationwide in these countries (shaded on the map), so
  // individual pins there are redundant and get filtered out of the seed.
  const BIDET_FRIENDLY_COUNTRY_SET = new Set(
    BIDET_FRIENDLY_COUNTRIES
      .concat(['UAE']) // seed abbreviation for United Arab Emirates
      .map(c => c.toLowerCase())
  );
  function isBidetFriendlyCountry(country){
    return BIDET_FRIENDLY_COUNTRY_SET.has(String(country || '').trim().toLowerCase());
  }
  // Lightweight Natural Earth 110m boundaries (~250 KB) instead of the full-res
  // datasets/geo-countries file (~14.6 MB). Same `properties.name` schema.
  const BIDET_COUNTRY_GEOJSON_URL = 'https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json';

  function addCartoVoyagerTiles(targetMap, showAttribution, noWrap){
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      noWrap: Boolean(noWrap),
      attribution: showAttribution ? '© OpenStreetMap · © CARTO' : undefined
    }).addTo(targetMap);
  }

  function seedMapCenter(locations){
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    let count = 0;
    for (const m of locations) {
      if (!validCoord(m)) continue;
      const lat = +m.latitude, lng = +m.longitude;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      count++;
    }
    if (!count) return { lat: 20, lng: 0 };
    return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  }

  function stableSeedId(row){
    const s = (row.name||'') + '|' + row.latitude + '|' + row.longitude;
    let h = 0; for (let i=0;i<s.length;i++) h = ((h<<5)-h+s.charCodeAt(i))|0;
    return 'seed_' + Math.abs(h).toString(36);
  }

  function haversineMiles(a,b){
    const R=3959,dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180;
    const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  }

  function normalizeSeed(row){
    const s = row.bidetStatus;
    let defaultType = 'Verified bidet';
    if(s === 'warmed') defaultType = 'Heated seat';
    else if(s === 'internet') defaultType = 'Web source';
    else if(s === 'none') defaultType = '';
    const access = row.access === 'limited' ? 'limited' : 'public';
    return {
      id: stableSeedId(row), name: row.name, address: row.address||'', latitude: String(row.latitude), longitude: String(row.longitude),
      city: row.city||'', country: row.country||'', type: row.type||'mosque', bidetStatus: s,
      bidetType: row.bidetType || defaultType,
      sourceUrl: row.sourceUrl || '',
      sourceQuote: row.sourceQuote || '',
      verifiedMethod: row.verifiedMethod || '',
      searchAliases: row.searchAliases || '',
      access,
      accessNote: access === 'limited' ? (row.accessNote || 'Not a regular public restroom') : ''
    };
  }

  function initData(){
    allLocations = (window.BIDETBUD_SEED||[])
      .map(normalizeSeed)
      .filter(l => HAS_BIDET(l.bidetStatus) || NO_BIDET(l.bidetStatus))
      .filter(l => !isBidetFriendlyCountry(l.country));
  }

  function ensureSearchMeta(m){
    if(!m._search) m._search = buildSearchMeta(m);
  }

  const SEARCH_STOP = new Set(['the','a','an','and','or','of','at','in','on','for','to','&']);

  function normalizeSearchText(s){
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function nameWords(name){
    return normalizeSearchText(name).split(' ').filter(w => w && !SEARCH_STOP.has(w));
  }

  function buildSearchMeta(m){
    const words = nameWords(m.name);
    const acronym = words.map(w => w[0]).join('');
    const hay = normalizeSearchText([m.name, m.city, m.address, m.country, m.bidetType].filter(Boolean).join(' '));
    const aliases = new Set([acronym]);
    if(m.searchAliases){
      String(m.searchAliases).split(/[,;|]/).forEach(a => {
        const t = normalizeSearchText(a).replace(/\s/g, '');
        if(t) aliases.add(t);
      });
    }
    return { hay, words, acronym, aliases: [...aliases] };
  }

  function matchesInitials(words, compact){
    if(!compact) return false;
    let wi = 0;
    for(let i = 0; i < compact.length; i++){
      while(wi < words.length && words[wi][0] !== compact[i]) wi++;
      if(wi >= words.length) return false;
      wi++;
    }
    return true;
  }

  function searchScore(m, rawQ){
    const q = normalizeSearchText(rawQ);
    if(!q) return 0;
    ensureSearchMeta(m);
    const s = m._search;
    const compact = q.replace(/\s/g, '');
    if(s.hay.includes(q)){
      if(s.hay.startsWith(q)) return 90;
      if(normalizeSearchText(m.name).startsWith(q)) return 85;
      return 70;
    }
    if(compact.length >= 2){
      if(s.acronym === compact) return 100;
      if(s.aliases.some(a => a === compact)) return 98;
      if(s.acronym.startsWith(compact)) return 88;
      if(s.aliases.some(a => a.startsWith(compact))) return 86;
      if(matchesInitials(s.words, compact)) return 75;
    }
    const tokens = q.split(' ').filter(Boolean);
    if(tokens.length > 1){
      const hayWords = s.hay.split(' ');
      if(tokens.every(t => hayWords.some(w => w.startsWith(t)))) return 65;
    }
    return 0;
  }

  function matchesSearch(m, rawQ){
    return searchScore(m, rawQ) > 0;
  }

  function spotShareUrl(id){
    const p = new URLSearchParams(location.search);
    p.set('spot', id);
    return location.origin + location.pathname + '?' + p.toString();
  }

  function syncUrlFromState(){
    if(suppressUrlWrite) return;
    const p = new URLSearchParams();
    const q = document.getElementById('searchInput').value.trim();
    if(q) p.set('q', q);
    if(placeFilter !== 'all') p.set('type', placeFilter);
    if(extraFilter) p.set('filter', extraFilter);
    if(countryFilter) p.set('country', countryFilter);
    if(noBidetMode) p.set('nobidet', '1');
    if(showLimitedAccess) p.set('limited', '1');
    if(nearMe){ p.set('near', '1'); p.set('radius', String(radiusMi)); }
    if(activeSpotId) p.set('spot', activeSpotId);
    const next = p.toString() ? '?' + p.toString() : location.pathname;
    history.replaceState(null, '', next);
  }

  function applyUrlState(){
    const p = new URLSearchParams(location.search);
    suppressUrlWrite = true;
    if(p.get('utm_source') === 'masjid') placeFilter = 'mosque';
    const q = p.get('q');
    if(q) document.getElementById('searchInput').value = q;
    if(p.get('type')) placeFilter = p.get('type');
    if(p.get('filter')) extraFilter = p.get('filter');
    if(p.get('nobidet') === '1') noBidetMode = true;
    if(p.get('limited') === '1') showLimitedAccess = true;
    const spotId = p.get('spot') || '';
    if(spotId){
      const spot = allLocations.find(x => x.id === spotId);
      if(spot && spot.access === 'limited') showLimitedAccess = true;
    }
    const country = p.get('country');
    if(country && COUNTRY_FILTERS.includes(country)) countryFilter = country;
    if(p.get('near') === '1') nearMe = true;
    if(p.get('radius')) radiusMi = parseInt(p.get('radius'), 10) || 50;
    updateFilterUi();
    updateNearMeUi();
    suppressUrlWrite = false;
    return spotId;
  }

  function setShowLimitedAccess(on){
    showLimitedAccess = Boolean(on);
    if(!showLimitedAccess && extraFilter === 'limited') extraFilter = null;
    initialBoundsDone = false;
    updateFilterUi();
    refresh();
    if(typeof window.trackEvent === 'function') window.trackEvent('bidetbud_limited_toggle', { on: showLimitedAccess });
  }

  function setNoBidetMode(on){
    noBidetMode = Boolean(on);
    // Status filters (verified/heated/web) don't apply to no-bidet records.
    if(noBidetMode && (extraFilter==='verified' || extraFilter==='warmed' || extraFilter==='internet')){
      extraFilter = null;
    }
    initialBoundsDone = false;
    updateFilterUi();
    refresh();
    if(typeof window.trackEvent === 'function') window.trackEvent('bidetbud_no_bidet_toggle', { on: noBidetMode });
  }

  function updateFilterUi(){
    const noBidetBtn = document.getElementById('noBidetToggle');
    if(noBidetBtn){
      noBidetBtn.classList.toggle('active', noBidetMode);
      noBidetBtn.setAttribute('aria-pressed', noBidetMode ? 'true' : 'false');
    }
    const limitedBtn = document.getElementById('limitedAccessToggle');
    if(limitedBtn){
      limitedBtn.classList.toggle('active', showLimitedAccess);
      limitedBtn.setAttribute('aria-pressed', showLimitedAccess ? 'true' : 'false');
    }
    const legendNone = document.getElementById('legendNone');
    if(legendNone) legendNone.hidden = !noBidetMode;
    document.querySelectorAll('#placeFilter button').forEach(b=>{
      b.classList.toggle('active', b.dataset.type === placeFilter);
    });
    document.querySelectorAll('#typeChips .chip[data-type]').forEach(b=>{
      const t = b.dataset.type;
      if(COUNTRY_FILTERS.includes(t)){
        b.classList.toggle('active', countryFilter === t);
      } else {
        b.classList.toggle('active', extraFilter === t);
      }
    });
    document.querySelectorAll('#radiusRow button').forEach(b=>{
      b.classList.toggle('active', parseInt(b.dataset.radius, 10) === radiusMi);
    });
    const radiusRow = document.getElementById('radiusRow');
    if(radiusRow) radiusRow.hidden = !nearMe;
  }

  function updateNearMeUi(){
    const btn = document.getElementById('nearMeBtn');
    const label = btn?.querySelector('.btn-label');
    btn?.classList.toggle('active', nearMe);
    if(label) label.textContent = nearMe ? 'Near me ✓' : 'Near me';
  }

  function setPickCoords(lat, lng, source){
    document.getElementById('addLat').value = lat.toFixed(6);
    document.getElementById('addLng').value = lng.toFixed(6);
    showCoordHint(lat, lng);
    if(source === 'main' && pickMarker && map){
      pickMarker.setLatLng([lat, lng]);
    } else if(source === 'add' && addPickMap){
      if(addPickMapMarker) addPickMapMarker.setLatLng([lat, lng]);
      else addPickMapMarker = L.marker([lat, lng], {icon:createIcon('verified'), draggable:true}).addTo(addPickMap);
      addPickMapMarker.on('dragend', ()=>{
        const ll = addPickMapMarker.getLatLng();
        setPickCoords(ll.lat, ll.lng, 'add');
      });
      addPickMap.setView([lat, lng], Math.max(addPickMap.getZoom(), 15));
    }
  }

  function initSubmitPanel(){
    const intro = document.getElementById('addIntro');
    if(intro){
      intro.textContent = 'Use the mini-map to drop a pin, then submit. Confirmed bidets only — we review every spot before it goes live.';
    }
    document.getElementById('addDialog')?.classList.remove('embed-mode');
    const emailPanel = document.getElementById('emailPanel');
    if(emailPanel) emailPanel.hidden = false;
  }

  function initAddPickMap(){
    const el = document.getElementById('addPickMap');
    if(!el || typeof L === 'undefined') return;
    if(addPickMap){ addPickMap.invalidateSize(); return; }
    const start = userLocation || {lat: 39.8283, lng: -98.5795};
    addPickMap = L.map(el, {zoomControl:true, attributionControl:false}).setView([start.lat, start.lng], userLocation ? 12 : 4);
    addCartoVoyagerTiles(addPickMap, false);
    addPickMap.on('click', e=> setPickCoords(e.latlng.lat, e.latlng.lng, 'add'));
    setTimeout(()=> addPickMap.invalidateSize(), 120);
  }

  function destroyAddPickMap(){
    if(addPickMap){
      addPickMap.remove();
      addPickMap = null;
      addPickMapMarker = null;
    }
  }

  function showCoordHint(lat, lng){
    const hint = document.getElementById('coordHint');
    const text = lat.toFixed(6) + ', ' + lng.toFixed(6);
    hint.textContent = 'Pin at ' + text;
    hint.classList.add('show');
    if(navigator.clipboard) navigator.clipboard.writeText(text).catch(()=>{});
    const details = document.getElementById('addPinDetails');
    if(details) details.open = true;
  }

  function validCoord(m){
    const lat=+m.latitude,lng=+m.longitude;
    return !isNaN(lat)&&!isNaN(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
  }

  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function highlight(text,q){
    if(!q||!text) return escapeHtml(text||'');
    const t=String(text), i=t.toLowerCase().indexOf(q);
    if(i===-1) return escapeHtml(t);
    return escapeHtml(t.slice(0,i))+'<mark class="hl">'+escapeHtml(t.slice(i,i+q.length))+'</mark>'+escapeHtml(t.slice(i+q.length));
  }

  function getQuery(){ return document.getElementById('searchInput').value.trim().toLowerCase(); }
  function isMobile(){ return window.matchMedia('(max-width:820px)').matches; }
  function isTypingTarget(el){
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }

  function setOverlayOpen(id, open){
    const el = document.getElementById(id);
    if(!el) return;
    el.classList.toggle('open', open);
    const anyOpen = document.querySelector('.overlay.open');
    document.body.classList.toggle('modal-open', Boolean(anyOpen));
    if(id === 'addOverlay'){
      if(open){
        setOverlayOpen('promoOverlay', false);
      } else {
        destroyAddPickMap();
      }
    }
    if(id === 'detailOverlay' && !open) activeSpotId = null;
    if(!open || id === 'detailOverlay') syncUrlFromState();
  }

  function openAddForm(source){
    setOverlayOpen('addOverlay', true);
    const pinDetails = document.getElementById('addPinDetails');
    if(pinDetails) pinDetails.open = true;
    setTimeout(initAddPickMap, 80);
    if(typeof window.trackEvent === 'function'){
      window.trackEvent('bidetbud_add_open', { source: source || 'unknown' });
    }
    maybeShowPromo('intent');
  }

  function markPromoSeen(){
    try{ localStorage.setItem('bb_promo_seen', '1'); }catch(e){}
  }

  function promoLater(){
    try{ localStorage.setItem('bb_promo_later', String(Date.now() + 7 * 86400000)); }catch(e){}
    setOverlayOpen('promoOverlay', false);
  }

  function shouldShowPromoPopup(){
    try{
      if(localStorage.getItem('bb_promo_seen') === '1') return false;
      const later = parseInt(localStorage.getItem('bb_promo_later') || '0', 10);
      if(later && Date.now() < later) return false;
    }catch(e){}
    return true;
  }

  function maybeShowPromo(reason){
    if(!shouldShowPromoPopup()) return;
    if(document.querySelector('.overlay.open')) return;
    setOverlayOpen('promoOverlay', true);
    markPromoSeen();
    if(typeof window.trackEvent === 'function'){
      window.trackEvent('bidetbud_promo_show', { reason: reason || 'unknown' });
    }
  }

  function initPromoPopup(){
    document.getElementById('promoGotItBtn')?.addEventListener('click', ()=> dismissPromoPopup());
    document.getElementById('promoLaterBtn')?.addEventListener('click', ()=> promoLater());
    document.getElementById('promoClose')?.addEventListener('click', ()=> dismissPromoPopup());
    document.getElementById('promoOverlay')?.addEventListener('click', e=>{
      if(e.target.id === 'promoOverlay') dismissPromoPopup();
    });
  }

  function dismissPromoPopup(){
    setOverlayOpen('promoOverlay', false);
    markPromoSeen();
  }

  function showThankYou(){
    const shareUrl = encodeURIComponent(SITE_URL);
    const shareText = encodeURIComponent('Find masajid and restaurants with bidets — BidetBud');
    document.getElementById('thankYouContent').innerHTML =
      '<h2>Thanks for contributing!</h2>'+
      '<p class="sub">We review every submission. Share BidetBud with your community:</p>'+
      '<div class="dialog-actions share-actions">'+
      '<a class="btn btn-primary" href="https://wa.me/?text='+shareText+'%20'+shareUrl+'" target="_blank" rel="noopener">Share on WhatsApp</a>'+
      '<a class="btn btn-ghost" href="https://t.me/share/url?url='+shareUrl+'&text='+shareText+'" target="_blank" rel="noopener">Telegram</a>'+
      '<button type="button" class="btn btn-ghost" id="copySiteLink">Copy link</button>'+
      '</div>';
    setOverlayOpen('thankYouOverlay', true);
    document.getElementById('copySiteLink')?.addEventListener('click', ()=>{
      navigator.clipboard?.writeText(SITE_URL).then(()=> alert('Link copied!')).catch(()=>{});
    });
  }

  function setMobileView(view){
    document.querySelectorAll('.mobile-tab').forEach(t=>{
      const on = t.dataset.view === view;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.getElementById('appMain').classList.toggle('show-list', view === 'list');
    if(map) setTimeout(()=>map.invalidateSize(), 120);
  }

  function updateMobileTabBadge(count){
    const badge = document.getElementById('listTabBadge');
    if(!badge) return;
    if(isMobile() && count > 0){
      badge.textContent = count > 999 ? '999+' : String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function filterLocations(){
    const q = getQuery();
    return allLocations.filter(m=>{
      if(!validCoord(m)) return false;
      if(noBidetMode){
        if(!NO_BIDET(m.bidetStatus)) return false;
      } else if(!HAS_BIDET(m.bidetStatus)) return false;
      if(placeFilter==='mosque' && m.type!=='mosque') return false;
      if(placeFilter==='restaurant' && m.type!=='restaurant') return false;
      if(extraFilter==='warmed' && m.bidetStatus!=='warmed') return false;
      if(extraFilter==='verified' && m.bidetStatus!=='verified') return false;
      if(extraFilter==='internet' && m.bidetStatus!=='internet') return false;
      if(extraFilter==='public' && m.access!=='public') return false;
      if(extraFilter==='limited' && m.access!=='limited') return false;
      if(!showLimitedAccess && m.access==='limited' && extraFilter!=='limited') return false;
      if(countryFilter && m.country !== countryFilter) return false;
      if(nearMe && userLocation){
        const dist = haversineMiles(userLocation,{lat:+m.latitude,lng:+m.longitude});
        if(dist>radiusMi) return false;
      }
      if(q) return matchesSearch(m, q);
      return true;
    });
  }

  function formatBidetType(s){
    return String(s||'')
      .split(',')
      .map(p => p.replace(/\s+/g,' ').trim())
      .filter(Boolean)
      .join(', ');
  }

  function statusTag(m){
    if(m.bidetStatus==='none') return '<span class="tag tag-none">No bidet</span>';
    if(m.bidetStatus==='internet') return '<span class="tag tag-internet">Web</span>';
    if(m.bidetStatus==='warmed') return '<span class="tag tag-warmed">Heated</span>';
    return '<span class="tag tag-verified">Verified</span>';
  }

  function accessTag(m){
    if(m.access==='limited') return '<span class="tag tag-limited">Limited access</span>';
    return '';
  }

  function accessWarn(m){
    if(m.access!=='limited') return '';
    return '<div class="access-warn"><strong>Limited access — not a public restroom</strong>'+escapeHtml(m.accessNote||'Hotel rooms, showrooms, and private clubs are not open to walk-in visitors.')+'</div>';
  }

  function typeLabel(t){ return t==='restaurant' ? 'Restaurant' : t==='hotel' ? 'Hotel' : t==='public' ? 'Public' : 'Masjid'; }

  function createIcon(status, access){
    let color = '#059669', emoji = '✓';
    if(status==='warmed'){ color = '#d97706'; emoji = '🔥'; }
    else if(status==='internet'){ color = '#2563eb'; emoji = '🌐'; }
    else if(status==='none'){ color = '#71717a'; emoji = '✕'; }
    if(access==='limited' && status!=='none'){ emoji = '🔒'; }
    const border = access==='limited' ? '2.5px dashed #fff' : '2.5px solid #fff';
    const ring = access==='limited' ? 'outline:2px dashed #fb923c;outline-offset:1px;' : '';
    return L.divIcon({
      html:'<div style="background:'+color+';color:#fff;border:'+border+';border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.22);font-size:13px;font-weight:700;'+ring+'">'+emoji+'</div>',
      className:'custom-marker', iconSize:[30,30], iconAnchor:[15,15], popupAnchor:[0,-15]
    });
  }

  function sortedLocations(list){
    const q = getQuery();
    return [...list].sort((a,b)=>{
      if(q){
        const sa = searchScore(a, q), sb = searchScore(b, q);
        if(sa !== sb) return sb - sa;
      }
      if(a.access!==b.access){
        if(a.access==='public') return -1;
        if(b.access==='public') return 1;
      }
      if(nearMe && userLocation){
        const da=haversineMiles(userLocation,{lat:+a.latitude,lng:+a.longitude});
        const db=haversineMiles(userLocation,{lat:+b.latitude,lng:+b.longitude});
        return da-db;
      }
      return a.name.localeCompare(b.name);
    });
  }

  function cardStatusClass(m){
    if(m.bidetStatus==='none') return 'card--none';
    if(m.access==='limited') return 'card-limited';
    if(m.bidetStatus==='internet') return 'card--internet';
    if(m.bidetStatus==='warmed') return 'card--warmed';
    return 'card--verified';
  }

  function emptyStateHtml(){
    let msg = 'No places match your filters.';
    if(noBidetMode) msg = 'No spots recorded without a bidet here yet. Toggle "No bidet" off to see spots that do have one.';
    else if(nearMe && placeFilter === 'mosque') msg = 'No masajid with bidets within '+radiusMi+' mi. Try a wider radius or search a nearby city.';
    else if(nearMe) msg = 'Nothing within '+radiusMi+' mi. Try 100 mi or search a city name.';
    else if(placeFilter === 'mosque') msg = 'No masajid match yet. Try another city or add a wudu-friendly spot you know.';
    const chips = POPULAR_CITIES.map(c=>'<button type="button" class="chip city-chip" data-city="'+escapeHtml(c)+'">'+escapeHtml(c)+'</button>').join('');
    return '<div class="empty"><p class="empty-title">No matches</p><p class="empty-sub">'+msg+'</p><div class="empty-chips">'+chips+'</div><button type="button" class="btn btn-primary" style="margin-top:16px" id="emptyAddBtn">Add a spot</button></div>';
  }

  function renderList(filtered){
    const q=getQuery(), el=document.getElementById('locationList');
    const verified = filtered.filter(m=>m.bidetStatus==='verified').length;
    const warmed = filtered.filter(m=>m.bidetStatus==='warmed').length;
    const internet = filtered.filter(m=>m.bidetStatus==='internet').length;
    const limited = filtered.filter(m=>m.access==='limited').length;
    const pub = filtered.length - limited;
    const masajid = filtered.filter(m=>m.type==='mosque').length;
    let countHtml;
    if(noBidetMode){
      countHtml = '<strong>'+filtered.length+'</strong> '+(filtered.length===1?'spot':'spots')+' recorded <em>without</em> a bidet';
    } else if(placeFilter==='restaurant'){
      countHtml = '<strong>'+filtered.length+'</strong> '+(filtered.length===1?'restaurant':'restaurants')+' with bidets';
    } else if(placeFilter==='mosque'){
      countHtml = '<strong>'+filtered.length+'</strong> '+(filtered.length===1?'masjid':'masajid')+' with bidets';
    } else {
      countHtml = '<strong>'+filtered.length+'</strong> '+(filtered.length===1?'place':'places');
    }
    if(nearMe) countHtml += ' within '+radiusMi+' mi';
    const badges = [];
    if(masajid && placeFilter!=='mosque') badges.push(masajid+' masajid');
    const restaurants = filtered.filter(m=>m.type==='restaurant').length;
    if(restaurants && placeFilter!=='restaurant') badges.push(restaurants+' restaurants');
    if(pub && placeFilter==='all') badges.push(pub+' open access');
    if(limited) badges.push(limited+' guests only');
    if(verified) badges.push(verified+' verified');
    if(warmed) badges.push(warmed+' heated');
    if(internet) badges.push(internet+' web');
    if(badges.length) countHtml += '<div class="count-badges">'+badges.map(b=>'<span class="count-badge">'+b+'</span>').join('')+'</div>';
    document.getElementById('countLabel').innerHTML = countHtml;
    updateMobileTabBadge(filtered.length);
    if(!filtered.length){
      el.innerHTML = emptyStateHtml();
      document.getElementById('emptyAddBtn')?.addEventListener('click', ()=> openAddForm('empty_list'));
      el.querySelectorAll('.city-chip').forEach(btn=>btn.addEventListener('click', ()=>{
        document.getElementById('searchInput').value = btn.dataset.city;
        hideSearchAc();
        refresh();
      }));
      return;
    }
    el.innerHTML = sortedLocations(filtered).slice(0, LIST_CAP).map(m=>{
      let dist='';
      if(nearMe && userLocation) dist = haversineMiles(userLocation,{lat:+m.latitude,lng:+m.longitude}).toFixed(1)+' mi';
      const limitedNote = m.bidetStatus==='none'
        ? '<p class="card-note card-note--none">We checked — no bidet or handheld sprayer here.</p>'
        : (m.access==='limited' ? '<p class="card-note">'+escapeHtml(m.accessNote)+'</p>' : '');
      const cardClass = 'card '+cardStatusClass(m);
      const typeIcon = typeLabel(m.type);
      const bidetLabel = formatBidetType(m.bidetType);
      const bidetTag = bidetLabel ? '<span class="tag tag-bidet">'+escapeHtml(bidetLabel)+'</span>' : '';
      return '<article class="'+cardClass+'" data-id="'+m.id+'"><h3>'+highlight(m.name,q)+'</h3><div class="card-tags">'+statusTag(m)+accessTag(m)+bidetTag+'</div>'+(m.address?'<p class="addr">'+highlight(m.address,q)+'</p>':'')+(m.city?'<p class="loc">'+highlight(m.city,q)+(m.country?', '+highlight(m.country,q):'')+'</p>':'')+limitedNote+'<div class="card-meta"><span class="tag tag-type">'+typeIcon+'</span>'+(dist?'<span class="dist card-foot">'+dist+'</span>':'')+'</div></article>';
    }).join('') + (filtered.length > LIST_CAP ? '<p class="sub list-cap-note">Showing '+LIST_CAP+' of '+filtered.length+' — zoom the map or search to narrow results.</p>' : '');
    el.querySelectorAll('.card').forEach(c=>c.addEventListener('click',()=>openDetail(c.dataset.id)));
  }

  function markersForMap(filtered){
    if(!filtered.length) return [];
    const q = getQuery();
    let rows = filtered;
    if(map && !q && !nearMe && !activeSpotId && filtered.length > 1200){
      const bounds = map.getBounds().pad(0.25);
      const inView = filtered.filter(m => bounds.contains([+m.latitude, +m.longitude]));
      if(inView.length) rows = inView;
    }
    if(rows.length > MAP_MARKER_CAP) return rows.slice(0, MAP_MARKER_CAP);
    return rows;
  }

  function renderMap(filtered){
    if(!clusterGroup) return;
    clusterGroup.clearLayers();
    const mapRows = markersForMap(filtered);
    const markers = mapRows.map(m=>{
      const marker = L.marker([+m.latitude,+m.longitude],{icon:createIcon(m.bidetStatus,m.access)});
      marker.on('click',()=>openDetail(m.id));
      const tip = m.access==='limited' ? m.name + ' (limited access)' : m.name;
      marker.bindTooltip(tip,{direction:'top',offset:[0,-12]});
      return marker;
    });
    // Bulk insert (with chunkedLoading) so markers don't block the main thread.
    clusterGroup.addLayers(markers);
    const shouldFit = !initialBoundsDone && filtered.length && !getQuery() && !nearMe && !activeSpotId;
    if(shouldFit){
      let fitTargets = filtered;
      if(!countryFilter){
        const usa = filtered.filter(m => m.country === 'USA');
        if(usa.length) fitTargets = usa;
      }
      const bounds = L.latLngBounds(fitTargets.map(m=>[+m.latitude,+m.longitude]));
      if(bounds.isValid()){
        map.fitBounds(bounds.pad(0.12),{maxZoom:10,animate:false});
        if(map.getZoom() < MAP_MIN_ZOOM) map.setZoom(MAP_MIN_ZOOM);
        initialBoundsDone = true;
      }
    }
  }

  const REPORT_REASONS = [
    "This place doesn't have a bidet",
    'Permanently closed',
    'Wrong location / pin is off',
    'Wrong address or details',
    'Duplicate listing',
    'Other'
  ];

  function reportFormHtml(m){
    const options = REPORT_REASONS.map(r =>
      '<option value="'+escapeHtml(r)+'">'+escapeHtml(r)+'</option>').join('');
    return ''+
      '<details class="report-box">'+
        '<summary>Report incorrect pin</summary>'+
        '<form class="report-form form" novalidate>'+
          '<label for="reportReason">What\'s wrong?</label>'+
          '<select id="reportReason" name="reason">'+options+'</select>'+
          '<label for="reportNote">Details (optional)</label>'+
          '<textarea id="reportNote" name="note" placeholder="Anything that helps us fix it"></textarea>'+
          '<div class="dialog-actions">'+
            '<button type="submit" class="btn btn-primary js-report-submit">Send report</button>'+
          '</div>'+
          '<p class="report-status" role="status" aria-live="polite" hidden></p>'+
        '</form>'+
      '</details>';
  }

  async function submitReport(m, reason, note){
    if(!WEB3FORMS_ACCESS_KEY || WEB3FORMS_ACCESS_KEY === 'YOUR_WEB3FORMS_ACCESS_KEY'){
      throw new Error('Reporting is not set up yet.');
    }
    const res = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: WEB3FORMS_ACCESS_KEY,
        subject: 'BidetBud report: ' + m.name,
        from_name: 'BidetBud report',
        reason: reason,
        details: note || '(none)',
        spot_name: m.name,
        spot_id: m.id,
        address: m.address,
        city: m.city,
        country: m.country,
        maps_link: 'https://www.google.com/maps/search/?api=1&query=' + m.latitude + ',' + m.longitude,
        spot_link: spotShareUrl(m.id)
      })
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok || data.success === false){
      throw new Error(data.message || 'Could not send report. Try again in a moment.');
    }
    return true;
  }

  function wireReportForm(container, m){
    const form = container.querySelector('.report-form');
    if(!form) return;
    const status = form.querySelector('.report-status');
    const submitBtn = form.querySelector('.js-report-submit');
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const reason = form.querySelector('#reportReason').value;
      const note = form.querySelector('#reportNote').value.trim();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      status.hidden = true;
      status.classList.remove('is-error','is-ok');
      try {
        await submitReport(m, reason, note);
        status.textContent = 'Thanks — report sent. We\'ll take a look.';
        status.classList.add('is-ok');
        status.hidden = false;
        form.querySelector('#reportNote').value = '';
        submitBtn.textContent = 'Sent';
        if(typeof window.trackEvent === 'function') window.trackEvent('bidetbud_report', { id: m.id, reason });
      } catch(err){
        status.textContent = err.message || 'Could not send report.';
        status.classList.add('is-error');
        status.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send report';
      }
    });
  }

  function openDetail(id, fromUrl){
    const m=allLocations.find(x=>x.id===id);
    if(!m) return;
    activeSpotId = id;
    if(map) map.setView([+m.latitude,+m.longitude], Math.max(map.getZoom(),14));
    document.querySelectorAll('.card').forEach(c=>c.classList.remove('active'));
    const cardEl = document.querySelector('.card[data-id="'+id+'"]');
    if(cardEl){
      cardEl.classList.add('active');
      cardEl.scrollIntoView({block:'nearest',behavior:'smooth'});
    }
    const source = m.sourceUrl ? '<p class="sub" style="margin-top:12px"><a href="'+escapeHtml(m.sourceUrl)+'" target="_blank" rel="noopener">View web source ↗</a></p>' : '';
    const quote = m.sourceQuote ? '<blockquote class="source-quote"><strong>Review excerpt</strong>'+escapeHtml(m.sourceQuote)+'</blockquote>' : '';
    const verifiedNote = m.verifiedMethod ? '<p class="verified-note">Verified '+escapeHtml(m.verifiedMethod)+'</p>' : '';
    const shareLink = spotShareUrl(id);
    const appleMaps = 'https://maps.apple.com/?daddr='+encodeURIComponent(m.latitude+','+m.longitude);
    const googleMaps = 'https://www.google.com/maps/search/?api=1&query='+m.latitude+','+m.longitude;
    document.getElementById('detailContent').innerHTML =
      '<h2>'+escapeHtml(m.name)+'</h2>'+
      '<p class="sub">'+escapeHtml(typeLabel(m.type))+' · '+escapeHtml(m.city)+', '+escapeHtml(m.country)+'</p>'+
      (m.bidetStatus==='none' ? '<div class="access-warn access-warn--none"><strong>No bidet here</strong>We\u2019ve recorded this spot as not having a bidet or handheld sprayer. Bring your own if you need one.</div>' : '')+
      accessWarn(m)+
      '<p>'+escapeHtml(m.address)+'</p>'+
      '<div class="row">'+statusTag(m)+accessTag(m)+(formatBidetType(m.bidetType)?'<span class="tag tag-bidet">'+escapeHtml(formatBidetType(m.bidetType))+'</span>':'')+'</div>'+
      verifiedNote+quote+source+
      '<div class="dialog-actions detail-actions">'+
      '<a class="btn btn-primary" href="'+googleMaps+'" target="_blank" rel="noopener">Google Maps</a>'+
      (isIOS() ? '<a class="btn btn-primary" href="'+appleMaps+'" target="_blank" rel="noopener">Apple Maps</a>' : '')+
      '<button type="button" class="btn btn-ghost js-copy-spot-link">Share spot</button>'+
      '<button type="button" class="btn btn-ghost js-copy-address">Copy address</button>'+
      '<button type="button" class="btn btn-ghost js-open-add-form">Add another</button>'+
      '</div>'+
      reportFormHtml(m);
    document.getElementById('detailContent').querySelector('.js-copy-spot-link')?.addEventListener('click', ()=>{
      navigator.clipboard?.writeText(shareLink).then(()=> alert('Link copied!')).catch(()=> prompt('Copy link:', shareLink));
    });
    document.getElementById('detailContent').querySelector('.js-copy-address')?.addEventListener('click', ()=>{
      const txt = [m.name, m.address, m.city].filter(Boolean).join(', ');
      navigator.clipboard?.writeText(txt).then(()=> alert('Address copied!')).catch(()=>{});
    });
    wireReportForm(document.getElementById('detailContent'), m);
    setOverlayOpen('detailOverlay', true);
    syncUrlFromState();
    if(typeof window.trackEvent === 'function' && !fromUrl){
      window.trackEvent('bidetbud_spot_open', { id: id });
    }
  }

  function refresh(){
    lastFiltered = filterLocations();
    renderList(lastFiltered);
    renderMap(lastFiltered);
    updateFilterUi();
    syncUrlFromState();
    if(map) setTimeout(()=>map.invalidateSize(), 0);
  }

  function scheduleRefresh(){
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(()=>{ refreshTimer = null; refresh(); }, 220);
  }

  function scheduleMapRefresh(){
    clearTimeout(mapMoveTimer);
    mapMoveTimer = setTimeout(()=>{
      mapMoveTimer = null;
      if(clusterGroup && lastFiltered.length && !getQuery() && !nearMe && !activeSpotId) renderMap(lastFiltered);
    }, 180);
  }

  function resetAddForm(){
    ['addName','addAddress','addCity','addEmail','addBidetType','addNotes','addLat','addLng'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
    document.getElementById('addCountry').value='USA';
    document.getElementById('addType').value='mosque';
    document.getElementById('addStatus').value='verified';
    document.getElementById('coordHint').classList.remove('show');
    if(pickMarker && map){ map.removeLayer(pickMarker); pickMarker=null; }
    if(addPickMapMarker && addPickMap){ addPickMap.removeLayer(addPickMapMarker); addPickMapMarker=null; }
  }

  async function submitViaWeb3Forms(payload){
    if(!WEB3FORMS_ACCESS_KEY || WEB3FORMS_ACCESS_KEY === 'YOUR_WEB3FORMS_ACCESS_KEY'){
      throw new Error('Submissions are not set up yet.');
    }
    const body = {
      access_key: WEB3FORMS_ACCESS_KEY,
      subject: 'BidetBud: new verified spot',
      from_name: 'BidetBud',
      name: payload.name,
      email: payload.email || 'noreply@bidetbud.com',
      submitter_email: payload.email || '(not provided)',
      address: payload.address || '(not provided)',
      city: payload.city || '(not provided)',
      country: payload.country,
      type: payload.type,
      bidet_status: payload.bidetStatus,
      bidet_details: payload.bidetType,
      latitude: payload.latitude,
      longitude: payload.longitude,
      notes: payload.notes || '(none)',
      maps_link: 'https://www.google.com/maps/search/?api=1&query=' + payload.latitude + ',' + payload.longitude,
      botcheck: ''
    };
    if(payload.email) body.replyto = payload.email;
    const res = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok || data.success === false){
      throw new Error(data.message || 'Submission failed. Try again in a moment.');
    }
    return true;
  }

  function bidetCountryStyle(feature){
    if(!BIDET_FRIENDLY_GEO_NAMES.has(feature.properties.name)){
      return { fillOpacity: 0, opacity: 0, weight: 0, interactive: false };
    }
    return { fillColor: '#34d399', fillOpacity: 0.42, color: '#059669', weight: 1.25, opacity: 0.9 };
  }

  function onBidetCountryFeature(feature, layer){
    if(!BIDET_FRIENDLY_GEO_NAMES.has(feature.properties.name)) return;
    layer.bindTooltip(feature.properties.name + ' — bidet-friendly country', {
      sticky: true,
      direction: 'top',
      className: 'bidet-country-tip'
    });
    layer.on({
      mouseover(e){ e.target.setStyle({ fillOpacity: 0.58, weight: 2 }); },
      mouseout(e){ if(countriesLayer) countriesLayer.resetStyle(e.target); }
    });
  }

  function loadBidetFriendlyCountries(){
    fetch(BIDET_COUNTRY_GEOJSON_URL)
      .then(res => {
        if(!res.ok) throw new Error('Country boundaries unavailable');
        return res.json();
      })
      .then(geo => {
        if(!map) return;
        if(countriesLayer) map.removeLayer(countriesLayer);
        countriesLayer = L.geoJSON(geo, {
          style: bidetCountryStyle,
          onEachFeature: onBidetCountryFeature,
          pane: 'countriesPane'
        }).addTo(map);
      })
      .catch(err => console.warn('Bidet-friendly country layer:', err));
  }

  function showLoadToast(){
    const t = document.getElementById('loadToast');
    if(!t) return;
    t.textContent = allLocations.length + ' spots loaded';
    t.classList.add('show');
    setTimeout(()=> t.classList.remove('show'), 2800);
  }

  function hideSearchAc(){ document.getElementById('searchAc')?.setAttribute('hidden',''); }

  function renderSearchAc(){
    const q = getQuery();
    const box = document.getElementById('searchAc');
    if(!box || q.length < 2){ hideSearchAc(); return; }
    const nq = normalizeSearchText(q);
    const placeMatches = allLocations
      .filter(m => matchesSearch(m, q))
      .sort((a, b) => searchScore(b, q) - searchScore(a, q))
      .slice(0, 6);
    const cityMatches = [...new Set(
      allLocations
        .filter(m => normalizeSearchText(m.city).includes(nq))
        .map(m => m.city.split(',')[0].trim())
    )].slice(0, 3);
    const items = [];
    placeMatches.forEach(m => {
      const hint = m._search.acronym ? m._search.acronym.toUpperCase() : '';
      items.push({
        fill: m.name,
        label: m.name,
        hint: hint + (m.city ? ' · ' + m.city.split(',')[0].trim() : '')
      });
    });
    cityMatches.forEach(c => {
      if(!items.some(i => i.fill === c)) items.push({ fill: c, label: c, hint: 'City' });
    });
    if(!items.length){ hideSearchAc(); return; }
    box.innerHTML = items.slice(0, 8).map(it =>
      '<button type="button" class="search-ac-item" data-value="'+escapeHtml(it.fill)+'">'+
      '<span class="search-ac-label">'+highlight(it.label, q)+'</span>'+
      (it.hint ? '<span class="search-ac-hint">'+escapeHtml(it.hint)+'</span>' : '')+
      '</button>'
    ).join('');
    box.removeAttribute('hidden');
    box.querySelectorAll('.search-ac-item').forEach(btn=>btn.addEventListener('click', ()=>{
      document.getElementById('searchInput').value = btn.dataset.value;
      hideSearchAc();
      if(isMobile()) setMobileView('list');
      refresh();
      maybeShowPromo('search');
    }));
  }

  function initPullRefresh(){
    const el = document.getElementById('locationList');
    if(!el) return;
    let startY = 0, pulling = false;
    el.addEventListener('touchstart', e=>{ if(el.scrollTop <= 0) startY = e.touches[0].clientY; }, {passive:true});
    el.addEventListener('touchmove', e=>{
      if(el.scrollTop > 0) return;
      const dy = e.touches[0].clientY - startY;
      if(dy > 70) pulling = true;
    }, {passive:true});
    el.addEventListener('touchend', ()=>{
      if(pulling){ pulling = false; refresh(); }
    }, {passive:true});
  }

  function initMap(){
    map = L.map('map',{
      zoomControl:true,
      minZoom:MAP_MIN_ZOOM,
      worldCopyJump:true
    }).setView([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], DEFAULT_MAP_ZOOM);
    map.createPane('countriesPane');
    map.getPane('countriesPane').style.zIndex = 350;
    addCartoVoyagerTiles(map, true, true);
    // Defer the (network + parse + polygon render) country overlay so it never
    // competes with first paint, tiles, or marker rendering.
    const loadCountries = () => loadBidetFriendlyCountries();
    if('requestIdleCallback' in window) requestIdleCallback(loadCountries, { timeout: 3000 });
    else setTimeout(loadCountries, 1200);
    clusterGroup = L.markerClusterGroup({
      maxClusterRadius:40,
      chunkedLoading:true,
      chunkInterval:80,
      chunkDelay:8,
      removeOutsideVisibleBounds:true,
      iconCreateFunction:c=>L.divIcon({
        html:'<div style="background:#047857;color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.18)">'+c.getChildCount()+'</div>',
        className:'custom-marker', iconSize:[36,36]
      })
    });
    map.addLayer(clusterGroup);
    map.on('moveend', scheduleMapRefresh);
    map.on('zoomend', scheduleMapRefresh);
    map.zoomControl.setPosition(isMobile() ? 'topright' : 'bottomright');
    const mobileMq = window.matchMedia('(max-width:820px)');
    mobileMq.addEventListener('change', e=>{
      map.zoomControl.setPosition(e.matches ? 'topright' : 'bottomright');
      setTimeout(()=>map.invalidateSize(), 100);
    });
    setTimeout(()=>{ if(map) map.invalidateSize(); }, 150);
    if(window.visualViewport){
      window.visualViewport.addEventListener('resize',()=>{ if(map) map.invalidateSize(); });
    }
    window.addEventListener('resize',()=>{ if(map) map.invalidateSize(); });
    map.on('click', e=>{
      if(!document.getElementById('addOverlay').classList.contains('open')) return;
      setPickCoords(e.latlng.lat, e.latlng.lng, 'main');
      if(pickMarker) map.removeLayer(pickMarker);
      pickMarker = L.marker(e.latlng,{icon:createIcon('verified'), draggable:true}).addTo(map);
      pickMarker.on('dragend', ()=>{
        const ll = pickMarker.getLatLng();
        setPickCoords(ll.lat, ll.lng, 'main');
      });
    });
  }

  function initLegendHelp(){
    document.getElementById('legendHelpBtn')?.addEventListener('click', ()=> setOverlayOpen('legendOverlay', true));
    document.getElementById('legendClose')?.addEventListener('click', ()=> setOverlayOpen('legendOverlay', false));
    document.getElementById('legendOverlay')?.addEventListener('click', e=>{
      if(e.target.id === 'legendOverlay') setOverlayOpen('legendOverlay', false);
    });
  }

  function initMenu(){
    const btn = document.getElementById('menuBtn');
    const drop = document.getElementById('menuDrop');
    if(!btn || !drop) return;
    drop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      const open = drop.hidden;
      drop.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    drop.addEventListener('click', e=> e.stopPropagation());
    document.addEventListener('click', ()=>{
      drop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });
    document.getElementById('menuAbout')?.addEventListener('click', ()=>{ drop.hidden = true; btn.setAttribute('aria-expanded', 'false'); setOverlayOpen('aboutOverlay', true); });
    document.getElementById('menuLegend')?.addEventListener('click', ()=>{ drop.hidden = true; btn.setAttribute('aria-expanded', 'false'); setOverlayOpen('legendOverlay', true); });
  }

  function wire(){
    initSubmitPanel();
    initLegendHelp();
    initMenu();
    initPullRefresh();
    initPromoPopup();

    document.getElementById('addPinDetails')?.addEventListener('toggle', e=>{
      if(e.target.open) setTimeout(initAddPickMap, 80);
    });

    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', ()=>{
      renderSearchAc();
      if(isMobile() && searchInput.value.trim().length >= 2) setMobileView('list');
      scheduleRefresh();
    });
    searchInput.addEventListener('focus', renderSearchAc);
    searchInput.addEventListener('blur', ()=> setTimeout(hideSearchAc, 180));
    searchInput.addEventListener('keydown', e=>{
      if(e.key === 'Enter'){ hideSearchAc(); maybeShowPromo('search'); }
    });

    document.querySelectorAll('#placeFilter button').forEach(btn=>{
      btn.addEventListener('click',()=>{
        placeFilter = btn.dataset.type;
        updateFilterUi();
        refresh();
      });
    });
    document.getElementById('noBidetToggle')?.addEventListener('click',()=>{
      setNoBidetMode(!noBidetMode);
    });
    document.getElementById('limitedAccessToggle')?.addEventListener('click',()=>{
      setShowLimitedAccess(!showLimitedAccess);
    });
    document.querySelectorAll('#typeChips .chip').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const t = btn.dataset.type;
        if(COUNTRY_FILTERS.includes(t)){
          countryFilter = countryFilter === t ? null : t;
        } else if(extraFilter===t){
          extraFilter = null;
        } else {
          extraFilter = t;
          if(t === 'limited') showLimitedAccess = true;
          // Bidet-status chips are meaningless while viewing no-bidet spots.
          if(t==='verified' || t==='warmed' || t==='internet') noBidetMode = false;
        }
        updateFilterUi();
        refresh();
      });
    });
    document.querySelectorAll('#radiusRow button').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        radiusMi = parseInt(btn.dataset.radius, 10);
        updateFilterUi();
        refresh();
      });
    });

    document.getElementById('nearMeBtn').addEventListener('click',()=>{
      if(nearMe){
        nearMe = false;
        userLocation = null;
        updateNearMeUi();
        updateFilterUi();
        refresh();
        return;
      }
      if(!navigator.geolocation){ alert('Geolocation not supported.'); return; }
      navigator.geolocation.getCurrentPosition(pos=>{
        userLocation = {lat:pos.coords.latitude,lng:pos.coords.longitude};
        nearMe = true;
        updateNearMeUi();
        updateFilterUi();
        if(isMobile()) setMobileView('map');
        if(map) map.setView([userLocation.lat,userLocation.lng],10);
        refresh();
        maybeShowPromo('nearme');
      },()=>alert('Could not get your location.'));
    });

    document.querySelectorAll('.mobile-tab').forEach(tab=>{
      tab.addEventListener('click',()=> setMobileView(tab.dataset.view));
    });
    document.getElementById('aboutClose').addEventListener('click',()=> setOverlayOpen('aboutOverlay', false));
    document.getElementById('footerAbout')?.addEventListener('click', e=>{ e.preventDefault(); setOverlayOpen('aboutOverlay', true); });
    const footerYear = document.getElementById('footerYear');
    if(footerYear) footerYear.textContent = String(new Date().getFullYear());
    document.getElementById('addBtn').addEventListener('click',()=> openAddForm('header'));
    document.getElementById('detailContent').addEventListener('click', e=>{
      if(e.target.closest('.js-open-add-form')){
        setOverlayOpen('detailOverlay', false);
        openAddForm('detail');
      }
    });
    document.getElementById('addClose').addEventListener('click',()=>{ setOverlayOpen('addOverlay', false); resetAddForm(); });
    document.getElementById('detailClose').addEventListener('click',()=> setOverlayOpen('detailOverlay', false));
    document.getElementById('thankYouClose')?.addEventListener('click', ()=> setOverlayOpen('thankYouOverlay', false));
    ['detailOverlay','addOverlay','aboutOverlay','thankYouOverlay','legendOverlay'].forEach(id=>{
      const node = document.getElementById(id);
      if(node) node.addEventListener('click',e=>{ if(e.target.id===id) setOverlayOpen(id, false); });
    });
    document.addEventListener('keydown',e=>{
      if(e.key==='/' && !isTypingTarget(document.activeElement)){
        e.preventDefault();
        searchInput.focus();
        return;
      }
      if(e.key==='Escape'){
        hideSearchAc();
        document.getElementById('menuDrop').hidden = true;
        if(document.getElementById('promoOverlay')?.classList.contains('open')){
          dismissPromoPopup();
        } else {
          setOverlayOpen('detailOverlay', false);
          setOverlayOpen('addOverlay', false);
          setOverlayOpen('aboutOverlay', false);
          setOverlayOpen('thankYouOverlay', false);
          setOverlayOpen('legendOverlay', false);
          resetAddForm();
        }
      }
    });

    document.getElementById('submitAdd').addEventListener('click', async ()=>{
      const btn = document.getElementById('submitAdd');
      if(document.getElementById('addHoney').value) return;
      const name=document.getElementById('addName').value.trim();
      const lat=+document.getElementById('addLat').value, lng=+document.getElementById('addLng').value;
      const status=document.getElementById('addStatus').value;
      const bidetType=document.getElementById('addBidetType').value.trim();
      if(!name||isNaN(lat)||isNaN(lng)||!bidetType){
        alert('Name, bidet details, and a map pin are required.');
        return;
      }
      if(!HAS_BIDET(status)){ alert('Only verified or heated bidets can be submitted.'); return; }
      const payload={
        name,
        email: document.getElementById('addEmail').value.trim(),
        address: document.getElementById('addAddress').value.trim(),
        city: document.getElementById('addCity').value.trim(),
        country: document.getElementById('addCountry').value.trim()||'USA',
        type: document.getElementById('addType').value,
        bidetStatus: status,
        bidetType,
        latitude: String(lat),
        longitude: String(lng),
        notes: document.getElementById('addNotes').value.trim()
      };
      const prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        await submitViaWeb3Forms(payload);
        setOverlayOpen('addOverlay', false);
        resetAddForm();
        showThankYou();
        if(typeof window.trackEvent === 'function') window.trackEvent('bidetbud_add_submit', { type: payload.type });
      } catch (err) {
        alert(err.message || 'Could not send submission.');
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
  }

  const spotFromUrl = applyUrlState();
  wire();
  try{ if(typeof L!=='undefined') initMap(); }catch(e){ console.error(e); }

  function bootWithSeed(seed){
    window.BIDETBUD_SEED = seed || [];
    initData();
    refresh();
    showLoadToast();
    if(spotFromUrl) setTimeout(()=> openDetail(spotFromUrl, true), 400);
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('bidetbud_view', { spots: String(allLocations.length) });
    }
  }

  const seedPromise = window.__BIDET_SEED_P
    || fetch('bidet-seed.json', { credentials: 'same-origin' })
        .then(r => { if(!r.ok) throw new Error('Could not load map data'); return r.json(); });

  seedPromise.then(bootWithSeed).catch(err => {
    console.error(err);
    const el = document.getElementById('countLabel');
    if(el) el.textContent = 'Could not load spots — refresh to try again.';
    bootWithSeed([]);
  });
})();
