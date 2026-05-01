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
  parseOrdersTable,
  parseSuspendedDecisionsTable,
  parseAgendaListing,
  parseAgendaDay,
  ParseResult,
} from '../utils/html-parser.js';
import type { Order } from '../models/orders.js';
import type { SuspendedDecision } from '../models/suspended.js';
import type { Hearing, HearingDay } from '../models/hearings.js';
import { withRetry } from '../utils/retry.js';
import type { AppConfig } from '../config.js';
import { logger } from '../logging.js';
import {
  cleanAppealNumber,
  yearFromAppealRegistration,
  yearFromDecisionNumber,
  yearFromOcdsId,
} from '../utils/identifiers.js';

const FIND_PAGE_CONCURRENCY = 5;
const FIND_PAGE_HARD_CAP = 100; // safety against runaway scans

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

  async searchOrders(
    year: number | undefined,
    page: number,
    kind: 'general' | 'suspension',
    signal?: AbortSignal,
  ): Promise<ParseResult<Order>> {
    const y = year ?? new Date().getFullYear();
    const slug = kind === 'suspension' ? 'incheieri-de-suspendare' : 'incheieri';
    const qs = new URLSearchParams();
    if (page > 0) qs.append('page', String(page));
    const url = new URL(
      `/ro/content/${slug}-${y}${qs.size ? '?' + qs.toString() : ''}`,
      ANSC_BASE,
    );
    const html = await this.#fetchHtml(url, y, signal);
    return parseOrdersTable(html, { requestedPage: page });
  }

  async searchSuspendedDecisions(
    year: number | undefined,
    page: number,
    signal?: AbortSignal,
  ): Promise<ParseResult<SuspendedDecision>> {
    const y = year ?? new Date().getFullYear();
    const qs = new URLSearchParams();
    if (page > 0) qs.append('page', String(page));
    const url = new URL(
      `/ro/content/decizii-suspendate-${y}${qs.size ? '?' + qs.toString() : ''}`,
      ANSC_BASE,
    );
    const html = await this.#fetchHtml(url, y, signal);
    return parseSuspendedDecisionsTable(html, { requestedPage: page });
  }

  async listUpcomingHearings(signal?: AbortSignal): Promise<HearingDay[]> {
    const url = new URL('/ro/agenda', ANSC_BASE);
    const html = await this.#fetchHtml(url, new Date().getFullYear(), signal);
    return parseAgendaListing(html, ANSC_BASE);
  }

  async getHearingsForDay(
    agendaUrl: string,
    signal?: AbortSignal,
  ): Promise<{ dateIso: string | null; hearings: Hearing[] }> {
    const url = new URL(agendaUrl, ANSC_BASE);
    const html = await this.#fetchHtml(url, new Date().getFullYear(), signal);
    return parseAgendaDay(html, url.toString());
  }

  /**
   * Across the upcoming-agenda listing, look for any hearing with the given
   * appeal registration number. Returns matches with their hearing details.
   */
  async findHearingForAppeal(
    rawRegistrationNumber: string,
    signal?: AbortSignal,
  ): Promise<Hearing[]> {
    const target = cleanAppealNumber(rawRegistrationNumber);
    const days = await this.listUpcomingHearings(signal);
    const matches: Hearing[] = [];
    for (const day of days) {
      const { hearings } = await this.getHearingsForDay(day.url, signal);
      for (const h of hearings) {
        if (cleanAppealNumber(h.registrationNumber) === target) {
          matches.push(h);
        }
      }
    }
    return matches;
  }

  /**
   * Cross-checks the suspended-decisions listing for any decision matching the
   * given regular decision number's year+appealNumber. Used to surface court
   * suspension status alongside `get_decision_by_number`.
   */
  async findSuspendedFromDecision(
    decision: { decisionNumber: string; appealNumber: string },
    signal?: AbortSignal,
  ): Promise<SuspendedDecision | null> {
    const year = yearFromDecisionNumber(decision.decisionNumber);
    const target = cleanAppealNumber(decision.appealNumber);
    if (!target) return null;
    // Suspension orders may be issued in the same or next year.
    for (const yr of [year, year + 1]) {
      const first = await this.searchSuspendedDecisions(yr, 0, signal);
      const all = first.items.slice();
      const total = Math.min(first.pagination.totalPages, FIND_PAGE_HARD_CAP);
      for (let p = 1; p < total; p++) {
        const r = await this.searchSuspendedDecisions(yr, p, signal);
        all.push(...r.items);
      }
      const hit = all.find(
        (s) => cleanAppealNumber(s.appealNumber) === target,
      );
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Direct lookup of a single appeal by its registration number (e.g. '02/1245/24').
   * Year is parsed from the registration suffix; pages are scanned with bounded
   * concurrency. Subsequent lookups in the same year hit the HTML cache.
   */
  async findAppealByRegistration(
    rawRegistrationNumber: string,
    signal?: AbortSignal,
  ): Promise<Appeal | null> {
    const target = cleanAppealNumber(rawRegistrationNumber);
    const year = yearFromAppealRegistration(target);
    return this.#scanForMatch(
      (page) => this.searchAppeals({ year, page }, signal),
      (a) => a.registrationNumber === target,
    );
  }

  /**
   * Direct lookup of a single decision by its decision number (e.g. '03D-962-24').
   */
  async findDecisionByNumber(
    rawDecisionNumber: string,
    signal?: AbortSignal,
  ): Promise<Decision | null> {
    const target = cleanAppealNumber(rawDecisionNumber);
    const year = yearFromDecisionNumber(target);
    return this.#scanForMatch(
      (page) => this.searchDecisions({ year, page }, signal),
      (d) => d.decisionNumber === target,
    );
  }

  /**
   * Given an OCDS procurement ID, return every appeal filed against it AND every
   * decision touching it. Appeals are filtered server-side via ANSC's procedure
   * filter; decisions are looked up per linked appeal (ANSC has no direct
   * procedure-number filter for the decisions endpoint).
   */
  async findCaseByProcedure(
    procedureNumber: string,
    signal?: AbortSignal,
  ): Promise<{ appeals: Appeal[]; decisions: Decision[]; yearsScanned: number[] }> {
    const trimmedOcds = procedureNumber.trim();
    const yearsScanned = yearsToScanForOcds(trimmedOcds);
    const appeals = await this.#collectAppealsForProcedure(trimmedOcds, yearsScanned, signal);
    const decisions = await this.#collectDecisionsForAppeals(
      appeals,
      trimmedOcds,
      yearsScanned,
      signal,
    );
    return { appeals, decisions, yearsScanned };
  }

  /** Fan out across candidate years; ANSC's appeals search is keyed by year. */
  async #collectAppealsForProcedure(
    procedureNumber: string,
    years: number[],
    signal: AbortSignal | undefined,
  ): Promise<Appeal[]> {
    const lists = await Promise.all(
      years.map((year) =>
        this.#paginateAll((page) =>
          this.searchAppeals({ procedureNumber, year, page }, signal),
        ),
      ),
    );
    const seen = new Set<string>();
    const appeals: Appeal[] = [];
    for (const list of lists) {
      for (const a of list) {
        if (seen.has(a.registrationNumber)) continue;
        seen.add(a.registrationNumber);
        appeals.push(a);
      }
    }
    return appeals;
  }

  /**
   * For each appeal, look up the decisions that reference its registration
   * number (in the same year or the next), then keep only those whose
   * `procedureNumber` matches the procurement we're investigating.
   */
  async #collectDecisionsForAppeals(
    appeals: Appeal[],
    procedureNumber: string,
    yearsScanned: number[],
    signal: AbortSignal | undefined,
  ): Promise<Decision[]> {
    const seen = new Set<string>();
    const decisions: Decision[] = [];
    for (const appeal of appeals) {
      const cleanedReg = cleanAppealNumber(appeal.registrationNumber);
      if (!cleanedReg) continue;
      const appealYear = yearFromAppealRegistration(cleanedReg);
      // The decision linked to an appeal is published in the same or next year.
      const decisionYears = yearsScanned.includes(appealYear)
        ? yearsScanned
        : [appealYear, appealYear + 1];
      const lists = await Promise.all(
        decisionYears.map((y) =>
          this.#paginateAll((page) =>
            this.searchDecisions({ appealNumber: cleanedReg, year: y, page }, signal),
          ),
        ),
      );
      for (const list of lists) {
        for (const d of list) {
          if (d.procedureNumber !== procedureNumber) continue;
          if (seen.has(d.decisionNumber)) continue;
          seen.add(d.decisionNumber);
          decisions.push(d);
        }
      }
    }
    return decisions;
  }

  async #scanForMatch<T>(
    fetchPage: (page: number) => Promise<{
      items: T[];
      pagination: { totalPages: number; hasNextPage: boolean };
    }>,
    predicate: (item: T) => boolean,
  ): Promise<T | null> {
    const first = await fetchPage(0);
    const hit = first.items.find(predicate);
    if (hit) return hit;
    const total = Math.min(first.pagination.totalPages, FIND_PAGE_HARD_CAP);
    if (total <= 1) return null;

    const remaining = Array.from({ length: total - 1 }, (_, i) => i + 1);
    for (let i = 0; i < remaining.length; i += FIND_PAGE_CONCURRENCY) {
      const batch = remaining.slice(i, i + FIND_PAGE_CONCURRENCY);
      const results = await Promise.all(batch.map(fetchPage));
      for (const r of results) {
        const m = r.items.find(predicate);
        if (m) return m;
      }
    }
    return null;
  }

  async #paginateAll<T>(
    fetchPage: (page: number) => Promise<{
      items: T[];
      pagination: { hasNextPage: boolean; totalPages: number };
    }>,
  ): Promise<T[]> {
    const out: T[] = [];
    const first = await fetchPage(0);
    out.push(...first.items);
    if (!first.pagination.hasNextPage) return out;
    const total = Math.min(first.pagination.totalPages, FIND_PAGE_HARD_CAP);
    for (let p = 1; p < total; p++) {
      const r = await fetchPage(p);
      out.push(...r.items);
      if (!r.pagination.hasNextPage) break;
    }
    return out;
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

function yearsToScanForOcds(ocdsId: string): number[] {
  const fromTimestamp = yearFromOcdsId(ocdsId);
  const current = new Date().getUTCFullYear();
  if (fromTimestamp !== null) {
    // Procurement created in year N may collect appeals through N+2.
    const start = Math.max(2014, fromTimestamp);
    const end = Math.min(current, fromTimestamp + 2);
    const out: number[] = [];
    for (let y = start; y <= end; y++) out.push(y);
    return out;
  }
  // No timestamp parseable — scan the last 5 years.
  const out: number[] = [];
  for (let y = current; y >= Math.max(2014, current - 4); y--) out.push(y);
  return out;
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
