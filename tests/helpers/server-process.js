/**
 * tests/helpers/server-process.js
 * Spawns relay-server as a child process on a random port using MONGODB_URI_TEST.
 * Returns { url, kill } to the caller.
 *
 * Strategy: we can't import server.js (it calls boot() immediately on load),
 * so we spawn it as a subprocess with overridden env vars and wait for the
 * "SOCIAL MIX" startup banner before resolving.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.resolve(__dirname, '../../server.js');
const START_TIMEOUT_MS = 12_000;

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
 * Start the relay server as a child process.
 * @returns {{ url: string, kill: () => Promise<void> }}
 */
export async function startServer() {
  const mongoUri = process.env.MONGODB_URI_TEST;
  if (!mongoUri) {
    throw new Error(
      'MONGODB_URI_TEST is required for integration tests. ' +
      'Set it to a dedicated test Atlas cluster URI.\n' +
      'Example: MONGODB_URI_TEST=mongodb+srv://... npm run test:integration'
    );
  }

  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;

  // Inherit current env but override critical vars
  const env = {
    ...process.env,
    PORT: String(port),
    MONGODB_URI: mongoUri,   // Server reads MONGODB_URI — we feed it the TEST URI
    NODE_ENV: 'test',
    // Disable Sentry in tests (avoids noise + rate-limit)
    SENTRY_DSN: '',
    // Disable Cloudinary in tests
    CLOUDINARY_API_KEY: '',
  };

  const child = spawn('node', [SERVER_JS], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Collect stderr for diagnostics on failure
  let stderr = '';
  child.stderr.on('data', d => { stderr += d.toString(); });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Server did not start within ${START_TIMEOUT_MS}ms.\nStderr: ${stderr}`));
    }, START_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      // Wait for the "Local: http://localhost:PORT" line
      if (text.includes(`localhost:${port}`) || text.includes('SOCIAL MIX')) {
        clearTimeout(timer);
        // Give the server 200ms to finish binding all routes/sockets
        setTimeout(resolve, 200);
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited prematurely (code ${code}).\nStderr: ${stderr}`));
    });
  });

  const kill = () =>
    new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill('SIGTERM');
      // Force kill after 3s if graceful shutdown hangs
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
    });

  return { url, port, kill };
}
