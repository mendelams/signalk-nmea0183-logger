# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                          # install dependencies
npm test                             # run all tests (Node.js 22+)
node --test test/parser.test.js      # run a single test file
```

No build step — the plugin runs directly from source.

## Architecture

This is a SignalK plugin that acts as a complete sailing logbook. SignalK calls `plugin.start()` / `plugin.stop()` / `plugin.schema()` — all three are defined at the bottom of `index.js`.

### `index.js` (~2958 lines)
The monolith: plugin lifecycle, in-memory state, HTTP server (default port 3033), and all API route handlers. Also contains the full bilingual translation table (`LANG`) and SignalK delta publishing. The schema object at the end drives the SignalK Admin config UI.

Key state managed here:
- Three-layer stats cache: memory LRU → disk `.stats.json` → live parse
- AIS vessel throttle map (per-MMSI timestamp)
- Engine/fuel/maintenance state loaded from `engine.json`
- Live electrical and SignalK path subscriptions

### `lib/parser.js`
Heavy compute. `parseLogFile(filePath, opts)` reads a raw `.log` or `.log.gz` file line-by-line, dispatches each NMEA sentence to its handler, and returns a stats object with: track array, wind/depth/speed arrays, AIS vessel map, engine periods, and events list.

Exports `parseLatLon`, `haversineNm`, and `strip` — these are tested directly.

### `lib/events.js`
Three reusable signal detector classes used by `parser.js` during log parsing:
- `SmoothedChangeDetector` — fires when a smoothed value drifts from its baseline (wind shifts, course changes). Supports circular mean for angles.
- `StateToggleDetector` — fires on boolean transitions (engine on/off, anchor detected).
- `LevelCrossingDetector` — fires when a value crosses a threshold (battery low/recover).

All share the same `.feed(value, timestamp)` interface returning an event object or `null`.

### `lib/export.js`
`toGPX(stats, opts)` and `toCSV(stats, opts)` take a stats object (from `parseLogFile`) and return XML/CSV strings. Supports single-day and multi-day (voyage) data. AIS vessel tracks are optional in GPX output.

### `lib/weather.js`
Fetches hourly weather from Open-Meteo for a given GPS bounding box. Called once per log on demand; result cached to `nmea0183_YYYY-MM-DD.weather.json`.

### `lib/constants.js`
All named constants — cache sizes, timeouts, unit conversions, sentence type descriptions. Import as `const C = require('./lib/constants')`.

### `lib/checksum.js`
`validateChecksum(sentence)` and `generateChecksum(sentence)` — pure XOR NMEA checksum logic.

### `public/`
Single-page PWA. `app.js` is the full frontend (one large file, no bundler). `sw.js` caches the shell for offline use. `parse-worker.js` offloads heavy log parsing to a Web Worker when called from the UI.

## Data storage

All persistent data lives in `~/.signalk/plugin-config-data/signalk-nmea0183-logger/nmea0183-logs/`:

| File pattern | Content |
|---|---|
| `nmea0183_YYYY-MM-DD.log` | Raw NMEA sentences with ISO timestamps |
| `nmea0183_YYYY-MM-DD.log.gz` | Compressed after `compressAfterDays` |
| `nmea0183_YYYY-MM-DD.stats.json` | Disk cache of parsed stats |
| `nmea0183_YYYY-MM-DD.events.json` | Manual events and day notes |
| `voyages.json` | Voyage definitions |
| `engine.json` | Engine hours, fuel entries, maintenance records |
| `crew.json` | Crew list |

## Adding a new NMEA sentence type

1. Add the type key + human label to `SENTENCE_TYPES` in `lib/constants.js`.
2. Add a sentence group or extend an existing one in `plugin.schema()` at the bottom of `index.js` — this makes it appear in the config UI.
3. Add a handler in `parser.js` inside `parseLogFile` — the dispatch is a large `if/else if` block keyed on `sentenceType`.
4. Add fixtures and assertions to `test/parser.test.js`.

## Adding a new auto-event detector

Instantiate one of the three classes from `lib/events.js` at the top of `parseLogFile`, call `.feed(value, timestamp)` from the appropriate sentence handler, and push non-null returns into the events array. Configure thresholds from the `opts` object passed into `parseLogFile`.
