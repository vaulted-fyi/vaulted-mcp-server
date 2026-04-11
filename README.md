# @vaulted/mcp-server

Zero-knowledge encrypted secret sharing for AI agents via [MCP](https://modelcontextprotocol.io).

Share passwords, API keys, and credentials through your AI agent — encrypted end-to-end, self-destructing, and the server never sees plaintext.

## Install

No install needed — runs via npx:

```bash
npx @vaulted/mcp-server
```

Or install globally:

```bash
npm install -g @vaulted/mcp-server
vaulted-mcp-server
```

## Configure your MCP host

### Claude Code

Add to `.mcp.json` in your project root (or `~/.claude/.mcp.json` globally):

```json
{
  "mcpServers": {
    "vaulted": {
      "command": "npx",
      "args": ["@vaulted/mcp-server"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "vaulted": {
      "command": "npx",
      "args": ["@vaulted/mcp-server"]
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "vaulted": {
      "command": "npx",
      "args": ["@vaulted/mcp-server"]
    }
  }
}
```

## Tools

### `create_secret`

Create a secure, self-destructing link for sharing sensitive data.

| Parameter    | Type                                                                                       | Default      | Description                            |
| ------------ | ------------------------------------------------------------------------------------------ | ------------ | -------------------------------------- |
| `content`    | string                                                                                     | _(required)_ | The secret to encrypt (max 1000 chars) |
| `max_views`  | `"1"` \| `"3"` \| `"5"` \| `"10"`                                                          | `"1"`        | Views before self-destruct             |
| `expiry`     | `"1h"` \| `"2h"` \| `"6h"` \| `"12h"` \| `"24h"` \| `"3d"` \| `"7d"` \| `"14d"` \| `"30d"` | `"24h"`      | Time until expiration                  |
| `passphrase` | string                                                                                     | _(none)_     | Optional passphrase protection         |

**Example prompts:**

- "Share this API key securely: sk-1234..."
- "Create a self-destructing link for this database password, max 3 views, expires in 7 days"
- "Share this secret with a passphrase"

### `view_secret` _(coming soon)_

Retrieve and decrypt a secret from a Vaulted link. Supports browser, clipboard, file, and direct output modes.

### `check_status` _(coming soon)_

Check how many times a secret has been viewed and whether it's still active — without consuming a view.

## Options

| Flag             | Default               | Description                                              |
| ---------------- | --------------------- | -------------------------------------------------------- |
| `--base-url`     | `https://vaulted.fyi` | Vaulted API base URL                                     |
| `--allowed-dirs` | _(none)_              | Comma-separated directories for file-based input sources |

```bash
npx @vaulted/mcp-server --base-url https://custom.vaulted.dev
```

## Security

- All encryption happens locally via [@vaulted/crypto](https://www.npmjs.com/package/@vaulted/crypto) (AES-256-GCM, Web Crypto API)
- The encryption key exists only in the URL fragment (`#`) — never sent to any server
- No accounts, no API keys, no telemetry
- Secrets auto-delete after max views or expiration

Learn more at [vaulted.fyi](https://vaulted.fyi).

## License

MIT
