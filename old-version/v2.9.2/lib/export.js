'use strict';

/**
 * Export generators for GPX and CSV.
 * Supports single-day and multi-day (voyage) data.
 * GPX can optionally include AIS vessel tracks.
 */

const EVT_ICONS = {
  engine: '⚙️', course: '🧭', wind: '💨', battery: '🔋',
  hazard: '⚠️', sighting: '🐬', vhf: '📻', note: '📝', custom: '📌'
};

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function gpxName(s) { return '<' + 'name>' + esc(s) + '</' + 'name>'; }

/**
 * Generate GPX XML.
 * @param {object} stats       - parseLogFile output or combined voyage stats
 * @param {object} [opts]
 * @param {string} [opts.name]
 * @param {boolean} [opts.includeEvents=true]
 * @param {boolean} [opts.includeAIS=false]
 * @param {Array}  [opts.perDay] - per-day stats for multi-day tracks
 * @returns {string} GPX XML
 */
function toGPX(stats, opts) {
  opts = opts || {};
  const nm = opts.name || stats.name || stats.filename || 'NMEA0183 Track';
  const track = stats.track || [];
  const events = opts.includeEvents !== false ? (stats.events || []) : [];
  const perDay = opts.perDay || stats.perDay || null;
  const aisVessels = opts.includeAIS ? (stats.aisVessels || {}) : {};

  let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
  gpx += '<gpx version="1.1" creator="NMEA0183 Logger"\n';
  gpx += '  xmlns="http://www.topografix.com/GPX/1/1"\n';
  gpx += '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
  gpx += '  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n';
  gpx += '<metadata>\n  ' + gpxName(nm) + '\n';
  gpx += '  <desc>Distance: ' + (stats.totalDistanceNm || '?') + ' nm</desc>\n';
  if (stats.startTime) gpx += '  <time>' + stats.startTime + '</time>\n';
  gpx += '</metadata>\n';

  // Own vessel track(s)
  if (perDay && perDay.length > 1) {
    // Multi-day: one trk per day
    for (let di = 0; di < perDay.length; di++) {
      const day = perDay[di];
      const dayDate = day.logDate || 'Day ' + (di + 1);
      const dayPts = track.filter(pt => pt.time && pt.time.startsWith(dayDate));
      if (!dayPts.length) continue;
      gpx += '<trk>\n  ' + gpxName(dayDate + ' — ' + (day.distanceNm || '?') + ' nm') + '\n  <trkseg>\n';
      for (const pt of dayPts) {
        gpx += '    <trkpt lat="' + pt.lat + '" lon="' + pt.lon + '">';
        if (pt.time) gpx += '<time>' + pt.time + '</time>';
        if (pt.sog !== null && pt.sog !== undefined) gpx += '<speed>' + (pt.sog * 0.514444).toFixed(2) + '</speed>';
        gpx += '</trkpt>\n';
      }
      gpx += '  </trkseg>\n</trk>\n';
    }
  } else if (track.length > 0) {
    // Single-day: one trk
    gpx += '<trk>\n  ' + gpxName(nm) + '\n  <trkseg>\n';
    for (const pt of track) {
      gpx += '    <trkpt lat="' + pt.lat + '" lon="' + pt.lon + '">';
      if (pt.time) gpx += '<time>' + pt.time + '</time>';
      if (pt.sog !== null && pt.sog !== undefined) gpx += '<speed>' + (pt.sog * 0.514444).toFixed(2) + '</speed>';
      gpx += '</trkpt>\n';
    }
    gpx += '  </trkseg>\n</trk>\n';
  }

  // AIS vessel tracks
  const mmsiList = Object.keys(aisVessels);
  for (const mmsi of mmsiList) {
    const pts = aisVessels[mmsi];
    if (pts.length < 2) continue; // skip single-ping vessels
    gpx += '<trk>\n  ' + gpxName('AIS ' + mmsi) + '\n  <trkseg>\n';
    for (const pt of pts) {
      gpx += '    <trkpt lat="' + pt.lat + '" lon="' + pt.lon + '">';
      if (pt.time) gpx += '<time>' + pt.time + '</time>';
      gpx += '</trkpt>\n';
    }
    gpx += '  </trkseg>\n</trk>\n';
  }

  // Events as waypoints
  if (events.length > 0 && track.length > 0) {
    for (const ev of events) {
      if (!ev.time) continue;
      const evTime = new Date(ev.time).getTime();
      let closest = null, minDt = Infinity;
      for (const pt of track) {
        if (!pt.time) continue;
        const dt = Math.abs(new Date(pt.time).getTime() - evTime);
        if (dt < minDt) { minDt = dt; closest = pt; }
      }
      if (closest && minDt < 300000) {
        const icon = EVT_ICONS[ev.type] || '📌';
        gpx += '<wpt lat="' + closest.lat + '" lon="' + closest.lon + '">';
        gpx += '<time>' + ev.time + '</time>';
        gpx += gpxName(icon + ' ' + (ev.detail || ''));
        gpx += '<type>' + ev.type + '</type>';
        if (ev.note) gpx += '<desc>' + esc(ev.note) + '</desc>';
        gpx += '</wpt>\n';
      }
    }
  }

  gpx += '</gpx>\n';
  return gpx;
}

