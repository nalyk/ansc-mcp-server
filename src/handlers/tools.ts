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
import { fetchAndExtractPdf, PDF_URL_PATTERN } from '../api/pdf-fetcher.js';
import { OrderSchema } from '../models/orders.js';
import { SuspendedDecisionSchema } from '../models/suspended.js';
import { HearingSchema, HearingDaySchema } from '../models/hearings.js';
import {
  yearFromAppealRegistration,
  yearFromDecisionNumber,
} from '../utils/identifiers.js';
import { logger } from '../logging.js';

function yearFromRegOrDecision(kind: 'appeal' | 'decision', id: string): number {
  return kind === 'appeal' ? yearFromAppealRegistration(id) : yearFromDecisionNumber(id);
}

/**
 * Canonical MCP tool result envelope. Centralizes the structuredContent cast that
 * every tool needs (the SDK's CallToolResult requires Record<string, unknown> and
 * our outputs are typed object shapes).
 */
function ok(text: string, structured: object) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: structured as Record<string, unknown>,
  };
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
    .regex(
      PDF_URL_PATTERN,
      'Must be an ANSC PDF URL — either elo.ansc.md/DownloadDocs/DownloadFileServlet?id=<digits> or www.ansc.md/sites/...pdf.',
    )
    .describe('Full ELO download URL of the decision PDF, or a direct ansc.md PDF link (suspended decisions).'),
  mode: z
    .enum(['auto', 'text', 'image'])
    .optional()
    .default('auto')
    .describe(
      'auto = text first, fall back to per-page images for scanned PDFs (default). ' +
        'text = always return extracted text only (may be unreadable for scans). ' +
        'image = always return per-page JPEG images for vision-OCR by the host LLM.',
    ),
} as const;

