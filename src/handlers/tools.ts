import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnscClient } from '../api/ansc-client.js';
import {
  AppealSchema,
  AppealSearchInputShape,
} from '../models/appeals.js';
import {
  DecisionSchema,
  DecisionSearchInputShape,
} from '../models/decisions.js';
import { PaginationSchema } from '../models/pagination.js';
import { fetchAndExtractPdf, ELO_URL_PATTERN } from '../api/pdf-fetcher.js';
import {
  yearFromAppealRegistration,
  yearFromDecisionNumber,
} from '../utils/identifiers.js';
import { logger } from '../logging.js';

function yearFromRegOrDecision(kind: 'appeal' | 'decision', id: string): number {
  return kind === 'appeal' ? yearFromAppealRegistration(id) : yearFromDecisionNumber(id);
}

const SearchAppealsOutputShape = {
  items: z.array(AppealSchema),
  pagination: PaginationSchema,
  parserMode: z.enum(['header', 'partial', 'positional']),
  unknownHeaders: z.array(z.string()),
  unknownStatuses: z.array(z.string()),
} as const;

const SearchDecisionsOutputShape = {
  items: z.array(DecisionSchema),
  pagination: PaginationSchema,
  parserMode: z.enum(['header', 'partial', 'positional']),
  unknownHeaders: z.array(z.string()),
  unknownStatuses: z.array(z.string()),
} as const;

const GetAppealInputShape = {
  registrationNumber: z
    .string()
    .min(3)
    .describe("Appeal registration number, e.g. '02/1245/24'."),
} as const;

const GetAppealOutputShape = {
  found: z.boolean(),
  appeal: AppealSchema.nullable(),
  yearScanned: z.number().int().positive(),
} as const;

const GetDecisionInputShape = {
  decisionNumber: z
    .string()
    .min(3)
    .describe("Decision number, e.g. '03D-962-24'."),
} as const;

const GetDecisionOutputShape = {
  found: z.boolean(),
  decision: DecisionSchema.nullable(),
  yearScanned: z.number().int().positive(),
} as const;

const GetProcurementHistoryInputShape = {
  procedureNumber: z
    .string()
    .min(5)
    .describe("OCDS procurement ID, e.g. 'ocds-b3wdp1-MD-1740472744894'."),
} as const;

const GetProcurementHistoryOutputShape = {
  procedureNumber: z.string(),
  yearsScanned: z.array(z.number().int()),
  appeals: z.array(AppealSchema),
  decisions: z.array(DecisionSchema),
} as const;

const FetchDecisionInputShape = {
  documentUrl: z
    .string()
    .url()
    .regex(ELO_URL_PATTERN, 'Must be a https://elo.ansc.md/DownloadDocs/DownloadFileServlet?id=<digits> URL.')
    .describe('Full ELO download URL of the decision PDF.'),
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(5_000_000)
    .optional()
    .default(2_000_000)
    .describe('Truncate the extracted text to at most this many bytes (default 2 MB).'),
} as const;

const FetchDecisionOutputShape = {
  text: z.string(),
  truncated: z.boolean(),
  originalBytes: z.number().int().nonnegative(),
  metadata: z.object({
    filename: z.string(),
    contentType: z.string(),
    source: z.string().url(),
    pageCount: z.number().int().nonnegative(),
    byteLength: z.number().int().nonnegative(),
    pdfInfo: z.record(z.string(), z.unknown()).nullable(),
  }),
} as const;

