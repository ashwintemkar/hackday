import { CreditCard } from "lucide-react";
import type { DemoScript } from "@/components/demo/types";

export const script: DemoScript = {
  slug: "suspicious-transaction-investigation",
  title: "Suspicious transaction investigation",
  subtitle: "Three signals a customer service rep never sees together, correlated into one confidence scored call",
  icon: CreditCard,
  tenant: { name: "Meridian Card Services", domain: "meridian.nexagrid.ai" },
  channel: "Fraud monitoring queue, automated event",
  steps: [
    {
      id: "transaction-fires",
      label: "Transaction flagged",
      screen: {
        label: "Fraud monitoring queue",
        status: "warning",
        heading: "Transaction flagged by risk engine",
        body: "A charge trips an automatic risk flag, and the cardholder gets a real time alert about it.",
        fields: [
          { label: "Amount", value: "$1,240.00" },
          { label: "Merchant", value: "TechZone Electronics, Singapore" },
          { label: "Cardholder", value: "D. Okafor, card ending 7734" },
        ],
      },
      chatAppend: [
        { from: "system", text: "Push notification sent to cardholder: unusual charge of $1,240.00 at TechZone Electronics." },
      ],
    },
    {
      id: "customer-reaches-out",
      label: "Cardholder reaches out",
      screen: {
        label: "Fraud monitoring queue",
        status: "warning",
        heading: "Transaction flagged by risk engine",
        body: "A charge trips an automatic risk flag, and the cardholder gets a real time alert about it.",
      },
      chatAppend: [
        {
          from: "customer",
          text: "Hey, I just got an alert about a $1,240 charge at some electronics store, I don't remember making that. Can you check?",
        },
      ],
    },
    {
      id: "agent-picks-up",
      label: "Agent opens the investigation",
      screen: {
        label: "Fraud monitoring queue",
        status: "pending",
        heading: "Agent opens the investigation",
        body: "Instead of taking the report at face value, the agent gathers independent evidence first.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Let me look into that for you. Pulling account and device signals now, one second.",
        },
      ],
      logAppend: [
        { time: "03:14:02", text: "Tenant resolved: meridian.nexagrid.ai. Investigation started from cardholder chat request.", tone: "info" },
      ],
    },
    {
      id: "device-signal",
      label: "Checks device fingerprint",
      screen: {
        label: "Fraud monitoring queue",
        status: "pending",
        heading: "Checking device fingerprint",
        body: "Was this made from a device the account has used before?",
      },
      chatAppend: [
        {
          from: "agent",
          text: "This device has never been used on this account before. On its own that isn't unusual, plenty of people use a new browser or phone.",
        },
      ],
      logAppend: [
        { time: "03:14:05", text: "device.fingerprint: transaction device not previously seen on this account.", tone: "warning" },
      ],
    },
    {
      id: "geo-velocity",
      label: "Checks geo velocity",
      screen: {
        label: "Fraud monitoring queue",
        status: "warning",
        heading: "Checking geo velocity",
        body: "Where was the last confirmed transaction, and could the cardholder physically be here now?",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Last confirmed charge was 40 minutes ago in Austin. This one is in Singapore. That's not a trip, that's physically impossible.",
        },
      ],
      logAppend: [
        { time: "03:14:07", text: "geo.velocity: last confirmed transaction 40 minutes ago in Austin, Texas, this one in Singapore.", tone: "danger" },
      ],
    },
    {
      id: "merchant-risk",
      label: "Checks merchant risk score",
      screen: {
        label: "Fraud monitoring queue",
        status: "warning",
        heading: "Checking merchant risk score",
        body: "Is this a merchant with a history of disputed charges?",
      },
      logAppend: [
        { time: "03:14:09", text: "merchant.risk: TechZone Electronics carries an elevated chargeback rate over the last 90 days.", tone: "warning" },
      ],
    },
    {
      id: "diagnose",
      label: "Fraud hypothesis formed",
      screen: {
        label: "Fraud monitoring queue",
        status: "error",
        heading: "Fraud hypothesis formed",
        body: "Three independent signals point the same direction.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "94% confidence this is fraud, not the cardholder. New device, impossible travel time, and a merchant with an elevated chargeback rate, all three agree.",
        },
      ],
      assessment: {
        hypothesis:
          "Card details were likely compromised and used from an unrecognized device in a location the cardholder cannot have reached in the time available. Merchant also carries elevated chargeback risk.",
        confidence: 94,
        tier: "red",
        tierLabel: "Red, mandatory human gate for account impact",
        blastRadius: "Single card affected, no other accounts linked to this device seen yet.",
      },
    },
    {
      id: "act",
      label: "Card blocked immediately",
      screen: {
        label: "Fraud monitoring queue",
        status: "error",
        heading: "Card blocked, cardholder notified",
        body: "High confidence plus real account impact means the agent acts immediately instead of waiting for a queue.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Blocking the card now and opening a fraud case. Sending the cardholder a text right away so they're not caught off guard at checkout somewhere legitimate.",
        },
        { from: "system", text: "Card ending 7734 blocked. SMS alert sent to cardholder." },
      ],
      logAppend: [
        { time: "03:14:12", text: "Card blocked, replacement requested, fraud case opened with full evidence pack attached.", tone: "danger" },
      ],
      ticket: {
        id: "INC0055310",
        priority: "Critical",
        summary: "Suspected fraud, $1,240 charge from unrecognized device, impossible travel time, elevated risk merchant, card blocked.",
        status: "Open",
      },
    },
    {
      id: "customer-confirms",
      label: "Cardholder responds",
      screen: {
        label: "Fraud monitoring queue",
        status: "warning",
        heading: "Cardholder responds",
        body: "The cardholder replies to the fraud alert text.",
      },
      chatAppend: [
        { from: "customer", text: "That wasn't me, I've been home all night. Thank you for catching it." },
      ],
    },
    {
      id: "verify",
      label: "Fraud confirmed, case closing",
      screen: {
        label: "Fraud monitoring queue",
        status: "success",
        heading: "Fraud confirmed, case closing",
        body: "Human confirmation matches the agent's hypothesis exactly.",
      },
      chatAppend: [
        {
          from: "agent",
          text: "Confirmed on your end too, so this is closed as fraud. Zero liability applies, a new card is already on its way.",
        },
      ],
      logAppend: [
        { time: "03:20:00", text: "Fraud confirmed by cardholder, case verified and matched the agent's hypothesis exactly.", tone: "success" },
      ],
      assessment: {
        hypothesis: "Fraud confirmed by cardholder. Replacement card issued, original card permanently closed.",
        confidence: 100,
        tier: "green",
        tierLabel: "Green, confirmed and resolved",
        verification: [
          "Cardholder confirmed the charge was not authorized",
          "Original card permanently closed",
          "Replacement card shipped, zero liability applied",
        ],
      },
    },
  ],
};
