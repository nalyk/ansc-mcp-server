import { PDFParse } from 'pdf-parse';
import type { AnscClient } from './ansc-client.js';

/**
 * Accepts both the ELO portal URL (used by regular decisions and orders) and
 * direct file links served by `www.ansc.md/sites/...` (used by suspended
 * decisions). Only ANSC-controlled hostnames are allowed.
 */
export const PDF_URL_PATTERN =
  /^https:\/\/(elo\.ansc\.md\/DownloadDocs\/DownloadFileServlet\?id=\d+|www\.ansc\.md\/sites\/[^?#]+\.pdf(\?.*)?)$/i;

/** @deprecated Kept as alias for any external callers — use PDF_URL_PATTERN. */
export const ELO_URL_PATTERN = PDF_URL_PATTERN;

export interface FetchedPdf {
  text: string;
  pageCount: number;
  filename: string;
  contentType: string;
  source: string;
  byteLength: number;
  info: Record<string, unknown> | null;
}

export async function fetchAndExtractPdf(
  client: AnscClient,
  rawUrl: string,
  signal: AbortSignal | undefined,
  onProgress?: (phase: 'download' | 'parse', received: number, total: number | null) => void,
): Promise<FetchedPdf> {
  const url = new URL(rawUrl.replace(/^http:\/\//, 'https://'));
  if (!PDF_URL_PATTERN.test(url.toString())) {
    throw new Error(
      'documentUrl must point to an ANSC PDF: either elo.ansc.md/DownloadDocs/DownloadFileServlet?id=<digits> or www.ansc.md/sites/.../*.pdf',
    );
  }

  const fetched = await client.fetchBinary(url, signal, (received, total) => {
    onProgress?.('download', received, total);
  });

  if (!fetched.contentType.includes('pdf')) {
    throw new Error(`Unsupported document content-type: ${fetched.contentType}`);
  }

  const filename =
    fetched.filename ?? `ansc-decision-${url.searchParams.get('id') ?? 'unknown'}.pdf`;

  const parser = new PDFParse({ data: fetched.body });
  try {
    const [textRes, infoRes] = await Promise.all([parser.getText(), parser.getInfo()]);
    onProgress?.('parse', 1, 1);

    const cleaned = textRes.text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return {
      text: cleaned,
      pageCount: textRes.pages.length,
      filename,
      contentType: fetched.contentType,
      source: url.toString(),
      byteLength: fetched.body.byteLength,
      info: (infoRes.info as Record<string, unknown> | null | undefined) ?? null,
    };
  } finally {
    await parser.destroy();
  }
}
