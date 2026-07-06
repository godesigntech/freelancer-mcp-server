import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, formatDate, mcpError, truncate, ACCOUNT_DESC } from "../services/api.js";
import { FreelancerUser } from "../types.js";
import { CHARACTER_LIMIT } from "../constants.js";

export function registerProfileTools(server: McpServer): void {
  server.registerTool(
    "freelancer_get_self",
    {
      title: "Get My Profile",
      description: `Retrieve your own Freelancer.com profile, including reputation, earnings, skills, location and stats.

Args:
  - account (string, optional): ${ACCOUNT_DESC}

Returns:
  - username, display name, tagline, location
  - reputation score and total reviews
  - registered skills/job categories
  - hourly rate and earnings
  - registration date

Use when: "What's my profile?", "Show my reputation", "What are my stats on Freelancer?"`,
      inputSchema: z.object({
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ account }) => {
      try {
        const user = await apiGet<FreelancerUser>("/users/0.1/self", {
          avatar: true,
          reputation: true,
          jobs: true,
          location_details: true,
          earnings: true,
        }, account);

        const text = formatUserProfile(user);
        return {
          content: [{ type: "text", text: truncate(text, CHARACTER_LIMIT) }],
          structuredContent: user,
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  server.registerTool(
    "freelancer_get_user",
    {
      title: "Get User Profile",
      description: `Retrieve a Freelancer.com user profile by username or user ID.

Args:
  - username (string, optional): Freelancer username (e.g. "usman_godesign")
  - user_id (number, optional): Numeric Freelancer user ID
  Provide at least one of username or user_id.
  - account (string, optional): ${ACCOUNT_DESC}

Returns: profile, reputation, skills, location, hourly rate

Use when: "Look up this freelancer", "What's their rating?", "Check the profile of user 12345"`,
      inputSchema: z.object({
        username: z.string().optional().describe("Freelancer username"),
        user_id: z.number().int().optional().describe("Numeric user ID"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ username, user_id, account }) => {
      if (!username && !user_id) {
        return mcpError("Provide either username or user_id.");
      }
      try {
        const params: Record<string, unknown> = {
          avatar: true,
          reputation: true,
          jobs: true,
          location_details: true,
        };
        if (username) params["usernames[]"] = username;
        if (user_id) params["ids[]"] = user_id;

        const result = await apiGet<{ users: Record<string, FreelancerUser> }>(
          "/users/0.1/users",
          params,
          account
        );

        const users = Object.values(result.users);
        if (!users.length) return mcpError("User not found.");

        const text = users.map(formatUserProfile).join("\n\n---\n\n");
        return {
          content: [{ type: "text", text: truncate(text, CHARACTER_LIMIT) }],
          structuredContent: users[0],
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );
}

function formatUserProfile(user: FreelancerUser): string {
  const skills = user.jobs?.map((j) => j.name).join(", ") || "none listed";
  const rep = user.reputation?.entire_history;
  const loc = user.location;
  return [
    `**${user.display_name}** (@${user.username})`,
    user.tagline ? `_${user.tagline}_` : "",
    "",
    `📍 ${loc?.city || ""}${loc?.city && loc?.country?.name ? ", " : ""}${loc?.country?.name || "Unknown"}`,
    `⭐ Reputation: ${rep?.overall?.toFixed(2) ?? "N/A"} (${rep?.reviews ?? 0} reviews)`,
    user.hourly_rate ? `💰 Hourly rate: $${user.hourly_rate}/hr` : "",
    user.earnings?.earnings ? `💵 Total earnings: $${user.earnings.earnings.toLocaleString()}` : "",
    `🗓️ Registered: ${formatDate(user.registration_date)}`,
    `🛠️ Skills: ${skills}`,
  ]
    .filter(Boolean)
    .join("\n");
}
