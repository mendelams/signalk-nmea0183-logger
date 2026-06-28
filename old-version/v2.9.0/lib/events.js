'use strict';

/**
 * Reusable event detectors for NMEA0183 log analysis.
 *
 * Three patterns cover all current (and most future) event types:
 *
 *   SmoothedChangeDetector  — TWS, COG, depth rate, etc.
 *   StateToggleDetector     — Engine on/off, anchor watch, etc.
 *   LevelCrossingDetector   — Battery voltage, depth alarm, etc.
 *
 * Each detector has a .feed(value, timestamp) method that returns
 * an event object or null.
 */

// ── Smoothed change detector ────────────────────────────────────
// Buffers values, smooths, fires when change from baseline exceeds threshold.
// Supports linear mean (default) or circular mean (for angles like COG).

class SmoothedChangeDetector {
  /**
   * @param {object} opts
   * @param {string}   opts.type        - Event type key (e.g. 'wind', 'course')
   * @param {number}   opts.threshold   - Minimum change to trigger event
   * @param {number}  [opts.bufferSize] - Smoothing buffer size (default 10)
   * @param {number}  [opts.minElapsed] - Minimum seconds between events (default 10)
   * @param {boolean} [opts.circular]   - Use circular mean for angles (default false)
   * @param {number}  [opts.drift]      - Baseline drift rate 0-1 (default 0.05)
   * @param {function}[opts.format]     - (prev, curr, diff) => detail string
   */
  constructor(opts) {
    this.type = opts.type;
    this.threshold = opts.threshold;
    this.bufferSize = opts.bufferSize || 10;
    this.minElapsed = (opts.minElapsed || 10) * 1000;
    this.circular = opts.circular || false;
    this.drift = opts.drift !== undefined ? opts.drift : 0.05;
    this.format = opts.format || ((prev, curr, diff) =>
      `${prev.toFixed(1)} → ${curr.toFixed(1)} (${diff > 0 ? '+' : ''}${diff.toFixed(1)})`);

    this.buffer = [];
    this.baseline = null;
    this.lastEventTime = null;
  }

  _smooth() {
    if (this.circular) {
      let sinSum = 0, cosSum = 0;
      for (const v of this.buffer) {
        sinSum += Math.sin(v * Math.PI / 180);
        cosSum += Math.cos(v * Math.PI / 180);
      }
      return (Math.atan2(sinSum, cosSum) * 180 / Math.PI + 360) % 360;
    }
    return this.buffer.reduce((a, b) => a + b, 0) / this.buffer.length;
  }

  _diff(a, b) {
    if (this.circular) {
      let d = b - a;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      return d;
    }
    return b - a;
  }

  /**
   * Feed a new value. Returns event object or null.
   * @param {number} value
   * @param {Date|string} ts - Timestamp
   * @returns {object|null}
   */
  feed(value, ts) {
    if (value === null || value === undefined || isNaN(value)) return null;
    const time = ts instanceof Date ? ts : new Date(ts);

    this.buffer.push(value);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
    if (this.buffer.length < Math.ceil(this.bufferSize / 2)) return null;

    const smooth = this._smooth();

    if (this.baseline === null) {
      this.baseline = smooth;
      this.lastEventTime = time;
      return null;
    }

    const diff = this._diff(this.baseline, smooth);
    const elapsed = time - (this.lastEventTime || 0);

    if (Math.abs(diff) >= this.threshold && elapsed >= this.minElapsed) {
      const event = {
        type: this.type,
        time: time.toISOString(),
        detail: this.format(this.baseline, smooth, diff)
      };
      this.baseline = smooth;
      this.lastEventTime = time;
      return event;
    }

    // Slowly drift baseline towards current value
    if (this.drift > 0 && this.baseline !== null) {
      if (this.circular) {
        // Circular drift
        const d = this._diff(this.baseline, smooth);
        this.baseline = (this.baseline + d * this.drift + 360) % 360;
      } else {
        this.baseline = this.baseline * (1 - this.drift) + smooth * this.drift;
      }
    }

    return null;
  }
}

// ── State toggle detector ───────────────────────────────────────
// Binary on/off state based on threshold crossing. Tracks periods.

