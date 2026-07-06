# Freelancer MCP Server

An [MCP](https://modelcontextprotocol.io) server that connects Claude (Desktop, Code, or any MCP-compatible client) directly to Freelancer.com. Search and bid on projects, read and reply to client messages, review your track record, and manage skills/specialty profiles — all from a chat.

Supports **multiple Freelancer accounts in one server** (e.g. your own account plus one or more clients' accounts you manage), switchable per tool call.

This project is 100% self-contained: it talks only to `freelancer.com`'s public API using whatever access token(s) you provide. No other data source, project, or third-party service is involved.

## What you can ask Claude

| Tool | Example prompt |
|---|---|
| `freelancer_list_accounts` | "Which Freelancer accounts are connected?" |
| `freelancer_get_self` | "Show my profile and reputation" |
| `freelancer_get_user` | "Look up @some_freelancer on Freelancer" |
| `freelancer_search_projects` | "Find the latest n8n automation projects under $500" |
| `freelancer_get_project` | "Get details on project 12345678" |
| `freelancer_my_projects` | "List my active projects" / "Show my completed projects" |
| `freelancer_get_project_bids` | "Who has bid on project 12345 and how much?" |
| `freelancer_my_bids` | "Show my awarded bids" / "Show my rejected bids" |
| `freelancer_place_bid` | "Bid $200 on project 12345 with 5-day delivery" |
| `freelancer_get_milestones` | "What milestones are on project 12345?" |
| `freelancer_list_threads` | "Show my inbox" |
| `freelancer_get_messages` | "Read this chat: freelancer.com/messages/thread/98765" |
| `freelancer_send_message` | "Reply to thread 98765 saying..." |
| `freelancer_search_skills` / `list_skills` / `add_skills` / `remove_skills` / `set_skills` | "Add n8n and Zapier to my skills" |
| `freelancer_list_profiles` / `create_profile` / `update_profile` | "Create a specialty profile for AI automation" |

Every tool accepts an optional `account` argument to pick which connected Freelancer account it should act on/as (see [Multiple accounts](#multiple-accounts)).

### Analyzing past projects & winning strategy

There's no single "analyze my strategy" button — instead, Claude does the analysis itself over the raw data this server exposes. This keeps the server a thin, honest API wrapper instead of a black box. Ask things like:

> "Pull my awarded bids and my rejected bids, then compare amount, delivery time, and proposal length/style to figure out what's working."

> "Look at my completed projects and tell me which skills show up most often."

> "Compare my bid on project X to the other bids on it — am I priced competitively?"

Claude will chain `freelancer_my_bids` (status `awarded` vs `rejected`), `freelancer_my_projects` (status `complete`), and `freelancer_get_project_bids` to gather the data, then reason over it directly in the conversation.

### Chat links and thread IDs

`freelancer_get_messages` and `freelancer_send_message` accept either a plain numeric thread ID or a pasted Freelancer chat/message link — the server extracts the ID either way.

## Setup

### 1. Get a Personal Access Token

1. Log in to Freelancer.com
2. Go to https://accounts.freelancer.com/settings/develop
3. Create a new app (or use an existing one)
4. Generate a **Personal Access Token**
5. Copy it

Repeat for each additional Freelancer account you want this server to control (e.g. a client's account you manage, with their permission).

### 2. Install and build

```bash
git clone https://github.com/godesigntech/freelancer-mcp-server.git
cd freelancer-mcp-server
npm install
npm run build
```

### 3. Configure your MCP client

#### Claude Code (CLI)

```bash
claude mcp add freelancer -- node /FULL/PATH/TO/freelancer-mcp-server/dist/index.js
```

Then set the token as an environment variable before launching, or add it to the server config — see `claude mcp add --help` for `--env` flags, e.g.:

```bash
claude mcp add freelancer --env FREELANCER_OAUTH_TOKEN=your_token_here -- node /FULL/PATH/TO/freelancer-mcp-server/dist/index.js
```

#### Claude Desktop

Open your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add this block inside `"mcpServers"` (create the file if it doesn't exist):

```json
{
  "mcpServers": {
    "freelancer": {
      "command": "node",
      "args": ["/FULL/PATH/TO/freelancer-mcp-server/dist/index.js"],
      "env": {
        "FREELANCER_OAUTH_TOKEN": "your_token_here"
      }
    }
  }
}
```

Replace `/FULL/PATH/TO/` with the real absolute path on your machine. Restart Claude Desktop — you should see a 🔌 indicating the server connected.

### Multiple accounts

To connect more than one Freelancer account (your own plus, say, two clients'), use `FREELANCER_ACCOUNTS` instead of `FREELANCER_OAUTH_TOKEN` — a JSON object mapping a label you choose to each token:

```json
{
  "mcpServers": {
    "freelancer": {
      "command": "node",
      "args": ["/FULL/PATH/TO/freelancer-mcp-server/dist/index.js"],
      "env": {
        "FREELANCER_ACCOUNTS": "{\"main\":\"token1\",\"client_acme\":\"token2\"}"
      }
    }
  }
}
```

The first account listed becomes the default (used when a tool call omits `account`). Ask Claude "which Freelancer accounts are connected?" to confirm, then say e.g. "using the client_acme account, show me the latest projects" to target a specific one. Tokens are never logged, echoed back, or written anywhere by this server — they only ever go into the outgoing `freelancer-oauth-v1` header.

## Testing

Ask Claude:
> "Show my Freelancer profile"

If it responds with your username and stats, you're set.

## Profile editing — what the Freelancer API actually allows

The Freelancer.com public REST API is read-mostly for profiles. After probing the live API, here's the real boundary:

**Editable:**
- ✅ Skills/jobs — add, remove, or replace the skills on an account (`/users/0.1/self/jobs`). Freelancer caps the total number of skills per account.
- ✅ Specialty profiles — create/update focused sub-profiles (`/users/0.1/profiles`): tagline, hourly_rate, description, skills. **Caveats:** the API has no endpoint to list your own profile IDs (you must already know them), and some account types (e.g. certain corporate accounts) cannot create new ones.

**NOT possible via the public API (web-UI only):**
- ❌ Main account bio/tagline/hourly rate shown on your public page
- ❌ Profile photo / avatar
- ❌ Experience, education, publications, references, certifications
- ❌ Portfolio (read-only via API)

## Security notes

- Tokens live only in your local MCP client config (or `.env` for `npm run dev`) — never committed, never sent anywhere but Freelancer's own API.
- The server runs entirely on your machine; no telemetry, no third-party calls.
- Destructive/real-world actions (`place_bid`, `send_message`, skill/profile edits) always surface for your review before they execute, since Claude shows tool calls before running them.
- This repo contains no data from, and no dependency on, any other project — it's a clean, standalone Freelancer.com integration.

## Troubleshooting

**"no Freelancer accounts configured"**
→ Set `FREELANCER_OAUTH_TOKEN` or `FREELANCER_ACCOUNTS` in your MCP client config.

**401 Unauthorized**
→ Token expired or wrong. Generate a fresh one at https://accounts.freelancer.com/settings/develop

**"Unknown account "x""**
→ Run `freelancer_list_accounts` to see the exact labels configured, then use one of those.

**Tool not appearing in Claude**
→ Confirm the path in your config is the absolute path to `dist/index.js`, and that `npm run build` succeeded.

## Contributing

Issues and PRs welcome. Keep changes scoped to the Freelancer.com API surface — this project intentionally stays a single-purpose, dependency-light MCP server.

## License

MIT
