import { prisma } from "@/lib/prisma";
import { embedQuery } from "./embeddings";
import { querySimilar, getChunkById, listNamespaces, type ChunkRow } from "./store";
import { JarvisLabsLLM } from "@/lib/jarvislabs/client";

const MIN_RELEVANCE_SCORE = 0.6;
const MAX_CONTEXT_MATCHES = 3;

const CHAT_FALLBACK_RESPONSE =
  "I don't have enough information to answer that right now. Please try rephrasing the question or share more detail.";

const STRICT_HALLUCINATION_TERMS = [
  "cisco", "nx-os", "nexus", "ios-xe", "ios xr", "pan-os", "arista", "juniper",
  "fortinet", "aws", "azure", "gcp", "palo alto", "checkpoint", "f5", "vmware",
  "dell", "hp ", "hpe", "extreme networks",
];

function isServiceNowTicket(query: string): boolean {
  return query.toLowerCase().includes("servicenow");
}

function isDuplicateTicket(content: string): boolean {
  return [
    /DUPLICATE ISSUE DETECTED/i,
    /This ticket appears to be a duplicate of:/i,
    /duplicate of:\s*[A-Z]+-\d+/i,
    /marked as duplicate/i,
    /close(?:d)?\s+as\s+duplicate/i,
  ].some((pattern) => pattern.test(content));
}

/** Rewards a resolution with concrete, numbered/technical steps over a vague one - ported
 * as-is from lib/pinecone/query.ts, pure string scoring with no Pinecone/Bedrock dependency. */
