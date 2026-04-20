vi.mock("../history.js", () => ({
  readHistory: vi.fn(),
}));

vi.mock("../api-client.js", () => ({
  checkSecretStatus: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

vi.mock("../config.js", () => ({
  config: { baseUrl: "https://vaulted.fyi", allowedDirs: [], historyFile: "/tmp/test.json" },
}));

const { readHistory } = await import("../history.js");
const { checkSecretStatus, ApiError } = await import("../api-client.js");
const { listSecretsHandler } = await import("./list-secrets.js");

const mockReadHistory = vi.mocked(readHistory);
const mockCheckSecretStatus = vi.mocked(checkSecretStatus);

const entry1 = {
  id: "id1",
  statusToken: "tok1",
  createdAt: "2026-04-18T08:00:00Z",
  maxViews: 3,
  expiry: "24h",
  label: "stripe-key",
};

const entry2 = {
  id: "id2",
  statusToken: "tok2",
  createdAt: "2026-04-19T10:00:00Z",
  maxViews: 1,
  expiry: "7d",
};

describe("listSecretsHandler", () => {
  beforeEach(() => {
    mockReadHistory.mockReset();
    mockCheckSecretStatus.mockReset();
  });

  it("returns empty list message when no history", async () => {
    mockReadHistory.mockResolvedValueOnce([]);

    const result = await listSecretsHandler();
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual([]);
    expect(parsed.message).toContain("No secrets shared yet");
    expect(parsed.message).toContain("create_secret");
  });

  it("returns enriched entries with live status, sorted newest-first", async () => {
    mockReadHistory.mockResolvedValueOnce([entry1, entry2]);
    mockCheckSecretStatus
      .mockResolvedValueOnce({ views: 0, maxViews: 1, status: "active", expiresAt: null })
      .mockResolvedValueOnce({ views: 1, maxViews: 3, status: "active", expiresAt: null });

    const result = await listSecretsHandler();
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveLength(2);

    // entry2 (newer) should be first
    expect(parsed.data[0].id).toBe("id2");
    expect(parsed.data[0].views).toBe(0);
    expect(parsed.data[0].status).toBe("active");

    // entry1 (older) should be second
    expect(parsed.data[1].id).toBe("id1");
    expect(parsed.data[1].label).toBe("stripe-key");
    expect(parsed.data[1].views).toBe(1);
  });

  it("marks entries as unknown when live status checks fail transiently", async () => {
    mockReadHistory.mockResolvedValueOnce([entry1, entry2]);
    // sorted newest-first: entry2 (Apr 19) → entry1 (Apr 18)
    mockCheckSecretStatus
      .mockResolvedValueOnce({ views: 2, maxViews: 3, status: "active", expiresAt: null }) // entry2
      .mockRejectedValueOnce(new Error("network error")); // entry1

    const result = await listSecretsHandler();
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveLength(2);

    const unknownEntry = parsed.data.find((e: { id: string }) => e.id === "id1");
    expect(unknownEntry.status).toBe("unknown");
    expect(unknownEntry.statusError).toBe("API_ERROR");
  });

  it("marks entries as destroyed when the API says the secret is gone", async () => {
    mockReadHistory.mockResolvedValueOnce([entry1]);
    mockCheckSecretStatus.mockRejectedValueOnce(
      new ApiError("Secret not found or expired", 404, "SECRET_EXPIRED"),
    );

    const result = await listSecretsHandler();
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.data[0].status).toBe("destroyed");
    expect(parsed.data[0].statusError).toBeUndefined();
  });

  it("includes all original entry fields in enriched output", async () => {
    mockReadHistory.mockResolvedValueOnce([entry1]);
    mockCheckSecretStatus.mockResolvedValueOnce({
      views: 2,
      maxViews: 3,
      status: "active",
      expiresAt: null,
    });

    const result = await listSecretsHandler();
    const parsed = JSON.parse(result.content[0].text);
    const item = parsed.data[0];

    expect(item.id).toBe("id1");
    expect(item.statusToken).toBe("tok1");
    expect(item.createdAt).toBe("2026-04-18T08:00:00Z");
    expect(item.maxViews).toBe(3);
    expect(item.expiry).toBe("24h");
    expect(item.label).toBe("stripe-key");
  });

  it("message includes entry count when history is non-empty", async () => {
    mockReadHistory.mockResolvedValueOnce([entry1, entry2]);
    mockCheckSecretStatus.mockResolvedValue({
      views: 0,
      maxViews: 1,
      status: "active",
      expiresAt: null,
    });

    const result = await listSecretsHandler();
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.message).toContain("2");
  });
});
