const {
  mockOpen,
  mockImportKey,
  mockDecrypt,
  mockUnwrapKeyWithPassphrase,
  mockRetrieveSecret,
  mockCopyToClipboard,
  mockWriteFile,
} = vi.hoisted(() => ({
  mockOpen: vi.fn(),
  mockImportKey: vi.fn(),
  mockDecrypt: vi.fn(),
  mockUnwrapKeyWithPassphrase: vi.fn(),
  mockRetrieveSecret: vi.fn(),
  mockCopyToClipboard: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock("open", () => ({ default: mockOpen }));

vi.mock("@vaulted/crypto", () => ({
  importKey: mockImportKey,
  decrypt: mockDecrypt,
  unwrapKeyWithPassphrase: mockUnwrapKeyWithPassphrase,
}));

vi.mock("../api-client.js", () => ({
  retrieveSecret: mockRetrieveSecret,
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

vi.mock("../clipboard.js", () => ({
  copyToClipboard: mockCopyToClipboard,
}));

vi.mock("node:fs/promises", () => ({
  writeFile: mockWriteFile,
}));

vi.mock("../config.js", () => ({
  config: { baseUrl: "https://vaulted.fyi", allowedDirs: [] },
}));

const { handleViewSecret } = await import("./view-secret.js");
const { ApiError } = await import("../api-client.js");

function parseResult(result: {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}) {
  return JSON.parse(result.content[0].text);
}

describe("handleViewSecret — browser mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens full URL including fragment in browser and returns success", async () => {
    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc123#key-fragment",
    });
    const parsed = parseResult(result);

    expect(mockOpen).toHaveBeenCalledWith("https://vaulted.fyi/s/abc123#key-fragment");
    expect(parsed.success).toBe(true);
    expect(parsed.data.mode).toBe("browser");
    expect(parsed.message).toContain("browser");
    expect(result.isError).toBeUndefined();
  });

  it("uses browser mode by default when output_mode is omitted", async () => {
    await handleViewSecret({ url: "https://vaulted.fyi/s/abc#k" });
    expect(mockOpen).toHaveBeenCalledOnce();
    expect(mockRetrieveSecret).not.toHaveBeenCalled();
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it("reconstructs URL from secret_id + encryption_key when url not provided", async () => {
    await handleViewSecret({
      secret_id: "my-id",
      encryption_key: "my-key",
      output_mode: "browser",
    });
    expect(mockOpen).toHaveBeenCalledWith("https://vaulted.fyi/s/my-id#my-key");
  });

  it("does NOT call retrieveSecret or decrypt in browser mode", async () => {
    await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#k",
      output_mode: "browser",
    });
    expect(mockRetrieveSecret).not.toHaveBeenCalled();
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(mockImportKey).not.toHaveBeenCalled();
  });
});

describe("handleViewSecret — direct mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches ciphertext, decrypts, and returns plaintext with redaction marker", async () => {
    mockRetrieveSecret.mockResolvedValueOnce({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: false,
      viewsRemaining: 1,
    });
    mockImportKey.mockResolvedValueOnce("crypto-key");
    mockDecrypt.mockResolvedValueOnce("the-plaintext");

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#mykey",
      output_mode: "direct",
    });
    const parsed = parseResult(result);

    expect(mockRetrieveSecret).toHaveBeenCalledWith("abc");
    expect(mockImportKey).toHaveBeenCalledWith("mykey");
    expect(mockDecrypt).toHaveBeenCalledWith("ct", "iv", "crypto-key");
    expect(parsed.success).toBe(true);
    expect(parsed.data.mode).toBe("direct");
    expect(parsed.data.content).toBe("the-plaintext");
    expect(parsed.data.sensitive).toBe(true);
  });

  it("uses secret_id + encryption_key in direct mode (skips URL parsing)", async () => {
    mockRetrieveSecret.mockResolvedValueOnce({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: false,
      viewsRemaining: 1,
    });
    mockImportKey.mockResolvedValueOnce("ck");
    mockDecrypt.mockResolvedValueOnce("plain");

    const result = await handleViewSecret({
      secret_id: "sid",
      encryption_key: "ekey",
      output_mode: "direct",
    });
    const parsed = parseResult(result);

    expect(mockRetrieveSecret).toHaveBeenCalledWith("sid");
    expect(mockImportKey).toHaveBeenCalledWith("ekey");
    expect(parsed.success).toBe(true);
    expect(parsed.data.content).toBe("plain");
  });

  it("returns PASSPHRASE_REQUIRED when hasPassphrase=true and no passphrase provided", async () => {
    mockRetrieveSecret.mockResolvedValueOnce({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: true,
      viewsRemaining: 1,
    });

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#wrapped.salt",
      output_mode: "direct",
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("PASSPHRASE_REQUIRED");
    expect(result.isError).toBe(true);
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it("unwraps passphrase-wrapped key and decrypts when passphrase provided", async () => {
    mockRetrieveSecret.mockResolvedValueOnce({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: true,
      viewsRemaining: 1,
    });
    mockUnwrapKeyWithPassphrase.mockResolvedValueOnce("unwrapped-ck");
    mockDecrypt.mockResolvedValueOnce("plain-text");

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#wrapped.salt",
      output_mode: "direct",
      passphrase: "hunter2",
    });
    const parsed = parseResult(result);

    expect(mockUnwrapKeyWithPassphrase).toHaveBeenCalledWith("wrapped", "salt", "hunter2");
    expect(mockDecrypt).toHaveBeenCalledWith("ct", "iv", "unwrapped-ck");
    expect(parsed.success).toBe(true);
    expect(parsed.data.content).toBe("plain-text");
  });

  it("maps API 404 to SECRET_EXPIRED", async () => {
    mockRetrieveSecret.mockRejectedValueOnce(new ApiError("not found", 404, "SECRET_NOT_FOUND"));

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#k",
      output_mode: "direct",
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("SECRET_EXPIRED");
    expect(result.isError).toBe(true);
  });

  it("maps API network error to API_UNREACHABLE", async () => {
    mockRetrieveSecret.mockRejectedValueOnce(new ApiError("unreachable", 0, "API_UNREACHABLE"));

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#k",
      output_mode: "direct",
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("API_UNREACHABLE");
  });

  it("maps crypto decryption failure to ENCRYPTION_FAILED", async () => {
    mockRetrieveSecret.mockResolvedValueOnce({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: false,
      viewsRemaining: 1,
    });
    mockImportKey.mockResolvedValueOnce("ck");
    mockDecrypt.mockRejectedValueOnce(new Error("bad tag"));

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#k",
      output_mode: "direct",
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("ENCRYPTION_FAILED");
  });
});