function scoreResolutionQuality(content: string): number {
  const resolutionMatch = content.match(/RESOLUTION:\s*([^]*?)(?=\n\n|\n[A-Z]+:|\n---|\n\s*$)/i);
  if (!resolutionMatch) return 0;

  const resolution = resolutionMatch[1].trim();
  let score = 50;

  [/\*\*Step \d+:/gi, /Step \d+:/gi, /\d+\.\s+/g, /\*\s+/g].forEach((pattern) => {
    const matches = resolution.match(pattern);
    if (matches) score += matches.length * 15;
  });

  if (resolution.length > 200) score += 20;
  if (resolution.length > 400) score += 10;

  [/`[^`]+`/g, /show\s+\w+/gi, /configure\s+terminal/gi, /clear\s+[\w-]+/gi].forEach((pattern) => {
    const matches = resolution.match(pattern);
    if (matches) score += matches.length * 10;
  });

  return Math.max(0, score);
}

export const retryWithBackoff = async <T>(fn: () => Promise<T>, maxRetries = 3, initialDelayMs = 2000): Promise<T> => {
  let lastError: unknown;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delayMs = initialDelayMs * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
};

function extractField(content: string, label: string): string {
  const match = content.match(new RegExp(`${label}:\\s*([^\\n]+(?:\\n(?![A-Z][A-Z0-9 _-]*:)[^\\n]*)*)`, "i"));
  return match ? match[1].trim() : "";
}

async function getPrismaConversationHistory(chatId: string, limit: number): Promise<string> {
  if (!chatId) return "";
  try {
    const messages = await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    if (!messages.length) return "";
    return messages
      .reverse()
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
  } catch (error) {
    // Chat history isn't essential to answering - degrade to answering without prior turns
    // rather than failing the whole query.
    console.warn("[pgvector/query] could not load conversation history", error);
    return "";
  }
}

async function fetchChunkWindow(match: ChunkRow): Promise<{ prev: string; current: string; next: string }> {
  const prev = match.prevChunkId ? await getChunkById(match.prevChunkId) : null;
  const next = match.nextChunkId ? await getChunkById(match.nextChunkId) : null;
  return {
    prev: prev?.content || "",
    current: match.content || "",
    next: next?.content || "",
  };
}

function detectHallucination(assembledContext: string, llmResponse: string): string[] {
  const contextLower = assembledContext.toLowerCase();
  const responseLower = llmResponse.toLowerCase();
  return STRICT_HALLUCINATION_TERMS.filter(
    (term) => responseLower.includes(term) && !contextLower.includes(term),
  );
}

/**
 * Chat-style Q&A over the knowledge base. Replaces Pinecone+Bedrock's
 * queryPineconeVectorStoreAndQueryLLM/queryPineconeMultiNamespaceForChat: embeds the query,
 * searches every namespace matching `namespacePrefix` (or every namespace if omitted) via
 * pgvector cosine distance, assembles a prev/current/next context window per match, and asks
 * Jarvislabs to answer grounded in that context - with the same hallucinated-term guard the
 * Bedrock version used.
 */
export const queryChatAndAnswer = async (
  { query, chatId, namespacePrefix }: { query: string; chatId?: string; namespacePrefix?: string },
) => {
  return retryWithBackoff(async () => {
    const queryEmbedding = await embedQuery(query);
    const namespaces = await listNamespaces(namespacePrefix);
    const searchSpace = namespaces.length > 0 ? namespaces : ["default"];

    const allMatches = (
      await Promise.all(searchSpace.map((namespace) => querySimilar(namespace, queryEmbedding, 5)))
    )
      .flat()
      .sort((a, b) => b.score - a.score);

    const relevant = allMatches.filter((m) => m.score >= MIN_RELEVANCE_SCORE).slice(0, MAX_CONTEXT_MATCHES);
    if (relevant.length === 0) {
      return { response: CHAT_FALLBACK_RESPONSE, sourceInfo: [] };
    }

    const windows = await Promise.all(relevant.map((match) => fetchChunkWindow(match)));

    const assembledContext = windows
      .map(
        (ctx, i) =>
          `SOURCE ${i + 1} (${relevant[i].source}):\nPREV: ${ctx.prev}\nMAIN [Score: ${relevant[i].score.toFixed(2)}]: ${ctx.current}\nNEXT: ${ctx.next}\n\n`,
      )
      .join("");

    const conversationHistory = await getPrismaConversationHistory(chatId || "", 5);
    const llm = new JarvisLabsLLM({ maxTokens: 1024, temperature: 0.4 });
    const prompt = `You are a support assistant. Answer the question using ONLY the sources below, citing "(Source N)" for any claim. If the sources don't answer it, say so plainly.\n\n${conversationHistory ? `Prior conversation:\n${conversationHistory}\n\n` : ""}${assembledContext}\nQuestion: ${query}\nAnswer:`;

    const llmResponse = (await llm.invoke(prompt)).trim();
    const hallucinatedTerms = detectHallucination(assembledContext, llmResponse);
    if (hallucinatedTerms.length > 0) {
      console.warn("[pgvector/query] possible hallucinated vendor/product terms", hallucinatedTerms);
      return { response: CHAT_FALLBACK_RESPONSE, sourceInfo: [] };
    }

    return {
      response: llmResponse,
      sourceInfo: relevant.map((m, i) => ({ index: i + 1, source: m.source, score: m.score, chunkId: m.chunkId })),
    };
  });
};

export type TicketResolutionMatch = {
  type: "duplicate" | "resolution" | "none";
  score?: number;
  original_ticket_id?: string;
  original_ticket_number?: string;
  source_ticket_id?: string;
  source_ticket_number?: string;
  projectKey?: string;
  message?: string;
};

/**
 * Judges a new ticket against past tickets org-wide and drafts a resolution, or flags a likely
 * duplicate. Replaces Pinecone+Bedrock's queryPineconeForTicketResolution: searches every
 * `*_duplicate` namespace (if `duplicateNeeded`), then every `*_done` namespace - `projectKey`
 * isn't known upfront here, same as the original (lib/ticket-resolution-service.ts discovers it
 * from the match and compares it against the current ticket's project itself) - reranks by
 * similarity*0.7 + resolutionQuality*0.3, asks Jarvislabs to confirm relevance before trusting a
 * match, then asks it to draft the judgement/solution grounded in the best matching past ticket.
 *
 * Simplification from the original: namespaces aren't scoped by `orgId` (document_chunks has no
 * org column) - multi-tenant isolation here would need an `org_id` column added alongside it.
 */
