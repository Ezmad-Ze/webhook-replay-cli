# Working on Webhook Replay CLI

Read README.md and docs/architecture.md before editing. Keep the approved initial scope local and bounded.

- Run a fresh `npm ci --ignore-scripts`, `npm test` and `npm run demo` before review.
- Use synthetic events and real temporary HTTP servers in tests; clean up files, processes and sockets.
- Never commit real webhook payloads, credentials, employer/client code or real customer data.
- Preserve loopback pinning, credential omission, no-redirect replay and file/body/response limits.
- No tunnel, hosted service, arbitrary external destinations, AI APIs, paid service, npm publication or permission expansion without explicit owner approval.
- Do not call configured CI executed; verify actual remote jobs separately.
- A review PR is not completion. Owner merge and passing main CI are required before calling a published version complete.
- After the initial version is complete, propose optional features and wait for approval.
