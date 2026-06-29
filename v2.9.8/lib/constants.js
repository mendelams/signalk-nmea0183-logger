'use strict';

/** Named constants — no more magic numbers */

// Cache
const STATS_CACHE_MAX = 100;          // max entries in memory cache
const STATS_CACHE_EVICT_PCT = 0.2;    // evict 20% when full
const SEASON_CACHE_TTL = 300000;      // 5 minutes
const ENGINE_HOURS_TTL = 120000;      // 2 minutes

// LIVE detection
const LIVE_TIMEOUT_MS = 60000;        // 60 seconds without data = not live

// Timers
const STATUS_INTERVAL_MS = 10000;     // plugin status update
const CLEANUP_INTERVAL_MS = 60000;    // throttle map cleanup
const COMPRESS_INTERVAL_MS = 6 * 3600000; // 6 hours
const COMPRESS_DELAY_MS = 30000;      // 30s after start

// Delta engine
const DELTA_DEFAULT_INTERVAL_SEC = 10;
const AIS_POLL_MIN_MS = 10000;        // minimum AIS vessel poll interval

// Track display
const TRACK_MAX_POINTS = 2000;        // downsample target for display

// Unit conversions
const R2D = 180 / Math.PI;
const MS2KN = 1.94384;
const K2C = -273.15;
const PA2MBAR = 0.01;
const NM_EARTH_RADIUS = 3440.065;

// HTTP
const DEFAULT_API_PORT = 3033;
const MAX_BODY_SIZE = 1e6;            // 1MB max POST body

// Sentence types (for filter UI and status display)
const SENTENCE_TYPES = {
  GGA:'GPS Fix', GLL:'Geo Position', RMC:'Rec Min Nav', RMB:'Rec Min Nav WPT',
  VTG:'Track/Speed', GSA:'GPS DOP', GSV:'Satellites', ZDA:'Time/Date', GNS:'GNSS Fix',
  HDG:'Heading Dev Var', HDM:'Heading Mag', HDT:'Heading True',
  MWV:'Wind Speed/Angle', MWD:'Wind Dir/Speed', VWR:'Relative Wind',
  DBT:'Depth Transducer', DBS:'Depth Surface', DBK:'Depth Keel', DPT:'Depth',
  VHW:'Water Speed', APB:'Autopilot B', BOD:'Bearing Orig-Dest',
  BWC:'Bearing Dist WPT', BWR:'Bearing Dist Rhumb', RTE:'Routes', WPL:'Waypoint',
  XTE:'Cross Track', XDR:'Transducer', RSA:'Rudder Angle', RPM:'Revolutions',
  MTW:'Water Temp', MTA:'Air Temp', MMB:'Barometer', MDA:'Meteo Composite',
  VDM:'AIS Message', VDO:'AIS Own-Vessel', SKAIS:'AIS via SignalK',
  TXT:'Text', TTM:'Tracked Target', TLL:'Target Lat/Lon'
};

module.exports = {
  STATS_CACHE_MAX, STATS_CACHE_EVICT_PCT, SEASON_CACHE_TTL, ENGINE_HOURS_TTL,
  LIVE_TIMEOUT_MS, STATUS_INTERVAL_MS, CLEANUP_INTERVAL_MS,
  COMPRESS_INTERVAL_MS, COMPRESS_DELAY_MS,
  DELTA_DEFAULT_INTERVAL_SEC, AIS_POLL_MIN_MS,
  TRACK_MAX_POINTS,
  R2D, MS2KN, K2C, PA2MBAR, NM_EARTH_RADIUS,
  DEFAULT_API_PORT, MAX_BODY_SIZE,
  SENTENCE_TYPES
};
