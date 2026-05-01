#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { logger } from './logging.js';
import { AnscClient } from './api/ansc-client.js';
import { registerTools } from './handlers/tools.js';
import { registerResources } from './handlers/resources.js';
import { buildAuthHandles } from './http/auth.js';
import { startHttpServer } from './http/server.js';

const NAME = 'ansc-server';
const VERSION = '1.0.0-rc.1';

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
          logging: {},
        },
        instructions:
          'Tools and resources for searching Moldovan public-procurement appeals (ANSC) and ' +
          'fetching decision PDFs. All tools are read-only and idempotent. Use search_appeals / ' +
          'search_decisions for browsing, fetch_ansc_decision for a single PDF. Years: 2014–current.',
      },
    );
    registerTools(server, client);
    registerResources(server, client);
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
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Error during shutdown.');
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
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, 'Fatal startup error.');
  process.exit(1);
});
