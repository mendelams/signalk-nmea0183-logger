'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

// ── Translations ────────────────────────────────────────────────
// Add new languages by adding a key here. Frontend translations
// are served via /api/lang/:code. Backend uses these for event strings.
const LANG = {
  en: {
    _name: 'English',
    // Backend: event detail strings ({0},{1},... are replaced)
    engineStarted: 'Engine started',
    engineStopped: 'Engine stopped',
    engineStoppedDur: 'Engine stopped ({0} min)',
    batteryLow: 'Battery low: {0}V (< {1}V)',
    batteryLowId: 'Battery low: {0}V (< {1}V) {2}',
    batteryRecover: 'Battery recovered: {0}V',
    batteryRecoverId: 'Battery recovered: {0}V {1}',
    // Frontend: UI
    title: 'NMEA0183 Logger',
    back: 'Back',
    view: 'View',
    delete: 'Delete',
    download: 'Download',
    loading: 'Loading…',
    analyzing: 'Analyzing…',
    fetchingWeather: 'Fetching weather & sea state…',
    noLogs: 'No log files yet.',
    noTrack: 'No GPS track (RMC sentences required)',
    noResults: 'No results.',
    noWeather: 'No weather data available',
    waitingData: 'Waiting for data…',
    errorLoading: 'Error loading.',
    confirmDelete: 'Delete {0}?',
    loginRequired: 'You must be logged in to SignalK to delete files.\n\nGo to the SignalK admin UI and log in first.',
    errorPrefix: 'Error',
    noJson: 'Not JSON',
    // File list
    date: 'Date',
    size: 'Size',
    // Stats sections
    navigation: 'Navigation',
    wind: 'Wind',
    engine: 'Engine',
    // Stats labels
    distance: 'Distance',
    duration: 'Duration',
    sogAvg: 'SOG avg',
    sogMax: 'SOG max',
    start: 'Start',
    end: 'End',
    twsAvg: 'TWS avg',
    twsMax: 'TWS max',
    twaAvg: 'TWA avg',
    twaMin: 'TWA min',
    twaMax: 'TWA max',
    hours: 'Hours',
    periods: 'Periods',
    rpmData: 'RPM data',
    // Events
    events: 'Events',
    // Weather
    weatherTitle: 'Weather & sea state per hour',
    wxHour: 'Hour',
    wxWeather: 'Weather',
    wxTemp: 'Temp',
    wxWind: 'Wind',
    wxGusts: 'Gusts',
    wxWave: 'Wave',
    wxMeasured: 'Measured',
    wxDelta: 'Δ',
    wxSource: 'Source: Open-Meteo.com — weather + marine API per hour at GPS position. Measured = NMEA sensors. Δ = measured − forecast.',
    // Log viewer
    filterPlaceholder: 'Filter (e.g. RMC, VDM)',
    linesOf: '{0} of {1} lines',
    linesOfFiltered: '{0} of {1} lines (filter: {2})',
    // Time formatting
    durH: 'h', durM: 'm',
    // WMO weather codes
    wmo0: 'Clear sky', wmo1: 'Mainly clear', wmo2: 'Partly cloudy', wmo3: 'Overcast',
    wmo45: 'Fog', wmo48: 'Rime fog',
    wmo51: 'Light drizzle', wmo53: 'Drizzle', wmo55: 'Heavy drizzle',
    wmo56: 'Freezing drizzle', wmo57: 'Heavy freezing drizzle',
    wmo61: 'Light rain', wmo63: 'Rain', wmo65: 'Heavy rain',
    wmo66: 'Freezing rain', wmo67: 'Heavy freezing rain',
    wmo71: 'Light snow', wmo73: 'Snow', wmo75: 'Heavy snow', wmo77: 'Snow grains',
    wmo80: 'Light showers', wmo81: 'Showers', wmo82: 'Heavy showers',
    wmo85: 'Snow showers', wmo86: 'Heavy snow showers',
    wmo95: 'Thunderstorm', wmo96: 'Thunderstorm+hail', wmo99: 'Severe thunderstorm',
  },
  nl: {
    _name: 'Nederlands',
    engineStarted: 'Motor gestart',
    engineStopped: 'Motor gestopt',
    engineStoppedDur: 'Motor gestopt ({0} min)',
    batteryLow: 'Accu laag: {0}V (< {1}V)',
    batteryLowId: 'Accu laag: {0}V (< {1}V) {2}',
    batteryRecover: 'Accu herstel: {0}V',
    batteryRecoverId: 'Accu herstel: {0}V {1}',
    title: 'NMEA0183 Logger',
    back: 'Terug',
    view: 'Bekijk',
    delete: 'Verwijder',
    download: 'Download',
    loading: 'Laden…',
    analyzing: 'Analyseren…',
    fetchingWeather: 'Weer en zeegang ophalen…',
    noLogs: 'Nog geen logbestanden.',
    noTrack: 'Geen GPS-track (RMC sentences nodig)',
    noResults: 'Geen resultaten.',
    noWeather: 'Geen weerdata beschikbaar',
    waitingData: 'Wacht op data…',
    errorLoading: 'Fout bij laden.',
    confirmDelete: 'Verwijder {0}?',
    loginRequired: 'Je moet ingelogd zijn in SignalK om bestanden te verwijderen.\n\nGa naar de SignalK admin UI en log eerst in.',
    errorPrefix: 'Fout',
    noJson: 'Geen JSON',
    date: 'Datum',
    size: 'Grootte',
    navigation: 'Navigatie',
    wind: 'Wind',
    engine: 'Motor',
    distance: 'Afstand',
    duration: 'Duur',
    sogAvg: 'SOG gem.',
    sogMax: 'SOG max',
    start: 'Begin',
    end: 'Einde',
    twsAvg: 'TWS gem.',
    twsMax: 'TWS max',
    twaAvg: 'TWA gem.',
    twaMin: 'TWA min',
    twaMax: 'TWA max',
    hours: 'Uren',
    periods: 'Periodes',
    rpmData: 'RPM data',
    events: 'Gebeurtenissen',
    weatherTitle: 'Weer & zeegang per uur',
    wxHour: 'Uur',
    wxWeather: 'Weer',
    wxTemp: 'Temp',
    wxWind: 'Wind',
    wxGusts: 'Vlagen',
    wxWave: 'Golf',
    wxMeasured: 'Gemeten',
    wxDelta: 'Δ',
    wxSource: 'Bron: Open-Meteo.com — weer + marine API per uur op GPS-positie. Gemeten = NMEA sensoren. Δ = gemeten − verwacht.',
    filterPlaceholder: 'Filter (bv. RMC, VDM)',
    linesOf: '{0} van {1} regels',
    linesOfFiltered: '{0} van {1} regels (filter: {2})',
    durH: 'u', durM: 'm',
    wmo0: 'Onbewolkt', wmo1: 'Licht bewolkt', wmo2: 'Half bewolkt', wmo3: 'Bewolkt',
    wmo45: 'Mist', wmo48: 'Rijpmist',
    wmo51: 'Lichte motregen', wmo53: 'Motregen', wmo55: 'Zware motregen',
    wmo56: 'Aanvr. motregen', wmo57: 'Zware aanvr. motregen',
    wmo61: 'Lichte regen', wmo63: 'Regen', wmo65: 'Zware regen',
    wmo66: 'Aanvr. regen', wmo67: 'Zware aanvr. regen',
    wmo71: 'Lichte sneeuw', wmo73: 'Sneeuw', wmo75: 'Zware sneeuw', wmo77: 'Sneeuwkorrels',
    wmo80: 'Lichte buien', wmo81: 'Buien', wmo82: 'Zware buien',
    wmo85: 'Sneeuwbuien', wmo86: 'Zware sneeuwbuien',
    wmo95: 'Onweer', wmo96: 'Onweer+hagel', wmo99: 'Zwaar onweer',
  }
};

