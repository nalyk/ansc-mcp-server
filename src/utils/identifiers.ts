/**
 * Identifier helpers for ANSC's Romanian-formatted strings.
 *
 * - Appeal registration numbers: `02/<seq>/<yy>` — e.g. `02/1245/24` → 2024.
 * - Decision numbers: `<panel>D-<seq>-<yy>` — e.g. `03D-962-24` → 2024.
 * - Dates: `dd/mm/yyyy` → ISO `yyyy-mm-dd`.
 *
 * All converters are tolerant: they trim whitespace and strip trailing
 * punctuation that ANSC sometimes leaves on table cells (trailing `;`).
 */

const ANSC_FIRST_YEAR = 2014;
const ANSC_LAST_REASONABLE_YEAR = 2099;

export function cleanAppealNumber(raw: string): string {
  return raw.trim().replace(/[;,]+$/g, '').trim();
}

export function yearFromAppealRegistration(raw: string): number {
  const cleaned = cleanAppealNumber(raw);
  const match = /^\d+\/\d+\/(\d{2,4})$/.exec(cleaned);
  if (!match) {
    throw new Error(
      `Cannot parse year from appeal registration number '${raw}' (expected '02/<seq>/<yy>').`,
    );
  }
  return expandYear(match[1]!);
}

export function yearFromDecisionNumber(raw: string): number {
  const cleaned = cleanAppealNumber(raw);
  const match = /-(\d{2,4})$/.exec(cleaned);
  if (!match) {
    throw new Error(
      `Cannot parse year from decision number '${raw}' (expected '<panel>D-<seq>-<yy>').`,
    );
  }
  return expandYear(match[1]!);
}

export function expandYear(yearDigits: string): number {
  const n = Number(yearDigits);
  if (!Number.isInteger(n)) throw new Error(`Invalid year digits: '${yearDigits}'.`);
  if (yearDigits.length === 4) return n;
  // Two-digit year: assume 20xx (ANSC was created in 2014).
  if (n >= 0 && n <= 99) return 2000 + n;
  throw new Error(`Year out of range: '${yearDigits}'.`);
}

/**
 * OCDS IDs in MTender follow `ocds-<prefix>-MD-<timestamp>`. The trailing
 * timestamp is creation time in milliseconds (sometimes seconds for older
 * records). We use it to bracket the year(s) we should scan in ANSC.
 */
export function yearFromOcdsId(ocdsId: string): number | null {
  const m = /(\d{10,16})$/.exec(ocdsId.trim());
  if (!m) return null;
  const digits = m[1]!;
  const n = Number(digits);
  if (!Number.isInteger(n)) return null;
  const ms = digits.length >= 13 ? n : n * 1000;
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  return isPlausibleYear(year) ? year : null;
}

export function isPlausibleYear(n: number): boolean {
  return Number.isInteger(n) && n >= ANSC_FIRST_YEAR && n <= ANSC_LAST_REASONABLE_YEAR;
}

/**
 * Convert ANSC's `dd/mm/yyyy` cell into an ISO 8601 date (`yyyy-mm-dd`).
 * Returns null when the input doesn't match — callers keep the raw value.
 */
export function dmyToIso(raw: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/.exec(raw);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  const year = expandYear(yyyy!);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const iso = `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  return iso;
}
