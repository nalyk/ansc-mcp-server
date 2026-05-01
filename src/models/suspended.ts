import { z } from 'zod';

/**
 * Court-suspended decisions. Number format: `03DS-<seq>-<yy>` (DS for
 * "Decizie Suspendată"). Listed at `/ro/content/decizii-suspendate-{year}`.
 *
 * The presence of an entry here means a court has ordered ANSC's prior
 * decision to NOT take effect pending court review — i.e., a regular
 * decision returned by `search_decisions` may still appear with
 * `decisionStatus: InForce` while it has been suspended in court.
 */
export const SuspendedDecisionSchema = z.object({
  decisionNumber: z.string().describe("e.g. '03DS-64-24'"),
  date: z.string(),
  dateIso: z.string().nullable(),
  challenger: z.string(),
  contractingAuthority: z.string(),
  complaintObjectRaw: z.string(),
  contentRaw: z.string().describe('e.g. "Se suspendă procedura de achiziție publică"'),
  procedureNumber: z.string(),
  procurementObject: z.string(),
  pdfUrl: z.string(),
  appealNumber: z.string(),
  reportingStatus: z.string(),
});
export type SuspendedDecision = z.infer<typeof SuspendedDecisionSchema>;

export const SuspendedSearchInputShape = {
  year: z.number().int().min(2014).max(9999).optional(),
  page: z.number().int().nonnegative().optional().default(0),
} as const;
export const SuspendedSearchSchema = z.object(SuspendedSearchInputShape);
export type SuspendedSearchParams = z.infer<typeof SuspendedSearchSchema>;