describe("handleViewSecret — browser mode error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns friendly INVALID_INPUT when open() throws", async () => {
    mockOpen.mockRejectedValueOnce(new Error("no display"));

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#k",
      output_mode: "browser",
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(parsed.error.message.toLowerCase()).toContain("browser");
    expect(result.isError).toBe(true);
  });
});

describe("handleViewSecret — direct mode extra guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns INVALID_INPUT when passphrase secret fragment is missing the dot separator", async () => {
    mockRetrieveSecret.mockResolvedValueOnce({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: true,
      viewsRemaining: 1,
    });

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#no-dot-here",
      output_mode: "direct",
      passphrase: "pw",
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(parsed.error.message.toLowerCase()).toContain("malformed");
    expect(mockUnwrapKeyWithPassphrase).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT when passphrase secret fragment has empty salt half", async () => {
    mockRetrieveSecret.mockResolvedValueOnce({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: true,
      viewsRemaining: 1,
    });

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#wrapped.",
      output_mode: "direct",
      passphrase: "pw",
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(mockUnwrapKeyWithPassphrase).not.toHaveBeenCalled();
  });

  it("maps non-ApiError retrieveSecret failures to API_ERROR (not API_UNREACHABLE)", async () => {
    mockRetrieveSecret.mockRejectedValueOnce(new TypeError("programming bug"));

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#k",
      output_mode: "direct",
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("API_ERROR");
  });

  it("ENCRYPTION_FAILED message warns that a view may have been consumed", async () => {
    mockRetrieveSecret.mockResolvedValueOnce({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: false,
      viewsRemaining: 1,
    });
    mockImportKey.mockResolvedValueOnce("ck");
    mockDecrypt.mockRejectedValueOnce(new Error("bad tag"));

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#k",
      output_mode: "direct",
    });
    const parsed = parseResult(result);

    expect(parsed.error.message.toLowerCase()).toContain("consumed");
  });
});

