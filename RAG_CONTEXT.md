# Context: RAG ingestion for Ticketly

Handoff note for whoever (human or agent) picks up the knowledge-base /
retrieval work next. Read [ARCHITECTURE.md](ARCHITECTURE.md) first — this
file only covers the RAG slice of it and where things stand right now.

## What this is

Ticketly resolves tickets by retrieving semantically relevant knowledge-base
chunks and past resolved tickets, then having Gemma reason over that context
(see ARCHITECTURE.md's "Activity: embed + retrieve context"). That retrieval
step — split documents into chunks, embed them, store in pgvector, and later
embed a query and retrieve nearest neighbors — is what "RAG ingestion" means
here.

## What already exists

- `docker-compose.yml` (repo root): full infra skeleton — `postgres`
  (pgvector/pgvector:pg16), `temporal` + `temporal-postgres` + `temporal-ui`,
  `ollama` (local Gemma + embedding inference for dev), `jenkins`, and the
  `app` service itself. Already wired with sane defaults — `docker compose up`
  should bring up everything needed.
- `docker/postgres/init.sql`: creates the `vector` extension and the tables —
  `tickets`, `ticket_audit_log`, `knowledge_base_chunks` (`embedding
  VECTOR(768)`), `resolved_tickets` (`embedding VECTOR(768)`) — with HNSW
  cosine indexes on both embedding columns. **768 dims was chosen for a
  local Ollama embedding model (e.g. `nomic-embed-text`) — if you pick a
  different embedding model, update the column dimension here to match.**
- `my-app/`: bare Next.js 16 app (App Router), otherwise unmodified from
  `create-next-app` — no ingestion/retrieval code written yet.
- `my-app/package.json` / `pnpm-lock.yaml`: just updated (this session) with
  the dependencies this work will need: `pg` (raw SQL against pgvector —
  there's no Prisma schema for these tables, same as how `pg_vector`
  columns are typically handled via raw SQL rather than an ORM), `dotenv`,
  `@langchain/core`, `@langchain/langgraph`, `@langchain/textsplitters`
  (`RecursiveCharacterTextSplitter`), `@langchain/community`,
  `@langchain/ollama` (local embeddings via the `ollama` container), and
  `pdf-parse`. No application code uses them yet — this was pushed first so
  `pnpm install` / `docker compose up` / the UI work aren't blocked waiting
  on the backend.

## What's NOT built yet

- The actual ingestion pipeline: split a document → embed chunks → store in
  `knowledge_base_chunks`.
- The actual query pipeline: embed a query → retrieve nearest neighbors from
  `knowledge_base_chunks` / `resolved_tickets`.
- Any LangGraph graph wiring those steps together (split → embed → store;
  query → embed → retrieve), to be called from Temporal's "embed + retrieve
  context" activity.
- The `TicketResolutionWorkflow` itself and its activities (embed+retrieve,
  ask Gemma, execute/auto-resolve, escalate to human) — no Temporal worker
  exists yet. `POST /api/tickets` (below) starts this workflow by name
  already, so it'll pick up and run as soon as a worker registers
  `TicketResolutionWorkflow` on the `ticket-resolution` task queue (see
  `lib/temporal/client.ts`); until then it just queues harmlessly.
- Ingesting resolved tickets into `resolved_tickets`, or documents into
  `knowledge_base_chunks` — i.e. anything that writes an *embedding*. Still
  open, see below.

## What's built

- **`POST /api/tickets`** (`app/api/tickets/route.ts`) — the ticket-intake
  endpoint from ARCHITECTURE.md's flow diagram. Validates
  `{ source: 'portal'|'jira'|'slack', title, description, externalRef? }`
  (`lib/tickets/schema.ts`), inserts into `tickets` + a first
  `ticket_audit_log` row atomically (`lib/tickets/repository.ts`), then
  best-effort starts `TicketResolutionWorkflow` on Temporal
  (`lib/temporal/client.ts`) — a Temporal outage logs an audit entry and
  leaves `workflow_id` null rather than failing the request, since the
  ticket is already durably stored by that point.
- **`GET /api/tickets`** — lists recent tickets (`?limit=`, default 50, max
  200).
- **`GET /api/tickets/[id]`** — one ticket plus its full audit trail.
- Verified end-to-end against a disposable `pgvector/pg16` container seeded
  with `docker/postgres/init.sql` (create/validate/list/detail, and the
  Temporal-unreachable degradation path).

## Reference implementation: platform-nexagrid

`C:\Users\ashwi\Documents\deleteme\platform-nexagrid` (package name
`ragimplementation`) is a **separate, already-built** RAG pipeline from the
same team, worth reading for patterns before writing this one from scratch —
`scripts/load-documents.ts` is its ingestion entry point. Differences to
adapt for, not copy verbatim:

- It embeds via AWS Bedrock (`@langchain/aws`) / OpenAI (`@langchain/openai`)
  and stores/searches via Pinecone (`@pinecone-database/pinecone`), not
  pgvector. Ticketly's stack is local Ollama embeddings → pgvector (see
  dimension note above) — same *shape* of pipeline, different provider at
  each step.
- It's a standalone script (`pnpm load-docs`), not graph-orchestrated.
  Ticketly's architecture calls for LangGraph nodes inside a Temporal
  activity, not a one-off script.

A second, more directly-applicable reference: `pms-nexagrid`
(`C:\Users\ashwi\Documents\haddows\pms-nexagrid`) has a mature, *local*
Ollama/HuggingFace-embeddings-to-pgvector pipeline for its QDMS module
(`lib/qdms/embeddings/embeddingService.ts`, `lib/qdms/documents/qdmsChunking.ts`,
`lib/qdms/repositories/qdmsSearchRepository.ts` — cosine distance via `<=>`,
HNSW index with ivfflat fallback). That project's embedding provider is HF's
`text-embeddings-inference` / Pinecone rather than Ollama, but the raw-SQL
pgvector query/index patterns transfer directly.

## Open question — resolve before building the ingestion logic

The brief for this work was "create a functionality wherein we should be
accepting the shipped functionality," which was never pinned down to one
of the following:

1. ~~**Ticket intake API**~~ — **resolved & built**: the user confirmed this
   was the `/api/tickets` endpoint from ARCHITECTURE.md's flow diagram
   (see "What's built" above).
2. **Ingest resolved ("shipped") tickets into the KB** — accept a ticket
   that's been closed/resolved and write its summary+resolution into
   `resolved_tickets` (embedded), so future retrieval can learn from it.
   Still open.
3. **Port platform-nexagrid's pipeline shape** — adapt its
   split → embed → store script into a LangGraph graph against
   `knowledge_base_chunks`, swapping Bedrock/Pinecone for Ollama/pgvector.
   Still open.

(2) and (3) are not mutually exclusive — (3) is the generic chunk-ingestion
graph; (2) is one concrete caller of it, for ticket resolutions specifically.
Neither is built yet; resolve which (or both, in which order) before
starting.

## Suggested next step

Once the above is resolved: build a LangGraph `StateGraph` with nodes
`split → embed → store` (ingestion) and `embedQuery → retrieve` (query),
using `@langchain/textsplitters`' `RecursiveCharacterTextSplitter`,
`@langchain/ollama`'s `OllamaEmbeddings` (768-dim, matching `init.sql`), and
raw `pg` queries against `knowledge_base_chunks` (cosine distance via `<=>`,
mirroring pms-nexagrid's `qdmsSearchRepository.searchSemantic`). Expose it
as a Temporal activity per ARCHITECTURE.md, not a REST endpoint called
directly by the UI.
