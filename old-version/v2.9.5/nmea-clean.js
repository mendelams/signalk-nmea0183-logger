#!/usr/bin/env node
'use strict';

/**
 * nmea-clean.js — Clean NMEA log for polar replay.
 *
 * Removes:
 *   - AIS sentences (!AIVDM, !AIVDO)
 *   - Data during engine-on periods (from .events.json)
 *   - Optionally: all non-essential sentences (keep only wind, speed, heading, GPS)
 *
 * Usage:
 *   node nmea-clean.js <logfile> [options]
 *
 *   --events <file>    Events JSON file (default: <logfile>.events.json → same name with .events.json)
 *   --strict           Keep only essential sentences for polar: RMC, MWV, VHW, VWR, HDG, HDT, HDM, VTG, GGA
 *   --output <file>    Output file (default: <logfile>_clean.log)
 *   --dry              Dry run — show stats without writing
 *
 * Engine events are detected by type 'engine' or detail containing
 * 'motor', 'engine', 'Motor', 'Engine' (case insensitive).
 * Events with detail matching start/aan/on → engine ON
 * Events with detail matching stop/uit/off → engine OFF
 */

var fs = require('fs');
var path = require('path');

// ── Parse arguments ──
var args = process.argv.slice(2);
var logFile = null, eventsFile = null, outputFile = null, strict = false, dry = false;

for (var i = 0; i < args.length; i++) {
  if (args[i] === '--events' && args[i + 1]) { eventsFile = args[++i]; }
  else if (args[i] === '--output' && args[i + 1]) { outputFile = args[++i]; }
  else if (args[i] === '--strict') { strict = true; }
  else if (args[i] === '--dry') { dry = true; }
  else if (!logFile) { logFile = args[i]; }
}

if (!logFile) {
  console.log('Usage: node nmea-clean.js <logfile> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --events <file>   Events JSON (default: auto-detect from logfile name)');
  console.log('  --strict          Keep only polar-essential sentences (RMC,MWV,VHW,HDG,HDT,VTG,GGA)');
  console.log('  --output <file>   Output file (default: <logfile>_clean.log)');
  console.log('  --dry             Dry run — show stats only');
  process.exit(1);
}

if (!fs.existsSync(logFile)) { console.error('File not found:', logFile); process.exit(1); }

// Auto-detect events file
if (!eventsFile) {
  // Try: same name with .events.json
  var base = logFile.replace(/\.log$/, '');
  var candidates = [base + '.events.json', logFile + '.events.json'];
  for (var c = 0; c < candidates.length; c++) {
    if (fs.existsSync(candidates[c])) { eventsFile = candidates[c]; break; }
  }
}

if (!outputFile) {
  outputFile = logFile.replace(/\.log$/, '') + '_clean.log';
}

// ── Parse engine periods from events ──
var enginePeriods = [];  // [{from: Date, to: Date}]

if (eventsFile && fs.existsSync(eventsFile)) {
  console.log('Events file:', eventsFile);
  var evData = JSON.parse(fs.readFileSync(eventsFile, 'utf8'));
  var allEvents = [];
  if (evData.manualEvents) allEvents = allEvents.concat(evData.manualEvents);
  // Also check for auto-detected engine events if stored
  if (evData.events) allEvents = allEvents.concat(evData.events);

  // Find engine on/off events
  var engineOn = null;
  var motorPattern = /motor|engine/i;
  var startPattern = /start|aan|on|gestart/i;
  var stopPattern = /stop|uit|off|gestopt/i;

  // Sort by time
  allEvents.sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); });

  for (var e = 0; e < allEvents.length; e++) {
    var ev = allEvents[e];
    var isEngine = ev.type === 'engine' || motorPattern.test(ev.detail || '') || motorPattern.test(ev.note || '');
    if (!isEngine) continue;

    var detail = (ev.detail || '') + ' ' + (ev.note || '');
    if (startPattern.test(detail)) {
      engineOn = new Date(ev.time);
    } else if (stopPattern.test(detail) && engineOn) {
      enginePeriods.push({ from: engineOn, to: new Date(ev.time) });
      engineOn = null;
    }
  }
  // If engine is still on at end of events, extend to far future
  if (engineOn) {
    enginePeriods.push({ from: engineOn, to: new Date('2099-12-31') });
  }

  console.log('Engine periods found:', enginePeriods.length);
  enginePeriods.forEach(function (p, i) {
    var durMin = Math.round((p.to - p.from) / 60000);
    console.log('  ' + (i + 1) + '. ' + p.from.toISOString().substring(11, 19) + ' → ' +
      (p.to.getFullYear() > 2098 ? 'end of file' : p.to.toISOString().substring(11, 19)) +
      ' (' + durMin + ' min)');
  });
} else {
  console.log('No events file found — skipping engine period filtering');
}

