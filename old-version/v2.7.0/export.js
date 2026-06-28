'use strict';

/**
 * Export generators for GPX and CSV.
 */

const EVT_ICONS = {
  engine: '⚙️', course: '🧭', wind: '💨', battery: '🔋',
  hazard: '⚠️', sighting: '🐬', vhf: '📻', note: '📝', custom: '📌'
};

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Generate GPX XML from parsed stats.
 * @param {object} stats   - Output of parseLogFile (with fullTrack)
 * @param {object} [opts]  - { name, includeEvents: true }
 * @returns {string} GPX XML
 */
function toGPX(stats, opts) {
  opts = opts || {};
  const name = opts.name || stats.filename || 'NMEA0183 Track';
  const track = stats.track || [];
  const events = opts.includeEvents !== false ? (stats.events || []) : [];

  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="NMEA0183 Logger"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
<metadata>
  <name>${esc(name)}</name>
  <desc>Distance: ${stats.totalDistanceNm || '?'} nm | Duration: ${stats.durationHours || '?'}h | SOG avg: ${stats.sogAvgKn || '?'} kn</desc>
  ${stats.startTime ? `<time>${stats.startTime}</time>` : ''}
</metadata>
`;

  // Track
  if (track.length > 0) {
    gpx += `<trk>\n  <name>${esc(name)}</name>\n  <trkseg>\n`;
    for (const pt of track) {
      gpx += `    <trkpt lat="${pt.lat}" lon="${pt.lon}">`;
      if (pt.time) gpx += `<time>${pt.time}</time>`;
      if (pt.sog !== null && pt.sog !== undefined) gpx += `<speed>${(pt.sog * 0.514444).toFixed(2)}</speed>`; // kn → m/s
      gpx += `</trkpt>\n`;
    }
    gpx += `  </trkseg>\n</trk>\n`;
  }

  // Events as waypoints
  if (events.length > 0 && track.length > 0) {
    for (const ev of events) {
      if (!ev.time) continue;
      // Find closest track point
      const evTime = new Date(ev.time).getTime();
      let closest = null, minDt = Infinity;
      for (const pt of track) {
        if (!pt.time) continue;
        const dt = Math.abs(new Date(pt.time).getTime() - evTime);
        if (dt < minDt) { minDt = dt; closest = pt; }
      }
      if (closest && minDt < 300000) { // within 5 min
        const icon = EVT_ICONS[ev.type] || '📌';
        gpx += `<wpt lat="${closest.lat}" lon="${closest.lon}">`;
        if (ev.time) gpx += `<time>${ev.time}</time>`;
        gpx += `<name>${icon} ${esc(ev.detail)}</name>`;
        gpx += `<type>${ev.type}</type>`;
        if (ev.note) gpx += `<desc>${esc(ev.note)}</desc>`;
        gpx += `</wpt>\n`;
      }
    }
  }

  gpx += `</gpx>\n`;
  return gpx;
}

/**
 * Generate CSV from parsed stats.
 * Returns an object with separate CSV strings for different data types.
 * @param {object} stats - Output of parseLogFile
 * @param {object} [opts]
 * @returns {string} Combined CSV
 */
function toCSV(stats, opts) {
  opts = opts || {};
  const lines = [];
  const sep = ',';
  const nl = '\n';

  // Header
  lines.push('# NMEA0183 Logger — Export');
  lines.push(`# File: ${stats.filename || 'unknown'}`);
  lines.push(`# Date: ${stats.logDate || stats.startTime || 'unknown'}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
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
  lines.push('TWA avg' + sep + (stats.twaAvgDeg || '') + sep + '°');
  lines.push('Engine hours' + sep + (stats.engineHours || '') + sep + 'hours');
  lines.push('Engine periods' + sep + (stats.enginePeriods ? stats.enginePeriods.length : 0) + sep + '');
  lines.push('Track points' + sep + (stats.trackPoints || '') + sep + '');
  lines.push('');

  // Events
  if (stats.events && stats.events.length > 0) {
    lines.push('## Events');
    lines.push('Time' + sep + 'Type' + sep + 'Detail' + sep + 'Note' + sep + 'Manual');
    for (const ev of stats.events) {
      const detail = String(ev.detail || '').replace(/,/g, ';').replace(/\n/g, ' ');
      const note = String(ev.note || '').replace(/,/g, ';').replace(/\n/g, ' ');
      lines.push(`${ev.time || ''}${sep}${ev.type}${sep}${detail}${sep}${note}${sep}${ev.manual ? 'yes' : 'no'}`);
    }
    lines.push('');
  }

  // Engine periods
  if (stats.enginePeriods && stats.enginePeriods.length > 0) {
    lines.push('## Engine periods');
    lines.push('Start' + sep + 'End' + sep + 'Duration (min)');
    for (const p of stats.enginePeriods) {
      const dur = Math.round((new Date(p.end) - new Date(p.start)) / 60000);
      lines.push(`${p.start}${sep}${p.end}${sep}${dur}`);
    }
    lines.push('');
  }

  // Weather intervals
  if (stats.weatherIntervals && stats.weatherIntervals.length > 0) {
    lines.push('## Weather intervals (measured)');
    lines.push('Hour' + sep + 'Lat' + sep + 'Lon' + sep + 'TWS (kn)' + sep + 'Temp (°C)');
    for (const w of stats.weatherIntervals) {
      lines.push(`${w.hour}${sep}${w.lat}${sep}${w.lon}${sep}${w.measuredTWS || ''}${sep}${w.measuredTemp || ''}`);
    }
    lines.push('');
  }

  // Track (sampled — full track would be huge in CSV)
  if (stats.track && stats.track.length > 0) {
    lines.push('## Track');
    lines.push('Time' + sep + 'Lat' + sep + 'Lon' + sep + 'SOG (kn)');
    for (const pt of stats.track) {
      lines.push(`${pt.time || ''}${sep}${pt.lat}${sep}${pt.lon}${sep}${pt.sog !== null ? pt.sog : ''}`);
    }
  }

  return lines.join(nl);
}

module.exports = { toGPX, toCSV };
