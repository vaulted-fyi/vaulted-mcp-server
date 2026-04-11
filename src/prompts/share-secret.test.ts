import { shareSecretPrompt } from "./share-secret.js";

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
      expect(typeof message.content.text).toBe("string");
      expect(message.content.text.length).toBeGreaterThan(0);
    }
  });

  it("includes a description field", () => {
    const result = shareSecretPrompt();
    expect(typeof result.description).toBe("string");
    expect(result.description).toContain("secret");
  });

  it("mentions env:, file:, and dotenv: agent-blind prefixes", () => {
    const result = shareSecretPrompt();
    const text = result.messages.map((m) => m.content.text).join("\n");
    expect(text).toContain("env:");
    expect(text).toContain("file:");
    expect(text).toContain("dotenv:");
  });

  it("mentions max views options 1, 3, 5, 10", () => {
    const result = shareSecretPrompt();
    const text = result.messages.map((m) => m.content.text).join("\n");
    expect(text).toMatch(/\bmax views\b/i);
    expect(text).toContain("1");
    expect(text).toContain("3");
    expect(text).toContain("5");
    expect(text).toContain("10");
  });

  it("mentions expiry options", () => {
    const result = shareSecretPrompt();
    const text = result.messages.map((m) => m.content.text).join("\n");
    expect(text).toMatch(/expir/i);
    expect(text).toContain("24h");
    expect(text).toContain("30d");
  });

  it("mentions optional passphrase", () => {
    const result = shareSecretPrompt();
    const text = result.messages.map((m) => m.content.text).join("\n");
    expect(text).toMatch(/passphrase/i);
    expect(text).toMatch(/optional/i);
  });

  it("guides the agent toward calling create_secret", () => {
    const result = shareSecretPrompt();
    const text = result.messages.map((m) => m.content.text).join("\n");
    expect(text).toContain("create_secret");
  });
});
