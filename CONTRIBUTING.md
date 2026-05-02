# Contributing to mcp-ansc-server

Thanks for your interest. This is a Model Context Protocol server that exposes
Moldova's National Agency for Solving Complaints (ANSC) appeals, decisions,
and hearing data to AI agents. Production-grade code, real test coverage,
no decoration.

## Reporting bugs

Open a bug report via [Issues](https://github.com/nalyk/ansc-mcp-server/issues/new)
with the command you ran, the actual vs. expected output, and the server +
Node version.

**Never paste OAuth tokens, refresh tokens, or any auth payload from `AUTH_MODE=oauth`
runs.** If the issue depends on auth, redact the token to the first 6 characters.

## Reporting security issues

Do **not** open a public issue. See [SECURITY.md](./SECURITY.md) for the private
disclosure flow via GitHub Security Advisories.

## Suggesting features

Open a [Discussion](https://github.com/nalyk/ansc-mcp-server/discussions) for
open-ended ideas, or an issue if you have a concrete proposal.

## Development setup

Requires Node.js >= 22.

```bash
git clone git@github.com:nalyk/ansc-mcp-server.git
cd ansc-mcp-server
npm install
npm run build
npm test
```

Run the server locally over stdio (the default MCP transport):

```bash
npm run start
```

Or the HTTP transport with stateful sessions:

```bash
MCP_TRANSPORT=http npm run start
```

Connect Claude Desktop, Cursor, or any MCP client per the README.

## Pull request checklist

- One concern per PR. Avoid bundling unrelated changes.
- `npm test` passes.
- `npm run typecheck` clean.
- New tools, prompts, or resources updated in the README "Tools" / "Prompts" /
  "Resources" sections — those tables are parsed automatically by the
  [Yoda Digital open-source portal](https://opensource.yoda.digital/projects/ansc-mcp-server/).
- Stdout is reserved for the MCP protocol stream when `MCP_TRANSPORT=stdio`.
  Any new logging path must go to stderr or the structured logger; writes to
  stdout outside the protocol corrupt every active session.

## Style

The code is TypeScript strict. Run `npm run lint` before pushing. Follow the
existing module shape — don't introduce new patterns without a reason.

## License

By contributing you agree that your contributions will be licensed under the
project's [MIT license](./LICENSE).
