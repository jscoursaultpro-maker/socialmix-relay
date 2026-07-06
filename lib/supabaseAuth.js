/**
 * lib/supabaseAuth.js
 * Validates Supabase JWT tokens using JWKS (ECC P-256 asymmetric, Supabase 2025 format).
 * Uses `jose` — NOT jsonwebtoken/jwks-rsa (those don't support ECC well).
 *
 * Security notes:
 * - JWKS endpoint is public (no secrets needed for validation)
 * - SUPABASE_SERVICE_ROLE_KEY is NEVER used here (only admin ops)
 * - Issuer and audience are enforced strictly
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

// ─── Typed error for auth failures ────────────────────────────────────────────
export class AuthError extends Error {
  /**
   * @param {'TOKEN_MISSING'|'TOKEN_EXPIRED'|'TOKEN_INVALID'|'TOKEN_AUDIENCE'|'CONFIG_ERROR'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

// ─── JWKS setup ───────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;

if (!SUPABASE_URL && process.env.NODE_ENV !== 'test') {
  console.warn('[supabaseAuth] ⚠️  SUPABASE_URL not set — JWT validation will fail at runtime');
}

const JWKS_URL    = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` : null;
const ISSUER      = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : null;
const AUDIENCE    = 'authenticated';

// Lazily created — avoids startup crash when env var is missing in test mode
let _jwks = null;
function getJWKS() {
  if (!JWKS_URL) throw new AuthError('CONFIG_ERROR', 'SUPABASE_URL is not configured');
  if (!_jwks) {
    // createRemoteJWKSet caches in-memory and auto-refreshes every 10 minutes
    _jwks = createRemoteJWKSet(new URL(JWKS_URL), {
      cacheMaxAge: 10 * 60 * 1000, // 10 minutes
    });
  }
  return _jwks;
}


/**
 * Verify a Supabase-issued JWT and return its decoded payload.
 *
 * @param {string} token  Raw JWT string from Authorization header or socket.handshake.auth.token
 * @returns {Promise<import('jose').JWTPayload & { sub: string, email?: string, app_metadata?: any }>}
 * @throws {AuthError} on invalid/expired/missing token
 */
export async function verifySupabaseJWT(token) {
  if (!token || typeof token !== 'string') {
    throw new AuthError('TOKEN_MISSING', 'No token provided');
  }

  // ── TEST MODE ONLY ────────────────────────────────────────────────────────
  // Tokens prefixed with "test:" carry a base64-encoded JSON payload.
  // This works across process boundaries (child-process server in tests).
  // NEVER active in production (NODE_ENV !== 'test').
  if (process.env.NODE_ENV === 'test' && token.startsWith('test:')) {
    const payload = JSON.parse(Buffer.from(token.slice(5), 'base64').toString('utf8'));
    if (payload.__error) {
      throw new AuthError(payload.__error.code, payload.__error.message);
    }
    if (!payload.sub) throw new AuthError('TOKEN_INVALID', 'JWT missing sub claim');
    return payload;
  }

  // ── PRODUCTION PATH (JWKS) ───────────────────────────────────────────────
  try {
    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer:   ISSUER,
      audience: AUDIENCE,
    });

    if (!payload.sub) {
      throw new AuthError('TOKEN_INVALID', 'JWT missing sub claim');
    }

    return payload;
  } catch (err) {
    if (err instanceof AuthError) throw err;

    // Map jose errors to typed AuthError
    const msg = err.message || '';
    if (msg.includes('expired'))  throw new AuthError('TOKEN_EXPIRED',   'JWT has expired');
    if (msg.includes('audience')) throw new AuthError('TOKEN_AUDIENCE',  'JWT audience mismatch');
    if (msg.includes('issuer'))   throw new AuthError('TOKEN_INVALID',   'JWT issuer mismatch');

    throw new AuthError('TOKEN_INVALID', `JWT validation failed: ${msg}`);
  }
}
