vi.mock("../config.js", () => ({
  config: { baseUrl: "https://test.vaulted.fyi", allowedDirs: [] },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { checkStatusHandler } = await import("./check-status.js");

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

describe("check_status against the creator token route", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("calls GET /api/status/{id}/{token} without putting the token in a query string", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { views: [], maxViews: 1, burned: false, createdAt: 1 }),
    );

    await checkStatusHandler({ secret_id: "abc123", status_token: "tok456" });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://test.vaulted.fyi/api/status/abc123/tok456");
    expect(new URL(url).search).toBe("");
    expect(init).toEqual(expect.objectContaining({ method: "GET" }));
  });

  it("percent-encodes the id and token as path segments", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { views: [], maxViews: 1, burned: false, createdAt: 1 }),
    );

    await checkStatusHandler({ secret_id: "a/b", status_token: "t?k#/x" });

    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://test.vaulted.fyi/api/status/a%2Fb/t%3Fk%23%2Fx",
    );
  });

  it("200 → maps the view log to a view count and reports an active secret", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        views: [
          { at: 1700000000, country: "US" },
          { at: 1700000100, country: "DE" },
        ],
        maxViews: 5,
        burned: false,
        createdAt: 1699999999,
      }),
    );

    const result = await checkStatusHandler({ secret_id: "abc123", status_token: "tok456" });
    const parsed = parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ views: 2, maxViews: 5, status: "active", expiresAt: null });
  });

  it("200 with burned: true → reports the secret as destroyed", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        views: [{ at: 1700000000, country: "US" }],
        maxViews: 1,
        burned: true,
        createdAt: 1699999999,
      }),
    );

    const parsed = parse(await checkStatusHandler({ secret_id: "abc", status_token: "tok" }));

    expect(parsed.data.status).toBe("destroyed");
    expect(parsed.data.views).toBe(1);
  });

  it("403 → returns INVALID_STATUS_TOKEN", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(403, { error: "Forbidden" }));

    const result = await checkStatusHandler({ secret_id: "abc123", status_token: "wrong" });
    const parsed = parse(result);

    expect(result.isError).toBe(true);
    expect(parsed.error.code).toBe("INVALID_STATUS_TOKEN");
  });

  it("404 → returns SECRET_EXPIRED", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, { error: "Not found" }));

    const result = await checkStatusHandler({ secret_id: "gone", status_token: "tok" });

    expect(result.isError).toBe(true);
    expect(parse(result).error.code).toBe("SECRET_EXPIRED");
  });

  it("accepts the web app's status page URL (/status/{id}/{token})", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { views: [], maxViews: 3, burned: false, createdAt: 1 }),
    );

    const result = await checkStatusHandler({
      url: "https://vaulted.fyi/status/abc123/tok456",
    });

    expect(parse(result).success).toBe(true);
    expect(mockFetch.mock.calls[0][0]).toBe("https://test.vaulted.fyi/api/status/abc123/tok456");
  });

  it("still accepts legacy /s/{id}/status?token= URLs from existing history", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { views: [], maxViews: 3, burned: false, createdAt: 1 }),
    );

    await checkStatusHandler({ url: "https://vaulted.fyi/s/abc123/status?token=tok456" });

    expect(mockFetch.mock.calls[0][0]).toBe("https://test.vaulted.fyi/api/status/abc123/tok456");
  });
});
