# Validation record — 2026-11-17

Environment: Linux, Node 24.22.1. A clean `npm ci --ignore-scripts` installed all three development packages successfully. There are no runtime npm dependencies.

- `npm test`: 19 tests passed, zero failures after resolving initial implementation/test issues.
- `npm run demo`: synthetic capture, redaction, loopback replay (HTTP 202), rejection of external destinations, and fixture/server cleanup passed.
- Tests include actual HTTP listeners and child CLI processes, default/custom redaction, private file modes, symlink rejection, malformed/oversized/chunked input, session caps, concurrent request reservations and aborted-request cleanup, slow-body deadlines, schema validation, credential omission, prototype safety, non-followed redirects, replay deadlines and response-size limits.

At initial archive preparation, GitHub Actions was configured for Node 22/24 on Ubuntu/macOS but had not run. The repository was not accessible then, so no remote publication was claimed. The owner subsequently created `Ezmad-Ze/webhook-replay-cli` with a README; its initial main commit was verified before preparing the publication branch.

Remote CI is a separate verification step. Consult the actual pull-request and main Actions runs for subsequent Node 22/24 Ubuntu/macOS results; the local results above do not establish cross-platform success.

Remaining completion gates: publish the reviewed source to the intended new repository, verify all configured remote jobs, obtain owner review/merge, and check main CI. No optional feature is needed to close the initial scope.
