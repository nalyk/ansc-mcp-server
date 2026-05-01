# Security policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** via GitHub's
[private vulnerability reporting](https://github.com/nalyk/ansc-mcp-server/security/advisories/new),
**not** through public issues.

Expected response time: best-effort within 7 days. Coordinated
disclosure preferred.

## Scope

This server scrapes a public website (`https://www.ansc.md`) and exposes
the data over MCP. No private data is processed; the threat model is
limited to:

- **Process compromise** — RCE via crafted PDF / HTML inputs
- **SSRF / cache poisoning** — by way of the configurable hostname allow-list
  for TLS bypass (`ANSC_TLS_BYPASS_HOSTS`)
- **Token misuse** — when running with `AUTH_MODE=oauth` (server is a
  Resource Server only; token-passthrough is forbidden by spec and
  rejected via RFC 8707 audience binding)
- **Protocol-stream corruption** — any path that writes to stdout in
  `MCP_TRANSPORT=stdio` mode is a bug — please report

## Out of scope

- ANSC's own website security posture
- Issues that require local filesystem write access
- Vulnerabilities in upstream dependencies that have a published advisory
  but no available fix (track via Dependabot)

## Hardening notes

- Run with the smallest possible Node permissions (the official Docker
  image runs as a non-root `mcp` user).
- For public-internet HTTP deployments, terminate TLS at a reverse proxy
  and either enable `AUTH_MODE=oauth` or bind to a private network.
- The `ANSC_TLS_BYPASS_HOSTS` allow-list bypasses certificate validation
  *only* for the hostnames listed — do not extend it to hosts you do not
  control.
