/**
 * tests/helpers/server-process.js
 * Spawns relay-server as a child process on a random port.
 * Starts a MongoMemoryServer (in-process) and injects its URI into the
 * child server's MONGODB_URI env — zero external Atlas dependency.
 *
 * Key optimizations:
 *   - SKIP_EDITORIAL_SEED=true → bypasses 1640-track MongoDB upsert (~8s saved)
 *   - Ready detection waits for banner OR the skip-seed log line
 *   - Each test suite gets its own isolated MMS instance
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mmsState } from './mms-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.resolve(__dirname, '../../server.js');
const START_TIMEOUT_MS = 30_000; // 30s: much faster now that seed is skipped

/** Find a free TCP port on 127.0.0.1 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Start the relay server as a child process backed by a fresh MongoMemoryServer.
 * @returns {{ url: string, port: number, kill: () => Promise<void> }}
 */
export async function startServer() {
  // ── 1. Start a fresh MongoMemoryServer for this test suite ───────────────
  console.log('[TestSetup] Starting MongoMemoryServer...');
  const mongoServer = await MongoMemoryServer.create({
    binary: { version: '7.0.14' }, // LTS stable, available on all CDNs incl. macOS ARM64
    instance: { storageEngine: 'wiredTiger' },
  });
  const mongoUri = mongoServer.getUri();

  // Expose URI for mongo.js (connectTestDB reads mmsState.uri)
  mmsState.uri = mongoUri;
  mmsState.server = mongoServer;

  console.log('[TestSetup] MongoMemoryServer ready');

  // ── 2. Find a free port ───────────────────────────────────────────────────
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;

  // ── 3. Spawn server.js ────────────────────────────────────────────────────
  const env = {
    ...process.env,
    PORT: String(port),
    MONGODB_URI: mongoUri,
    MONGODB_URI_TEST: mongoUri,
    NODE_ENV: 'test',
    // perf: skip 1640-track editorial seed (~8s per server boot)
    SKIP_EDITORIAL_SEED: 'true',
    // Disable external services in tests
    SENTRY_DSN: '',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
    SENDGRID_API_KEY: '',
  };

  let stdout = '';
  let stderr = '';
  const child = spawn('node', [SERVER_JS], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

  // ── 4. Wait for server ready ──────────────────────────────────────────────
  // With SKIP_EDITORIAL_SEED=true, the server is ready right after the banner.
  // We also accept the "[Seed] ⏭️  Skipped" line as a ready signal.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(
        `Server did not start within ${START_TIMEOUT_MS}ms.\n` +
        `stdout: ${stdout.slice(-500)}\n` +
        `stderr: ${stderr.slice(-300)}`
      ));
    }, START_TIMEOUT_MS);

    let resolved = false;
    const tryResolve = (delay = 200) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      setTimeout(resolve, delay);
    };

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      // Ready when banner + seed skipped (or banner alone if seed was already skipped)
      if (
        text.includes('Skipped (SKIP_EDITORIAL_SEED') ||
        text.includes('[Seed] ⏭') ||
        (text.includes(`localhost:${port}`) && stdout.includes('SKIP_EDITORIAL_SEED'))
      ) {
        tryResolve(200);
      }
      // Fallback: banner seen and 500ms elapsed (covers edge cases)
      if (text.includes(`localhost:${port}`) || text.includes('SOCIAL MIX')) {
        setTimeout(() => tryResolve(0), 500);
      }
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (!resolved && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
        reject(new Error(
          `Server exited prematurely (code=${code}, signal=${signal}).\n` +
          `stderr: ${stderr.slice(-500)}`
        ));
      }
    });
  });

  console.log(`[TestSetup] Server ready at ${url}`);

  // ── 5. Return kill handle ─────────────────────────────────────────────────
  // kill() must resolve quickly — after() hooks in node:test have a hard timeout.
  // We fire SIGTERM + SIGKILL backup, then race MMS stop against a 3s wall clock.
  const kill = () => {
    // Send signals
    try { child.kill('SIGTERM'); } catch {}
    const sigkillTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, 1000);

    // Race: wait for child exit + MMS stop, but give up after 3s regardless
    return Promise.race([
      new Promise((resolve) => {
        child.once('exit', async () => {
          clearTimeout(sigkillTimer);
          try { await mongoServer.stop(); } catch {}
          mmsState.uri = null;
          mmsState.server = null;
          resolve();
        });
      }),
      new Promise((resolve) => setTimeout(async () => {
        clearTimeout(sigkillTimer);
        try { child.kill('SIGKILL'); } catch {}
        try { await mongoServer.stop(); } catch {}
        mmsState.uri = null;
        mmsState.server = null;
        resolve();
      }, 3000)),
    ]);
  };


  return { url, port, kill };
}
