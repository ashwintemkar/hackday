"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  User,
  Terminal,
  Lightbulb,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  Loader2,
  Send,
  RotateCcw,
} from "lucide-react";
import type { TranscriptEvent, PendingApproval, AgentLoopResult } from "@/lib/agent-loop";

const SCENARIO = {
  slug: "interface-flapping" as const,
  tenant: "vantage.nexagrid.ai",
  title: "Vantage Broadband, NOC operations",
};

type RunStatus = "idle" | "loading" | "pending_approval" | "completed" | "error" | "incomplete";

function isScriptResult(value: unknown): value is { stdout: string; stderr?: string; exitCode?: number } {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).stdout === "string";
}

function PrettyJson({ value }: { value: unknown }) {
  return (
    <pre className="mt-1.5 text-xs font-mono bg-background border border-border rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-words">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function TerminalBlock({ text }: { text: string }) {
  return (
    <pre className="mt-1.5 text-[12px] font-mono bg-[#0b0b0b] text-[#d8d8d8] border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
      {text}
    </pre>
  );
}

function RawModelOutput({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
        View source, raw model output
      </button>
      {open && (
        <pre className="mt-1.5 text-xs font-mono bg-background border border-border rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-words">
          {text}
        </pre>
      )}
    </div>
  );
}

function ActivityEntry({
  event,
  isLivePending,
  onApprove,
  onDeny,
  busy,
}: {
  event: TranscriptEvent;
  isLivePending: boolean;
  onApprove: () => void;
  onDeny: () => void;
  busy: boolean;
}) {
  if (event.type === "assistant_raw") {
    return (
      <div className="relative text-sm">
        <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-muted-foreground/30" />
        <RawModelOutput text={event.text} />
      </div>
    );
  }

  if (event.type === "reasoning") {
    return (
      <div className="relative text-sm">
        <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
        <div className="flex items-start gap-1.5 text-foreground/90 italic">
          <Lightbulb className="w-3.5 h-3.5 text-violet-500 flex-shrink-0 mt-0.5" />
          <span>{event.text}</span>
        </div>
      </div>
    );
  }

  if (event.type === "tool_call") {
    return (
      <div className="relative text-sm">
        <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500" />
        <div className="flex items-center gap-1.5 text-foreground">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          Running <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{event.tool}</span>
        </div>
        <PrettyJson value={event.input} />
      </div>
    );
  }

  if (event.type === "tool_result") {
    return (
      <div className="relative text-sm">
        <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-green-500" />
        <div className="flex items-center gap-1.5 text-foreground">
          <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
          Output from <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{event.tool}</span>
        </div>
        {isScriptResult(event.output) ? (
          <TerminalBlock text={event.output.stdout || event.output.stderr || "(no output)"} />
        ) : (
          <PrettyJson value={event.output} />
        )}
      </div>
    );
  }

  if (event.type === "pending_approval") {
    return (
      <div className="relative text-sm">
        <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-amber-500" />
        <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-amber-900 dark:text-amber-300 font-medium">
            <AlertTriangle className="w-3.5 h-3.5" />
            Approval required before <span className="font-mono text-xs bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 rounded">{event.tool}</span> runs
          </div>
          <p className="text-xs text-amber-900/80 dark:text-amber-300/80 mt-1">{event.reason}</p>
          <PrettyJson value={event.input} />
          {isLivePending && (
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={onApprove}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-xs font-medium bg-green-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-50 hover:opacity-90"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Approve and run
              </button>
              <button
                onClick={onDeny}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg px-3 py-1.5 disabled:opacity-50 hover:bg-muted"
              >
                <XCircle className="w-3.5 h-3.5" />
                Deny
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (event.type === "approval_denied") {
    return (
      <div className="relative text-sm">
        <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-red-500" />
        <div className="flex items-center gap-1.5 text-foreground">
          <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
          Human denied <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{event.tool}</span>, it was never run
        </div>
      </div>
    );
  }

  if (event.type === "error") {
    return (
      <div className="relative text-sm">
        <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-red-500" />
        <div className="text-red-700 dark:text-red-400">{event.message}</div>
      </div>
    );
  }

  return null;
}

export function LiveAgentConsole() {
  const [message, setMessage] = useState("");
  const [events, setEvents] = useState<TranscriptEvent[]>([]);
  const [conversationState, setConversationState] = useState<unknown[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  function resetAll() {
    setMessage("");
    setEvents([]);
    setConversationState([]);
    setPendingApproval(null);
    setStatus("idle");
    setErrorMessage(null);
  }

  async function callAgent(body: Record<string, unknown>) {
    setBusy(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/agent/test-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: SCENARIO.slug, ...body }),
      });
      const result = (await res.json()) as AgentLoopResult & { error?: string };
      if (!res.ok) {
        setErrorMessage(result.error || "Request failed");
        setStatus("error");
        return;
      }
      setEvents((prev) => [...prev, ...result.events]);
      setConversationState(result.conversationState ?? []);
      setPendingApproval(result.pendingApproval ?? null);
      setStatus(result.status);
      if (result.status === "error") setErrorMessage(result.error ?? "Unknown error");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const text = message.trim();
    if (!text) return;
    setMessage("");
    setStatus("loading");
    if (conversationState.length === 0) {
      callAgent({ message: text });
    } else {
      callAgent({ conversationState, continueMessage: text });
    }
  }

  function approve() {
    if (!pendingApproval) return;
    setStatus("loading");
    callAgent({ conversationState, resumeApproval: pendingApproval });
  }

  function deny() {
    if (!pendingApproval) return;
    setStatus("loading");
    callAgent({ conversationState, denyApproval: pendingApproval });
  }

  const chatTurns = events.filter((e) => e.type === "user_message" || e.type === "final_answer");
  const canType = status !== "loading" && status !== "pending_approval";

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-medium text-foreground">{SCENARIO.title}</h1>
          <p className="text-xs text-muted-foreground font-mono">{SCENARIO.tenant}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5">
          <div className="border border-border rounded-xl bg-card h-full flex flex-col">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">Live chat</span>
            </div>
            <div className="p-4 flex flex-col gap-3 min-h-[200px]">
              {chatTurns.length === 0 && (
                <div className="text-sm text-muted-foreground italic">Say anything, in your own words.</div>
              )}
              {chatTurns.map((turn, i) =>
                turn.type === "user_message" ? (
                  <div key={i} className="flex gap-2 justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm bg-primary text-primary-foreground">
                      {turn.text}
                    </div>
                    <div className="w-7 h-7 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center flex-shrink-0 mt-1">
                      <User className="w-4 h-4" />
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex gap-2 justify-start">
                    <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 mt-1">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm bg-muted border border-border whitespace-pre-line">
                      {turn.text}
                    </div>
                  </div>
                ),
              )}
              {status === "loading" && (
                <div className="flex gap-2 justify-start items-center text-sm text-muted-foreground">
                  <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Working...
                </div>
              )}
              {errorMessage && (
                <div className="text-sm text-red-700 dark:text-red-400 border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 rounded-lg p-2.5">
                  {errorMessage}
                </div>
              )}
            </div>
            <div className="p-3 border-t border-border mt-auto flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && canType && send()}
                  disabled={!canType}
                  placeholder={
                    status === "pending_approval"
                      ? "Approve or deny the pending action to continue..."
                      : "Type anything, in your own words..."
                  }
                  className="flex-1 text-sm border border-border rounded-lg px-3 py-2 bg-background disabled:opacity-50"
                />
                <button
                  onClick={send}
                  disabled={!canType || !message.trim()}
                  className="inline-flex items-center gap-1.5 text-sm bg-primary text-primary-foreground rounded-lg px-3.5 py-2 disabled:opacity-50 hover:opacity-90"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              {chatTurns.length > 0 && (
                <button
                  onClick={resetAll}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground self-start"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Start a new run
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="border border-border rounded-xl bg-card p-4 h-full">
            <div className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground mb-3">
              Agent activity, live
            </div>
            {events.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">No activity yet.</div>
            ) : (
              <div className="border-l-2 border-border ml-1.5 pl-4 space-y-4 max-h-[640px] overflow-y-auto">
                {events
                  .filter((e) => e.type !== "user_message")
                  .map((event, i) => (
                    <ActivityEntry
                      key={i}
                      event={event}
                      isLivePending={
                        status === "pending_approval" &&
                        event.type === "pending_approval" &&
                        pendingApproval?.callId === event.callId
                      }
                      onApprove={approve}
                      onDeny={deny}
                      busy={busy}
                    />
                  ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
