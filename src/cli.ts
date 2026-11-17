#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { startCapture } from './capture.js';
import { replay } from './replay.js';

const help = `webhook-replay-cli 0.1.0

Usage:
  webhook-replay capture [--dir PATH] [--port 0..65535] [--max-fixtures 1..1000]
                         [--redact-keys comma,separated,keys]
  webhook-replay replay FILE --to http://127.0.0.1:PORT/path
                        [--timeout-ms 50..30000] [--redact-keys keys]

Capture: loopback only; JSON POST bodies up to 64 KiB; default 100 fixtures.
Default directory: .webhook-fixtures; default port: 0 (choose an available port).
Headers, request paths and query strings are never saved or forwarded.
Replay uses only the explicit target path, never follows redirects, and prints
only the HTTP status. It sends REDACTED JSON, not a byte-exact signed webhook.
Use synthetic test events. Review fixtures; key redaction is not a DLP guarantee.
Exit codes: 0 = success, 2 = non-2xx response, 1 = invalid input or I/O error.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) { process.stdout.write(help); return; }
  const command = args.shift();
  if (command !== 'capture' && command !== 'replay') throw new Error('Use capture, replay or --help.');
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: command === 'capture'
    ? { dir: { type: 'string' }, port: { type: 'string' }, 'max-fixtures': { type: 'string' }, 'redact-keys': { type: 'string' } }
    : { to: { type: 'string' }, 'timeout-ms': { type: 'string' }, 'redact-keys': { type: 'string' } } });
  const integer = (value: unknown, fallback: number, min: number, max: number) => {
    const text = value ?? String(fallback);
    const number = Number(text);
    if (typeof text !== 'string' || !/^\d+$/.test(text) || number < min || number > max) throw new Error('Numeric option is out of range.');
    return number;
  };
  const keys = String(values['redact-keys'] ?? '').split(',').map(key => key.trim()).filter(Boolean);
  if (keys.length > 32 || keys.some(key => key.length > 64)) throw new Error('Use at most 32 redaction keys, each at most 64 characters.');
  if (command === 'capture') {
    if (positionals.length) throw new Error('Capture takes no positional arguments.');
    const server = await startCapture({ directory: String(values.dir ?? '.webhook-fixtures'),
      port: integer(values.port, 0, 0, 65535), maxFixtures: integer(values['max-fixtures'], 100, 1, 1000), extraKeys: keys,
      onSaved: id => process.stdout.write(`Saved ${id}.json\n`) });
    process.stdout.write(`Listening on http://127.0.0.1:${(server.address() as { port: number }).port}\n`);
    const stop = () => { server.close(); server.closeAllConnections(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } else {
    if (positionals.length !== 1 || !values.to) throw new Error('Replay requires FILE and --to URL.');
    const result = await replay(positionals[0]!, String(values.to), { timeoutMs: integer(values['timeout-ms'], 3000, 50, 30000), extraKeys: keys });
    process.stdout.write(`HTTP ${result.status}\n`);
    process.exitCode = result.status >= 200 && result.status < 300 ? 0 : 2;
  }
}
main().catch(() => { process.stderr.write('Error: command failed. Check options, JSON, private fixture directory and local receiver. Use --help.\n'); process.exitCode = 1; });
