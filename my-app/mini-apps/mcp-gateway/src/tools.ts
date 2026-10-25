import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "./config.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { signHs256Jwt } from "./jwt.js";

const execFileAsync = promisify(execFile);
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(MODULE_DIR, "..", "scripts");
const ANSIBLE_DIR = path.join(MODULE_DIR, "..", "ansible");

// Identifiers that get passed into a real subprocess argv. execFile never
// invokes a shell, so shell metacharacters in these are already inert, this
// is defense in depth plus it stops a value from being misread as a flag.
const SAFE_ID = /^[a-zA-Z0-9_.-]+$/;

async function runScript(command: string, args: string[], extraEnv?: Record<string, string>) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 20000,
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return { exitCode: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? String(err) };
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}

async function postJson(url: string, token: string, body?: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "x-actor": "mcp-gateway",
  };
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function pendingApproval(tool: string, reason: string) {
  return textResult({
    status: "pending_human_approval",
    tool,
    reason,
    note: "This tool did not run. It is amber or red tier and requires approved: true, set only after a human has signed off.",
  });
}

async function runNetworkScript(script: string, args: string[]) {
  return runScript("python3", [path.join(SCRIPTS_DIR, script), ...args]);
}

export function registerTools(server: McpServer) {
  // --- Network API: interface flapping, the flagship scenario ---

  server.registerTool(
    "network_list_devices",
    {
      title: "List network devices",
      description: "Lists every known network device with its model, firmware, status, and 24h CRC error count. Read only, always allowed.",
      inputSchema: {},
    },
    async () => textResult(await getJson(`${config.network.url}/api/devices`)),
  );

  server.registerTool(
    "network_show_interface_status",
    {
      title: "Show interface status",
      description:
        "Runs a real command against the device to show interface operational status, CRC errors, and resets. Read only, always allowed. Start here.",
      inputSchema: { device: z.string().describe("Device name, e.g. edge-rtr-04") },
    },
    async ({ device }) => {
      if (!SAFE_ID.test(device)) return textResult({ error: `Invalid device name: ${device}` });
      return textResult(
        await runNetworkScript("network_diagnostic.py", ["--device", device, "--check", "interface-status", "--base-url", config.network.url]),
      );
    },
  );

  server.registerTool(
    "network_show_counter_history",
    {
      title: "Show interface counter history",
      description:
        "Runs a real command to show the CRC error counter trend over time, tells a transient blip apart from a sustained, escalating problem. Read only, always allowed.",
      inputSchema: { device: z.string() },
    },
    async ({ device }) => {
      if (!SAFE_ID.test(device)) return textResult({ error: `Invalid device name: ${device}` });
      return textResult(
        await runNetworkScript("network_diagnostic.py", ["--device", device, "--check", "counter-history", "--base-url", config.network.url]),
      );
    },
  );

  server.registerTool(
    "network_show_mac_table",
    {
      title: "Show MAC address table",
      description:
        "Runs a real command to show MAC addresses learned on the device's interface, used to rule out a switching-layer cause, flooding or a loop, versus a physical link problem. Read only, always allowed.",
      inputSchema: { device: z.string() },
    },
    async ({ device }) => {
      if (!SAFE_ID.test(device)) return textResult({ error: `Invalid device name: ${device}` });
      return textResult(
        await runNetworkScript("network_diagnostic.py", ["--device", device, "--check", "mac-table", "--base-url", config.network.url]),
      );
    },
  );

  server.registerTool(
    "network_show_logs",
    {
      title: "Show device syslog",
      description:
        "Runs a real command to show recent syslog lines from the device, the actual link up and down events as the device itself reported them. Read only, always allowed.",
      inputSchema: { device: z.string() },
    },
    async ({ device }) => {
      if (!SAFE_ID.test(device)) return textResult({ error: `Invalid device name: ${device}` });
      return textResult(
        await runNetworkScript("network_diagnostic.py", ["--device", device, "--check", "logs", "--base-url", config.network.url]),
      );
    },
  );

  server.registerTool(
    "network_check_known_issues",
    {
      title: "Check known issues database",
      description:
        "Runs a real lookup against the internal known-issues knowledge base for this exact device model and firmware version, returning any documented matching defect, its root cause, and the fix. Read only, always allowed. Get the model and firmware from network_list_devices first if you don't already have them.",
      inputSchema: { model: z.string(), firmwareVersion: z.string() },
    },
    async ({ model, firmwareVersion }) =>
      textResult(
        await runScript("python3", [
          path.join(SCRIPTS_DIR, "known_issue_lookup.py"),
          "--model", model,
          "--firmware", firmwareVersion,
          "--base-url", config.network.url,
        ]),
      ),
  );

  server.registerTool(
    "network_soft_clear_interface",
    {
      title: "Soft-clear the interface",
      description:
        "Amber tier. Clears interface counters and re-negotiates the link, a real, reversible network action. Requires approved: true, set only after a human engineer has signed off.",
      inputSchema: {
        device: z.string(),
        approved: z.boolean().describe("Must be true, set only after human approval"),
      },
    },
    async ({ device, approved }) => {
      if (!approved) return pendingApproval("network_soft_clear_interface", "Engineer approval required before soft-clearing a live interface.");
      return textResult(
        await postJson(`${config.network.url}/devices/${device}/soft-clear-interface`, config.network.actionToken),
      );
    },
  );

  server.registerTool(
    "network_escalate_to_tac",
    {
      title: "Escalate to a TAC engineer",
      description:
        "Creates a real ServiceNow incident so a human TAC engineer can take over. This is the last resort, not the first move: only call this after genuinely investigating, interface status, counter trend, MAC table, logs, and the known issues database, and either attempting an available fix or determining none is safe without deeper access, and the customer has indicated the issue is still not resolved. Needing human approval for one action is not the same as needing to escalate, do not call this just because a fix required sign-off.",
      inputSchema: {
        shortDescription: z.string(),
        description: z.string().describe("Full investigation summary for the TAC engineer: what was checked, what was found, what known issue if any matched, what was tried"),
      },
    },
    async ({ shortDescription, description }) => {
      const token = signHs256Jwt(
        { org_id: "nexagrid-demo", org_name: "Nexagrid Demo", client_id: "mcp-gateway" },
        config.integrationHub.secret,
      );
      const res = await fetch(`${config.integrationHub.url}/api/servicenow/create-incident`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          short_description: shortDescription,
          description,
          category: "network",
          urgency: "2",
          impact: "2",
          correlation_id: `agent-escalation-${Date.now()}`,
        }),
      });
      return textResult(await res.json());
    },
  );

  // --- Card API: suspicious transaction investigation ---

  server.registerTool(
    "card_list_cards",
    {
      title: "List cards",
      description: "Lists every known card with its status and transaction count. Read only, always allowed.",
      inputSchema: {},
    },
    async () => textResult(await getJson(`${config.card.url}/api/cards`)),
  );

  server.registerTool(
    "card_get_transactions",
    {
      title: "Get recent card transactions",
      description: "Reads recent transactions for a card, including device fingerprint per transaction. Read only, always allowed.",
      inputSchema: { last4: z.string().describe("Last 4 digits of the card") },
    },
    async ({ last4 }) => textResult(await getJson(`${config.card.url}/cards/${last4}/transactions`)),
  );

  server.registerTool(
    "card_get_device_history",
    {
      title: "Get known device history for an account",
      description: "Reads the list of devices previously seen on this account. Read only, always allowed.",
      inputSchema: { last4: z.string() },
    },
    async ({ last4 }) => textResult(await getJson(`${config.card.url}/accounts/${last4}/device-history`)),
  );

  server.registerTool(
    "card_get_merchant_risk",
    {
      title: "Get merchant risk score",
      description: "Reads chargeback rate and risk level for a merchant. Read only, always allowed.",
      inputSchema: { merchantName: z.string() },
    },
    async ({ merchantName }) => textResult(await getJson(`${config.card.url}/merchants/${encodeURIComponent(merchantName)}/risk-score`)),
  );

  server.registerTool(
    "card_block_card",
    {
      title: "Block a card",
      description:
        "Blocking is a protective, reversible action, so it runs immediately at high fraud confidence without waiting for prior approval, matching the demo's own reasoning: the cost of blocking too eagerly is minor inconvenience, the cost of waiting is real loss.",
      inputSchema: { last4: z.string() },
    },
    async ({ last4 }) => textResult(await postJson(`${config.card.url}/cards/${last4}/block`, config.card.actionToken)),
  );

  server.registerTool(
    "card_unblock_card",
    {
      title: "Unblock a card",
      description: "Reverses a block, e.g. once fraud is ruled out. Runs immediately.",
      inputSchema: { last4: z.string() },
    },
    async ({ last4 }) => textResult(await postJson(`${config.card.url}/cards/${last4}/unblock`, config.card.actionToken)),
  );

  // --- Logistics API: supply chain delivery hold ---

  server.registerTool(
    "logistics_list_purchase_orders",
    {
      title: "List purchase orders",
      description: "Lists every known purchase order with its status and carrier status. Read only, always allowed.",
      inputSchema: {},
    },
    async () => textResult(await getJson(`${config.logistics.url}/api/purchase-orders`)),
  );

  server.registerTool(
    "logistics_get_purchase_order",
    {
      title: "Get purchase order",
      description: "Reads a purchase order's status and expected date. Read only, always allowed.",
      inputSchema: { poNumber: z.string() },
    },
    async ({ poNumber }) => textResult(await getJson(`${config.logistics.url}/purchase-orders/${poNumber}`)),
  );

  server.registerTool(
    "logistics_get_carrier_status",
    {
      title: "Get carrier status for a shipment",
      description: "Reads live carrier tracking status for the shipment behind a purchase order. Read only, always allowed.",
      inputSchema: { poNumber: z.string() },
    },
    async ({ poNumber }) => textResult(await getJson(`${config.logistics.url}/shipments/${poNumber}/carrier-status`)),
  );

  server.registerTool(
    "logistics_escalate_po",
    {
      title: "Escalate a purchase order to a human coordinator",
      description:
        "Notifies a named logistics coordinator instead of guessing an ETA that doesn't exist. Escalating is always safe to do immediately, it hands off rather than acting on incomplete information.",
      inputSchema: { poNumber: z.string() },
    },
    async ({ poNumber }) => textResult(await postJson(`${config.logistics.url}/purchase-orders/${poNumber}/escalate`, config.logistics.actionToken)),
  );

  // --- Ops API: server CPU and memory degradation ---

  server.registerTool(
    "ops_list_pods",
    {
      title: "List pods",
      description: "Lists every known pod with its service, memory percent, and status. Read only, always allowed.",
      inputSchema: {},
    },
    async () => textResult(await getJson(`${config.ops.url}/api/pods`)),
  );

  server.registerTool(
    "ops_get_pod_metrics",
    {
      title: "Get pod metrics",
      description: "Reads live CPU and memory for a pod. Read only, always allowed.",
      inputSchema: { pod: z.string() },
    },
    async ({ pod }) => textResult(await getJson(`${config.ops.url}/pods/${pod}/metrics`)),
  );

  server.registerTool(
    "ops_get_deployment_history",
    {
      title: "Get deployment history",
      description: "Reads recent deploy versions and timestamps for a service. Read only, always allowed.",
      inputSchema: { service: z.string() },
    },
    async ({ service }) => textResult(await getJson(`${config.ops.url}/deployments/${service}/history`)),
  );

  server.registerTool(
    "ops_restart_pod",
    {
      title: "Restart a pod",
      description:
        "Green tier. A pod restart is routine and reversible, Kubernetes just reschedules it, so this runs immediately using the agent's own standing authority. No human approval needed.",
      inputSchema: { pod: z.string() },
    },
    async ({ pod }) => textResult(await postJson(`${config.ops.url}/pods/${pod}/restart`, config.ops.agentToken)),
  );

  server.registerTool(
    "ops_rollback_deployment",
    {
      title: "Roll back a deployment",
      description:
        "Amber tier. A version change has broader consequences than a restart, so the agent's own token is not accepted here, this requires approved: true, set only after a human engineer has confirmed the rollback.",
      inputSchema: {
        service: z.string(),
        toVersion: z.string(),
        approved: z.boolean().describe("Must be true, set only after human approval"),
      },
    },
    async ({ service, toVersion, approved }) => {
      if (!approved) return pendingApproval("ops_rollback_deployment", "Engineer approval required before rolling back a deployed version.");
      return textResult(
        await postJson(`${config.ops.url}/deployments/${service}/rollback`, config.ops.approvalToken, { toVersion }),
      );
    },
  );

  server.registerTool(
    "ops_run_rollback_playbook",
    {
      title: "Run the rollback Ansible playbook",
      description:
        "Amber tier. Same effect as ops_rollback_deployment, a real deployed version change, but executed through a real Ansible playbook run with live playbook output instead of a direct call. Requires approved: true, set only after a human engineer has confirmed the rollback.",
      inputSchema: {
        service: z.string(),
        toVersion: z.string(),
        approved: z.boolean().describe("Must be true, set only after human approval"),
      },
    },
    async ({ service, toVersion, approved }) => {
      if (!approved) return pendingApproval("ops_run_rollback_playbook", "Engineer approval required before running the rollback playbook.");
      if (!SAFE_ID.test(service) || !SAFE_ID.test(toVersion)) {
        return textResult({ error: `Invalid service or version: ${service} ${toVersion}` });
      }
      return textResult(
        await runScript(
          "ansible-playbook",
          [
            path.join(ANSIBLE_DIR, "rollback_deployment.yml"),
            "-e", `ops_api_url=${config.ops.url}`,
            "-e", `service=${service}`,
            "-e", `to_version=${toVersion}`,
          ],
          { OPS_APPROVAL_TOKEN: config.ops.approvalToken },
        ),
      );
    },
  );
}
