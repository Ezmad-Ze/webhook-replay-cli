import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, symlink, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startCapture } from '../dist/capture.js';
import { localTarget, replay } from '../dist/replay.js';
import { privateDirectory, readFixture, saveFixture } from '../dist/store.js';
import { redact, parseBody, MAX_BODY } from '../dist/privacy.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'webhook-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function close(server) {
  const done = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await done;
}
async function receiver(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => close(server));
  return `http://127.0.0.1:${server.address().port}`;
}
async function capture(t, options = {}) {
  const root = await fixture(t);
  const directory = join(root, 'fixtures');
  const server = await startCapture({ directory, ...options });
  t.after(() => close(server));
  return { root, directory, server, url: `http://127.0.0.1:${server.address().port}` };
}
const jsonPost = (url, data, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });
async function savedPath(directory) { return join(directory, (await readdir(directory))[0]); }
async function cli(args, cwd) {
  const child = spawn(process.execPath, [resolve('dist/cli.js'), ...args], { cwd });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const timer = setTimeout(() => child.kill(), 5000);
  const [code] = await once(child, 'close'); clearTimeout(timer);
  return { code, stdout, stderr };
}

test('redacts nested default and custom keys without prototype pollution', () => {
  const original = JSON.parse('{"password":"dummy-secret","items":[{"API_KEY":"dummy-key","CustomerRef":"dummy-private","amount":20}],"__proto__":{"polluted":true}}');
  const clean = redact(original, ['customer-ref']);
  assert.equal(clean.password, '[REDACTED]'); assert.equal(clean.items[0].API_KEY, '[REDACTED]');
  assert.equal(clean.items[0].CustomerRef, '[REDACTED]'); assert.equal(clean.items[0].amount, 20);
  assert.equal(Object.getPrototypeOf(clean), null); assert.equal({}.polluted, undefined);
  assert.equal(original.password, 'dummy-secret');
});
test('rejects invalid UTF-8, malformed, primitive, oversized and too-deep JSON', () => {
  for (const value of ['{', 'null', '42', '"text"', ' '.repeat(MAX_BODY + 1)]) assert.throws(() => parseBody(Buffer.from(value)));
  assert.throws(() => parseBody(Buffer.from([0xff])));
  let nested = {}; for (let i = 0; i < 22; i++) nested = { next: nested };
  assert.throws(() => redact(nested), /nesting/);
});
test('captures redacted body with private permissions, no headers, paths or query', async t => {
  const { directory, url, server } = await capture(t, { extraKeys: ['customer'] });
  assert.equal(server.address().address, '127.0.0.1');
  const res = await jsonPost(url + '/dummy-private-path?token=dummy-query', { event: 'created', password: 'dummy-body', customer: 'dummy-person' },
    { authorization: 'Bearer dummy-header', cookie: 'session=dummy-cookie', 'x-extra': 'dummy-extra' });
  assert.equal(res.status, 201);
  const path = await savedPath(directory); const text = await readFile(path, 'utf8');
  assert.doesNotMatch(text, /dummy-(private|query|body|person|header|cookie|extra)/);
  const data = JSON.parse(text); assert.equal(data.body.event, 'created'); assert.equal(data.body.password, '[REDACTED]');
  assert.deepEqual(Object.keys(data).sort(), ['body', 'capturedAt', 'id', 'method', 'schemaVersion']);
  if (process.platform !== 'win32') { assert.equal((await stat(path)).mode & 0o777, 0o600); assert.equal((await stat(directory)).mode & 0o777, 0o700); }
});
test('rejects wrong method, browser origins, forged Host, content type and encoding', async t => {
  const { directory, url } = await capture(t);
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await jsonPost(url, {}, { origin: 'https://example.invalid' })).status, 403);
  // Use node:http: fetch may normalize or replace Host.
  const status = await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { host: 'example.invalid', 'content-type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(status, 403);
  assert.equal((await jsonPost(url, {}, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await jsonPost(url, {}, { 'content-encoding': 'gzip' })).status, 415);
  assert.deepEqual(await readdir(directory), []);
});
test('rejects malformed and primitive JSON without persisting it', async t => {
  const { directory, url } = await capture(t);
  for (const body of ['{', 'null', 'true']) assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 400);
  assert.deepEqual(await readdir(directory), []);
});
test('bounds content-length and chunked bodies before saving', async t => {
  const { directory, url } = await capture(t);
  assert.equal((await jsonPost(url, { data: 'x'.repeat(MAX_BODY) })).status, 413);
  const status = await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.write('{"data":"'); req.end('x'.repeat(MAX_BODY) + '"}');
  });
  assert.equal(status, 413); assert.deepEqual(await readdir(directory), []);
});
test('caps captures per session and uses unique files without overwriting', async t => {
  const { directory, url } = await capture(t, { maxFixtures: 2 });
  assert.equal((await jsonPost(url, { n: 1 })).status, 201);
  const firstPath = await savedPath(directory), first = await readFile(firstPath);
  assert.equal((await jsonPost(url, { n: 2 })).status, 201);
  assert.equal((await jsonPost(url, { n: 3 })).status, 429);
  assert.equal((await readdir(directory)).length, 2); assert.deepEqual(await readFile(firstPath), first);
});

