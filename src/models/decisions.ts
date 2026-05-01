import { z } from 'zod';

export enum DecisionStatus {
  InForce = 1,
  CanceledByCourt = 2,
  SuspendedByCourt = 3,
}

export enum DecisionContent {
  ComplaintUpheld = 1,
  ProcedureCanceled = 2,
  ProcedurePartiallyCanceled = 3,
  RemedialMeasures = 4,
  ComplaintRejected = 5,
  ComplaintSubmittedLate = 6,
  ComplaintNonCompliant = 7,
  ComplaintUnfounded = 8,
  ComplaintPartiallyUpheld = 9,
  ReturnedWithoutMeritReview = 10,
  ComplaintWithoutInterest = 11,
  ComplaintMoot = 12,
}

export enum ComplaintObject {
  AwardDocumentation = 1,
  ProcedureResults = 6,
}

/** AppealGrounds are filter codes the ANSC search form accepts. They are not surfaced in row output. */
export enum AppealGrounds {
  RejectionNonCompliantUnacceptable = 1,
  RejectionUnacceptableRequirements = 2,
  RejectionUnacceptableBudget = 3,
  RejectionNonCompliantTechnical = 4,
  RejectionBidGuarantee = 5,
  RejectionAbnormallyLowPrice = 6,
  RejectionWithoutClarification = 7,
  RejectionLateDocuments = 8,
  RejectionModifiedContent = 9,
  RejectionProposalContentChange = 10,
  RejectionScoringEvaluation = 11,
  RejectionIrrelevant = 12,
  RejectionIncorrectForms = 13,
  AcceptanceNonCompliant = 14,
  AcceptanceQualificationRequirements = 15,
  AcceptanceTechnicalRequirements = 16,
  AcceptanceBidGuarantee = 17,
  AcceptanceAbnormallyLowPrice = 18,
  AcceptanceTechnicalModification = 19,
  AcceptanceFinancialModification = 20,
  AcceptanceScoringEvaluation = 21,
  AcceptanceIncorrectForms = 22,
  NoResultInformation = 23,
  UnjustifiedCancellation = 24,
  TechnicalErrors = 25,
  Other = 26,
  RestrictivePersonalRequirements = 27,
  RestrictiveFinancialRequirements = 28,
  RestrictiveCashRequirements = 29,
  RestrictiveTurnoverRequirements = 30,
  RestrictiveTechnicalRequirements = 31,
  RestrictiveSimilarExperience = 32,
  RestrictiveQualityStandards = 33,
  RestrictiveTechnicalSpecs = 34,
  NonTransparentEvaluation = 35,
  SpecificBrands = 36,
  UnclearResponses = 37,
  BidGuaranteeForm = 38,
  UnfairContractClauses = 39,
  NoLotDivision = 40,
  IncompleteDocumentation = 41,
  OtherDocumentation = 42,
}

export const DECISION_STATUS_TEXT_MAP: ReadonlyMap<string, DecisionStatus> = new Map([
  ['În vigoare', DecisionStatus.InForce],
  ['Anulată de instanță', DecisionStatus.CanceledByCourt],
  ['Anulata de instanta', DecisionStatus.CanceledByCourt],
  ['Suspendată de instanță', DecisionStatus.SuspendedByCourt],
  ['Suspendata de instanta', DecisionStatus.SuspendedByCourt],
]);

