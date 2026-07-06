import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listAccounts } from "../services/api.js";

export function registerMetaTools(server: McpServer): void {
  server.registerTool(
    "freelancer_list_accounts",
    {
      title: "List Configured Accounts",
      description: `List the Freelancer.com account labels configured on this MCP server (never the tokens themselves).

Use this to discover which \`account\` value to pass to other tools when multiple Freelancer profiles are connected (e.g. your own account plus one or more clients' accounts).

Returns: account labels, and which one is the default (used when a tool call omits \`account\`).

Use when: "Which Freelancer accounts are connected?", "Switch to the client2 account", "List my connected profiles"`,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const accounts = listAccounts();
      if (!accounts.length) {
        return { content: [{ type: "text", text: "No accounts configured on this server." }] };
      }
      const lines = [
        `**Configured accounts** (${accounts.length}):`,
        "",
        ...accounts.map((a, i) => `${i + 1}. \`${a}\`${i === 0 ? " (default)" : ""}`),
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { accounts, default: accounts[0] ?? null },
      };
    }
  );
}
