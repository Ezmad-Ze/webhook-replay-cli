import { request } from 'node:http';
import { readFixture } from './store.js';
import { redact } from './privacy.js';

export function localTarget(raw: string): { hostname: string; port: number; path: string } {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Target must be an HTTP loopback URL.'); }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Target must use http://localhost, 127.0.0.1 or [::1], without credentials, query or fragment.');
  }
  return { hostname: url.hostname === '[::1]' ? '::1' : '127.0.0.1', port: Number(url.port || 80), path: url.pathname };
}

export async function replay(path: string, target: string, options: { timeoutMs?: number; extraKeys?: string[] } = {}): Promise<{ status: number }> {
  // Validate destination before opening any file or making any connection.
  const endpoint = localTarget(target);
  const fixture = await readFixture(path);
  const bytes = Buffer.from(JSON.stringify(redact(fixture.body, options.extraKeys)));
  const timeoutMs = options.timeoutMs ?? 3000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30000) throw new Error('Timeout must be 50–30000 milliseconds.');
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const finish = () => clearTimeout(timer);
    const req = request({ ...endpoint, method: 'POST', agent: false, signal: controller.signal,
      headers: { 'content-type': 'application/json', 'content-length': bytes.length } }, res => {
      let length = 0;
      res.on('data', chunk => {
        length += chunk.length;
        if (length > 32 * 1024) {
          finish(); reject(new Error('Replay response exceeded 32 KiB.'));
          res.destroy();
        }
      });
      res.on('error', () => { finish(); reject(new Error('Replay response failed or exceeded 32 KiB.')); });
      res.on('end', () => { finish(); resolve({ status: res.statusCode ?? 0 }); });
    });
    req.on('error', () => { finish(); reject(new Error('Replay failed or timed out. Check the local receiver.')); });
    req.end(bytes);
  });
}
