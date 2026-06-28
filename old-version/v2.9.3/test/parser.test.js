'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { validateChecksum, generateChecksum } = require('../lib/checksum');
const { parseLogFile, parseLatLon, haversineNm, strip } = require('../lib/parser');

const FIXTURE = path.join(__dirname, 'fixtures', 'nmea0183_test_comprehensive.log');
const t = (k, ...a) => { let s = k; a.forEach((v, i) => { s = s.replace(`{${i}}`, v); }); return s; };

// ── Checksum tests ───────────────────────────────────────────────

describe('Checksum', () => {
  it('validates a correct checksum', () => {
    const s = generateChecksum('$GPRMC,080000,A,5257.4681,N,00445.5350,E,5.2,185.0,010326,,,A');
    assert.strictEqual(validateChecksum(s), true);
  });

  it('rejects an incorrect checksum', () => {
    assert.strictEqual(validateChecksum('$GPRMC,080000,A,5257.4681,N,00445.5350,E,5.2,185.0,010326,,,A*FF'), false);
  });

  it('rejects a sentence without checksum', () => {
    assert.strictEqual(validateChecksum('$GPRMC,080000,A'), false);
  });

  it('generates and validates roundtrip', () => {
    const sentences = [
      '$IIDBT,15.2,f,4.6,M,2.5,F',
      '$IIHDG,340.1,,,1.2,E',
      '$IIMWV,85.3,T,14.2,N,A',
      '$IIRPM,E,1,2200,,A',
      '$GPXTE,A,A,0.041,L,N,A',
      '$SKAIS,244650001,5300.0000,N,00500.0000,E,12.5,350.0'
    ];
    for (const s of sentences) {
      const withCS = generateChecksum(s);
      assert.strictEqual(validateChecksum(withCS), true, `Failed: ${withCS}`);
    }
  });
});

// ── Parsing helper tests ─────────────────────────────────────────

describe('Parsing helpers', () => {
  it('parses valid lat/lon', () => {
    const pos = parseLatLon('5257.4681', 'N', '00445.5350', 'E');
    assert.ok(pos);
    assert.ok(Math.abs(pos.lat - 52.9578) < 0.001);
    assert.ok(Math.abs(pos.lon - 4.7589) < 0.001);
  });

  it('rejects 0,0 position', () => {
    assert.strictEqual(parseLatLon('0000.0000', 'N', '00000.0000', 'E'), null);
  });

  it('rejects invalid lat', () => {
    assert.strictEqual(parseLatLon('9999.9999', 'N', '00445.5350', 'E'), null);
  });

  it('calculates haversine distance', () => {
    // Den Helder to Oudeschild ~5nm
    const d = haversineNm(52.9645, 4.7890, 53.0435, 4.8520);
    assert.ok(d > 4 && d < 6, `Expected ~5nm, got ${d}`);
  });

  it('strips checksum from field', () => {
    assert.strictEqual(strip('A*72'), 'A');
    assert.strictEqual(strip(''), '');
    assert.strictEqual(strip(null), '');
  });
});

// ── Parser integration tests ─────────────────────────────────────

