import { successResult, errorResult } from "./errors.js";

describe("successResult", () => {
  it("wraps data in MCP text content format with success: true", () => {
    const result = successResult({ url: "https://vaulted.fyi/s/abc" }, "Secret created");

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ url: "https://vaulted.fyi/s/abc" });
  });

  it("includes the message field", () => {
    const result = successResult({ id: "123" }, "Done");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.message).toBe("Done");
  });

  it("does not set isError", () => {
    const result = successResult({}, "ok");
    expect(result.isError).toBeUndefined();
  });

  it("produces parseable JSON with correct shape", () => {
    const result = successResult({ key: "value" }, "msg");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      success: true,
      data: { key: "value" },
      message: "msg",
    });
  });
});

describe("errorResult", () => {
  it("wraps error in MCP text content format with isError: true", () => {
    const result = errorResult("API_UNREACHABLE", "Cannot reach API", "Check connection");

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
  });

  it("includes code, message, and suggestion fields", () => {
    const result = errorResult("INVALID_INPUT", "Bad input", "Fix it");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(parsed.error.message).toBe("Bad input");
    expect(parsed.error.suggestion).toBe("Fix it");
  });

  it("produces parseable JSON with correct shape", () => {
    const result = errorResult("SECRET_EXPIRED", "Expired", "Create a new one");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      success: false,
      error: {
        code: "SECRET_EXPIRED",
        message: "Expired",
        suggestion: "Create a new one",
      },
    });
  });
});
