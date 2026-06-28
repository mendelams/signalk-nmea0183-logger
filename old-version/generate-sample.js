#!/usr/bin/env node
'use strict';

// Generate a realistic NMEA0183 log: Den Helder → Texel (Oudeschild)
// Includes all sentence types, events that trigger detection:
//   - Motor start/stop (3 periods)
//   - Course changes >30° (3 turns)
//   - Wind shift >5 kn (2 shifts)
//   - Battery low voltage (1 dip)
//   - AIS traffic (busy Marsdiep)
//   - Depth, heading, temperature, barometer

const fs = require('fs');
const path = require('path');

const out = [];
function emit(ts, sentence) {
  out.push(`${ts.toISOString()} ${sentence}`);
}

// Format helpers
function fmtLat(deg) {
  const d = Math.abs(deg);
  const dd = Math.floor(d);
  const mm = (d - dd) * 60;
  return `${String(dd).padStart(2,'0')}${mm.toFixed(4).padStart(7,'0')},${deg >= 0 ? 'N' : 'S'}`;
}
function fmtLon(deg) {
  const d = Math.abs(deg);
  const dd = Math.floor(d);
  const mm = (d - dd) * 60;
  return `${String(dd).padStart(3,'0')}${mm.toFixed(4).padStart(7,'0')},${deg >= 0 ? 'E' : 'W'}`;
}
function fmtTime(ts) {
  return ts.toISOString().substring(11,19).replace(/:/g,'');
}
function fmtDate(ts) {
  const d = ts.toISOString().substring(0,10).split('-');
  return d[2] + d[1] + d[0].substring(2);
}
function cs(s) {
  // NMEA checksum
  let c = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '*') break;
    c ^= s.charCodeAt(i);
  }
  return s + '*' + c.toString(16).toUpperCase().padStart(2,'0');
}
function rnd(min, max) { return min + Math.random() * (max - min); }
function jitter(v, amount) { return v + (Math.random() - 0.5) * 2 * amount; }

// ── Trip definition ──────────────────────────────────────────
// Den Helder TESO terminal → Marsdiep → Oudeschild
// Total ~6nm, ~3 hours with motor + sailing segments

const segments = [
  // Phase 1: Motor out of Den Helder harbor (07:00 - 07:25)
  { name: 'Harbor exit', startMin: 0, endMin: 25,
    startLat: 52.9580, startLon: 4.7590, endLat: 52.9720, endLon: 4.7450,
    sogRange: [3, 5], cogBase: 330, cogVar: 3,
    twsRange: [10, 12], twaBase: 90,
    rpmBase: 2200, depthRange: [4, 8],
    hdgBase: 328, tempC: 8.5, baroMb: 1015.2, battV: 13.1 },

  // Phase 2: Course change to NW, motor off, start sailing (07:25 - 07:35)
  { name: 'Bear off + sails up', startMin: 25, endMin: 35,
    startLat: 52.9720, startLon: 4.7450, endLat: 52.9820, endLon: 4.7300,
    sogRange: [4, 6], cogBase: 295, cogVar: 5,   // >30° change from 330
    twsRange: [12, 14], twaBase: 65,
    rpmBase: 0, depthRange: [8, 15],
    hdgBase: 293, tempC: 8.2, baroMb: 1015.0, battV: 12.6 },

  // Phase 3: Sailing NW across Marsdiep, wind picks up (07:35 - 08:30)
  { name: 'Sailing Marsdiep', startMin: 35, endMin: 90,
    startLat: 52.9820, startLon: 4.7300, endLat: 53.0050, endLon: 4.7100,
    sogRange: [5, 7], cogBase: 300, cogVar: 8,
    twsRange: [14, 16], twaBase: 55,      // wind increasing
    rpmBase: 0, depthRange: [10, 22],
    hdgBase: 298, tempC: 7.8, baroMb: 1014.5, battV: 12.4 },

  // Phase 4: Wind shift! +6kn, tack (08:30 - 08:45)
  { name: 'Wind shift + tack', startMin: 90, endMin: 105,
    startLat: 53.0050, startLon: 4.7100, endLat: 53.0120, endLon: 4.7350,
    sogRange: [5, 7], cogBase: 45, cogVar: 5,   // >30° tack from 300→045
    twsRange: [20, 23], twaBase: 42,      // wind jumped from ~15 to ~21
    rpmBase: 0, depthRange: [12, 18],
    hdgBase: 43, tempC: 7.5, baroMb: 1014.0, battV: 12.2 },

  // Phase 5: Sailing towards Texel, wind eases (08:45 - 09:30)
  { name: 'Approach Texel', startMin: 105, endMin: 150,
    startLat: 53.0120, startLon: 4.7350, endLat: 53.0280, endLon: 4.7900,
    sogRange: [4, 6], cogBase: 55, cogVar: 6,
    twsRange: [13, 15], twaBase: 70,      // wind drops ~6kn from 21→15
    rpmBase: 0, depthRange: [6, 14],
    hdgBase: 53, tempC: 8.0, baroMb: 1014.2, battV: 11.8 },  // battery dip!

  // Phase 6: Motor on for Oudeschild harbor (09:30 - 09:55)
  { name: 'Harbor entry', startMin: 150, endMin: 175,
    startLat: 53.0280, startLon: 4.7900, endLat: 53.0380, endLon: 4.8500,
    sogRange: [3, 4.5], cogBase: 80, cogVar: 3,  // >30° change from 055
    twsRange: [12, 14], twaBase: 85,
    rpmBase: 1800, depthRange: [3, 6],
    hdgBase: 78, tempC: 8.3, baroMb: 1014.5, battV: 13.2 },  // battery recovers with engine

  // Phase 7: Mooring (09:55 - 10:00)
  { name: 'Mooring', startMin: 175, endMin: 180,
    startLat: 53.0380, startLon: 4.8500, endLat: 53.0385, endLon: 4.8510,
    sogRange: [0.2, 1.0], cogBase: 80, cogVar: 15,
    twsRange: [11, 13], twaBase: 90,
    rpmBase: 0, depthRange: [2.5, 3.5],
    hdgBase: 80, tempC: 8.5, baroMb: 1014.5, battV: 12.8 },
];

