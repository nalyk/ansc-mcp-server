import { z } from 'zod';

export enum AppealStatus {
  Withdrawn = 1,
  CanceledNumber = 2,
  UnderReview = 3,
  DecisionAdopted = 4,
  WithdrawnComplaint = 5,
  PreliminaryExamination = 6,
  AwaitingFile = 7,
  ReturnedForCorrection = 8,
  NotWithinAnscCompetence = 9,
  UnderReviewProcedureSuspended = 10,
  AwaitingExplanationsFromCA = 11,
  WithdrawnComplaintUnspecified = 12,
  WithdrawnComplaintNotJeopardizeCA = 13,
  WithdrawnComplaintNationalSituation = 14,
  AwaitingFileAndExplanations = 15,
  WithdrawnComplaintCAArgumentsAccepted = 16,
  WithdrawnComplaintUnfounded = 17,
  WithdrawnComplaintProcedureCanceled = 18,
  WithdrawnComplaintRemedialMeasures = 19,
}

/** Authoritative Romanian → enum map. Used by the HTML parser. */
export const APPEAL_STATUS_TEXT_MAP: ReadonlyMap<string, AppealStatus> = new Map([
  ['Retrasă', AppealStatus.Withdrawn],
  ['Număr anulat', AppealStatus.CanceledNumber],
  ['În examinare', AppealStatus.UnderReview],
  ['Decizie adoptată', AppealStatus.DecisionAdopted],
  ['Contestație retrasă', AppealStatus.WithdrawnComplaint],
  ['Examinare preliminară', AppealStatus.PreliminaryExamination],
  ['În așteptarea dosarului', AppealStatus.AwaitingFile],
  ['Restituită spre corectare', AppealStatus.ReturnedForCorrection],
  ['Nu ține de competența ANSC', AppealStatus.NotWithinAnscCompetence],
  ['În examinare, Procedură suspendată', AppealStatus.UnderReviewProcedureSuspended],
  ['În așteptarea explicațiilor de la AC', AppealStatus.AwaitingExplanationsFromCA],
  ['Contestație retrasă – motiv neprecizat', AppealStatus.WithdrawnComplaintUnspecified],
  ['Contestație retrasă – pentru a nu pereclita activitatea AC', AppealStatus.WithdrawnComplaintNotJeopardizeCA],
  ['Contestație retrasă – motivul situației excepționale în țară', AppealStatus.WithdrawnComplaintNationalSituation],
  ['In așteptarea dosarului/ În așteptarea explicațiilor de la AC', AppealStatus.AwaitingFileAndExplanations],
  ['Contestație retrasă – argumentele AC acceptate de contestator', AppealStatus.WithdrawnComplaintCAArgumentsAccepted],
  ['Contestație retrasă – apreciată de contestator ca neîntemeiată', AppealStatus.WithdrawnComplaintUnfounded],
  ['Contestație retrasă - procedură anulată, contestație rămasă fără obiect', AppealStatus.WithdrawnComplaintProcedureCanceled],
  ['Contestație retrasă – măsuri de remediere efectuate de către AC, contestație rămasă fără obiect', AppealStatus.WithdrawnComplaintRemedialMeasures],
]);

export const AppealSchema = z.object({
  registrationNumber: z.string().describe("e.g. '02/279/25'"),
  entryDate: z.string().describe("dd/mm/yyyy as ANSC publishes it"),
  exitNumber: z.string(),
  challenger: z.string(),
  contractingAuthority: z.string(),
  complaintObject: z.string(),
  procedureNumber: z.string().describe("OCDS ID e.g. 'ocds-b3wdp1-MD-1740472744894'"),
  procedureType: z.string(),
  procurementObject: z.string(),
  status: z.nativeEnum(AppealStatus),
  statusRaw: z.string().describe('The original Romanian status string from the ANSC table.'),
});
export type Appeal = z.infer<typeof AppealSchema>;

export const AppealSearchInputShape = {
  year: z
    .number()
    .int()
    .min(2014)
    .max(9999)
    .optional()
    .describe('Year to search in (defaults to the current year).'),
  authority: z.string().min(1).optional().describe('Contracting authority name (substring match).'),
  challenger: z.string().min(1).optional().describe('Challenger name (substring match).'),
  procedureNumber: z
    .string()
    .min(1)
    .optional()
    .describe("MTender OCDS ID, e.g. 'ocds-b3wdp1-MD-1740472744894'."),
  status: z
    .nativeEnum(AppealStatus)
    .optional()
    .describe('Appeal status code (1–19). See AppealStatus enum.'),
  page: z.number().int().nonnegative().optional().default(0).describe('Zero-based page number.'),
} as const;

export const AppealSearchSchema = z.object(AppealSearchInputShape);
export type AppealSearchParams = z.infer<typeof AppealSearchSchema>;
