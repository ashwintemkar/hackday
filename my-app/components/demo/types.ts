import type { LucideIcon } from "lucide-react";

export type ChatSpeaker = "customer" | "agent" | "system";

export interface ChatTurn {
  from: ChatSpeaker;
  text: string;
  attachmentLabel?: string;
  quickReplies?: string[];
}

export type ScreenStatus = "neutral" | "warning" | "error" | "pending" | "success";

export interface ScreenField {
  label: string;
  value: string;
  masked?: boolean;
}

export interface ScreenState {
  label: string;
  status: ScreenStatus;
  heading: string;
  body: string;
  fields?: ScreenField[];
}

export type LogTone = "info" | "success" | "warning" | "danger";

export interface AgentLogEntry {
  time: string;
  text: string;
  tone: LogTone;
}

export type TicketPriority = "Low" | "Medium" | "High" | "Critical";
export type TicketStatus = "Open" | "In Progress" | "Resolved";

export interface TicketState {
  id: string;
  priority: TicketPriority;
  summary: string;
  status: TicketStatus;
}

export type RiskTier = "green" | "blue" | "amber" | "red";

export interface RiskAssessment {
  hypothesis: string;
  confidence: number;
  tier: RiskTier;
  tierLabel: string;
  blastRadius?: string;
  verification?: string[];
}

export interface DemoStep {
  id: string;
  label: string;
  note?: string;
  screen: ScreenState;
  chatAppend?: ChatTurn[];
  logAppend?: AgentLogEntry[];
  ticket?: TicketState;
  assessment?: RiskAssessment;
}

export interface DemoScript {
  slug: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  tenant: { name: string; domain: string };
  channel: string;
  steps: DemoStep[];
}
