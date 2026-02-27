'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

module.exports = function (app) {
  const plugin = {};
  plugin.id = 'signalk-nmea0183-logger';
  plugin.name = 'NMEA0183 Sentence Logger';
  plugin.description = 'Logs NMEA0183 sentences with AIS throttling, GPS dedup, and file size limits.';

  let unsubscribe = null, currentLogDate = null, currentWriteStream = null;
  let logDir = null, config = {}, sentenceStats = {}, statusInterval = null;
  let publicServer = null;
  let currentFileSize = 0;
  let currentFilePart = 0;

  // Throttle state
  const aisLastSeen = {};   // { mmsi: timestamp } for VDM
  let vdoLastSeen = 0;      // timestamp for VDO heartbeat
  let hasRMC = false;        // true after first RMC received this session
  let throttledCount = 0;    // counter for status display
  let dedupCount = 0;

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

  // ── NMEA parsing (for stats) ────────────────────────────────────
  function parseLatLon(latS,latD,lonS,lonD) {
    if(!latS||!lonS||!latD||!lonD) return null;
    let lat=parseInt(latS.substring(0,2),10)+parseFloat(latS.substring(2))/60;
    if(latD==='S') lat=-lat;
    let lon=parseInt(lonS.substring(0,3),10)+parseFloat(lonS.substring(3))/60;
    if(lonD==='W') lon=-lon;
    if(isNaN(lat)||isNaN(lon)||(lat===0&&lon===0)||Math.abs(lat)>90||Math.abs(lon)>180) return null;
    return {lat,lon};
  }
  function parseDateTime(t,d) {
    if(!t||t.length<6) return null;
    if(d&&d.length>=6){
      let yy=parseInt(d.substring(4,6),10); yy=yy<80?2000+yy:1900+yy;
      return new Date(Date.UTC(yy,parseInt(d.substring(2,4),10)-1,parseInt(d.substring(0,2),10),
        parseInt(t.substring(0,2),10),parseInt(t.substring(2,4),10),parseInt(t.substring(4,6),10)));
    }
    return null;
  }
  function haversineNm(a,b,c,d) {
    const R=3440.065,dL=(c-a)*Math.PI/180,dO=(d-b)*Math.PI/180;
    const x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dO/2)**2;
    return 2*R*Math.asin(Math.sqrt(x));
  }
  function strip(f){if(!f)return'';const i=f.indexOf('*');return i>=0?f.substring(0,i):f;}

  function parseLogFile(filepath) {
    const content=fs.readFileSync(filepath,'utf8');
    const lines=content.split('\n').filter(l=>l.trim());
    const track=[],sogV=[],twsV=[],twaV=[],rpmE=[];
    let startTime=null,endTime=null,totalDist=0,prevPos=null;
    const intervalBuckets = {};

    for(const line of lines){
      let s=line.trim(),logTs=null;
      const tm=s.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)/);
      if(tm){logTs=new Date(tm[1]);s=tm[2];}
      if(s[0]!=='$'&&s[0]!=='!') continue;
      const f=s.split(',');if(f.length<2)continue;
      const st=f[0].length>=6?f[0].substring(3,6):f[0].substring(3);

      if(st==='RMC'&&f.length>=10){
        if(f[2]!=='A')continue;
        const pos=parseLatLon(f[3],f[4],f[5],f[6]);
        const sog=parseFloat(f[7]);
        const dt=parseDateTime(f[1],f[9]);
        const ts=dt||logTs;
        if(ts){if(!startTime||ts<startTime)startTime=ts;if(!endTime||ts>endTime)endTime=ts;}
        if(pos){
          track.push({lat:pos.lat,lon:pos.lon,time:ts?ts.toISOString():null,sog:isNaN(sog)?null:sog});
          if(prevPos){const d=haversineNm(prevPos.lat,prevPos.lon,pos.lat,pos.lon);if(d<10)totalDist+=d;}
          prevPos=pos;
          if(ts){
            const bucket=Math.floor(ts.getUTCHours()/2)*2;
            if(!intervalBuckets[bucket]) intervalBuckets[bucket]={latSum:0,lonSum:0,count:0};
            intervalBuckets[bucket].latSum+=pos.lat;intervalBuckets[bucket].lonSum+=pos.lon;intervalBuckets[bucket].count++;
          }
        }
        if(!isNaN(sog)&&sog>=0)sogV.push(sog);
      }
      if(st==='VTG'&&f.length>=6){const sog=parseFloat(f[5]);if(!isNaN(sog)&&sog>=0&&sog<100)sogV.push(sog);}
      if(st==='GGA'&&f.length>=10&&parseInt(f[6],10)>0){
        const pos=parseLatLon(f[2],f[3],f[4],f[5]);
        if(pos&&track.length===0) track.push({lat:pos.lat,lon:pos.lon,time:logTs?logTs.toISOString():null,sog:null});
      }
      if(st==='MWV'&&f.length>=5){
        const angle=parseFloat(f[1]),ref=f[2],speed=parseFloat(f[3]),unit=f[4],status=strip(f[5]||'');
        if(!isNaN(speed)&&(status==='A'||status==='')){
          let kn=speed;if(unit==='M')kn=speed*1.94384;else if(unit==='K')kn=speed*0.539957;
          if(ref==='T'){if(kn>=0&&kn<200)twsV.push(kn);if(!isNaN(angle))twaV.push(angle);}
        }
      }
      if(st==='MWD'&&f.length>=6){const kn=parseFloat(f[5]);if(!isNaN(kn)&&kn>=0&&kn<200)twsV.push(kn);}
      if(st==='RPM'&&f.length>=4){
        const rpm=parseFloat(f[3]),status=strip(f[5]||'');
        if(!isNaN(rpm)&&(status==='A'||status===''))rpmE.push({time:logTs,rpm:Math.abs(rpm)});
      }
    }

    let engineHours=0;
    for(let i=1;i<rpmE.length;i++){
      if(rpmE[i].time&&rpmE[i-1].time&&rpmE[i-1].rpm>100){
        const dt=(rpmE[i].time-rpmE[i-1].time)/3600000;
        if(dt>0&&dt<1)engineHours+=dt;
      }
    }
    let displayTrack=track;
    if(track.length>2000){const step=Math.ceil(track.length/2000);displayTrack=track.filter((_,i)=>i%step===0||i===track.length-1);}
    const sogAvg=sogV.length?sogV.reduce((a,b)=>a+b,0)/sogV.length:null;
    const sogMax=sogV.length?Math.max(...sogV):null;
    const twsMax=twsV.length?Math.max(...twsV):null;
    const twsAvg=twsV.length?twsV.reduce((a,b)=>a+b,0)/twsV.length:null;
    const twaAvg=twaV.length?twaV.reduce((a,b)=>a+b,0)/twaV.length:null;
    const twaMin=twaV.length?Math.min(...twaV):null;
    const twaMax=twaV.length?Math.max(...twaV):null;
    const weatherIntervals = Object.keys(intervalBuckets).sort((a,b)=>a-b).map(bucket => {
      const b = intervalBuckets[bucket];
      return { hour:parseInt(bucket,10), lat:Math.round((b.latSum/b.count)*10000)/10000, lon:Math.round((b.lonSum/b.count)*10000)/10000 };
    });

    return {
      track:displayTrack, totalDistanceNm:Math.round(totalDist*100)/100,
      startTime:startTime?startTime.toISOString():null, endTime:endTime?endTime.toISOString():null,
      durationHours:startTime&&endTime?Math.round((endTime-startTime)/3600000*100)/100:null,
      sogAvgKn:sogAvg!==null?Math.round(sogAvg*100)/100:null, sogMaxKn:sogMax!==null?Math.round(sogMax*100)/100:null,
      twsMaxKn:twsMax!==null?Math.round(twsMax*100)/100:null, twsAvgKn:twsAvg!==null?Math.round(twsAvg*100)/100:null,
      twaAvgDeg:twaAvg!==null?Math.round(twaAvg):null, twaMinDeg:twaMin!==null?Math.round(twaMin):null,
      twaMaxDeg:twaMax!==null?Math.round(twaMax):null, twaSamples:twaV.length,
      engineHours:Math.round(engineHours*100)/100, rpmSamples:rpmE.length,
      trackPoints:track.length, sogSamples:sogV.length, twsSamples:twsV.length, weatherIntervals
    };
  }

  // ── Core logging ────────────────────────────────────────────────
  function getDateString() { return new Date().toISOString().split('T')[0]; }
  function getTimestamp() { return new Date().toISOString(); }

  function exType(s) {
    if (!s || s.length < 6) return 'UNKNOWN';
    const m = s.trim().match(/^[!$]([A-Z]{2})([A-Z]{2,4})/);
    return m ? m[2] : 'UNKNOWN';
  }
  function exFull(s) {
    if (!s || s.length < 6) return 'UNKNOWN';
    const m = s.trim().match(/^[!$]([A-Z]{2,5})/);
    return m ? m[1] : 'UNKNOWN';
  }

  function shouldLog(sentenceType) {
    if (config.logAllSentences) return true;
    if (config[`log_${sentenceType}`] === true) return true;
    if (config.logUnknownSentences && !(sentenceType in SENTENCE_TYPES)) return true;
    return false;
  }

  /**
   * Extract MMSI from AIS VDM/VDO sentence payload.
   * Returns MMSI string or null.
   */
  function extractMMSI(sentence) {
    try {
      const fields = sentence.split(',');
      // VDM/VDO: !AIVDM,fragCount,fragNum,seqId,channel,payload,pad*checksum
      if (fields.length < 7) return null;
      // Only process single-fragment or first fragment
      const fragNum = parseInt(fields[2], 10);
      if (fragNum !== 1) return null;
      const payload = fields[5];
      if (!payload || payload.length < 7) return null;
      // Decode 6-bit ASCII armored payload to get MMSI (bits 8-37)
      const bits = [];
      for (let i = 0; i < Math.min(payload.length, 7); i++) {
        let c = payload.charCodeAt(i) - 48;
        if (c > 40) c -= 8;
        for (let b = 5; b >= 0; b--) bits.push((c >> b) & 1);
      }
      // MMSI is bits 8..37 (30 bits)
      if (bits.length < 38) return null;
      let mmsi = 0;
      for (let i = 8; i < 38; i++) mmsi = mmsi * 2 + bits[i];
      return mmsi > 0 ? String(mmsi) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Check if sentence should be throttled.
   * Returns true if sentence should be DROPPED.
   */
  function isThrottled(sentence, sentenceType) {
    const now = Date.now();

    // ── AIS VDM throttle ──
    if (sentenceType === 'VDM') {
      const interval = (config.aisThrottleSec || 0) * 1000;
      if (interval <= 0) return false; // throttle disabled
      const mmsi = extractMMSI(sentence);
      if (!mmsi) return false; // can't parse → let it through
      const last = aisLastSeen[mmsi] || 0;
      if (now - last < interval) {
        throttledCount++;
        return true;
      }
      aisLastSeen[mmsi] = now;
      return false;
    }

    // ── GPS dedup: RMC is king → skip GGA, GLL; throttle VDO ──
    if (config.gpsDedupRMC) {
      if (sentenceType === 'RMC') {
        hasRMC = true;
        return false;
      }
      if ((sentenceType === 'GGA' || sentenceType === 'GLL') && hasRMC) {
        dedupCount++;
        return true;
      }
      // VDO: keep 1 per interval as AIS heartbeat
      if (sentenceType === 'VDO' && hasRMC) {
        const sec = config.vdoHeartbeatSec !== undefined ? config.vdoHeartbeatSec : 180;
        if (sec <= 0) { dedupCount++; return true; } // 0 = skip all VDO
        const interval = sec * 1000;
        if (now - vdoLastSeen < interval) {
          dedupCount++;
          return true;
        }
        vdoLastSeen = now;
        return false;
      }
    }

    return false;
  }

  /**
   * Get or create write stream. Handles daily rotation AND max file size.
   */
  function getWriteStream() {
    const today = getDateString();
    const maxBytes = (config.maxFileSizeMB || 0) * 1024 * 1024;

    // Check if we need a new file: new day or size exceeded
    let needNew = false;
    if (currentLogDate !== today) {
      needNew = true;
      currentFilePart = 0;
    } else if (maxBytes > 0 && currentFileSize >= maxBytes) {
      needNew = true;
      currentFilePart++;
    }

    if (needNew || !currentWriteStream) {
      if (currentWriteStream) { currentWriteStream.end(); currentWriteStream = null; }
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

      currentLogDate = today;
      const suffix = currentFilePart > 0 ? `_part${currentFilePart}` : '';
      const fn = `nmea0183_${today}${suffix}.log`;
      const fp = path.join(logDir, fn);

      // Get existing file size if appending
      currentFileSize = fs.existsSync(fp) ? fs.statSync(fp).size : 0;

      currentWriteStream = fs.createWriteStream(fp, { flags: 'a' });
      currentWriteStream.on('error', e => { app.error(`Log error: ${e.message}`); currentWriteStream = null; });
    }

    return currentWriteStream;
  }

  function handleSentence(s) {
    if (!s || typeof s !== 'string') return;
    const sentenceType = exType(s);
    const fullId = exFull(s);
    sentenceStats[fullId] = (sentenceStats[fullId] || 0) + 1;

    if (!shouldLog(sentenceType)) return;
    if (isThrottled(s, sentenceType)) return;

    const stream = getWriteStream();
    if (!stream) return;

    const line = config.includeTimestamp ? `${getTimestamp()} ${s.trim()}\n` : `${s.trim()}\n`;
    stream.write(line);
    currentFileSize += Buffer.byteLength(line);
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

  function validFn(fn) {
    fn = path.basename(fn);
    return (fn.startsWith('nmea0183_') && fn.endsWith('.log')) ? fn : null;
  }

  // Clean up stale MMSI entries periodically (prevent memory leak on long runs)
  let cleanupInterval = null;
  function cleanupThrottleMap() {
    const now = Date.now();
    const maxAge = Math.max((config.aisThrottleSec || 30) * 1000 * 10, 300000); // 10x throttle or 5min
    for (const mmsi of Object.keys(aisLastSeen)) {
      if (now - aisLastSeen[mmsi] > maxAge) delete aisLastSeen[mmsi];
    }
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

      // Serve the webapp HTML
      if (p === '/' || p === '/index.html' || p === '/app.html') {
        const htmlFile = path.join(__dirname, 'public', 'app.html');
        if (fs.existsSync(htmlFile)) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.writeHead(200);
          fs.createReadStream(htmlFile).pipe(res);
        } else {
          res.writeHead(404); res.end('app.html not found');
        }
        return;
      }

      res.setHeader('Content-Type', 'application/json');

      try {
        if (p === '/api/logs') {
          if (!logDir || !fs.existsSync(logDir)) { res.end('[]'); return; }
          const files = fs.readdirSync(logDir)
            .filter(f => f.startsWith('nmea0183_') && f.endsWith('.log'))
            .sort().reverse()
            .map(f => { const s = fs.statSync(path.join(logDir, f));
              return { name:f, size:s.size, modified:s.mtime.toISOString(), date:f.replace('nmea0183_','').replace('.log','').replace(/_part\d+/,'') }; });
          res.end(JSON.stringify(files)); return;
        }

        if (p === '/api/stats') {
          res.end(JSON.stringify({
            logDirectory: logDir,
            currentLogFile: currentLogDate ? `nmea0183_${currentLogDate}${currentFilePart > 0 ? '_part' + currentFilePart : ''}.log` : null,
            currentFileSizeMB: Math.round(currentFileSize / 1048576 * 100) / 100,
            throttledSentences: throttledCount,
            dedupSentences: dedupCount,
            trackedMMSIs: Object.keys(aisLastSeen).length,
            sentenceStats
          })); return;
        }

        const m = p.match(/^\/api\/logs\/([^/]+?)(?:\/(stats|download))?$/);
        if (m) {
          const fn = validFn(m[1]);
          if (!fn) { res.writeHead(400); res.end(JSON.stringify({error:'Invalid'})); return; }
          const fp = path.join(logDir, fn);
          if (!fs.existsSync(fp)) { res.writeHead(404); res.end(JSON.stringify({error:'Not found'})); return; }
          const action = m[2];

          if (action === 'stats') {
            const st = parseLogFile(fp); st.filename = fn;
            res.end(JSON.stringify(st)); return;
          }
          if (action === 'download') {
            const stat = fs.statSync(fp);
            res.writeHead(200, {
              'Content-Type':'application/octet-stream',
              'Content-Disposition':`attachment; filename="${fn}"`,
              'Content-Length':stat.size
            });
            fs.createReadStream(fp).pipe(res); return;
          }

          const lines = parseInt(url.searchParams.get('lines')) || 0;
          const filter = url.searchParams.get('filter') || '';
          const c = fs.readFileSync(fp, 'utf8');
          let a = c.split('\n').filter(l => l.trim()); const tot = a.length;
          if (filter) { const fu = filter.toUpperCase(); a = a.filter(l => l.toUpperCase().includes(fu)); }
          if (lines > 0) a = a.slice(-lines);
          res.end(JSON.stringify({ filename:fn, totalLines:tot, returnedLines:a.length, filter:filter||null, lines:a }));
          return;
        }

        res.writeHead(404); res.end(JSON.stringify({error:'Not found'}));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({error:err.message}));
      }
    };

    publicServer = http.createServer(handler);
    publicServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        app.error(`NMEA logger: port ${port} busy, trying ${port+1}`);
        publicServer.listen(port + 1, '0.0.0.0');
      } else { app.error(`NMEA logger API error: ${err.message}`); }
    });
    publicServer.listen(port, '0.0.0.0', () => {
      const actualPort = publicServer.address().port;
      app.debug(`NMEA logger public API on port ${actualPort}`);
      app.setPluginStatus(`Started. Public API on port ${actualPort}`);
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────
  plugin.start = function (o) {
    config = o || {};
    sentenceStats = {};
    throttledCount = 0;
    dedupCount = 0;
    hasRMC = false;
    currentFilePart = 0;
    currentFileSize = 0;

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
    sentenceStats = {};
    Object.keys(aisLastSeen).forEach(k => delete aisLastSeen[k]);
  };

  // ── DELETE on authenticated SignalK router ──────────────────────
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
  plugin.schema = function () {
    const sp = {}, groups = {
      nav:['GGA','GLL','RMC','RMB','VTG','GSA','GSV','ZDA','GNS'],
      compass:['HDG','HDM','HDT'], wind:['MWV','MWD','VWR'],
      depth:['DBT','DBS','DBK','DPT'], speed:['VHW'],
      wpt:['APB','BOD','BWC','BWR','RTE','WPL','XTE','XDR'],
      ap:['RSA','RPM'], env:['MTW','MTA','MMB','MDA'],
      ais:['VDM','VDO'], misc:['TXT','TTM','TLL']
    };
    Object.values(groups).flat().forEach(t => {
      sp[`log_${t}`] = { type:'boolean', title:`${t} – ${SENTENCE_TYPES[t]}`, default:true };
    });
    const h = t => ({ type:'string', title:t, description:' ', default:' ' });
    const e = ts => Object.fromEntries(ts.map(t => [`log_${t}`, sp[`log_${t}`]]));

    return {
      type: 'object', title: 'NMEA0183 Logger',
      description: 'Public API on separate port (default 3033). Delete requires SignalK login.',
      properties: {
        logDirectory: { type:'string', title:'Log Directory', description:'Leave empty for default.', default:'' },
        apiPort: { type:'number', title:'Public API Port', description:'Default: 3033', default:3033 },
        includeTimestamp: { type:'boolean', title:'Include ISO Timestamp', default:true },

        _ht: h('── Throttle & Dedup ──────'),

        aisThrottleSec: {
          type:'number', title:'AIS Throttle (VDM)',
          description:'Max 1 message per MMSI per X seconds. 0 = disabled. Recommended: 30',
          default: 30
        },
        gpsDedupRMC: {
          type:'boolean', title:'GPS Dedup: skip GGA/GLL when RMC available',
          description:'RMC contains position + SOG + COG + time. GGA and GLL are redundant.',
          default: true
        },
        vdoHeartbeatSec: {
          type:'number', title:'VDO Heartbeat (sec)',
          description:'When GPS dedup is on: log 1 VDO per X sec as AIS transmit check. 0 = skip all VDO. Default: 180',
          default: 180
        },

        _hf: h('── File Management ───────'),

        maxFileSizeMB: {
          type:'number', title:'Max File Size (MB)',
          description:'Start a new part file when this size is reached. 0 = unlimited. Recommended: 50',
          default: 50
        },

        _hs: h('── Sentence Filter ───────'),

        logAllSentences: { type:'boolean', title:'Log ALL (override)', default:false },
        logUnknownSentences: { type:'boolean', title:'Log Unknown Types', default:true },
        _h1:h('── Navigation ──'), ...e(groups.nav),
        _h2:h('── Compass ──'), ...e(groups.compass),
        _h3:h('── Wind ──'), ...e(groups.wind),
        _h4:h('── Depth ──'), ...e(groups.depth),
        _h5:h('── Speed ──'), ...e(groups.speed),
        _h6:h('── WPT / Route / AP ──'), ...e([...groups.wpt, ...groups.ap]),
        _h7:h('── Environment ──'), ...e(groups.env),
        _h8:h('── AIS ──'), ...e(groups.ais),
        _h9:h('── Misc ──'), ...e(groups.misc)
      }
    };
  };

  return plugin;
};