/**
 * Generate CSV from parsed stats or combined voyage data.
 */
function toCSV(stats, opts) {
  opts = opts || {};
  const lines = [];
  const sep = ',';

  lines.push('# NMEA0183 Logger Export');
  lines.push('# ' + (stats.name || stats.filename || 'unknown'));
  lines.push('# Generated: ' + new Date().toISOString());
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('Metric' + sep + 'Value' + sep + 'Unit');
  lines.push('Distance' + sep + (stats.totalDistanceNm || '') + sep + 'nm');
  lines.push('Duration' + sep + (stats.durationHours || '') + sep + 'hours');
  lines.push('Start' + sep + (stats.startTime || '') + sep + 'UTC');
  lines.push('End' + sep + (stats.endTime || '') + sep + 'UTC');
  lines.push('SOG avg' + sep + (stats.sogAvgKn || '') + sep + 'kn');
  lines.push('SOG max' + sep + (stats.sogMaxKn || '') + sep + 'kn');
  lines.push('TWS avg' + sep + (stats.twsAvgKn || '') + sep + 'kn');
  lines.push('TWS max' + sep + (stats.twsMaxKn || '') + sep + 'kn');
  const engHrs = stats.engineHours || stats.totalEngineHours || '';
  const engPer = stats.enginePeriods ? stats.enginePeriods.length : (stats.totalEnginePeriods || '');
  lines.push('Engine hours' + sep + engHrs + sep + 'hours');
  lines.push('Engine periods' + sep + engPer + sep + '');
  if (stats.days) lines.push('Days' + sep + stats.days + sep + '');
  lines.push('');

  // Per-day breakdown (voyages)
  if (stats.perDay && stats.perDay.length > 0) {
    lines.push('## Per day');
    lines.push('Date' + sep + 'Distance (nm)' + sep + 'Duration (h)' + sep + 'SOG avg (kn)' + sep + 'SOG max (kn)' + sep + 'TWS avg (kn)' + sep + 'Engine (h)' + sep + 'Events');
    for (const d of stats.perDay) {
      lines.push([d.logDate, d.distanceNm, d.durationHours, d.sogAvgKn, d.sogMaxKn, d.twsAvgKn, d.engineHours, d.eventCount].join(sep));
    }
    lines.push('');
  }

  // Events
  if (stats.events && stats.events.length > 0) {
    lines.push('## Events');
    lines.push('Time' + sep + 'Type' + sep + 'Detail' + sep + 'Note' + sep + 'Manual');
    for (const ev of stats.events) {
      const detail = String(ev.detail || '').replace(/,/g, ';').replace(/\n/g, ' ');
      const note = String(ev.note || '').replace(/,/g, ';').replace(/\n/g, ' ');
      lines.push([(ev.time || ''), ev.type, detail, note, ev.manual ? 'yes' : 'no'].join(sep));
    }
    lines.push('');
  }

  // Engine periods
  if (stats.enginePeriods && stats.enginePeriods.length > 0) {
    lines.push('## Engine periods');
    lines.push('Start' + sep + 'End' + sep + 'Duration (min)');
    for (const p of stats.enginePeriods) {
      const dur = Math.round((new Date(p.end) - new Date(p.start)) / 60000);
      lines.push(p.start + sep + p.end + sep + dur);
    }
    lines.push('');
  }

  // Track
  if (stats.track && stats.track.length > 0) {
    lines.push('## Track');
    lines.push('Time' + sep + 'Lat' + sep + 'Lon' + sep + 'SOG (kn)');
    for (const pt of stats.track) {
      lines.push([(pt.time || ''), pt.lat, pt.lon, (pt.sog !== null ? pt.sog : '')].join(sep));
    }
  }

  return lines.join('\n');
}

module.exports = { toGPX, toCSV };
