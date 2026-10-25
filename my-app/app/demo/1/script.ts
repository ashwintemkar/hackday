import { Network } from "lucide-react";
import type { DemoScript } from "@/components/demo/types";

export const script: DemoScript = {
  slug: "bgp-session-down",
  title: "BGP session down",
  subtitle: "An evidence led investigation into a chronic circuit flap, not a chatbot answering a question",
  icon: Network,
  tenant: { name: "Vantage Broadband", domain: "vantage.nexagrid.ai" },
  channel: "NOC operations console, on-call engineer chat",
  steps: [
    {
      id: "alert-fires",
      label: "Alert fires",
      screen: {
        label: "NOC alert queue",
        status: "error",
        heading: "BGP session down",
        body: "Automated monitoring fires an alert: BGP peering with an upstream provider has dropped.",
        fields: [
          { label: "Device", value: "edge-rtr-04" },
          { label: "Peer", value: "203.0.113.1, AS 64512" },
          { label: "Alert time", value: "14:02:10" },
        ],
      },
    },
    {
      id: "chat-opens",
      label: "Engineer opens the chat",
      screen: {
        label: "NOC alert queue",
        status: "error",
        heading: "Engineer opens the NOC assistant",
        body: "The queue shows the alert, but the agent doesn't speak first. An on-call engineer opens the chat after noticing it.",
      },
      chatAppend: [
        { from: "agent", text: "Hi, I'm the Vantage Broadband NOC assistant. What are you seeing?" },
      ],
    },
    {
      id: "engineer-explains",
      label: "Engineer reports the problem",
      screen: {
        label: "NOC alert queue",
        status: "error",
        heading: "Engineer opens the NOC assistant",
        body: "The queue shows the alert, but the agent doesn't speak first. An on-call engineer opens the chat after noticing it.",
      },
      chatAppend: [
        {
          from: "customer",
          text: "Hey, I'm seeing edge-rtr-04's BGP session bounce again today, this is the third time this morning. Can you take a look?",
        },
      ],
    },
    {
      id: "agent-opens",
      label: "Agent starts checking",
      screen: {
        label: "NOC alert queue",
        status: "pending",
        heading: "Agent starts the investigation",
        body: "Instead of taking the report at face value, the agent goes and pulls the current state itself.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "On it. Let me pull the current session state and recent history before I say anything for sure.",
        },
      ],
      logAppend: [
        { time: "14:02:12", text: "Tenant resolved: vantage.nexagrid.ai. Investigation started from engineer chat request.", tone: "info" },
      ],
    },
    {
      id: "enrich",
      label: "Reads live device state",
      screen: {
        label: "NOC alert queue",
        status: "pending",
        heading: "Reading live device state",
        body: "The agent queries the device through a governed, read only tool, not raw access an ordinary dashboard would give a customer.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Session shows Idle, last state was Established for 11 days. Interface Gi0/1 shows rising CRC errors over the last 20 minutes.",
        },
      ],
      logAppend: [
        { time: "14:02:14", text: "device.state: BGP session state, interface counters, and recent log lines retrieved for edge-rtr-04.", tone: "info" },
      ],
    },
    {
      id: "correlate",
      label: "Correlates topology and change history",
      screen: {
        label: "NOC alert queue",
        status: "pending",
        heading: "Correlating against topology and change history",
        body: "The agent checks whether this is isolated or part of something bigger.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Backup path through edge-rtr-07 is healthy, so customers aren't dropping traffic. No planned change on this circuit either.",
        },
      ],
      logAppend: [
        {
          time: "14:02:17",
          text: "forward.path: backup path healthy, no customer impact expected. servicenow.incident: no active change on this circuit.",
          tone: "info",
        },
      ],
    },
    {
      id: "history-check",
      label: "Checks circuit stability history",
      screen: {
        label: "NOC alert queue",
        status: "warning",
        heading: "Checking circuit stability history",
        body: "One flap could be noise. A pattern is not.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "This isn't the first time. Six flaps in nine days, all lining up with CRC error spikes on the same interface.",
        },
      ],
      logAppend: [
        { time: "14:02:19", text: "Circuit history: 6 flaps in the last 9 days, all correlating with rising CRC error bursts on Gi0/1.", tone: "warning" },
      ],
    },
    {
      id: "diagnose",
      label: "Root cause hypothesis formed",
      screen: {
        label: "NOC alert queue",
        status: "warning",
        heading: "Root cause hypothesis formed",
        body: "Enough evidence gathered to commit to a hypothesis with a confidence score, not a guess.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "82% confidence this is a failing optic or cable on Gi0/1, not a config or peer side issue. This matches a known pattern in the runbook, KB-1123.",
        },
      ],
      assessment: {
        hypothesis:
          "Failing optic or cable on Gi0/1 is causing rising CRC errors, which push keepalives to fail and drop the BGP session. Matches known error pattern KB-1123.",
        confidence: 82,
        tier: "amber",
        tierLabel: "Amber, controlled write",
        blastRadius: "No current customer impact, backup path is carrying traffic, but redundancy is degraded until fixed.",
      },
    },
    {
      id: "decide",
      label: "Recommends next action",
      screen: {
        label: "NOC alert queue",
        status: "warning",
        heading: "Recommending next action",
        body: "Replacing hardware is a physical action, the agent stops at recommending it.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Recommended action: dispatch a tech to inspect and reseat or replace the optic on Gi0/1, and open a vendor case in parallel in case it's a transceiver fault. This needs a person, I can't do it myself.",
        },
      ],
      logAppend: [
        { time: "14:02:22", text: "Risk tier amber, controlled write plus a physical dispatch, human approval required before proceeding.", tone: "warning" },
      ],
    },
    {
      id: "human-approval",
      label: "Engineer reviews and approves",
      screen: {
        label: "NOC alert queue",
        status: "pending",
        heading: "Engineer reviews and approves",
        body: "The on-call engineer sees the full evidence pack, not a blank incident, and approves in seconds.",
      },
      chatAppend: [
        { from: "customer", text: "Approved, go ahead and open the vendor case, I'll get a tech routed to the site." },
      ],
    },
    {
      id: "act",
      label: "Ticket and vendor case opened",
      screen: {
        label: "NOC alert queue",
        status: "warning",
        heading: "Ticket and vendor case opened",
        body: "The ticket carries the full evidence pack, hypothesis, and confidence score, not a one line description.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "On it. Opening the ticket and a vendor case now, both carry the evidence pack and the confidence score, no need to re-explain any of this to the tech.",
        },
        { from: "system", text: "Ticket INC0041002 created in ServiceNow. Vendor case VC-88213 opened." },
      ],
      ticket: {
        id: "INC0041002",
        priority: "High",
        summary: "edge-rtr-04, Gi0/1, chronic BGP flap from rising CRC errors, optic or cable suspected, backup path healthy.",
        status: "Open",
      },
    },
    {
      id: "verify",
      label: "Fix confirmed, monitoring",
      screen: {
        label: "NOC alert queue",
        status: "success",
        heading: "Fix confirmed, monitoring for stability",
        body: "The agent doesn't close the loop on a single good reading.",
      },
      chatAppend: [
        { from: "system", text: "Optic replaced on site." },
        {
          from: "agent",
          text: "Session is back to Established and CRC errors have gone flat. I'll keep monitoring for 4 hours before I mark this resolved and update the runbook with today's evidence.",
        },
      ],
      logAppend: [{ time: "16:40:00", text: "Optic replaced, BGP session re-established, 4 hour monitoring window opened.", tone: "success" }],
      assessment: {
        hypothesis: "Optic replaced by field tech, CRC errors cleared, BGP session re-established and stable.",
        confidence: 97,
        tier: "green",
        tierLabel: "Green, verified stable",
        verification: [
          "BGP session state confirms Established",
          "Interface CRC error counters flat for 30 minutes",
          "No further flaps in the monitoring window",
        ],
      },
    },
    {
      id: "learn",
      label: "Closed loop, knowledge base updated",
      screen: {
        label: "NOC alert queue",
        status: "success",
        heading: "Closed loop, knowledge base updated",
        body: "The outcome feeds back into the same runbook the agent used to recognize the pattern.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Four hours clean, no flaps. Closing the ticket and updating KB-1123 so the next agent that sees this pattern moves even faster.",
        },
      ],
      logAppend: [
        { time: "20:40:00", text: "4 hour monitoring window clean. Ticket closed, KB-1123 updated with this incident as a confirmed match.", tone: "success" },
      ],
    },
  ],
};
