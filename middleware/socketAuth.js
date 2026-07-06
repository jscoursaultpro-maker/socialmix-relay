/**
 * middleware/socketAuth.js
 * Socket.IO middleware for Supabase JWT authentication.
 *
 * Behavior:
 *   - Token present + valid → socket.user = User document (Mongoose)
 *   - Token absent          → socket.user = null (backward compat V0 hostSecret flow)
 *   - Token present + INVALID → next(new Error('AUTH_INVALID_TOKEN')) → socket disconnect
 *
 * The existing hostSecret flow is untouched. V0 clients connect without a JWT
 * and are handled by the existing party handlers as before.
 */
import { verifySupabaseJWT, AuthError } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase }     from '../services/userService.js';

/**
 * Socket.IO `io.use()` middleware.
 * @param {import('socket.io').Socket} socket
 * @param {(err?: Error) => void} next
 */
export async function socketAuth(socket, next) {
  const token = socket.handshake?.auth?.token;

  // ── No token: backward-compat V0 path ────────────────────────────────────
  if (!token) {
    socket.user = null;
    return next();
  }

  // ── Token present: validate + hydrate socket.user ────────────────────────
  try {
    const payload = await verifySupabaseJWT(token);
    const user    = await findOrCreateFromSupabase(payload);
    socket.user   = user;
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      // Typed auth error — disconnect with a specific code the client can handle
      const socketErr = new Error('AUTH_INVALID_TOKEN');
      socketErr.data  = { code: err.code, reason: err.message };
      return next(socketErr);
    }
    // Unexpected error (DB down, etc.) — log + reject gracefully
    console.error('[socketAuth] Unexpected error during auth:', err.message);
    return next(new Error('AUTH_INTERNAL_ERROR'));
  }
}
