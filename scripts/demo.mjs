import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCapture } from '../dist/capture.js';
import { replay } from '../dist/replay.js';

const root = await mkdtemp(join(tmpdir(), 'webhook-demo-'));
let capture, receiver;
try {
  const directory = join(root, 'fixtures');
  capture = await startCapture({ directory, extraKeys: ['customerReference'] });
  let delivered;
  receiver = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    delivered = JSON.parse(Buffer.concat(chunks)); res.writeHead(202); res.end();
  });
  receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening');
  const incoming = { type: 'invoice.paid', amount: 1200, currency: 'ETB', token: 'dummy-test-secret', customerReference: 'dummy-test-person' };
  const result = await fetch(`http://127.0.0.1:${capture.address().port}/incoming?private=dummy`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer dummy-header' }, body: JSON.stringify(incoming),
  });
  assert.equal(result.status, 201); await result.text();
  const file = join(directory, (await readdir(directory))[0]);
  const saved = await readFile(file, 'utf8');
  assert.doesNotMatch(saved, /dummy-test|dummy-header|private=/);
  console.log('1. Captured one synthetic JSON event; credentials and selected fields were removed.');
  const sent = await replay(file, `http://127.0.0.1:${receiver.address().port}/test-handler`);
  assert.equal(sent.status, 202); assert.equal(delivered.token, '[REDACTED]'); assert.equal(delivered.amount, 1200);
  console.log('2. Replayed the redacted event to a separate local receiver: HTTP 202.');
  await assert.rejects(replay(file, 'https://example.invalid'), /Target/);
  console.log('3. Refused a non-loopback destination before opening a connection.');
} finally {
  for (const server of [capture, receiver]) if (server) {
    const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed;
  }
  await rm(root, { recursive: true, force: true });
}
console.log('Demo passed; temporary fixtures and servers were removed. No existing project was modified.');