export const queryPineconeForTicketResolution = async (
  { query, orgId, duplicateNeeded = true }: { query: string; orgId?: string; duplicateNeeded?: boolean },
): Promise<TicketResolutionMatch> => {
  return retryWithBackoff(async () => {
    const queryEmbedding = await embedQuery(query);
    const llm = new JarvisLabsLLM({ maxTokens: 1024, temperature: 0.3 });

    if (duplicateNeeded) {
      const duplicateNamespaces = await listNamespaces();
      const duplicateMatches = (
        await Promise.all(
          duplicateNamespaces
            .filter((ns) => ns.endsWith("_duplicate"))
            .map((ns) => querySimilar(ns, queryEmbedding, 3)),
        )
      )
        .flat()
        .sort((a, b) => b.score - a.score);

      const bestDuplicate = duplicateMatches[0];
      if (bestDuplicate && bestDuplicate.score >= 0.7) {
        return {
          type: "duplicate",
          score: bestDuplicate.score,
          original_ticket_id: bestDuplicate.ticketKey,
          projectKey: bestDuplicate.projectKey,
        };
      }
    }

    const doneNamespaces = (await listNamespaces()).filter((ns) => ns.endsWith("_done"));
    const doneMatches = (
      await Promise.all(doneNamespaces.map((ns) => querySimilar(ns, queryEmbedding, 5)))
    )
      .flat()
      .filter((m) => !isDuplicateTicket(m.content || ""));

    if (doneMatches.length === 0) {
      return { type: "none" };
    }

    const isServiceNow = isServiceNowTicket(query);
    doneMatches.sort((a, b) => b.score - a.score);
    const highestScore = doneMatches[0]?.score || 0;

    if (!(isServiceNow && highestScore >= 0.85)) {
      // Rerank by similarity + how concrete the stored resolution actually is - a vague
      // best-vector-match loses to a slightly-lower-scored match with real steps.
      doneMatches.sort((a, b) => {
        const aCombined = a.score * 0.7 + (scoreResolutionQuality(a.content || "") / 100) * 0.3;
        const bCombined = b.score * 0.7 + (scoreResolutionQuality(b.content || "") / 100) * 0.3;
        return bCombined - aCombined;
      });
    }

    const bestMatch = doneMatches[0];
    if (bestMatch.score < MIN_RELEVANCE_SCORE) {
      return { type: "none" };
    }

    const sourceSummary = extractField(query, "SUMMARY") || query.slice(0, 200);
    const matchSummary = extractField(bestMatch.content || "", "SUMMARY") || (bestMatch.content || "").slice(0, 200);

    const relevanceCheck = await llm.invoke(
      `Are these two support tickets about the same underlying problem? Answer with just "yes" or "no".\n\nNew ticket: ${sourceSummary}\n\nPast resolved ticket: ${matchSummary}`,
    );
    if (!relevanceCheck.trim().toLowerCase().startsWith("yes")) {
      return { type: "none" };
    }

    const window = await fetchChunkWindow(bestMatch);
    const draft = await llm.invoke(
      `A new support ticket needs a judgement and a proposed resolution. Use the most similar past RESOLVED ticket below as grounding, but adapt it to the new ticket's details. Cite that it's based on a past resolution.\n\nNew ticket:\n${query}\n\nMost similar resolved ticket (score ${bestMatch.score.toFixed(2)}):\n${window.current}\n\nRespond with a short judgement (is this the same class of issue) followed by a concrete step-by-step resolution.`,
    );

    return {
      type: "resolution",
      score: bestMatch.score,
      source_ticket_id: bestMatch.ticketKey,
      projectKey: bestMatch.projectKey,
      message: draft.trim(),
    };
  });
};
