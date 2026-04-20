# @vaulted/mcp-server

[![npm version](https://img.shields.io/npm/v/@vaulted/mcp-server)](https://www.npmjs.com/package/@vaulted/mcp-server)
[![license](https://img.shields.io/npm/l/@vaulted/mcp-server)](LICENSE)

Share encrypted, self-destructing secrets directly from Claude Desktop, Cursor, Windsurf, and any MCP-compatible AI tool.

- 🔒 Zero-knowledge E2E encryption (AES-256-GCM, key never sent to server)
- 🙈 Agent-blind input: share env vars, files, and .env keys without exposing them in context
- 🛠️ 4 tools: `create_secret`, `view_secret`, `check_status`, `list_secrets`
- 📋 Local history with live status tracking
- 💻 Works with Claude Desktop, Cursor, Windsurf, Claude Code, VS Code

## Agent-blind secret sharing

The headline feature: sensitive values are **resolved locally and never passed through the LLM**. When you ask your agent to share an environment variable or file, the MCP server reads the value directly from your machine — the agent only ever sees the secure link, not the secret itself.

```
"Share the value of my STRIPE_SECRET_KEY env var"
→ Agent passes: env:STRIPE_SECRET_KEY  (never sees the value)
→ Server resolves it locally, encrypts, returns the link
```

This means sensitive values never appear in your conversation history or the LLM's context.

## Installation

**Requires Node.js ≥ 18.**

Zero-install via npx:

```bash
npx -y @vaulted/mcp-server
```

Or install globally:

```bash
npm install -g @vaulted/mcp-server
vaulted-mcp-server
```

## Quick start

Add to your MCP host config and restart the application. Your agent will have access to all 4 Vaulted tools immediately.

```json
{
  "mcpServers": {
    "vaulted": {
      "command": "npx",
      "args": ["-y", "@vaulted/mcp-server"]
    }
  }
}
```

## Configuration

### Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "vaulted": {
      "command": "npx",
      "args": ["-y", "@vaulted/mcp-server"]
    }
  }
}
```

### Cursor

File: `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "vaulted": {
      "command": "npx",
      "args": ["-y", "@vaulted/mcp-server"]
    }
  }
}
```

### Windsurf

File: `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "vaulted": {
      "command": "npx",
      "args": ["-y", "@vaulted/mcp-server"]
    }
  }
}
```

### Claude Code

File: `.mcp.json` in your project root (or `~/.claude/.mcp.json` globally):

```json
{
  "mcpServers": {
    "vaulted": {
      "command": "npx",
      "args": ["-y", "@vaulted/mcp-server"]
    }
  }
}
```

### VS Code

File: `.vscode/mcp.json`

```json
{
  "servers": {
    "vaulted": {
      "command": "npx",
      "args": ["-y", "@vaulted/mcp-server"]
    }
  }
}
```

### Any other MCP client

Run `npx @vaulted/mcp-server` as a stdio transport. The server uses the standard MCP stdio protocol.

### Optional flags

| Flag             | Default               | Description                                                                       |
| ---------------- | --------------------- | --------------------------------------------------------------------------------- |
| `--base-url`     | `https://vaulted.fyi` | Vaulted API base URL (for self-hosted instances)                                  |
| `--allowed-dirs` | _(none)_              | Comma-separated directories accessible for file-based input sources (extends CWD) |

Pass flags via the `args` array:

```json
{
  "mcpServers": {
    "vaulted": {
      "command": "npx",
      "args": ["-y", "@vaulted/mcp-server", "--base-url", "https://your-instance.example.com"]
    }
  }
}
```

Multiple allowed directories:

```json
{
  "mcpServers": {
    "vaulted": {
      "command": "npx",
      "args": ["-y", "@vaulted/mcp-server", "--allowed-dirs", "/home/user/secrets,/tmp/creds"]
    }
  }
}
```

## Tools reference

### `create_secret`

Encrypt and store a secret, returns a shareable self-destructing link.

