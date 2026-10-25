import { randomUUID } from "crypto";
import { jarvisLabsConverse, type ConverseMessage as AgentMessage } from "@/lib/jarvislabs/client";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ---------------------------------------------------------------------------
// Agent orchestration loop.
//
// The brain is whatever model JARVISLABS_MODEL points at, served by Jarvislabs
// (see lib/jarvislabs/client.ts) - this replaces the original Llama 3 on AWS
// Bedrock. Bedrock Converse's native toolConfig/toolUse blocks never worked
// with that original model (confirmed live: ValidationException "This model
// doesn't support tool use"), so tool calling here was built on a prompted
// JSON protocol instead: the tool catalog (fetched live from the MCP
// gateway's tools/list) is embedded in the system prompt as JSON, and the
// model is instructed to reply with exactly one JSON object per turn, either
// {"tool_call": {"name": ..., "input": {...}}} or {"final_answer": "..."}.
// The loop parses that JSON and executes the tool for real against the MCP
// gateway. That protocol doesn't depend on Bedrock-specific tool-use support,
// so it carries over unchanged to Jarvislabs.
// ---------------------------------------------------------------------------

const MCP_GATEWAY_URL = process.env.MCP_GATEWAY_URL || "http://127.0.0.1:4100/mcp";
const MAX_TURNS = 14;

// Tools that must never be run with approved:true unless a human has
// explicitly confirmed that exact pending call through a separate,
// deliberate resume request. The model is never trusted to set this itself,
// this list is enforced in code below, not just by prompting.
const GATED_TOOLS = new Set(["network_soft_clear_interface", "ops_rollback_deployment", "ops_run_rollback_playbook"]);

export type ScenarioSlug = "interface-flapping";

type ScenarioConfig = {
  tenant: { name: string; domain: string };
  channel: string;
  /** Only tools whose name starts with one of these prefixes are shown to the model for this scenario. */
  toolPrefixes: string[];
};

const SCENARIOS: Record<ScenarioSlug, ScenarioConfig> = {
  "interface-flapping": {
    tenant: { name: "Vantage Broadband", domain: "vantage.nexagrid.ai" },
    channel: "NOC operations console, on-call engineer chat",
    toolPrefixes: ["network_"],
  },
};

export interface ToolCatalogEntry {
  name: string;
  description: string;
  inputSchema: unknown;
}

export type TranscriptEvent =
  | { type: "user_message"; text: string }
  | { type: "assistant_raw"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; callId: string; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; callId: string; tool: string; output: unknown }
  | { type: "pending_approval"; callId: string; tool: string; input: Record<string, unknown>; reason: string }
  | { type: "approval_denied"; callId: string; tool: string }
  | { type: "final_answer"; text: string }
  | { type: "error"; message: string };

