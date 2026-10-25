# Ticketly — Architecture

## Why pgvector over a graph DB

The core job is: given a new ticket's free-text description, retrieve the most
*semantically relevant* knowledge-base articles and past resolved tickets, then
let Gemma reason over that context to answer questions or draft a resolution.
That's retrieval-augmented generation over unstructured text — a similarity
search problem, not a relationship-traversal problem. `pgvector` on the
Postgres we already need (for tickets/audit) gives us that with zero extra
infra. A graph DB (Neo4j) would only earn its place if we needed explicit
relationship queries (asset dependency chains, org charts) — out of scope for
now, so it's cut.

## Flow

```mermaid
flowchart TB
    subgraph Sources["Ticket sources"]
        Portal["Internal portal\n(OpenUI-rendered form)"]
        Jira["Jira webhook\n(existing company Jira)"]
        Slack["Slack / email\n(future)"]
    end

    subgraph App["Next.js app (API + UI)"]
        API["/api/tickets\nintake endpoint"]
        UI["OpenUI generative UI\nrenders ticket-specific view"]
    end

    subgraph Orchestration["Temporal"]
        WF["TicketResolutionWorkflow"]
        A1["Activity: embed + retrieve context"]
        A2["Activity: ask Gemma to decide"]
        A3["Activity: execute/auto-resolve"]
        A4["Activity: escalate to human"]
        Budget["Energy/cost budget guard\n(fed by Kepler)"]
    end

    subgraph Data["Postgres + pgvector"]
        KB["knowledge_base_chunks\n(embeddings)"]
        Past["resolved_tickets\n(embeddings)"]
        Tickets["tickets (state, audit log)"]
    end

    subgraph AI["Gemma inference"]
        Jarvis["Jarvislabs GPU endpoint\n(prod)"]
        Ollama["Local Ollama/Gemma\n(dev fallback)"]
    end

    subgraph CI["Jenkins"]
        Lint["lint + unit tests"]
        Scan["security scan"]
        Build["build & push images"]
    end

    subgraph Energy["Kepler"]
        KeplerExp["energy/cost estimate\nper workflow run"]
    end

    Portal --> API
    Jira --> API
    Slack --> API
    API --> WF
    WF --> A1
    A1 -->|similarity search| KB
    A1 -->|similarity search| Past
    A1 --> A2
    A2 -->|prompt + retrieved context| Jarvis
    A2 -.dev.-> Ollama
    A2 --> WF
    WF -->|confident| A3
    WF -->|low confidence / high risk| A4
    A4 -->|create issue| Jira
    A3 --> Tickets
    A4 --> Tickets
    WF --> UI
    UI --> Portal
    KeplerExp --> Budget
    Budget -->|over budget: force escalate| WF

    CI -.builds images for.-> App
    CI -.builds images for.-> Orchestration
```

## Component notes

- **Next.js (`my-app`)** — ticket intake API + OpenUI-rendered front end. One
  component library, Gemma's decision picks which components to render per
  ticket type (bounded output space, not free-form generated code).
- **Temporal** — durable workflow per ticket. Retries, timeouts, and a
  `HumanApprovalSignal` for anything destructive or low-confidence. Crash a
  worker mid-run, it resumes from the last completed activity.
- **Postgres + pgvector** — single source of truth: `tickets` (state + full
  audit trail), `knowledge_base_chunks` and `resolved_tickets` (both with
  `vector` columns for embedding similarity search).
- **Gemma** — self-hosted (Jarvislabs GPU in prod, local Ollama for dev/demo)
  so ticket content never leaves our infra. Used for: classification, RAG
  answer drafting, and picking the next workflow action / UI shape.
- **Jira integration** — not the primary queue; it's the escalation path.
  When Temporal's workflow decides a ticket is too complex/risky to
  auto-resolve, it files a Jira issue (via Jira REST API) for a human,
  with the retrieved context attached so the human isn't starting cold.
- **Jenkins** — CI gate: lint, unit tests, security scan, then build/push the
  app + worker images that Compose/K8s pulls.
- **Kepler** — energy/cost estimate per workflow run, enforced as a budget
  guard: a ticket whose Gemma re-planning loop blows past budget gets forced
  into human escalation instead of spinning silently.
