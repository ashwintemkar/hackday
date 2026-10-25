export const indexName = "nexagrid";
export const timeout = 30000;

// multilingual-e5-large (1024-dim) was reached through Pinecone's hosted inference API.
// Pinecone is gone - embeddings now come from local Ollama's nomic-embed-text (768-dim), the
// same model/provider this repo's Ticketly skeleton already standardized on (docker-compose.yml's
// `ollama` service, docker/postgres/init.sql's VECTOR(768) columns). Keep this in sync with
// docker/postgres/pgvector-chunks.sql's embedding column if the model ever changes.
export const VECTOR_DIMENSIONS = 768;
export const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";

// Replaces BEDROCK_CONFIG - Jarvislabs serves Gemma for ticket judgement/resolution behind an
// OpenAI-compatible endpoint (see lib/jarvislabs/client.ts, which uses the `openai` SDK
// directly against this baseURL).
export const JARVISLABS_CONFIG = {
  endpoint: process.env.JARVISLABS_ENDPOINT || "https://models.jarvislabs.net/v1",
  apiKey: process.env.JARVISLABS_API_KEY || "",
  model: process.env.JARVISLABS_MODEL || "gemma-4-31b-it",
  maxTokens: 2048,
  temperature: 0.6,
  topP: 0.95,
  stopSequences: ["Human:", "Assistant:"],
};
