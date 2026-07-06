/**
 * tests/helpers/mms-state.js
 * Singleton module that holds the MongoMemoryServer instance and its URI.
 * Avoids circular imports between server-process.js and mongo.js.
 *
 * Usage:
 *   import { mmsState } from './mms-state.js';
 *   mmsState.uri  → the in-memory MongoDB URI (set by server-process.js)
 */
export const mmsState = {
  /** @type {string | null} */
  uri: null,
  /** @type {import('mongodb-memory-server').MongoMemoryServer | null} */
  server: null,
};
