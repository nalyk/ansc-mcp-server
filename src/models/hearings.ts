import { z } from 'zod';

export const HearingSchema = z.object({
  ordinal: z.number().int().nonnegative().describe('Position on the day’s agenda.'),
  date: z.string().describe('dd.mm.yyyy as ANSC publishes it on the agenda body table.'),
  dateIso: z.string().nullable(),
  time: z.string().describe('HH:MM as published.'),
  parties: z.string().describe("Free-text 'X SRL / Y SA' as published."),
  challenger: z.string().describe('Best-effort split from `parties` (left of "/").'),
  contractingAuthority: z.string().describe('Best-effort split from `parties` (right of "/").'),
  registrationNumber: z.string(),
  object: z.string(),
  panel: z.string().describe("Numeric panel id ('1', '2', …) as printed."),
  agendaUrl: z.string(),
});
export type Hearing = z.infer<typeof HearingSchema>;

export const HearingDaySchema = z.object({
  dateLabel: z.string().describe('Romanian date label, e.g. "29 aprilie 2026".'),
  dateIso: z.string().nullable(),
  url: z.string(),
  startTime: z.string().nullable(),
});
export type HearingDay = z.infer<typeof HearingDaySchema>;
