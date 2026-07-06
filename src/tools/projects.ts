import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, formatDate, mcpError, truncate, ACCOUNT_DESC } from "../services/api.js";
import { FreelancerProject } from "../types.js";
import { CHARACTER_LIMIT, DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";

export function registerProjectTools(server: McpServer): void {
  // Search projects
  server.registerTool(
    "freelancer_search_projects",
    {
      title: "Search Projects",
      description: `Search for projects/jobs on Freelancer.com by keyword, budget or project type.

Args:
  - query (string, optional): Search keywords (e.g. "wordpress website", "n8n automation")
  - project_type (string, optional): "fixed" or "hourly"
  - min_budget (number, optional): Minimum budget in USD
  - max_budget (number, optional): Maximum budget in USD
  - limit (number, 1-50, default 10): Number of results
  - offset (number, default 0): Pagination offset
  - account (string, optional): ${ACCOUNT_DESC}

Returns: list of matching projects with title, budget, bid count, skills required. Results are ordered newest-first, so this also answers "what are the latest projects?".

Use when: "Find projects for Zoho CRM", "Show me hourly WordPress jobs", "Any SEO projects available?", "What are the latest projects posted?"`,
      inputSchema: z.object({
        query: z.string().optional().describe("Search keywords"),
        project_type: z.enum(["fixed", "hourly"]).optional().describe("Project type: fixed or hourly"),
        min_budget: z.number().optional().describe("Minimum budget in USD"),
        max_budget: z.number().optional().describe("Maximum budget in USD"),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe("Number of results (max 50)"),
        offset: z.number().int().min(0).default(0).describe("Pagination offset"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, project_type, min_budget, max_budget, limit, offset, account }) => {
      try {
        const params: Record<string, unknown> = {
          limit,
          offset,
          full_description: false,
          job_details: true,
          upgrade_details: true,
        };
        if (query) params["query"] = query;
        if (project_type) params["project_types[]"] = project_type;
        if (min_budget !== undefined) params["min_price"] = min_budget;
        if (max_budget !== undefined) params["max_price"] = max_budget;

        const result = await apiGet<{ projects: FreelancerProject[]; total_count: number }>(
          "/projects/0.1/projects/active",
          params,
          account
        );

        if (!result.projects?.length) {
          return { content: [{ type: "text", text: "No projects found matching your criteria." }] };
        }

        const lines = [
          `**Found ${result.total_count} projects** (showing ${result.projects.length}):`,
          "",
          ...result.projects.map((p, i) => formatProjectSummary(p, i + 1)),
        ];

        return {
          content: [{ type: "text", text: truncate(lines.join("\n"), CHARACTER_LIMIT) }],
          structuredContent: { total: result.total_count, projects: result.projects },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // Get single project
  server.registerTool(
    "freelancer_get_project",
    {
      title: "Get Project Details",
      description: `Get full details of a specific Freelancer.com project by ID.

Args:
  - project_id (number): The numeric project ID
  - account (string, optional): ${ACCOUNT_DESC}

Returns: full description, budget, status, skills, bid stats, timeline

Use when: "Tell me more about project 12345678", "Get the details for this project"`,
      inputSchema: z.object({
        project_id: z.number().int().positive().describe("Numeric Freelancer project ID"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ project_id, account }) => {
      try {
        const result = await apiGet<{ projects: Record<string, FreelancerProject> }>(
          "/projects/0.1/projects",
          {
            "ids[]": project_id,
            full_description: true,
            job_details: true,
            upgrade_details: true,
          },
          account
        );

        const project = Object.values(result.projects)[0];
        if (!project) return mcpError(`Project ${project_id} not found.`);

        const text = formatProjectFull(project);
        return {
          content: [{ type: "text", text: truncate(text, CHARACTER_LIMIT) }],
          structuredContent: project,
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // Get my active projects
  server.registerTool(
    "freelancer_my_projects",
    {
      title: "List My Projects",
      description: `List projects you own or are working on as a freelancer.

Args:
  - role (string): "owner" (projects you posted) or "freelancer" (projects you're hired on)
  - status (string, optional): "active", "complete", "closed"
  - limit (number, 1-50, default 10): Number of results
  - offset (number, default 0): Pagination offset
  - account (string, optional): ${ACCOUNT_DESC}

Returns: list of your projects with status, budget and progress. To analyze past performance ("what are my winning strategies?"), call this with status "complete" and pair it with freelancer_my_bids (status "awarded") — reason over the combined results yourself (skills used, budget ranges, proposal style).

Use when: "Show my active projects", "List projects I'm working on", "What projects have I posted?", "Analyze my past completed projects"`,
      inputSchema: z.object({
        role: z.enum(["owner", "freelancer"]).default("freelancer").describe("owner = posted by you, freelancer = hired on"),
        status: z.enum(["active", "complete", "closed"]).optional().describe("Filter by project status"),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe("Number of results"),
        offset: z.number().int().min(0).default(0).describe("Pagination offset"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ role, status, limit, offset, account }) => {
      try {
        const selfResult = await apiGet<{ id: number }>("/users/0.1/self", undefined, account);
        const selfId = selfResult.id;

        const params: Record<string, unknown> = { limit, offset, full_description: false, job_details: true };
        if (role === "owner") {
          params["owners[]"] = selfId;
        } else {
          params["freelancers[]"] = selfId;
        }
        if (status) params["statuses[]"] = status;

        const result = await apiGet<{ projects: FreelancerProject[]; total_count: number }>(
          "/projects/0.1/projects",
          params,
          account
        );

        if (!result.projects?.length) {
          return { content: [{ type: "text", text: "No projects found." }] };
        }

        const lines = [
          `**Your projects as ${role}** — ${result.total_count} total (showing ${result.projects.length}):`,
          "",
          ...result.projects.map((p, i) => formatProjectSummary(p, i + 1)),
        ];

        return {
          content: [{ type: "text", text: truncate(lines.join("\n"), CHARACTER_LIMIT) }],
          structuredContent: { total: result.total_count, projects: result.projects },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );
}

function formatProjectSummary(p: FreelancerProject, index: number): string {
  const budget = p.budget
    ? `$${p.budget.minimum ?? "?"}–$${p.budget.maximum ?? "?"} ${p.budget.currency_code ?? "USD"}`
    : "Budget TBD";
  const skills = p.jobs?.map((j) => j.name).join(", ") || "";
  return [
    `**${index}. [${p.id}] ${p.title}**`,
    `   Status: ${p.status} | Type: ${p.type} | Budget: ${budget}`,
    `   Bids: ${p.bid_stats?.bid_count ?? 0} (avg $${p.bid_stats?.bid_avg?.toFixed(0) ?? "?"})`,
    skills ? `   Skills: ${skills}` : "",
    `   Posted: ${formatDate(p.time_submitted)}`,
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function formatProjectFull(p: FreelancerProject): string {
  const budget = p.budget
    ? `$${p.budget.minimum ?? "?"}–$${p.budget.maximum ?? "?"} ${p.budget.currency_code ?? "USD"}`
    : "Budget TBD";
  const skills = p.jobs?.map((j) => j.name).join(", ") || "none";
  return [
    `## [${p.id}] ${p.title}`,
    "",
    `**Status:** ${p.status} | **Type:** ${p.type} | **Budget:** ${budget}`,
    `**Posted:** ${formatDate(p.time_submitted)} | **Updated:** ${formatDate(p.time_updated)}`,
    `**Bids:** ${p.bid_stats?.bid_count ?? 0} (avg $${p.bid_stats?.bid_avg?.toFixed(0) ?? "?"})`,
    `**Skills:** ${skills}`,
    "",
    "### Description",
    p.description || "No description provided.",
  ].join("\n");
}