describe("handleViewSecret — input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns INVALID_INPUT when neither url nor secret_id/encryption_key provided", async () => {
    const result = await handleViewSecret({});
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
  });

  it("returns INVALID_INPUT when secret_id provided without encryption_key", async () => {
    const result = await handleViewSecret({ secret_id: "only-id" });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when URL is malformed", async () => {
    const result = await handleViewSecret({ url: "not-a-url" });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when output_mode='file' and file_path is missing", async () => {
    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#k",
      output_mode: "file",
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(parsed.error.message.toLowerCase()).toContain("file_path");
    expect(mockRetrieveSecret).not.toHaveBeenCalled();
  });
});

describe("handleViewSecret — clipboard mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRetrieveSecret.mockResolvedValue({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: false,
      viewsRemaining: 2,
    });
    mockImportKey.mockResolvedValue("ck");
    mockDecrypt.mockResolvedValue("clipboard-plaintext");
  });

  it("decrypts and pipes plaintext to copyToClipboard; response omits content", async () => {
    mockCopyToClipboard.mockResolvedValueOnce(undefined);

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#mykey",
      output_mode: "clipboard",
    });
    const parsed = parseResult(result);

    expect(mockCopyToClipboard).toHaveBeenCalledWith("clipboard-plaintext");
    expect(parsed.success).toBe(true);
    expect(parsed.data.mode).toBe("clipboard");
    expect(parsed.data.viewsRemaining).toBe(2);
    expect(result.content[0].text).not.toContain("clipboard-plaintext");
  });

  it("returns INVALID_INPUT with suggestion when clipboard copy fails", async () => {
    mockCopyToClipboard.mockRejectedValueOnce(new Error("no xclip installed"));

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#mykey",
      output_mode: "clipboard",
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(parsed.error.suggestion.toLowerCase()).toMatch(/browser|direct|file/);
    expect(result.isError).toBe(true);
  });

  it("forwards passphrase to unwrapKeyWithPassphrase for passphrase-protected secrets", async () => {
    mockRetrieveSecret.mockResolvedValueOnce({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: true,
      viewsRemaining: 1,
    });
    mockUnwrapKeyWithPassphrase.mockResolvedValueOnce("unwrapped");
    mockDecrypt.mockResolvedValueOnce("secret-w-passphrase");
    mockCopyToClipboard.mockResolvedValueOnce(undefined);

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#wrapped.salt",
      output_mode: "clipboard",
      passphrase: "pw",
    });
    const parsed = parseResult(result);

    expect(mockUnwrapKeyWithPassphrase).toHaveBeenCalledWith("wrapped", "salt", "pw");
    expect(mockCopyToClipboard).toHaveBeenCalledWith("secret-w-passphrase");
    expect(parsed.success).toBe(true);
    expect(result.content[0].text).not.toContain("secret-w-passphrase");
  });
});

