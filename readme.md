# signalk-nmea0183-logger

Signal K plugin that logs raw NMEA0183 sentences to daily log files with a built-in web viewer featuring GPS track visualization on OpenSeaMap, voyage statistics, and historical weather data.

## Features

### Logging
- Logs raw NMEA0183 sentences to daily files (`nmea0183_YYYY-MM-DD.log`)
- Optional ISO timestamp prefix per line
- Per-sentence-type filtering (enable/disable individual NMEA sentence types)
- Automatic daily file rotation
- Configurable maximum file size with automatic part splitting

### AIS Throttling
- **VDM throttle**: Limits AIS messages to 1 per MMSI per configurable interval (default: 30s). In busy waterways this reduces AIS log volume by 90-95% while retaining all vessel tracks.
- **VDO heartbeat**: When GPS dedup is active, logs own-vessel AIS (VDO) once per interval (default: 180s) as transponder health check. Set to 0 to skip VDO entirely.

### GPS Deduplication
- When RMC sentences are available, redundant GGA and GLL sentences are automatically skipped
- RMC contains everything needed: position, SOG, COG, date/time
- VDO (own AIS position) is throttled to a heartbeat interval rather than logged at full rate
- Significantly reduces log file size without losing any track data

### File Size Management
- Configurable maximum file size (default: 50 MB)
- When exceeded, a new part file is created: `nmea0183_2025-03-15_part1.log`
- Protects SD cards and prevents memory issues on Raspberry Pi during log analysis

### Web Viewer (Webapp)
- **GPS Track**: Displayed on OpenSeaMap with Leaflet.js, SOG color gradient, start/end markers
- **Voyage Statistics**: Distance (nm), duration, SOG avg/max, TWS avg/max, TWA avg/min/max, engine hours
- **Weather Overlay**: Historical weather per 2-hour interval based on average GPS position per interval, fetched from Open-Meteo (free, no API key)
- **Raw Log Viewer**: Syntax-highlighted NMEA sentences with filter, line limit, and auto-refresh
- **Mobile-friendly** layout: map → stats → weather → raw data

### Architecture
- **Public API on separate port** (default: 3033) — no SignalK authentication required for read access
- **Delete** requires SignalK login (routed through authenticated SignalK router)
- SignalK Webapp entry redirects to the public API port

## Installation

### From npm (after publishing)

Install via the SignalK Appstore, or manually:

```bash
cd ~/.signalk
npm install signalk-nmea0183-logger
sudo systemctl restart signalk
```

### Manual / Development

```bash
# Copy plugin to SignalK config directory
cp -r signalk-nmea0183-logger ~/.signalk/signalk-nmea0183-logger

# Add to ~/.signalk/package.json dependencies:
#   "signalk-nmea0183-logger": "file:signalk-nmea0183-logger"

# Install and restart
cd ~/.signalk
rm -f package-lock.json
npm install
sudo systemctl restart signalk
```

### File structure

```
signalk-nmea0183-logger/
├── package.json
├── index.js          # Plugin + public API server
├── README.md
└── public/
    ├── index.html    # Redirect to :3033
    └── app.html      # Main webapp
```

## Configuration

After installation, enable the plugin in **SignalK Admin → Plugin Config → NMEA0183 Logger**.

### General

| Setting | Default | Description |
|---|---|---|
| Log Directory | *(auto)* | Path for log files. Leave empty for `~/.signalk/nmea0183-logs/` |
| Public API Port | 3033 | Port for the unauthenticated read-only API and webapp |
| Include ISO Timestamp | ✓ | Prefix each line with `2025-03-15T12:34:56.789Z` |

### Throttle & Dedup

| Setting | Default | Description |
|---|---|---|
| AIS Throttle (VDM) | 30 sec | Max 1 message per MMSI per interval. `0` = disabled |
| GPS Dedup | ✓ | Skip GGA/GLL when RMC is available; throttle VDO |
| VDO Heartbeat | 180 sec | When dedup is on: log 1 VDO per interval. `0` = skip all VDO |

