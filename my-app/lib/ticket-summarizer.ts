import { JarvisLabsLLM } from "@/lib/jarvislabs/client";

export type TicketSummaryPayload = {
  summary: string;
  description?: string;
  comment?: string;
  attachment?: string;
};

export function buildTicketEnvelope(ticket: TicketSummaryPayload): string {
  const parts = [
    ticket.summary?.trim(),
    ticket.description?.trim(),
    ticket.comment?.trim(),
    ticket.attachment?.trim(),
  ].filter(Boolean);

  return parts.join("\n\n").trim();
}

export async function summarizeTicketPayload(
  ticket: TicketSummaryPayload
): Promise<string> {
  const llm = new JarvisLabsLLM({ maxTokens: 1024, temperature: 0.3 });

  const prompt = `You are a support triage assistant. Given a ticket with a short summary, a description, optional engineer comments, and any pasted output, produce a crisp 5-7 sentence summary that captures the core issue, impact, environment clues, and any attempted fixes. Avoid fluff and avoid hallucinating details.

Summary: ${ticket.summary || ""}
Description: ${ticket.description || ""}
Engineer Comments: ${ticket.comment || ""}
Attachment / Output: ${ticket.attachment || ""}

Return only the summary text.`;

  const result = await llm.invoke(prompt);
  return typeof result === "string" ? result.trim() : JSON.stringify(result);
}
