import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, apiPut, apiForm, mcpError, truncate, ACCOUNT_DESC } from "../services/api.js";
import { CHARACTER_LIMIT } from "../constants.js";

interface FreelancerJob {
  id: number;
  name: string;
  category?: { id: number; name: string };
  seo_url?: string;
}

// In-process cache of the full skill catalogue (~3000 entries). Fetched once per server run.
let jobCatalogue: FreelancerJob[] | null = null;

async function getJobCatalogue(): Promise<FreelancerJob[]> {
  if (jobCatalogue) return jobCatalogue;
  jobCatalogue = await apiGet<FreelancerJob[]>("/projects/0.1/jobs/");
  return jobCatalogue;
}

/**
 * Resolve a mixed list of skill names and/or numeric IDs to numeric job IDs.
 * Throws with a helpful message listing any unmatched names.
 */
async function resolveSkillIds(skills: Array<string | number>): Promise<number[]> {
  const catalogue = await getJobCatalogue();
  const byName = new Map<string, number>();
  for (const j of catalogue) byName.set(j.name.toLowerCase(), j.id);

  const ids: number[] = [];
  const unmatched: string[] = [];
  for (const s of skills) {
    if (typeof s === "number" || /^\d+$/.test(String(s))) {
      ids.push(Number(s));
      continue;
    }
    const key = String(s).trim().toLowerCase();
    const exact = byName.get(key);
    if (exact !== undefined) {
      ids.push(exact);
      continue;
    }
    // fall back to a unique substring match
    const matches = catalogue.filter((j) => j.name.toLowerCase().includes(key));
    if (matches.length === 1) {
      ids.push(matches[0].id);
    } else {
      unmatched.push(String(s));
    }
  }
  if (unmatched.length) {
    throw new Error(
      `Could not resolve these skills to a single match: ${unmatched.join(", ")}. ` +
        `Use freelancer_search_skills to find the exact name or numeric ID.`
    );
  }
  return Array.from(new Set(ids));
}