describe("handleViewSecret — file mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRetrieveSecret.mockResolvedValue({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: false,
      viewsRemaining: 3,
    });
    mockImportKey.mockResolvedValue("ck");
    mockDecrypt.mockResolvedValue("file-plaintext");
  });

  it("writes plaintext to file_path via node:fs/promises writeFile; response omits content", async () => {
    mockWriteFile.mockResolvedValueOnce(undefined);

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#mykey",
      output_mode: "file",
      file_path: "/tmp/secret.txt",
    });
    const parsed = parseResult(result);

    expect(mockWriteFile).toHaveBeenCalledWith("/tmp/secret.txt", "file-plaintext", "utf-8");
    expect(parsed.success).toBe(true);
    expect(parsed.data.mode).toBe("file");
    expect(parsed.data.filePath).toBe("/tmp/secret.txt");
    expect(parsed.message).toContain("/tmp/secret.txt");
    expect(result.content[0].text).not.toContain("file-plaintext");
  });

  it("returns FILE_READ_ERROR when writeFile fails", async () => {
    mockWriteFile.mockRejectedValueOnce(new Error("EACCES: permission denied"));

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#mykey",
      output_mode: "file",
      file_path: "/root/locked.txt",
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("FILE_READ_ERROR");
    expect(parsed.error.message).toContain("/root/locked.txt");
    expect(result.isError).toBe(true);
  });

  it("forwards passphrase for passphrase-protected file-mode secrets", async () => {
    mockRetrieveSecret.mockResolvedValueOnce({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: true,
      viewsRemaining: 1,
    });
    mockUnwrapKeyWithPassphrase.mockResolvedValueOnce("unwrapped");
    mockDecrypt.mockResolvedValueOnce("pf-payload");
    mockWriteFile.mockResolvedValueOnce(undefined);

    await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#wrapped.salt",
      output_mode: "file",
      file_path: "/tmp/out.txt",
      passphrase: "pw",
    });

    expect(mockUnwrapKeyWithPassphrase).toHaveBeenCalledWith("wrapped", "salt", "pw");
    expect(mockWriteFile).toHaveBeenCalledWith("/tmp/out.txt", "pf-payload", "utf-8");
  });

  it("does NOT call writeFile when file_path is missing (validation runs first)", async () => {
    await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#mykey",
      output_mode: "file",
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRetrieveSecret).not.toHaveBeenCalled();
  });
});

describe("handleViewSecret — NFR10 (no secret leakage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT write key or plaintext to stdout/stderr during direct mode", async () => {
    mockRetrieveSecret.mockResolvedValueOnce({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: false,
      viewsRemaining: 1,
    });
    mockImportKey.mockResolvedValueOnce("ck");
    mockDecrypt.mockResolvedValueOnce("the-plaintext-payload");

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await handleViewSecret({
        url: "https://vaulted.fyi/s/abc#super-secret-url-key",
        output_mode: "direct",
      });
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    const stdoutWrites = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const stderrWrites = stderrSpy.mock.calls.map((c) => String(c[0])).join("");

    expect(stdoutWrites).not.toContain("super-secret-url-key");
    expect(stdoutWrites).not.toContain("the-plaintext-payload");
    expect(stderrWrites).not.toContain("super-secret-url-key");
    expect(stderrWrites).not.toContain("the-plaintext-payload");
  });

  it("does NOT include encryption_key in error messages", async () => {
    mockRetrieveSecret.mockRejectedValueOnce(new ApiError("not found", 404, "SECRET_NOT_FOUND"));

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#super-secret-key-xyz",
      output_mode: "direct",
    });
    const rendered = result.content[0].text;
    expect(rendered).not.toContain("super-secret-key-xyz");
  });

  it("does NOT include decrypted content in error messages when decrypt fails", async () => {
    mockRetrieveSecret.mockResolvedValueOnce({
      ciphertext: "ct",
      iv: "iv",
      hasPassphrase: false,
      viewsRemaining: 1,
    });
    mockImportKey.mockResolvedValueOnce("ck");
    mockDecrypt.mockRejectedValueOnce(new Error("plaintext-leak-check"));

    const result = await handleViewSecret({
      url: "https://vaulted.fyi/s/abc#k",
      output_mode: "direct",
    });
    const rendered = result.content[0].text;
    expect(rendered).not.toContain("plaintext-leak-check");
  });
});