export const DECISION_CONTENT_TEXT_MAP: ReadonlyMap<string, DecisionContent> = new Map([
  ['Contestație admisă', DecisionContent.ComplaintUpheld],
  ['Contestatie admisa', DecisionContent.ComplaintUpheld],
  ['Procedură anulată', DecisionContent.ProcedureCanceled],
  ['Procedura anulata', DecisionContent.ProcedureCanceled],
  ['Procedură anulată parțial', DecisionContent.ProcedurePartiallyCanceled],
  ['Procedura anulata partial', DecisionContent.ProcedurePartiallyCanceled],
  ['Măsuri de remediere', DecisionContent.RemedialMeasures],
  ['Masuri de remediere', DecisionContent.RemedialMeasures],
  ['Contestație respinsă', DecisionContent.ComplaintRejected],
  ['Contestatie respinsa', DecisionContent.ComplaintRejected],
  ['Contestație depusă tardiv', DecisionContent.ComplaintSubmittedLate],
  ['Contestatie depusa tardiv', DecisionContent.ComplaintSubmittedLate],
  ['Contestație neconformă', DecisionContent.ComplaintNonCompliant],
  ['Contestatie neconforma', DecisionContent.ComplaintNonCompliant],
  ['Contestația neîntemeiată', DecisionContent.ComplaintUnfounded],
  ['Contestatia neintemeiata', DecisionContent.ComplaintUnfounded],
  ['Contestație admisă parțial', DecisionContent.ComplaintPartiallyUpheld],
  ['Contestatie admisa partial', DecisionContent.ComplaintPartiallyUpheld],
  ['Contestație parțial admisă', DecisionContent.ComplaintPartiallyUpheld],
  ['Contestatie partial admisa', DecisionContent.ComplaintPartiallyUpheld],
  ['Se restituie fără examinare în fond', DecisionContent.ReturnedWithoutMeritReview],
  ['Se restituie fara examinare in fond', DecisionContent.ReturnedWithoutMeritReview],
  ['Contestație lipsită de interes', DecisionContent.ComplaintWithoutInterest],
  ['Contestatie lipsita de interes', DecisionContent.ComplaintWithoutInterest],
  ['Ca rămasă fără obiect', DecisionContent.ComplaintMoot],
  ['Ca ramasa fara obiect', DecisionContent.ComplaintMoot],
]);

export const COMPLAINT_OBJECT_TEXT_MAP: ReadonlyMap<string, ComplaintObject> = new Map([
  ['Documentația de atribuire', ComplaintObject.AwardDocumentation],
  ['Documentatia de atribuire', ComplaintObject.AwardDocumentation],
  ['Rezultatele procedurii', ComplaintObject.ProcedureResults],
]);

export const DecisionSchema = z.object({
  decisionNumber: z.string().describe("e.g. '03D-6-25'"),
  date: z.string().describe('dd/mm/yyyy'),
  challenger: z.string(),
  contractingAuthority: z.string(),
  complaintObject: z.nativeEnum(ComplaintObject).nullable(),
  complaintObjectRaw: z.string(),
  complaintElements: z.string(),
  complete: z.string().describe("e.g. 'COMPLET2' — adjudicating panel marker"),
  procedureNumber: z.string().describe("OCDS ID e.g. 'ocds-b3wdp1-MD-1732172264229'"),
  decisionContent: z.array(z.nativeEnum(DecisionContent)),
  decisionContentRaw: z.string(),
  procedureType: z.string(),
  procurementObject: z.string(),
  decisionStatus: z.nativeEnum(DecisionStatus).nullable(),
  decisionStatusRaw: z.string(),
  pdfUrl: z.string().describe("ELO download URL: https://elo.ansc.md/DownloadDocs/DownloadFileServlet?id=…"),
  reportingStatus: z.string(),
  appealNumber: z.string().describe("e.g. '02/1119/24'"),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const DecisionSearchInputShape = {
  year: z.number().int().min(2014).max(9999).optional().describe('Defaults to current year.'),
  authority: z.string().min(1).optional(),
  challenger: z.string().min(1).optional(),
  procurementObject: z.string().min(1).optional(),
  decisionStatus: z.array(z.nativeEnum(DecisionStatus)).nonempty().optional(),
  decisionContent: z.array(z.nativeEnum(DecisionContent)).nonempty().optional(),
  appealGrounds: z.array(z.nativeEnum(AppealGrounds)).nonempty().optional(),
  complaintObject: z.nativeEnum(ComplaintObject).optional(),
  appealNumber: z.string().min(1).optional().describe("e.g. '02/279/25'"),
  page: z.number().int().nonnegative().optional().default(0),
} as const;

export const DecisionSearchSchema = z.object(DecisionSearchInputShape);
export type DecisionSearchParams = z.infer<typeof DecisionSearchSchema>;
