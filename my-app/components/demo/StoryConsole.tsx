"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bot,
  User,
  Paperclip,
  Ticket as TicketIcon,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronLeft,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import type { DemoScript, ChatTurn, AgentLogEntry, TicketState, ScreenStatus, RiskTier } from "./types";

const TIER_STYLES: Record<RiskTier, { badge: string; bar: string }> = {
  green: { badge: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300", bar: "bg-green-500" },
  blue: { badge: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300", bar: "bg-blue-500" },
  amber: { badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", bar: "bg-amber-500" },
  red: { badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300", bar: "bg-red-500" },
};

const STATUS_STYLES: Record<ScreenStatus, { badge: string; dot: string }> = {
  neutral: { badge: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
  pending: { badge: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300", dot: "bg-blue-500" },
  warning: { badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", dot: "bg-amber-500" },
  error: { badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300", dot: "bg-red-500" },
  success: { badge: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300", dot: "bg-green-500" },
};

const LOG_TONE_STYLES: Record<AgentLogEntry["tone"], string> = {
  info: "bg-blue-500",
  success: "bg-green-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

const TICKET_PRIORITY_STYLES: Record<TicketState["priority"], string> = {
  Low: "bg-muted text-muted-foreground",
  Medium: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  High: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  Critical: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

function ChatBubble({ turn }: { turn: ChatTurn }) {
  if (turn.from === "system") {
    return (
      <div className="flex justify-center py-1">
        <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
          {turn.text}
        </span>
      </div>
    );
  }

  const isCustomer = turn.from === "customer";
  return (
    <div className={`flex gap-2 ${isCustomer ? "justify-end" : "justify-start"}`}>
      {!isCustomer && (
        <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 mt-1">
          <Bot className="w-4 h-4" />
        </div>
      )}
      <div className={`max-w-[80%] ${isCustomer ? "order-1" : ""}`}>
        {!isCustomer && (
          <div className="text-[10px] text-muted-foreground mb-1 ml-1">Nexagrid AI agent</div>
        )}
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
            isCustomer
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-muted text-foreground rounded-bl-sm border border-border"
          }`}
        >
          {turn.text}
        </div>
        {turn.attachmentLabel && (
          <div
            className={`mt-1 inline-flex items-center gap-1.5 text-xs rounded-lg border border-border px-2 py-1 ${
              isCustomer ? "bg-primary/10" : "bg-background"
            }`}
          >
            <Paperclip className="w-3 h-3" />
            {turn.attachmentLabel}
          </div>
        )}
        {turn.quickReplies && turn.quickReplies.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {turn.quickReplies.map((option, i) => (
              <span
                key={i}
                className="text-xs border border-border rounded-full px-3 py-1 text-muted-foreground bg-background"
              >
                {option}
              </span>
            ))}
          </div>
        )}
      </div>
      {isCustomer && (
        <div className="w-7 h-7 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center flex-shrink-0 mt-1">
          <User className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}

export function StoryConsole({ demo }: { demo: DemoScript }) {
  const [stepIndex, setStepIndex] = useState(0);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const Icon = demo.icon;

  const stepsSoFar = demo.steps.slice(0, stepIndex + 1);
  const current = demo.steps[stepIndex];

  const chatHistory = useMemo(
    () => stepsSoFar.flatMap((s) => s.chatAppend || []),
    [stepsSoFar]
  );
  const logHistory = useMemo(
    () => stepsSoFar.flatMap((s) => s.logAppend || []),
    [stepsSoFar]
  );
  const activeTicket = useMemo(() => {
    for (let i = stepsSoFar.length - 1; i >= 0; i--) {
      if (stepsSoFar[i].ticket) return stepsSoFar[i].ticket;
    }
    return undefined;
  }, [stepsSoFar]);
  const activeAssessment = useMemo(() => {
    for (let i = stepsSoFar.length - 1; i >= 0; i--) {
      if (stepsSoFar[i].assessment) return stepsSoFar[i].assessment;
    }
    return undefined;
  }, [stepsSoFar]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatHistory.length]);

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === demo.steps.length - 1;
  const progressPct = Math.round(((stepIndex + 1) / demo.steps.length) * 100);
  const statusStyle = STATUS_STYLES[current.screen.status];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <Link
        href="/demo"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        All demos
      </Link>

      <div className="flex items-start gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-medium text-foreground">{demo.title}</h1>
          <p className="text-sm text-muted-foreground">{demo.subtitle}</p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium bg-muted text-muted-foreground border border-border rounded-md px-2.5 py-1">
          {demo.tenant.domain}
        </span>
      </div>

      <div className="text-xs text-muted-foreground mb-6">Channel: {demo.channel}</div>

      <div className="mb-5">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
          <span>
            Step {stepIndex + 1} of {demo.steps.length}: {current.label}
          </span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {current.note && (
          <p className="text-xs text-muted-foreground mt-2 italic">{current.note}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-4">
        <div className="lg:col-span-5">
          <div className="border border-border rounded-xl bg-card h-full">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
                Customer sees
              </span>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-md px-2 py-0.5 ${statusStyle.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                {current.screen.label}
              </span>
            </div>
            <div className="p-4">
              <div className="text-sm font-medium text-foreground mb-1">{current.screen.heading}</div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">{current.screen.body}</p>
              {current.screen.fields && current.screen.fields.length > 0 && (
                <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {current.screen.fields.map((f, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 text-xs">
                      <span className="text-muted-foreground">{f.label}</span>
                      <span className="font-mono text-foreground">
                        {f.masked ? "*".repeat(Math.min(f.value.length, 10)) : f.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="border border-border rounded-xl bg-card h-full flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
                Live chat
              </span>
              <span className="text-xs text-muted-foreground">{demo.tenant.name}</span>
            </div>
            <div className="p-4 flex flex-col gap-3 min-h-[260px] max-h-[400px] overflow-y-auto">
              {chatHistory.length === 0 && (
                <div className="text-sm text-muted-foreground italic">
                  Chat has not started yet in this scenario.
                </div>
              )}
              {chatHistory.map((turn, i) => (
                <ChatBubble key={i} turn={turn} />
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-4">
        <div className="lg:col-span-7">
          <div className="border border-border rounded-xl bg-card p-4 h-full">
            <div className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground mb-3">
              Agent backend activity
            </div>
            {logHistory.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">No backend actions yet.</div>
            ) : (
              <div className="border-l-2 border-border ml-1.5 pl-4 space-y-3">
                {logHistory.map((entry, i) => (
                  <div key={i} className="relative text-sm">
                    <span
                      className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${LOG_TONE_STYLES[entry.tone]}`}
                    />
                    <div className="text-[11px] text-muted-foreground font-mono">{entry.time}</div>
                    <div className="text-foreground">{entry.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="border border-border rounded-xl bg-card p-4 h-full">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
                Evidence and risk assessment
              </span>
              <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            {activeAssessment ? (
              <div>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-md px-2 py-0.5 mb-2 ${TIER_STYLES[activeAssessment.tier].badge}`}
                >
                  {activeAssessment.tierLabel}
                </span>
                <p className="text-sm text-foreground leading-relaxed mb-2">{activeAssessment.hypothesis}</p>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-muted-foreground w-20 flex-shrink-0">Confidence</span>
                  <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${TIER_STYLES[activeAssessment.tier].bar}`}
                      style={{ width: `${activeAssessment.confidence}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-foreground w-9 text-right">
                    {activeAssessment.confidence}%
                  </span>
                </div>
                {activeAssessment.blastRadius && (
                  <div className="text-xs text-muted-foreground mt-2">
                    <span className="text-foreground">Blast radius: </span>
                    {activeAssessment.blastRadius}
                  </div>
                )}
                {activeAssessment.verification && activeAssessment.verification.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border">
                    <div className="text-xs text-muted-foreground mb-1">Verification plan</div>
                    <ul className="space-y-1">
                      {activeAssessment.verification.map((v, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                          <ShieldCheck className="w-3 h-3 mt-0.5 flex-shrink-0 text-muted-foreground" />
                          {v}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                No hypothesis formed yet, still gathering evidence.
              </div>
            )}
          </div>
        </div>
      </div>

      {activeTicket && (
        <div className="mb-6">
          <div className="border border-border rounded-xl bg-card p-4">
            <div className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground mb-3">
              ServiceNow ticket
            </div>
            <div className="flex items-center gap-2 mb-2">
              <TicketIcon className="w-4 h-4 text-muted-foreground" />
              <span className="font-mono text-sm text-foreground">{activeTicket.id}</span>
              <span
                className={`text-xs font-medium rounded-md px-2 py-0.5 ml-auto ${TICKET_PRIORITY_STYLES[activeTicket.priority]}`}
              >
                {activeTicket.priority}
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-2">{activeTicket.summary}</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              Status: {activeTicket.status}
            </div>
            <div className="mt-2 text-xs text-muted-foreground border-t border-border pt-2">
              Full transcript, evidence pack, and agent steps attached for the human agent.
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          onClick={() => setStepIndex(0)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Restart
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={isFirst}
            className="inline-flex items-center gap-1.5 text-sm border border-border rounded-lg px-3.5 py-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={() => setStepIndex((i) => Math.min(demo.steps.length - 1, i + 1))}
            disabled={isLast}
            className="inline-flex items-center gap-1.5 text-sm bg-primary text-primary-foreground rounded-lg px-3.5 py-2 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
          >
            {isLast ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Done
              </>
            ) : (
              <>
                Next
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {isLast && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg px-3.5 py-2.5">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          This is a scripted wireframe walkthrough for demo purposes. No real account, ticketing, or messaging systems are called.
        </div>
      )}
    </div>
  );
}