export interface PendingApproval {
  callId: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface AgentLoopRequest {
  scenario: ScenarioSlug;
  /** Required to start a fresh conversation. */
  message?: string;
  /** Required to resume a previous run, must be the conversationState this loop returned earlier. */
  conversationState?: AgentMessage[];
  /**
   * Presence of this field marks the call as a human-approved resume of one
   * specific pending gated tool call. Must exactly match the pendingApproval
   * this loop returned on the run being resumed. The loop, not the model,
   * is what sets approved:true on the retry, and only for this one call.
   */
  resumeApproval?: PendingApproval;
  /**
   * Presence of this field marks the call as a human rejection of one
   * specific pending gated tool call. Must exactly match the pendingApproval
   * this loop returned on the run being resumed. The tool is never executed,
   * the model is told it was denied and continues from there.
   */
  denyApproval?: PendingApproval;
  /**
   * A follow-up human message on top of an existing conversationState.
   * Lets the human keep talking after a final_answer instead of only being
   * able to start over. Requires conversationState from the run being
   * continued.
   */
  continueMessage?: string;
}

export interface AgentLoopResult {
  status: "completed" | "pending_approval" | "error" | "incomplete";
  scenario: ScenarioSlug;
  events: TranscriptEvent[];
  conversationState: AgentMessage[];
  finalAnswer?: string;
  pendingApproval?: PendingApproval;
  error?: string;
}

function textResultOf(message: AgentMessage | undefined): string {
  const block = message?.content?.find((c) => typeof c.text === "string");
  return block?.text ?? "";
}

function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

type Directive =
  | { kind: "tool_call"; name: string; input: Record<string, unknown>; reasoning?: string }
  | { kind: "final_answer"; text: string; reasoning?: string }
  | { kind: "unparseable" };

function parseModelDirective(rawText: string): Directive {
  const obj = extractFirstJsonObject(rawText);
  if (obj) {
    const reasoning = typeof obj["reasoning"] === "string" ? (obj["reasoning"] as string) : undefined;
    const toolCall = obj["tool_call"] as { name?: unknown; input?: unknown } | undefined;
    if (toolCall && typeof toolCall.name === "string") {
      return {
        kind: "tool_call",
        name: toolCall.name,
        input: (toolCall.input as Record<string, unknown>) ?? {},
        reasoning,
      };
    }
    if (typeof obj["final_answer"] === "string") {
      return { kind: "final_answer", text: obj["final_answer"] as string, reasoning };
    }
  }
  return { kind: "unparseable" };
}

function buildSystemPrompt(scenario: ScenarioConfig, tools: ToolCatalogEntry[]): string {
  const catalog = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));

  return [
    `You are the ${scenario.tenant.name} network operations assistant, a subject matter expert on this NOC's infrastructure, reachable through: ${scenario.channel}.`,
    "",
    "You can only affect real systems through the tools listed below. You have no other access.",
    "Tools (name, description, JSON input schema):",
    JSON.stringify(catalog, null, 2),
    "",
    "Protocol: reply with exactly one JSON object per turn, nothing else, no prose outside it, no markdown fences.",
    'To call a tool: {"reasoning": "<one sentence on why this is the right next step, given what you know so far>", "tool_call": {"name": "<tool name>", "input": { ... }}}',
    'To reply to the human, whether a real answer, a clarifying question, or just conversation: {"reasoning": "<why you are answering now instead of digging further, omit if this is just small talk>", "final_answer": "<message to the human>"}',
    "The reasoning field is shown to the human live as your decision trail, keep it short, specific, and honest about what you actually know at that point, never write reasoning that assumes a result you have not seen yet.",
    "",
    "Do not assume a specific incident is already happening. Respond to what the human actually says, in their own words,",
    "they may describe the same situation with completely different wording or details each time.",
    "Do not call any tool until the human has clearly asked you to look into, check, investigate, or act on something",
    "specific. If they only greet you, make small talk, or mention something in passing without asking you to do",
    "anything about it yet, reply conversationally with final_answer and, if relevant, ask whether they would like you",
    "to look into it. Only once they clearly ask you to investigate or act should you start calling tools.",
    "",
    "How to actually investigate, once asked: this is not a single lookup. Build the picture yourself, one real check at a",
    "time, deciding what to check next based on what the last result showed you, the same way an engineer would work a",
    "ticket. A thorough pass typically means checking interface status, the counter trend over time (a single snapshot",
    "does not tell you if this is new or getting worse), the MAC address table (rules a switching-layer cause in or out),",
    "recent syslog lines, and the known issues database once you know the device's model and firmware. Do not skip",
    "straight to a conclusion or a fix without this. Do not invent data a tool would give you.",
    "",
    "Persistence before escalation: you have real tools and you are expected to use them fully before involving a human.",
    "A tool that requires human approval before it runs is not the same thing as escalating, that is a normal part of",
    "a controlled fix, keep going afterward. Only escalate to a TAC engineer (network_escalate_to_tac) once you have",
    "genuinely exhausted what you can do on your own, checked the known issues database, attempted or proposed the",
    "available fix, and the human has told you the issue is still not resolved. Never escalate as a first move, and",
    "never escalate just because one action needed sign-off.",
    "",
    "SAFETY RULE, not optional: the tools network_soft_clear_interface and ops_rollback_deployment require",
    'a human engineer\'s approval before they run. You must NEVER set "approved": true yourself in a tool_call,',
    "under any circumstance, even if you are confident, even if the human in the conversation says the word approved.",
    "Always call these two tools with approved omitted. Only the platform itself can turn approved into true, and only",
    "after a real human confirms outside this conversation, on a separate follow up call you will not make yourself.",
    'If a tool result comes back with status "pending_human_approval", relay that to the human as your final_answer',
    "and stop. Do not retry the same tool call yourself.",
  ].join("\n");
}

