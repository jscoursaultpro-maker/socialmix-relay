/**
 * tests/helpers/client.js
 * Thin wrapper around socket.io-client that mimics iOS HostSocketClient behavior.
 * Provides promise-based helpers for common socket interactions.
 */
import { io as ioClient } from 'socket.io-client';

/**
 * Create a connected host socket client.
 * @param {string} url  - Server URL (e.g. http://127.0.0.1:PORT)
 * @param {object} opts - Optional socket.io options overrides
 * @returns {Socket}
 */
export function createHostSocket(url, opts = {}) {
  return ioClient(url, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
    ...opts,
  });
}

/**
 * Create a connected guest socket client.
 */
export function createGuestSocket(url, opts = {}) {
  return ioClient(url, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
    ...opts,
  });
}

/**
 * Wait for a specific socket event, with timeout.
 * @param {Socket}  socket
 * @param {string}  event
 * @param {number}  [timeoutMs=3000]
 * @returns {Promise<any>} - Resolves with the first argument of the event
 */
export function waitFor(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args[0]);
    });
  });
}

/**
 * Connect socket and wait for 'connect' event.
 * @param {Socket} socket
 */
export function connected(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

/**
/**
 * Disconnect socket and wait for 'disconnect' (max 500ms).
 * @param {Socket} socket
 */
export function disconnect(socket) {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve();
    const t = setTimeout(resolve, 500); // don't block if server already gone
    socket.once('disconnect', () => { clearTimeout(t); resolve(); });
    socket.disconnect();
  });
}

/**
 * Emit host:startParty and wait for the server's response.
 *
 * Server behavior (from server.js):
 *   NEW party    → emits nothing to the host socket directly
 *                  (only broadcasts party:started to guest:CODE room)
 *   RESUME/RECOVER → emits 'party:state' directly to the calling socket
 *   COLLISION    → emits 'party:error' { error: 'PARTY_CODE_ACTIVE' }
 *
 * Returns: { ok: true, state? } on success, { error } on failure.
 * For tests: after emitting, we wait briefly and check for party:error.
 * Absence of error within SETTLE_MS = success (new party created in RAM).
 */
export async function startParty(socket, payload) {
  const SETTLE_MS  = 500;   // time for server to process + potentially emit party:error
  const ERROR_MS   = 4000;  // race: if party:error arrives within this window it's a failure
  const RESUME_MS  = 4000;  // race: if party:state arrives the host is resuming

  return new Promise((resolve) => {
    const errorTimer = setTimeout(() => {
      // No error arrived in ERROR_MS → new party created successfully
      resolve({ ok: true });
    }, SETTLE_MS);

    // party:error = collision / invalid / missing code
    const onError = (err) => {
      clearTimeout(errorTimer);
      socket.off('party:state', onState);
      resolve({ error: err });
    };

    // party:state = resume/recover path
    const onState = (state) => {
      clearTimeout(errorTimer);
      socket.off('party:error', onError);
      resolve({ ok: true, state });
    };

    socket.once('party:error', onError);
    socket.once('party:state', onState);

    socket.emit('host:startParty', payload);
  });
}




/**
 * HTTP GET helper using native fetch (Node 18+).
 * @param {string} url
 * @returns {Promise<any>}
 */
export async function httpGet(url) {
  const res = await fetch(url);
  const json = await res.json();
  return { status: res.status, body: json };
}
