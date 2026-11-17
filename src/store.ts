import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_BODY, parseBody, redact } from './privacy.js';

export interface Fixture { schemaVersion: 1; id: string; capturedAt: string; method: 'POST'; body: unknown }
const MAX_FIXTURE = 128 * 1024;

export async function privateDirectory(directory: string): Promise<string> {
  const path = resolve(directory);
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('Cannot create fixture directory.'); }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Fixture directory must be a real directory.');
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())) {
    throw new Error('Fixture directory must be owned by you with mode 700.');
  }
  return realpath(path);
}

export async function saveFixture(directory: string, body: unknown, extraKeys: string[] = []): Promise<Fixture> {
  const input = parseBody(Buffer.from(JSON.stringify(body) ?? 'null'));
  const redacted = redact(input, extraKeys);
  parseBody(Buffer.from(JSON.stringify(redacted)));
  const fixture: Fixture = { schemaVersion: 1, id: randomUUID(), capturedAt: new Date().toISOString(), method: 'POST', body: redacted };
  const data = JSON.stringify(fixture, null, 2) + '\n';
  if (Buffer.byteLength(data) > MAX_FIXTURE) throw new Error('Redacted fixture exceeds 128 KiB.');
  const path = join(directory, `${fixture.id}.json`);
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(data, 'utf8'); }
  catch { await handle.close(); await unlink(path).catch(() => {}); throw new Error('Could not save fixture.'); }
  await handle.close();
  return fixture;
}

export async function readFixture(path: string): Promise<Fixture> {
  let handle;
  try { handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { throw new Error('Cannot open fixture; symlinks are refused.'); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FIXTURE) throw new Error('Fixture must be a regular file of at most 128 KiB.');
    // Bounded read protects against a file growing after stat.
    const bytes = Buffer.alloc(MAX_FIXTURE + 1);
    let length = 0;
    while (length < bytes.length) {
      const part = await handle.read(bytes, length, bytes.length - length, null);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    if (length > MAX_FIXTURE) throw new Error('Fixture exceeds 128 KiB.');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))); }
    catch { throw new Error('Fixture must contain valid UTF-8 JSON.'); }
    if (!value || value.schemaVersion !== 1 || value.method !== 'POST'
        || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/.test(value.id)
        || typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))) {
      throw new Error('Unsupported fixture schema.');
    }
    const body = parseBody(Buffer.from(JSON.stringify(value.body) ?? 'null'));
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY) throw new Error('Fixture body exceeds 64 KiB.');
    return { schemaVersion: 1, id: value.id, capturedAt: value.capturedAt, method: 'POST', body: redact(body) };
  } finally { await handle.close(); }
}
