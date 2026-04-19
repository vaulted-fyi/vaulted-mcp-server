const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("./config.js", () => ({
  config: { baseUrl: "https://test.vaulted.fyi", allowedDirs: [] },
}));

const { createSecret, retrieveSecret, ApiError } = await import("./api-client.js");

const validParams = {
  ciphertext: "encrypted-data",
  iv: "init-vector",
  maxViews: 3,
  ttl: 86400,
  hasPassphrase: false,
};

describe("createSecret", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns { id, statusToken } on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "abc123", statusToken: "tok456" }),
    });

    const result = await createSecret(validParams);
    expect(result).toEqual({ id: "abc123", statusToken: "tok456" });
  });

  it("sends correct POST body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "x", statusToken: "y" }),
    });

    await createSecret(validParams);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(validParams),
      }),
    );
  });

  it("sends Content-Type: application/json header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "x", statusToken: "y" }),
    });

    await createSecret(validParams);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("uses config.baseUrl for the URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "x", statusToken: "y" }),
    });

    await createSecret(validParams);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.vaulted.fyi/api/secrets",
      expect.any(Object),
    );
  });

  it("throws ApiError with API_UNREACHABLE on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    try {
      await createSecret(validParams);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).code).toBe("API_UNREACHABLE");
      expect((err as InstanceType<typeof ApiError>).status).toBe(0);
    }
  });

  it("throws ApiError with status on 400 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "ciphertext is required" }),
    });

    try {
      await createSecret(validParams);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(400);
      expect((err as InstanceType<typeof ApiError>).code).toBe("INVALID_INPUT");
      expect((err as InstanceType<typeof ApiError>).body).toEqual({
        error: "ciphertext is required",
      });
    }
  });

  it("throws ApiError with status on 500 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: "internal server error" }),
    });

    try {
      await createSecret(validParams);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(500);
      expect((err as InstanceType<typeof ApiError>).code).toBe("API_UNREACHABLE");
      expect((err as InstanceType<typeof ApiError>).body).toEqual({
        error: "internal server error",
      });
    }
  });

  it("captures plain-text error bodies on non-JSON responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    });

    try {
      await createSecret(validParams);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(502);
      expect((err as InstanceType<typeof ApiError>).code).toBe("API_UNREACHABLE");
      expect((err as InstanceType<typeof ApiError>).body).toBe("bad gateway");
    }
  });

  it("fetches exactly ${config.baseUrl}/api/secrets", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "x", statusToken: "y" }),
    });

    await createSecret(validParams);

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toBe("https://test.vaulted.fyi/api/secrets");
  });
});

describe("retrieveSecret", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns { ciphertext, iv, hasPassphrase, viewsRemaining } on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ciphertext: "encrypted-data",
        iv: "init-vector",
        hasPassphrase: true,
        viewsRemaining: 2,
      }),
    });

    const result = await retrieveSecret("abc123");
    expect(result).toEqual({
      ciphertext: "encrypted-data",
      iv: "init-vector",
      hasPassphrase: true,
      viewsRemaining: 2,
    });
  });

  it("calls GET {config.baseUrl}/api/secrets/{id}", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ciphertext: "x",
        iv: "y",
        hasPassphrase: false,
        viewsRemaining: 1,
      }),
    });

    await retrieveSecret("abc123");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.vaulted.fyi/api/secrets/abc123",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws ApiError with status 404 and SECRET_NOT_FOUND on 404 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "Secret not found or expired" }),
    });

    try {
      await retrieveSecret("gone123");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(404);
      expect((err as InstanceType<typeof ApiError>).code).toBe("SECRET_NOT_FOUND");
    }
  });

  it("throws ApiError with API_UNREACHABLE on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    try {
      await retrieveSecret("abc123");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).code).toBe("API_UNREACHABLE");
      expect((err as InstanceType<typeof ApiError>).status).toBe(0);
    }
  });

  it("throws ApiError with status 500 and API_UNREACHABLE on 500 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal server error" }),
    });

    try {
      await retrieveSecret("abc123");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(500);
      expect((err as InstanceType<typeof ApiError>).code).toBe("API_UNREACHABLE");
    }
  });

  it("throws ApiError with API_ERROR on 400-range non-404 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: "rate limited" }),
    });

    try {
      await retrieveSecret("abc123");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(429);
      expect((err as InstanceType<typeof ApiError>).code).toBe("API_ERROR");
    }
  });

  it("fetches exactly ${config.baseUrl}/api/secrets/${id}", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ciphertext: "x",
        iv: "y",
        hasPassphrase: false,
        viewsRemaining: 1,
      }),
    });

    await retrieveSecret("my-secret-id");

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toBe("https://test.vaulted.fyi/api/secrets/my-secret-id");
  });
});

describe("checkSecretStatus", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns { views, maxViews, status, expiresAt } on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        views: [
          { at: 1700000000, country: "US" },
          { at: 1700000001, country: "DE" },
        ],
        maxViews: 5,
        burned: false,
        createdAt: 1699999999,
      }),
    });

    const { checkSecretStatus } = await import("./api-client.js");
    const result = await checkSecretStatus("abc123", "tok456");
    expect(result).toEqual({
      views: 2,
      maxViews: 5,
      status: "active",
      expiresAt: null,
    });
  });

  it("calls GET {config.baseUrl}/api/secrets/{id}/status?token={token}", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ views: [], maxViews: 1, burned: false, createdAt: 0 }),
    });

    const { checkSecretStatus } = await import("./api-client.js");
    await checkSecretStatus("abc123", "mytoken");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.vaulted.fyi/api/secrets/abc123/status?token=mytoken",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns status: 'destroyed' when burned is true", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        views: [{ at: 1700000000, country: "US" }],
        maxViews: 1,
        burned: true,
        createdAt: 1699999999,
      }),
    });

    const { checkSecretStatus } = await import("./api-client.js");
    const result = await checkSecretStatus("abc123", "tok");
    expect(result.status).toBe("destroyed");
    expect(result.views).toBe(1);
  });

  it("throws ApiError with SECRET_EXPIRED on 404 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "Secret not found or expired" }),
    });

    const { checkSecretStatus, ApiError } = await import("./api-client.js");
    try {
      await checkSecretStatus("gone123", "tok");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(404);
      expect((err as InstanceType<typeof ApiError>).code).toBe("SECRET_EXPIRED");
    }
  });

  it("throws ApiError with API_UNREACHABLE on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    const { checkSecretStatus, ApiError } = await import("./api-client.js");
    try {
      await checkSecretStatus("abc123", "tok");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).code).toBe("API_UNREACHABLE");
      expect((err as InstanceType<typeof ApiError>).status).toBe(0);
    }
  });

  it("throws ApiError with API_UNREACHABLE on 500 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal server error" }),
    });

    const { checkSecretStatus, ApiError } = await import("./api-client.js");
    try {
      await checkSecretStatus("abc123", "tok");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(500);
      expect((err as InstanceType<typeof ApiError>).code).toBe("API_UNREACHABLE");
    }
  });

  it("throws ApiError with API_ERROR on 400-range non-404 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "invalid token" }),
    });

    const { checkSecretStatus, ApiError } = await import("./api-client.js");
    try {
      await checkSecretStatus("abc123", "tok");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(401);
      expect((err as InstanceType<typeof ApiError>).code).toBe("API_ERROR");
    }
  });
});