// AIS MMSI list (real-ish Dutch vessels)
const aisTargets = [
  { mmsi: '244650001', name: 'TEXELSTROOM' },
  { mmsi: '244780123', name: 'DOKTER_WAGEMAKER' },
  { mmsi: '245123456', name: 'SEASTORM' },
  { mmsi: '244998877', name: 'WADLOPER' },
  { mmsi: '244556600', name: 'ORION' },
  { mmsi: '211334455', name: 'HELGOLAND' },
  { mmsi: '246012345', name: 'RIVAL' },
];

// ── Generate ──────────────────────────────────────────────────
const baseTime = new Date('2026-03-01T07:00:00.000Z');

for (const seg of segments) {
  const durMin = seg.endMin - seg.startMin;
  const steps = durMin * 6; // 1 sentence every 10 seconds = 6/min

  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const min = seg.startMin + frac * durMin;
    const ts = new Date(baseTime.getTime() + min * 60000);
    const time = fmtTime(ts);
    const date = fmtDate(ts);

    // Interpolate position
    const lat = seg.startLat + frac * (seg.endLat - seg.startLat);
    const lon = seg.startLon + frac * (seg.endLon - seg.startLon);
    const latJ = jitter(lat, 0.0002);
    const lonJ = jitter(lon, 0.0003);

    const sog = jitter((seg.sogRange[0] + seg.sogRange[1]) / 2, (seg.sogRange[1] - seg.sogRange[0]) / 2);
    const cog = jitter(seg.cogBase, seg.cogVar);
    const hdg = jitter(seg.hdgBase, 2);
    const tws = jitter((seg.twsRange[0] + seg.twsRange[1]) / 2, (seg.twsRange[1] - seg.twsRange[0]) / 2);
    const twa = jitter(seg.twaBase, 8);
    const depth = jitter((seg.depthRange[0] + seg.depthRange[1]) / 2, (seg.depthRange[1] - seg.depthRange[0]) / 2);

    // Battery voltage: dip in segment 5 (approach Texel)
    let battV = seg.battV;
    if (seg.name === 'Approach Texel' && frac > 0.6 && frac < 0.8) {
      battV = jitter(11.5, 0.3);  // dip below 12V
    }

    // RMC — every 10s
    const latStr = fmtLat(latJ);
    const lonStr = fmtLon(lonJ);
    emit(ts, cs(`$GPRMC,${time},A,${latStr},${lonStr},${Math.max(0,sog).toFixed(1)},${((cog%360)+360)%360|0}.${(Math.random()*10|0)},${date},,,A`));

    // GGA — every 10s (will be deduped but present for testing)
    const fixQ = 2;
    const sats = 8 + (Math.random() * 4 | 0);
    emit(ts, cs(`$GPGGA,${time},${latStr},${lonStr},${fixQ},${sats},0.9,2.5,M,,M,,`));

    // HDG — every 10s
    emit(ts, cs(`$IIHDG,${hdg.toFixed(1)},,,1.2,E`));

    // MWV True — every 10s
    emit(ts, cs(`$IIMWV,${Math.max(0,twa).toFixed(1)},T,${Math.max(0,tws).toFixed(1)},N,A`));

    // DBT — every 10s
    const depthFt = depth * 3.28084;
    const depthFa = depth * 0.546807;
    emit(ts, cs(`$IIDBT,${depthFt.toFixed(1)},f,${depth.toFixed(1)},M,${depthFa.toFixed(1)},F`));

    // RPM — every 10s
    // Ramp RPM at segment transitions to avoid spurious events
    let rpmVal = seg.rpmBase;
    if (seg.rpmBase > 0) {
      // Ramp up in first 20s, ramp down in last 20s
      if (frac < 0.02) rpmVal = seg.rpmBase * (frac / 0.02);
      else if (frac > 0.98) rpmVal = seg.rpmBase * ((1 - frac) / 0.02);
      rpmVal = jitter(rpmVal, 50);
    }
    emit(ts, cs(`$IIRPM,E,1,${Math.max(0,rpmVal).toFixed(0)},,A`));

    // MTA (temperature) — every 30s
    if (i % 3 === 0) {
      const temp = jitter(seg.tempC, 0.3);
      emit(ts, cs(`$IIMTA,${temp.toFixed(1)},C`));
    }

    // MDA (barometer + temp) — every 60s
    if (i % 6 === 0) {
      const baro = jitter(seg.baroMb, 0.5);
      const baroInch = baro * 0.02953;
      const temp = jitter(seg.tempC, 0.2);
      emit(ts, cs(`$IIMDA,${baroInch.toFixed(4)},I,${(baro/1000).toFixed(4)},B,${temp.toFixed(1)},C,,C,,,,,,,,,,`));
    }

    // XDR battery — every 30s
    if (i % 3 === 0) {
      const v = jitter(battV, 0.1);
      emit(ts, cs(`$IIXDR,V,${v.toFixed(2)},V,BATT`));
    }

    // VDO (own AIS) — every 60s (will be throttled to heartbeat)
    if (i % 6 === 0) {
      emit(ts, '!AIVDO,1,1,,A,15RTd30000J`sV4;9a8H4?vP0000,0*7A');
    }

    // VDM (AIS traffic) — random vessels, every 5-15s
    if (Math.random() < 0.3) {
      const target = aisTargets[Math.random() * aisTargets.length | 0];
      // Simplified AIS payload (not decodable to real position, but has valid MMSI structure)
      emit(ts, `!AIVDM,1,1,,B,15N${target.mmsi.substring(0,4)}P00J\`tC4;9g\`R4?vN0<02,0*5E`);
    }

    // VTG — every 30s
    if (i % 3 === 0) {
      const cogT = ((cog%360)+360)%360;
      emit(ts, cs(`$GPVTG,${cogT.toFixed(1)},T,,M,${Math.max(0,sog).toFixed(1)},N,${(Math.max(0,sog)*1.852).toFixed(1)},K,A`));
    }

    // GSA — every 60s
    if (i % 6 === 0) {
      emit(ts, cs(`$GPGSA,A,3,01,03,06,11,17,19,22,25,,,,,1.2,0.9,0.8`));
    }

    // XTE — every 30s (cross track error when on route)
    if (i % 3 === 0) {
      const xte = jitter(0, 0.05);
      emit(ts, cs(`$GPXTE,A,A,${Math.abs(xte).toFixed(3)},${xte>=0?'R':'L'},N,A`));
    }

    // RSA (rudder) — every 10s
    const rudder = jitter(0, 5);
    emit(ts, cs(`$IIRSA,${rudder.toFixed(1)},A,,V`));

    // VHW (water speed) — every 10s
    const stw = Math.max(0, sog - jitter(0.3, 0.2));
    emit(ts, cs(`$IIVHW,${hdg.toFixed(1)},T,,M,${stw.toFixed(1)},N,,K`));

    // MTW (water temp) — every 60s
    if (i % 6 === 0) {
      emit(ts, cs(`$IIMTW,${jitter(6.5, 0.3).toFixed(1)},C`));
    }
  }
}