### File Management

| Setting | Default | Description |
|---|---|---|
| Max File Size | 50 MB | Start new part file when exceeded. `0` = unlimited |

### Sentence Filter

Each NMEA sentence type can be individually enabled or disabled:
- **Navigation**: GGA, GLL, RMC, RMB, VTG, GSA, GSV, ZDA, GNS
- **Compass**: HDG, HDM, HDT
- **Wind**: MWV, MWD, VWR
- **Depth**: DBT, DBS, DBK, DPT
- **Speed**: VHW
- **Waypoint / Route / AP**: APB, BOD, BWC, BWR, RTE, WPL, XTE, XDR, RSA, RPM
- **Environment**: MTW, MTA, MMB, MDA
- **AIS**: VDM, VDO
- **Misc**: TXT, TTM, TLL

## Accessing the Webapp

| URL | Description |
|---|---|
| `http://<host>:3033/` | **Recommended** — webapp + API on same port, works without login |
| `http://<host>:3000/signalk-nmea0183-logger/` | Redirects to `:3033` |
| SignalK Admin → Webapps → NMEA0183 Logger | Redirects to `:3033` |

## API Endpoints

All endpoints on the public API port (default 3033). No authentication required.

| Method | Path | Description |
|---|---|---|
| GET | `/api/logs` | List all log files |
| GET | `/api/logs/:filename` | Read log content (query: `?lines=200&filter=RMC`) |
| GET | `/api/logs/:filename/stats` | Voyage statistics + track + weather intervals |
| GET | `/api/logs/:filename/download` | Download raw log file |
| GET | `/api/stats` | Live plugin status, sentence counts, throttle stats |

Delete (requires SignalK authentication on port 3000):

| Method | Path | Description |
|---|---|---|
| DELETE | `/plugins/signalk-nmea0183-logger/api/logs/:filename` | Delete a log file |

## Voyage Statistics

Parsed from logged NMEA sentences:

| Statistic | Source | Notes |
|---|---|---|
| Distance (nm) | RMC | Haversine formula, skips GPS jumps >10 nm |
| Duration | RMC | First to last timestamp |
| SOG avg/max (kn) | RMC, VTG | |
| TWS avg/max (kn) | MWV (ref=T), MWD | Converted to knots from m/s or km/h |
| TWA avg/min/max (°) | MWV (ref=T) | True Wind Angle |
| Engine hours | RPM | Time intervals where RPM > 100, skips gaps > 1 hour |

## Weather Data

- Source: [Open-Meteo](https://open-meteo.com/) (free, no API key needed)
- Historical weather for past dates, forecast API for today
- Per 2-hour interval: temperature, cloud cover, weather description, wind speed/gusts (in knots)
- Position-based: uses average GPS position per 2-hour interval, so longer voyages show local weather along the route
- Fetched client-side (requires internet on the viewing device)

## Estimated Log File Sizes

With default settings (AIS throttle 30s, GPS dedup on):

| Scenario | Per 24 hours |
|---|---|
| GPS only | ~7 MB |
| GPS + wind + depth + heading | ~25 MB |
| Above + AIS (busy waterway, ~100 vessels) | ~40 MB |

Without throttling, AIS in busy waterways can produce 200-500 MB/day.

## Requirements

- Signal K server (tested with v2.x on OpenPlotter/Raspberry Pi)
- NMEA0183 data connection configured in SignalK
- Port 3033 (or configured port) available
- Internet on viewing device for weather data and map tiles

## NMEA Sentences Used

For full functionality, these sentences should be present:

| Sentence | Required for |
|---|---|
| RMC | GPS track, distance, SOG, timestamps *(essential)* |
| MWV | Wind speed (TWS) and True Wind Angle |
| RPM | Engine hours calculation |
| VDM | AIS vessel tracking |
| VDO | Own AIS transponder health check |

## License

MIT