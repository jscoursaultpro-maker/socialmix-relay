/**
 * SocialMix Server Metrics Module
 *
 * OPTIONAL — activated ONLY when STRESS_METRICS=1 is set.
 * Import this in server.js to get RAM / event-loop / socket metrics every 5s.
 * Has ZERO effect on production when STRESS_METRICS is not set.
 *
 * Usage in server.js:
 *   import { startMetrics } from './stress-test/metrics.js';
 *   startMetrics(io, parties);   // call after boot()
 */

import { monitorEventLoopDelay } from 'perf_hooks';

let _histogram = null;
let _timer = null;

/**
 * Start logging server metrics every 5 seconds.
 * @param {import('socket.io').Server} io
 * @param {Map} parties   - the parties Map from server.js
 * @param {number} intervalMs - sampling interval (default 5000)
 */
export function startMetrics(io, parties, intervalMs = 5000) {
  if (process.env.STRESS_METRICS !== '1') return;  // NO-OP in production

  console.log('[Metrics] 📊 STRESS_METRICS enabled — logging every', intervalMs / 1000, 's');

  // Event-loop delay histogram (Node.js ≥ 12.17)
  _histogram = monitorEventLoopDelay({ resolution: 20 });
  _histogram.enable();

  _timer = setInterval(() => {
    const mem = process.memoryUsage();
    const rssKB  = Math.round(mem.rss / 1024);
    const heapKB = Math.round(mem.heapUsed / 1024);

    // Event loop lag (microseconds → ms)
    const elMeanMs = (_histogram.mean / 1e6).toFixed(2);
    const elP99Ms  = (_histogram.percentile(99) / 1e6).toFixed(2);
    _histogram.reset();

    // Active socket count
    const activeSockets = io.engine?.clientsCount ?? io.sockets.sockets.size;

    // Active party count & total participants
    const activeParties = parties.size;
    const totalParticipants = [...parties.values()]
      .reduce((sum, p) => sum + (p.participants?.length ?? 0), 0);

    console.log(
      `[Metrics] 🧠 RAM: ${(rssKB / 1024).toFixed(1)} MB (heap: ${(heapKB / 1024).toFixed(1)} MB)` +
      ` | EL p99: ${elP99Ms}ms (mean: ${elMeanMs}ms)` +
      ` | Sockets: ${activeSockets}` +
      ` | Parties: ${activeParties} (${totalParticipants} participants)`
    );

    // Warn if approaching Render free-tier RAM limit (512 MB)
    if (rssKB > 400 * 1024) {
      console.warn(`[Metrics] ⚠️  RAM ALERT: ${(rssKB / 1024).toFixed(1)} MB (> 400 MB — approaching Render 512 MB limit)`);
    }
    if (parseFloat(elP99Ms) > 100) {
      console.warn(`[Metrics] ⚠️  EVENT LOOP ALERT: p99 = ${elP99Ms}ms (> 100ms target)`);
    }
  }, intervalMs);

  // Don't block process exit
  if (_timer.unref) _timer.unref();
}

export function stopMetrics() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_histogram) { _histogram.disable(); _histogram = null; }
}
