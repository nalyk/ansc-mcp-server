import { Agent, fetch, errors as undiciErrors } from 'undici';
import { LRUCache } from 'lru-cache';
import {
  Appeal,
  AppealSearchParams,
} from '../models/appeals.js';
import {
  Decision,
  DecisionSearchParams,
} from '../models/decisions.js';
import {
  PaginatedResponse,
  PaginationParams,
} from '../models/pagination.js';
import {
  parseAppealsTable,
  parseDecisionsTable,
  ParseResult,
} from '../utils/html-parser.js';
import { withRetry } from '../utils/retry.js';
import type { AppConfig } from '../config.js';
import { logger } from '../logging.js';

const ANSC_BASE = 'https://www.ansc.md';

export class AnscClient {
  readonly #trustedAgent: Agent;
  readonly #insecureAgent: Agent;
  readonly #userAgent: string;
  readonly #timeoutMs: number;
  readonly #bypassHosts: ReadonlySet<string>;
  readonly #cache: LRUCache<string, string>;
  readonly #ttlCurrentMs: number;
  readonly #ttlHistoricalMs: number;

  constructor(cfg: AppConfig) {
    this.#userAgent = cfg.ansc.userAgent;
    this.#timeoutMs = cfg.ansc.timeoutMs;
    this.#bypassHosts = cfg.ansc.tlsBypassHosts;
    this.#trustedAgent = new Agent({
      headersTimeout: this.#timeoutMs,
      bodyTimeout: this.#timeoutMs,
      connectTimeout: 10_000,
    });
    this.#insecureAgent = new Agent({
      headersTimeout: this.#timeoutMs,
      bodyTimeout: this.#timeoutMs,
      connectTimeout: 10_000,
      connect: { rejectUnauthorized: false },
    });
    this.#cache = new LRUCache<string, string>({
      max: cfg.cache.maxEntries,
      ttl: cfg.cache.ttlCurrentS * 1000,
      ttlAutopurge: false,
      allowStale: false,
    });
    this.#ttlCurrentMs = cfg.cache.ttlCurrentS * 1000;
    this.#ttlHistoricalMs = cfg.cache.ttlHistoricalS * 1000;
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.#trustedAgent.close(), this.#insecureAgent.close()]);
  }

  async searchAppeals(
    params: AppealSearchParams & PaginationParams,
    signal?: AbortSignal,
  ): Promise<ParseResult<Appeal>> {
    const year = params.year ?? new Date().getFullYear();
    const qs = new URLSearchParams();
    if (params.authority) qs.append('AutoritateaContractanta', params.authority);
    if (params.challenger) qs.append('Contestatar', params.challenger);
    if (params.procedureNumber) qs.append('NrProcedurii', `"${params.procedureNumber}"`);
    if (params.status !== undefined) qs.append('solr_document', String(params.status));
    if (params.page && params.page > 0) qs.append('page', String(params.page));

    const url = new URL(
      `/ro/contestatii/${year}${qs.size ? '?' + qs.toString() : ''}`,
      ANSC_BASE,
    );
    const html = await this.#fetchHtml(url, year, signal);
    return parseAppealsTable(html, { requestedPage: params.page ?? 0 });
  }

  async searchDecisions(
    params: DecisionSearchParams & PaginationParams,
    signal?: AbortSignal,
  ): Promise<ParseResult<Decision>> {
    const year = params.year ?? new Date().getFullYear();
    const qs = new URLSearchParams();
    if (params.challenger) qs.append('Contestatar', params.challenger);
    if (params.authority) qs.append('AutoritateaContractanta', `"${params.authority}"`);
    if (params.procurementObject) qs.append('ObiectulAchizitiei', params.procurementObject);
    params.decisionStatus?.forEach((s) => qs.append('solr_document_1', String(s)));
    params.decisionContent?.forEach((c) => qs.append('solr_document_2', String(c)));
    params.appealGrounds?.forEach((g) => qs.append('solr_document_3[]', String(g)));
    if (params.complaintObject !== undefined) {
      qs.append('solr_document_4', String(params.complaintObject));
    }
    if (params.appealNumber) qs.append('solr_document_8', params.appealNumber);
    if (params.page && params.page > 0) qs.append('page', String(params.page));

    const url = new URL(
      `/ro/content/decizii-${year}${qs.size ? '?' + qs.toString() : ''}`,
      ANSC_BASE,
    );
    const html = await this.#fetchHtml(url, year, signal);
    return parseDecisionsTable(html, { requestedPage: params.page ?? 0 });
  }

  /**
   * Streams a binary file (e.g. an ELO PDF). No caching — PDFs are large and
   * already content-addressed by their `id` query param.
   */
  async fetchBinary(
    url: URL,
    signal: AbortSignal | undefined,
    onProgress?: (received: number, total: number | null) => void,
  ): Promise<{ body: Uint8Array; contentType: string; filename: string | null }> {
    const dispatcher = this.#bypassHosts.has(url.hostname) ? this.#insecureAgent : this.#trustedAgent;
    const res = await fetch(url, {
      method: 'GET',
      dispatcher,
      headers: this.#defaultHeaders(),
      signal,
    });
    if (!res.ok) {
      throw new Error(`Upstream ${res.status} ${res.statusText} for ${url.toString()}`);
    }
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const disposition = res.headers.get('content-disposition');
    const filename = parseFilename(disposition);
    const totalHeader = res.headers.get('content-length');
    const total = totalHeader ? Number(totalHeader) : null;

    if (!res.body) throw new Error('Empty response body');
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onProgress?.(received, total);
      }
    }
    const body = concatUint8(chunks, received);
    return { body, contentType, filename };
  }

  async #fetchHtml(url: URL, year: number, signal: AbortSignal | undefined): Promise<string> {
    const cacheKey = url.toString();
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined) {
      logger.debug({ url: cacheKey }, 'HTML cache hit.');
      return cached;
    }

    const dispatcher = this.#bypassHosts.has(url.hostname) ? this.#insecureAgent : this.#trustedAgent;
    const html = await withRetry(
      async () => {
        const res = await fetch(url, {
          method: 'GET',
          dispatcher,
          headers: this.#defaultHeaders(),
          ...(signal ? { signal } : {}),
        });
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after') ?? '0');
          throw new RetryableHttpError(
            `429 Too Many Requests (retry-after=${retryAfter}s)`,
            429,
            retryAfter * 1000,
          );
        }
        if (res.status >= 500 && res.status < 600) {
          throw new RetryableHttpError(`Upstream ${res.status} ${res.statusText}`, res.status);
        }
        if (!res.ok) {
          throw new Error(`Upstream ${res.status} ${res.statusText} for ${url.toString()}`);
        }
        return res.text();
      },
      {
        tries: 3,
        baseMs: 500,
        maxMs: 5_000,
        ...(signal ? { signal } : {}),
        label: `GET ${url.pathname}`,
        isRetryable,
      },
    );

    const ttl = year === new Date().getFullYear() ? this.#ttlCurrentMs : this.#ttlHistoricalMs;
    this.#cache.set(cacheKey, html, { ttl });
    return html;
  }

  #defaultHeaders(): Record<string, string> {
    return {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8',
      'Accept-Language': 'ro,en;q=0.7',
      'User-Agent': this.#userAgent,
    };
  }
}

class RetryableHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'RetryableHttpError';
    this.status = status;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof RetryableHttpError) return true;
  if (err instanceof undiciErrors.UndiciError) {
    return (
      err instanceof undiciErrors.SocketError ||
      err instanceof undiciErrors.ConnectTimeoutError ||
      err instanceof undiciErrors.HeadersTimeoutError ||
      err instanceof undiciErrors.BodyTimeoutError
    );
  }
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN';
  }
  return false;
}

function parseFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(contentDisposition);
  if (star?.[1]) return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
  const plain = /filename=("?)([^";]+)\1/i.exec(contentDisposition);
  return plain?.[2] ?? null;
}

function concatUint8(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
