// ─── Sentry Initialization ──────────────────────────────────────────────────
// IMPORTANT: This file MUST be imported before all other modules in server.js.
// Sentry needs to instrument Node.js built-ins (http, https, etc.) before they
// are loaded by the application. Any import before this one may miss telemetry.
//
// ESM note: package.json has "type":"module" — using ES module syntax throughout.
// See https://docs.sentry.io/platforms/javascript/guides/node/
// ────────────────────────────────────────────────────────────────────────────

import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',

    // Release tag — Render injects RENDER_GIT_COMMIT automatically
    release: process.env.RENDER_GIT_COMMIT
      ? `socialmix-relay@${process.env.RENDER_GIT_COMMIT.slice(0, 7)}`
      : 'dev',

    // Capture 100% of errors (Free tier = 5 000/month — more than enough for V1)
    sampleRate: 1.0,

    // Performance tracing OFF for V1 — saves quota, no perf data needed yet
    tracesSampleRate: 0.0,

    // No PII in payloads (RGPD)
    sendDefaultPii: false,

    // Ignore transient errors that are not actionable
    ignoreErrors: [
      // Normal socket disconnect events
      'client disconnected',
      'ECONNRESET',
      'EPIPE',
      // Mongoose transient network errors (auto-recovered by Mongoose retry)
      'MongoNetworkTimeoutError',
      'MongoNetworkError',
      // Undici/fetch socket errors (already caught in server.js uncaughtException handler)
      'UND_ERR_SOCKET',
      'terminated',
    ],
  });

  console.log(
    `[Sentry] ✅ Initialized (env: ${process.env.NODE_ENV || 'production'}, release: ${process.env.RENDER_GIT_COMMIT?.slice(0, 7) || 'dev'})`
  );
} else {
  console.log('[Sentry] ⚠️  SENTRY_DSN not set — crash monitoring disabled');
}
