# mcp-ansc-server

[![Listed on Yoda Digital Open Source](https://img.shields.io/badge/listed%20on-opensource.yoda.digital-af9568?style=flat-square)](https://opensource.yoda.digital/en/projects/ansc-mcp-server/)
[![npm version](https://img.shields.io/npm/v/mcp-ansc-server.svg?label=npm)](https://www.npmjs.com/package/mcp-ansc-server)
[![npm downloads](https://img.shields.io/npm/dm/mcp-ansc-server.svg)](https://www.npmjs.com/package/mcp-ansc-server)
[![GitHub release](https://img.shields.io/github/v/release/nalyk/ansc-mcp-server?display_name=tag&sort=semver)](https://github.com/nalyk/ansc-mcp-server/releases)
[![CI](https://github.com/nalyk/ansc-mcp-server/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nalyk/ansc-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](.nvmrc)
[![MCP](https://img.shields.io/badge/MCP-2025--11--25-orange.svg)](https://spec.modelcontextprotocol.io/specification/2025-11-25)
[![SDK](https://img.shields.io/badge/sdk-1.29.x-blue.svg)](https://www.npmjs.com/package/@modelcontextprotocol/sdk)

A Model Context Protocol (MCP) server that exposes Moldova's National
Agency for Solving Complaints (ANSC, *Agenția Națională pentru
Soluționarea Contestațiilor*) public-procurement data — appeals,
decisions, hearing schedule, and PDF documents — to LLMs and other MCP
clients.

Conformant with **MCP spec 2025-11-25** and the **TypeScript SDK 1.29.x**.
Published with **Sigstore provenance** via npm OIDC trusted publishing.

---

## Quickstart

```bash
npx -y mcp-ansc-server
```

That's it — no install needed. The server speaks stdio and is ready for any
MCP client to spawn it.

For Claude Desktop, drop this into your config:

```jsonc
// ~/.config/claude-desktop/config.json (Linux/macOS) or %APPDATA%\Claude\config.json (Windows)
{
  "mcpServers": {
    "ansc": {
      "command": "npx",
      "args": ["-y", "mcp-ansc-server"]
    }
  }
}
```

Same shape works in Cursor, Continue, Zed, and any other stdio-MCP host.

---

## Table of contents

- [What it ships](#what-it-ships)
  - [Tools (12)](#tools-12)
  - [Prompts (3)](#prompts-3)
  - [Resources](#resources)
- [Transports](#transports)
- [Authentication (optional)](#authentication-optional)
- [Configuration](#configuration)
- [Running it](#running-it)
- [Wiring into MCP clients](#wiring-into-mcp-clients)
- [Operational notes](#operational-notes)
- [Project layout](#project-layout)
- [Releasing](#releasing)
- [Project meta](#project-meta)

---

## What it ships

### Tools (12)

#### Search (4)

| name | what it does |
|---|---|
| `search_appeals` | Filter appeals by year / contracting authority / challenger / OCDS procedure ID / status. Paginated, 30 items per page. |
| `search_decisions` | Filter decisions by year / authority / challenger / procurement object / decision status / decision content / appeal grounds (the 42-ground catalog) / complaint object / appeal number. Paginated. |
| `search_orders` | Procedural orders ("încheieri") issued during a case. `kind="general"` (default) or `kind="suspension"` (incheieri-de-suspendare). |
| `search_suspended_decisions` | Court-suspended decisions (`decizii-suspendate-{year}`). The authoritative signal that a court has paused enforcement of an ANSC ruling. |

#### Direct lookup (3)

| name | what it does |
|---|---|
| `get_appeal_by_registration` | Direct lookup by `02/1245/24`-style number. Year is parsed from the suffix; pages are scanned with bounded concurrency (cached). |
| `get_decision_by_number` | Direct lookup by `03D-962-24`-style number. |
| `get_procurement_history` | Given an OCDS procurement ID, return *every* appeal and *every* decision tied to that tender. The OCDS timestamp seeds the year range we scan. |

#### Hearing schedule (3)

| name | what it does |
|---|---|
| `list_upcoming_hearings` | All days for which ANSC has published a hearing agenda. |
| `get_hearings_for_day` | The agenda for a specific day (by URL or ISO date) — list of cases with time, parties, registration number, object, panel. |
| `find_hearing_for_appeal` | The "when is my hearing?" feature — scans every published agenda day for a matching appeal registration number. |

#### Documents (2)

| name | what it does |
|---|---|
| `check_decision_court_status` | Looks up a decision and cross-checks the suspended-decisions listing. Returns `{ decision, suspension, isSuspended }`. **Closes a real correctness gap**: `search_decisions` alone can report `decisionStatus: "În vigoare"` for items a court has since suspended. |
| `fetch_ansc_decision` | Download an ANSC decision PDF and return its content. Native-text PDFs return extracted text. Scanned PDFs (Canon/HP/etc., common for older filings — typically with broken Unicode CMap that maps Romanian to garbled Cyrillic) return per-page JPEG `image` content blocks for the host vision-LLM to OCR — language-agnostic, no local Tesseract install. Force a path with `mode: 'auto' \| 'text' \| 'image'`. Uses `unpdf.extractImages` (raster bytes already embedded — no canvas backend needed) + `sharp` for re-encoding. |

#### What every tool guarantees

- declares both `inputSchema` (Zod) and `outputSchema` (Zod), so clients
  receive validated `structuredContent` alongside the human-readable `text`;
- carries the right tool annotations (`readOnlyHint: true`,
  `idempotentHint: true`, `openWorldHint: true|false`, `title`);
- honors cancellation via the `AbortSignal` from the SDK;
- normalizes Romanian dates to ISO 8601 (`entryDateIso`, `dateIso`)
  alongside the original `dd/mm/yyyy`;
- strips trailing punctuation from `appealNumber` / `registrationNumber`;
- emits `notifications/progress` for long PDF downloads.

### Prompts (3)

Pre-canned LLM workflows that clients surface as slash-commands:

| name | args | what it sets the LLM up to do |
|---|---|---|
| `summarize_ansc_decision` | `identifier` (decision number or ELO URL) | Fetch the decision and produce a structured Romanian/English summary: parties / procurement / grounds / ruling / legal basis / status. |
| `procurement_audit` | `procedureNumber` (OCDS ID) | Walk through `get_procurement_history` and produce a chronological narrative of every appeal + decision (with PDF reads when needed). |
| `compare_appeals` | `firstRegistration`, `secondRegistration` | Side-by-side comparison: parties, grounds, outcomes, divergences. |

### Resources

Static shortcuts:

- `ansc://appeals/current` — current-year appeals, page 0
- `ansc://decisions/current` — current-year decisions, page 0

RFC 6570 templates with `complete` callbacks for `year` (2014→current) and
`page` (0→20):

- `ansc://appeals/{year}`
- `ansc://appeals/{year}/page/{page}`
- `ansc://decisions/{year}`
- `ansc://decisions/{year}/page/{page}`

---

## Transports

Two transports, chosen via `MCP_TRANSPORT`:

- **`stdio`** *(default)* — for desktop / IDE clients (Claude Desktop, Cursor,
  Continue, Zed, …) that spawn the server as a subprocess.
- **`http`** — Streamable HTTP per spec 2025-03-26+, with stateful sessions
  (`Mcp-Session-Id` header), SSE streaming on `GET /mcp`, session
  resumability via `Last-Event-ID`. DNS-rebinding protection is enabled
  automatically when binding to localhost.

---

## Authentication (optional)

ANSC's data is **public** — anyone can browse `https://www.ansc.md`. The
default deployment shape is `MCP_TRANSPORT=stdio` (or `http` with
`AUTH_MODE=none` behind a trusted reverse proxy / Tailscale).

OAuth here only protects the *server itself* from abuse, not the data. If
you deploy this on the open internet and want per-principal rate limiting
and audit logs, set `MCP_TRANSPORT=http` and `AUTH_MODE=oauth`. The server
then runs as an **OAuth 2.1 Resource Server** per spec 2025-11-25:

- publishes RFC 9728 Protected Resource Metadata at
  `/.well-known/oauth-protected-resource`;
- validates Bearer JWTs with **`jose`** against the issuer's JWKS;
- enforces the **`aud`** claim per RFC 8707 (the audience must be
  `HTTP_PUBLIC_URL`) — token passthrough is forbidden by spec and rejected
  here;
- on missing/invalid token, returns `401` with
  `WWW-Authenticate: Bearer resource_metadata="…"`.

The MCP server itself is *only* a Resource Server. Bring any OAuth 2.1
Authorization Server (Auth0, Keycloak, Logto, Hanko, Cognito with static
client IDs, …).

### Testing the OAuth integration

```bash
# Inspect the published metadata
curl -fsSL https://mcp.example.com/.well-known/oauth-protected-resource | jq

# Successful call
TOKEN=…
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  https://mcp.example.com/mcp

# Hit /mcp without a token to see the spec-compliant 401 + WWW-Authenticate
curl -i https://mcp.example.com/mcp
```

---

## Configuration

All env vars are documented in [`.env.example`](.env.example). Highlights:

```
MCP_TRANSPORT=stdio|http
HTTP_HOST=127.0.0.1
HTTP_PORT=3030
HTTP_PUBLIC_URL=https://mcp.example.com   # required when AUTH_MODE=oauth
AUTH_MODE=none|oauth
OAUTH_ISSUER=https://auth.example.com     # required when AUTH_MODE=oauth
OAUTH_REQUIRED_SCOPES=mcp:read

ANSC_HTTP_TIMEOUT_MS=30000
ANSC_TLS_BYPASS_HOSTS=www.ansc.md,elo.ansc.md   # ANSC's cert is invalid
ANSC_USER_AGENT="…"

CACHE_TTL_CURRENT_S=300       # 5 min
CACHE_TTL_HISTORICAL_S=86400  # 24 h
CACHE_MAX_ENTRIES=500

LOG_LEVEL=info
```

Config is parsed by Zod at startup; misconfigured envs fail fast.

---

## Running it

### From npm (recommended)

```bash
npx -y mcp-ansc-server                # one-shot, no install
# or
npm install -g mcp-ansc-server
mcp-ansc-server                        # uses the bin
# or
MCP_TRANSPORT=http npx -y mcp-ansc-server   # Streamable HTTP on :3030
```

### From source

```bash
git clone git@github.com:nalyk/ansc-mcp-server.git
cd ansc-mcp-server
nvm use                                # honors .nvmrc (Node 24)
npm ci
npm run build
npm start                              # stdio
npm run start:http                     # MCP_TRANSPORT=http
npm run inspect                        # MCP Inspector against the built server
```

### In Docker

```bash
docker build -t mcp-ansc-server .
docker run -i --rm mcp-ansc-server     # stdio (typical MCP usage)
docker run --rm -p 3030:3030 \
  -e MCP_TRANSPORT=http -e HTTP_HOST=0.0.0.0 \
  mcp-ansc-server                      # Streamable HTTP
```

The image is multi-stage `node:24-alpine`, runs as a non-root `mcp` user.

---

## Wiring into MCP clients

### Claude Desktop / Cursor / Continue / Zed (stdio)

```jsonc
{
  "mcpServers": {
    "ansc": {
      "command": "npx",
      "args": ["-y", "mcp-ansc-server"]
    }
  }
}
```

For a pinned version (recommended for stability):

```jsonc
"args": ["-y", "mcp-ansc-server@1.0.1"]
```

### As a remote (Streamable HTTP)

Put the server behind TLS (caddy / nginx / Cloudflare Tunnel / fly.io). Point
the MCP client at `https://mcp.example.com/mcp`. If `AUTH_MODE=oauth`, the
client must include the `resource` parameter (RFC 8707) when exchanging
tokens, with value `https://mcp.example.com`.

---

## Operational notes

- **Logs** are JSON on **stderr** (pino, level via `LOG_LEVEL`). Stdout is
  reserved for the MCP wire. Any code path that writes to stdout in stdio
  mode is a bug — please file it.
- **Outbound HTTP** uses **undici** with a single hostname-pinned TLS-bypass
  agent (only `ANSC_TLS_BYPASS_HOSTS` skip cert validation; everything else
  is verified normally). Retries on 5xx / `ECONNRESET` / socket / header /
  body timeouts with exponential backoff + jitter, capped at 3 attempts;
  honors `Retry-After` on 429.
- **Caching** — HTML responses are cached in-process via `lru-cache`, year-
  tiered: 5 min TTL for the current year (active data), 24 h for historical
  years (rarely changes). Configurable.
- **PDF extraction** — for native-text PDFs, returns extracted text. For
  scanned PDFs, returns embedded page images for the host vision-LLM to
  OCR. The heuristic detector triggers on scanner-brand producer strings,
  low char/byte density, zero Romanian diacritics in a multi-page body, or
  per-page text under 80 chars. No local Tesseract install required.
- **HTML parser** matches columns by `<th>` text first (resilient to ANSC
  reordering); falls back to positional with `parserMode: 'partial'` flag
  in tool output, so callers can detect when ANSC's layout has drifted.

---

## Project layout

```
src/
  index.ts                    # bootstrap — picks transport, wires shutdown
  config.ts                   # Zod env schema
  logging.ts                  # pino on stderr (+ errMsg helper)
  api/
    ansc-client.ts            # undici + retries + lru-cache + lookups
    pdf-fetcher.ts            # PDF download + unpdf text/image extract + sharp JPEG
  handlers/
    tools.ts                  # 12 tools — Zod input/output, annotations
    resources.ts              # RFC 6570 templates + completions
    prompts.ts                # 3 LLM workflow templates
  http/
    server.ts                 # Express + StreamableHTTPServerTransport (stateful)
    auth.ts                   # JoseTokenVerifier + PRM router (opt-in)
  models/
    appeals.ts                # AppealStatus + Zod
    decisions.ts              # Decision enums + Zod
    orders.ts                 # Order (încheieri) + Zod
    suspended.ts              # SuspendedDecision + Zod
    hearings.ts               # Hearing / HearingDay + Zod
    pagination.ts             # Pagination + Zod
  utils/
    html-parser.ts            # parseTable<T,F> generic — header-name + positional
    identifiers.ts            # Romanian id + date helpers (incl. OCDS timestamp)
    retry.ts                  # exponential backoff with jitter
__tests__/
  fixtures/*.html             # synthetic ANSC pages for parser tests
  *.test.ts                   # html-parser, identifiers, config — 16 tests
.github/workflows/
  ci.yml                      # tsc + jest + audit + Dockerfile smoke
  publish.yml                 # tag-driven OIDC publish to npm + GitHub Release
  dependabot.yml              # weekly npm + actions updates
Dockerfile                    # node:24-alpine, multi-stage, non-root
```

---

## Releasing

Releases are tag-driven and fully automated via OIDC trusted publishing —
no static `NPM_TOKEN` involved.

```bash
npm version patch -m "Release v%s"     # bumps package.json + lockfile, creates v* tag
git push origin main --follow-tags     # triggers .github/workflows/publish.yml
```

The workflow runs tsc, tests, build, then publishes to npm with auto-Sigstore
provenance and creates the matching GitHub Release with auto-generated notes.
The tag↔package.json version drift is caught up front; re-runs are idempotent.

---

## Project meta

- **npm:** [`mcp-ansc-server`](https://www.npmjs.com/package/mcp-ansc-server)
- **Releases:** [github.com/…/releases](https://github.com/nalyk/ansc-mcp-server/releases)
- **Changelog:** [CHANGELOG.md](CHANGELOG.md)
- **Security policy:** [SECURITY.md](SECURITY.md) — please report
  vulnerabilities via [GitHub private vulnerability reporting](https://github.com/nalyk/ansc-mcp-server/security/advisories/new), not public issues.
- **License:** [MIT](LICENSE) © 2026 Ion Nalyk Calmis
- **MCP spec:** [2025-11-25](https://spec.modelcontextprotocol.io/specification/2025-11-25)
- **TypeScript SDK:** [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) ≥ 1.29.0
