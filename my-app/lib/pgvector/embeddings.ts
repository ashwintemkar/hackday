import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "@langchain/core/documents";
import { EMBEDDING_MODEL } from "@/config";

// Pinecone's hosted inference API (multilingual-e5-large, 1024-dim) generated embeddings
// before. Pinecone is gone, so embeddings now come from local Ollama - the same provider the
// rest of this repo's Ticketly skeleton already standardized on (docker-compose.yml's `ollama`
// service). nomic-embed-text is 768-dim; see config.ts's VECTOR_DIMENSIONS and
// docker/postgres/pgvector-chunks.sql's embedding column.
const OLLAMA_URL =
  process.env.OLLAMA_ENDPOINT || process.env.GEMMA_ENDPOINT || "http://localhost:11434";

function validateAndTruncateText(text: string, maxTokens: number = 1024): string {
  const estimatedTokens = Math.ceil(text.length / 4);
  if (estimatedTokens <= maxTokens) return text;
  console.warn(`Text truncated from ~${estimatedTokens} to ~${maxTokens} tokens`);
  return text.substring(0, maxTokens * 3.5);
}

async function callOllamaEmbed(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ollama embedding request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const result = (await response.json()) as { embedding?: number[] };
  if (!Array.isArray(result.embedding)) {
    throw new Error("Ollama returned no embedding vector");
  }
  return result.embedding;
}

/** Embeds document chunks for storage. Ollama's /api/embeddings embeds one prompt per call (no
 * batch endpoint on this API), unlike Pinecone's hosted inference which batched up to 96 - these
 * run sequentially instead. */
export async function embedText(texts: string[]): Promise<number[][]> {
  const validated = texts.map((text) => validateAndTruncateText(text));
  const out: number[][] = [];
  for (const text of validated) {
    out.push(await callOllamaEmbed(text));
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  return callOllamaEmbed(validateAndTruncateText(text));
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).length;
}

/** Recursive character splitting (ported as-is from lib/pinecone/embeddings.ts - this logic has
 * no Pinecone/Bedrock dependency, just LangChain's splitter) with resolution-aware chunk sizing:
 * a Jira/ServiceNow document with a long RESOLUTION section, or attachment content, gets bigger
 * chunks so a fix's steps aren't split mid-procedure. */
export const createOptimizedChunks = async (doc: Document) => {
  const lowerSource = doc.metadata.source.toLowerCase();
  const isJiraDocument = lowerSource.includes("jira_");
  const isServiceNowDocument = lowerSource.includes("servicenow_");
  const hasAttachmentContent = doc.pageContent.includes("ATTACHMENT CONTENTS:");

  let chunkSize = 1000;
  let chunkOverlap = 100;

  const hasResolution = doc.pageContent.includes("RESOLUTION:");
  const resolutionMatch = hasResolution
    ? doc.pageContent.match(
        /RESOLUTION:([\s\S]*?)(?=\n(?:[A-Z][A-Z0-9 _-]*:|---\s*Document Type:)|\s*$)/i,
      )
    : null;
  const resolutionLength = resolutionMatch?.[1]?.length ?? 0;

  if ((isJiraDocument || isServiceNowDocument) && hasResolution && resolutionLength > 500) {
    chunkSize = 2000;
    chunkOverlap = 300;
  } else if ((isJiraDocument || isServiceNowDocument) && hasAttachmentContent) {
    const docSize = doc.pageContent.length;
    if (docSize > 10000) {
      chunkSize = 1500;
      chunkOverlap = 200;
    }
  }

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    lengthFunction: countWords,
  });

  const chunks = await textSplitter.splitDocuments([doc]);
  const fileId = doc.metadata.source.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "_");

  const finalChunks: Document[] = chunks.map((chunk, i) => ({
    ...chunk,
    metadata: {
      chunkId: `${fileId}_chunk_${i}`,
      prevChunkId: i > 0 ? `${fileId}_chunk_${i - 1}` : "",
      nextChunkId: i < chunks.length - 1 ? `${fileId}_chunk_${i + 1}` : "",
      source: doc.metadata.source,
      content: chunk.pageContent,
    },
    pageContent: chunk.pageContent,
  }));

  return finalChunks;
};