test('reserves concurrent capture slots and releases them after aborted requests', async t => {
  const { url, directory, server } = await capture(t);
  const pending = [];
  try {
    for (let i = 0; i < 4; i++) {
      const incoming = once(server, 'request');
      const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '100' } });
      req.on('error', () => {}); req.write('{'); pending.push(req);
      await incoming;
    }
    // A round trip on the same listener provides an observable synchronization point.
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await jsonPost(url, {})).status, 429);
    for (const req of pending) req.destroy();
    // Wait for all aborted sockets, then confirm a new request can use their slots.
    await Promise.all(pending.map(req => req.closed ? Promise.resolve() : new Promise(resolve => req.once('close', resolve))));
    assert.deepEqual(await readdir(directory), []);
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await jsonPost(url, { recovered: true })).status, 201);
  } finally { for (const req of pending) req.destroy(); }
});

test('slow capture body hits its deadline and leaves no partial fixture', async t => {
  const { url, directory } = await capture(t);
  await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '100' } }, res => res.resume());
    const timer = setTimeout(() => { req.destroy(); reject(new Error('Body deadline was not enforced.')); }, 6500);
    req.on('error', () => {});
    req.on('close', () => { clearTimeout(timer); resolve(); });
    req.write('{');
  });
  assert.deepEqual(await readdir(directory), []);
  assert.equal((await jsonPost(url, { next: true })).status, 201);
});
test('refuses symlinked or publicly accessible fixture directories', async t => {
  const root = await fixture(t); const alias = root + '-alias';
  await symlink(root, alias, 'dir'); t.after(() => rm(alias, { force: true }));
  await assert.rejects(privateDirectory(alias), /real directory/);
  if (process.platform !== 'win32') { await chmod(root, 0o755); await assert.rejects(privateDirectory(root), /mode 700/); }
});
test('redaction expansion cannot create a fixture that exceeds replay body limit', async t => {
  const root = await fixture(t); const body = Array.from({ length: 3100 }, () => ({ token: '' }));
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < MAX_BODY);
  await assert.rejects(saveFixture(root, body), /64 KiB/); assert.deepEqual(await readdir(root), []);
});
test('fixture reader rejects symlinks, directories, large files and bad schemas', async t => {
  const root = await fixture(t); const good = await saveFixture(root, { event: 'ok' });
  const file = join(root, good.id + '.json'); const alias = join(root, 'alias.json'); await symlink(file, alias);
  await assert.rejects(readFixture(alias), /symlinks/); await assert.rejects(readFixture(root), /regular file/);
  const invalid = join(root, 'invalid.json');
  for (const text of ['{', '{}', JSON.stringify({ ...good, schemaVersion: 2 }), JSON.stringify({ ...good, body: null }), 'x'.repeat(128 * 1024 + 1)]) {
    await writeFile(invalid, text); await assert.rejects(readFixture(invalid));
  }
});
test('accepts only explicit HTTP loopback targets, pins localhost without DNS', () => {
  assert.deepEqual(localTarget('http://localhost:3456/hook'), { hostname: '127.0.0.1', port: 3456, path: '/hook' });
  assert.equal(localTarget('http://[::1]:3456/hook').hostname, '::1');
  for (const target of ['http://example.invalid', 'http://192.168.1.1', 'http://0.0.0.0', 'http://localhost.example.invalid', 'https://localhost', 'file:///tmp/file', 'http://user:pass@localhost', 'http://localhost/?token=dummy', 'http://localhost/#fragment', 'not-url']) assert.throws(() => localTarget(target));
});
test('capture and replay end to end use sanitized JSON and never forward headers', async t => {
  const { url, directory } = await capture(t);
  await jsonPost(url, { type: 'created', amount: 100, token: 'dummy-secret' }, { authorization: 'Bearer dummy-auth' });
  let received;
  const target = await receiver(t, async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    received = { path: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks)) }; res.end('dummy-response-private');
  });
  assert.deepEqual(await replay(await savedPath(directory), target + '/receiver'), { status: 200 });
  assert.equal(received.path, '/receiver'); assert.equal(received.headers.authorization, undefined); assert.equal(received.headers.cookie, undefined);
  assert.equal(received.body.token, '[REDACTED]'); assert.equal(received.body.amount, 100);
});
test('untrusted fixture headers and methods cannot be forwarded', async t => {
  const root = await fixture(t); const saved = await saveFixture(root, { password: 'dummy' });
  const file = join(root, saved.id + '.json');
  await writeFile(file, JSON.stringify({ ...saved, headers: { authorization: 'dummy-auth', host: 'example.invalid' }, target: 'http://example.invalid', body: { password: 'dummy-edited' } }));
  let headers;
  const target = await receiver(t, (req, res) => { headers = req.headers; req.resume(); res.end(); });
  assert.equal((await replay(file, target)).status, 200); assert.equal(headers.authorization, undefined);
  await writeFile(file, JSON.stringify({ ...saved, method: 'DELETE' })); await assert.rejects(replay(file, target), /schema/);
});
test('does not follow redirects or print response bodies', async t => {
  const root = await fixture(t); const saved = await saveFixture(root, { n: 1 });
  let reached = false;
  const redirectTarget = await receiver(t, (req, res) => { reached = true; res.end(); });
  const target = await receiver(t, (req, res) => { req.resume(); res.writeHead(302, { location: redirectTarget }); res.end('dummy-response-secret'); });
  const result = await cli(['replay', join(root, saved.id + '.json'), '--to', target]);
  assert.equal(result.code, 2); assert.equal(result.stdout, 'HTTP 302\n'); assert.equal(result.stderr, ''); assert.equal(reached, false);
});
test('enforces total replay timeout and response size limits', async t => {
  const root = await fixture(t); const saved = await saveFixture(root, { n: 1 }); const file = join(root, saved.id + '.json');
  const hanging = await receiver(t, req => req.resume());
  await assert.rejects(replay(file, hanging, { timeoutMs: 50 }), /failed or timed out/);
  const large = await receiver(t, (req, res) => { req.resume(); res.end('x'.repeat(33 * 1024)); });
  await assert.rejects(replay(file, large), /response/);
});
test('CLI validates inputs without echoing supplied private strings', async t => {
  const root = await fixture(t);
  const help = await cli(['--help'], root); assert.equal(help.code, 0); assert.match(help.stdout, /webhook-replay-cli 0.1.0/);
  for (const args of [[], ['capture', '--port', '-1'], ['capture', '--max-fixtures', '0'], ['capture', 'dummy-private'], ['capture', '--unknown', 'dummy-private'], ['replay', 'dummy-private'], ['replay', 'dummy-private', '--to', 'http://example.invalid']]) {
    const result = await cli(args, root); assert.equal(result.code, 1); assert.doesNotMatch(result.stdout + result.stderr, /dummy-private/);
  }
});
test('CLI capture starts, saves a fixture and shuts down on SIGTERM', async t => {
  const root = await fixture(t);
  const child = spawn(process.execPath, [resolve('dist/cli.js'), 'capture', '--dir', join(root, 'fixtures')]);
  t.after(() => child.kill('SIGKILL'));
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Capture did not start.')), 5000);
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/Listening on (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once('error', reject);
  });
  assert.equal((await jsonPost(url, { event: 'demo' })).status, 201);
  const done = once(child, 'close'); child.kill('SIGTERM'); assert.equal((await done)[0], 0);
  assert.match(output, /Saved [0-9a-f-]+\.json/); assert.equal(errors, '');
});
