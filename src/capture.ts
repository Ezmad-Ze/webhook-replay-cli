import { createServer, type Server } from 'node:http';
import { MAX_BODY, parseBody } from './privacy.js';
import { privateDirectory, saveFixture } from './store.js';

export async function startCapture(options: { directory: string; port?: number; extraKeys?: string[]; maxFixtures?: number; onSaved?: (id: string) => void }): Promise<Server> {
  const maxFixtures = options.maxFixtures ?? 100;
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535
      || !Number.isInteger(maxFixtures) || maxFixtures < 1 || maxFixtures > 1000) {
    throw new Error('Invalid capture port or session limit.');
  }
  const directory = await privateDirectory(options.directory);
  let accepted = 0;
  let active = 0;
  const server = createServer(async (req, res) => {
    const reply = (status: number, text: string) => {
      res.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify({ message: text }));
    };
    if (req.method !== 'POST') { reply(405, 'Use POST.'); return; }
    if (req.headers.origin !== undefined) { reply(403, 'Browser-origin requests are refused.'); return; }
    if (req.headers.host !== `127.0.0.1:${(server.address() as { port: number }).port}`) {
      reply(403, 'Use the exact loopback listener address.'); return;
    }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
      reply(415, 'Use application/json.'); return;
    }
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
      reply(415, 'Compressed requests are not supported.'); return;
    }
    if (accepted + active >= maxFixtures || active >= 4) { reply(429, 'Capture limit reached.'); return; }
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) { reply(413, 'Body exceeds 64 KiB.'); return; }
    active++;
    let length = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => req.destroy(), 5000);
    try {
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        length += bytes.length;
        if (length > MAX_BODY) { reply(413, 'Body exceeds 64 KiB.'); req.resume(); return; }
        chunks.push(bytes);
      }
      let body;
      try { body = parseBody(Buffer.concat(chunks)); }
      catch { reply(400, 'Body must be a bounded JSON object or array.'); return; }
      let fixture;
      try { fixture = await saveFixture(directory, body, options.extraKeys); }
      catch { reply(500, 'Fixture could not be saved.'); return; }
      accepted++;
      options.onSaved?.(fixture.id);
      reply(201, fixture.id);
    } catch { if (!res.headersSent && !res.destroyed) reply(400, 'Request could not be captured.'); }
    finally { active--; clearTimeout(timer); }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.maxHeadersCount = 32;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return server;
}
