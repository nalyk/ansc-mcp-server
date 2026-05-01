import { z } from 'zod';
import { DecisionStatus } from './decisions.js';

/**
 * "Încheieri" — procedural orders issued by ANSC's panels during a case,
 * before (or alongside) a final decision. Number format: `<panel>-<seq>-<yy>`.
 *
 * - `incheieri-{year}` → general procedural orders
 * - `incheieri-de-suspendare-{year}` → orders that suspend a procurement
 *   pending review
 */
export const OrderSchema = z.object({
  orderNumber: z.string().describe("e.g. '07-32-26'"),
  date: z.string(),
  dateIso: z.string().nullable(),
  challenger: z.string(),
  contractingAuthority: z.string(),
  appealElements: z.string().describe("Appeal-type code, e.g. 'RP', 'DA'."),
  contentRaw: z.string(),
  panel: z.string().describe("e.g. 'COMPLET1'"),
  procedureNumber: z.string(),
  procedureType: z.string(),
  procurementObject: z.string(),
  status: z.nativeEnum(DecisionStatus).nullable(),
  statusRaw: z.string(),
  pdfUrl: z.string(),
  appealNumber: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

export const OrderSearchInputShape = {
  year: z.number().int().min(2014).max(9999).optional(),
  page: z.number().int().nonnegative().optional().default(0),
} as const;
export const OrderSearchSchema = z.object(OrderSearchInputShape);
export type OrderSearchParams = z.infer<typeof OrderSearchSchema>;
