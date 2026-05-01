import * as cheerio from 'cheerio';
import {
  Appeal,
  AppealStatus,
  APPEAL_STATUS_TEXT_MAP,
} from '../models/appeals.js';
import {
  Decision,
  DecisionStatus,
  DecisionContent,
  ComplaintObject,
  DECISION_STATUS_TEXT_MAP,
  DECISION_CONTENT_TEXT_MAP,
  COMPLAINT_OBJECT_TEXT_MAP,
} from '../models/decisions.js';
import {
  ITEMS_PER_PAGE,
  PaginatedResponse,
  Pagination,
} from '../models/pagination.js';
import {
  Order,
} from '../models/orders.js';
import {
  SuspendedDecision,
} from '../models/suspended.js';
import {
  Hearing,
  HearingDay,
} from '../models/hearings.js';
import { logger } from '../logging.js';
import {
  cleanAppealNumber,
  dmyToIso,
  dotDmyToIso,
  romanianDateLabelToIso,
} from './identifiers.js';

type CheerioAPI = ReturnType<typeof cheerio.load>;
type CheerioRow = ReturnType<CheerioAPI>;

export interface ParseOptions {
  /** Zero-based page number that was requested. Used to validate the parser saw the expected page. */
  requestedPage: number;
}

export interface ParseResult<T> extends PaginatedResponse<T> {
  /** 'header' = matched columns by &lt;th&gt; text. 'positional' = fallback. 'partial' = some headers matched, some didn't. */
  parserMode: 'header' | 'positional' | 'partial';
  /** Headers we couldn't map. Empty when parserMode === 'header'. */
  unknownHeaders: string[];
  /** Status raws we couldn't map to enums. Useful for ANSC adding new options. */
  unknownStatuses: string[];
}

/**
 * Header-name → canonical column key. Romanian variants are accepted with and without diacritics.
 * Keys here map to the field names of `Appeal` / `Decision`. Unknown headers are logged.
 */
// Header strings observed live in ANSC's HTML — both diacritic and stripped variants are accepted.
const APPEAL_HEADER_MAP: ReadonlyMap<string, keyof Appeal> = new Map([
  ['nr. inregistrare', 'registrationNumber'],
  ['nr. înregistrare', 'registrationNumber'],
  ['nr. inregistrare contestatie la ansc', 'registrationNumber'],
  ['nr. înregistrare contestație la ansc', 'registrationNumber'],
  ['data intrare', 'entryDate'],
  ['data intrării', 'entryDate'],
  ['data intrarii', 'entryDate'],
  ['nr. iesire', 'exitNumber'],
  ['nr. ieșire', 'exitNumber'],
  ['numar de iesire', 'exitNumber'],
  ['număr de ieșire', 'exitNumber'],
  ['contestator', 'challenger'],
  ['contestatar', 'challenger'],
  ['autoritatea contractanta', 'contractingAuthority'],
  ['autoritatea contractantă', 'contractingAuthority'],
  ['obiectul contestatiei', 'complaintObject'],
  ['obiectul contestației', 'complaintObject'],
  ['nr. procedurii', 'procedureNumber'],
  ['tip procedura', 'procedureType'],
  ['tip procedură', 'procedureType'],
  ['obiectul achizitiei', 'procurementObject'],
  ['obiectul achiziției', 'procurementObject'],
  ['stare', 'status'],
  ['statut', 'status'],
]);

const DECISION_HEADER_MAP: ReadonlyMap<string, keyof Decision> = new Map([
  ['nr. decizie', 'decisionNumber'],
  ['data', 'date'],
  ['data decizie', 'date'],
  ['contestator', 'challenger'],
  ['contestatar', 'challenger'],
  ['autoritatea contractanta', 'contractingAuthority'],
  ['autoritatea contractantă', 'contractingAuthority'],
  ['obiectul contestatiei', 'complaintObjectRaw'],
  ['obiectul contestației', 'complaintObjectRaw'],
  ['elementele contestatiei', 'complaintElements'],
  ['elementele contestației', 'complaintElements'],
  ['complet', 'complete'],
  ['nr. procedurii', 'procedureNumber'],
  ['continut decizie', 'decisionContentRaw'],
  ['conținut decizie', 'decisionContentRaw'],
  ['continutul decizie', 'decisionContentRaw'],
  ['conținutul decizie', 'decisionContentRaw'],
  ['tip procedura', 'procedureType'],
  ['tip procedură', 'procedureType'],
  ['obiectul achizitiei', 'procurementObject'],
  ['obiectul achiziției', 'procurementObject'],
  ['statut decizie', 'decisionStatusRaw'],
  ['stare decizie', 'decisionStatusRaw'],
  ['decizie', 'decisionStatusRaw'],
  ['decizia', 'decisionStatusRaw'],
  ['document', 'pdfUrl'],
  ['raportare', 'reportingStatus'],
  ['decizii raportat/neraportat', 'reportingStatus'],
  ['nr. contestatie', 'appealNumber'],
  ['nr. contestație', 'appealNumber'],
  ['nr. inregistrare contestatie la ansc', 'appealNumber'],
  ['nr. înregistrare contestație la ansc', 'appealNumber'],
]);