export function registerAccountTools(server: McpServer): void {
  // ---- Search the skill catalogue (name -> id) ----
  server.registerTool(
    "freelancer_search_skills",
    {
      title: "Search Skills",
      description: `Search the Freelancer.com skill (job) catalogue by name. Use this to find the numeric skill IDs needed by the skill-management tools.

Args:
  - query (string): Substring to match against skill names (case-insensitive), e.g. "python", "n8n", "automation"
  - limit (number, default 25): Max results

Returns: matching skills with their numeric ID, name and category.

Use when: "Find the skill ID for n8n", "What automation skills exist?", "Search skills for react"`,
      inputSchema: z.object({
        query: z.string().min(1).describe("Substring to match against skill names"),
        limit: z.number().int().min(1).max(100).default(25).describe("Max results"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        const catalogue = await getJobCatalogue();
        const q = query.trim().toLowerCase();
        const matches = catalogue
          .filter((j) => j.name.toLowerCase().includes(q))
          .slice(0, limit);
        if (!matches.length) {
          return { content: [{ type: "text", text: `No skills matched "${query}".` }] };
        }
        const lines = [
          `**Skills matching "${query}"** (${matches.length}):`,
          "",
          ...matches.map((j) => `• ${j.name} — ID ${j.id}${j.category ? ` (${j.category.name})` : ""}`),
        ];
        return {
          content: [{ type: "text", text: truncate(lines.join("\n"), CHARACTER_LIMIT) }],
          structuredContent: { skills: matches },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // ---- List my current skills ----
  server.registerTool(
    "freelancer_list_skills",
    {
      title: "List My Skills",
      description: `List the skills (jobs) currently on your own Freelancer.com profile.

Returns: your skills with numeric ID, name and category.

Args:
  - account (string, optional): ${ACCOUNT_DESC}

Use when: "What skills are on my profile?", "List my skills", "Do I have n8n listed?"`,
      inputSchema: z.object({
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ account }) => {
      try {
        const self = await apiGet<{ jobs?: FreelancerJob[] }>("/users/0.1/self", { jobs: true }, account);
        const jobs = self.jobs || [];
        if (!jobs.length) {
          return { content: [{ type: "text", text: "No skills listed on your profile." }] };
        }
        const lines = [
          `**Your skills** (${jobs.length}):`,
          "",
          ...jobs.map((j) => `• ${j.name} — ID ${j.id}${j.category ? ` (${j.category.name})` : ""}`),
        ];
        return {
          content: [{ type: "text", text: truncate(lines.join("\n"), CHARACTER_LIMIT) }],
          structuredContent: { count: jobs.length, skills: jobs },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // ---- Add skills (keeps existing) ----
  server.registerTool(
    "freelancer_add_skills",
    {
      title: "Add Skills",
      description: `Add one or more skills (jobs) to your Freelancer.com profile, keeping your existing skills.

Args:
  - skills (string[]): Skill names (e.g. "n8n", "Python") or numeric skill IDs. Names are resolved via the catalogue.
  - account (string, optional): ${ACCOUNT_DESC}

Returns: confirmation.

⚠️ This modifies your real profile. Note: Freelancer enforces a maximum number of skills per account; adding past the limit will be rejected by the API.

Use when: "Add n8n and Zapier to my skills", "Add skill 3112 to my profile"`,
      inputSchema: z.object({
        skills: z.array(z.union([z.string(), z.number()])).min(1).describe("Skill names or numeric IDs to add"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ skills, account }) => {
      try {
        const ids = await resolveSkillIds(skills);
        await apiForm("post", "/users/0.1/self/jobs", { jobs: ids }, {}, account);
        return {
          content: [{ type: "text", text: `✅ Added ${ids.length} skill(s): IDs ${ids.join(", ")}.` }],
          structuredContent: { added: ids },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // ---- Remove skills ----
  server.registerTool(
    "freelancer_remove_skills",
    {
      title: "Remove Skills",
      description: `Remove one or more skills (jobs) from your Freelancer.com profile.

Args:
  - skills (string[]): Skill names or numeric IDs to remove.
  - account (string, optional): ${ACCOUNT_DESC}

Returns: confirmation.

⚠️ This modifies your real profile.

Use when: "Remove PHP from my skills", "Drop skill 3 from my profile"`,
      inputSchema: z.object({
        skills: z.array(z.union([z.string(), z.number()])).min(1).describe("Skill names or numeric IDs to remove"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ skills, account }) => {
      try {
        const ids = await resolveSkillIds(skills);
        await apiForm("delete", "/users/0.1/self/jobs", { jobs: ids }, {}, account);
        return {
          content: [{ type: "text", text: `✅ Removed ${ids.length} skill(s): IDs ${ids.join(", ")}.` }],
          structuredContent: { removed: ids },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // ---- Set skills (replaces the entire list) ----
  server.registerTool(
    "freelancer_set_skills",
    {
      title: "Set Skills (Replace All)",
      description: `Replace your ENTIRE skill list with the provided skills. Any current skill not in the list is removed.

Args:
  - skills (string[]): The complete set of skill names or numeric IDs your profile should have.
  - account (string, optional): ${ACCOUNT_DESC}

Returns: confirmation.

⚠️ Destructive: this overwrites all existing skills. Consider freelancer_list_skills first, and freelancer_add_skills if you only want to append.

Use when: "Set my skills to exactly Python, n8n and React", "Replace all my skills with this list"`,
      inputSchema: z.object({
        skills: z.array(z.union([z.string(), z.number()])).min(1).describe("Complete replacement set of skill names or IDs"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ skills, account }) => {
      try {
        const ids = await resolveSkillIds(skills);
        await apiForm("put", "/users/0.1/self/jobs", { jobs: ids }, {}, account);
        return {
          content: [{ type: "text", text: `✅ Skill list replaced — now ${ids.length} skill(s): IDs ${ids.join(", ")}.` }],
          structuredContent: { skills: ids },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // ---- Specialty profiles: list ----
  server.registerTool(
    "freelancer_list_profiles",
    {
      title: "List Specialty Profiles",
      description: `Fetch one or more of your Freelancer.com "specialty profiles" by their numeric profile IDs.

Note: Freelancer's API has no endpoint that lists your profile IDs for you — you must already know the ID(s) (e.g. from the profile URL). This is a limitation of the public API, not this tool.

Args:
  - profile_ids (number[]): Numeric specialty-profile IDs to fetch.
  - account (string, optional): ${ACCOUNT_DESC}

Returns: profile details (name, tagline, hourly rate, description).

Use when: "Show specialty profile 12345"`,
      inputSchema: z.object({
        profile_ids: z.array(z.number().int().positive()).min(1).describe("Numeric specialty-profile IDs"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ profile_ids, account }) => {
      try {
        const result = await apiGet<{ profiles: unknown[] }>("/users/0.1/profiles", {
          "ids[]": profile_ids,
        }, account);
        const profiles = result.profiles || [];
        if (!profiles.length) {
          return { content: [{ type: "text", text: "No profiles found for those IDs." }] };
        }
        return {
          content: [{ type: "text", text: truncate(JSON.stringify(profiles, null, 2), CHARACTER_LIMIT) }],
          structuredContent: { profiles },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // ---- Specialty profiles: create ----
  server.registerTool(
    "freelancer_create_profile",
    {
      title: "Create Specialty Profile",
      description: `Create a new Freelancer.com "specialty profile" (a focused sub-profile, separate from your main account profile).

All fields are required by the API.
Args:
  - profile_name (string): Internal name for the specialty profile
  - tagline (string): Short headline
  - hourly_rate (number): Hourly rate in USD
  - description (string): Profile description / bio
  - skills (string[], optional): Skill names or IDs for this profile
  - account (string, optional): ${ACCOUNT_DESC}

Returns: created profile (including its profile_id).

⚠️ Creates real data on your account. Freelancer caps the number of specialty profiles; some account types (e.g. certain corporate accounts) cannot create any and the API will reject with "reached the limit for creating new profiles".

Use when: "Create a specialty profile for AI automation"`,
      inputSchema: z.object({
        profile_name: z.string().min(1).describe("Internal name for the specialty profile"),
        tagline: z.string().min(1).describe("Short headline"),
        hourly_rate: z.number().positive().describe("Hourly rate in USD"),
        description: z.string().min(1).describe("Profile description / bio"),
        skills: z.array(z.union([z.string(), z.number()])).optional().describe("Skill names or IDs"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ profile_name, tagline, hourly_rate, description, skills, account }) => {
      try {
        const body: Record<string, unknown> = { profile_name, tagline, hourly_rate, description };
        if (skills?.length) body.skill_ids = await resolveSkillIds(skills);
        const result = await apiPost<{ profile_id?: number }>("/users/0.1/profiles", body, { account });
        return {
          content: [{ type: "text", text: `✅ Specialty profile created${result?.profile_id ? ` (ID ${result.profile_id})` : ""}.` }],
          structuredContent: result,
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // ---- Specialty profiles: update ----
  server.registerTool(
    "freelancer_update_profile",
    {
      title: "Update Specialty Profile",
      description: `Update fields on one of your Freelancer.com "specialty profiles". Only the fields you supply are changed.

Important: this edits a SPECIALTY profile identified by profile_id — it does NOT edit your main account profile (description/tagline/hourly rate shown on your public freelancer page). Freelancer's public API exposes no endpoint to edit the main profile; that is web-UI-only.

Args:
  - profile_id (number): The specialty profile's numeric ID (you must already know it)
  - tagline (string, optional)
  - hourly_rate (number, optional): USD
  - description (string, optional)
  - skills (string[], optional): Skill names or IDs (replaces this profile's skills)
  - account (string, optional): ${ACCOUNT_DESC}

Returns: confirmation.

⚠️ Modifies real data. The API enforces ownership: editing a profile_id you don't own is rejected.

Use when: "Update specialty profile 12345's hourly rate to 40"`,
      inputSchema: z.object({
        profile_id: z.number().int().positive().describe("Specialty profile numeric ID"),
        tagline: z.string().optional().describe("Short headline"),
        hourly_rate: z.number().positive().optional().describe("Hourly rate in USD"),
        description: z.string().optional().describe("Profile description"),
        skills: z.array(z.union([z.string(), z.number()])).optional().describe("Skill names or IDs (replaces profile skills)"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ profile_id, tagline, hourly_rate, description, skills, account }) => {
      try {
        const body: Record<string, unknown> = { profile_id };
        if (tagline !== undefined) body.tagline = tagline;
        if (hourly_rate !== undefined) body.hourly_rate = hourly_rate;
        if (description !== undefined) body.description = description;
        if (skills?.length) body.skill_ids = await resolveSkillIds(skills);
        if (Object.keys(body).length === 1) {
          return mcpError("Provide at least one field to update (tagline, hourly_rate, description or skills).");
        }
        const result = await apiPut<Record<string, unknown>>("/users/0.1/profiles", body, account);
        return {
          content: [{ type: "text", text: `✅ Specialty profile ${profile_id} updated.` }],
          structuredContent: { profile_id, result },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );
}