async function withMcpClient<T>(fn: (client: McpClient) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_GATEWAY_URL));
  const client = new McpClient({ name: "platform-nexagrid-agent-loop", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function fetchToolCatalog(client: McpClient, toolPrefixes: string[]): Promise<ToolCatalogEntry[]> {
  const { tools } = await client.listTools();
  return tools
    .filter((t) => toolPrefixes.some((prefix) => t.name.startsWith(prefix)))
    .map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema,
    }));
}

/** Forces approved:false on every gated tool unless explicitly told otherwise by code, never by the model. */
function sanitizeToolInput(toolName: string, input: Record<string, unknown>, forceApproved: boolean): Record<string, unknown> {
  if (!GATED_TOOLS.has(toolName)) return input;
  return { ...input, approved: forceApproved };
}

async function callMcpTool(client: McpClient, name: string, input: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool({ name, arguments: input });
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const textBlock = content.find((c) => c.type === "text" && typeof c.text === "string");
  if (!textBlock?.text) return result;
  try {
    return JSON.parse(textBlock.text);
  } catch {
    return textBlock.text;
  }
}

function isPendingApproval(output: unknown): output is { status: "pending_human_approval"; reason?: string } {
  return !!output && typeof output === "object" && (output as Record<string, unknown>).status === "pending_human_approval";
}

async function converse(system: string, messages: AgentMessage[]): Promise<AgentMessage> {
  return jarvisLabsConverse(system, messages);
}