const APPEAL_POSITIONAL_FIELDS: readonly (keyof Appeal | null)[] = [
  'registrationNumber',
  'entryDate',
  'exitNumber',
  'challenger',
  'contractingAuthority',
  'complaintObject',
  'procedureNumber',
  'procedureType',
  'procurementObject',
  'status',
];

const DECISION_POSITIONAL_FIELDS: readonly (keyof Decision | null)[] = [
  'decisionNumber',
  'date',
  'challenger',
  'contractingAuthority',
  'complaintObjectRaw',
  'complaintElements',
  'complete',
  'procedureNumber',
  'decisionContentRaw',
  'procedureType',
  'procurementObject',
  'decisionStatusRaw',
  'pdfUrl',
  'reportingStatus',
  'appealNumber',
];

const ORDER_HEADER_MAP: ReadonlyMap<string, keyof Order> = new Map([
  ['nr. incheiere', 'orderNumber'],
  ['nr. încheiere', 'orderNumber'],
  ['data incheiere', 'date'],
  ['data încheiere', 'date'],
  ['contestatar', 'challenger'],
  ['contestator', 'challenger'],
  ['autoritatea contractanta', 'contractingAuthority'],
  ['autoritatea contractantă', 'contractingAuthority'],
  ['elementele contestatiei', 'appealElements'],
  ['elementele contestației', 'appealElements'],
  ['continutul incheierii', 'contentRaw'],
  ['conținutul încheierii', 'contentRaw'],
  ['complet', 'panel'],
  ['nr. procedurii', 'procedureNumber'],
  ['tip procedura', 'procedureType'],
  ['tip procedură', 'procedureType'],
  ['obiectul achizitiei', 'procurementObject'],
  ['obiectul achiziției', 'procurementObject'],
  ['statut incheiere', 'statusRaw'],
  ['statut încheiere', 'statusRaw'],
  ['nr. contestatie', 'appealNumber'],
  ['nr. contestație', 'appealNumber'],
  ['încheierea', 'pdfUrl'],
  ['incheierea', 'pdfUrl'],
]);

const ORDER_POSITIONAL_FIELDS: readonly (keyof Order)[] = [
  'orderNumber',
  'date',
  'challenger',
  'contractingAuthority',
  'appealElements',
  'contentRaw',
  'panel',
  'procedureNumber',
  'procedureType',
  'procurementObject',
  'statusRaw',
  'appealNumber',
  'pdfUrl',
];

const SUSPENDED_HEADER_MAP: ReadonlyMap<string, keyof SuspendedDecision> = new Map([
  ['nr. deciziei', 'decisionNumber'],
  ['data deciziei', 'date'],
  ['contestatar', 'challenger'],
  ['contestator', 'challenger'],
  ['autoritatea contractanta', 'contractingAuthority'],
  ['autoritatea contractantă', 'contractingAuthority'],
  ['obiectul contestatiei', 'complaintObjectRaw'],
  ['obiectul contestației', 'complaintObjectRaw'],
  ['conținutul deciziei', 'contentRaw'],
  ['continutul deciziei', 'contentRaw'],
  ['decizia', 'pdfUrl'],
  ['nr procedurii', 'procedureNumber'],
  ['nr. procedurii', 'procedureNumber'],
  ['obiectul achizitiei', 'procurementObject'],
  ['obiectul achiziției', 'procurementObject'],
  ['nr. inregistrare contestatie la ansc', 'appealNumber'],
  ['nr. înregistrare contestație la ansc', 'appealNumber'],
  ['decizii raportat/neraportat', 'reportingStatus'],
]);