const FetchDecisionOutputShape = {
  text: z.string().describe('Best-effort extracted text. May be unreliable for scanned PDFs — see `scanned`.'),
  pages: z.number().int().nonnegative(),
  filename: z.string(),
  contentType: z.string(),
  source: z.string().url(),
  bytes: z.number().int().nonnegative(),
  scanned: z.boolean().describe('True when the heuristic detected a scanned / broken-CMap PDF and emitted images.'),
  imageCount: z.number().int().nonnegative(),
  pdfInfo: z.record(z.string(), z.unknown()).nullable(),
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
      return ok(
        summarizeAppeals(result.items.length, args.year, result.pagination.totalPages),
        { ...result },
      );
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
      return ok(
        summarizeDecisions(result.items.length, args.year, result.pagination.totalPages),
        { ...result },
      );
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
      const text = found
        ? `Found appeal ${appeal.registrationNumber} (${appeal.statusRaw}).`
        : `No appeal '${args.registrationNumber}' found in ANSC ${yearScanned}.`;
      return ok(text, { found, appeal, yearScanned });
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
      const text = found
        ? `Found decision ${decision.decisionNumber} (${decision.decisionStatusRaw}).`
        : `No decision '${args.decisionNumber}' found in ANSC ${yearScanned}.`;
      return ok(text, { found, decision, yearScanned });
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
      const text =
        `Procurement ${args.procedureNumber}: ${result.appeals.length} appeal` +
        `${result.appeals.length === 1 ? '' : 's'}, ${result.decisions.length} decision` +
        `${result.decisions.length === 1 ? '' : 's'} (years scanned: ${result.yearsScanned.join(', ')}).`;
      return ok(text, {
        procedureNumber: args.procedureNumber,
        yearsScanned: result.yearsScanned,
        appeals: result.appeals,
        decisions: result.decisions,
      });
    },
  );

  server.registerTool(
    'search_orders',
    {
      title: 'Search ANSC procedural orders (încheieri)',
      description:
        'Procedural orders issued during an appeal (before/alongside the final decision). ' +
        'Use kind="suspension" for orders that suspend a procurement (incheieri-de-suspendare).',
      inputSchema: {
        year: z.number().int().min(2014).max(9999).optional(),
        kind: z.enum(['general', 'suspension']).optional().default('general'),
        page: z.number().int().nonnegative().optional().default(0),
      },
      outputSchema: {
        items: z.array(OrderSchema),
        pagination: PaginationSchema,
        kind: z.enum(['general', 'suspension']),
        parserMode: z.enum(['header', 'partial', 'positional']),
      },
      annotations: {
        title: 'Search orders',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const r = await client.searchOrders(args.year, args.page, args.kind, extra.signal);
      const text = `Found ${r.items.length} order${r.items.length === 1 ? '' : 's'} (${args.kind}) for ${args.year ?? new Date().getFullYear()}, page ${args.page}.`;
      return ok(text, {
        items: r.items,
        pagination: r.pagination,
        kind: args.kind,
        parserMode: r.parserMode,
      });
    },
  );

  server.registerTool(
    'search_suspended_decisions',
    {
      title: 'Search court-suspended decisions',
      description:
        'Decisions whose effect has been suspended by a court (decizii-suspendate). ' +
        'A decision listed here may also appear in search_decisions with status `În vigoare` — ' +
        'its presence here is the authoritative signal that a court has paused enforcement.',
      inputSchema: {
        year: z.number().int().min(2014).max(9999).optional(),
        page: z.number().int().nonnegative().optional().default(0),
      },
      outputSchema: {
        items: z.array(SuspendedDecisionSchema),
        pagination: PaginationSchema,
        parserMode: z.enum(['header', 'partial', 'positional']),
      },
      annotations: {
        title: 'Search suspended decisions',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const r = await client.searchSuspendedDecisions(args.year, args.page, extra.signal);
      const text = `Found ${r.items.length} suspended decision${r.items.length === 1 ? '' : 's'} for ${args.year ?? new Date().getFullYear()}, page ${args.page}.`;
      return ok(text, {
        items: r.items,
        pagination: r.pagination,
        parserMode: r.parserMode,
      });
    },
  );

  server.registerTool(
    'list_upcoming_hearings',
    {
      title: 'List upcoming public hearing days',
      description:
        'Returns the days for which ANSC has published a hearing agenda. Use these URLs ' +
        'with get_hearings_for_day to retrieve the cases scheduled on each day.',
      inputSchema: {},
      outputSchema: {
        days: z.array(HearingDaySchema),
      },
      annotations: {
        title: 'Upcoming hearings',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (_args, extra) => {
      const days = await client.listUpcomingHearings(extra.signal);
      return ok(`${days.length} hearing day${days.length === 1 ? '' : 's'} on ANSC's agenda.`, { days });
    },
  );

  server.registerTool(
    'get_hearings_for_day',
    {
      title: 'Get all hearings scheduled on a given day',
      description:
        'Fetch the agenda for a specific day (by its agenda URL or by ISO date). Returns ' +
        'every case with time, parties, registration number, object, and panel.',
      inputSchema: {
        agendaUrl: z
          .string()
          .url()
          .optional()
          .describe('Full agenda URL from list_upcoming_hearings.'),
        dateIso: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
          .optional()
          .describe('Alternatively, ISO date — looks up the corresponding agenda.'),
      },
      outputSchema: {
        dateIso: z.string().nullable(),
        hearings: z.array(HearingSchema),
      },
      annotations: {
        title: 'Hearings for day',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      let url = args.agendaUrl;
      if (!url) {
        if (!args.dateIso) {
          throw new Error('Either agendaUrl or dateIso must be provided.');
        }
        const days = await client.listUpcomingHearings(extra.signal);
        const match = days.find((d) => d.dateIso === args.dateIso);
        if (!match) {
          return ok(`No published agenda for ${args.dateIso}.`, {
            dateIso: args.dateIso,
            hearings: [],
          });
        }
        url = match.url;
      }
      const result = await client.getHearingsForDay(url, extra.signal);
      const text = `${result.hearings.length} hearing${result.hearings.length === 1 ? '' : 's'} on ${result.dateIso ?? 'this day'}.`;
      return ok(text, result);
    },
  );

  server.registerTool(
    'find_hearing_for_appeal',
    {
      title: 'Find the hearing(s) scheduled for an appeal',
      description:
        'Given an appeal registration number (e.g. "02/230/26"), scan ANSC\'s currently published ' +
        'agenda days and return any matching hearings. Use this to answer "when is my hearing?".',
      inputSchema: {
        registrationNumber: z
          .string()
          .min(3)
          .describe("Appeal registration number, e.g. '02/230/26'."),
      },
      outputSchema: {
        registrationNumber: z.string(),
        matches: z.array(HearingSchema),
      },
      annotations: {
        title: 'Find hearing for appeal',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const matches = await client.findHearingForAppeal(args.registrationNumber, extra.signal);
      const text = matches.length
        ? `${matches.length} scheduled hearing${matches.length === 1 ? '' : 's'} for ${args.registrationNumber}.`
        : `No upcoming hearing currently published for ${args.registrationNumber}.`;
      return ok(text, { registrationNumber: args.registrationNumber, matches });
    },
  );

  server.registerTool(
    'check_decision_court_status',
    {
      title: 'Check whether a decision has been suspended by a court',
      description:
        'Looks up a decision by number, then cross-checks the suspended-decisions listing. ' +
        'Returns the canonical decision plus, if applicable, the corresponding suspension entry.',
      inputSchema: {
        decisionNumber: z.string().min(3),
      },
      outputSchema: {
        decision: DecisionSchema.nullable(),
        suspension: SuspendedDecisionSchema.nullable(),
        isSuspended: z.boolean(),
      },
      annotations: {
        title: 'Decision court status',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const decision = await client.findDecisionByNumber(args.decisionNumber, extra.signal);
      if (!decision) {
        return ok(`Decision ${args.decisionNumber} not found.`, {
          decision: null,
          suspension: null,
          isSuspended: false,
        });
      }
      const suspension = await client.findSuspendedFromDecision(decision, extra.signal);
      const isSuspended = suspension !== null;
      const text = isSuspended
        ? `Decision ${decision.decisionNumber} is COURT-SUSPENDED (suspension entry ${suspension.decisionNumber}, ${suspension.date}).`
        : `Decision ${decision.decisionNumber} is in force; no court suspension found.`;
      return ok(text, { decision, suspension, isSuspended });
    },
  );

  server.registerTool(
    'fetch_ansc_decision',
    {
      title: 'Fetch ANSC decision PDF',
      description:
        'Download an ANSC decision PDF (ELO portal or ansc.md/sites/...) and return its content. ' +
        'Native-text PDFs return extracted text. Scanned PDFs (common for older or annexed documents — ' +
        'often Canon/HP scanner output with broken Unicode CMap) return per-page JPEG `image` content blocks ' +
        'for the host vision-LLM to OCR — language-agnostic, handles Romanian + Russian + English without ' +
        'a local OCR install. Emits progress notifications.',
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
        args.mode,
        extra.signal,
        (phase, received, total) => {
          if (phase === 'download') {
            void sendProgress(received, total ?? undefined);
          } else if (phase === 'parse') {
            void sendProgress(1, 1);
          } else {
            // images phase: progress is page index over capped count
            if (total !== null) void sendProgress(received, total);
          }
        },
      );

      const imageParts = fetched.parts.filter((p) => p.type === 'image');
      const textPart = fetched.parts.find((p) => p.type === 'text');
      const inlineText = textPart?.text ?? '';

      const content: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string }
      > = [];

      if (fetched.scanned && imageParts.length) {
        content.push({
          type: 'text',
          text:
            `Scanned PDF detected (${fetched.pages} pages, ${imageParts.length} image(s) extracted from ${fetched.filename}). ` +
            `Embedded text was unreliable — returning page images for vision-OCR. ` +
            (inlineText
              ? `Best-effort text below for fallback reference:\n\n${inlineText.slice(0, 4000)}${inlineText.length > 4000 ? '\n\n[…truncated]' : ''}`
              : ''),
        });
      } else if (inlineText) {
        content.push({
          type: 'text',
          text: `Extracted ${fetched.pages}-page PDF (${fetched.byteLength.toLocaleString()} bytes) from ${fetched.filename}.`,
        });
        content.push({ type: 'text', text: inlineText });
      } else {
        content.push({
          type: 'text',
          text: `Fetched ${fetched.pages}-page PDF from ${fetched.filename} but no text was extractable.`,
        });
      }

      for (const im of imageParts) {
        content.push({
          type: 'image',
          data: im.imageBase64!,
          mimeType: im.mimeType!,
        });
      }

      return {
        content,
        structuredContent: {
          text: fetched.text,
          pages: fetched.pages,
          filename: fetched.filename,
          contentType: fetched.contentType,
          source: fetched.source,
          bytes: fetched.byteLength,
          scanned: fetched.scanned,
          imageCount: imageParts.length,
          pdfInfo: fetched.pdfInfo,
        } as Record<string, unknown>,
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