// ── Essential sentences for polar building ──
var ESSENTIAL = ['RMC', 'MWV', 'VHW', 'VWR', 'HDG', 'HDT', 'HDM', 'VTG', 'GGA', 'GLL', 'GNS', 'XDR', 'RPM'];

function isEssential(line) {
  for (var i = 0; i < ESSENTIAL.length; i++) {
    if (line.indexOf(ESSENTIAL[i]) >= 0) return true;
  }
  return false;
}

// ── Process log file ──
console.log('\nProcessing:', logFile);
var lines = fs.readFileSync(logFile, 'utf8').split('\n');
var output = [];
var stats = {
  total: 0, kept: 0,
  removedAIS: 0, removedEngine: 0, removedNonEssential: 0, removedEmpty: 0
};

var currentTime = null;  // Current timestamp from RMC
var currentDate = null;  // Current date from RMC

for (var li = 0; li < lines.length; li++) {
  var line = lines[li].trim();
  stats.total++;

  // Skip empty
  if (!line) { stats.removedEmpty++; continue; }

  // Skip AIS
  if (line.charAt(0) === '!' || line.indexOf('AIVDM') >= 0 || line.indexOf('AIVDO') >= 0) {
    stats.removedAIS++;
    continue;
  }

  // Extract timestamp from RMC
  if (line.indexOf('RMC') >= 0) {
    var parts = line.split(',');
    if (parts.length >= 10) {
      var timeStr = parts[1];  // HHMMSS.SS
      var dateStr = parts[9];  // DDMMYY
      if (timeStr && dateStr && timeStr.length >= 6 && dateStr.length === 6) {
        var hh = parseInt(timeStr.substring(0, 2));
        var mm = parseInt(timeStr.substring(2, 4));
        var ss = parseFloat(timeStr.substring(4));
        var dd = parseInt(dateStr.substring(0, 2));
        var mo = parseInt(dateStr.substring(2, 4)) - 1;
        var yy = parseInt(dateStr.substring(4, 6)) + 2000;
        currentTime = new Date(Date.UTC(yy, mo, dd, hh, mm, Math.floor(ss)));
        currentDate = currentTime;
      }
    }
  }

  // Check if current time falls in an engine period
  if (currentTime && enginePeriods.length > 0) {
    var inEngine = false;
    for (var ep = 0; ep < enginePeriods.length; ep++) {
      if (currentTime >= enginePeriods[ep].from && currentTime <= enginePeriods[ep].to) {
        inEngine = true;
        break;
      }
    }
    if (inEngine) { stats.removedEngine++; continue; }
  }

  // Strict mode: only keep essential sentences
  if (strict && !isEssential(line)) {
    stats.removedNonEssential++;
    continue;
  }

  output.push(line);
  stats.kept++;
}

// ── Report ──
console.log('\n=== Results ===');
console.log('Total lines:        ' + stats.total);
console.log('Kept:               ' + stats.kept + ' (' + Math.round(100 * stats.kept / stats.total) + '%)');
console.log('Removed AIS:        ' + stats.removedAIS);
console.log('Removed engine:     ' + stats.removedEngine);
if (strict) console.log('Removed non-essential: ' + stats.removedNonEssential);
console.log('Removed empty:      ' + stats.removedEmpty);

if (dry) {
  console.log('\n(Dry run — no file written)');
} else {
  fs.writeFileSync(outputFile, output.join('\n') + '\n');
  var sizeKB = Math.round(fs.statSync(outputFile).size / 1024);
  console.log('\nWritten: ' + outputFile + ' (' + sizeKB + ' KB)');
}
