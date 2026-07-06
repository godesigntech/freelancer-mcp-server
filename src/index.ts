#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initApiClients } from "./services/api.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerBidTools } from "./tools/bids.js";
import { registerMilestoneTools } from "./tools/milestones.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerAccountTools } from "./tools/account.js";
import { registerMetaTools } from "./tools/meta.js";

/**
 * Accounts can be configured two ways (either or both):
 *  - FREELANCER_OAUTH_TOKEN: a single token, registered under the label "default"
 *  - FREELANCER_ACCOUNTS: JSON object of label -> token for multiple profiles,
 *    e.g. {"main":"tok_abc","client_acme":"tok_def"}
 * This lets one server instance serve several Freelancer accounts; every tool
 * takes an optional `account` argument to pick which one to act as.
 */
function loadAccounts(): Record<string, string> {
  const accounts: Record<string, string> = {};

  const single = process.env.FREELANCER_OAUTH_TOKEN;
  if (single) accounts.default = single;

  const multi = process.env.FREELANCER_ACCOUNTS;
  if (multi) {
    try {
      const parsed = JSON.parse(multi);
      if (parsed && typeof parsed === "object") {
        for (const [label, token] of Object.entries(parsed)) {
          if (typeof token === "string" && token.length > 0) {
            accounts[label] = token;
          }
        }
      }
    } catch {
      console.error(
        "Warning: FREELANCER_ACCOUNTS is not valid JSON. Expected format: " +
          '{"label1":"token1","label2":"token2"}'
      );
    }
  }

  return accounts;
}

const accounts = loadAccounts();

if (Object.keys(accounts).length === 0) {
  console.error(
    "Error: no Freelancer accounts configured.\n" +
      "Set FREELANCER_OAUTH_TOKEN for a single account, or FREELANCER_ACCOUNTS " +
      '(JSON, e.g. {"main":"token1","client2":"token2"}) for multiple.\n' +
      "Get a Personal Access Token from: https://accounts.freelancer.com/settings/develop"
  );
  process.exit(1);
}

initApiClients(accounts);

const server = new McpServer({
  name: "freelancer-mcp-server",
  version: "2.0.0",
});

// Register all tool domains
registerMetaTools(server);
registerProfileTools(server);
registerProjectTools(server);
registerBidTools(server);
registerMilestoneTools(server);
registerMessageTools(server);
registerAccountTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Freelancer MCP server running via stdio — ${Object.keys(accounts).length} account(s) configured: ${Object.keys(accounts).join(", ")}`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
