import { randomUUID } from 'node:crypto';
import express, { type Express, type RequestHandler } from 'express';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger, errMsg } from '../logging.js';
import type { AppConfig } from '../config.js';
import type { AuthHandles } from './auth.js';

export interface HttpServerHandle {
  url: string;
  close: () => Promise<void>;
}

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export async function startHttpServer(
  cfg: AppConfig,
  createServer: () => McpServer,
  auth: AuthHandles | null,
): Promise<HttpServerHandle> {
  const app: Express = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));

  // DNS-rebinding protection: when binding to localhost, only accept loopback hostnames.
  if (cfg.http.host === '127.0.0.1' || cfg.http.host === 'localhost' || cfg.http.host === '::1') {
    app.use(hostHeaderValidation(['localhost', '127.0.0.1', '[::1]']));
  }

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', transport: 'streamable-http', auth: cfg.auth.mode });
  });

  if (auth) {
    app.use(auth.metadataRouter);
  }

  const sessions = new Map<string, Session>();
  const protect: RequestHandler = auth ? auth.requireAuth : (_req, _res, next) => next();

  async function buildSession(): Promise<Session> {
    const server = createServer();
    let sessionId: string | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessionId = sid;
        sessions.set(sid, { server, transport });
        logger.info({ sessionId: sid }, 'New MCP session.');
      },
      onsessionclosed: (sid) => {
        sessions.delete(sid);
        void server.close();
        logger.info({ sessionId: sid }, 'MCP session closed.');
      },
    });
    transport.onerror = (err) => logger.error({ err: err.message }, 'Transport error.');
    transport.onclose = () => {
      if (sessionId) sessions.delete(sessionId);
    };
    await server.connect(transport);
    return { server, transport };
  }

  app.post('/mcp', protect, async (req, res) => {
    try {
      const sessionId = req.header('mcp-session-id');
      let entry = sessionId ? sessions.get(sessionId) : undefined;

      if (!entry) {
        if (!isInitializeRequest(req.body)) {
          res.status(400).json({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32000,
              message:
                'Missing or invalid Mcp-Session-Id; send an initialize request first.',
            },
          });
          return;
        }
        entry = await buildSession();
      }

      await entry.transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err: errMsg(err) }, 'Error handling POST /mcp.');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'Internal server error' },
        });
      }
    }
  });

  const handleSessionRequest: RequestHandler = async (req, res) => {
    const sessionId = req.header('mcp-session-id');
    const entry = sessionId ? sessions.get(sessionId) : undefined;
    if (!entry) {
      res.status(404).end();
      return;
    }
    try {
      await entry.transport.handleRequest(req, res);
    } catch (err) {
      logger.error({ err: errMsg(err) }, 'Error handling GET/DELETE /mcp.');
      if (!res.headersSent) res.status(500).end();
    }
  };

  app.get('/mcp', protect, handleSessionRequest);
  app.delete('/mcp', protect, handleSessionRequest);

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(cfg.http.port, cfg.http.host, () => {
      const url = `http://${cfg.http.host}:${cfg.http.port}`;
      logger.info({ url, auth: cfg.auth.mode }, 'MCP Streamable HTTP server listening.');
      resolve({
        url,
        close: async () => {
          await new Promise<void>((r) => httpServer.close(() => r()));
          await Promise.allSettled(
            Array.from(sessions.values()).flatMap((s) => [s.server.close(), s.transport.close()]),
          );
          sessions.clear();
        },
      });
    });
    httpServer.on('error', reject);
  });
}
