'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function (app) {
  const plugin = {};
  plugin.id = 'signalk-nmea0183-logger';
  plugin.name = 'NMEA0183 Sentence Logger';
  plugin.description = 'Logs NMEA0183 sentences (including AIS) to daily log files with per-sentence-type filtering. Includes a web-based log viewer.';

  let unsubscribe = null;
  let currentLogDate = null;
  let currentWriteStream = null;
  let logDir = null;
  let config = {};
  let sentenceStats = {};
  let statusInterval = null;

  const SENTENCE_TYPES = {
    GGA: 'GPS Fix Data', GLL: 'Geographic Position (Lat/Lon)',
    RMC: 'Recommended Minimum Navigation', RMB: 'Recommended Minimum Navigation (to waypoint)',
    VTG: 'Track Made Good and Ground Speed', GSA: 'GPS DOP and Active Satellites',
    GSV: 'GPS Satellites in View', ZDA: 'Time and Date', GNS: 'GNSS Fix Data',
    HDG: 'Heading, Deviation, Variation', HDM: 'Heading Magnetic', HDT: 'Heading True',
    MWV: 'Wind Speed and Angle', MWD: 'Wind Direction and Speed', VWR: 'Relative Wind Speed and Angle',
    DBT: 'Depth Below Transducer', DBS: 'Depth Below Surface', DBK: 'Depth Below Keel', DPT: 'Depth of Water',
    VHW: 'Water Speed and Heading',
    APB: 'Autopilot Sentence B', BOD: 'Bearing Origin to Destination',
    BWC: 'Bearing and Distance to Waypoint', BWR: 'Bearing and Distance to Waypoint (Rhumb Line)',
    RTE: 'Routes', WPL: 'Waypoint Location', XTE: 'Cross Track Error', XDR: 'Transducer Measurement',
    RSA: 'Rudder Sensor Angle', RPM: 'Revolutions',
    MTW: 'Mean Temperature of Water', MTA: 'Air Temperature', MMB: 'Barometer', MDA: 'Meteorological Composite',
    VDM: 'AIS VHF Data-Link Message', VDO: 'AIS VHF Data-Link Own-Vessel',
    TXT: 'Text Transmission', TTM: 'Tracked Target Message', TLL: 'Target Latitude and Longitude'
  };

  function getDateString() { return new Date().toISOString().split('T')[0]; }
  function getTimestamp() { return new Date().toISOString(); }

  function extractSentenceType(sentence) {
    if (!sentence || sentence.length < 6) return 'UNKNOWN';
    const match = sentence.trim().match(/^[!$]([A-Z]{2})([A-Z]{2,4})/);
    return match ? match[2] : 'UNKNOWN';
  }

  function extractFullId(sentence) {
    if (!sentence || sentence.length < 6) return 'UNKNOWN';
    const match = sentence.trim().match(/^[!$]([A-Z]{2,5})/);
    return match ? match[1] : 'UNKNOWN';
  }

  function shouldLog(sentenceType) {
    if (config.logAllSentences) return true;
    if (config[`log_${sentenceType}`] === true) return true;
    if (config.logUnknownSentences && !(sentenceType in SENTENCE_TYPES)) return true;
    return false;
  }

  function getWriteStream() {
    const today = getDateString();
    if (currentLogDate === today && currentWriteStream) return currentWriteStream;
    if (currentWriteStream) { currentWriteStream.end(); currentWriteStream = null; }
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const filepath = path.join(logDir, `nmea0183_${today}.log`);
    currentWriteStream = fs.createWriteStream(filepath, { flags: 'a' });
    currentLogDate = today;
    currentWriteStream.on('error', (err) => { app.error(`Log write error: ${err.message}`); currentWriteStream = null; });
    app.debug(`Logging to: ${filepath}`);
    return currentWriteStream;
  }

  function handleSentence(sentence) {
    if (!sentence || typeof sentence !== 'string') return;
    const sentenceType = extractSentenceType(sentence);
    const fullId = extractFullId(sentence);
    sentenceStats[fullId] = (sentenceStats[fullId] || 0) + 1;
    if (!shouldLog(sentenceType)) return;
    const stream = getWriteStream();
    if (!stream) return;
    stream.write(config.includeTimestamp ? `${getTimestamp()} ${sentence.trim()}\n` : `${sentence.trim()}\n`);
  }

  function updateStatus() {
    const entries = Object.entries(sentenceStats).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) { app.setPluginStatus('Listening... no sentences received yet.'); return; }
    const summary = entries.map(([t, c]) => `${t}: ${c}`).join(', ');
    app.setPluginStatus(`Logging to ${currentLogDate || '(starting)'}. Sentences: ${summary}`);
  }

  // ── Plugin lifecycle ────────────────────────────────────────────────

  plugin.start = function (options) {
    config = options || {};
    sentenceStats = {};
    logDir = config.logDirectory || path.join(app.getDataDirPath(), 'nmea0183-logs');
    app.debug(`NMEA0183 Logger starting. Log directory: ${logDir}`);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    app.on('nmea0183', handleSentence);
    unsubscribe = () => app.removeListener('nmea0183', handleSentence);

    statusInterval = setInterval(updateStatus, 10000);
    updateStatus();
    app.setPluginStatus('Started. Waiting for NMEA0183 data...');
  };

  plugin.stop = function () {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
    if (currentWriteStream) { currentWriteStream.end(); currentWriteStream = null; currentLogDate = null; }
    sentenceStats = {};
    app.setPluginStatus('Stopped.');
  };

  // ── API routes ──────────────────────────────────────────────────────

  plugin.registerWithRouter = function (router) {

    // List log files
    router.get('/api/logs', (req, res) => {
      if (!logDir || !fs.existsSync(logDir)) return res.json([]);
      try {
        const files = fs.readdirSync(logDir)
          .filter(f => f.startsWith('nmea0183_') && f.endsWith('.log'))
          .sort().reverse()
          .map(f => {
            const s = fs.statSync(path.join(logDir, f));
            return { name: f, size: s.size, modified: s.mtime.toISOString(), date: f.replace('nmea0183_', '').replace('.log', '') };
          });
        res.json(files);
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Get log file content (with optional tail and filter)
    router.get('/api/logs/:filename', (req, res) => {
      const filename = path.basename(req.params.filename);
      if (!filename.startsWith('nmea0183_') || !filename.endsWith('.log')) return res.status(400).json({ error: 'Invalid filename' });
      const filepath = path.join(logDir, filename);
      if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });

      const lines = parseInt(req.query.lines) || 0;
      const filter = req.query.filter || '';
      try {
        const content = fs.readFileSync(filepath, 'utf8');
        let allLines = content.split('\n').filter(l => l.trim());
        const totalLines = allLines.length;
        if (filter) { const fu = filter.toUpperCase(); allLines = allLines.filter(l => l.toUpperCase().includes(fu)); }
        if (lines > 0) allLines = allLines.slice(-lines);
        res.json({ filename, totalLines, returnedLines: allLines.length, filter: filter || null, lines: allLines });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Download raw log file
    router.get('/api/logs/:filename/download', (req, res) => {
      const filename = path.basename(req.params.filename);
      if (!filename.startsWith('nmea0183_') || !filename.endsWith('.log')) return res.status(400).json({ error: 'Invalid filename' });
      const filepath = path.join(logDir, filename);
      if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
      res.download(filepath, filename);
    });

    // Delete a log file
    router.delete('/api/logs/:filename', (req, res) => {
      const filename = path.basename(req.params.filename);
      if (!filename.startsWith('nmea0183_') || !filename.endsWith('.log')) return res.status(400).json({ error: 'Invalid filename' });
      const filepath = path.join(logDir, filename);
      if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
      try { fs.unlinkSync(filepath); res.json({ deleted: filename }); }
      catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Current stats
    router.get('/api/stats', (req, res) => {
      res.json({ logDirectory: logDir, currentLogFile: currentLogDate ? `nmea0183_${currentLogDate}.log` : null, sentenceStats });
    });
  };

  plugin.getOpenApi = () => ({});

  // ── Configuration schema ────────────────────────────────────────────

  plugin.schema = function () {
    const sp = {};
    const navTypes = ['GGA','GLL','RMC','RMB','VTG','GSA','GSV','ZDA','GNS'];
    const compassTypes = ['HDG','HDM','HDT'];
    const windTypes = ['MWV','MWD','VWR'];
    const depthTypes = ['DBT','DBS','DBK','DPT'];
    const speedTypes = ['VHW'];
    const waypointTypes = ['APB','BOD','BWC','BWR','RTE','WPL','XTE','XDR'];
    const autopilotTypes = ['RSA','RPM'];
    const envTypes = ['MTW','MTA','MMB','MDA'];
    const aisTypes = ['VDM','VDO'];
    const miscTypes = ['TXT','TTM','TLL'];

    function addGroup(types) {
      types.forEach(t => { sp[`log_${t}`] = { type: 'boolean', title: `${t} – ${SENTENCE_TYPES[t]}`, default: true }; });
    }
    [navTypes,compassTypes,windTypes,depthTypes,speedTypes,waypointTypes,autopilotTypes,envTypes,aisTypes,miscTypes].forEach(addGroup);

    function header(title) { return { type: 'string', title, description: ' ', default: ' ' }; }
    function entries(types) { return Object.fromEntries(types.map(t => [`log_${t}`, sp[`log_${t}`]])); }

    return {
      type: 'object',
      title: 'NMEA0183 Sentence Logger',
      description: 'Configure which NMEA0183 sentence types to log. View logs via Webapps menu.',
      properties: {
        logDirectory: { type: 'string', title: 'Log Directory', description: 'Leave empty for default.', default: '' },
        includeTimestamp: { type: 'boolean', title: 'Include ISO Timestamp', description: 'Prepend each line with a timestamp.', default: true },
        logAllSentences: { type: 'boolean', title: 'Log ALL Sentences (override)', description: 'Log everything regardless of checkboxes.', default: false },
        logUnknownSentences: { type: 'boolean', title: 'Log Unknown / Other Sentence Types', default: true },
        _h1: header('── Navigation ──────────────────────────'), ...entries(navTypes),
        _h2: header('── Compass / Heading ───────────────────'), ...entries(compassTypes),
        _h3: header('── Wind ────────────────────────────────'), ...entries(windTypes),
        _h4: header('── Depth ───────────────────────────────'), ...entries(depthTypes),
        _h5: header('── Speed ───────────────────────────────'), ...entries(speedTypes),
        _h6: header('── Waypoint / Route / Autopilot ────────'), ...entries([...waypointTypes,...autopilotTypes]),
        _h7: header('── Environment ─────────────────────────'), ...entries(envTypes),
        _h8: header('── AIS ─────────────────────────────────'), ...entries(aisTypes),
        _h9: header('── Miscellaneous ───────────────────────'), ...entries(miscTypes)
      }
    };
  };

  return plugin;
};