| Parameter    | Type                                                                                       | Default  | Description                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------- |
| `content`    | string                                                                                     | required | The secret to encrypt (max 1000 chars). Supports [agent-blind prefixes](#agent-blind-input-sources). |
| `max_views`  | `"1"` \| `"3"` \| `"5"` \| `"10"`                                                          | `"1"`    | Views before self-destruct                                                                           |
| `expiry`     | `"1h"` \| `"2h"` \| `"6h"` \| `"12h"` \| `"24h"` \| `"3d"` \| `"7d"` \| `"14d"` \| `"30d"` | `"24h"`  | Time until expiration                                                                                |
| `passphrase` | string                                                                                     | _(none)_ | Optional passphrase protection                                                                       |
| `label`      | string                                                                                     | _(none)_ | Human-readable label for local history                                                               |

**Returns:** `{ success: true, data: { url, statusUrl, expiresIn, maxViews, passphraseProtected }, message }`

---

### `view_secret`

Retrieve and decrypt a secret from a Vaulted URL. Defaults to opening in the browser — use `output_mode` to keep the decrypted value out of the conversation.

| Parameter        | Type                                                   | Default            | Description                                                  |
| ---------------- | ------------------------------------------------------ | ------------------ | ------------------------------------------------------------ |
| `url`            | string                                                 | _(one req.)_       | Full Vaulted URL including the `#` fragment                  |
| `secret_id`      | string                                                 | _(one req.)_       | Secret ID (alternative to `url`)                             |
| `encryption_key` | string                                                 | _(with secret_id)_ | Encryption key from URL fragment (required with `secret_id`) |
| `output_mode`    | `"browser"` \| `"clipboard"` \| `"file"` \| `"direct"` | `"browser"`        | Where to send the decrypted value                            |
| `file_path`      | string                                                 | _(none)_           | Required when `output_mode` is `"file"`                      |
| `passphrase`     | string                                                 | _(none)_           | Required for passphrase-protected secrets                    |

**Output modes:**

- `browser` — opens the secret URL in your default browser (decryption happens in-browser, value stays out of agent context)
- `clipboard` — copies decrypted value to clipboard, nothing returned to agent
- `file` — writes decrypted value to `file_path`, nothing returned to agent
- `direct` — returns decrypted value in the response (use with care — value enters agent context)

**Returns:** Depends on `output_mode`. Browser/clipboard/file modes confirm success without returning the plaintext.

---

### `check_status`

Check how many times a secret has been viewed and whether it's still active. **Does not consume a view.**

| Parameter       | Type   | Default      | Description                                                                                                                               |
| --------------- | ------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `url`           | string | _(one req.)_ | Status URL (e.g., `https://vaulted.fyi/s/<id>/status?token=...`)                                                                          |
| `secret_id`     | string | _(one req.)_ | Secret ID (alternative to `url`)                                                                                                          |
| `status_token`  | string | _(with id)_  | Status token from secret creation (required with `secret_id`)                                                                             |
| `previousViews` | number | _(none)_     | Pass the last known view count to detect new views since last check. When the count increases, the response includes "New view detected!" |

**Returns:** `{ success: true, data: { views, maxViews, status, expiresAt }, message }`

---

### `list_secrets`

Show all locally tracked secrets with their live status fetched from the API.

| Parameter | Type | Description   |
| --------- | ---- | ------------- |
| _(none)_  | —    | No parameters |

**Returns:** `{ success: true, data: { entries: [...], suggestedAction? }, message }`

`suggestedAction` is included when unconsumed active secrets exist, prompting you to use `check_status` to monitor them.

---

### Response format

All tools use a consistent response shape:

```json
// Success
{ "success": true, "data": { /* tool-specific */ }, "message": "Human-readable summary" }

// Error
{ "success": false, "error": { "code": "SECRET_EXPIRED", "message": "...", "suggestion": "..." } }
```

**Error codes:** `SECRET_EXPIRED`, `SECRET_CONSUMED`, `PASSPHRASE_REQUIRED`, `ENV_VAR_NOT_FOUND`, `FILE_NOT_FOUND`, `PATH_TRAVERSAL_BLOCKED`, `DOTENV_KEY_NOT_FOUND`, `API_UNREACHABLE`, `API_ERROR`, `ENCRYPTION_FAILED`, `FILE_WRITE_ERROR`, `INVALID_INPUT`

## Examples

### Create a secret

```
"Share this API key securely: sk-abc123"
```

→ Returns a one-time link in the chat. Share it via Slack, email, or a ticket.

### Agent-blind: share an environment variable

```
"Share the value of my GITHUB_TOKEN env var securely"
```

→ Agent passes `env:GITHUB_TOKEN` to the tool. The server reads the value locally. The agent never sees the token.

### Agent-blind: share a file

```
"Share the contents of ~/.ssh/id_rsa.pub securely"
```

→ Agent passes `file:~/.ssh/id_rsa.pub`. File is read locally and encrypted before the link is returned.

### Agent-blind: share a key from a .env file

```
"Share the DATABASE_URL from my .env.local"
```

→ Agent passes `dotenv:.env.local:DATABASE_URL`. The specific key is parsed and encrypted. Other values in the file are never read.

### View a secret in the browser

```
"Open this secret: https://vaulted.fyi/s/abc123#key..."
```

→ Browser opens with the decrypted content. The value never enters the conversation.

### View a secret to clipboard

```
"Retrieve this secret to my clipboard: https://vaulted.fyi/s/abc123#key..."
```

→ Decrypted value is copied to clipboard. Nothing sensitive is returned in the chat.

### Save a secret to a file

```
"Save this secret to /tmp/creds.txt: https://vaulted.fyi/s/abc123#key..."
```

→ Decrypted value is written to `/tmp/creds.txt`. Nothing sensitive is returned in the chat.

### View a secret directly (returns value to agent)

```
"Retrieve this secret and return the value to me: https://vaulted.fyi/s/abc123#key..."
```

→ Decrypted value is returned in the response. Use only when you need the value in the conversation — it will appear in your chat history.

### Check whether a secret has been viewed

```
"Has my secret been viewed yet?"
```

→ Returns view count, max views, and expiry. Does not consume a view.

### Poll for new views

```
"Let me know when someone views my secret — previous view count was 0"
```

→ Pass `previousViews: 0`. When the count increases, the response includes "New view detected!"

### List recent secrets

```
"What secrets have I shared recently?"
```

→ Returns your local history with live status from the API — view counts, remaining views, and expiry for each.

## Agent-blind input sources

The `content` parameter of `create_secret` supports prefixes that instruct the server to resolve the value locally before encrypting. **The resolved value is never passed back to the agent.**

| Prefix    | Example                          | Resolves to                             |
| --------- | -------------------------------- | --------------------------------------- |
| _(none)_  | `the plain value`                | Literal string                          |
| `env:`    | `env:STRIPE_SECRET_KEY`          | `process.env.STRIPE_SECRET_KEY`         |
| `file:`   | `file:/home/user/.ssh/id_rsa`    | Contents of the file at that path       |
| `dotenv:` | `dotenv:.env.local:DATABASE_URL` | Value of `DATABASE_URL` in `.env.local` |

**Path security:** File and dotenv paths are validated against `process.cwd()` and any `--allowed-dirs` you configure. Symlinks pointing outside allowed directories are rejected with `PATH_TRAVERSAL_BLOCKED`.

**Output modes that keep secrets out of context:** Use `browser`, `clipboard`, or `file` output modes for `view_secret` — the decrypted value is delivered directly to you without entering the agent's response or conversation history.

## Security model

- **End-to-end encrypted:** AES-256-GCM encryption runs locally via [@vaulted/crypto](https://www.npmjs.com/package/@vaulted/crypto). The server never sees plaintext.
- **Key in URL fragment:** The encryption key lives only in the `#` fragment of the URL — never sent to any server, never logged.
- **Zero-knowledge server:** vaulted.fyi stores only ciphertext. It cannot decrypt your secrets.
- **Self-destructing:** Secrets are deleted when max views are reached or TTL expires — whichever comes first.
- **No accounts, no telemetry:** Anonymous usage. No API keys required.
- **Agent-blind by design:** Input source prefixes (`env:`, `file:`, `dotenv:`) ensure sensitive values never pass through the LLM.

Learn more at [vaulted.fyi/security](https://vaulted.fyi/security).

## Contributing

```bash
git clone https://github.com/vaulted-fyi/vaulted-mcp-server
cd vaulted-mcp-server
npm install
npm test
```

## License

MIT
