# Publishing checklist

`server.json` and `package.json`'s `mcpName` are already staged for the [MCP Registry](https://registry.modelcontextprotocol.io/). Everything below needs your own credentials (npm login, GitHub device-flow), so it can't be automated — run these yourself from the repo root.

## 1. Publish to npm

```bash
npm login                 # opens browser / prompts for npm credentials + 2FA
npm run build
npm publish --access public
```

`freelancer-mcp-server` is unclaimed on npm as of this writing.

## 2. Install the registry publisher CLI

```bash
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
sudo mv mcp-publisher /usr/local/bin/
```

## 3. Authenticate as the repo owner (GitHub OAuth device flow)

```bash
mcp-publisher login github
```

Follow the printed code/URL — this claims the `io.github.godesigntech/...` namespace, which only works because `godesigntech` owns this GitHub repo.

## 4. Publish

```bash
mcp-publisher publish
```

This reads `server.json` from the repo root and submits it to the registry.

## Keeping versions in sync going forward

Every release, bump the version in all three places together:
- `package.json` → `version`
- `server.json` → top-level `version` **and** `packages[0].version`
- `npm publish` again, then `mcp-publisher publish` again

They must match exactly or the registry will reject the submission.