describe('Parser', () => {
  let stats;

  it('parses the comprehensive test log', () => {
    stats = parseLogFile(FIXTURE, {}, t, { includeAIS: true });
    assert.ok(stats);
    assert.strictEqual(stats.totalLines, 9038);
  });

  it('detects all sentence types', () => {
    const expected = ['RMC', 'GGA', 'VTG', 'GSA', 'HDG', 'RSA', 'MWV', 'DBT', 'XDR', 'RPM', 'MTA', 'MTW', 'MDA', 'VHW', 'XTE', 'APB', 'VDM', 'VDO', 'DSC'];
    for (const st of expected) {
      assert.ok(stats.sentenceTypes.includes(st), `Missing sentence type: ${st}`);
    }
  });

  it('calculates correct distance', () => {
    assert.ok(stats.totalDistanceNm > 10 && stats.totalDistanceNm < 13,
      `Expected ~11.5nm, got ${stats.totalDistanceNm}`);
  });

  it('has valid time range', () => {
    assert.ok(stats.startTime);
    assert.ok(stats.endTime);
    assert.ok(stats.durationHours > 6 && stats.durationHours < 8);
  });

  it('calculates wind stats', () => {
    assert.ok(stats.twsAvgKn > 10 && stats.twsAvgKn < 25);
    assert.ok(stats.twsMaxKn > 20);
    assert.ok(stats.twaSamples > 0);
  });

  it('calculates depth stats', () => {
    assert.ok(stats.depthMinM > 1 && stats.depthMinM < 3, `Min depth: ${stats.depthMinM}`);
    assert.ok(stats.depthMaxM > 25 && stats.depthMaxM < 30);
    assert.ok(stats.depthSamples > 500);
  });

  it('detects shallowest point with position', () => {
    assert.ok(stats.shallowest);
    assert.ok(stats.shallowest.depth < 3);
    assert.ok(stats.shallowest.lat);
    assert.ok(stats.shallowest.lon);
  });

  it('detects autopilot segments', () => {
    assert.ok(stats.apSegments);
    assert.strictEqual(stats.apSegments.length, 2);
  });

  it('calculates rudder and XTE stats', () => {
    assert.ok(stats.rsaSamples > 0);
    assert.ok(stats.xteSamples > 0);
    assert.ok(stats.rsaMaxDeg > 0);
    assert.ok(stats.xteMaxNm > 0);
  });

  it('detects DSC calls', () => {
    assert.ok(stats.dscCalls);
    assert.strictEqual(stats.dscCalls.length, 4);
    const distress = stats.dscCalls.find(d => d.category === 'distress');
    assert.ok(distress, 'Missing distress call');
    assert.ok(distress.lat, 'Distress call missing position');
    assert.strictEqual(distress.nature, 'fire');
  });

  it('detects AIS vessels', () => {
    assert.ok(stats.aisVessels);
    const mmsis = Object.keys(stats.aisVessels);
    assert.ok(mmsis.length >= 2);
  });

  it('detects engine events', () => {
    const engineEvents = stats.events.filter(e => e.type === 'engine');
    assert.ok(engineEvents.length > 0, 'No engine events detected');
  });

  it('detects GPS void fixes', () => {
    assert.ok(stats.gpsQuality);
    assert.ok(stats.gpsQuality.invalid > 0, 'Expected some invalid GPS fixes');
    assert.ok(stats.gpsQuality.pct < 5, 'GPS quality should be mostly good');
  });

  it('has zero checksum failures on valid data', () => {
    assert.strictEqual(stats.checksumFails, 0);
  });

  it('downsamples track for display', () => {
    const displayStats = parseLogFile(FIXTURE, {}, t, {});
    assert.ok(displayStats.track.length <= 2000);
    // Full track should be larger
    const fullStats = parseLogFile(FIXTURE, {}, t, { fullTrack: true });
    assert.ok(fullStats.track.length >= displayStats.track.length);
  });
});

// ── Checksum rejection test ──────────────────────────────────────

