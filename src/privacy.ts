export const MAX_BODY = 64 * 1024;
export const REDACTED = '[REDACTED]';
const defaults = ['authorization', 'cookie', 'setcookie', 'password', 'passwd', 'secret',
  'token', 'accesstoken', 'refreshtoken', 'apikey', 'clientsecret', 'email', 'phone', 'cardnumber', 'cvv'];
const keyForm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Key-based redaction is deliberately conservative but is not a DLP guarantee. */
export function redact(value: unknown, extraKeys: string[] = [], depth = 0): unknown {
  if (depth > 20) throw new Error('JSON nesting exceeds 20 levels.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => redact(item, extraKeys, depth + 1));
  if (typeof value !== 'object' || !value) throw new Error('Unsupported JSON value.');
  const sensitive = new Set([...defaults, ...extraKeys].map(keyForm));
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    result[key] = sensitive.has(keyForm(key)) ? REDACTED : redact(item, extraKeys, depth + 1);
  }
  return result;
}

export function parseBody(bytes: Buffer): unknown {
  if (bytes.length > MAX_BODY) throw new Error('JSON body exceeds 64 KiB.');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Body must be valid UTF-8 JSON.'); }
  if (value === null || typeof value !== 'object') throw new Error('JSON body must be an object or array.');
  redact(value); // Validate retained nesting and finite numbers before persistence.
  return value;
}
