import {
  extractText,
  extractImages,
  getMeta,
  getDocumentProxy,
} from 'unpdf';
import sharp from 'sharp';
import type { AnscClient } from './ansc-client.js';
import { logger } from '../logging.js';

/**
 * Accepts both the ELO portal URL (used by regular decisions and orders) and
 * direct file links served by `www.ansc.md/sites/...` (used by suspended
 * decisions). Only ANSC-controlled hostnames are allowed.
 */
export const PDF_URL_PATTERN =
  /^https:\/\/(elo\.ansc\.md\/DownloadDocs\/DownloadFileServlet\?id=\d+|www\.ansc\.md\/sites\/[^?#]+\.pdf(\?.*)?)$/i;

/** @deprecated Kept as alias for any external callers — use PDF_URL_PATTERN. */
export const ELO_URL_PATTERN = PDF_URL_PATTERN;

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MiB
const MAX_IMAGE_PAGES = 20;
const PAGE_JPEG_QUALITY = 78;

export type ExtractMode = 'auto' | 'text' | 'image';

export interface ExtractedPart {
  type: 'text' | 'image';
  text?: string;
  imageBase64?: string;
  mimeType?: string;
  pageNumber?: number;
}

export interface FetchedPdf {
  parts: ExtractedPart[];
  /** Best-effort plain text — may be garbage on scanned PDFs (always returned for fallback). */
  text: string;
  pages: number;
  filename: string;
  contentType: string;
  source: string;
  byteLength: number;
  scanned: boolean;
  pdfInfo: Record<string, unknown> | null;
}

/**
 * Download a PDF from ANSC and extract it into a multi-modal envelope.
 *
 * - Native-text PDFs: returns extracted text.
 * - Scanned PDFs (image-based — common when ANSC publishes scanned annexes
 *   or when the producer is a Canon/HP scanner with a broken Unicode CMap):
 *   returns per-page JPEG `image` parts. The host's vision-capable LLM
 *   does the OCR — language-agnostic, handles Romanian + Russian + English
 *   + mixed without a local OCR install. We deliberately use
 *   `unpdf.extractImages()` (which extracts the already-embedded raster
 *   bytes) rather than `renderPageAsImage()` (which needs a canvas
 *   backend that doesn't ship with Node).
 *
 * `mode` lets callers force one path; `auto` runs the heuristic.
 */
export async function fetchAndExtractPdf(
  client: AnscClient,
  rawUrl: string,
  mode: ExtractMode,
  signal: AbortSignal | undefined,
  onProgress?: (phase: 'download' | 'parse' | 'images', received: number, total: number | null) => void,
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
  if (fetched.body.byteLength > MAX_PDF_BYTES) {
    throw new Error(
      `PDF too large: ${fetched.body.byteLength} bytes (cap ${MAX_PDF_BYTES})`,
    );
  }

  const filename =
    fetched.filename ?? `ansc-decision-${url.searchParams.get('id') ?? 'unknown'}.pdf`;

  // Open once, reuse for text + image extraction (avoids re-parsing & worker churn).
  const data = new Uint8Array(fetched.body);
  const proxy = await getDocumentProxy(data);
  const meta = await getMeta(proxy).catch(() => null);
  const t = await extractText(proxy, { mergePages: true });
  onProgress?.('parse', 1, 1);

  const text = clean(t.text);
  const pages = t.totalPages;
  const scanned = looksScanned(text, pages, fetched.body.byteLength, meta);

  const parts: ExtractedPart[] = [];
  if (mode !== 'image') parts.push({ type: 'text', text });

  const wantImages = mode === 'image' || (mode === 'auto' && scanned);
  let imagePages = 0;
  if (wantImages) {
    const cap = Math.min(pages, MAX_IMAGE_PAGES);
    for (let page = 1; page <= cap; page++) {
      let images: Awaited<ReturnType<typeof extractImages>>;
      try {
        images = await extractImages(proxy, page);
      } catch (err) {
        logger.warn(
          { page, err: err instanceof Error ? err.message : String(err) },
          'extractImages failed for page; continuing.',
        );
        continue;
      }
      for (const im of images) {
        if (!im?.data) continue;
        const channels = im.channels === 1 ? 1 : im.channels === 4 ? 4 : 3;
        const rgb = Buffer.from(im.data);
        const jpeg = await sharp(rgb, {
          raw: { width: im.width, height: im.height, channels },
        })
          .jpeg({ quality: PAGE_JPEG_QUALITY, mozjpeg: true })
          .toBuffer();
        parts.push({
          type: 'image',
          imageBase64: jpeg.toString('base64'),
          mimeType: 'image/jpeg',
          pageNumber: page,
        });
        imagePages++;
      }
      onProgress?.('images', page, cap);
    }
  }

  const pdfInfo = (meta?.info as Record<string, unknown> | null | undefined) ?? null;
  const producerLabel = pdfInfo && typeof pdfInfo['Producer'] === 'string' ? ` (${(pdfInfo['Producer'] as string).trim()})` : '';

  return {
    parts,
    text,
    pages,
    filename,
    contentType: `${fetched.contentType}${producerLabel}`,
    source: url.toString(),
    byteLength: fetched.body.byteLength,
    scanned,
    pdfInfo,
  };
}

/**
 * Heuristic detector for scanned / broken-CMap PDFs. Most-confident first:
 *   1) Producer is a known scanner brand AND text density is low → scanned.
 *   2) Char/byte density < 0.005 → almost certainly scanned.
 *   3) Multi-page doc with extracted text but ZERO Romanian diacritics in a
 *      substantial body (>2k chars) → broken CMap, treat as scan.
 *   4) Per-page text < 80 chars → essentially no extractable text.
 */
function looksScanned(
  text: string,
  pages: number,
  bytes: number,
  meta: { info?: { Producer?: unknown; Creator?: unknown } } | null,
): boolean {
  const producer = `${stringy(meta?.info?.Producer)} ${stringy(meta?.info?.Creator)}`.toLowerCase();
  const isScannerOutput = SCANNER_PRODUCERS.some((s) => producer.includes(s));
  const density = text.length / Math.max(bytes, 1);
  const diacritics = (text.match(/[ăâîșțĂÂÎȘȚşţŞŢ]/g) ?? []).length;
  const diacriticsPerKB = (diacritics / Math.max(text.length, 1)) * 1000;

  return (
    (isScannerOutput && density < 0.01) ||
    density < 0.005 ||
    (pages >= 2 && text.length > 2000 && diacriticsPerKB < 0.5) ||
    text.length < pages * 80
  );
}

const SCANNER_PRODUCERS = [
  'canon', 'hp scan', 'scanjet', 'scansnap', 'epson', 'xerox', 'kyocera',
  'samsung scx', 'ricoh', 'brother', 'konica', 'lexmark', 'image conversion',
  'gimp', 'imagemagick', 'tiff', 'kodak',
];

function stringy(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function clean(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
