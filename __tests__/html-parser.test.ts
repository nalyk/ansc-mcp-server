import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseAppealsTable,
  parseDecisionsTable,
} from '../src/utils/html-parser.js';
import { AppealStatus } from '../src/models/appeals.js';
import {
  ComplaintObject,
  DecisionContent,
  DecisionStatus,
} from '../src/models/decisions.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFile(resolve(here, 'fixtures', name), 'utf8');

describe('parseAppealsTable', () => {
  it('matches headers by name and parses both rows correctly', async () => {
    const html = await fixture('appeals.html');
    const r = parseAppealsTable(html, { requestedPage: 0 });
    expect(r.parserMode).toBe('header');
    expect(r.unknownHeaders).toHaveLength(0);
    expect(r.unknownStatuses).toHaveLength(0);
    expect(r.items).toHaveLength(2);

    expect(r.items[0]).toMatchObject({
      registrationNumber: '02/0001/24',
      challenger: 'ACME SRL',
      contractingAuthority: 'Primaria Chisinau',
      procedureNumber: 'ocds-b3wdp1-MD-1700000000000',
      status: AppealStatus.UnderReview,
      statusRaw: 'În examinare',
    });
    expect(r.items[1]?.status).toBe(AppealStatus.DecisionAdopted);
    expect(r.pagination).toEqual({
      currentPage: 0,
      totalPages: 6,
      perPage: 30,
      hasNextPage: true,
      hasPrevPage: false,
    });
  });

  it('falls back to positional indices when headers are reordered', async () => {
    const html = await fixture('appeals.html');
    const broken = html
      .replace('Nr. inregistrare contestatie la ANSC', 'XXX')
      .replace('Data intrare', 'YYY')
      .replace('Stare', 'ZZZ');
    const r = parseAppealsTable(broken, { requestedPage: 0 });
    expect(r.parserMode).toBe('partial');
    expect(r.unknownHeaders).toEqual(expect.arrayContaining(['xxx', 'yyy', 'zzz']));
    expect(r.items).toHaveLength(2);
    expect(r.items[0]?.registrationNumber).toBe('02/0001/24');
    expect(r.items[0]?.statusRaw).toBe('În examinare');
  });
});

describe('parseDecisionsTable', () => {
  it('parses Romanian status, content, and complaint object into enums', async () => {
    const html = await fixture('decisions.html');
    const r = parseDecisionsTable(html, { requestedPage: 0 });
    expect(r.parserMode).toBe('header');
    expect(r.unknownStatuses).toHaveLength(0);
    expect(r.items).toHaveLength(2);

    const first = r.items[0]!;
    expect(first.decisionNumber).toBe('03D-1-24');
    expect(first.complaintObject).toBe(ComplaintObject.AwardDocumentation);
    expect(first.decisionStatus).toBe(DecisionStatus.InForce);
    expect(first.decisionContent).toEqual([
      DecisionContent.ComplaintRejected,
      DecisionContent.ComplaintUnfounded,
    ]);
    expect(first.pdfUrl).toMatch(/^https:\/\/elo\.ansc\.md\/.*id=100001$/);

    const second = r.items[1]!;
    expect(second.complaintObject).toBe(ComplaintObject.ProcedureResults);
    expect(second.decisionContent).toEqual([DecisionContent.ComplaintUpheld]);
  });

  it('reports a single-page result when no pager is present', async () => {
    const html = await fixture('decisions.html');
    const noPager = html.replace(
      /<ul class="pager">[\s\S]*?<\/ul>/,
      '',
    );
    const r = parseDecisionsTable(noPager, { requestedPage: 0 });
    expect(r.pagination).toEqual({
      currentPage: 0,
      totalPages: 1,
      perPage: 30,
      hasNextPage: false,
      hasPrevPage: false,
    });
  });
});
