# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] — 2026-05-01

### Changed

- **First npm release.** Added `.github/workflows/publish.yml` that fires on
  any `v*.*.*` tag, type-checks, runs tests, builds, then publishes to
  npm with **Sigstore provenance attestation** (cryptographic proof the
  package was built from this commit on a GitHub-hosted runner). The
  workflow also creates the matching GitHub Release with auto-generated
  notes. Tag↔`package.json` version drift is caught up-front and aborts
  the publish.
- Added `package.json` `files` field (publishes only `build/` + docs +
  `.env.example`) and `publishConfig` (`access: public`,
  `provenance: true`, official registry). Without these, `npm publish`
  would either include source / tests / Docker artifacts or refuse to run.

No runtime behavior changes from 1.0.0.

[1.0.1]: https://github.com/nalyk/ansc-mcp-server/releases/tag/v1.0.1

## [1.0.0] — 2026-05-01

First public release. Modernized rewrite of the legacy
`@modelcontextprotocol/sdk@0.6` server with full coverage of every visible
content class on `ansc.md`, conformant with **MCP spec 2025-11-25**.

### Added

#### Tools (12)

- `search_appeals` — filter-based browse of public-procurement appeals
  (year, contracting authority, challenger, OCDS ID, status).
- `search_decisions` — filter-based browse of decisions (year, authority,
  challenger, procurement object, decision status, content, appeal grounds,
  complaint object, appeal number).
- `search_orders` — procedural orders (*încheieri*), with `kind=general`
  or `kind=suspension`.
- `search_suspended_decisions` — court-suspended decisions
  (`decizii-suspendate-{year}`). Authoritative signal of court suspension.
- `get_appeal_by_registration` — direct lookup by `02/<seq>/<yy>` number.
- `get_decision_by_number` — direct lookup by `<panel>D-<seq>-<yy>` number.
- `get_procurement_history` — given an OCDS ID, every appeal and every
  decision tied to it. Year range derived from the OCDS timestamp.
- `list_upcoming_hearings` — published agenda of upcoming public hearings.
- `get_hearings_for_day` — agenda detail by URL or ISO date.
- `find_hearing_for_appeal` — *"when is my hearing?"* — scans the upcoming
  agenda for a given appeal registration number.
- `check_decision_court_status` — fixes the stale-status bug: looks up a
  decision and cross-checks the suspended-decisions listing, returning
  `{ decision, suspension, isSuspended }`.
- `fetch_ansc_decision` — multi-modal PDF extraction. Native-text PDFs
  return text; scanned PDFs return per-page JPEG `image` content blocks
  for the host vision-LLM to OCR (no local Tesseract install). Heuristic
  detector triggers on scanner-brand producers, low char/byte density,
  zero-Romanian-diacritics-in-multi-page-body, or per-page text < 80 chars.
  `mode: 'auto' | 'text' | 'image'` to force a path.

#### Prompts (3)

- `summarize_ansc_decision` — fetch a decision and produce a structured
  summary (parties / procurement / grounds / ruling / legal basis / status).
- `procurement_audit` — chronological narrative of a procurement's
  contestation history given an OCDS ID.
- `compare_appeals` — side-by-side comparison of two registration numbers.

#### Resources (RFC 6570 templates with completions)

- `ansc://appeals/current`, `ansc://decisions/current`
- `ansc://appeals/{year}` and `ansc://appeals/{year}/page/{page}`
- `ansc://decisions/{year}` and `ansc://decisions/{year}/page/{page}`
- `year` and `page` template variables expose `complete` callbacks
  (years 2014→current; pages 0–20).

#### Transports

- **stdio** (default) for MCP-client subprocesses.
- **Streamable HTTP** (per spec 2025-03-26+) with stateful sessions
  (`Mcp-Session-Id`), SSE on GET, session resumability via `Last-Event-ID`,
  DNS-rebinding protection on localhost.

#### Authentication (optional, HTTP only)

- `AUTH_MODE=oauth` enables an **OAuth 2.1 Resource Server** profile:
  publishes RFC 9728 PRM at `/.well-known/oauth-protected-resource`,
  validates Bearer JWTs against the AS's JWKS via `jose`, enforces the
  `aud` claim per RFC 8707, returns RFC 6750 `WWW-Authenticate` on 401.

#### Resilience & data quality

- `undici` HTTP with hostname-pinned TLS bypass (only `ansc.md` and
  `elo.ansc.md` — their cert is invalid; everything else is verified).
- 30 s timeout, exponential-backoff retries with jitter, `Retry-After`
  on 429.
- `lru-cache` HTML responses, year-tiered TTL (5 min current / 24 h
  historical).
- Structured `pino` logging on stderr only — never on stdout, so the
  MCP wire is never corrupted.
- Romanian text → enum mapping for appeal status (19), decision status
  (3), decision content (12), complaint object (2). Raw strings preserved.
- ISO 8601 dates alongside the original `dd/mm/yyyy`.
- HTML parser matches columns by `<th>` text first, falls back to
  positional with `parserMode: 'header' | 'partial' | 'positional'`.

### Configuration

All env vars validated by Zod at startup. See `.env.example`.

### Tests / CI

- 16 unit tests (HTML parser fixtures, identifiers, config validation).
- GitHub Actions: `tsc --noEmit`, `jest`, `npm audit --audit-level=high`,
  Docker build + stdio-handshake smoke test.
- Multi-stage `node:24-alpine` Dockerfile (non-root).

### Known gaps (deferred)

- Full-text search across decision PDFs (would need offline indexer).
- Statistics / aggregation tools.
- News / announcements feed (`/ro/content/...` articles).
- *Practica unitară* (case-law) and annual reports.
- MTender enrichment (OCDS ID → full procurement record).
- Persistent / shared cache (Redis option).

[1.0.0]: https://github.com/nalyk/ansc-mcp-server/releases/tag/v1.0.0
