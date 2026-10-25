-- Backs lib/pgvector/* (the ticket-resolution/knowledge-base RAG pipeline copied in from
-- platform-nexagrid, with Pinecone swapped for pgvector). `namespace` replaces what used to be
-- a Pinecone namespace (e.g. `${projectKey}_todo` / `_done` / `_duplicate`) - just a column with
-- a WHERE filter here, no separate index/namespace provisioning needed per project.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks (
    id BIGSERIAL PRIMARY KEY,
    chunk_id TEXT NOT NULL UNIQUE,
    namespace TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    prev_chunk_id TEXT,
    next_chunk_id TEXT,
    project_key TEXT,
    ticket_key TEXT,
    ticket_status TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 768 = Ollama's nomic-embed-text (see config.ts's VECTOR_DIMENSIONS). Update both together
    -- if the embedding model ever changes.
    embedding VECTOR(768),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_chunks_namespace_idx ON document_chunks (namespace);
CREATE INDEX IF NOT EXISTS document_chunks_ticket_idx ON document_chunks (namespace, ticket_key);
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
    ON document_chunks USING hnsw (embedding vector_cosine_ops);
