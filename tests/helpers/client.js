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
 * Disconnect socket and wait for 'disconnect'.
 * @param {Socket} socket
 */
export function disconnect(socket) {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve();
    socket.once('disconnect', resolve);
    socket.disconnect();
  });
}

/**
 * Emit host:startParty and wait for party:state (success) or party:error.
 * @returns {{ state?: any, error?: any }}
 */
export async function startParty(socket, payload) {
  const race = Promise.race([
    waitFor(socket, 'party:state').then(state => ({ state })),
    waitFor(socket, 'party:error').then(error => ({ error })),
  ]);
  socket.emit('host:startParty', payload);
  return race;
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
