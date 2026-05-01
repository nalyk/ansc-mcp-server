import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Pre-canned LLM workflows. Clients surface these as slash-commands or
 * "starter prompts"; selecting one populates the chat with the messages
 * returned here. Arguments are completed by the SDK against the Zod
 * schemas below.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'summarize_ansc_decision',
    {
      title: 'Summarize an ANSC decision PDF',
      description:
        'Fetch a single ANSC decision (by decision number OR ELO URL) and produce ' +
        'a structured Romanian/English summary: facts, grounds, ruling, legal basis.',
      argsSchema: {
        identifier: z
          .string()
          .min(3)
          .describe(
            "Decision number (e.g. '03D-962-24') OR full ELO URL.",
          ),
      },
    },
    ({ identifier }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `You are an analyst of Moldovan public-procurement law. Use the available MCP tools ` +
              `to retrieve the ANSC decision identified by '${identifier}'.\n\n` +
              `Steps:\n` +
              `1. If '${identifier}' looks like a decision number (e.g. '03D-962-24'), call ` +
              `   get_decision_by_number to find the row, then call fetch_ansc_decision with its pdfUrl.\n` +
              `2. If '${identifier}' is an ELO URL, call fetch_ansc_decision directly.\n` +
              `3. Read the extracted text. Produce a structured summary in this format:\n` +
              `   - **Parties**: challenger vs contracting authority\n` +
              `   - **Procurement**: object, type, OCDS ID\n` +
              `   - **Grounds**: which appeal grounds (admisă/respinsă/etc.)\n` +
              `   - **Ruling**: decision content (admisă, respinsă, măsuri de remediere, …)\n` +
              `   - **Legal basis**: the articles cited (Legea nr. 131/2015 etc.)\n` +
              `   - **Status**: in force / canceled / suspended\n` +
              `Keep the summary under 400 words. Quote dates verbatim.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'procurement_audit',
    {
      title: 'Audit a public procurement',
      description:
        'Given an OCDS procurement ID, retrieve every appeal and decision tied to it ' +
        'and produce a chronological narrative of the contestation history.',
      argsSchema: {
        procedureNumber: z
          .string()
          .min(5)
          .describe("OCDS ID, e.g. 'ocds-b3wdp1-MD-1740472744894'."),
      },
    },
    ({ procedureNumber }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Investigate Moldovan public procurement '${procedureNumber}'.\n\n` +
              `1. Call get_procurement_history with this OCDS ID to retrieve all linked appeals + decisions.\n` +
              `2. For each decision, optionally call fetch_ansc_decision on its pdfUrl if richer detail is needed.\n` +
              `3. Produce a chronological narrative:\n` +
              `   - When was each appeal filed, by whom, against which contracting authority?\n` +
              `   - What was each ANSC decision (admisă / respinsă / măsuri de remediere)?\n` +
              `   - Are there any decisions that were later canceled or suspended by a court?\n` +
              `   - What patterns emerge (multiple challengers? recurring grounds?)\n` +
              `4. End with a one-paragraph assessment of how contested this procurement is.\n` +
              `Quote registration numbers and dates verbatim. Cite the ELO PDF URLs.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'compare_appeals',
    {
      title: 'Compare two ANSC appeals',
      description:
        'Side-by-side comparison of two appeals: same authority? same grounds? same outcome? ' +
        'Useful for spotting patterns and inconsistencies.',
      argsSchema: {
        firstRegistration: z
          .string()
          .min(3)
          .describe("First appeal registration number, e.g. '02/1245/24'."),
        secondRegistration: z
          .string()
          .min(3)
          .describe("Second appeal registration number, e.g. '02/0001/24'."),
      },
    },
    ({ firstRegistration, secondRegistration }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Compare two ANSC appeals: '${firstRegistration}' vs '${secondRegistration}'.\n\n` +
              `1. Call get_appeal_by_registration for each to retrieve appeal metadata.\n` +
              `2. For each, also call get_procurement_history with the appeal's procedureNumber to see linked decisions.\n` +
              `3. If decisions exist with PDFs, fetch one or two via fetch_ansc_decision for richer detail.\n` +
              `4. Produce a comparison table:\n` +
              `   |   | ${firstRegistration} | ${secondRegistration} |\n` +
              `   | Contracting authority | ... | ... |\n` +
              `   | Challenger | ... | ... |\n` +
              `   | Procurement object | ... | ... |\n` +
              `   | Appeal status | ... | ... |\n` +
              `   | Decision outcome | ... | ... |\n` +
              `5. End with a paragraph on similarities and divergences.`,
          },
        },
      ],
    }),
  );
}
