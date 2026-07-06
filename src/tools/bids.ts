import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, formatDate, mcpError, truncate, ACCOUNT_DESC } from "../services/api.js";
import { FreelancerBid } from "../types.js";
import { CHARACTER_LIMIT, DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";

export function registerBidTools(server: McpServer): void {
  // Get bids on a project
  server.registerTool(
    "freelancer_get_project_bids",
    {
      title: "Get Project Bids",
      description: `List all bids on a specific Freelancer.com project.

Args:
  - project_id (number): The project ID to fetch bids for
  - limit (number, 1-50, default 10): Number of bids to return
  - offset (number, default 0): Pagination offset
  - account (string, optional): ${ACCOUNT_DESC}

Returns: list of bids with amount, period, bidder reputation and description

Use when: "Who has bid on project 12345?", "How much are people bidding?", "Show me the bids on my project"`,
      inputSchema: z.object({
        project_id: z.number().int().positive().describe("Numeric project ID"),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe("Number of bids"),
        offset: z.number().int().min(0).default(0).describe("Pagination offset"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ project_id, limit, offset, account }) => {
      try {
        const result = await apiGet<{ bids: FreelancerBid[]; total_count: number }>(
          "/projects/0.1/bids",
          {
            "project_ids[]": project_id,
            limit,
            offset,
            reputation_details: true,
            bidder_details: true,
          },
          account
        );

        if (!result.bids?.length) {
          return { content: [{ type: "text", text: `No bids found for project ${project_id}.` }] };
        }

        const lines = [
          `**Bids on project ${project_id}** — ${result.total_count} total (showing ${result.bids.length}):`,
          "",
          ...result.bids.map((b, i) => formatBid(b, i + 1)),
        ];

        return {
          content: [{ type: "text", text: truncate(lines.join("\n"), CHARACTER_LIMIT) }],
          structuredContent: { total: result.total_count, bids: result.bids },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // Get my bids
  server.registerTool(
    "freelancer_my_bids",
    {
      title: "List My Bids",
      description: `List bids you have placed on Freelancer.com projects.

Args:
  - status (string, optional): Filter by bid status — "active", "awarded", "revoked", "rejected"
  - limit (number, 1-50, default 10): Number of bids to return
  - offset (number, default 0): Pagination offset
  - account (string, optional): ${ACCOUNT_DESC}

Returns: your bids with project info, amounts and status. To analyze your winning strategy, call this twice — once with status "awarded" and once with status "rejected" — and compare amount, period and proposal style across the two sets yourself.

Use when: "Show my bids", "Which of my bids are active?", "Have any of my bids been awarded?", "What's my win rate?", "Analyze my winning bids vs rejected ones"`,
      inputSchema: z.object({
        status: z.enum(["active", "awarded", "revoked", "rejected"]).optional().describe("Filter by bid status"),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe("Number of results"),
        offset: z.number().int().min(0).default(0).describe("Pagination offset"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ status, limit, offset, account }) => {
      try {
        const selfResult = await apiGet<{ id: number }>("/users/0.1/self", undefined, account);
        const selfId = selfResult.id;

        const params: Record<string, unknown> = {
          "bidder_ids[]": selfId,
          limit,
          offset,
          project_details: true,
        };
        if (status) params["statuses[]"] = status;

        const result = await apiGet<{ bids: FreelancerBid[]; total_count: number }>(
          "/projects/0.1/bids",
          params,
          account
        );

        if (!result.bids?.length) {
          return { content: [{ type: "text", text: "No bids found." }] };
        }

        const lines = [
          `**Your bids** — ${result.total_count} total (showing ${result.bids.length}):`,
          "",
          ...result.bids.map((b, i) => formatBid(b, i + 1)),
        ];

        return {
          content: [{ type: "text", text: truncate(lines.join("\n"), CHARACTER_LIMIT) }],
          structuredContent: { total: result.total_count, bids: result.bids },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // Place a bid
  server.registerTool(
    "freelancer_place_bid",
    {
      title: "Place a Bid",
      description: `Submit a bid / proposal on a Freelancer.com project.

Args:
  - project_id (number): Project ID to bid on
  - amount (number): Your bid amount in the project's currency
  - period (number): Delivery time in days
  - description (string): Your proposal text (cover letter)
  - milestone_percentage (number, 0-100, default 100): Percentage to request as initial milestone
  - account (string, optional): ${ACCOUNT_DESC} This is the account the bid is placed FROM.

Returns: confirmation with bid ID and status

⚠️ This creates a real bid on your account. Review before confirming — including which account, when multiple are configured.

Use when: "Bid $150 on project 12345 with 7 days delivery", "Submit a proposal"`,
      inputSchema: z.object({
        project_id: z.number().int().positive().describe("Project ID to bid on"),
        amount: z.number().positive().describe("Bid amount in project currency"),
        period: z.number().int().positive().describe("Delivery time in days"),
        description: z.string().min(10).max(5000).describe("Proposal / cover letter text"),
        milestone_percentage: z.number().int().min(0).max(100).default(100).describe("Percentage to request as initial milestone (default 100)"),
        account: z.string().optional().describe(ACCOUNT_DESC + " This is the account the bid is placed FROM."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ project_id, amount, period, description, milestone_percentage, account }) => {
      try {
        const result = await apiPost<FreelancerBid>("/projects/0.1/bids", {
          project_id,
          amount,
          period,
          description,
          milestone_percentage,
        }, { account });

        return {
          content: [
            {
              type: "text",
              text: [
                `✅ **Bid placed successfully!**`,
                `Bid ID: ${result.id}`,
                `Project: ${project_id}`,
                `Amount: $${amount} | Delivery: ${period} days`,
                `Status: ${result.status}`,
                `Submitted: ${formatDate(result.time_submitted)}`,
              ].join("\n"),
            },
          ],
          structuredContent: result,
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );
}

function formatBid(b: FreelancerBid, index: number): string {
  const bidder = b.bidder;
  return [
    `**${index}. Bid #${b.id}** — $${b.amount} / ${b.period} days`,
    `   Status: ${b.status} | Submitted: ${formatDate(b.time_submitted)}`,
    bidder ? `   Bidder: @${bidder.username} (${bidder.display_name}) ⭐ ${b.reputation?.overall?.toFixed(2) ?? "N/A"}` : "",
    b.description ? `   Proposal: ${b.description.slice(0, 200)}${b.description.length > 200 ? "..." : ""}` : "",
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