function tr(lang, key, ...args) {
  const dict = LANG[lang] || LANG.en;
  let s = dict[key] || LANG.en[key] || key;
  args.forEach((a, i) => { s = s.replace(`{${i}}`, a); });
  return s;
}

module.exports = function (app) {
  const plugin = {};
  plugin.id = 'signalk-nmea0183-logger';
  plugin.name = 'NMEA0183 Sentence Logger';
  plugin.description = 'NMEA0183 logger with track, events, AIS throttle, weather + sea state.';

  let unsubscribe = null, currentLogDate = null, currentWriteStream = null;
  let logDir = null, config = {}, sentenceStats = {}, statusInterval = null;
  let publicServer = null;
  let currentFileSize = 0, currentFilePart = 0;

  const aisLastSeen = {};
  let vdoLastSeen = 0;
  let hasRMC = false;
  let throttledCount = 0, dedupCount = 0;

  function lang() { return config.language || 'en'; }
  function t(key, ...args) { return tr(lang(), key, ...args); }

  const { parseLogFile } = require('./lib/parser');
  const { fetchWeather } = require('./lib/weather');

  const SENTENCE_TYPES = {
    GGA:'GPS Fix',GLL:'Geo Position',RMC:'Rec Min Nav',RMB:'Rec Min Nav WPT',
    VTG:'Track/Speed',GSA:'GPS DOP',GSV:'Satellites',ZDA:'Time/Date',GNS:'GNSS Fix',
    HDG:'Heading Dev Var',HDM:'Heading Mag',HDT:'Heading True',
    MWV:'Wind Speed/Angle',MWD:'Wind Dir/Speed',VWR:'Relative Wind',
    DBT:'Depth Transducer',DBS:'Depth Surface',DBK:'Depth Keel',DPT:'Depth',
    VHW:'Water Speed',APB:'Autopilot B',BOD:'Bearing Orig-Dest',
    BWC:'Bearing Dist WPT',BWR:'Bearing Dist Rhumb',RTE:'Routes',WPL:'Waypoint',
    XTE:'Cross Track',XDR:'Transducer',RSA:'Rudder Angle',RPM:'Revolutions',
    MTW:'Water Temp',MTA:'Air Temp',MMB:'Barometer',MDA:'Meteo Composite',
    VDM:'AIS Message',VDO:'AIS Own-Vessel',TXT:'Text',TTM:'Tracked Target',TLL:'Target Lat/Lon'
  };

  // ── Core logging ────────────────────────────────────────────────
  function getDateString() { return new Date().toISOString().split('T')[0]; }
  function getTimestamp() { return new Date().toISOString(); }
  function exType(s) { if (!s || s.length < 6) return 'UNKNOWN'; const m = s.trim().match(/^[!$]([A-Z]{2})([A-Z]{2,4})/); return m ? m[2] : 'UNKNOWN'; }
  function exFull(s) { if (!s || s.length < 6) return 'UNKNOWN'; const m = s.trim().match(/^[!$]([A-Z]{2,5})/); return m ? m[1] : 'UNKNOWN'; }

  function shouldLog(sentenceType) {
    if (config.logAllSentences) return true;
    if (config[`log_${sentenceType}`] === true) return true;
    if (config.logUnknownSentences && !(sentenceType in SENTENCE_TYPES)) return true;
    return false;
  }

  function extractMMSI(sentence) {
    try {
      const fields = sentence.split(',');
      if (fields.length < 7) return null;
      const fragNum = parseInt(fields[2], 10); if (fragNum !== 1) return null;
      const payload = fields[5]; if (!payload || payload.length < 7) return null;
      const bits = [];
      for (let i = 0; i < Math.min(payload.length, 7); i++) {
        let c = payload.charCodeAt(i) - 48; if (c > 40) c -= 8;
        for (let b = 5; b >= 0; b--) bits.push((c >> b) & 1);
      }
      if (bits.length < 38) return null;
      let mmsi = 0; for (let i = 8; i < 38; i++) mmsi = mmsi * 2 + bits[i];
      return mmsi > 0 ? String(mmsi) : null;
    } catch (e) { return null; }
  }

  function isThrottled(sentence, sentenceType) {
    const now = Date.now();
    if (sentenceType === 'VDM') {
      const interval = (config.aisThrottleSec || 0) * 1000;
      if (interval <= 0) return false;
      const mmsi = extractMMSI(sentence); if (!mmsi) return false;
      const last = aisLastSeen[mmsi] || 0;
      if (now - last < interval) { throttledCount++; return true; }
      aisLastSeen[mmsi] = now; return false;
    }
    if (config.gpsDedupRMC) {
      if (sentenceType === 'RMC') { hasRMC = true; return false; }
      if ((sentenceType === 'GGA' || sentenceType === 'GLL') && hasRMC) { dedupCount++; return true; }
      if (sentenceType === 'VDO' && hasRMC) {
        const sec = config.vdoHeartbeatSec !== undefined ? config.vdoHeartbeatSec : 180;
        if (sec <= 0) { dedupCount++; return true; }
        if (now - vdoLastSeen < sec * 1000) { dedupCount++; return true; }
        vdoLastSeen = now; return false;
      }
    }
    return false;
  }

  function getWriteStream() {
    const today = getDateString(); const maxBytes = (config.maxFileSizeMB || 0) * 1024 * 1024;
    let needNew = false;
    if (currentLogDate !== today) { needNew = true; currentFilePart = 0; }
    else if (maxBytes > 0 && currentFileSize >= maxBytes) { needNew = true; currentFilePart++; }
    if (needNew || !currentWriteStream) {
      if (currentWriteStream) { currentWriteStream.end(); currentWriteStream = null; }
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      currentLogDate = today;
      const suffix = currentFilePart > 0 ? `_part${currentFilePart}` : '';
      const fn = `nmea0183_${today}${suffix}.log`;
      const fp = path.join(logDir, fn);
      currentFileSize = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
      currentWriteStream = fs.createWriteStream(fp, { flags: 'a' });
      currentWriteStream.on('error', e => { app.error(`Log error: ${e.message}`); currentWriteStream = null; });
    }
    return currentWriteStream;
  }

  function handleSentence(s) {
    if (!s || typeof s !== 'string') return;
    const sentenceType = exType(s); const fullId = exFull(s);
    sentenceStats[fullId] = (sentenceStats[fullId] || 0) + 1;
    if (!shouldLog(sentenceType)) return;
    if (isThrottled(s, sentenceType)) return;
    const stream = getWriteStream(); if (!stream) return;
    const line = config.includeTimestamp ? `${getTimestamp()} ${s.trim()}\n` : `${s.trim()}\n`;
    stream.write(line); currentFileSize += Buffer.byteLength(line);
  }

  function updateStatus() {
    const e = Object.entries(sentenceStats).sort((a, b) => b[1] - a[1]);
    if (!e.length) { app.setPluginStatus('Listening...'); return; }
    const port = publicServer && publicServer.address() ? publicServer.address().port : '?';
    const sizeMB = (currentFileSize / 1048576).toFixed(1);
    const thr = throttledCount > 0 ? ` | thr:${throttledCount}` : '';
    const dup = dedupCount > 0 ? ` | dup:${dedupCount}` : '';
    app.setPluginStatus(
      `API :${port} | ${currentLogDate}${currentFilePart > 0 ? ' p' + currentFilePart : ''} ${sizeMB}MB${thr}${dup} | ` +
      e.slice(0, 8).map(([t, c]) => `${t}:${c}`).join(' ')
    );
  }

  function validFn(fn) { fn = path.basename(fn); return (fn.startsWith('nmea0183_') && fn.endsWith('.log')) ? fn : null; }

  let cleanupInterval = null;
  function cleanupThrottleMap() {
    const now = Date.now();
    const maxAge = Math.max((config.aisThrottleSec || 30) * 1000 * 10, 300000);
    for (const mmsi of Object.keys(aisLastSeen)) { if (now - aisLastSeen[mmsi] > maxAge) delete aisLastSeen[mmsi]; }
  }

  // ── Public API server ───────────────────────────────────────────
  function startPublicServer(port) {
    const handler = (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
      if (req.method !== 'GET') { res.writeHead(405); res.end('Method not allowed'); return; }
      const url = new URL(req.url, `http://${req.headers.host}`);
      const p = url.pathname;

      if (p === '/' || p === '/index.html' || p === '/app.html') {
        const htmlFile = path.join(__dirname, 'public', 'app.html');
        if (fs.existsSync(htmlFile)) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.writeHead(200);
          fs.createReadStream(htmlFile).pipe(res);
        } else { res.writeHead(404); res.end('app.html not found'); }
        return;
      }

      // Static PWA files
      const staticFiles = {
        '/manifest.json': { type: 'application/manifest+json', cache: 'public, max-age=86400' },
        '/sw.js':         { type: 'application/javascript', cache: 'no-cache' },
        '/icon.svg':      { type: 'image/svg+xml', cache: 'public, max-age=604800' },
        '/icon-192.png':  { type: 'image/png', cache: 'public, max-age=604800' },
        '/icon-512.png':  { type: 'image/png', cache: 'public, max-age=604800' }
      };
      if (staticFiles[p]) {
        const sf = path.join(__dirname, 'public', p.substring(1));
        if (fs.existsSync(sf)) {
          res.setHeader('Content-Type', staticFiles[p].type);
          res.setHeader('Cache-Control', staticFiles[p].cache);
          res.writeHead(200);
          fs.createReadStream(sf).pipe(res);
        } else { res.writeHead(404); res.end('Not found'); }
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      try {
        // Language endpoints
        if (p === '/api/lang') {
          const available = Object.entries(LANG).map(([code, l]) => ({ code, name: l._name }));
          res.end(JSON.stringify({ current: lang(), available })); return;
        }
        const langMatch = p.match(/^\/api\/lang\/([a-z]{2})$/);
        if (langMatch) {
          const code = langMatch[1];
          const dict = LANG[code];
          if (!dict) { res.writeHead(404); res.end(JSON.stringify({ error: 'Language not found' })); return; }
          res.end(JSON.stringify(dict)); return;
        }

        if (p === '/api/logs') {
          if (!logDir || !fs.existsSync(logDir)) { res.end('[]'); return; }
          const files = fs.readdirSync(logDir).filter(f => f.startsWith('nmea0183_') && f.endsWith('.log'))
            .sort().reverse().map(f => { const s = fs.statSync(path.join(logDir, f));
              return { name:f, size:s.size, modified:s.mtime.toISOString(), date:f.replace('nmea0183_','').replace('.log','').replace(/_part\d+/,'') }; });
          res.end(JSON.stringify(files)); return;
        }
        if (p === '/api/stats') {
          res.end(JSON.stringify({ logDirectory:logDir, language: lang(),
            currentLogFile:currentLogDate?`nmea0183_${currentLogDate}${currentFilePart>0?'_part'+currentFilePart:''}.log`:null,
            currentFileSizeMB:Math.round(currentFileSize/1048576*100)/100,
            throttledSentences:throttledCount, dedupSentences:dedupCount,
            trackedMMSIs:Object.keys(aisLastSeen).length, sentenceStats })); return;
        }
        const m = p.match(/^\/api\/logs\/([^/]+?)(?:\/(stats|download|weather))?$/);
        if (m) {
          const fn = validFn(m[1]);
          if (!fn) { res.writeHead(400); res.end(JSON.stringify({error:'Invalid'})); return; }
          const fp = path.join(logDir, fn);
          if (!fs.existsSync(fp)) { res.writeHead(404); res.end(JSON.stringify({error:'Not found'})); return; }
          const action = m[2];
          if (action === 'stats') { const st = parseLogFile(fp, config, t); st.filename = fn; res.end(JSON.stringify(st)); return; }
          if (action === 'weather') {
            // Parse log for intervals, fetch weather server-side
            const st = parseLogFile(fp, config, t);
            if (!st.weatherIntervals || !st.weatherIntervals.length || !st.startTime) {
              res.end(JSON.stringify([])); return;
            }
            const dateStr = st.startTime.split('T')[0];
            fetchWeather(st.weatherIntervals, dateStr)
              .then(data => { res.end(JSON.stringify(data)); })
              .catch(err => { res.writeHead(500); res.end(JSON.stringify({error: err.message})); });
            return;
          }
          if (action === 'download') {
            const stat = fs.statSync(fp);
            res.writeHead(200, { 'Content-Type':'application/octet-stream', 'Content-Disposition':`attachment; filename="${fn}"`, 'Content-Length':stat.size });
            fs.createReadStream(fp).pipe(res); return;
          }
          const lines = parseInt(url.searchParams.get('lines')) || 0;
          const filter = url.searchParams.get('filter') || '';
          const c = fs.readFileSync(fp, 'utf8');
          let a = c.split('\n').filter(l => l.trim()); const tot = a.length;
          if (filter) { const fu = filter.toUpperCase(); a = a.filter(l => l.toUpperCase().includes(fu)); }
          if (lines > 0) a = a.slice(-lines);
          res.end(JSON.stringify({ filename:fn, totalLines:tot, returnedLines:a.length, filter:filter||null, lines:a })); return;
        }
        res.writeHead(404); res.end(JSON.stringify({error:'Not found'}));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({error:err.message})); }
    };

    publicServer = http.createServer(handler);
    publicServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') { app.error(`NMEA logger: port ${port} busy, trying ${port+1}`); publicServer.listen(port+1, '0.0.0.0'); }
      else { app.error(`NMEA logger API error: ${err.message}`); }
    });
    publicServer.listen(port, '0.0.0.0', () => {
      const actualPort = publicServer.address().port;
      app.debug(`NMEA logger public API on port ${actualPort}`);
      app.setPluginStatus(`Started. Public API on port ${actualPort}`);
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────
  plugin.start = function (o) {
    config = flattenConfig(o || {}); sentenceStats = {}; throttledCount = 0; dedupCount = 0;
    hasRMC = false; currentFilePart = 0; currentFileSize = 0;
    logDir = config.logDirectory || path.join(app.getDataDirPath(), 'nmea0183-logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    app.on('nmea0183', handleSentence);
    unsubscribe = () => app.removeListener('nmea0183', handleSentence);
    statusInterval = setInterval(updateStatus, 10000);
    cleanupInterval = setInterval(cleanupThrottleMap, 60000);
    startPublicServer(config.apiPort || 3033);
  };
  plugin.stop = function () {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
    if (cleanupInterval) { clearInterval(cleanupInterval); cleanupInterval = null; }
    if (currentWriteStream) { currentWriteStream.end(); currentWriteStream = null; currentLogDate = null; }
    if (publicServer) { publicServer.close(); publicServer = null; }
    sentenceStats = {}; Object.keys(aisLastSeen).forEach(k => delete aisLastSeen[k]);
  };

  plugin.registerWithRouter = function (router) {
    router.delete('/api/logs/:fn', (req, res) => {
      const fn = validFn(req.params.fn);
      if (!fn) return res.status(400).json({ error: 'Invalid' });
      const fp = path.join(logDir, fn);
      if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
      try { fs.unlinkSync(fp); res.json({ deleted: fn }); }
      catch (e) { res.status(500).json({ error: e.message }); }
    });
  };
  plugin.getOpenApi = () => ({});

  // ── Schema ──────────────────────────────────────────────────────

  /** Flatten nested config objects to flat keys for backward compat. */
  function flattenConfig(obj) {
    const flat = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        Object.assign(flat, flattenConfig(v));
      } else {
        flat[k] = v;
      }
    }
    return flat;
  }

  plugin.schema = function () {
    const sentenceGroups = {
      nav:['GGA','GLL','RMC','RMB','VTG','GSA','GSV','ZDA','GNS'],
      compass:['HDG','HDM','HDT'], wind:['MWV','MWD','VWR'],
      depth:['DBT','DBS','DBK','DPT'], speed:['VHW'],
      wpt:['APB','BOD','BWC','BWR','RTE','WPL','XTE','XDR'],
      ap:['RSA','RPM'], env:['MTW','MTA','MMB','MDA'],
      ais:['VDM','VDO'], misc:['TXT','TTM','TLL']
    };

    // Build sentence toggle properties per group
    function sentenceProps(types) {
      const props = {};
      for (const st of types) {
        props[`log_${st}`] = { type:'boolean', title:`${st} – ${SENTENCE_TYPES[st]}`, default:true };
      }
      return { type:'object', properties: props };
    }

    const langCodes = Object.keys(LANG);
    const langNames = langCodes.map(c => LANG[c]._name);

    return {
      type:'object', title:'NMEA0183 Logger',
      description:'Public API on separate port (default 3033). Delete requires SignalK login.',
      properties: {
        language: { type:'string', title:'Language', description:'UI and event language', default:'en', enum: langCodes, enumNames: langNames },
        logDirectory: { type:'string', title:'Log Directory', description:'Leave empty for default.', default:'' },
        apiPort: { type:'number', title:'Public API Port', description:'Default: 3033', default:3033 },
        includeTimestamp: { type:'boolean', title:'Include ISO Timestamp', default:true },

        throttle: { type:'object', title:'Throttle & Dedup', properties: {
          aisThrottleSec: { type:'number', title:'AIS Throttle (VDM)', description:'Max 1 msg per MMSI per X sec. 0 = off. Default: 30', default:30 },
          gpsDedupRMC: { type:'boolean', title:'GPS Dedup: skip GGA/GLL when RMC available', description:'Also throttles VDO to heartbeat interval.', default:true },
          vdoHeartbeatSec: { type:'number', title:'VDO Heartbeat (sec)', description:'When dedup on: 1 VDO per X sec. 0 = skip all. Default: 180', default:180 }
        }},

        fileManagement: { type:'object', title:'File Management', properties: {
          maxFileSizeMB: { type:'number', title:'Max File Size (MB)', description:'New part file when exceeded. 0 = unlimited. Default: 50', default:50 }
        }},

        events: { type:'object', title:'Events', properties: {
          evCourseEnabled: { type:'boolean', title:'Detect course changes', default:true },
          evCourseDeg: { type:'number', title:'Course change threshold (°)', description:'Default: 30', default:30 },
          evWindEnabled: { type:'boolean', title:'Detect wind speed changes', default:true },
          evWindKn: { type:'number', title:'Wind change threshold (kn)', description:'Default: 5', default:5 },
          evEngineEnabled: { type:'boolean', title:'Detect engine start/stop', default:true },
          evEngineRpmThreshold: { type:'number', title:'Engine RPM threshold', description:'RPM below this = engine off. Default: 100', default:100 },
          evBatteryEnabled: { type:'boolean', title:'Detect low battery voltage', default:true },
          evBatteryLowV: { type:'number', title:'Battery low voltage (V)', description:'Event when voltage drops below. Default: 12.0', default:12.0 }
        }},

        sentenceFilter: { type:'object', title:'Sentence Filter', properties: {
          logAllSentences: { type:'boolean', title:'Log ALL (override)', default:false },
          logUnknownSentences: { type:'boolean', title:'Log Unknown Types', default:true }
        }},

        sentencesNav:      Object.assign(sentenceProps(sentenceGroups.nav), { title:'Navigation' }),
        sentencesCompass:   Object.assign(sentenceProps(sentenceGroups.compass), { title:'Compass' }),
        sentencesWind:      Object.assign(sentenceProps(sentenceGroups.wind), { title:'Wind' }),
        sentencesDepth:     Object.assign(sentenceProps(sentenceGroups.depth), { title:'Depth' }),
        sentencesSpeed:     Object.assign(sentenceProps(sentenceGroups.speed), { title:'Speed' }),
        sentencesWptRoute:  Object.assign(sentenceProps([...sentenceGroups.wpt, ...sentenceGroups.ap]), { title:'WPT / Route / AP' }),
        sentencesEnv:       Object.assign(sentenceProps(sentenceGroups.env), { title:'Environment' }),
        sentencesAIS:       Object.assign(sentenceProps(sentenceGroups.ais), { title:'AIS' }),
        sentencesMisc:      Object.assign(sentenceProps(sentenceGroups.misc), { title:'Misc' })
      }
    };
  };

  return plugin;
};
