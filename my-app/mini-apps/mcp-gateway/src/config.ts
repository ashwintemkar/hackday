import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4100),
  network: {
    url: required("NETWORK_API_URL"),
    actionToken: required("NETWORK_API_ACTION_TOKEN"),
  },
  card: {
    url: required("CARD_API_URL"),
    actionToken: required("CARD_API_ACTION_TOKEN"),
  },
  logistics: {
    url: required("LOGISTICS_API_URL"),
    actionToken: required("LOGISTICS_API_ACTION_TOKEN"),
  },
  ops: {
    url: required("OPS_API_URL"),
    agentToken: required("OPS_API_AGENT_TOKEN"),
    approvalToken: required("OPS_API_APPROVAL_TOKEN"),
  },
  integrationHub: {
    url: required("INTEGRATION_HUB_URL"),
    secret: required("INTEGRATION_HUB_SECRET"),
  },
};
