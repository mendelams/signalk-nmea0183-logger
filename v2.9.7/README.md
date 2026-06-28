# signalk-nmea0183-logger

**NMEA0183 sentence logger for SignalK** with GPS tracking, event detection, AIS, DSC, weather, engine/fuel/maintenance monitoring, crew management, and electrical monitoring.

A complete sailing logbook as a SignalK plugin — runs on Raspberry Pi, accessible as a mobile-first PWA.

## Features

### Navigation & tracking
- Raw NMEA0183 sentence logging with timestamps
- GPS track with SOG/COG, distance, duration
- Track visualization on Leaflet/OpenSeaMap
- Depth tracking with shallowest point marker
- Autopilot segment detection (heading, rudder angle, XTE)
- GPS quality monitoring with checksum validation

### Wind & weather
- True/apparent wind speed and angle tracking
- Automated weather & sea state via Open-Meteo API (per-hour at GPS position)
- Measured vs forecast comparison (Δ)

### Engine & fuel
- Engine start/stop detection with duration tracking
- Fuel log with cost tracking (€/L, total cost per fill)
- Average consumption calculation (full-tank-to-full-tank)
- Range estimation based on current tank level (SignalK sensor)
- **Motor vs sailing distance** — per-trip breakdown of distance under motor vs sail
- Fuel consumption per nautical mile (L/nm)

### Maintenance
- Configurable maintenance schedule (hours-based and month-based intervals)
- Progress bars with OK/Due/Overdue status
- 24 maintenance categories in 6 groups (engine, rig, hull, safety, electrical, other)
- Full CRUD for maintenance records and fuel entries

### Crew
- Crew list with name, role (skipper/mate/crew/guest), certificates
- Date-range per member (from/to)
- Crew shown in day reports

### Electrical
- Live battery voltage, current, SOC from SignalK
- Two-bank support (house + start battery)
- Charger/alternator/solar current monitoring
- Daily Ah consumed (trapezoidal integration)

### Events & logging
- Automatic event detection: course changes, wind shifts, engine on/off, battery low
- **Anchor detection** — automatic event when stationary >30 min within 50m radius at <0.5kn
- **Harbor arrival/departure** — automatic event when start/end position matches a known harbor (built-in NL/BE/DE/UK database, user can override)
- **Suspect sail reduction** — flags moments where SOG dropped >30% while wind stayed constant (likely sail change)
- Manual event logging: hazards, sightings, VHF, notes
- DSC call logging (distress/urgency/safety/routine) with position
- Day notes and voyage notes with dirty-state save
- Edit and delete for all events and notes

### Voyages
- Group log files into voyages
- Combined statistics across days
- Per-day breakdown with best distance/speed highlights
- Voyage GPX/CSV export

### Reporting
- **Automatic day report** — markdown summary with route, conditions, engine, events, crew
- Season overview with totals (days, distance, engine hours)
- Sentence coverage display

### AIS
- AIS vessel tracking (VDM/VDO)
- Hybrid AIS: raw NMEA0183 + SignalK vessels (for NMEA2000 boats via `$SKAIS`)
- Per-vessel throttling to reduce log size
- GPX export with AIS tracks

### Input modes
- **NMEA0183 direct** — raw sentences from TCP/serial/UDP
- **SignalK universal** — subscribe to SignalK paths, generate NMEA sentences (for N2K-only setups)

### Technical
- Mobile-first PWA with offline support (Service Worker)
- Light/dark theme (high contrast for direct sunlight)
- Three-layer stats cache (memory → disk → parse)
- NMEA XOR checksum validation
- Print-optimized CSS for paper logbooks
- SignalK notification publishing (events → `notifications.plugins.nmea0183-logger.*`)
- Trip stats publishing to SignalK data model
- Public API on configurable port + authenticated SignalK router API
- Bilingual: English + Nederlands

## Installation

### Via SignalK Appstore
Search for `signalk-nmea0183-logger` in the SignalK Appstore.

### Via npm
```bash
cd ~/.signalk
npm install signalk-nmea0183-logger
sudo systemctl restart signalk
```

### Manual
```bash
cd ~/.signalk/node_modules
git clone https://github.com/TinkerSailor/signalk-nmea0183-logger.git
cd signalk-nmea0183-logger
npm install
sudo systemctl restart signalk
```

## Configuration

Enable the plugin in SignalK Admin → Plugin Config → NMEA0183 Sentence Logger.

Key settings:
- **Input source**: NMEA0183 (direct) or SignalK (universal)
- **API port**: Public API port (default: 3033)
- **Language**: English or Nederlands
- **Sentence filter**: Choose which NMEA sentence types to log

