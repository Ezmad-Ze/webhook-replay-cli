# Scope and stopping point

## Initial review candidate: v0.1.0

- Local JSON capture with bounded bodies and private fixture files.
- Default and configurable field redaction; complete omission of incoming headers, paths and queries.
- Explicit loopback-only replay, no redirects, bounded responses and deadlines.
- CLI argument validation, process shutdown, real-HTTP regression tests and an isolated demo.
- Setup guide, architecture explanation, changelog and cross-platform CI configuration.

Implementation is ready locally. Publication, actual remote CI and owner merge remain completion gates. Do not call the product finished on main until those gates pass.

## Further work requires approval

Do not automatically add external replay, tunnels, dashboards, signing secrets, retries, MCP, AI APIs, hosted storage or provider-specific integrations. After the initial version is verified and merged, leave its scope stable and propose future features separately.
