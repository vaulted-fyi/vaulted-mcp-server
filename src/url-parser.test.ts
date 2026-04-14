import { parseVaultedUrl } from "./url-parser.js";

describe("parseVaultedUrl", () => {
  it("extracts id and key from standard URL", () => {
    const result = parseVaultedUrl("https://vaulted.fyi/s/abc123#encryptionKey");
    expect(result).toEqual({ success: true, id: "abc123", key: "encryptionKey" });
  });

  it("extracts id and key from custom base URL (domain-agnostic)", () => {
    const result = parseVaultedUrl("https://custom.vaulted.dev/s/xyz789#mykey");
    expect(result).toEqual({ success: true, id: "xyz789", key: "mykey" });
  });

  it("handles trailing slash in path", () => {
    const result = parseVaultedUrl("https://vaulted.fyi/s/abc123/#key");
    expect(result).toEqual({ success: true, id: "abc123", key: "key" });
  });

  it("returns INVALID_INPUT when fragment is missing", () => {
    const result = parseVaultedUrl("https://vaulted.fyi/s/abc123");
    expect(result).toEqual({
      success: false,
      code: "INVALID_INPUT",
      message: expect.any(String),
      suggestion: expect.stringContaining("#"),
    });
  });

  it("returns INVALID_INPUT when fragment is empty", () => {
    const result = parseVaultedUrl("https://vaulted.fyi/s/abc123#");
    expect(result).toEqual({
      success: false,
      code: "INVALID_INPUT",
      message: expect.any(String),
      suggestion: expect.stringContaining("fragment"),
    });
  });

  it("returns INVALID_INPUT when path has no /s/ segment", () => {
    const result = parseVaultedUrl("https://vaulted.fyi/other/abc123#key");
    expect(result).toEqual({
      success: false,
      code: "INVALID_INPUT",
      message: expect.stringContaining("/s/"),
      suggestion: expect.any(String),
    });
  });

  it("extracts id and key when query parameters are present", () => {
    const result = parseVaultedUrl("https://vaulted.fyi/s/abc123?foo=bar#mykey");
    expect(result).toEqual({ success: true, id: "abc123", key: "mykey" });
  });

  it("returns INVALID_INPUT for malformed URL", () => {
    const result = parseVaultedUrl("not-a-url");
    expect(result).toEqual({
      success: false,
      code: "INVALID_INPUT",
      message: expect.any(String),
      suggestion: expect.stringContaining("https://vaulted.fyi"),
    });
  });
});