describe('Checksum rejection', () => {
  it('rejects corrupted sentences', () => {
    const tmpFile = path.join(__dirname, 'fixtures', '_tmp_corrupt.log');
    const good = generateChecksum('$GPRMC,080000,A,5257.4681,N,00445.5350,E,5.2,185.0,010326,,,A');
    const bad = '$GPRMC,080030,A,5257.5000,N,00445.5000,E,5.0,184.0,010326,,,A*FF';
    fs.writeFileSync(tmpFile, `2026-03-01T08:00:00.000Z ${good}\n2026-03-01T08:00:30.000Z ${bad}\n`);
    try {
      const stats = parseLogFile(tmpFile, {}, t, {});
      assert.strictEqual(stats.checksumFails, 1, 'Should detect 1 checksum failure');
      assert.strictEqual(stats.sogSamples, 1, 'Should only parse 1 valid RMC');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

// ── Fuel segments test ───────────────────────────────────────────

describe('Fuel segments', () => {
  let stats;
  before(() => {
    stats = parseLogFile(FIXTURE, { evEngineEnabled: true, evEngineRpmThreshold: 100 }, t, {});
  });

  it('calculates motor vs sail distance', () => {
    if (!stats.fuelSegments) return; // Only when engine periods detected
    const fs = stats.fuelSegments;
    assert.ok(fs.motorDistNm >= 0, 'Motor distance should be >= 0');
    assert.ok(fs.sailDistNm >= 0, 'Sail distance should be >= 0');
    assert.ok(fs.motorPct >= 0 && fs.motorPct <= 100, 'Motor % should be 0-100');
    // Motor + sail should roughly equal total distance
    const total = fs.motorDistNm + fs.sailDistNm;
    assert.ok(Math.abs(total - stats.totalDistanceNm) < 1,
      `Motor (${fs.motorDistNm}) + sail (${fs.sailDistNm}) should ≈ total (${stats.totalDistanceNm})`);
  });
});

// ── Checksum edge cases ──────────────────────────────────────────

describe('Checksum edge cases', () => {
  it('validates empty payload', () => {
    assert.strictEqual(validateChecksum(''), false);
    // $*00 is technically valid (XOR of empty = 0x00) but useless
    assert.strictEqual(validateChecksum('$*00'), true);
  });

  it('validates sentence with no star', () => {
    assert.strictEqual(validateChecksum('$GPRMC,no,checksum,here'), false);
  });

  it('validates sentence with truncated checksum', () => {
    assert.strictEqual(validateChecksum('$GPRMC,data*F'), false);
  });

  it('handles AIS sentences (should skip checksum in parser)', () => {
    // AIS has its own CRC — parser should not checksum-validate these
    const tmpFile = path.join(__dirname, 'fixtures', '_tmp_ais.log');
    const rmc = generateChecksum('$GPRMC,120000,A,5257.4681,N,00445.5350,E,5.2,185.0,010326,,,A');
    // AIS sentence (starts with !) — no XOR checksum check
    const ais = '!AIVDM,1,1,,B,15N4cJ`005Jrek0H@9n`DW5608EP,0*13';
    fs.writeFileSync(tmpFile, `2026-03-01T12:00:00.000Z ${rmc}\n2026-03-01T12:00:05.000Z ${ais}\n`);
    try {
      const stats = parseLogFile(tmpFile, {}, t, { includeAIS: true });
      assert.strictEqual(stats.checksumFails, 0, 'AIS should not count as checksum failure');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

// ── Empty/minimal log test ───────────────────────────────────────

describe('Edge cases', () => {
  it('handles empty log file', () => {
    const tmpFile = path.join(__dirname, 'fixtures', '_tmp_empty.log');
    fs.writeFileSync(tmpFile, '');
    try {
      const stats = parseLogFile(tmpFile, {}, t, {});
      assert.strictEqual(stats.totalLines, 0);
      assert.strictEqual(stats.track.length, 0);
      assert.strictEqual(stats.checksumFails, 0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('handles log with only timestamps (no NMEA)', () => {
    const tmpFile = path.join(__dirname, 'fixtures', '_tmp_nodata.log');
    fs.writeFileSync(tmpFile, '2026-03-01T08:00:00.000Z some random text\n2026-03-01T08:00:01.000Z more text\n');
    try {
      const stats = parseLogFile(tmpFile, {}, t, {});
      assert.strictEqual(stats.totalLines, 2);
      assert.strictEqual(stats.track.length, 0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('handles single valid sentence', () => {
    const tmpFile = path.join(__dirname, 'fixtures', '_tmp_single.log');
    const rmc = generateChecksum('$GPRMC,120000,A,5257.4681,N,00445.5350,E,5.2,185.0,010326,,,A');
    fs.writeFileSync(tmpFile, `2026-03-01T12:00:00.000Z ${rmc}\n`);
    try {
      const stats = parseLogFile(tmpFile, {}, t, {});
      assert.strictEqual(stats.totalLines, 1);
      assert.strictEqual(stats.track.length, 1);
      assert.ok(stats.track[0].lat > 52 && stats.track[0].lat < 53);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

// ── Auto-detection tests ─────────────────────────────────────────

describe('Auto-detection', () => {
  // Helper to write a synthetic log file
  function writeSyntheticLog(name, sentences) {
    const tmpFile = path.join(__dirname, 'fixtures', '_tmp_' + name + '.log');
    fs.writeFileSync(tmpFile, sentences.join('\n') + '\n');
    return tmpFile;
  }

  it('detects anchor event for stationary period', () => {
    // Synthesize: 35 minutes at fixed position with very low SOG, then movement
    const lines = [];
    const baseTime = new Date('2026-04-01T08:00:00Z');
    for (let m = 0; m < 35; m++) {
      const ts = new Date(baseTime.getTime() + m * 60000).toISOString();
      const tm = ts.substring(11, 13) + ts.substring(14, 16) + ts.substring(17, 19);
      // Stationary at 52.96N 4.78E with 0.1 kn drift
      const s = generateChecksum(`$GPRMC,${tm},A,5257.6000,N,00446.8000,E,0.1,090.0,010426,,,A`);
      lines.push(`${ts} ${s}`);
    }
    // After: movement (5 kn)
    for (let m = 35; m < 40; m++) {
      const ts = new Date(baseTime.getTime() + m * 60000).toISOString();
      const tm = ts.substring(11, 13) + ts.substring(14, 16) + ts.substring(17, 19);
      const lon = (446.8000 + (m - 35) * 0.5).toFixed(4);
      const s = generateChecksum(`$GPRMC,${tm},A,5257.6000,N,00${lon},E,5.0,090.0,010426,,,A`);
      lines.push(`${ts} ${s}`);
    }
    const tmpFile = writeSyntheticLog('anchor', lines);
    try {
      const stats = parseLogFile(tmpFile, {}, t, {});
      const anchorEvents = stats.events.filter(e => e.type === 'anchor');
      assert.ok(anchorEvents.length >= 1, 'Should detect at least one anchor event');
      assert.ok(anchorEvents.some(e => e.lat && e.lon), 'Anchor event should include position');
    } finally { fs.unlinkSync(tmpFile); }
  });

  it('does NOT detect anchor for short stops', () => {
    // 10 minutes stationary - too short for anchor
    const lines = [];
    const baseTime = new Date('2026-04-01T08:00:00Z');
    for (let m = 0; m < 10; m++) {
      const ts = new Date(baseTime.getTime() + m * 60000).toISOString();
      const tm = ts.substring(11, 13) + ts.substring(14, 16) + ts.substring(17, 19);
      const s = generateChecksum(`$GPRMC,${tm},A,5257.6000,N,00446.8000,E,0.1,090.0,010426,,,A`);
      lines.push(`${ts} ${s}`);
    }
    for (let m = 10; m < 15; m++) {
      const ts = new Date(baseTime.getTime() + m * 60000).toISOString();
      const tm = ts.substring(11, 13) + ts.substring(14, 16) + ts.substring(17, 19);
      const lon = (446.8000 + (m - 10) * 0.5).toFixed(4);
      const s = generateChecksum(`$GPRMC,${tm},A,5257.6000,N,00${lon},E,5.0,090.0,010426,,,A`);
      lines.push(`${ts} ${s}`);
    }
    const tmpFile = writeSyntheticLog('shortstop', lines);
    try {
      const stats = parseLogFile(tmpFile, {}, t, {});
      const anchorEvents = stats.events.filter(e => e.type === 'anchor');
      assert.strictEqual(anchorEvents.length, 0, 'Short stops should not generate anchor events');
    } finally { fs.unlinkSync(tmpFile); }
  });

  it('detects harbor departure when starting near a known harbor', () => {
    // Start at Den Helder, move away
    const lines = [];
    const baseTime = new Date('2026-04-01T08:00:00Z');
    for (let m = 0; m < 30; m++) {
      const ts = new Date(baseTime.getTime() + m * 60000).toISOString();
      const tm = ts.substring(11, 13) + ts.substring(14, 16) + ts.substring(17, 19);
      // Start at Den Helder (52.9645, 4.7600), move N at 5kn
      const lat = (5257.870 + m * 0.5).toFixed(4);
      const s = generateChecksum(`$GPRMC,${tm},A,${lat},N,00445.6000,E,5.0,000.0,010426,,,A`);
      lines.push(`${ts} ${s}`);
    }
    const tmpFile = writeSyntheticLog('harbor_dep', lines);
    try {
      const harbors = [{ name: 'Den Helder', lat: 52.9645, lon: 4.7600 }];
      const stats = parseLogFile(tmpFile, {}, t, { harbors });
      const harborEvents = stats.events.filter(e => e.type === 'harbor');
      assert.ok(harborEvents.length >= 1, 'Should detect harbor departure');
      assert.ok(harborEvents[0].lat && harborEvents[0].lon, 'Event should include position');
    } finally { fs.unlinkSync(tmpFile); }
  });

  it('respects evAnchorEnabled=false config', () => {
    const lines = [];
    const baseTime = new Date('2026-04-01T08:00:00Z');
    for (let m = 0; m < 35; m++) {
      const ts = new Date(baseTime.getTime() + m * 60000).toISOString();
      const tm = ts.substring(11, 13) + ts.substring(14, 16) + ts.substring(17, 19);
      const s = generateChecksum(`$GPRMC,${tm},A,5257.6000,N,00446.8000,E,0.1,090.0,010426,,,A`);
      lines.push(`${ts} ${s}`);
    }
    const tmpFile = writeSyntheticLog('anchor_disabled', lines);
    try {
      const stats = parseLogFile(tmpFile, { evAnchorEnabled: false }, t, {});
      const anchorEvents = stats.events.filter(e => e.type === 'anchor');
      assert.strictEqual(anchorEvents.length, 0, 'Disabled detector should produce no events');
    } finally { fs.unlinkSync(tmpFile); }
  });
});