export function registerTools(server: McpServer, client: AnscClient): void {
  server.registerTool(
    'search_appeals',
    {
      title: 'Search ANSC appeals',
      description:
        'Search public-procurement appeals filed with the Moldovan ANSC (Agenția Națională pentru Soluționarea Contestațiilor). ' +
        'Filters: year, contracting authority, challenger, OCDS procedure number, status. Paginated, 30 items per page.',
      inputSchema: AppealSearchInputShape,
      outputSchema: SearchAppealsOutputShape,
      annotations: {
        title: 'Search ANSC appeals',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
        destructiveHint: false,
      },
    },
    async (args, extra) => {
      const result = await client.searchAppeals(args, extra.signal);
      logger.debug({ count: result.items.length, page: args.page }, 'search_appeals returned.');
      return {
        content: [
          {
            type: 'text',
            text: summarizeAppeals(result.items.length, args.year, result.pagination.totalPages),
          },
        ],
        structuredContent: { ...result } as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'search_decisions',
    {
      title: 'Search ANSC decisions',
      description:
        'Search ANSC decisions on appeals (issued, in force, canceled, etc.). ' +
        'Filters: year, contracting authority, challenger, procurement object, decision status, decision content, ' +
        'appeal grounds, complaint object, appeal registration number. Paginated, 30 items per page.',
      inputSchema: DecisionSearchInputShape,
      outputSchema: SearchDecisionsOutputShape,
      annotations: {
        title: 'Search ANSC decisions',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
        destructiveHint: false,
      },
    },
    async (args, extra) => {
      const result = await client.searchDecisions(args, extra.signal);
      logger.debug({ count: result.items.length, page: args.page }, 'search_decisions returned.');
      return {
        content: [
          {
            type: 'text',
            text: summarizeDecisions(result.items.length, args.year, result.pagination.totalPages),
          },
        ],
        structuredContent: { ...result } as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'get_appeal_by_registration',
    {
      title: 'Get an appeal by registration number',
      description:
        "Direct lookup of a single appeal. Year is parsed from the registration suffix " +
        "('02/1245/24' → 2024). Scans up to 100 pages of the matching year (cached).",
      inputSchema: GetAppealInputShape,
      outputSchema: GetAppealOutputShape,
      annotations: {
        title: 'Get appeal by registration',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const yearScanned = yearFromRegOrDecision('appeal', args.registrationNumber);
      const appeal = await client.findAppealByRegistration(args.registrationNumber, extra.signal);
      const found = appeal !== null;
      return {
        content: [
          {
            type: 'text',
            text: found
              ? `Found appeal ${appeal!.registrationNumber} (${appeal!.statusRaw}).`
              : `No appeal '${args.registrationNumber}' found in ANSC ${yearScanned}.`,
          },
        ],
        structuredContent: { found, appeal, yearScanned } as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'get_decision_by_number',
    {
      title: 'Get a decision by decision number',
      description:
        "Direct lookup of a single ANSC decision. Year is parsed from the decision-number suffix " +
        "('03D-962-24' → 2024).",
      inputSchema: GetDecisionInputShape,
      outputSchema: GetDecisionOutputShape,
      annotations: {
        title: 'Get decision by number',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const yearScanned = yearFromRegOrDecision('decision', args.decisionNumber);
      const decision = await client.findDecisionByNumber(args.decisionNumber, extra.signal);
      const found = decision !== null;
      return {
        content: [
          {
            type: 'text',
            text: found
              ? `Found decision ${decision!.decisionNumber} (${decision!.decisionStatusRaw}).`
              : `No decision '${args.decisionNumber}' found in ANSC ${yearScanned}.`,
          },
        ],
        structuredContent: { found, decision, yearScanned } as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'get_procurement_history',
    {
      title: 'Get every appeal and decision for one procurement',
      description:
        'Given an OCDS procurement ID, return every appeal filed against it and every decision linked to it. ' +
        'Use this for a complete legal history of a specific tender.',
      inputSchema: GetProcurementHistoryInputShape,
      outputSchema: GetProcurementHistoryOutputShape,
      annotations: {
        title: 'Procurement appeal history',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const result = await client.findCaseByProcedure(args.procedureNumber, extra.signal);
      return {
        content: [
          {
            type: 'text',
            text:
              `Procurement ${args.procedureNumber}: ${result.appeals.length} appeal` +
              `${result.appeals.length === 1 ? '' : 's'}, ${result.decisions.length} decision` +
              `${result.decisions.length === 1 ? '' : 's'} (years scanned: ${result.yearsScanned.join(', ')}).`,
          },
        ],
        structuredContent: {
          procedureNumber: args.procedureNumber,
          yearsScanned: result.yearsScanned,
          appeals: result.appeals,
          decisions: result.decisions,
        } as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'fetch_ansc_decision',
    {
      title: 'Fetch ANSC decision PDF',
      description:
        'Download an ANSC decision PDF from the ELO portal and return extracted plain text. ' +
        'Emits progress notifications during download and parsing.',
      inputSchema: FetchDecisionInputShape,
      outputSchema: FetchDecisionOutputShape,
      annotations: {
        title: 'Fetch ANSC decision PDF',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async (args, extra) => {
      const progressToken = extra._meta?.progressToken;
      const sendProgress = async (progress: number, total: number | undefined) => {
        if (progressToken === undefined) return;
        await extra.sendNotification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress,
            ...(total !== undefined ? { total } : {}),
          },
        });
      };

      const fetched = await fetchAndExtractPdf(
        client,
        args.documentUrl,
        extra.signal,
        (phase, received, total) => {
          if (phase === 'download') {
            void sendProgress(received, total ?? undefined);
          } else {
            void sendProgress(1, 1);
          }
        },
      );

      const originalBytes = Buffer.byteLength(fetched.text, 'utf8');
      const truncated = originalBytes > args.maxBytes;
      const text = truncated ? fetched.text.slice(0, args.maxBytes) : fetched.text;

      const structured: Record<string, unknown> = {
        text,
        truncated,
        originalBytes,
        metadata: {
          filename: fetched.filename,
          contentType: fetched.contentType,
          source: fetched.source,
          pageCount: fetched.pageCount,
          byteLength: fetched.byteLength,
          pdfInfo: fetched.info,
        },
      };
      return {
        content: [
          {
            type: 'text',
            text:
              `Extracted ${fetched.pageCount}-page PDF (${originalBytes.toLocaleString()} bytes` +
              `${truncated ? `, truncated to ${args.maxBytes}` : ''}) from ${fetched.filename}.`,
          },
          { type: 'text', text },
        ],
        structuredContent: structured,
      };
    },
  );
}

function summarizeAppeals(count: number, year: number | undefined, totalPages: number): string {
  const y = year ?? new Date().getFullYear();
  return `Found ${count} appeal${count === 1 ? '' : 's'} for ${y} (page totals: ${totalPages}).`;
}

function summarizeDecisions(count: number, year: number | undefined, totalPages: number): string {
  const y = year ?? new Date().getFullYear();
  return `Found ${count} decision${count === 1 ? '' : 's'} for ${y} (page totals: ${totalPages}).`;
}
