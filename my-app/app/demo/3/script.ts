import { Fuel } from "lucide-react";
import type { DemoScript } from "@/components/demo/types";

export const script: DemoScript = {
  slug: "supply-chain-delivery-hold",
  title: "Supply chain delivery hold",
  subtitle: "An overdue barrel delivery the AI agent cannot resolve alone, escalated with full context",
  icon: Fuel,
  tenant: { name: "Continental Fuels Distribution", domain: "continentalfuels.nexagrid.ai" },
  channel: "Operations portal chat",
  steps: [
    {
      id: "checks-po",
      label: "Depot manager checks the PO",
      screen: {
        label: "Operations portal",
        status: "neutral",
        heading: "Purchase order PO-55210",
        body: "A depot manager checks the status of a scheduled crude barrel delivery, expected two days ago.",
        fields: [
          { label: "PO number", value: "PO-55210" },
          { label: "Quantity", value: "400 barrels" },
          { label: "Expected", value: "Sept 8" },
        ],
      },
    },
    {
      id: "overdue",
      label: "Delivery shows overdue",
      screen: {
        label: "Operations portal",
        status: "warning",
        heading: "Delivery overdue",
        body: "Status shows 'in transit' with no updated ETA. The depot manager opens the Nexagrid support chat.",
      },
    },
    {
      id: "chat-opens",
      label: "Agent opens the case",
      screen: {
        label: "Operations chat",
        status: "neutral",
        heading: "Live chat opened",
        body: "The Nexagrid operations assistant opens the conversation for this tenant.",
      },
      chatAppend: [
        { from: "agent", text: "Hi, I'm the Continental Fuels operations assistant. How can I help?" },
      ],
      logAppend: [
        {
          time: "02:15 PM",
          text: "Tenant resolved: continentalfuels.nexagrid.ai. Session started from the operations portal.",
          tone: "info",
        },
      ],
    },
    {
      id: "customer-explains",
      label: "Manager explains the impact",
      screen: {
        label: "Operations chat",
        status: "neutral",
        heading: "Live chat opened",
        body: "The Nexagrid operations assistant opens the conversation for this tenant.",
      },
      chatAppend: [
        {
          from: "customer",
          text: "PO-55210 was due for delivery two days ago, 400 barrels, and it's still showing in transit with no ETA. This is holding up our refinery schedule.",
        },
      ],
      logAppend: [
        {
          time: "02:15 PM",
          text: "Intent classified: delivery delay, high business impact, PO-55210.",
          tone: "info",
        },
      ],
    },
    {
      id: "agent-checks",
      label: "Agent checks logistics systems",
      screen: {
        label: "Operations chat",
        status: "pending",
        heading: "Checking logistics and carrier systems",
        body: "The agent queries the connected logistics platform for the shipment behind this PO.",
      },
      chatAppend: [{ from: "agent", text: "Let me check the logistics and carrier systems for this PO." }],
      logAppend: [
        {
          time: "02:16 PM",
          text: "Querying logistics platform and carrier tracking for PO-55210.",
          tone: "info",
        },
      ],
    },
    {
      id: "agent-hits-limit",
      label: "Agent reaches the limit of what it can resolve",
      screen: {
        label: "Operations chat",
        status: "warning",
        heading: "Held at customs, no confirmed ETA",
        body: "The carrier system shows the shipment held with no release time, the agent cannot manufacture an ETA that does not exist.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "I can see the shipment is held at a customs checkpoint since Sept 7. There is no confirmed release time in the carrier system, so I can't give you a reliable new ETA myself.",
        },
      ],
      logAppend: [
        {
          time: "02:16 PM",
          text: "Carrier system returned 'held, no release time', automatic resolution not possible.",
          tone: "warning",
        },
      ],
      assessment: {
        hypothesis:
          "Shipment is physically held at a customs checkpoint, not lost or misrouted. The carrier system exposes no automated release process for this hold type.",
        confidence: 88,
        tier: "red",
        tierLabel: "Red, requires a person to intervene with the carrier",
        blastRadius: "Refinery schedule for PO-55210, 400 barrels, no confirmed alternate supply lined up yet.",
      },
    },
    {
      id: "customer-pushes",
      label: "Manager pushes for action",
      screen: {
        label: "Operations chat",
        status: "warning",
        heading: "Held at customs, no confirmed ETA",
        body: "The carrier system shows the shipment held with no release time, the agent cannot manufacture an ETA that does not exist.",
      },
      chatAppend: [
        { from: "customer", text: "That's not good enough, we need someone to actually chase this today." },
      ],
    },
    {
      id: "escalates",
      label: "Agent escalates with full context",
      screen: {
        label: "Operations chat",
        status: "error",
        heading: "Escalating to the logistics coordinator",
        body: "The agent recognizes this needs a person to intervene with the carrier directly, and hands it off with everything it found.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Understood. I'm opening a high priority ticket and notifying the logistics coordinator directly, this needs a person to intervene with the carrier.",
        },
      ],
      logAppend: [
        {
          time: "02:17 PM",
          text: "Automatic resolution not possible, escalating with full context attached.",
          tone: "danger",
        },
      ],
    },
    {
      id: "human-notified",
      label: "Human coordinator notified",
      screen: {
        label: "Operations chat",
        status: "warning",
        heading: "Escalated to logistics coordinator",
        body: "A ticket is created in ServiceNow with the full chat history and the diagnostic steps the agent already ran, and a person is notified directly instead of waiting on a queue.",
      },
      chatAppend: [
        { from: "system", text: "Notification sent to Logistics Coordinator, Rajesh K, by call and message." },
        {
          from: "agent",
          text: "Ticket INC0031007 is open with everything I found attached. Rajesh will follow up with you directly and I'll keep this chat updated.",
        },
        { from: "system", text: "Ticket INC0031007 created in ServiceNow." },
      ],
      ticket: {
        id: "INC0031007",
        priority: "Critical",
        summary: "PO-55210, 400 barrel delivery held at customs, no ETA, refinery schedule impact.",
        status: "Open",
      },
      assessment: {
        hypothesis:
          "Shipment is physically held at a customs checkpoint, not lost or misrouted. The carrier system exposes no automated release process for this hold type.",
        confidence: 88,
        tier: "red",
        tierLabel: "Red, escalated, awaiting carrier intervention",
        blastRadius: "Refinery schedule for PO-55210, 400 barrels, no confirmed alternate supply lined up yet.",
        verification: [
          "Carrier confirms a release time",
          "Updated ETA logged against PO-55210",
          "Refinery scheduling team notified of the new ETA",
        ],
      },
    },
  ],
};
