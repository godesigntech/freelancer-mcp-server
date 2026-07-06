import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, formatDate, mcpError, truncate, ACCOUNT_DESC } from "../services/api.js";
import { FreelancerMilestone } from "../types.js";
import { CHARACTER_LIMIT } from "../constants.js";

export function registerMilestoneTools(server: McpServer): void {
  server.registerTool(
    "freelancer_get_milestones",
    {
      title: "Get Project Milestones",
      description: `List milestones for a specific Freelancer.com project.

Args:
  - project_id (number): The project ID
  - account (string, optional): ${ACCOUNT_DESC}

Returns: list of milestones with amount, description, status and dates

Milestone statuses include: created, requested, pending, released, cancelled

Use when: "What are the milestones on project 12345?", "Has the milestone been released?", "Check payment status"`,
      inputSchema: z.object({
        project_id: z.number().int().positive().describe("Project ID to fetch milestones for"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ project_id, account }) => {
      try {
        const result = await apiGet<{ milestones: FreelancerMilestone[] }>(
          "/projects/0.1/milestones",
          { "project_ids[]": project_id },
          account
        );

        if (!result.milestones?.length) {
          return { content: [{ type: "text", text: `No milestones found for project ${project_id}.` }] };
        }

        const lines = [
          `**Milestones for project ${project_id}** (${result.milestones.length} total):`,
          "",
          ...result.milestones.map((m, i) => formatMilestone(m, i + 1)),
        ];

        return {
          content: [{ type: "text", text: truncate(lines.join("\n"), CHARACTER_LIMIT) }],
          structuredContent: { milestones: result.milestones },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );
}

function formatMilestone(m: FreelancerMilestone, index: number): string {
  return [
    `**${index}. Milestone #${m.id}** — $${m.amount} ${m.currency?.code ?? ""}`,
    `   Status: ${m.status}`,
    `   Description: ${m.description || "N/A"}`,
    `   Created: ${formatDate(m.time_created)} | Updated: ${formatDate(m.time_updated)}`,
    "",
  ].join("\n");
}