class StateToggleDetector {
  /**
   * @param {object} opts
   * @param {string}   opts.type          - Event type key (e.g. 'engine')
   * @param {number}   opts.threshold     - Value above this = "on"
   * @param {function} opts.formatOn      - (ts) => detail string for "on" event
   * @param {function} opts.formatOff     - (ts, durationMin) => detail string for "off" event
   * @param {function}[opts.formatOffNoDur] - (ts) => detail when no duration available
   */
  constructor(opts) {
    this.type = opts.type;
    this.threshold = opts.threshold;
    this.formatOn = opts.formatOn;
    this.formatOff = opts.formatOff;
    this.formatOffNoDur = opts.formatOffNoDur || opts.formatOff;

    this.active = false;
    this.startTime = null;
    this.periods = [];  // [{start, end}]
  }

  /**
   * Feed a new value. Returns event object or null.
   * @param {number} value
   * @param {Date|string} ts
   * @returns {object|null}
   */
  feed(value, ts) {
    if (value === null || value === undefined || isNaN(value)) return null;
    const time = ts instanceof Date ? ts : new Date(ts);
    const isOn = Math.abs(value) > this.threshold;

    if (isOn && !this.active) {
      this.active = true;
      this.startTime = time;
      return {
        type: this.type,
        time: time.toISOString(),
        detail: this.formatOn(time)
      };
    }

    if (!isOn && this.active) {
      this.active = false;
      if (this.startTime && time) {
        const dur = (time - this.startTime) / 60000;
        this.periods.push({ start: this.startTime.toISOString(), end: time.toISOString() });
        const event = {
          type: this.type,
          time: time.toISOString(),
          detail: this.formatOff(time, Math.round(dur))
        };
        this.startTime = null;
        return event;
      }
      this.startTime = null;
      return {
        type: this.type,
        time: time ? time.toISOString() : null,
        detail: this.formatOffNoDur(time)
      };
    }

    return null;
  }

  /** Finalize: if still active at end of log, close the period. */
  finalize(endTime) {
    if (this.active && this.startTime && endTime) {
      this.periods.push({ start: this.startTime.toISOString(), end: endTime.toISOString() });
    }
  }

  /** Total hours from all periods. */
  totalHours() {
    let h = 0;
    for (const p of this.periods) {
      const dt = (new Date(p.end) - new Date(p.start)) / 3600000;
      if (dt > 0 && dt < 24) h += dt;
    }
    return h;
  }
}

// ── Level crossing detector ─────────────────────────────────────
// Fires event when value crosses below threshold, and again on recovery.

class LevelCrossingDetector {
  /**
   * @param {object} opts
   * @param {string}   opts.type        - Event type key (e.g. 'battery')
   * @param {number}   opts.threshold   - Level threshold
   * @param {string}  [opts.direction]  - 'below' (default) or 'above'
   * @param {function} opts.formatCross - (value, threshold, id) => detail for crossing
   * @param {function} opts.formatRecover - (value, id) => detail for recovery
   */
  constructor(opts) {
    this.type = opts.type;
    this.threshold = opts.threshold;
    this.below = (opts.direction || 'below') === 'below';
    this.formatCross = opts.formatCross;
    this.formatRecover = opts.formatRecover;

    this.crossed = false;
  }

  /**
   * @param {number} value
   * @param {Date|string} ts
   * @param {string} [id] - Optional sensor identifier
   * @returns {object|null}
   */
  feed(value, ts, id) {
    if (value === null || value === undefined || isNaN(value)) return null;
    const time = ts instanceof Date ? ts : new Date(ts);
    const isCrossed = this.below ? (value < this.threshold) : (value > this.threshold);

    if (isCrossed && !this.crossed) {
      this.crossed = true;
      return {
        type: this.type,
        time: time ? time.toISOString() : null,
        detail: this.formatCross(value, this.threshold, id)
      };
    }

    if (!isCrossed && this.crossed) {
      this.crossed = false;
      return {
        type: this.type,
        time: time ? time.toISOString() : null,
        detail: this.formatRecover(value, id)
      };
    }

    return null;
  }
}

module.exports = { SmoothedChangeDetector, StateToggleDetector, LevelCrossingDetector };
