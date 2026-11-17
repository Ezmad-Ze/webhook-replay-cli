# Architecture and tradeoffs

## Capture

`capture.ts` starts a Node HTTP server bound to the literal IPv4 loopback address. It validates method, Host, Origin, media type and compression before collecting a bounded body. An in-flight counter reserves a slot before asynchronous reading so concurrent requests cannot bypass the session cap. A deadline limits body collection.

`privacy.ts` parses UTF-8 JSON and redacts known key names recursively. `store.ts` creates a fixture with a generated ID and stores only the redacted body and minimal metadata. Output objects have no prototype, so keys such as `__proto__` are data rather than assignments to the object prototype. Unrecognized values are not presumed safe: users must inspect fixtures.

The store uses exclusive, non-following file opens and private POSIX modes. Successful HTTP 201 is sent only after writing and closing the fixture. Consumers can observe a partial file during an in-progress write; malformed/incomplete reads are rejected, and failed writes are removed when possible. There is no crash-durable transaction or fsync guarantee.

## Replay

`replay.ts` validates the destination before reading any fixture or connecting. It maps accepted loopback names to literal addresses; no DNS resolution is needed. The validated schema is reconstructed rather than forwarding arbitrary fixture fields. The body is redacted again as defense against edits to a saved file; user-specified extra keys can remove further fields at replay time.

Only an explicit POST with regenerated JSON headers is sent to the user-supplied target path. Node's HTTP client performs one request, with an absolute deadline. It does not implement redirects or retries. Response bytes are bounded and discarded, so a receiver cannot make terminal logs reveal a secret response body.

`cli.ts` owns argument validation, safe terminal summaries, exit codes and signal handling. The modules are separate so real HTTP behavior and CLI process behavior can both be tested.

## Why no provider signature support?

Sanitizing a body changes its bytes. Reusing an original signature would be misleading. Keeping signing keys or original authenticated payloads would expand the privacy scope. This initial version focuses on handler logic using fictional events; provider signature tests need a separate deliberately designed fixture strategy.

## Why loopback only?

Replaying a webhook is an action with possible side effects. An explicit local destination supports reproducing bugs without adding external-network delivery, retry queues, provider credentials or hosting. This is not a general HTTP security sandbox: local services are still real services, so choose a disposable test handler.

## What to explain in an interview

1. Why an allowlist and literal IP pinning are stronger than trusting a hostname to resolve to loopback.
2. Why HTTP redirects can cross the originally approved destination boundary.
3. Why recursive field redaction is useful but cannot guarantee anonymization.
4. Why exclusive file creation avoids clobbering while still not making writes transactional.
5. Why request retries and webhook idempotency are separate responsibilities.

Sources for implementation semantics: [Node HTTP](https://nodejs.org/api/http.html), [Node filesystem](https://nodejs.org/api/fs.html). These are references, not a security certification.
