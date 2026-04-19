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

  it("only url provided with no token query param — uses empty token", async () => {
    mockCheckSecretStatus.mockResolvedValueOnce(successData);

    const result = await checkStatusHandler({
      url: "https://vaulted.fyi/s/abc123/status",
    });

    expect(mockCheckSecretStatus).toHaveBeenCalledWith("abc123", "");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });
});
