import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('returns sane defaults for an empty env', () => {
    const cfg = loadConfig({});
    expect(cfg.transport).toBe('stdio');
    expect(cfg.auth.mode).toBe('none');
    expect(cfg.ansc.timeoutMs).toBe(30_000);
    expect([...cfg.ansc.tlsBypassHosts]).toEqual([
      'www.ansc.md',
      'elo.ansc.md',
    ]);
    expect(cfg.cache.ttlCurrentS).toBe(300);
  });

  it('refuses oauth http without issuer or public URL', () => {
    expect(() =>
      loadConfig({
        MCP_TRANSPORT: 'http',
        AUTH_MODE: 'oauth',
      }),
    ).toThrow(/OAUTH_ISSUER/);
  });

  it('accepts a fully-configured oauth http setup', () => {
    const cfg = loadConfig({
      MCP_TRANSPORT: 'http',
      AUTH_MODE: 'oauth',
      OAUTH_ISSUER: 'https://auth.example.com',
      HTTP_PUBLIC_URL: 'https://mcp.example.com',
      OAUTH_REQUIRED_SCOPES: 'mcp:read mcp:write',
    });
    expect(cfg.auth.mode).toBe('oauth');
    if (cfg.auth.mode !== 'oauth') return;
    expect(cfg.auth.issuer).toBe('https://auth.example.com');
    expect(cfg.auth.audience).toBe('https://mcp.example.com');
    expect(cfg.auth.requiredScopes).toEqual(['mcp:read', 'mcp:write']);
  });
});
