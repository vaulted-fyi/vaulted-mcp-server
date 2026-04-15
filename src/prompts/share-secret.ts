import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

export const SHARE_SECRET_PROMPT_DESCRIPTION =
  "Step-by-step guide to creating a secure, self-destructing secret link";

export const SHARE_SECRET_PROMPT_TEXT = `I'd like to share a secret securely using Vaulted. Please help me create an encrypted, self-destructing link.

Here's what I need to decide:

## What to share

I can provide the secret content in several ways:

- **Direct text**: Just type or paste the secret value directly
- **Environment variable**: Use \`env:VAR_NAME\` to read from an environment variable without the value appearing in our conversation
- **File**: Use \`file:path/to/secret.txt\` to read from a file without the value appearing in our conversation
- **Dotenv key**: Use \`dotenv:.env.local:SECRET_KEY\` to read a specific key from a .env file without the value appearing in our conversation

For sensitive values like API keys, passwords, or credentials, I recommend using \`env:\`, \`file:\`, or \`dotenv:\` prefixes — these keep the actual secret value out of the AI conversation entirely.

## Options

- **Max views** (how many times the link can be opened before it self-destructs): 1, 3, 5, or 10 (default: 1)
- **Expiry** (how long until the link expires): 1h, 2h, 6h, 12h, 24h, 3d, 7d, 14d, or 30d (default: 24h)
- **Passphrase** (optional): Add an extra layer of protection — the recipient will need this passphrase to decrypt the secret. If you set one, share it with the recipient through a separate channel — it is never embedded in the link.

Please ask me what I'd like to share and which options I prefer, then use the create_secret tool to create the secure link.`;

export function shareSecretPrompt(): GetPromptResult {
  return {
    description: SHARE_SECRET_PROMPT_DESCRIPTION,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: SHARE_SECRET_PROMPT_TEXT,
        },
      },
    ],
  };
}
