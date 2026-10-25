-- Enables vector similarity search for RAG over the knowledge base and
-- past resolved tickets (chosen over a graph DB: the need is semantic
-- retrieval, not relationship traversal — see ARCHITECTURE.md).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL,              -- 'portal' | 'jira' | 'slack'
    external_ref TEXT,                 -- e.g. Jira issue key, if escalated
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', -- open|resolving|escalated|resolved
    workflow_id TEXT,                  -- Temporal workflow id
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_audit_log (
    id BIGSERIAL PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,               -- 'gemma' | 'human:<email>' | 'system'
    action TEXT NOT NULL,
    detail JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_base_chunks (
    id BIGSERIAL PRIMARY KEY,
    source_doc TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(768),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resolved_tickets (
    id BIGSERIAL PRIMARY KEY,
    ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,
    resolution TEXT NOT NULL,
    embedding VECTOR(768),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_base_chunks_embedding_idx
    ON knowledge_base_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS resolved_tickets_embedding_idx
    ON resolved_tickets USING hnsw (embedding vector_cosine_ops);
