import { Server } from "lucide-react";
import type { DemoScript } from "@/components/demo/types";

export const script: DemoScript = {
  slug: "server-memory-degradation",
  title: "Server CPU and memory degradation",
  subtitle: "Backend telemetry no customer dashboard exposes, a risk tiered decision on what to fix automatically",
  icon: Server,
  tenant: { name: "Bridgeport Retail", domain: "bridgeport.nexagrid.ai" },
  channel: "Ops monitoring, on-call SRE chat",
  steps: [
    {
      id: "alert-fires",
      label: "Alert fires",
      screen: {
        label: "Ops monitoring",
        status: "warning",
        heading: "Checkout service latency alert",
        body: "Automated monitoring flags rising latency on the checkout API, minutes before customers would notice.",
        fields: [
          { label: "Service", value: "checkout-api" },
          { label: "Pod", value: "checkout-api-7f9c-2" },
          { label: "Alert", value: "p95 latency above 800ms" },
        ],
      },
    },
    {
      id: "chat-opens",
      label: "Engineer opens the chat",
      screen: {
        label: "Ops monitoring",
        status: "warning",
        heading: "Engineer opens the ops assistant",
        body: "The dashboard shows the alert, but the agent doesn't speak first. An on-call engineer opens the chat after seeing it.",
      },
      chatAppend: [
        { from: "agent", text: "Hi, I'm the Bridgeport Retail ops assistant. What are you seeing?" },
      ],
    },
    {
      id: "engineer-explains",
      label: "Engineer reports the problem",
      screen: {
        label: "Ops monitoring",
        status: "warning",
        heading: "Engineer opens the ops assistant",
        body: "The dashboard shows the alert, but the agent doesn't speak first. An on-call engineer opens the chat after seeing it.",
      },
      chatAppend: [
        {
          from: "customer",
          text: "Hey, checkout's been feeling slow for the last hour and I'm seeing a latency alert on checkout-api. Can you check what's going on?",
        },
      ],
    },
    {
      id: "agent-picks-up",
      label: "Agent starts the investigation",
      screen: {
        label: "Ops monitoring",
        status: "pending",
        heading: "Agent starts the investigation",
        body: "Before reporting anything back, it checks whether this is a real degradation or noise.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Let me check. Pulling CPU, memory, and process health for checkout-api now.",
        },
      ],
      logAppend: [
        { time: "02:11:03", text: "Tenant resolved: bridgeport.nexagrid.ai. Investigation started from engineer chat request.", tone: "info" },
      ],
    },
    {
      id: "device-state",
      label: "Reads live pod telemetry",
      screen: {
        label: "Ops monitoring",
        status: "pending",
        heading: "Reading live pod telemetry",
        body: "This goes deeper than a status dashboard a support agent would normally have access to.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "One pod, checkout-api-7f9c-2, is sitting at 94 percent memory and climbing. CPU is normal, this looks like a memory issue, not a traffic spike.",
        },
      ],
      logAppend: [
        { time: "02:11:05", text: "device.state: checkout-api-7f9c-2 memory usage at 94 percent and climbing, CPU steady.", tone: "warning" },
      ],
    },
    {
      id: "trend",
      label: "Trend analysis",
      screen: {
        label: "Ops monitoring",
        status: "warning",
        heading: "Trend analysis",
        body: "A steady climb with no matching traffic increase usually means a leak, not load.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Memory's been climbing for six hours straight with no rise in traffic to explain it. That pattern points to a leak, not load.",
        },
      ],
      logAppend: [
        { time: "02:11:08", text: "Telemetry trend: memory climbing steadily for six hours, no corresponding increase in request volume.", tone: "warning" },
      ],
    },
    {
      id: "correlate-change",
      label: "Correlates recent changes",
      screen: {
        label: "Ops monitoring",
        status: "warning",
        heading: "Correlating against recent changes",
        body: "Did something ship that could explain this?",
      },
      chatAppend: [
        {
          from: "agent",
          text: "A deploy went out 7 hours ago, version 4.12.0, right before the climb started. That's the leading suspect.",
        },
      ],
      logAppend: [
        { time: "02:11:10", text: "servicenow.incident: a checkout-api deploy went out 7 hours ago, version 4.12.0.", tone: "warning" },
      ],
    },
    {
      id: "diagnose",
      label: "Root cause hypothesis formed",
      screen: {
        label: "Ops monitoring",
        status: "warning",
        heading: "Root cause hypothesis formed",
        body: "Enough evidence to commit to a confidence scored hypothesis.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "85% confidence this is a memory leak in version 4.12.0. At the current rate this pod hits its limit and crashes within the hour.",
        },
      ],
      assessment: {
        hypothesis:
          "Memory leak introduced in checkout-api version 4.12.0, deployed 7 hours ago. The affected pod will hit its memory limit and crash within the hour at the current rate.",
        confidence: 85,
        tier: "amber",
        tierLabel: "Amber, controlled write",
        blastRadius: "One of four checkout-api pods, remaining three healthy, but checkout degrades further if this one crashes under load.",
      },
    },
    {
      id: "decide",
      label: "Recommends next action",
      screen: {
        label: "Ops monitoring",
        status: "warning",
        heading: "Recommending next action",
        body: "Restarting a pod is routine, rolling back a version is not, only one of these happens automatically.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Recommended: restart the affected pod now to buy time, that's routine and pre approved. Rolling back version 4.12.0 needs a person to confirm, I won't do that on my own.",
        },
      ],
      logAppend: [
        { time: "02:11:13", text: "Pod restart is green tier, pre approved. Version rollback is amber tier, held for engineer approval.", tone: "info" },
      ],
    },
    {
      id: "auto-restart",
      label: "Low risk action taken automatically",
      screen: {
        label: "Ops monitoring",
        status: "pending",
        heading: "Low risk action taken automatically",
        body: "The agent doesn't wait on a human for the safe part.",
      },
      chatAppend: [
        { from: "system", text: "checkout-api-7f9c-2 restarted automatically, green tier action, no approval required." },
      ],
      logAppend: [
        { time: "02:11:14", text: "Pod restarted. Memory usage back to 12 percent. This buys time, it does not fix the leak.", tone: "success" },
      ],
    },
    {
      id: "engineer-approves",
      label: "Engineer approves the rollback",
      screen: {
        label: "Ops monitoring",
        status: "pending",
        heading: "Engineer approves the rollback",
        body: "The consequential fix still needs a person.",
      },
      chatAppend: [
        { from: "customer", text: "Confirmed, roll back to 4.11.0, I'll watch the deploy." },
      ],
    },
    {
      id: "act",
      label: "Rollback executed, ticket opened",
      screen: {
        label: "Ops monitoring",
        status: "warning",
        heading: "Rollback executed, ticket opened",
        body: "The ticket carries the evidence pack, not just an alert name.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Rolling back to 4.11.0 now and opening a ticket with the full evidence pack, deploy correlation included, so nobody has to re-derive this at 2 AM.",
        },
        { from: "system", text: "checkout-api rolled back to version 4.11.0. Ticket INC0062217 created in ServiceNow." },
      ],
      ticket: {
        id: "INC0062217",
        priority: "High",
        summary: "Memory leak in checkout-api 4.12.0, one pod restarted automatically, version rolled back to 4.11.0 pending confirmation.",
        status: "Open",
      },
    },
    {
      id: "verify",
      label: "Fix confirmed, monitoring",
      screen: {
        label: "Ops monitoring",
        status: "success",
        heading: "Fix confirmed, monitoring for stability",
        body: "One good reading isn't enough to call it done.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Memory's flat across all four pods and latency is back under 200ms. I'll keep watching for 45 minutes before I close this out.",
        },
      ],
      logAppend: [{ time: "02:58:00", text: "45 minute monitoring window clean. Closing ticket.", tone: "success" }],
      assessment: {
        hypothesis: "Rollback to 4.11.0 confirmed, memory usage flat across all pods for 45 minutes.",
        confidence: 96,
        tier: "green",
        tierLabel: "Green, verified stable",
        verification: [
          "Memory usage flat across all four pods",
          "p95 latency back under 200ms",
          "No further alerts in a 45 minute window",
        ],
      },
    },
    {
      id: "learn",
      label: "Closed loop, findings logged",
      screen: {
        label: "Ops monitoring",
        status: "success",
        heading: "Closed loop, findings logged",
        body: "The leak itself still needs a real fix in the code, this just contains it safely.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "This is contained, not fixed, version 4.12.0 still has the leak. I've filed a follow up ticket for the engineering team and tagged it against this incident so the root fix doesn't get lost.",
        },
      ],
      logAppend: [
        { time: "02:59:00", text: "Follow up ticket filed for engineering, linked to INC0062217. Runbook updated with this deploy correlation pattern.", tone: "success" },
      ],
    },
  ],
};
