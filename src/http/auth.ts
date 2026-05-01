import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyOptions,
} from 'jose';
import type { RequestHandler } from 'express';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { logger, errMsg } from '../logging.js';
import type { AppConfig } from '../config.js';

/**
 * Verifies bearer tokens against the configured OAuth 2.1 Authorization Server.
 *
 * Conformance:
 * - RFC 9068 (JWT access tokens)
 * - RFC 8707 (audience binding via the `aud` claim)
 * - Token-passthrough is forbidden by spec; this verifier validates `aud` so a token
 *   minted for a different resource is rejected.
 */
export class JoseTokenVerifier implements OAuthTokenVerifier {
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;
  readonly #verifyOptions: JWTVerifyOptions;
  readonly #requiredScopes: ReadonlySet<string>;

  constructor(args: {
    issuer: string;
    audience: string;
    jwksUrl: string;
    requiredScopes: string[];
  }) {
    this.#jwks = createRemoteJWKSet(new URL(args.jwksUrl), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
    this.#verifyOptions = {
      issuer: args.issuer,
      audience: args.audience,
    };
    this.#requiredScopes = new Set(args.requiredScopes);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.#jwks, this.#verifyOptions));
    } catch (err) {
      // Keep a friendly literal fallback rather than errMsg(): InvalidTokenError messages
      // surface to clients, and 'invalid token' beats stringifying a non-Error throw.
      const message = err instanceof Error ? err.message : 'invalid token';
      logger.debug({ err: message }, 'Bearer token failed JWT verification.');
      throw new InvalidTokenError(message);
    }

    const scopes = parseScopes(payload['scope']);
    for (const required of this.#requiredScopes) {
      if (!scopes.includes(required)) {
        throw new InvalidTokenError(`missing required scope: ${required}`);
      }
    }

    const clientId =
      typeof payload['client_id'] === 'string'
        ? payload['client_id']
        : typeof payload.sub === 'string'
          ? payload.sub
          : 'unknown';

    const info: AuthInfo = {
      token,
      clientId,
      scopes,
      ...(typeof payload.exp === 'number' ? { expiresAt: payload.exp } : {}),
    };
    return info;
  }
}

function parseScopes(claim: unknown): string[] {
  if (typeof claim === 'string') return claim.split(/\s+/).filter(Boolean);
  if (Array.isArray(claim)) return claim.filter((s): s is string => typeof s === 'string');
  return [];
}

/**
 * Discover an OAuth Authorization Server's metadata document. Tries OAuth (RFC 8414)
 * first, then OpenID Connect (RFC 8414/OIDC Discovery).
 */
export async function discoverAuthServerMetadata(
  issuer: string,
): Promise<{ metadata: OAuthMetadata; jwksUrl: string }> {
  const candidates = [
    new URL('/.well-known/oauth-authorization-server', issuer).toString(),
    new URL('/.well-known/openid-configuration', issuer).toString(),
  ];
  let lastErr: unknown;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        lastErr = new Error(`${url} → HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as Record<string, unknown> & OAuthMetadata;
      const jwksUrl =
        typeof data['jwks_uri'] === 'string' ? (data['jwks_uri'] as string) : undefined;
      if (!jwksUrl) {
        lastErr = new Error(`${url} did not advertise jwks_uri`);
        continue;
      }
      return { metadata: data, jwksUrl };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to discover Authorization Server metadata at ${issuer}: ${errMsg(lastErr)}`,
  );
}

/**
 * Bundles the OAuth-related Express plumbing: PRM router (publishes
 * /.well-known/oauth-protected-resource) and a bearer-token middleware that
 * sets `req.auth` on success.
 */
export interface AuthHandles {
  metadataRouter: RequestHandler;
  requireAuth: RequestHandler;
  resourceMetadataUrl: string;
}

export async function buildAuthHandles(cfg: AppConfig): Promise<AuthHandles | null> {
  if (cfg.transport !== 'http' || cfg.auth.mode !== 'oauth') return null;

  const { issuer, audience, requiredScopes } = cfg.auth;
  const jwksUrl =
    cfg.auth.jwksUrl ?? (await discoverAuthServerMetadata(issuer)).jwksUrl;
  const { metadata } = await discoverAuthServerMetadata(issuer);

  const verifier = new JoseTokenVerifier({
    issuer,
    audience,
    jwksUrl,
    requiredScopes,
  });

  const resourceServerUrl = new URL(audience);
  const metadataRouter = mcpAuthMetadataRouter({
    oauthMetadata: metadata,
    resourceServerUrl,
    resourceName: 'mcp-ansc-server',
    scopesSupported: requiredScopes.length > 0 ? requiredScopes : ['mcp:read'],
  });

  // The PRM is published at `/.well-known/oauth-protected-resource{path}`
  // where `path` is the audience pathname (or empty if root).
  const prmPath =
    resourceServerUrl.pathname === '/' || resourceServerUrl.pathname === ''
      ? ''
      : resourceServerUrl.pathname;
  const resourceMetadataUrl = new URL(
    `/.well-known/oauth-protected-resource${prmPath}`,
    audience,
  ).toString();

  const requireAuth = requireBearerAuth({
    verifier,
    requiredScopes,
    resourceMetadataUrl,
  });

  logger.info(
    { issuer, audience, jwksUrl, resourceMetadataUrl, requiredScopes },
    'OAuth Resource Server enabled.',
  );

  return { metadataRouter, requireAuth, resourceMetadataUrl };
}
