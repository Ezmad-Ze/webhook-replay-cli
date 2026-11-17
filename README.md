# Webhook Replay CLI

A small TypeScript/Node 22+ tool to capture **synthetic JSON test webhooks**, redact selected fields, and replay them to an explicit local handler. No account, paid API, tunnel, server hosting or runtime npm dependency is required.

Useful when you are fixing an API integration, reproducing a handler bug, or testing duplicate event behavior without repeatedly sending events from a provider dashboard. The tool is intentionally a local test aid; it does not emulate provider signatures, payment rails or provider delivery guarantees.

## Quick start

Requires Node.js 22+ and Git only if you clone the source. From an extracted archive or checkout:

```bash
npm ci --ignore-scripts
npm test
npm run demo
```

The archive also contains compiled `dist/` files. You can run the CLI with Node and no dependency install:

```bash
node dist/cli.js --help
node dist/cli.js capture --dir .webhook-fixtures --port 8787 --redact-keys customerReference
```

From a second terminal, send a fictional event:

```bash
curl --fail-with-body http://127.0.0.1:8787/test-hook \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dummy-test-header' \
  --data '{"type":"invoice.paid","amount":1200,"currency":"ETB","token":"dummy-test-token","customerReference":"dummy-test-reference"}'
```

The listener prints `Saved UUID.json`. Open the resulting file and check the entire payload before sharing it. The token and customer reference are replaced with `[REDACTED]`; the incoming authorization header is omitted entirely.

Start your own local test handler, then substitute the saved filename and your handler's port/path:

```bash
node dist/cli.js replay .webhook-fixtures/UUID.json --to http://127.0.0.1:9000/test-handler
```

Replay makes a real POST request and can change local application state. Use a disposable test handler and synthetic data. The included `npm run demo` creates both local servers for you, asserts the result, and cleans them up automatically. Stop manual capture with Ctrl+C.

## Commands and defaults

| Command / option | Behavior |
| --- | --- |
| `capture` | Listen only on `127.0.0.1`; accept JSON POSTs |
| `--dir PATH` | Fixture directory; default `.webhook-fixtures`; parent must already exist |
| `--port 0..65535` | Default `0` chooses a free port and prints it |
| `--max-fixtures 1..1000` | Default 100 accepted events **per process**, not total files in the directory |
| `--redact-keys key,otherKey` | Add up to 32 object-key names, case/separator-insensitive, at every nesting level |
| `replay FILE --to URL` | POST the sanitized body to the explicit loopback target |
| `--timeout-ms 50..30000` | Total replay deadline, default 3000 ms |
| `--help` | Print usage and limits |

Replay accepts HTTP `localhost`, `127.0.0.1` or `[::1]` URLs. `localhost` is pinned to `127.0.0.1` without DNS lookup. Credentials, queries and fragments in target URLs are rejected. It never follows redirects. Only `Content-Type: application/json` and a computed content length are sent; incoming or fixture-supplied headers are not forwarded. Response bodies are discarded, and only `HTTP NNN` is printed.

Exit codes: **0** for a successful command/2xx replay, **2** for a non-2xx HTTP response (including redirects), **1** for invalid input, refused destinations or I/O errors. Errors avoid echoing supplied paths, URLs or payloads.

## Privacy and limits

- Bodies must be UTF-8 JSON objects or arrays, at most 64 KiB before and after redaction. No multipart, compressed bodies or binary content.
- No incoming headers, URL paths or query strings are stored. A fixture contains schema version, random ID, timestamp, POST method and redacted body only.
- Default sensitive keys: authorization, cookie, set-cookie, password, passwd, secret, token, access-token, refresh-token, API-key, client-secret, email, phone, card-number and CVV. Matching ignores case and non-alphanumeric separators.
- **Redaction is key-based, not a general secret detector.** Secrets in ordinary values, unknown keys, object-key names, array strings or free text can remain. Custom keys match names globally, not JSONPath expressions. Always use synthetic events and review fixtures.
- Capture is unauthenticated local tooling. Browser Origin headers and unexpected Host headers are refused, but another local process can send requests. Do not tunnel, expose or port-forward the listener.
- Up to four simultaneous accepted capture requests, 100 captures per session by default, five-second body deadline, at most 20 levels of retained JSON nesting. Capture stops accepting new events at its limit but stays running until stopped.
- Fixture directory: owned by the current user and mode 700 on POSIX. New fixture files: mode 600, exclusive creation. Existing final-path symlink directories and fixture file symlinks are refused. Use a trusted parent directory; this is not a sandbox against a hostile process running as your user or replacing parent paths.
- Fixture reads are bounded to 128 KiB and require a regular file. Replay responses are bounded to 32 KiB. Capture files use random UUID names and are never overwritten.
- Redaction changes event bytes. Original signatures cannot be checked using the redacted fixture, and original auth headers are not replayed. Test signature verification separately.
- No automatic retries, ordering guarantees, deduplication or idempotency enforcement. Replay the same fixture twice to exercise **your handler's** idempotency behavior.
- macOS and Linux are intended platforms; Windows is not claimed supported.

## Architecture and verification

See [architecture](docs/architecture.md), [validation record](docs/validation.md), [roadmap](docs/roadmap.md) and [changelog](CHANGELOG.md). CI is configured for Node 22/24 on Ubuntu/macOS; check actual remote results before claiming those jobs passed.

## Development transparency

AI-assisted portfolio project prepared for Endeamlak Zeleke. All included events are fictional. No employer/client code, production webhook data or production-use claims are included. Read the implementation and architecture before presenting it as something you can independently explain.

The package is `private: true` and has not been published to npm. MIT-licensed source; the development dependencies retain their own licenses.
