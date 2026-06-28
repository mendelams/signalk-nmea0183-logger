'use strict';
const fs = require('fs');
const { SmoothedChangeDetector, StateToggleDetector, LevelCrossingDetector } = require('./events');

// ── NMEA parsing helpers ────────────────────────────────────────

function parseLatLon(latS, latD, lonS, lonD) {
  if (!latS || !lonS || !latD || !lonD) return null;
  let lat = parseInt(latS.substring(0, 2), 10) + parseFloat(latS.substring(2)) / 60;
  if (latD === 'S') lat = -lat;
  let lon = parseInt(lonS.substring(0, 3), 10) + parseFloat(lonS.substring(3)) / 60;
  if (lonD === 'W') lon = -lon;
  if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

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

function r2(v) { return v !== null ? Math.round(v * 100) / 100 : null; }
function r1(v) { return v !== null ? Math.round(v * 10) / 10 : null; }
function r0(v) { return v !== null ? Math.round(v) : null; }

// ── Build event detectors from config ───────────────────────────

function createDetectors(config, t) {
  const det = {};

  if (config.evCourseEnabled !== false) {
    det.course = new SmoothedChangeDetector({
      type: 'course',
      threshold: config.evCourseDeg || 30,
      bufferSize: 5,
      minElapsed: 10,
      circular: true,
      drift: 0.05,
      format: (prev, curr, diff) =>
        `${Math.round(prev)}° → ${Math.round(curr)}° (${diff > 0 ? '+' : ''}${Math.round(diff)}°)`
    });
  }

  if (config.evWindEnabled !== false) {
    det.wind = new SmoothedChangeDetector({
      type: 'wind',
      threshold: config.evWindKn || 5,
      bufferSize: 10,
      minElapsed: 10,
      circular: false,
      drift: 0.05,
      format: (prev, curr, diff) =>
        `TWS ${prev.toFixed(1)} → ${curr.toFixed(1)} kn (${diff > 0 ? '+' : ''}${diff.toFixed(1)})`
    });
  }

  if (config.evEngineEnabled !== false) {
    det.engine = new StateToggleDetector({
      type: 'engine',
      threshold: config.evEngineRpmThreshold || 100,
      formatOn: () => t('engineStarted'),
      formatOff: (_ts, dur) => t('engineStoppedDur', dur),
      formatOffNoDur: () => t('engineStopped')
    });
  }

  if (config.evBatteryEnabled !== false) {
    det.battery = new LevelCrossingDetector({
      type: 'battery',
      threshold: config.evBatteryLowV || 12.0,
      direction: 'below',
      formatCross: (val, thr, id) =>
        id ? t('batteryLowId', val.toFixed(1), thr, id) : t('batteryLow', val.toFixed(1), thr),
      formatRecover: (val, id) =>
        id ? t('batteryRecoverId', val.toFixed(1), id) : t('batteryRecover', val.toFixed(1))
    });
  }

  return det;
}

// ── Main parser ─────────────────────────────────────────────────

function parseLogFile(filepath, config, t) {
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  const track = [], sogV = [], twsV = [], twaV = [], rpmE = [];
  const events = [];
  let startTime = null, endTime = null, totalDist = 0, prevPos = null;
  const intervalBuckets = {};

  const det = createDetectors(config, t);
  function emit(ev) { if (ev) events.push(ev); }

  for (const line of lines) {
    let s = line.trim(), logTs = null;
    const tm = s.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)/);
    if (tm) { logTs = new Date(tm[1]); s = tm[2]; }
    if (s[0] !== '$' && s[0] !== '!') continue;
    const f = s.split(',');
    if (f.length < 2) continue;
    const st = f[0].length >= 6 ? f[0].substring(3, 6) : f[0].substring(3);

    // ── RMC ──
    if (st === 'RMC' && f.length >= 10) {
      if (f[2] !== 'A') continue;
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
        track.push({ lat: pos.lat, lon: pos.lon, time: ts ? ts.toISOString() : null, sog: isNaN(sog) ? null : sog });
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
      }
      if (!isNaN(sog) && sog >= 0) sogV.push(sog);
      if (det.course && !isNaN(cog) && !isNaN(sog) && sog > 1.0 && ts) {
        emit(det.course.feed(cog, ts));
      }
    }

    // ── VTG ──
    if (st === 'VTG' && f.length >= 6) {
      const sog = parseFloat(f[5]);
      if (!isNaN(sog) && sog >= 0 && sog < 100) sogV.push(sog);
    }

    // ── GGA fallback ──
    if (st === 'GGA' && f.length >= 10 && parseInt(f[6], 10) > 0) {
      const pos = parseLatLon(f[2], f[3], f[4], f[5]);
      if (pos && track.length === 0) track.push({ lat: pos.lat, lon: pos.lon, time: logTs ? logTs.toISOString() : null, sog: null });
    }

    // ── MWV ──
    if (st === 'MWV' && f.length >= 5) {
      const angle = parseFloat(f[1]), ref = f[2], speed = parseFloat(f[3]), unit = f[4], status = strip(f[5] || '');
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

    // ── XDR: voltage ──
    if (det.battery && st === 'XDR' && f.length >= 5) {
      for (let xi = 1; xi + 3 < f.length; xi += 4) {
        const xVal = parseFloat(f[xi + 1]);
        const xUnit = f[xi + 2];
        const xId = strip(f[xi + 3] || '').toUpperCase();
        if (xUnit === 'V' && !isNaN(xVal) && xVal > 0 && xVal < 50) {
          emit(det.battery.feed(xVal, logTs, xId));
        }
      }
    }
  }

  // Finalize engine
  if (det.engine) det.engine.finalize(endTime);
  const enginePeriods = det.engine ? det.engine.periods : [];
  let engineHours = det.engine ? det.engine.totalHours() : 0;

  // Fallback engine hours
  if (enginePeriods.length === 0) {
    const rpmThr = config.evEngineRpmThreshold || 100;
    for (let i = 1; i < rpmE.length; i++) {
      if (rpmE[i].time && rpmE[i - 1].time && rpmE[i - 1].rpm > rpmThr) {
        const dt = (rpmE[i].time - rpmE[i - 1].time) / 3600000;
        if (dt > 0 && dt < 1) engineHours += dt;
      }
    }
  }

  // Downsample track
  let displayTrack = track;
  if (track.length > 2000) {
    const step = Math.ceil(track.length / 2000);
    displayTrack = track.filter((_, i) => i % step === 0 || i === track.length - 1);
  }

  const sogAvg = sogV.length ? sogV.reduce((a, b) => a + b, 0) / sogV.length : null;
  const sogMax = sogV.length ? Math.max(...sogV) : null;
  const twsMax = twsV.length ? Math.max(...twsV) : null;
  const twsAvg = twsV.length ? twsV.reduce((a, b) => a + b, 0) / twsV.length : null;
  const twaAvg = twaV.length ? twaV.reduce((a, b) => a + b, 0) / twaV.length : null;
  const twaMin = twaV.length ? Math.min(...twaV) : null;
  const twaMax = twaV.length ? Math.max(...twaV) : null;

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
    events, weatherIntervals
  };
}

module.exports = { parseLogFile, parseLatLon, parseDateTime, haversineNm, strip };
