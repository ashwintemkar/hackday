import OpenAI from "openai";
import { JARVISLABS_CONFIG } from "@/config";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

let cachedClient: OpenAI | null = null;

// Jarvislabs serves Gemma behind an OpenAI-compatible endpoint
// (https://models.jarvislabs.net/v1) - confirmed working request shape, so this goes through
// the `openai` SDK directly (already a dependency here) rather than a hand-rolled fetch client.
function getClient(): OpenAI {
  if (!JARVISLABS_CONFIG.apiKey) {
    throw new Error(
      "JARVISLABS_API_KEY must be set to ask Jarvislabs for ticket judgement/resolution.",
    );
  }
  if (!cachedClient) {
    cachedClient = new OpenAI({
      baseURL: JARVISLABS_CONFIG.endpoint,
      apiKey: JARVISLABS_CONFIG.apiKey,
    });
  }
  return cachedClient;
}

async function callJarvisLabsChatCompletion(
  messages: ChatMessage[],
  overrides: Partial<{ maxTokens: number; temperature: number; stopSequences: string[] }> = {},
): Promise<string> {
  const response = await getClient().chat.completions.create({
    model: JARVISLABS_CONFIG.model,
    messages,
    max_tokens: overrides.maxTokens ?? JARVISLABS_CONFIG.maxTokens,
    temperature: overrides.temperature ?? JARVISLABS_CONFIG.temperature,
    top_p: JARVISLABS_CONFIG.topP,
    stop: overrides.stopSequences ?? JARVISLABS_CONFIG.stopSequences,
  });

  const content = response.choices[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Jarvislabs returned no completion content");
  }
  return content;
}

/** Drop-in replacement for @langchain/community's `Bedrock` LLM wrapper - the ticket-resolution
 * / chat / summarizer call sites used `new Bedrock({...}).invoke(prompt)` (single prompt in,
 * string out); this matches that shape so only the import/constructor needed to change there,
 * not the surrounding logic. */
export class JarvisLabsLLM {
  private readonly maxTokens?: number;
  private readonly temperature?: number;
  private readonly stopSequences?: string[];

  constructor(options: { maxTokens?: number; temperature?: number; stopSequences?: string[] } = {}) {
    this.maxTokens = options.maxTokens;
    this.temperature = options.temperature;
    this.stopSequences = options.stopSequences;
  }

  async invoke(prompt: string): Promise<string> {
    return callJarvisLabsChatCompletion([{ role: "user", content: prompt }], {
      maxTokens: this.maxTokens,
      temperature: this.temperature,
      stopSequences: this.stopSequences,
    });
  }
}

export type ConverseMessage = { role: "user" | "assistant"; content: Array<{ text: string }> };

/** Multi-turn chat for the agent orchestration loop - replaces
 * `BedrockRuntimeClient.send(new ConverseCommand(...))`, returning the same
 * `{role, content: [{text}]}` message shape lib/agent-loop.ts already parses, so its JSON
 * tool-call protocol parsing doesn't need to change. */
export async function jarvisLabsConverse(
  system: string,
  messages: ConverseMessage[],
): Promise<{ role: "assistant"; content: Array<{ text: string }> }> {
  const flattened: ChatMessage[] = [
    { role: "system", content: system },
    ...messages.map((m) => ({ role: m.role, content: m.content.map((c) => c.text).join("\n") })),
  ];
  const text = await callJarvisLabsChatCompletion(flattened, { maxTokens: 1024, temperature: 0.2 });
  return { role: "assistant", content: [{ text }] };
}
