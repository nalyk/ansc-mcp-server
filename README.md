# mcp-ansc-server

[![CI](https://github.com/nalyk/ansc-mcp-server/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nalyk/ansc-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](.nvmrc)
[![MCP](https://img.shields.io/badge/MCP-2025--11--25-orange)](https://spec.modelcontextprotocol.io/specification/2025-11-25)

A Model Context Protocol (MCP) server that exposes Moldova's National Agency
for Solving Complaints (ANSC, *Agenția Națională pentru Soluționarea
Contestațiilor*) public‑procurement data — appeals, decisions, hearing
schedule, and PDF documents — to LLMs and other MCP clients.

Conformant with **MCP spec 2025‑11‑25** and the **TypeScript SDK 1.29.x**.

## What it ships

### Tools (6)

| name | what it does |
|---|---|
| `search_appeals` | Filter appeals by year/authority/challenger/OCDS/status. Paginated. |
| `search_decisions` | Filter decisions by year/authority/challenger/object/status/content/grounds/etc. Paginated. |
| `get_appeal_by_registration` | Direct lookup of one appeal by `02/1245/24`-style number. Year is parsed from the suffix. |
| `get_decision_by_number` | Direct lookup of one decision by `03D-962-24`-style number. |
| `get_procurement_history` | Given an OCDS ID, return *every* appeal and decision tied to that tender. The OCDS timestamp seeds the year range we scan. |
| `fetch_ansc_decision` | Download an ANSC decision PDF and return its content. Native-text PDFs return extracted text. Scanned PDFs (Canon / HP / etc., common for annexed docs and older filings — typically with broken Unicode CMap that maps Romanian to garbled Cyrillic) return per‑page JPEG `image` blocks for the host vision-LLM to OCR. Force a path with `mode: 'auto' \| 'text' \| 'image'`. Uses `unpdf.extractImages` (extracts already-embedded raster bytes — no canvas backend needed) + `sharp` for re‑encoding. |

All tools:
- declare both `inputSchema` (Zod) and `outputSchema` (Zod), so clients receive
  validated `structuredContent` alongside the human‑readable `text`;
- carry annotations (`readOnlyHint: true`, `idempotentHint: true`,
  `openWorldHint: true|false`, `title`);
- honor cancellation via the `AbortSignal` from the SDK;
- normalize Romanian dates to ISO 8601 (`entryDateIso`, `dateIso`) alongside
  the original `dd/mm/yyyy`;
- strip trailing punctuation from `appealNumber` / `registrationNumber`.

### Prompts (3)

Pre-canned LLM workflows the client surfaces as slash-commands:

| name | args | output |
|---|---|---|
| `summarize_ansc_decision` | `identifier` (decision number or ELO URL) | A starter prompt instructing the model to fetch the decision and produce a structured Romanian/English summary. |
| `procurement_audit` | `procedureNumber` (OCDS ID) | Walks the model through `get_procurement_history` and produces a chronological narrative of every appeal + decision. |
| `compare_appeals` | two registration numbers | Side-by-side comparison of two appeals (parties, grounds, outcome). |

### Resources

Static shortcuts:
- `ansc://appeals/current` — current‑year appeals, page 0
- `ansc://decisions/current` — current‑year decisions, page 0

RFC 6570 templates with `complete` callbacks for `year` (2014–current) and
`page` (0–20):
- `ansc://appeals/{year}`
- `ansc://appeals/{year}/page/{page}`
- `ansc://decisions/{year}`
- `ansc://decisions/{year}/page/{page}`

## Transports

Two transports, picked via `MCP_TRANSPORT`:

- **`stdio`** (default) — for desktop / IDE clients (Claude Desktop, Cursor,
  Continue, …) that spawn the server as a subprocess.
- **`http`** — Streamable HTTP (spec 2025‑03‑26+), with stateful sessions
  (`Mcp-Session-Id`) and SSE streaming on `GET /mcp`. DNS‑rebinding
  protection is enabled automatically when binding to localhost.

## Authentication (optional)

ANSC's data is **public** — anyone can browse `https://www.ansc.md`. So the
default deployment shape is `MCP_TRANSPORT=stdio` (or `http` with
`AUTH_MODE=none` behind a trusted reverse proxy / Tailscale).

OAuth here only protects the *server itself* from abuse, not the data. If you
deploy this on the open internet and want per-principal rate limiting and
audit logs, set `MCP_TRANSPORT=http` and `AUTH_MODE=oauth`. The server then
runs as an **OAuth 2.1 Resource Server** per spec 2025‑11‑25:

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

## Configuration

All env vars are documented in `.env.example`. Highlights:

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

Config is parsed by Zod at startup; mis‑configured envs fail fast.

## Run it

### Local

```bash
git clone git@github.com:nalyk/ansc-mcp-server.git
cd ansc-mcp-server
nvm use                       # honors .nvmrc (Node 24)
npm ci
npm run build
npm start                     # stdio
npm run start:http            # MCP_TRANSPORT=http
npm run inspect               # opens MCP Inspector against the built server
```

### Docker

```bash
docker build -t mcp-ansc-server .
# stdio (the typical MCP usage):
docker run -i --rm mcp-ansc-server
# Streamable HTTP:
docker run --rm -p 3030:3030 -e MCP_TRANSPORT=http -e HTTP_HOST=0.0.0.0 mcp-ansc-server
```

### Wire into Claude Desktop (stdio)

```jsonc
{
  "mcpServers": {
    "ansc": {
      "command": "node",
      "args": ["/abs/path/to/mcp-ansc-server/build/index.js"]
    }
  }
}
```

### Wire as a remote (Streamable HTTP)

Put the server behind TLS (caddy / nginx / fly / cloudflare). Point the MCP
client at `https://mcp.example.com/mcp` with a Bearer token obtained from
your AS. The client must include the `resource` parameter (RFC 8707) when
exchanging tokens, with value `https://mcp.example.com`.

## Operational notes

- Logs are JSON on **stderr** (pino, level via `LOG_LEVEL`). Stdout is
  reserved for the MCP wire.
- Outbound HTTP uses **undici** with a single hostname‑pinned TLS‑bypass
  agent (only `ANSC_TLS_BYPASS_HOSTS` skip cert validation; everything else
  is verified normally). Retries on 5xx/`ECONNRESET` with exponential
  backoff; honors `Retry-After` on 429.
- HTML responses are cached in‑process via `lru-cache` (5 min TTL for the
  current year, 24 h for historical years, configurable).
- The HTML parser maps columns by `<th>` text first; if ANSC reorders or
  renames columns, it falls back to positional and emits a `parserMode:
  'partial'` flag in tool output so the caller knows.

## Project layout

```
src/
  index.ts                # bootstrap — picks transport, wires shutdown
  config.ts               # Zod env schema
  logging.ts              # pino on stderr
  api/
    ansc-client.ts        # undici + retries + lru-cache
    pdf-fetcher.ts        # PDF download + unpdf text/image extract + sharp JPEG
  handlers/
    tools.ts              # 3 tools, Zod input/output, annotations
    resources.ts          # RFC 6570 templates + completions
  handlers/
    prompts.ts            # 3 LLM workflow templates
  http/
    server.ts             # Express + StreamableHTTPServerTransport (stateful)
    auth.ts               # JoseTokenVerifier + PRM router (opt-in)
  models/
    appeals.ts            # AppealStatus + Zod
    decisions.ts          # Decision enums + Zod
    pagination.ts         # Pagination + Zod
  utils/
    html-parser.ts        # header-name + positional, enum round-trip
    identifiers.ts        # Romanian id + date helpers
    retry.ts              # exponential backoff with jitter
__tests__/
  fixtures/*.html         # synthetic ANSC pages
  *.test.ts               # html-parser, config
.github/workflows/ci.yml  # tsc + jest + audit + Dockerfile smoke
Dockerfile                # node:24-alpine, multi-stage, non-root
```

## Testing the OAuth integration

Bring an Auth Server with a JWT-issuing token endpoint and a JWKS. Mint a
token with `aud=https://mcp.example.com`, then:

```bash
curl -fsSL https://mcp.example.com/.well-known/oauth-protected-resource | jq
TOKEN=…
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  https://mcp.example.com/mcp
```

Hit `/mcp` without a token to see the spec‑compliant 401 + `WWW-Authenticate`
header pointing to the PRM URL.

---

## Project meta

- **License:** [MIT](LICENSE) © 2026 Ion Nalyk Calmis
- **Changelog:** [CHANGELOG.md](CHANGELOG.md)
- **Security:** see [SECURITY.md](SECURITY.md)
- **Issues / PRs:** [github.com/nalyk/ansc-mcp-server](https://github.com/nalyk/ansc-mcp-server)
- **MCP spec:** [2025‑11‑25](https://spec.modelcontextprotocol.io/specification/2025-11-25)
