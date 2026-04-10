import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { config } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let pkg: { version: string } = { version: "0.0.0" };
try {
  pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"));
} catch {
  console.error("[vaulted] Failed to read package.json — cannot determine server version");
  process.exit(1);
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "vaulted",
    version: pkg.version,
  });

  server.registerTool(
    "create_secret",
    {
      title: "Create Secret",
      description:
        "Create a secure, self-destructing link for sharing sensitive data like passwords, API keys, or credentials. The secret is encrypted end-to-end — the server never sees plaintext. Supports reading secrets from environment variables, files, or .env files without exposing them in the conversation.",
      inputSchema: {
        content: z.string(),
        max_views: z.number().optional(),
        expiry: z.string().optional(),
        passphrase: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: "not implemented yet",
          }),
        },
      ],
    }),
  );

  server.registerTool(
    "view_secret",
    {
      title: "View Secret",
      description:
        "Retrieve and decrypt a secret from a Vaulted secure link. The secret may have view limits and will be destroyed after the maximum views are reached. By default opens in the browser for security — use output_mode to copy to clipboard, save to file, or return directly.",
      inputSchema: {
        url: z.string().optional(),
        secret_id: z.string().optional(),
        encryption_key: z.string().optional(),
        output_mode: z.enum(["browser", "clipboard", "file", "direct"]).optional(),
        passphrase: z.string().optional(),
        file_path: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: "not implemented yet",
          }),
        },
      ],
    }),
  );

  server.registerTool(
    "check_status",
    {
      title: "Check Status",
      description:
        "Check the status of a previously shared secret — how many times it's been viewed, whether it's still active, and when it expires. Does not consume a view.",
      inputSchema: {
        url: z.string().optional(),
        secret_id: z.string().optional(),
        status_token: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: "not implemented yet",
          }),
        },
      ],
    }),
  );

  return server;
}

export const VERSION = pkg.version;

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);

process.stdin.on("close", () => {
  server.close().catch(() => {
    process.exitCode = 1;
  });
});
