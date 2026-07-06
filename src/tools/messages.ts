import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, formatDate, mcpError, truncate, resolveThreadId, ACCOUNT_DESC } from "../services/api.js";
import { FreelancerThread, FreelancerMessage } from "../types.js";
import { CHARACTER_LIMIT, DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";

export function registerMessageTools(server: McpServer): void {
  // List inbox threads
  server.registerTool(
    "freelancer_list_threads",
    {
      title: "List Message Threads",
      description: `List your Freelancer.com inbox message threads.

Args:
  - context_type (string, optional): Filter by "project" or "freelancer_dashboard"
  - limit (number, 1-50, default 10): Number of threads
  - offset (number, default 0): Pagination offset
  - account (string, optional): ${ACCOUNT_DESC}

Returns: list of threads with members, last activity and message count

Use when: "Show my inbox", "List my message threads", "Who has messaged me?"`,
      inputSchema: z.object({
        context_type: z.enum(["project", "freelancer_dashboard"]).optional().describe("Thread context type"),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe("Number of threads"),
        offset: z.number().int().min(0).default(0).describe("Pagination offset"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ context_type, limit, offset, account }) => {
      try {
        const params: Record<string, unknown> = { limit, offset };
        if (context_type) params["context_types[]"] = context_type;

        const result = await apiGet<{ threads: FreelancerThread[]; total_count: number }>(
          "/messages/0.1/threads",
          params,
          account
        );

        if (!result.threads?.length) {
          return { content: [{ type: "text", text: "No message threads found." }] };
        }

        const lines = [
          `**Your inbox** — ${result.total_count} threads (showing ${result.threads.length}):`,
          "",
          ...result.threads.map((t, i) => formatThread(t, i + 1)),
        ];

        return {
          content: [{ type: "text", text: truncate(lines.join("\n"), CHARACTER_LIMIT) }],
          structuredContent: { total: result.total_count, threads: result.threads },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // Get messages in a thread
  server.registerTool(
    "freelancer_get_messages",
    {
      title: "Get Thread Messages",
      description: `Retrieve messages from a specific Freelancer.com thread.

Args:
  - thread_id (string | number): Thread ID, or a Freelancer.com chat/message link containing one (get the ID from freelancer_list_threads if unknown)
  - limit (number, 1-50, default 20): Number of messages
  - offset (number, default 0): Pagination offset
  - account (string, optional): ${ACCOUNT_DESC}

Returns: messages with text, sender, timestamp and attachment info

Use when: "Show messages in thread 12345", "What did the client say?", "Read the conversation", "Read this chat: https://www.freelancer.com/messages/thread/12345"`,
      inputSchema: z.object({
        thread_id: z.union([z.number().int().positive(), z.string().min(1)]).describe("Thread ID, or a chat link containing one"),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(20).describe("Number of messages"),
        offset: z.number().int().min(0).default(0).describe("Pagination offset"),
        account: z.string().optional().describe(ACCOUNT_DESC),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ thread_id: thread_id_input, limit, offset, account }) => {
      try {
        const thread_id = resolveThreadId(thread_id_input);
        const result = await apiGet<{ messages: FreelancerMessage[]; total_count: number }>(
          "/messages/0.1/messages",
          {
            "threads[]": thread_id,
            limit,
            offset,
          },
          account
        );

        if (!result.messages?.length) {
          return { content: [{ type: "text", text: `No messages found in thread ${thread_id}.` }] };
        }

        const lines = [
          `**Thread ${thread_id}** — ${result.total_count} messages (showing ${result.messages.length}):`,
          "",
          ...result.messages.map((m) => formatMessage(m)),
        ];

        return {
          content: [{ type: "text", text: truncate(lines.join("\n"), CHARACTER_LIMIT) }],
          structuredContent: { total: result.total_count, messages: result.messages },
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }
  );

  // Send a message
  server.registerTool(
    "freelancer_send_message",
    {
      title: "Send Message",
      description: `Send a message in an existing Freelancer.com thread.

Args:
  - thread_id (string | number): The thread ID to reply to, or a Freelancer.com chat link containing one
  - message (string): Your message text
  - account (string, optional): ${ACCOUNT_DESC} This is the account the message is sent FROM.

Returns: confirmation with message ID

⚠️ This sends a real message from your account.

Use when: "Reply to thread 12345 saying...", "Message the client", "Send a follow-up"`,
      inputSchema: z.object({
        thread_id: z.union([z.number().int().positive(), z.string().min(1)]).describe("Thread ID to reply to, or a chat link containing one"),
        message: z.string().min(1).max(5000).describe("Message text to send"),
        account: z.string().optional().describe(ACCOUNT_DESC + " This is the account the message is sent FROM."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ thread_id: thread_id_input, message, account }) => {
      try {
        const thread_id = resolveThreadId(thread_id_input);
        const result = await apiPost<FreelancerMessage>(
          `/messages/0.1/threads/${thread_id}/messages`,
          { message },
          { form: true, account }
        );

        return {
          content: [
            {
              type: "text",
              text: [
                `✅ **Message sent!**`,
                `Message ID: ${result.id}`,
                `Thread: ${thread_id}`,
                `Sent: ${formatDate(result.time_created)}`,
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

function formatThread(t: FreelancerThread, index: number): string {
  const ctx = t.thread?.context;
  const ctxLabel = ctx?.type
    ? `${ctx.type}${ctx.id ? ` — ${ctx.type === "project" ? "Project " : ""}${ctx.id}` : ""}`
    : t.thread?.thread_type ?? "chat";
  const members = t.thread?.members ?? [];
  return [
    `**${index}. Thread #${t.id}** (${ctxLabel})`,
    `   Members: ${members.length ? members.join(", ") : "unknown"} | Messages: ${t.message_count ?? "?"}`,
    `   Updated: ${formatDate(t.time_updated)}`,
    "",
  ].join("\n");
}

function formatMessage(m: FreelancerMessage): string {
  const attachmentNote =
    m.attachments?.length
      ? `\n   📎 Attachments: ${m.attachments.map((a) => a.filename).join(", ")}`
      : "";
  return [
    `[${formatDate(m.time_created)}] **User ${m.from_user}:**`,
    m.message,
    attachmentNote,
    "",
  ].join("\n");
}
