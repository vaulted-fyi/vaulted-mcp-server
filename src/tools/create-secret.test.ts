import { handleCreateSecret, EXPIRY_TO_TTL, VALID_MAX_VIEWS } from "./create-secret.js";
import { importKey, decrypt } from "@vaulted/crypto";

vi.mock("../history.js", () => ({
  appendHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../api-client.js", () => ({
  createSecret: vi.fn().mockResolvedValue({ id: "test-id-123", statusToken: "test-token-456" }),
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code: string,
      public readonly body?: unknown,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

vi.mock("../config.js", () => ({
  config: { baseUrl: "https://vaulted.fyi", allowedDirs: [] },
}));

import { createSecret, ApiError } from "../api-client.js";
import { appendHistory } from "../history.js";

function parseResult(result: {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}) {
  return JSON.parse(result.content[0].text);
}

describe("handleCreateSecret", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a secret with defaults (max_views=1, expiry=24h)", async () => {
    const result = await handleCreateSecret({ content: "my-api-key" });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.data.maxViews).toBe(1);
    expect(parsed.data.expiresIn).toBe("24h");
    expect(parsed.data.passphraseProtected).toBe(false);
    expect(parsed.data.url).toMatch(/^https:\/\/vaulted\.fyi\/s\/test-id-123#.+/);
    expect(parsed.data.statusUrl).toBe(
      "https://vaulted.fyi/s/test-id-123/status?token=test-token-456",
    );
    expect(result.isError).toBeUndefined();

    expect(createSecret).toHaveBeenCalledWith({
      ciphertext: expect.any(String),
      iv: expect.any(String),
      maxViews: 1,
      ttl: 86400,
      hasPassphrase: false,
    });
  });

  it("produces ciphertext that can be decrypted back to the original content", async () => {
    const content = "super-secret-api-key-12345";
    const result = await handleCreateSecret({ content });
    const parsed = parseResult(result);

    const fragment = parsed.data.url.split("#")[1];
    const key = await importKey(fragment);

    const apiCallArgs = vi.mocked(createSecret).mock.calls[0][0];
    const plaintext = await decrypt(apiCallArgs.ciphertext, apiCallArgs.iv, key);
    expect(plaintext).toBe(content);
  });

  it("creates a secret with explicit max_views and expiry", async () => {
    const result = await handleCreateSecret({
      content: "secret-data",
      max_views: "5",
      expiry: "7d",
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.data.maxViews).toBe(5);
    expect(parsed.data.expiresIn).toBe("7d");

    expect(createSecret).toHaveBeenCalledWith(
      expect.objectContaining({ maxViews: 5, ttl: 604800 }),
    );
  });

  it("creates a secret with passphrase — fragment is wrappedKey.salt format", async () => {
    const result = await handleCreateSecret({
      content: "secret-data",
      passphrase: "hunter2",
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.data.passphraseProtected).toBe(true);

    const fragment = parsed.data.url.split("#")[1];
    expect(fragment).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    expect(createSecret).toHaveBeenCalledWith(expect.objectContaining({ hasPassphrase: true }));
  });

  it("returns INVALID_INPUT for empty content", async () => {
    const result = await handleCreateSecret({ content: "" });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
    expect(createSecret).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for empty passphrase", async () => {
    const result = await handleCreateSecret({ content: "test", passphrase: "" });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(parsed.error.message).toBe("Passphrase cannot be empty");
    expect(result.isError).toBe(true);
    expect(createSecret).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for content exceeding 1000 characters", async () => {
    const result = await handleCreateSecret({ content: "x".repeat(1001) });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
  });

  it("returns INVALID_INPUT for invalid max_views", async () => {
    for (const invalid of ["2", "7", "100"]) {
      const result = await handleCreateSecret({ content: "test", max_views: invalid });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("INVALID_INPUT");
    }
  });

  it("returns INVALID_INPUT for invalid expiry", async () => {
    for (const invalid of ["5h", "2d", "60d"]) {
      const result = await handleCreateSecret({ content: "test", expiry: invalid });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("INVALID_INPUT");
    }
  });

  it("returns API_UNREACHABLE when createSecret throws a network error", async () => {
    vi.mocked(createSecret).mockRejectedValueOnce(new Error("fetch failed"));

    const result = await handleCreateSecret({ content: "test" });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("API_UNREACHABLE");
    expect(result.isError).toBe(true);
  });

  it("returns INVALID_INPUT with API error details on 400 responses", async () => {
    vi.mocked(createSecret).mockRejectedValueOnce(
      new ApiError("Vaulted API returned 400", 400, "INVALID_INPUT", { error: "Invalid ttl" }),
    );

    const result = await handleCreateSecret({ content: "test", expiry: "1h" });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(parsed.error.message).toBe("Invalid ttl");
    expect(parsed.error.suggestion).toBe(
      "Check content length, max_views, and expiry values, then try again",
    );
    expect(result.isError).toBe(true);
  });

  it("constructs URL with correct base URL, secret ID, and fragment", async () => {
    const result = await handleCreateSecret({ content: "test" });
    const parsed = parseResult(result);

    expect(parsed.data.url).toMatch(/^https:\/\/vaulted\.fyi\/s\/test-id-123#/);
  });

  it("constructs status URL with correct token", async () => {
    const result = await handleCreateSecret({ content: "test" });
    const parsed = parseResult(result);

    expect(parsed.data.statusUrl).toBe(
      "https://vaulted.fyi/s/test-id-123/status?token=test-token-456",
    );
  });

  it("calls appendHistory fire-and-forget after a successful create", async () => {
    const mockAppend = vi.mocked(appendHistory);
    mockAppend.mockClear();

    await handleCreateSecret({ content: "test", max_views: "3", expiry: "7d", label: "my-key" });

    // fire-and-forget: may not have resolved yet, but was called
    await Promise.resolve(); // flush microtasks
    expect(mockAppend).toHaveBeenCalledOnce();
    const call = mockAppend.mock.calls[0][0];
    expect(call.id).toBe("test-id-123");
    expect(call.statusToken).toBe("test-token-456");
    expect(call.maxViews).toBe(3);
    expect(call.expiry).toBe("7d");
    expect(call.label).toBe("my-key");
    expect(call).not.toHaveProperty("content");
    expect(call).not.toHaveProperty("encryptionKey");
  });

  it("does NOT call appendHistory when create fails", async () => {
    vi.mocked(createSecret).mockRejectedValueOnce(new Error("network error"));
    const mockAppend = vi.mocked(appendHistory);
    mockAppend.mockClear();

    await handleCreateSecret({ content: "test" });

    await Promise.resolve();
    expect(mockAppend).not.toHaveBeenCalled();
  });
});

describe("constants", () => {
  it("EXPIRY_TO_TTL maps all 9 expiry values", () => {
    expect(Object.keys(EXPIRY_TO_TTL)).toHaveLength(9);
    expect(EXPIRY_TO_TTL["24h"]).toBe(86400);
    expect(EXPIRY_TO_TTL["30d"]).toBe(2592000);
  });

  it("VALID_MAX_VIEWS contains exactly [1, 3, 5, 10]", () => {
    expect([...VALID_MAX_VIEWS]).toEqual([1, 3, 5, 10]);
  });
});