Access the web UI at `http://your-pi:3033`.

## File structure

```
signalk-nmea0183-logger/
├── index.js              Plugin lifecycle, HTTP server, APIs
├── package.json
├── lib/
│   ├── checksum.js       NMEA XOR checksum validation
│   ├── constants.js      Named constants (no magic numbers)
│   ├── parser.js         NMEA sentence parser + stats
│   ├── events.js         Event detectors (course, wind, engine, battery)
│   ├── export.js         GPX + CSV export generators
│   └── weather.js        Open-Meteo weather API
├── public/
│   ├── app.html          HTML shell (38 lines)
│   ├── app.css           All styling + themes
│   ├── app.js            Frontend application
│   └── sw.js             Service worker for offline
└── test/
    ├── parser.test.js    25 unit tests
    └── fixtures/
```

## Data storage

All data is stored in `~/.signalk/plugin-config-data/signalk-nmea0183-logger/nmea0183-logs/`:

| File | Content |
|---|---|
| `nmea0183_YYYY-MM-DD.log` | Raw NMEA sentences with timestamps |
| `nmea0183_YYYY-MM-DD.log.gz` | Compressed older logs |
| `nmea0183_YYYY-MM-DD.stats.json` | Cached parse results |
| `nmea0183_YYYY-MM-DD.events.json` | Manual events and notes |
| `voyages.json` | Voyage definitions |
| `engine.json` | Engine, fuel, maintenance data |
| `crew.json` | Crew list |
| `harbors.json` | Harbor database (optional override; uses built-in defaults if absent) |

## API

### Public API (port 3033, no auth)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/stats` | Plugin status |
| GET | `/api/logs` | List log files |
| GET | `/api/logs/:fn/stats` | Parsed statistics |
| GET | `/api/logs/:fn/weather` | Weather data |
| GET | `/api/logs/:fn/gpx` | GPX export |
| GET | `/api/logs/:fn/csv` | CSV export |
| GET | `/api/logs/:fn/report` | Day report (markdown) |
| GET | `/api/engine` | Engine/fuel/maintenance |
| GET | `/api/power` | Live electrical data |
| GET | `/api/crew` | Crew list |
| GET | `/api/voyages` | Voyages |
| POST | `/api/logs/:fn/events` | Add/edit/delete events |
| POST | `/api/engine` | Engine/fuel/maintenance CRUD |
| POST | `/api/crew` | Crew CRUD |

### SignalK router (authenticated)
Same endpoints available at `/plugins/signalk-nmea0183-logger/api/...`.

## Roadmap

Future features under consideration. Sorted by priority.

### High priority — automatic data logging

#### Storm warnings
Compare Open-Meteo forecast with live barometer readings (XDR sentence). A rapid pressure drop during sailing generates a "Rapid pressure drop" event automatically.

#### Photo logging
Take a photo every 30 minutes via Pi camera or external camera, link to track position. Fully automatic visual timeline. Stored as files in the data directory.

### Medium priority — derived intelligence

#### NMEA replay
Play back log files with original timing via SignalK NMEA emitter. Backend-driven so all instruments (chartplotter, wind, depth) re-show the trip. Useful for troubleshooting and training. Requires conflict prevention with live NMEA input.

#### Performance tracking
Combine wind, SOG, and polar data to track percent of polar achieved per sail set. Per day, voyage, season. Pure data analysis on existing sensors.

#### Fuel consumption per RPM band
Use motor hours and RPM data to build a consumption profile (L/h at 1500/2200/2800 rpm). Helps choose efficient motor settings.

#### Engine wear correlation
Correlate maintenance schedule with cumulative motor hours, average RPM, and load hours. Predicts when maintenance is actually needed instead of strict interval-based.

### Low priority — additional features

#### Checklists
Departure and arrival checklists (engine check, navigation lights, weather reviewed, EPIRB on, gas shutoff).

#### Anchor alarm
Mark anchor position, set radius, detect drift via GPS track. Publish notification via SignalK for other apps. (Distinct from anchor *detection* which is now built-in.)

#### Tidal information
Correlate depth data with tidal predictions (via WorldTides or UKHO API). Show actual water depth alongside measured depth with tidal correction.

#### Multi-boat support
Vessel profile in settings: engine type, instruments, default sentence filter.

#### Regatta tracking
MMSI watchlist, historical AIS tracks, handicap-corrected rankings, replay.

#### NFC/BLE crew detection
NFC tags or BLE beacons detect which crew members are on board. Hands-off crew registration.

## Running tests

```bash
node --test test/parser.test.js
```

Requires Node.js 22+ (built-in test runner).

## License

MIT

## Author

TinkerSailor
