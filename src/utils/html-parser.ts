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
import { logger } from '../logging.js';

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
  $: CheerioAPI,
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

export function parseAppealsTable(
  html: string,
  opts: ParseOptions,
): ParseResult<Appeal> {
  const $ = cheerio.load(html);
  const items: Appeal[] = [];
  const unknownStatuses = new Set<string>();

  const { byField, unknown } = buildColumnIndex<Appeal>($, APPEAL_HEADER_MAP);
  const headerHadAnyMatch = byField.size > 0;
  const headerCovered = byField.size >= APPEAL_POSITIONAL_FIELDS.length;

  $('#myTable tbody tr').each((_, row) => {
    const $row = $(row);
    const $cells = $row.find('td');

    if ($cells.length < APPEAL_POSITIONAL_FIELDS.length) return;

    const get = (field: keyof Appeal): number | undefined => {
      const fromHeader = byField.get(field);
      if (fromHeader !== undefined) return fromHeader;
      const positional = APPEAL_POSITIONAL_FIELDS.indexOf(field);
      return positional >= 0 ? positional : undefined;
    };

    const procedureHref = readHref($, $cells, get('procedureNumber'));
    const statusRaw = readCell($cells, get('status'));

    const appeal: Appeal = {
      registrationNumber: readCell($cells, get('registrationNumber')),
      entryDate: readCell($cells, get('entryDate')),
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

    items.push(appeal);
  });

  const pagination = parsePagination($, opts.requestedPage);
  const parserMode = headerCovered
    ? 'header'
    : headerHadAnyMatch
      ? 'partial'
      : 'positional';

  if (parserMode !== 'header') {
    logger.warn(
      { unknownHeaders: unknown, mode: parserMode, fieldsMatched: byField.size },
      'Appeals table headers did not fully match. Falling back to positional indices.',
    );
  }
  if (unknownStatuses.size > 0) {
    logger.warn(
      { unknown: [...unknownStatuses] },
      'Encountered appeal status strings not in APPEAL_STATUS_TEXT_MAP.',
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

export function parseDecisionsTable(
  html: string,
  opts: ParseOptions,
): ParseResult<Decision> {
  const $ = cheerio.load(html);
  const items: Decision[] = [];
  const unknownStatuses = new Set<string>();

  const { byField, unknown } = buildColumnIndex<Decision>($, DECISION_HEADER_MAP);
  const headerHadAnyMatch = byField.size > 0;
  const headerCovered = byField.size >= DECISION_POSITIONAL_FIELDS.length - 1; // pdfUrl is link-only

  $('#myTable tbody tr').each((_, row) => {
    const $row = $(row);
    const $cells = $row.find('td');

    if ($cells.length < DECISION_POSITIONAL_FIELDS.length - 2) return;

    const get = (field: keyof Decision): number | undefined => {
      const fromHeader = byField.get(field);
      if (fromHeader !== undefined) return fromHeader;
      const positional = DECISION_POSITIONAL_FIELDS.indexOf(field);
      return positional >= 0 ? positional : undefined;
    };

    const decisionContentRaw = readCell($cells, get('decisionContentRaw'));
    const decisionStatusRaw = readCell($cells, get('decisionStatusRaw'));
    const complaintObjectRaw = readCell($cells, get('complaintObjectRaw'));

    const decision: Decision = {
      decisionNumber: readCell($cells, get('decisionNumber')),
      date: readCell($cells, get('date')),
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
      pdfUrl: readHref($, $cells, get('pdfUrl')),
      reportingStatus: readCell($cells, get('reportingStatus')),
      appealNumber: readCell($cells, get('appealNumber')),
    };

    items.push(decision);
  });

  const pagination = parsePagination($, opts.requestedPage);
  const parserMode = headerCovered
    ? 'header'
    : headerHadAnyMatch
      ? 'partial'
      : 'positional';

  if (parserMode !== 'header') {
    logger.warn(
      { unknownHeaders: unknown, mode: parserMode, fieldsMatched: byField.size },
      'Decisions table headers did not fully match. Falling back to positional indices.',
    );
  }
  if (unknownStatuses.size > 0) {
    logger.warn(
      { unknown: [...unknownStatuses] },
      'Encountered decision status / content strings not in maps.',
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
