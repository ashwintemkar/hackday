import { Document } from "@langchain/core/documents";
import { getPool } from "@/lib/db";
import { CHUNKS_TABLE, cleanMetadata, sanitizeChunkId, type ChunkMetadata } from "./index";
import { embedText } from "./embeddings";

export type ChunkRow = ChunkMetadata & {
  id: string;
  namespace: string;
  score: number;
};

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** Namespace replaces Pinecone's namespace-partitioned index entirely - it's just a column with
 * a WHERE filter here, so "todo"/"done"/"duplicate"/"attachment" namespaces per project (see
 * ticket-resolution-service.ts) need no separate provisioning the way a Pinecone namespace did. */
export async function upsertChunks(namespace: string, docs: Document[]): Promise<void> {
  if (docs.length === 0) return;
  const pool = getPool();

  const batchSize = 50;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const texts = batch.map((doc) => doc.pageContent.trim());
    const embeddings = await embedText(texts);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let j = 0; j < batch.length; j++) {
        const doc = batch[j];
        const metadata = cleanMetadata({ ...doc.metadata, content: doc.pageContent });
        const chunkId = sanitizeChunkId(String(metadata.chunkId || `${namespace}_${Date.now()}_${j}`));

        await client.query(
          `INSERT INTO ${CHUNKS_TABLE}
             (chunk_id, namespace, content, source, prev_chunk_id, next_chunk_id,
              project_key, ticket_key, ticket_status, metadata, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector)
           ON CONFLICT (chunk_id) DO UPDATE SET
             namespace = EXCLUDED.namespace,
             content = EXCLUDED.content,
             source = EXCLUDED.source,
             prev_chunk_id = EXCLUDED.prev_chunk_id,
             next_chunk_id = EXCLUDED.next_chunk_id,
             project_key = EXCLUDED.project_key,
             ticket_key = EXCLUDED.ticket_key,
             ticket_status = EXCLUDED.ticket_status,
             metadata = EXCLUDED.metadata,
             embedding = EXCLUDED.embedding,
             updated_at = now()`,
          [
            chunkId,
            namespace,
            metadata.content,
            metadata.source,
            metadata.prevChunkId || null,
            metadata.nextChunkId || null,
            metadata.projectKey || null,
            metadata.ticketKey || null,
            metadata.ticketStatus || null,
            JSON.stringify(metadata),
            toVectorLiteral(embeddings[j]),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function deleteTicketFromNamespace(namespace: string, ticketKey: string): Promise<void> {
  await getPool().query(
    `DELETE FROM ${CHUNKS_TABLE} WHERE namespace = $1 AND ticket_key = $2`,
    [namespace, ticketKey],
  );
}

export async function checkTicketExistsInNamespace(
  namespace: string,
  ticketKey: string,
): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM ${CHUNKS_TABLE} WHERE namespace = $1 AND ticket_key = $2 LIMIT 1`,
    [namespace, ticketKey],
  );
  return rows.length > 0;
}

export async function moveTicketBetweenNamespaces(
  fromNamespace: string,
  toNamespace: string,
  ticketKey: string,
  updatedDoc: Document,
): Promise<void> {
  await deleteTicketFromNamespace(fromNamespace, ticketKey);
  await upsertChunks(toNamespace, [updatedDoc]);
}

/** Direct lookup by chunk_id - replaces Pinecone's "query with a zero vector + metadata filter"
 * trick for fetching a specific chunk by id, which only existed because Pinecone has no
 * get-by-id-without-a-vector operation. Plain SQL doesn't need the trick. */
export async function getChunkById(chunkId: string): Promise<ChunkRow | null> {
  const { rows } = await getPool().query(
    `SELECT chunk_id, namespace, metadata FROM ${CHUNKS_TABLE} WHERE chunk_id = $1`,
    [chunkId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return { id: row.chunk_id, namespace: row.namespace, score: 1, ...row.metadata };
}

export async function querySimilar(
  namespace: string,
  queryEmbedding: number[],
  topK: number,
  ticketKey?: string,
): Promise<ChunkRow[]> {
  const ticketFilter = ticketKey ? "AND ticket_key = $4" : "";
  const params: unknown[] = [namespace, toVectorLiteral(queryEmbedding), topK];
  if (ticketKey) params.push(ticketKey);

  const { rows } = await getPool().query(
    `SELECT chunk_id, namespace, metadata, 1 - (embedding <=> $2::vector) AS score
     FROM ${CHUNKS_TABLE}
     WHERE namespace = $1 ${ticketFilter}
     ORDER BY embedding <=> $2::vector ASC
     LIMIT $3`,
    params,
  );
  return rows.map((row) => ({ id: row.chunk_id, namespace: row.namespace, score: row.score, ...row.metadata }));
}

/** Namespaces matching a project prefix (e.g. `${projectKey}_todo` / `_done` / `_duplicate`) -
 * replaces Pinecone's describeIndexStats()-based namespace discovery, which only existed to
 * work around Pinecone having no "list distinct namespaces" query. */
export async function listNamespaces(prefix?: string): Promise<string[]> {
  const { rows } = await getPool().query<{ namespace: string }>(
    prefix
      ? `SELECT DISTINCT namespace FROM ${CHUNKS_TABLE} WHERE namespace LIKE $1`
      : `SELECT DISTINCT namespace FROM ${CHUNKS_TABLE}`,
    prefix ? [`${prefix}%`] : [],
  );
  return rows.map((r) => r.namespace);
}
