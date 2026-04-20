import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { handleCreateSecret } from "./tools/create-secret.js";
import { handleViewSecret, VIEW_SECRET_DESCRIPTION } from "./tools/view-secret.js";
import { checkStatusHandler } from "./tools/check-status.js";
import { listSecretsHandler } from "./tools/list-secrets.js";
import { shareSecretPrompt } from "./prompts/share-secret.js";

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
        "Create a secure, self-destructing link for sharing sensitive data like passwords, API keys, or credentials. The secret is encrypted end-to-end — the server never sees plaintext. Supports reading secrets from environment variables, files, or .env files without exposing them in the conversation. Optionally provide a label to identify the secret in your history.",
      inputSchema: {
        content: z
          .string()
          .describe("The secret content to encrypt and share. Max 1000 characters."),
        max_views: z
          .enum(["1", "3", "5", "10"])
          .optional()
          .describe(
            "Maximum number of times the secret can be viewed before self-destructing. Defaults to 1.",
          ),
        expiry: z
          .enum(["1h", "2h", "6h", "12h", "24h", "3d", "7d", "14d", "30d"])
          .optional()
          .describe("How long before the secret expires. Defaults to 24h."),
        passphrase: z
          .string()
          .optional()
          .describe(
            "Optional passphrase for additional protection. The recipient will need this passphrase to view the secret.",
          ),
        label: z
          .string()
          .optional()
          .describe(
            "Optional label to identify this secret in your history (e.g. 'stripe-key', 'db-password').",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (params) => handleCreateSecret(params),
  );

  server.registerTool(
    "view_secret",
    {
      title: "View Secret",
      description: VIEW_SECRET_DESCRIPTION,
      inputSchema: {
        url: z
          .string()
          .optional()
          .describe(
            "Full Vaulted URL (e.g., https://vaulted.fyi/s/abc123#key). Preferred over separate ID + key.",
          ),
        secret_id: z
          .string()
          .optional()
          .describe("Secret ID (alternative to URL). Must be paired with encryption_key."),
        encryption_key: z
          .string()
          .optional()
          .describe("Encryption key (alternative to URL). Must be paired with secret_id."),
        output_mode: z
          .enum(["browser", "clipboard", "file", "direct"])
          .optional()
          .describe(
            "How to deliver the secret. browser (default): opens the link in your browser — decryption happens in the web app. direct: returns decrypted content in the tool response. clipboard: copies decrypted content to the system clipboard (content omitted from response). file: writes decrypted content to file_path (content omitted from response).",
          ),
        passphrase: z
          .string()
          .optional()
          .describe("Passphrase to decrypt a passphrase-protected secret"),
        file_path: z
          .string()
          .optional()
          .describe('File path for file output mode (required when output_mode is "file").'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async (params) => handleViewSecret(params),
  );

  server.registerTool(
    "check_status",
    {
      title: "Check Status",
      description:
        "Check the status of a previously shared secret — how many times it's been viewed, whether it's still active, and when it expires. Does not consume a view. Optionally pass previous_views to detect new views since last check.",
      inputSchema: {
        url: z.string().optional(),
        secret_id: z.string().optional(),
        status_token: z.string().optional(),
        previousViews: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Last known view count. When provided, the response message will indicate if new views have occurred since this value.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (params) => checkStatusHandler(params),
  );

  server.registerTool(
    "list_secrets",
    {
      title: "List Secrets",
      description:
        "List previously shared secrets and their current status — view counts, expiry, and whether they've been consumed.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => listSecretsHandler(),
  );

  server.registerPrompt(
    "share-secret",
    {
      title: "Share Secret",
      description: "Share a secret securely via an encrypted, self-destructing link",
    },
    () => shareSecretPrompt(),
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
