'use strict';
const fs = require('fs');
const zlib = require('zlib');
const { SmoothedChangeDetector, StateToggleDetector, LevelCrossingDetector } = require('./events');
const { validateChecksum } = require('./checksum');
const { TRACK_MAX_POINTS } = require('./constants');

// ── Parsing helpers ──────────────────────────────────────────────

/** Safe array max — avoids stack overflow on large arrays (>10k elements). */
function arrMax(a) { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
/** Safe array min — avoids stack overflow on large arrays (>10k elements). */
function arrMin(a) { let m = Infinity;  for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return m; }

/**
 * Parse NMEA lat/lon fields to decimal degrees.
 * @param {string} latS - Latitude string (DDMM.MMMM)
 * @param {string} latD - N or S
 * @param {string} lonS - Longitude string (DDDMM.MMMM)
 * @param {string} lonD - E or W
 * @returns {{lat:number, lon:number}|null}
 */
function parseLatLon(latS, latD, lonS, lonD) {
  if (!latS || !lonS || !latD || !lonD) return null;
  let lat = parseInt(latS.substring(0, 2), 10) + parseFloat(latS.substring(2)) / 60;
  if (latD === 'S') lat = -lat;
  let lon = parseInt(lonS.substring(0, 3), 10) + parseFloat(lonS.substring(3)) / 60;
  if (lonD === 'W') lon = -lon;
  if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Parse NMEA time (HHMMSS) and date (DDMMYY) to Date object.
 * @param {string} tm - Time string (HHMMSS or HHMMSS.SS)
 * @param {string} d - Date string (DDMMYY)
 * @returns {Date|null}
 */
function parseDateTime(tm, d) {
  if (!tm || tm.length < 6) return null;
  if (d && d.length >= 6) {
    let yy = parseInt(d.substring(4, 6), 10);
    yy = yy < 80 ? 2000 + yy : 1900 + yy;
    return new Date(Date.UTC(yy, parseInt(d.substring(2, 4), 10) - 1, parseInt(d.substring(0, 2), 10),
      parseInt(tm.substring(0, 2), 10), parseInt(tm.substring(2, 4), 10), parseInt(tm.substring(4, 6), 10)));
  }
  return null;
}

/** Haversine distance in nautical miles between two lat/lon points. */
function haversineNm(a, b, c, d) {
  const R = 3440.065, dL = (c - a) * Math.PI / 180, dO = (d - b) * Math.PI / 180;
  const x = Math.sin(dL / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function strip(f) {
  if (!f) return '';
  const i = f.indexOf('*');
  return i >= 0 ? f.substring(0, i) : f;
}

function r2(v) { return v !== null && v !== undefined ? Math.round(v * 100) / 100 : null; }
function r1(v) { return v !== null && v !== undefined ? Math.round(v * 10) / 10 : null; }
function r0(v) { return v !== null && v !== undefined ? Math.round(v) : null; }

// ── AIS 6-bit decoder ────────────────────────────────────────────

/**
 * Decode AIS 6-bit armored payload to position data.
 * Supports message types 1, 2, 3 (Class A) and 18 (Class B).
 * @param {string} payload - AIS 6-bit encoded payload
 * @returns {{mmsi:string, lat:number, lon:number, sog:number|null, cog:number|null}|null}
 */
function parseAISPosition(payload) {
  if (!payload || payload.length < 20) return null;
  const bits = [];
  for (let i = 0; i < payload.length; i++) {
    let c = payload.charCodeAt(i) - 48;
    if (c > 40) c -= 8;
    for (let b = 5; b >= 0; b--) bits.push((c >> b) & 1);
  }
  function bitsToUint(arr, start, len) {
    let v = 0; for (let i = start; i < start + len; i++) v = v * 2 + (arr[i] || 0); return v;
  }
  function bitsToInt(arr, start, len) {
    let v = bitsToUint(arr, start, len);
    if (v >= (1 << (len - 1))) v -= (1 << len);
    return v;
  }
  const msgType = bitsToUint(bits, 0, 6);
  if ((msgType === 1 || msgType === 2 || msgType === 3) && bits.length >= 168) {
    const mmsi = bitsToUint(bits, 8, 30);
    const sog = bitsToUint(bits, 50, 10) / 10;
    const lon = bitsToInt(bits, 61, 28) / 600000;
    const lat = bitsToInt(bits, 89, 27) / 600000;
    const cog = bitsToUint(bits, 116, 12) / 10;
    if (mmsi === 0 || Math.abs(lat) > 90 || Math.abs(lon) > 180 || lat === 91 || lon === 181) return null;
    return { mmsi: String(mmsi), lat, lon, sog: sog < 102.3 ? sog : null, cog: cog < 360 ? cog : null };
  }
  if (msgType === 18 && bits.length >= 168) {
    const mmsi = bitsToUint(bits, 8, 30);
    const sog = bitsToUint(bits, 46, 10) / 10;
    const lon = bitsToInt(bits, 57, 28) / 600000;
    const lat = bitsToInt(bits, 85, 27) / 600000;
    const cog = bitsToUint(bits, 112, 12) / 10;
    if (mmsi === 0 || Math.abs(lat) > 90 || Math.abs(lon) > 180 || lat === 91 || lon === 181) return null;
    return { mmsi: String(mmsi), lat, lon, sog: sog < 102.3 ? sog : null, cog: cog < 360 ? cog : null };
  }
  return null;
}

// ── Event detectors ──────────────────────────────────────────────

function createDetectors(config, t) {
  const det = {};

  if (config.evCourseEnabled !== false) {
    det.course = new SmoothedChangeDetector({
      type: 'course', threshold: config.evCourseDeg || 30,
      bufferSize: 5, minElapsed: 10, circular: true, drift: 0.05,
      format: (prev, curr, diff) =>
        `${Math.round(prev)}° → ${Math.round(curr)}° (${diff > 0 ? '+' : ''}${Math.round(diff)}°)`
    });
  }

  if (config.evWindEnabled !== false) {
    det.wind = new SmoothedChangeDetector({
      type: 'wind', threshold: config.evWindKn || 5,
      bufferSize: 10, minElapsed: 10, circular: false, drift: 0.05,
      format: (prev, curr, diff) =>
        `TWS ${prev.toFixed(1)} → ${curr.toFixed(1)} kn (${diff > 0 ? '+' : ''}${diff.toFixed(1)})`
    });
  }

  if (config.evEngineEnabled !== false) {
    det.engine = new StateToggleDetector({
      type: 'engine', threshold: config.evEngineRpmThreshold || 100,
      debounceMs: 30000, trackDuration: true,
      formatOn: () => t('engineStarted'),
      formatOff: (_ts, dur) => t('engineStoppedDur', dur),
      formatOffNoDur: () => t('engineStopped')
    });
  }

  if (config.evBatteryEnabled !== false) {
    det.battery = new LevelCrossingDetector({
      type: 'battery', threshold: config.evBatteryLowV || 12.0, direction: 'below',
      formatCross: (val, thr, id) =>
        id ? t('batteryLowId', val.toFixed(1), thr, id) : t('batteryLow', val.toFixed(1), thr),
      formatRecover: (val, id) =>
        id ? t('batteryRecoverId', val.toFixed(1), id) : t('batteryRecover', val.toFixed(1))
    });
  }

  return det;
}

// ── DSC lookup tables ────────────────────────────────────────────

const DSC_CAT = { '00':'routine', '08':'safety', '10':'urgency', '12':'distress' };
const DSC_NATURE = {
  '00':'undesignated', '01':'fire', '02':'flooding', '03':'collision', '04':'grounding',
  '05':'capsizing', '06':'sinking', '07':'disabled', '08':'undesignated', '09':'abandoning',
  '10':'EPIRB', '11':'MOB', '12':'piracy'
};

// ── Main parser ──────────────────────────────────────────────────

/**
 * Parse an NMEA0183 log file into structured statistics.
 * Handles both plain .log and .log.gz files. Validates checksums on all $ sentences.
 * 
 * @param {string} filepath - Path to log file (.log or .log.gz)
 * @param {object} config - Plugin config (event thresholds, filters)
 * @param {function} t - Translation function t(key, ...args)
 * @param {object} [opts] - Options: {fullTrack: bool, includeAIS: bool}
 * @returns {object} Stats object with track, events, wind, depth, engine, AIS, DSC, etc.
 */
function parseLogFile(filepath, config, t, opts) {
  opts = opts || {};
  const content = filepath.endsWith('.gz')
    ? zlib.gunzipSync(fs.readFileSync(filepath)).toString('utf8')
    : fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());

  // Tracking arrays and state
  const track = [], sogV = [], twsV = [], twaV = [], rpmE = [];
  const events = [];
  let startTime = null, endTime = null, totalDist = 0, prevPos = null;
  const intervalBuckets = {};

  const det = createDetectors(config, t);
  function emit(ev) { if (ev) events.push(ev); }

  let gpsTotal = 0, gpsInvalid = 0;
  let checksumFails = 0;
  const sentenceTypeCounts = {};
  const totalLines = lines.length;

  const aisVessels = {};
  const collectAIS = !!opts.includeAIS;

  const depthV = [];
  let shallowest = null, lastPos = null;

  const hdgV = [], rsaV = [], xteV = [];
  let apActive = false, apSegments = [];
  let apCurrentStart = null, apCurrentMode = null;

  const dscCalls = [];

  const currentV = [];
  let lastCurrentTime = null, ahConsumed = 0;
  const socV = [];

  for (const line of lines) {
    let s = line.trim(), logTs = null;
    const tm = s.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)/);
    if (tm) { logTs = new Date(tm[1]); s = tm[2]; }
    if (s[0] !== '$' && s[0] !== '!') continue;

    // Checksum validation (skip AIS — they have their own CRC)
    if (s[0] === '$' && s.indexOf('*') > 0) {
      if (!validateChecksum(s)) { checksumFails++; continue; }
    }

    const f = s.split(',');
    if (f.length < 2) continue;
    const st = f[0].length >= 6 ? f[0].substring(3, 6) : f[0].substring(3);
    const stKey = f[0] === '$SKAIS' ? 'SKAIS' : st;
    sentenceTypeCounts[stKey] = (sentenceTypeCounts[stKey] || 0) + 1;

    // ── RMC ──
    if (st === 'RMC' && f.length >= 10) {
      gpsTotal++;
      if (f[2] !== 'A') { gpsInvalid++; continue; }
      const pos = parseLatLon(f[3], f[4], f[5], f[6]);
      const sog = parseFloat(f[7]);
      const cog = parseFloat(f[8]);
      const dt = parseDateTime(f[1], f[9]);
      const ts = dt || logTs;
      if (ts) {
        if (!startTime || ts < startTime) startTime = ts;
        if (!endTime || ts > endTime) endTime = ts;
      }
      if (pos) {
        const pt = { lat: pos.lat, lon: pos.lon, sog: isNaN(sog) ? null : sog, time: ts ? ts.toISOString() : null };
        track.push(pt);
        lastPos = pt;
        if (!isNaN(sog)) sogV.push(sog);
        if (prevPos) {
          const d = haversineNm(prevPos.lat, prevPos.lon, pos.lat, pos.lon);
          if (d < 10) totalDist += d;
        }
        prevPos = pos;
        if (ts) {
          const bucket = ts.getUTCHours();
          if (!intervalBuckets[bucket]) intervalBuckets[bucket] = { latSum: 0, lonSum: 0, count: 0, twsValues: [], tempValues: [] };
          intervalBuckets[bucket].latSum += pos.lat;
          intervalBuckets[bucket].lonSum += pos.lon;
          intervalBuckets[bucket].count++;
        }
        if (det.course && !isNaN(cog) && ts) emit(det.course.feed(cog, ts));
      }
    }

    // ── GGA ──
    if (st === 'GGA' && f.length >= 10) {
      const fix = parseInt(f[6], 10);
      if (fix > 0) {
        gpsTotal++;
        const pos = parseLatLon(f[2], f[3], f[4], f[5]);
        if (pos) lastPos = { lat: pos.lat, lon: pos.lon, time: logTs ? logTs.toISOString() : null };
      } else { gpsTotal++; gpsInvalid++; }
    }

    // ── MWV ──
    if (st === 'MWV' && f.length >= 6) {
      const angle = parseFloat(f[1]);
      const ref = f[2];
      const speed = parseFloat(f[3]);
      const unit = f[4];
      const status = strip(f[5] || '');
      if (!isNaN(speed) && (status === 'A' || status === '')) {
        let kn = speed;
        if (unit === 'M') kn = speed * 1.94384;
        else if (unit === 'K') kn = speed * 0.539957;
        if (ref === 'T') {
          if (kn >= 0 && kn < 200) {
            twsV.push(kn);
            if (logTs) {
              const bucket = logTs.getUTCHours();
              if (intervalBuckets[bucket]) intervalBuckets[bucket].twsValues.push(kn);
            }
            if (det.wind && logTs) emit(det.wind.feed(kn, logTs));
          }
          if (!isNaN(angle)) twaV.push(angle);
        }
      }
    }

    // ── MWD ──
    if (st === 'MWD' && f.length >= 6) {
      const kn = parseFloat(f[5]);
      if (!isNaN(kn) && kn >= 0 && kn < 200) twsV.push(kn);
    }

    // ── MTA ──
    if (st === 'MTA' && f.length >= 3) {
      const temp = parseFloat(f[1]);
      const u = strip(f[2] || '');
      if (!isNaN(temp) && logTs) {
        const tempC = (u === 'F') ? (temp - 32) * 5 / 9 : temp;
        const bucket = logTs.getUTCHours();
        if (intervalBuckets[bucket]) intervalBuckets[bucket].tempValues.push(tempC);
      }
    }

    // ── MDA ──
    if (st === 'MDA' && f.length >= 6) {
      const temp = parseFloat(f[5]);
      if (!isNaN(temp) && logTs) {
        const bucket = logTs.getUTCHours();
        if (intervalBuckets[bucket]) intervalBuckets[bucket].tempValues.push(temp);
      }
    }

    // ── RPM ──
    if (st === 'RPM' && f.length >= 4) {
      const rpm = parseFloat(f[3]), status = strip(f[5] || '');
      if (!isNaN(rpm) && (status === 'A' || status === '')) {
        const absRpm = Math.abs(rpm);
        rpmE.push({ time: logTs, rpm: absRpm });
        if (det.engine && logTs) emit(det.engine.feed(absRpm, logTs));
      }
    }

    // ── XDR: voltage, current, SOC, fuel ──
    if (st === 'XDR' && f.length >= 5) {
      for (let xi = 1; xi + 3 < f.length; xi += 4) {
        const xVal = parseFloat(f[xi + 1]);
        const xUnit = f[xi + 2];
        const xId = strip(f[xi + 3] || '').toUpperCase();
        if (isNaN(xVal)) continue;
        if (det.battery && xUnit === 'V' && xVal > 0 && xVal < 50 && xId !== 'FUEL') {
          emit(det.battery.feed(xVal, logTs, xId));
        }
        if (xUnit === 'A' && (xId === 'BATT' || xId === 'CHG')) {
          const amps = xId === 'CHG' ? Math.abs(xVal) : -Math.abs(xVal);
          currentV.push(amps);
          if (lastCurrentTime && logTs) {
            const dtH = (logTs - lastCurrentTime) / 3600000;
            if (dtH > 0 && dtH < 1) ahConsumed += Math.abs(amps) * dtH;
          }
          lastCurrentTime = logTs;
        }
        if (xUnit === '%' && xId === 'SOC') {
          socV.push(xVal);
        }
      }
    }

    // ── VDM: AIS vessel positions ──
    if (collectAIS && st === 'VDM' && f.length >= 7) {
      const fragCount = parseInt(f[1], 10);
      const fragNum = parseInt(f[2], 10);
      if (fragCount === 1 && fragNum === 1) {
        const pos = parseAISPosition(f[5]);
        if (pos) {
          if (!aisVessels[pos.mmsi]) aisVessels[pos.mmsi] = [];
          aisVessels[pos.mmsi].push({
            lat: pos.lat, lon: pos.lon, time: logTs ? logTs.toISOString() : null,
            sog: pos.sog, cog: pos.cog
          });
        }
      }
    }

    // ── SKAIS: AIS via SignalK (NMEA2000 boats) ──
    if (collectAIS && f[0] === '$SKAIS' && f.length >= 6) {
      const mmsi = f[1];
      const pos = parseLatLon(f[2], f[3], f[4], f[5]);
      if (pos && mmsi) {
        const sog = f.length >= 7 ? parseFloat(f[6]) : null;
        const cog = f.length >= 8 ? parseFloat(strip(f[7] || '')) : null;
        if (!aisVessels[mmsi]) aisVessels[mmsi] = [];
        aisVessels[mmsi].push({
          lat: pos.lat, lon: pos.lon, time: logTs ? logTs.toISOString() : null,
          sog: !isNaN(sog) ? sog : null, cog: !isNaN(cog) ? cog : null
        });
      }
    }

    // ── DBT: Depth Below Transducer ──
    if (st === 'DBT' && f.length >= 5) {
      const dm = parseFloat(f[3]);
      if (!isNaN(dm) && dm > 0 && dm < 9999) {
        depthV.push(dm);
        if (!shallowest || dm < shallowest.depth) {
          shallowest = { depth: dm, lat: lastPos ? lastPos.lat : null, lon: lastPos ? lastPos.lon : null, time: lastPos ? lastPos.time : (logTs ? logTs.toISOString() : null) };
        }
      }
    }

    // ── DBS: Depth Below Surface ──
    if (st === 'DBS' && f.length >= 5) {
      const dm = parseFloat(f[3]);
      if (!isNaN(dm) && dm > 0 && dm < 9999) {
        depthV.push(dm);
        if (!shallowest || dm < shallowest.depth) {
          shallowest = { depth: dm, lat: lastPos ? lastPos.lat : null, lon: lastPos ? lastPos.lon : null, time: lastPos ? lastPos.time : (logTs ? logTs.toISOString() : null) };
        }
      }
    }

    // ── DPT: Depth ──
    if (st === 'DPT' && f.length >= 2) {
      const dm = parseFloat(f[1]);
      const offset = f.length >= 3 ? parseFloat(f[2]) : 0;
      const depth = !isNaN(dm) && dm > 0 ? dm + (isNaN(offset) ? 0 : offset) : NaN;
      if (!isNaN(depth) && depth > 0 && depth < 9999) {
        depthV.push(depth);
        if (!shallowest || depth < shallowest.depth) {
          shallowest = { depth, lat: lastPos ? lastPos.lat : null, lon: lastPos ? lastPos.lon : null, time: lastPos ? lastPos.time : (logTs ? logTs.toISOString() : null) };
        }
      }
    }

    // ── HDG / HDM / HDT: Heading ──
    if ((st === 'HDG' || st === 'HDM' || st === 'HDT') && f.length >= 2) {
      const hdg = parseFloat(f[1]);
      if (!isNaN(hdg) && hdg >= 0 && hdg < 360) hdgV.push(hdg);
    }

    // ── RSA: Rudder Sensor Angle ──
    if (st === 'RSA' && f.length >= 3) {
      const angle = parseFloat(f[1]);
      const status = strip(f[2] || '');
      if (!isNaN(angle) && (status === 'A' || status === '')) rsaV.push(angle);
    }

    // ── XTE: Cross-Track Error ──
    if (st === 'XTE' && f.length >= 6) {
      const status = f[1];
      const xte = parseFloat(f[3]);
      const dir = f[4];
      if (status === 'A' && !isNaN(xte)) xteV.push(dir === 'L' ? -xte : xte);
    }

    // ── APB: Autopilot Sentence B ──
    if (st === 'APB' && f.length >= 14) {
      const status = f[1];
      if (status === 'A' && !apActive) {
        apActive = true;
        apCurrentStart = logTs ? logTs.toISOString() : null;
        apCurrentMode = 'track';
      } else if (status !== 'A' && apActive) {
        apActive = false;
        if (apCurrentStart) apSegments.push({ start: apCurrentStart, end: logTs ? logTs.toISOString() : null, mode: apCurrentMode || 'track' });
        apCurrentStart = null;
      }
    }

    // ── DSC: Digital Selective Calling ──
    if (st === 'DSC' && f.length >= 4) {
      const mmsi = f[2] || '';
      const catCode = f[3] || '';
      const cat = DSC_CAT[catCode] || 'other';
      const nature = (f.length >= 5 && DSC_NATURE[f[4]]) ? DSC_NATURE[f[4]] : null;
      let dscPos = null;
      for (let pi = 4; pi + 3 < f.length; pi++) {
        if ((f[pi+1] === 'N' || f[pi+1] === 'S') && (f[pi+3] === 'E' || f[pi+3] === 'W')) {
          dscPos = parseLatLon(f[pi], f[pi+1], f[pi+2], f[pi+3]);
          if (dscPos) break;
        }
      }
      const dsc = { mmsi, category: cat, nature, lat: dscPos ? dscPos.lat : null, lon: dscPos ? dscPos.lon : null, time: logTs ? logTs.toISOString() : null };
      dscCalls.push(dsc);
      if (cat !== 'routine') {
        const detail = nature ? t('dscCallNature', cat.toUpperCase(), mmsi, nature) : t('dscCall', cat.toUpperCase(), mmsi);
        events.push({ type: 'dsc', time: dsc.time, detail, lat: dsc.lat, lon: dsc.lon });
      }
    }
  }

  // ── Finalize ───────────────────────────────────────────────────

  if (det.engine) det.engine.finalize(endTime);
  const enginePeriods = det.engine ? det.engine.periods : [];
  let engineHours = det.engine ? det.engine.totalHours() : 0;

  // Fallback engine hours from RPM data
  if (enginePeriods.length === 0) {
    const rpmThr = config.evEngineRpmThreshold || 100;
    for (let i = 1; i < rpmE.length; i++) {
      if (rpmE[i].time && rpmE[i - 1].time && rpmE[i - 1].rpm > rpmThr) {
        const dt = (rpmE[i].time - rpmE[i - 1].time) / 3600000;
        if (dt > 0 && dt < 1) engineHours += dt;
      }
    }
  }

  // ── Fuel segments: motor vs sail distance ────────────────────
  let fuelSegments = null;
  if (totalDist > 0 && enginePeriods.length > 0) {
    // Calculate distance covered during engine-on periods
    let motorDist = 0;
    for (const period of enginePeriods) {
      if (!period.start || !period.end) continue;
      const pStart = new Date(period.start).getTime();
      const pEnd = new Date(period.end).getTime();
      // Walk the track and sum distances within engine-on windows
      for (let i = 1; i < track.length; i++) {
        if (!track[i].time || !track[i - 1].time) continue;
        const tTime = new Date(track[i].time).getTime();
        const tPrev = new Date(track[i - 1].time).getTime();
        if (tTime >= pStart && tPrev >= pStart && tTime <= pEnd) {
          const d = haversineNm(track[i - 1].lat, track[i - 1].lon, track[i].lat, track[i].lon);
          if (d < 10) motorDist += d;
        }
      }
    }
    const sailDist = Math.max(0, totalDist - motorDist);
    const motorPct = Math.round(motorDist / totalDist * 100);
    fuelSegments = {
      motorDistNm: r2(motorDist),
      sailDistNm: r2(sailDist),
      motorPct,
      motorHours: r2(engineHours)
    };
  }

  // Downsample track for display (adaptive target)
  let displayTrack = track;
  const maxPts = Math.min(track.length, TRACK_MAX_POINTS);
  if (!opts.fullTrack && track.length > maxPts) {
    const step = Math.ceil(track.length / maxPts);
    displayTrack = track.filter((_, i) => i % step === 0 || i === track.length - 1);
  }

  // Aggregate stats
  const sogAvg = sogV.length ? sogV.reduce((a, b) => a + b, 0) / sogV.length : null;
  const sogMax = sogV.length ? arrMax(sogV) : null;
  const twsMax = twsV.length ? arrMax(twsV) : null;
  const twsAvg = twsV.length ? twsV.reduce((a, b) => a + b, 0) / twsV.length : null;
  const twaAvg = twaV.length ? twaV.reduce((a, b) => a + b, 0) / twaV.length : null;
  const twaMin = twaV.length ? arrMin(twaV) : null;
  const twaMax = twaV.length ? arrMax(twaV) : null;

  const depthMin = depthV.length ? arrMin(depthV) : null;
  const depthMax = depthV.length ? arrMax(depthV) : null;
  const depthAvg = depthV.length ? depthV.reduce((a, b) => a + b, 0) / depthV.length : null;

  if (apActive && apCurrentStart) {
    apSegments.push({ start: apCurrentStart, end: endTime ? endTime.toISOString() : null, mode: apCurrentMode || 'track' });
  }
  const hdgAvg = hdgV.length ? r0(hdgV.reduce((a, b) => a + b, 0) / hdgV.length) : null;
  const rsaAvg = rsaV.length ? r1(rsaV.reduce((a, b) => a + b, 0) / rsaV.length) : null;
  const rsaMax = rsaV.length ? r1(arrMax(rsaV.map(Math.abs))) : null;
  const xteAvg = xteV.length ? r2(xteV.reduce((a, b) => a + b, 0) / xteV.length) : null;
  const xteMax = xteV.length ? r2(arrMax(xteV.map(Math.abs))) : null;

  const weatherIntervals = Object.keys(intervalBuckets).sort((a, b) => a - b).map(bucket => {
    const b = intervalBuckets[bucket];
    return {
      hour: parseInt(bucket, 10),
      lat: Math.round((b.latSum / b.count) * 10000) / 10000,
      lon: Math.round((b.lonSum / b.count) * 10000) / 10000,
      measuredTWS: b.twsValues.length ? r1(b.twsValues.reduce((a, v) => a + v, 0) / b.twsValues.length) : null,
      measuredTemp: b.tempValues.length ? r1(b.tempValues.reduce((a, v) => a + v, 0) / b.tempValues.length) : null
    };
  });

  events.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  return {
    track: displayTrack, totalDistanceNm: r2(totalDist),
    startTime: startTime ? startTime.toISOString() : null,
    endTime: endTime ? endTime.toISOString() : null,
    durationHours: startTime && endTime ? r2((endTime - startTime) / 3600000) : null,
    sogAvgKn: r2(sogAvg), sogMaxKn: r2(sogMax),
    twsMaxKn: r2(twsMax), twsAvgKn: r2(twsAvg),
    twaAvgDeg: r0(twaAvg), twaMinDeg: r0(twaMin), twaMaxDeg: r0(twaMax),
    twaSamples: twaV.length,
    engineHours: r2(engineHours), enginePeriods,
    rpmSamples: rpmE.length, trackPoints: track.length,
    sogSamples: sogV.length, twsSamples: twsV.length,
    depthMinM: r1(depthMin), depthMaxM: r1(depthMax), depthAvgM: r1(depthAvg),
    depthSamples: depthV.length,
    shallowest: shallowest ? { depth: r1(shallowest.depth), lat: shallowest.lat, lon: shallowest.lon, time: shallowest.time } : null,
    hdgSamples: hdgV.length, hdgAvgDeg: hdgAvg,
    rsaSamples: rsaV.length, rsaAvgDeg: rsaAvg, rsaMaxDeg: rsaMax,
    xteSamples: xteV.length, xteAvgNm: xteAvg, xteMaxNm: xteMax,
    apSegments: apSegments.length ? apSegments : undefined,
    dscCalls: dscCalls.length ? dscCalls : undefined,
    ahConsumed: ahConsumed > 0 ? r2(ahConsumed) : null,
    currentSamples: currentV.length,
    socStart: socV.length ? socV[0] : null,
    socEnd: socV.length ? socV[socV.length - 1] : null,
    fuelSegments,
    checksumFails,
    events, weatherIntervals,
    aisVessels: collectAIS ? aisVessels : undefined,
    totalLines,
    sentenceTypes: Object.keys(sentenceTypeCounts).sort(),
    sentenceTypeCounts,
    gpsQuality: gpsTotal > 0 ? {
      total: gpsTotal, invalid: gpsInvalid,
      pct: Math.round(gpsInvalid / gpsTotal * 1000) / 10,
      status: (gpsInvalid / gpsTotal) <= 0.02 ? 'green' : (gpsInvalid / gpsTotal) <= 0.10 ? 'orange' : 'red'
    } : null
  };
}

module.exports = { parseLogFile, parseLatLon, parseDateTime, haversineNm, strip };
