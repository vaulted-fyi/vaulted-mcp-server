import { SHARE_SECRET_PROMPT_DESCRIPTION, shareSecretPrompt } from "./share-secret.js";

function getPromptText(): string {
  const result = shareSecretPrompt();
  return result.messages.map((m) => (m.content.type === "text" ? m.content.text : "")).join("\n");
}

describe("shareSecretPrompt", () => {
  it("returns a result with a messages array", () => {
    const result = shareSecretPrompt();
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("returns at least one message with role 'user'", () => {
    const result = shareSecretPrompt();
    const userMessages = result.messages.filter((m) => m.role === "user");
    expect(userMessages.length).toBeGreaterThan(0);
  });

  it("each message has text content", () => {
    const result = shareSecretPrompt();
    for (const message of result.messages) {
      expect(message.content.type).toBe("text");
      if (message.content.type === "text") {
        expect(typeof message.content.text).toBe("string");
        expect(message.content.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("returns the exact description required by story task 1.5", () => {
    const result = shareSecretPrompt();
    expect(result.description).toBe(
      "Step-by-step guide to creating a secure, self-destructing secret link",
    );
    expect(result.description).toBe(SHARE_SECRET_PROMPT_DESCRIPTION);
  });

  it("mentions env:, file:, and dotenv: agent-blind prefixes", () => {
    const text = getPromptText();
    expect(text).toContain("env:VAR_NAME");
    expect(text).toContain("file:path/to/secret.txt");
    expect(text).toContain("dotenv:.env.local:SECRET_KEY");
  });

  it("lists max views options 1, 3, 5, and 10 as a single enumeration", () => {
    const text = getPromptText();
    expect(text).toMatch(/max views/i);
    expect(text).toMatch(/\b1,\s*3,\s*5,?\s*or\s*10\b/);
  });

  it("lists the full expiry range from 1h through 30d", () => {
    const text = getPromptText();
    expect(text).toMatch(/expir/i);
    for (const token of ["1h", "2h", "6h", "12h", "24h", "3d", "7d", "14d", "30d"]) {
      expect(text).toContain(token);
    }
  });

  it("describes the passphrase as optional in the same sentence", () => {
    const text = getPromptText();
    expect(text).toMatch(/optional.{0,80}passphrase|passphrase.{0,80}optional/i);
  });

  it("tells the user to share the passphrase through a separate channel", () => {
    const text = getPromptText();
    expect(text).toMatch(/separate channel/i);
  });

  it("guides the agent toward calling create_secret", () => {
    const text = getPromptText();
    expect(text).toContain("create_secret");
  });
});