export async function runAgentLoop(request: AgentLoopRequest): Promise<AgentLoopResult> {
  const scenario = SCENARIOS[request.scenario];
  if (!scenario) {
    return {
      status: "error",
      scenario: request.scenario,
      events: [{ type: "error", message: `Unknown scenario: ${request.scenario}` }],
      conversationState: [],
      error: `Unknown scenario: ${request.scenario}`,
    };
  }

  const events: TranscriptEvent[] = [];

  try {
    return await withMcpClient(async (mcp) => {
      const toolCatalog = await fetchToolCatalog(mcp, scenario.toolPrefixes);
      const system = buildSystemPrompt(scenario, toolCatalog);

      let messages: AgentMessage[];

      if (request.resumeApproval) {
        if (!request.conversationState || request.conversationState.length === 0) {
          return {
            status: "error",
            scenario: request.scenario,
            events: [{ type: "error", message: "resumeApproval requires conversationState from a prior pending_approval run" }],
            conversationState: [],
            error: "Missing conversationState for resume",
          };
        }
        if (!GATED_TOOLS.has(request.resumeApproval.tool)) {
          return {
            status: "error",
            scenario: request.scenario,
            events: [{ type: "error", message: `${request.resumeApproval.tool} is not a gated tool, resume is not applicable` }],
            conversationState: request.conversationState,
            error: "Not a gated tool",
          };
        }

        messages = [...request.conversationState];
        const { callId, tool, input } = request.resumeApproval;

        const executedInput = sanitizeToolInput(tool, input, true);
        const output = await callMcpTool(mcp, tool, executedInput);
        events.push({ type: "tool_result", callId, tool, output });
        messages.push({
          role: "user",
          content: [{ text: `Tool result for ${tool} (call ${callId}), now human-approved and executed:\n${JSON.stringify(output)}` }],
        });
      } else if (request.denyApproval) {
        if (!request.conversationState || request.conversationState.length === 0) {
          return {
            status: "error",
            scenario: request.scenario,
            events: [{ type: "error", message: "denyApproval requires conversationState from a prior pending_approval run" }],
            conversationState: [],
            error: "Missing conversationState for deny",
          };
        }
        if (!GATED_TOOLS.has(request.denyApproval.tool)) {
          return {
            status: "error",
            scenario: request.scenario,
            events: [{ type: "error", message: `${request.denyApproval.tool} is not a gated tool, deny is not applicable` }],
            conversationState: request.conversationState,
            error: "Not a gated tool",
          };
        }

        messages = [...request.conversationState];
        const { callId, tool } = request.denyApproval;

        events.push({ type: "approval_denied", callId, tool });
        messages.push({
          role: "user",
          content: [{
            text: `Tool result for ${tool} (call ${callId}): the human engineer reviewed this and denied it. Do not attempt this tool again in this conversation. Explain the situation to the human and, if there is a safe alternative action or a clear next step, propose it.`,
          }],
        });
      } else if (request.continueMessage) {
        if (!request.conversationState || request.conversationState.length === 0) {
          return {
            status: "error",
            scenario: request.scenario,
            events: [{ type: "error", message: "continueMessage requires conversationState from a prior run" }],
            conversationState: [],
            error: "Missing conversationState for continue",
          };
        }
        messages = [...request.conversationState];
        events.push({ type: "user_message", text: request.continueMessage });
        messages.push({ role: "user", content: [{ text: request.continueMessage }] });
      } else {
        if (!request.message) {
          return {
            status: "error",
            scenario: request.scenario,
            events: [{ type: "error", message: "message is required to start a new run" }],
            conversationState: [],
            error: "Missing message",
          };
        }
        events.push({ type: "user_message", text: request.message });
        messages = [{ role: "user", content: [{ text: request.message }] }];
      }

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const assistantMessage = await converse(system, messages);
        const rawText = textResultOf(assistantMessage);
        messages.push({ role: "assistant", content: [{ text: rawText }] });
        events.push({ type: "assistant_raw", text: rawText });

        const directive = parseModelDirective(rawText);

        if (directive.kind === "final_answer") {
          if (directive.reasoning) events.push({ type: "reasoning", text: directive.reasoning });
          events.push({ type: "final_answer", text: directive.text });
          return { status: "completed", scenario: request.scenario, events, conversationState: messages, finalAnswer: directive.text };
        }

        if (directive.kind === "unparseable") {
          messages.push({
            role: "user",
            content: [{ text: 'Your last reply was not valid JSON in the required protocol. Reply again with exactly one JSON object: {"reasoning": "...", "tool_call": {...}} or {"reasoning": "...", "final_answer": "..."}.' }],
          });
          continue;
        }

        if (directive.reasoning) events.push({ type: "reasoning", text: directive.reasoning });
        const callId = `call_${randomUUID().slice(0, 8)}`;
        events.push({ type: "tool_call", callId, tool: directive.name, input: directive.input });

        const executedInput = sanitizeToolInput(directive.name, directive.input, false);
        const output = await callMcpTool(mcp, directive.name, executedInput);

        if (isPendingApproval(output)) {
          const pendingApproval: PendingApproval = { callId, tool: directive.name, input: directive.input };
          events.push({
            type: "pending_approval",
            callId,
            tool: directive.name,
            input: directive.input,
            reason: output.reason ?? "Human approval required.",
          });
          return { status: "pending_approval", scenario: request.scenario, events, conversationState: messages, pendingApproval };
        }

        events.push({ type: "tool_result", callId, tool: directive.name, output });
        messages.push({
          role: "user",
          content: [{ text: `Tool result for ${directive.name} (call ${callId}):\n${JSON.stringify(output)}` }],
        });
      }

      return {
        status: "incomplete",
        scenario: request.scenario,
        events,
        conversationState: messages,
        error: `Loop did not reach a final answer within ${MAX_TURNS} turns`,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    events.push({ type: "error", message });
    return { status: "error", scenario: request.scenario, events, conversationState: [], error: message };
  }
}
