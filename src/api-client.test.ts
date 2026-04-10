const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("./config.js", () => ({
  config: { baseUrl: "https://test.vaulted.fyi", allowedDirs: [] },
}));

const { createSecret, ApiError } = await import("./api-client.js");

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
      json: async () => ({ error: "ciphertext is required" }),
    });

    try {
      await createSecret(validParams);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(400);
      expect((err as InstanceType<typeof ApiError>).body).toEqual({
        error: "ciphertext is required",
      });
    }
  });

  it("throws ApiError with status on 500 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal server error" }),
    });

    try {
      await createSecret(validParams);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(500);
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
