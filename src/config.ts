import { z } from 'zod';

const boolish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform((v) => v === true || v === 'true' || v === '1' || v === 'yes');

const csvList = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const Schema = z
  .object({
    MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),

    HTTP_HOST: z.string().min(1).default('127.0.0.1'),
    HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3030),
    HTTP_PUBLIC_URL: z.string().url().optional(),

    AUTH_MODE: z.enum(['none', 'oauth']).default('none'),
    OAUTH_ISSUER: z.string().url().optional(),
    OAUTH_JWKS_URL: z.string().url().optional(),
    OAUTH_REQUIRED_SCOPES: z.string().optional().default(''),

    ANSC_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    ANSC_TLS_BYPASS_HOSTS: z
      .string()
      .default('www.ansc.md,elo.ansc.md')
      .pipe(csvList),
    ANSC_USER_AGENT: z
      .string()
      .default(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ),

    CACHE_TTL_CURRENT_S: z.coerce.number().int().nonnegative().default(300),
    CACHE_TTL_HISTORICAL_S: z.coerce.number().int().nonnegative().default(86_400),
    CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(500),

    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.MCP_TRANSPORT === 'http' && env.AUTH_MODE === 'oauth') {
      if (!env.OAUTH_ISSUER) {
        ctx.addIssue({
          code: 'custom',
          path: ['OAUTH_ISSUER'],
          message: 'OAUTH_ISSUER is required when AUTH_MODE=oauth',
        });
      }
      if (!env.HTTP_PUBLIC_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['HTTP_PUBLIC_URL'],
          message:
            'HTTP_PUBLIC_URL is required when AUTH_MODE=oauth (used as the resource audience per RFC 8707)',
        });
      }
    }
  });

export type AppConfig = {
  transport: 'stdio' | 'http';
  http: {
    host: string;
    port: number;
    publicUrl: string | undefined;
  };
  auth:
    | { mode: 'none' }
    | {
        mode: 'oauth';
        issuer: string;
        jwksUrl: string | undefined;
        audience: string;
        requiredScopes: string[];
      };
  ansc: {
    timeoutMs: number;
    tlsBypassHosts: ReadonlySet<string>;
    userAgent: string;
  };
  cache: {
    ttlCurrentS: number;
    ttlHistoricalS: number;
    maxEntries: number;
  };
  logLevel: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`,
    );
    throw new Error(`Invalid environment config:\n${lines.join('\n')}`);
  }
  const e = parsed.data;

  const auth: AppConfig['auth'] =
    e.AUTH_MODE === 'oauth'
      ? {
          mode: 'oauth',
          issuer: e.OAUTH_ISSUER!,
          jwksUrl: e.OAUTH_JWKS_URL,
          audience: e.HTTP_PUBLIC_URL!,
          requiredScopes: e.OAUTH_REQUIRED_SCOPES.split(/\s+/).filter(Boolean),
        }
      : { mode: 'none' };

  return {
    transport: e.MCP_TRANSPORT,
    http: {
      host: e.HTTP_HOST,
      port: e.HTTP_PORT,
      publicUrl: e.HTTP_PUBLIC_URL,
    },
    auth,
    ansc: {
      timeoutMs: e.ANSC_HTTP_TIMEOUT_MS,
      tlsBypassHosts: new Set(e.ANSC_TLS_BYPASS_HOSTS),
      userAgent: e.ANSC_USER_AGENT,
    },
    cache: {
      ttlCurrentS: e.CACHE_TTL_CURRENT_S,
      ttlHistoricalS: e.CACHE_TTL_HISTORICAL_S,
      maxEntries: e.CACHE_MAX_ENTRIES,
    },
    logLevel: e.LOG_LEVEL,
  };
}
