'use strict';
const https = require('https');

/**
 * Simple HTTPS JSON GET with timeout.
 * @param {string} url
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<object|null>}
 */
function fetchJSON(url, timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ── Simple in-memory cache ──────────────────────────────────────
// Key = "lat,lon,date", expires after 30 min
const cache = {};
const CACHE_TTL = 30 * 60 * 1000;

function cacheKey(lat, lon, date) {
  return `${lat.toFixed(2)},${lon.toFixed(2)},${date}`;
}

function cacheGet(key) {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  if (entry) delete cache[key];
  return null;
}

function cacheSet(key, data) {
  // Limit cache size
  const keys = Object.keys(cache);
  if (keys.length > 50) delete cache[keys[0]];
  cache[key] = { data, ts: Date.now() };
}

/**
 * Fetch weather + sea state for a set of hourly intervals.
 *
 * @param {Array} intervals - From parseLogFile: [{hour, lat, lon, measuredTWS, measuredTemp}]
 * @param {string} dateStr  - ISO date string YYYY-MM-DD
 * @returns {Promise<Array>} Enriched intervals with forecast + sea state data
 */
async function fetchWeather(intervals, dateStr) {
  if (!intervals || !intervals.length || !dateStr) return [];

  const today = new Date().toISOString().split('T')[0];
  const isHist = dateStr < today;

  // Group intervals by approximate position (within 0.05°)
  const groups = [];
  for (const iv of intervals) {
    const existing = groups.find(g =>
      Math.abs(g.lat - iv.lat) < 0.05 && Math.abs(g.lon - iv.lon) < 0.05);
    if (existing) {
      existing.hours.push(iv);
    } else {
      groups.push({ lat: iv.lat, lon: iv.lon, hours: [iv] });
    }
  }

  const results = {};

  // Fetch in parallel per position group
  const fetches = groups.map(async (g) => {
    const ck = cacheKey(g.lat, g.lon, dateStr);
    let cached = cacheGet(ck);

    if (!cached) {
      const wxBase = isHist
        ? 'https://archive-api.open-meteo.com/v1/archive'
        : 'https://api.open-meteo.com/v1/forecast';
      const wxUrl = `${wxBase}?latitude=${g.lat}&longitude=${g.lon}` +
        `&start_date=${dateStr}&end_date=${dateStr}` +
        `&hourly=temperature_2m,cloud_cover,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m` +
        `&wind_speed_unit=kn&timezone=UTC`;

      const marUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${g.lat}&longitude=${g.lon}` +
        `&start_date=${dateStr}&end_date=${dateStr}` +
        `&hourly=wave_height,wave_direction,wave_period&timezone=UTC`;

      const [wxData, marData] = await Promise.all([
        fetchJSON(wxUrl),
        fetchJSON(marUrl)
      ]);

      cached = { wx: wxData, mar: marData };
      cacheSet(ck, cached);
    }

    const wx = cached.wx && cached.wx.hourly ? cached.wx.hourly : null;
    const mar = cached.mar && cached.mar.hourly ? cached.mar.hourly : null;

    for (const hInfo of g.hours) {
      const hour = hInfo.hour;
      const idx = Math.min(hour, 23);
      results[hour] = {
        hour,
        lat: g.lat,
        lon: g.lon,
        // Forecast
        temp: wx && wx.temperature_2m ? wx.temperature_2m[idx] : null,
        cloud: wx && wx.cloud_cover ? wx.cloud_cover[idx] : null,
        code: wx && wx.weather_code ? wx.weather_code[idx] : null,
        wind: wx && wx.wind_speed_10m ? wx.wind_speed_10m[idx] : null,
        windDir: wx && wx.wind_direction_10m ? wx.wind_direction_10m[idx] : null,
        gust: wx && wx.wind_gusts_10m ? wx.wind_gusts_10m[idx] : null,
        humidity: wx && wx.relative_humidity_2m ? wx.relative_humidity_2m[idx] : null,
        // Sea state
        waveH: mar && mar.wave_height ? mar.wave_height[idx] : null,
        waveDir: mar && mar.wave_direction ? mar.wave_direction[idx] : null,
        wavePer: mar && mar.wave_period ? mar.wave_period[idx] : null,
        // Measured from NMEA sensors
        measuredTWS: hInfo.measuredTWS,
        measuredTemp: hInfo.measuredTemp
      };
    }
  });

  await Promise.all(fetches);

  // Fill missing weather data: if an hour has wave data but no weather code,
  // carry forward/backward the nearest hour that has weather data.
  // This happens when the boat crosses from inland water to open sea —
  // the marine API covers the sea position but the weather API may have
  // failed for that position group, or vice versa.
  const sorted = Object.keys(results).map(Number).sort((a, b) => a - b);
  // Forward pass: fill nulls from previous hour with data
  let lastGoodCode = null, lastGoodTemp = null, lastGoodWind = null,
      lastGoodWindDir = null, lastGoodGust = null, lastGoodCloud = null;
  for (const h of sorted) {
    const r = results[h];
    if (r.code !== null) {
      lastGoodCode = r.code; lastGoodTemp = r.temp;
      lastGoodWind = r.wind; lastGoodWindDir = r.windDir;
      lastGoodGust = r.gust; lastGoodCloud = r.cloud;
    } else if (lastGoodCode !== null) {
      r.code = lastGoodCode; r.temp = lastGoodTemp;
      r.wind = lastGoodWind; r.windDir = lastGoodWindDir;
      r.gust = lastGoodGust; r.cloud = lastGoodCloud;
      r.interpolated = true; // mark so UI can indicate this
    }
  }
  // Backward pass: fill any remaining nulls at the start
  let nextGoodCode = null, nextGoodTemp = null, nextGoodWind = null,
      nextGoodWindDir = null, nextGoodGust = null, nextGoodCloud = null;
  for (const h of [...sorted].reverse()) {
    const r = results[h];
    if (r.code !== null) {
      nextGoodCode = r.code; nextGoodTemp = r.temp;
      nextGoodWind = r.wind; nextGoodWindDir = r.windDir;
      nextGoodGust = r.gust; nextGoodCloud = r.cloud;
    } else if (nextGoodCode !== null) {
      r.code = nextGoodCode; r.temp = nextGoodTemp;
      r.wind = nextGoodWind; r.windDir = nextGoodWindDir;
      r.gust = nextGoodGust; r.cloud = nextGoodCloud;
      r.interpolated = true;
    }
  }

  // Return sorted by hour
  return Object.keys(results)
    .map(Number)
    .sort((a, b) => a - b)
    .map(h => results[h]);
}

module.exports = { fetchWeather };