const SUSPENDED_POSITIONAL_FIELDS: readonly (keyof SuspendedDecision)[] = [
  'decisionNumber',
  'date',
  'challenger',
  'contractingAuthority',
  'complaintObjectRaw',
  'contentRaw',
  'pdfUrl',
  'procedureNumber',
  'procurementObject',
  'appealNumber',
  'reportingStatus',
];

function normalizeHeader(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildColumnIndex<T>(
  $: CheerioAPI,
  headerMap: ReadonlyMap<string, keyof T>,
): { byField: Map<keyof T, number>; unknown: string[] } {
  const byField = new Map<keyof T, number>();
  const unknown: string[] = [];
  $('#myTable thead tr').first().find('th').each((i, th) => {
    const text = normalizeHeader($(th).text());
    if (!text) return;
    const field = headerMap.get(text);
    if (field === undefined) {
      unknown.push(text);
      return;
    }
    if (!byField.has(field)) byField.set(field, i);
  });
  return { byField, unknown };
}

function readCell($cells: CheerioRow, idx: number | undefined): string {
  if (idx === undefined) return '';
  return $cells.eq(idx).text().replace(/\s+/g, ' ').trim();
}

function readHref(
  $cells: CheerioRow,
  idx: number | undefined,
): string {
  if (idx === undefined) return '';
  return $cells.eq(idx).find('a').attr('href') ?? '';
}

function parseAppealStatus(text: string, unknown: Set<string>): AppealStatus {
  const direct = APPEAL_STATUS_TEXT_MAP.get(text);
  if (direct !== undefined) return direct;
  const ascii = APPEAL_STATUS_TEXT_MAP.get(stripDiacritics(text));
  if (ascii !== undefined) return ascii;
  if (text) unknown.add(text);
  // UnderReview is the safe default — most rows in active years sit here.
  return AppealStatus.UnderReview;
}

function parseDecisionStatus(
  text: string,
  unknown: Set<string>,
): DecisionStatus | null {
  if (!text.trim()) return null;
  const direct = DECISION_STATUS_TEXT_MAP.get(text.trim());
  if (direct !== undefined) return direct;
  const ascii = DECISION_STATUS_TEXT_MAP.get(stripDiacritics(text.trim()));
  if (ascii !== undefined) return ascii;
  unknown.add(text.trim());
  return null;
}

function parseDecisionContent(
  text: string,
  unknown: Set<string>,
): DecisionContent[] {
  if (!text.trim()) return [];
  const parts = text
    .split(/\s*,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: DecisionContent[] = [];
  for (const p of parts) {
    const direct = DECISION_CONTENT_TEXT_MAP.get(p);
    if (direct !== undefined) {
      out.push(direct);
      continue;
    }
    const ascii = DECISION_CONTENT_TEXT_MAP.get(stripDiacritics(p));
    if (ascii !== undefined) {
      out.push(ascii);
      continue;
    }
    unknown.add(p);
  }
  return out;
}

function parseComplaintObject(text: string): ComplaintObject | null {
  if (!text.trim()) return null;
  return (
    COMPLAINT_OBJECT_TEXT_MAP.get(text.trim()) ??
    COMPLAINT_OBJECT_TEXT_MAP.get(stripDiacritics(text.trim())) ??
    null
  );
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function extractOcdsId(href: string): string {
  if (!href) return '';
  const last = href.split('/').filter(Boolean).pop() ?? '';
  return last.split('?')[0] ?? '';
}

// ----------------------------------------------------------------------------
// Generic table parser. The four ANSC listings (appeals, decisions, orders,
// suspended decisions) all share a `#myTable` shape with header-then-positional
// column resolution; only the row constructor and a few thresholds differ.
// ----------------------------------------------------------------------------

interface TableConfig<T, F extends keyof T> {
  /** Used in log messages, e.g. 'Appeals'. */
  label: string;
  headerMap: ReadonlyMap<string, F>;
  positionalFields: readonly (F | null)[];
  /** Minimum cells required to bother parsing the row. */
  minCells: number;
  /** Header coverage required to call the run 'header' (rather than 'partial'). */
  coverageThreshold: number;
  buildRow: (
    ctx: { $cells: CheerioRow; get: (field: F) => number | undefined },
    sinks: { unknownStatuses: Set<string> },
  ) => T;
}

function parseTable<T, F extends keyof T>(
  html: string,
  opts: ParseOptions,
  config: TableConfig<T, F>,
): ParseResult<T> {
  const $ = cheerio.load(html);
  const items: T[] = [];
  const unknownStatuses = new Set<string>();
  const { byField, unknown } = buildColumnIndex<T>($, config.headerMap);
  const headerCovered = byField.size >= config.coverageThreshold;
  const headerHadAnyMatch = byField.size > 0;

  $('#myTable tbody tr').each((_, row) => {
    const $cells = $(row).find('td');
    if ($cells.length < config.minCells) return;

    const get = (field: F): number | undefined => {
      const fromHeader = byField.get(field);
      if (fromHeader !== undefined) return fromHeader;
      const positional = config.positionalFields.indexOf(field);
      return positional >= 0 ? positional : undefined;
    };

    items.push(config.buildRow({ $cells, get }, { unknownStatuses }));
  });

  const pagination = parsePagination($, opts.requestedPage);
  const parserMode: ParseResult<T>['parserMode'] = headerCovered
    ? 'header'
    : headerHadAnyMatch
      ? 'partial'
      : 'positional';

  // Don't warn on empty result pages — ANSC omits the <thead> when there are 0 rows.
  if (parserMode !== 'header' && items.length > 0) {
    logger.warn(
      { unknownHeaders: unknown, mode: parserMode, fieldsMatched: byField.size },
      `${config.label} table headers did not fully match. Falling back to positional indices.`,
    );
  }
  if (unknownStatuses.size > 0) {
    logger.warn(
      { unknown: [...unknownStatuses] },
      `Encountered ${config.label.toLowerCase()} status strings not in maps.`,
    );
  }

  return {
    items,
    pagination,
    parserMode,
    unknownHeaders: unknown,
    unknownStatuses: [...unknownStatuses],
  };
}

export function parseAppealsTable(
  html: string,
  opts: ParseOptions,
): ParseResult<Appeal> {
  return parseTable<Appeal, keyof Appeal>(html, opts, {
    label: 'Appeals',
    headerMap: APPEAL_HEADER_MAP,
    positionalFields: APPEAL_POSITIONAL_FIELDS,
    minCells: APPEAL_POSITIONAL_FIELDS.length,
    coverageThreshold: APPEAL_POSITIONAL_FIELDS.length,
    buildRow: ({ $cells, get }, { unknownStatuses }) => {
      const procedureHref = readHref($cells, get('procedureNumber'));
      const statusRaw = readCell($cells, get('status'));
      const entryDate = readCell($cells, get('entryDate'));
      return {
        registrationNumber: cleanAppealNumber(readCell($cells, get('registrationNumber'))),
        entryDate,
        entryDateIso: dmyToIso(entryDate),
        exitNumber: readCell($cells, get('exitNumber')),
        challenger: readCell($cells, get('challenger')),
        contractingAuthority: readCell($cells, get('contractingAuthority')),
        complaintObject: readCell($cells, get('complaintObject')),
        procedureNumber: extractOcdsId(procedureHref) || readCell($cells, get('procedureNumber')),
        procedureType: readCell($cells, get('procedureType')),
        procurementObject: readCell($cells, get('procurementObject')),
        status: parseAppealStatus(statusRaw, unknownStatuses),
        statusRaw,
      };
    },
  });
}

export function parseDecisionsTable(
  html: string,
  opts: ParseOptions,
): ParseResult<Decision> {
  return parseTable<Decision, keyof Decision>(html, opts, {
    label: 'Decisions',
    headerMap: DECISION_HEADER_MAP,
    positionalFields: DECISION_POSITIONAL_FIELDS,
    minCells: DECISION_POSITIONAL_FIELDS.length - 2,
    // pdfUrl is link-only (no header text), so 1 less than positional length.
    coverageThreshold: DECISION_POSITIONAL_FIELDS.length - 1,
    buildRow: ({ $cells, get }, { unknownStatuses }) => {
      const decisionContentRaw = readCell($cells, get('decisionContentRaw'));
      const decisionStatusRaw = readCell($cells, get('decisionStatusRaw'));
      const complaintObjectRaw = readCell($cells, get('complaintObjectRaw'));
      const date = readCell($cells, get('date'));
      return {
        decisionNumber: readCell($cells, get('decisionNumber')),
        date,
        dateIso: dmyToIso(date),
        challenger: readCell($cells, get('challenger')),
        contractingAuthority: readCell($cells, get('contractingAuthority')),
        complaintObject: parseComplaintObject(complaintObjectRaw),
        complaintObjectRaw,
        complaintElements: readCell($cells, get('complaintElements')),
        complete: readCell($cells, get('complete')),
        procedureNumber: readCell($cells, get('procedureNumber')),
        decisionContent: parseDecisionContent(decisionContentRaw, unknownStatuses),
        decisionContentRaw,
        procedureType: readCell($cells, get('procedureType')),
        procurementObject: readCell($cells, get('procurementObject')),
        decisionStatus: parseDecisionStatus(decisionStatusRaw, unknownStatuses),
        decisionStatusRaw,
        pdfUrl: readHref($cells, get('pdfUrl')),
        reportingStatus: readCell($cells, get('reportingStatus')),
        appealNumber: cleanAppealNumber(readCell($cells, get('appealNumber'))),
      };
    },
  });
}

export function parseOrdersTable(
  html: string,
  opts: ParseOptions,
): ParseResult<Order> {
  return parseTable<Order, keyof Order>(html, opts, {
    label: 'Orders',
    headerMap: ORDER_HEADER_MAP,
    positionalFields: ORDER_POSITIONAL_FIELDS,
    minCells: ORDER_POSITIONAL_FIELDS.length - 2,
    coverageThreshold: ORDER_POSITIONAL_FIELDS.length - 1,
    buildRow: ({ $cells, get }, { unknownStatuses }) => {
      const date = readCell($cells, get('date'));
      const statusRaw = readCell($cells, get('statusRaw'));
      return {
        orderNumber: readCell($cells, get('orderNumber')),
        date,
        dateIso: dmyToIso(date),
        challenger: readCell($cells, get('challenger')),
        contractingAuthority: readCell($cells, get('contractingAuthority')),
        appealElements: readCell($cells, get('appealElements')),
        contentRaw: readCell($cells, get('contentRaw')),
        panel: readCell($cells, get('panel')),
        procedureNumber: readCell($cells, get('procedureNumber')),
        procedureType: readCell($cells, get('procedureType')),
        procurementObject: readCell($cells, get('procurementObject')),
        status: parseDecisionStatus(statusRaw, unknownStatuses),
        statusRaw,
        pdfUrl: readHref($cells, get('pdfUrl')),
        appealNumber: cleanAppealNumber(readCell($cells, get('appealNumber'))),
      };
    },
  });
}

export function parseSuspendedDecisionsTable(
  html: string,
  opts: ParseOptions,
): ParseResult<SuspendedDecision> {
  return parseTable<SuspendedDecision, keyof SuspendedDecision>(html, opts, {
    label: 'Suspended-decisions',
    headerMap: SUSPENDED_HEADER_MAP,
    positionalFields: SUSPENDED_POSITIONAL_FIELDS,
    minCells: SUSPENDED_POSITIONAL_FIELDS.length - 2,
    coverageThreshold: SUSPENDED_POSITIONAL_FIELDS.length - 2,
    buildRow: ({ $cells, get }) => {
      const date = readCell($cells, get('date'));
      // Suspended-decision PDFs are direct ansc.md/sites/... links, not ELO.
      const pdfUrl = readHref($cells, get('pdfUrl'));
      return {
        decisionNumber: readCell($cells, get('decisionNumber')),
        date,
        dateIso: dmyToIso(date),
        challenger: readCell($cells, get('challenger')),
        contractingAuthority: readCell($cells, get('contractingAuthority')),
        complaintObjectRaw: readCell($cells, get('complaintObjectRaw')),
        contentRaw: readCell($cells, get('contentRaw')),
        pdfUrl,
        procedureNumber: readCell($cells, get('procedureNumber')),
        procurementObject: readCell($cells, get('procurementObject')),
        appealNumber: cleanAppealNumber(readCell($cells, get('appealNumber'))),
        reportingStatus: readCell($cells, get('reportingStatus')),
      };
    },
  });
}

// ----------------------------------------------------------------------------
// Hearing schedule
// ----------------------------------------------------------------------------

export function parseAgendaListing(html: string, baseUrl: string): HearingDay[] {
  const $ = cheerio.load(html);
  const out: HearingDay[] = [];
  $('.views-row').each((_, row) => {
    const $row = $(row);
    const $title = $row.find('.views-field-title a').first();
    const url = $title.attr('href') ?? '';
    if (!url) return;
    const title = $title.text().replace(/\s+/g, ' ').trim();
    const dateLabel = title.replace(/^Agenda ședințelor.*pentru\s+/i, '').trim();
    const dateIso = romanianDateLabelToIso(dateLabel);
    const startTime = $row.find('.fancy-time').first().text().trim() || null;
    const absoluteUrl = url.startsWith('http') ? url : new URL(url, baseUrl).toString();
    out.push({ dateLabel, dateIso, url: absoluteUrl, startTime });
  });
  return out;
}

export function parseAgendaDay(
  html: string,
  agendaUrl: string,
): { dateIso: string | null; hearings: Hearing[] } {
  const $ = cheerio.load(html);
  // Try the structured dc:date attribute first.
  const dcDate = $('span[property="dc:date"]').attr('content');
  let dateIso: string | null = null;
  if (dcDate) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(dcDate);
    if (m) dateIso = m[1] ?? null;
  }
  if (!dateIso) {
    // Fallback: parse from URL slug or H1.
    const h1 = $('h1').first().text();
    dateIso = romanianDateLabelToIso(h1.replace(/^Agenda.*pentru\s+/i, ''));
  }

  const hearings: Hearing[] = [];
  // The body table is the first <table> inside .field-name-body.
  const $table = $('.field-name-body table').first();
  if ($table.length === 0) return { dateIso, hearings };

  // Skip header row (first <tr>); we read by position because the header is in <p><strong>.
  $table.find('tr').each((idx, row) => {
    if (idx === 0) return;
    const $cells = $(row).find('td');
    if ($cells.length < 7) return;
    const ordinalText = $cells.eq(0).text().replace(/\s+/g, ' ').trim();
    const ordinal = parseInt(ordinalText, 10);
    if (Number.isNaN(ordinal)) return;
    const date = $cells.eq(1).text().replace(/\s+/g, ' ').trim();
    const time = $cells.eq(2).text().replace(/\s+/g, ' ').trim();
    const parties = $cells.eq(3).text().replace(/\s+/g, ' ').trim();
    const registrationNumber = cleanAppealNumber(
      $cells.eq(4).text().replace(/\s+/g, ' ').trim(),
    );
    const object = $cells.eq(5).text().replace(/\s+/g, ' ').trim();
    const panel = $cells.eq(6).text().replace(/\s+/g, ' ').trim();

    const slashIdx = parties.indexOf('/');
    const challenger = slashIdx >= 0 ? parties.slice(0, slashIdx).trim() : parties;
    const contractingAuthority = slashIdx >= 0 ? parties.slice(slashIdx + 1).trim() : '';

    hearings.push({
      ordinal,
      date,
      dateIso: dotDmyToIso(date) ?? dateIso,
      time,
      parties,
      challenger,
      contractingAuthority,
      registrationNumber,
      object,
      panel,
      agendaUrl,
    });
  });
  return { dateIso, hearings };
}

function parsePagination($: CheerioAPI, requestedPage: number): Pagination {
  if ($('.pager').length === 0) {
    return {
      currentPage: 0,
      totalPages: 1,
      perPage: ITEMS_PER_PAGE,
      hasNextPage: false,
      hasPrevPage: false,
    };
  }

  const displayedPage = parseInt($('.pager-current').first().text().trim(), 10) || 1;
  const lastHref = $('.pager-last a').attr('href') ?? '';
  const lastMatch = /[?&]page=(\d+)/.exec(lastHref);
  let totalPages: number;

  if (lastMatch?.[1]) {
    // ANSC's `page` query param is 0-based; total pages = last+1.
    totalPages = parseInt(lastMatch[1], 10) + 1;
  } else {
    const pageNumbers = $('.pager-item, .pager-current')
      .map((_, el) => parseInt($(el).text().trim(), 10))
      .get()
      .filter((n) => !Number.isNaN(n));
    totalPages = pageNumbers.length > 0 ? Math.max(...pageNumbers) : 1;
  }

  const currentPage = displayedPage - 1;
  const hasNextPage = $('.pager-next').length > 0;
  const hasPrevPage = $('.pager-previous').length > 0;

  if (currentPage !== requestedPage) {
    logger.debug(
      { requestedPage, currentPage },
      'Page number reported by ANSC differs from requested page.',
    );
  }

  return {
    currentPage,
    totalPages,
    perPage: ITEMS_PER_PAGE,
    hasNextPage,
    hasPrevPage,
  };
}
