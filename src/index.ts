#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { logger, errMsg } from './logging.js';
import { AnscClient } from './api/ansc-client.js';
import { registerTools } from './handlers/tools.js';
import { registerResources } from './handlers/resources.js';
import { registerPrompts } from './handlers/prompts.js';
import { buildAuthHandles } from './http/auth.js';
import { startHttpServer } from './http/server.js';
import pkg from '../package.json' with { type: 'json' };

// Single source of truth: read version from the published package.json so
// `serverInfo.version` cannot drift from the npm tarball that ships it.
const NAME = 'ansc-server';
const VERSION: string = pkg.version;

async function main(): Promise<void> {
  const cfg = loadConfig();
  logger.level = cfg.logLevel;
  logger.info(
    {
      transport: cfg.transport,
      auth: cfg.auth.mode,
      ...(cfg.transport === 'http'
        ? { host: cfg.http.host, port: cfg.http.port, publicUrl: cfg.http.publicUrl }
        : {}),
    },
    `${NAME} v${VERSION} starting.`,
  );

  const client = new AnscClient(cfg);

  const createServer = (): McpServer => {
    const server = new McpServer(
      { name: NAME, version: VERSION },
      {
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
          prompts: { listChanged: false },
          logging: {},
        },
        instructions:
          'Tools, resources, and prompts for Moldovan public-procurement appeals (ANSC). ' +
          'All 12 tools are read-only and idempotent. ' +
          'Search: search_appeals, search_decisions, search_orders (încheieri), ' +
          'search_suspended_decisions (court-suspended). ' +
          'Direct lookup: get_appeal_by_registration ("02/<seq>/<yy>"), ' +
          'get_decision_by_number ("<panel>D-<seq>-<yy>"), ' +
          'get_procurement_history (every appeal + decision for an OCDS ID). ' +
          'Hearing schedule: list_upcoming_hearings, get_hearings_for_day, ' +
          'find_hearing_for_appeal ("when is my hearing?"). ' +
          'Documents: check_decision_court_status (cross-checks the suspended listing — ' +
          "search_decisions alone reports stale 'În vigoare' for items a court has paused), " +
          'fetch_ansc_decision (text for native PDFs, per-page images for scanned PDFs ' +
          'so the host vision-LLM can OCR — no local Tesseract). ' +
          'Years: 2014–current. Three prompts (summarize_ansc_decision, procurement_audit, ' +
          'compare_appeals) wrap common analyst workflows.',
      },
    );
    registerTools(server, client);
    registerResources(server, client);
    registerPrompts(server);
    return server;
  };

  const shutdownAborter = new AbortController();
  let httpHandle: Awaited<ReturnType<typeof startHttpServer>> | null = null;
  let stdioServer: McpServer | null = null;

  if (cfg.transport === 'stdio') {
    stdioServer = createServer();
    const transport = new StdioServerTransport();
    await stdioServer.connect(transport);
    logger.info('Connected on stdio.');
  } else {
    const auth = await buildAuthHandles(cfg);
    if (cfg.auth.mode === 'none') {
      logger.warn(
        'AUTH_MODE=none with HTTP transport. This is acceptable for localhost development only — ' +
          'do not expose this server to the public internet without OAuth.',
      );
    }
    httpHandle = await startHttpServer(cfg, createServer, auth);
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down.');
    shutdownAborter.abort();
    try {
      if (httpHandle) await httpHandle.close();
      if (stdioServer) await stdioServer.close();
      await client.close();
    } catch (err) {
      logger.error({ err: errMsg(err) }, 'Error during shutdown.');
    } finally {
      // Give pino a tick to flush.
      setTimeout(() => process.exit(0), 50).unref();
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'Uncaught exception.');
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason: String(reason) }, 'Unhandled promise rejection.');
    void shutdown('unhandledRejection');
  });
}

main().catch((err) => {
  logger.fatal({ err: errMsg(err) }, 'Fatal startup error.');
  process.exit(1);
});
