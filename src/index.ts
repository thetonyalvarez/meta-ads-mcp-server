#!/usr/bin/env node
/**
 * Meta Ads MCP Server
 *
 * MCP server for the Meta (Facebook) Ads API. Provides 35 read tools to
 * manage and analyze ad accounts, campaigns, ad sets, ads, creatives, media
 * assets, insights, activity logs, targeting catalog (interests/behaviors/
 * geo/demographics + audience-size estimation), Facebook Pages, plus a pure
 * image-crops utility — via the Meta Graph API v22.0.
 *
 * Opt-in: setting META_ADS_ENABLE_WRITE_TOOLS=true also registers 19
 * write/lifecycle tools — create/update/delete/pause/resume at the
 * campaign/ad set/ad levels, create/update for ad creatives, image upload,
 * and campaign budget schedules. Off by default — these operations are
 * destructive or hard to reverse.
 *
 * Usage (stdio):
 *   node dist/index.js --access-token <YOUR_META_ACCESS_TOKEN>
 *   META_ADS_ACCESS_TOKEN=<token> node dist/index.js
 *
 * Usage (remote HTTP):
 *   TRANSPORT=http META_ADS_ACCESS_TOKEN=<token> node dist/index.js
 *   TRANSPORT=http META_ADS_ACCESS_TOKEN=<token> PORT=3000 node dist/index.js
 */

import { createRequire } from "module";
import { createHash, timingSafeEqual } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response, type NextFunction } from "express";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
import { registerAccountTools } from "./tools/accounts.js";
import { registerInsightsTools } from "./tools/insights.js";
import { registerCampaignTools } from "./tools/campaigns.js";
import { registerAdSetTools } from "./tools/adsets.js";
import { registerAdTools } from "./tools/ads.js";
import { registerCreativeTools } from "./tools/creatives.js";
import { registerMediaTools } from "./tools/media.js";
import { registerActivityTools } from "./tools/activities.js";
import { registerPaginationTools } from "./tools/pagination.js";
import { registerTargetingTools } from "./tools/targeting.js";
import { registerPageTools } from "./tools/pages.js";
import { registerBudgetScheduleTools } from "./tools/budget-schedules.js";
import { getAccessToken } from "./services/graph-api.js";
import { isWriteToolsEnabled } from "./constants.js";

const server = new McpServer({
  name: "meta-ads-mcp-server",
  version,
});

registerAccountTools(server);
registerInsightsTools(server);
registerCampaignTools(server);
registerAdSetTools(server);
registerAdTools(server);
registerCreativeTools(server);
registerMediaTools(server);
registerActivityTools(server);
registerPaginationTools(server);
registerTargetingTools(server);
registerPageTools(server);
registerBudgetScheduleTools(server);

if (isWriteToolsEnabled()) {
  console.error(
    "[meta-ads-mcp] WARNING: META_ADS_ENABLE_WRITE_TOOLS is on — " +
      "create/update/delete/pause/resume tools are EXPOSED. These can " +
      "permanently delete campaigns/ad sets/ads or change live delivery."
  );
}

async function runStdio(): Promise<void> {
  try {
    getAccessToken();
  } catch (err) {
    console.error((err as Error).message);
    console.error(
      "Usage: node dist/index.js --access-token <YOUR_META_ACCESS_TOKEN>"
    );
    console.error(
      "   or: META_ADS_ACCESS_TOKEN=<token> node dist/index.js"
    );
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Meta Ads MCP server running via stdio");
}

// --- Client auth (HTTP mode): single static bearer token --------------------
// In HTTP mode the server holds a Meta access token that can read live ad
// accounts, so the /mcp endpoint MUST NOT be public. We require a static bearer
// token (MCP_BEARER_TOKEN) on every /mcp request — same approach as the GA4
// connector. /health stays open for the platform healthcheck.
function tokenMatches(provided: string, expected: string): boolean {
  // Hash both to fixed-length digests so timingSafeEqual never throws on a
  // length mismatch and the comparison stays constant-time.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function requireBearer(expected: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const match = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
    if (!match || !tokenMatches(match[1], expected)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

async function runHTTP(): Promise<void> {
  try {
    getAccessToken();
  } catch (err) {
    console.error((err as Error).message);
    console.error(
      "Usage: TRANSPORT=http META_ADS_ACCESS_TOKEN=<token> node dist/index.js"
    );
    process.exit(1);
  }

  const bearer = process.env.MCP_BEARER_TOKEN;
  if (!bearer) {
    console.error(
      "MCP_BEARER_TOKEN is required in HTTP mode — refusing to expose the " +
        "Meta ad accounts on an unauthenticated endpoint. Set a long random " +
        "secret and pass it as Authorization: Bearer <token> from the client."
    );
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  app.post("/mcp", requireBearer(bearer), async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "meta-ads-mcp-server", version });
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    console.error(`Meta Ads MCP server running on http://localhost:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT ?? "stdio";
if (transport === "http") {
  runHTTP().catch((error: unknown) => {
    console.error("Server startup error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error: unknown) => {
    console.error("Server startup error:", error);
    process.exit(1);
  });
}