// Sort by timestamp
out.sort();

const logContent = out.join('\n') + '\n';
const filename = 'nmea0183_2026-03-01.log';

// Write to current directory
fs.writeFileSync(filename, logContent);

const lines = out.length;
const sizeMB = (Buffer.byteLength(logContent) / 1048576).toFixed(2);
const sentences = {};
for (const line of out) {
  const m = line.match(/[!$]([A-Z]{2})([A-Z]{2,4})/);
  if (m) sentences[m[1]+m[2]] = (sentences[m[1]+m[2]] || 0) + 1;
}

console.log(`\nGenerated: ${filename}`);
console.log(`Lines: ${lines} | Size: ${sizeMB} MB`);
console.log(`\nSentence counts:`);
Object.entries(sentences).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k}: ${v}`));
console.log(`\nExpected events:`);
console.log(`  ⚙️  Motor stop  @ ~07:25 (harbor → sailing)`);
console.log(`  🧭 COG 330→295 @ ~07:25 (bear off)`);
console.log(`  🧭 COG 300→045 @ ~08:30 (tack in Marsdiep)`);
console.log(`  💨 TWS ~15→~21 @ ~08:30 (wind shift up)`);
console.log(`  💨 TWS ~21→~14 @ ~08:45 (wind shift down)`);
console.log(`  🔋 Battery <12V @ ~09:15 (voltage dip)`);
console.log(`  🔋 Battery >12V @ ~09:25 (voltage recovery)`);
console.log(`  ⚙️  Motor start @ ~09:30 (harbor approach)`);
console.log(`  🧭 COG 055→080 @ ~09:30 (harbor turn)`);
console.log(`  ⚙️  Motor stop  @ ~09:55 (mooring)`);
