export const CHUNKS_TABLE = "document_chunks";

export function sanitizeChunkId(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 128);
}

export type ChunkMetadata = {
  content: string;
  source: string;
  prevChunkId?: string | null;
  nextChunkId?: string | null;
  chunkId?: string;
  projectKey?: string;
  ticketKey?: string;
  ticketStatus?: string;
  fileName?: string;
  originalSource?: string;
  isAttachment?: boolean;
  [key: string]: unknown;
};

export const cleanMetadata = (metadata: Record<string, unknown>): ChunkMetadata => {
  const cleaned: ChunkMetadata = { content: "", source: "" };

  if (metadata.content) cleaned.content = String(metadata.content);
  else if (metadata.pageContent) cleaned.content = String(metadata.pageContent);

  if (metadata.source) cleaned.source = String(metadata.source);
  if (metadata.chunkId) cleaned.chunkId = String(metadata.chunkId);
  if (metadata.prevChunkId) cleaned.prevChunkId = String(metadata.prevChunkId);
  if (metadata.nextChunkId) cleaned.nextChunkId = String(metadata.nextChunkId);
  if (metadata.projectKey) cleaned.projectKey = String(metadata.projectKey);
  if (metadata.ticketKey) cleaned.ticketKey = String(metadata.ticketKey);
  if (metadata.ticketStatus) cleaned.ticketStatus = String(metadata.ticketStatus);
  if (metadata.fileName) cleaned.fileName = String(metadata.fileName);
  if (metadata.originalSource) cleaned.originalSource = String(metadata.originalSource);
  if (metadata.isAttachment) cleaned.isAttachment = true;

  return cleaned;
};
