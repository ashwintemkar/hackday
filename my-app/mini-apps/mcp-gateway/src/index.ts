import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { registerTools } from "./tools.js";

const app = express();
app.use(express.json());

const transports: Record<string, StreamableHTTPServerTransport> = {};

function buildServer(): McpServer {
  const server = new McpServer({ name: "agentic-demo-gateway", version: "0.1.0" });
  registerTools(server);
  return server;
}

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports[sessionId] : undefined;

  if (!transport && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport as StreamableHTTPServerTransport;
      },
    });
    transport.onclose = () => {
      if (transport?.sessionId) delete transports[transport.sessionId];
    };
    const server = buildServer();
    await server.connect(transport);
  }

  if (!transport) {
    res.status(400).json({ error: "No active MCP session, and this request was not an initialize request." });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports[sessionId] : undefined;
  if (!transport) {
    res.status(400).json({ error: "Unknown or missing MCP session." });
    return;
  }
  await transport.handleRequest(req, res);
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    backends: {
      network: config.network.url,
      card: config.card.url,
      logistics: config.logistics.url,
      ops: config.ops.url,
    },
  });
});

app.listen(config.port, () => {
  console.log(`mcp-gateway listening on ${config.port}, MCP endpoint at /mcp`);
});
