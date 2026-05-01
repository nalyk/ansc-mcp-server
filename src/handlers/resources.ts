import {
  ResourceTemplate,
  type McpServer,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnscClient } from '../api/ansc-client.js';

const FIRST_AVAILABLE_YEAR = 2014;

function availableYears(): string[] {
  const current = new Date().getFullYear();
  const years: string[] = [];
  for (let y = current; y >= FIRST_AVAILABLE_YEAR; y--) years.push(String(y));
  return years;
}

function parseYear(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < FIRST_AVAILABLE_YEAR || n > 9999) {
    throw new Error(`Invalid year '${value}' — must be ${FIRST_AVAILABLE_YEAR}..current.`);
  }
  return n;
}

function parsePage(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid page '${value}'.`);
  return n;
}

export function registerResources(server: McpServer, client: AnscClient): void {
  // Static "current year" shortcuts. -------------------------------------------------

  server.registerResource(
    'appeals-current',
    'ansc://appeals/current',
    {
      title: 'Current-year appeals',
      description: 'Appeals for the current year (page 0).',
      mimeType: 'application/json',
    },
    async (uri, extra) => {
      const result = await client.searchAppeals({ page: 0 }, extra.signal);
      return jsonResource(uri, result);
    },
  );

  server.registerResource(
    'decisions-current',
    'ansc://decisions/current',
    {
      title: 'Current-year decisions',
      description: 'Decisions for the current year (page 0).',
      mimeType: 'application/json',
    },
    async (uri, extra) => {
      const result = await client.searchDecisions({ page: 0 }, extra.signal);
      return jsonResource(uri, result);
    },
  );

  // RFC 6570 templates with year + page completions. --------------------------------

  const yearComplete = async (value: string) =>
    availableYears().filter((y) => y.startsWith(value));
  const pageComplete = async (value: string) =>
    Array.from({ length: 21 }, (_, i) => String(i)).filter((p) => p.startsWith(value));

  const appealsByYear = new ResourceTemplate('ansc://appeals/{year}', {
    list: async () => ({
      resources: availableYears().map((y) => ({
        uri: `ansc://appeals/${y}`,
        name: `Appeals ${y}`,
        mimeType: 'application/json',
      })),
    }),
    complete: { year: yearComplete },
  });

  const appealsByYearPage = new ResourceTemplate(
    'ansc://appeals/{year}/page/{page}',
    {
      list: undefined,
      complete: { year: yearComplete, page: pageComplete },
    },
  );

  const decisionsByYear = new ResourceTemplate('ansc://decisions/{year}', {
    list: async () => ({
      resources: availableYears().map((y) => ({
        uri: `ansc://decisions/${y}`,
        name: `Decisions ${y}`,
        mimeType: 'application/json',
      })),
    }),
    complete: { year: yearComplete },
  });

  const decisionsByYearPage = new ResourceTemplate(
    'ansc://decisions/{year}/page/{page}',
    {
      list: undefined,
      complete: { year: yearComplete, page: pageComplete },
    },
  );

  server.registerResource(
    'appeals-by-year',
    appealsByYear,
    {
      title: 'Appeals by year',
      description: 'All appeals for a given year (page 0). Use the paginated template for other pages.',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const year = parseYear(asScalar(variables['year']));
      const result = await client.searchAppeals({ year, page: 0 }, extra.signal);
      return jsonResource(uri, result);
    },
  );

  server.registerResource(
    'appeals-by-year-page',
    appealsByYearPage,
    {
      title: 'Appeals by year and page',
      description: 'Specific page of appeals for a given year (zero-based page index).',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const year = parseYear(asScalar(variables['year']));
      const page = parsePage(asScalar(variables['page']));
      const result = await client.searchAppeals({ year, page }, extra.signal);
      return jsonResource(uri, result);
    },
  );

  server.registerResource(
    'decisions-by-year',
    decisionsByYear,
    {
      title: 'Decisions by year',
      description: 'All decisions for a given year (page 0).',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const year = parseYear(asScalar(variables['year']));
      const result = await client.searchDecisions({ year, page: 0 }, extra.signal);
      return jsonResource(uri, result);
    },
  );

  server.registerResource(
    'decisions-by-year-page',
    decisionsByYearPage,
    {
      title: 'Decisions by year and page',
      description: 'Specific page of decisions for a given year.',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const year = parseYear(asScalar(variables['year']));
      const page = parsePage(asScalar(variables['page']));
      const result = await client.searchDecisions({ year, page }, extra.signal);
      return jsonResource(uri, result);
    },
  );
}

function asScalar(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function jsonResource(uri: URL, payload: unknown) {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: 'application/json',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}
