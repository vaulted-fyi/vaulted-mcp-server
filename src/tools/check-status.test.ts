vi.mock("../api-client.js", () => ({
  checkSecretStatus: vi.fn(),
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

const { checkSecretStatus } = await import("../api-client.js");
const { checkStatusHandler } = await import("./check-status.js");

const mockCheckSecretStatus = vi.mocked(checkSecretStatus);

const successData = {
  views: 2,
  maxViews: 5,
  status: "active" as const,
  expiresAt: null,
};

describe("checkStatusHandler", () => {
  beforeEach(() => {
    mockCheckSecretStatus.mockReset();
  });

  it("success via status URL — extracts id and token, returns structured response", async () => {
    mockCheckSecretStatus.mockResolvedValueOnce(successData);

    const result = await checkStatusHandler({
      url: "https://vaulted.fyi/s/abc123/status?token=tok456",
    });

    expect(mockCheckSecretStatus).toHaveBeenCalledWith("abc123", "tok456");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.views).toBe(2);
    expect(parsed.data.maxViews).toBe(5);
    expect(parsed.data.status).toBe("active");
    expect("expiresAt" in parsed.data).toBe(true);
    expect(parsed.message).toContain("2");
    expect(parsed.message).toContain("5");
  });

  it("success via api URL pattern — extracts id and token from /api/secrets/{id}/status", async () => {
    mockCheckSecretStatus.mockResolvedValueOnce(successData);

    const result = await checkStatusHandler({
      url: "https://vaulted.fyi/api/secrets/xyz789/status?token=hmactoken",
    });

    expect(mockCheckSecretStatus).toHaveBeenCalledWith("xyz789", "hmactoken");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it("success via secret_id + status_token params", async () => {
    mockCheckSecretStatus.mockResolvedValueOnce(successData);

    const result = await checkStatusHandler({
      secret_id: "myid",
      status_token: "mytoken",
    });

    expect(mockCheckSecretStatus).toHaveBeenCalledWith("myid", "mytoken");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.status).toBe("active");
  });

  it("404 → returns SECRET_EXPIRED error with correct suggestion", async () => {
    const { ApiError } = await import("../api-client.js");
    mockCheckSecretStatus.mockRejectedValueOnce(
      new (ApiError as new (m: string, s: number, c: string) => Error)(
        "Secret not found or expired",
        404,
        "SECRET_EXPIRED",
      ),
    );

    const result = await checkStatusHandler({
      secret_id: "gone",
      status_token: "tok",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("SECRET_EXPIRED");
    expect(parsed.error.suggestion).toContain("no longer exists");
    expect(result.isError).toBe(true);
  });

  it("network failure → returns API_UNREACHABLE error", async () => {
    const { ApiError } = await import("../api-client.js");
    mockCheckSecretStatus.mockRejectedValueOnce(
      new (ApiError as new (m: string, s: number, c: string) => Error)(
        "Unable to reach the Vaulted API",
        0,
        "API_UNREACHABLE",
      ),
    );

    const result = await checkStatusHandler({
      secret_id: "abc",
      status_token: "tok",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("API_UNREACHABLE");
    expect(result.isError).toBe(true);
  });

  it("missing params (no url, no id+token) → returns INVALID_INPUT error", async () => {
    const result = await checkStatusHandler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
    expect(mockCheckSecretStatus).not.toHaveBeenCalled();
  });

  it("invalid URL string returns INVALID_INPUT", async () => {
    const result = await checkStatusHandler({
      url: "not-a-url",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
    expect(mockCheckSecretStatus).not.toHaveBeenCalled();
  });

  it("non-status URL path returns INVALID_INPUT", async () => {
    const result = await checkStatusHandler({
      url: "https://vaulted.fyi/s/abc123?token=tok456",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
    expect(mockCheckSecretStatus).not.toHaveBeenCalled();
  });

  it("status URL with missing token returns INVALID_INPUT", async () => {
    const result = await checkStatusHandler({
      url: "https://vaulted.fyi/s/abc123/status",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
    expect(mockCheckSecretStatus).not.toHaveBeenCalled();
  });

  it("secret_id with empty status_token returns INVALID_INPUT", async () => {
    const result = await checkStatusHandler({
      secret_id: "abc123",
      status_token: "   ",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
    expect(mockCheckSecretStatus).not.toHaveBeenCalled();
  });

  describe("message variants", () => {
    it("active with views < maxViews — still active message", async () => {
      mockCheckSecretStatus.mockResolvedValueOnce({
        views: 2,
        maxViews: 5,
        status: "active" as const,
        expiresAt: null,
      });

      const result = await checkStatusHandler({ secret_id: "id", status_token: "tok" });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.message).toContain("2/5");
      expect(parsed.message).toContain("Still active");
      expect(parsed.message).toContain("Check again later");
    });

    it("active with views == maxViews — fully consumed message", async () => {
      mockCheckSecretStatus.mockResolvedValueOnce({
        views: 3,
        maxViews: 3,
        status: "active" as const,
        expiresAt: null,
      });

      const result = await checkStatusHandler({ secret_id: "id", status_token: "tok" });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.message).toContain("fully consumed");
    });

    it("destroyed with views == 0 — expired before viewed message", async () => {
      mockCheckSecretStatus.mockResolvedValueOnce({
        views: 0,
        maxViews: 1,
        status: "destroyed" as const,
        expiresAt: "2026-01-01T00:00:00Z",
      });

      const result = await checkStatusHandler({ secret_id: "id", status_token: "tok" });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.message).toContain("expired before being viewed");
    });

    it("destroyed with views > 0 — fully consumed message", async () => {
      mockCheckSecretStatus.mockResolvedValueOnce({
        views: 1,
        maxViews: 1,
        status: "destroyed" as const,
        expiresAt: null,
      });

      const result = await checkStatusHandler({ secret_id: "id", status_token: "tok" });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.message).toContain("fully consumed");
    });
  });

  describe("previousViews delta", () => {
    it("previousViews=0, data.views=1 — includes new view detected message", async () => {
      mockCheckSecretStatus.mockResolvedValueOnce({
        views: 1,
        maxViews: 3,
        status: "active" as const,
        expiresAt: null,
      });

      const result = await checkStatusHandler({
        secret_id: "id",
        status_token: "tok",
        previousViews: 0,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.message).toContain("New view detected");
      expect(parsed.message).toContain("0");
      expect(parsed.message).toContain("1");
    });

    it("previousViews=1, data.views=1 — no delta message", async () => {
      mockCheckSecretStatus.mockResolvedValueOnce({
        views: 1,
        maxViews: 3,
        status: "active" as const,
        expiresAt: null,
      });

      const result = await checkStatusHandler({
        secret_id: "id",
        status_token: "tok",
        previousViews: 1,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.message).not.toContain("New view detected");
    });
  });
});
