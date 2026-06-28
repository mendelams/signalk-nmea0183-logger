'use strict';
const { describe, it } = require('node:test');
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
    // Create a temp file with one good and one corrupted sentence
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
