import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Neutralize top-level stdio connect so importing index.ts doesn't hang
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  return {
    StdioServerTransport: class {
      onclose?: () => void;
      onerror?: (error: Error) => void;
      onmessage?: (message: unknown) => void;
      start() {}
      close() {}
      send() {}
    },
  };
});

vi.mock("./history.js", () => ({
  appendHistory: vi.fn().mockResolvedValue(undefined),
  readHistory: vi.fn().mockResolvedValue([]),
}));

vi.mock("./api-client.js", () => ({
  createSecret: vi.fn().mockResolvedValue({ id: "test-id", statusToken: "test-token" }),
  retrieveSecret: vi.fn(),
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

const mockOpen = vi.hoisted(() => vi.fn());
vi.mock("open", () => ({ default: mockOpen }));

const { mockCopyToClipboard, mockWriteFile } = vi.hoisted(() => ({
  mockCopyToClipboard: vi.fn(),
  mockWriteFile: vi.fn(),
}));
vi.mock("./clipboard.js", () => ({ copyToClipboard: mockCopyToClipboard }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: mockWriteFile };
});

vi.mock("./config.js", () => ({
  config: { baseUrl: "https://vaulted.fyi", allowedDirs: [] },
}));

const { createServer, VERSION } = await import("./index.js");

describe("server instantiation", () => {
  it("creates a server with name 'vaulted' and version from package.json", async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const info = client.getServerVersion();
    expect(info?.name).toBe("vaulted");
    expect(info?.version).toBe(VERSION);

    await client.close();
    await server.close();
  });

  it("exports a version string matching package.json", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("tool registration", () => {
  let client: InstanceType<typeof Client>;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("registers exactly 4 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(4);
  });

  it("registers create_secret, view_secret, check_status, and list_secrets", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["check_status", "create_secret", "list_secrets", "view_secret"]);
  });

  it("has correct annotations for create_secret", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "create_secret");
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
  });

  it("has correct annotations for view_secret", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "view_secret");
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
  });

  it("has correct annotations for check_status", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "check_status");
    expect(tool?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  });
});

describe("check_status integration via MCP client", () => {
  let client: InstanceType<typeof Client>;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("appears in listTools with correct description", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "check_status");
    expect(tool?.description).toContain("Check the status of a previously shared secret");
    expect(tool?.description).toContain("Does not consume a view");
  });

  it("has readOnlyHint: true annotation", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "check_status");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  it("returns structured success response via status URL", async () => {
    const { checkSecretStatus } = await import("./api-client.js");
    vi.mocked(checkSecretStatus).mockResolvedValueOnce({
      views: 1,
      maxViews: 3,
      status: "active",
      expiresAt: null,
    });

    const result = await client.callTool({
      name: "check_status",
      arguments: { url: "https://vaulted.fyi/s/abc123/status?token=mytoken" },
    });

    expect(vi.mocked(checkSecretStatus)).toHaveBeenCalledWith("abc123", "mytoken");

    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.views).toBe(1);
    expect(parsed.data.maxViews).toBe(3);
    expect(parsed.data.status).toBe("active");
  });

  it("returns INVALID_INPUT when called with no params", async () => {
    const result = await client.callTool({
      name: "check_status",
      arguments: {},
    });
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("INVALID_INPUT");
    expect(result.isError).toBe(true);
  });
});

describe("list_secrets integration via MCP client", () => {
  let client: InstanceType<typeof Client>;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("appears in listTools with correct description and annotations", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "list_secrets");
    expect(tool?.description).toContain("List previously shared secrets");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.annotations?.destructiveHint).toBe(false);
    expect(tool?.annotations?.idempotentHint).toBe(true);
  });

  it("returns empty-list message when history is empty", async () => {
    const { readHistory } = await import("./history.js");
    vi.mocked(readHistory).mockResolvedValueOnce([]);

    const result = await client.callTool({ name: "list_secrets", arguments: {} });
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.entries).toEqual([]);
    expect(parsed.data.suggestedAction).toBeUndefined();
    expect(parsed.message).toContain("No secrets shared yet");
  });
});

describe("create_secret integration via MCP client", () => {
  let client: InstanceType<typeof Client>;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("returns structured JSON with success: true and expected data fields", async () => {
    const result = await client.callTool({
      name: "create_secret",
      arguments: { content: "my-secret-api-key" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      url: expect.stringContaining("https://vaulted.fyi/s/"),
      statusUrl: expect.stringContaining("/status?token="),
      expiresIn: "24h",
      maxViews: 1,
      passphraseProtected: false,
    });
    expect(parsed.message).toContain("Secret created successfully");
  });
});

describe("view_secret integration via MCP client", () => {
  let client: InstanceType<typeof Client>;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    mockOpen.mockReset();
    mockOpen.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("appears in listTools with exactly the VIEW_SECRET_DESCRIPTION constant", async () => {
    const { VIEW_SECRET_DESCRIPTION } = await import("./tools/view-secret.js");
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "view_secret");
    expect(tool?.description).toBe(VIEW_SECRET_DESCRIPTION);
  });

  it("executes direct mode via the MCP protocol end-to-end (encrypt → fetch → decrypt)", async () => {
    const { generateKey, exportKey, encrypt } = await import("@vaulted/crypto");
    const { retrieveSecret } = await import("./api-client.js");

    const plaintext = "end-to-end-secret";
    const key = await generateKey();
    const fragment = await exportKey(key);
    const { ciphertext, iv } = await encrypt(plaintext, key);

    vi.mocked(retrieveSecret).mockResolvedValueOnce({
      ciphertext,
      iv,
      hasPassphrase: false,
      viewsRemaining: 1,
    });

    const result = await client.callTool({
      name: "view_secret",
      arguments: {
        url: `https://vaulted.fyi/s/test-id#${fragment}`,
        output_mode: "direct",
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);

    expect(parsed.success).toBe(true);
    expect(parsed.data.mode).toBe("direct");
    expect(parsed.data.content).toBe(plaintext);
    expect(parsed.data.sensitive).toBe(true);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("executes browser mode via the MCP protocol end-to-end", async () => {
    const result = await client.callTool({
      name: "view_secret",
      arguments: { url: "https://vaulted.fyi/s/abc123#mykey" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.mode).toBe("browser");
    expect(mockOpen).toHaveBeenCalledWith("https://vaulted.fyi/s/abc123#mykey");
  });

  it("executes clipboard mode end-to-end (encrypt → fetch → decrypt → copyToClipboard)", async () => {
    const { generateKey, exportKey, encrypt } = await import("@vaulted/crypto");
    const { retrieveSecret } = await import("./api-client.js");

    const plaintext = "clipboard-e2e-secret";
    const key = await generateKey();
    const fragment = await exportKey(key);
    const { ciphertext, iv } = await encrypt(plaintext, key);

    vi.mocked(retrieveSecret).mockResolvedValueOnce({
      ciphertext,
      iv,
      hasPassphrase: false,
      viewsRemaining: 1,
    });
    mockCopyToClipboard.mockResolvedValueOnce(undefined);

    const result = await client.callTool({
      name: "view_secret",
      arguments: {
        url: `https://vaulted.fyi/s/test-id#${fragment}`,
        output_mode: "clipboard",
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);

    expect(parsed.success).toBe(true);
    expect(parsed.data.mode).toBe("clipboard");
    expect(mockCopyToClipboard).toHaveBeenCalledWith(plaintext);
    expect(text).not.toContain(plaintext);
  });

  it("executes file mode end-to-end (encrypt → fetch → decrypt → writeFile)", async () => {
    const { generateKey, exportKey, encrypt } = await import("@vaulted/crypto");
    const { retrieveSecret } = await import("./api-client.js");

    const plaintext = "file-e2e-secret";
    const key = await generateKey();
    const fragment = await exportKey(key);
    const { ciphertext, iv } = await encrypt(plaintext, key);

    vi.mocked(retrieveSecret).mockResolvedValueOnce({
      ciphertext,
      iv,
      hasPassphrase: false,
      viewsRemaining: 1,
    });
    mockWriteFile.mockResolvedValueOnce(undefined);

    const result = await client.callTool({
      name: "view_secret",
      arguments: {
        url: `https://vaulted.fyi/s/test-id#${fragment}`,
        output_mode: "file",
        file_path: "/tmp/integration-test.txt",
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);

    expect(parsed.success).toBe(true);
    expect(parsed.data.mode).toBe("file");
    expect(parsed.data.filePath).toBe("/tmp/integration-test.txt");
    expect(mockWriteFile).toHaveBeenCalledWith("/tmp/integration-test.txt", plaintext, "utf-8");
    expect(text).not.toContain(plaintext);
  });
});

describe("view_secret passphrase round-trip via MCP client", () => {
  let client: InstanceType<typeof Client>;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    mockOpen.mockReset();
    mockOpen.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  async function createPassphraseSecretAndCaptureUrl(
    plaintext: string,
    passphrase: string,
  ): Promise<{ url: string; ciphertext: string; iv: string }> {
    const { createSecret } = await import("./api-client.js");
    const createMock = vi.mocked(createSecret);
    createMock.mockResolvedValueOnce({ id: "round-trip-id", statusToken: "tok" });

    const createResult = await client.callTool({
      name: "create_secret",
      arguments: { content: plaintext, passphrase },
    });
    const createParsed = JSON.parse(
      (createResult.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(createParsed.success).toBe(true);
    expect(createParsed.data.passphraseProtected).toBe(true);

    const callArgs = createMock.mock.calls.at(-1)?.[0];
    if (!callArgs) throw new Error("createSecret was not called");
    expect(callArgs.hasPassphrase).toBe(true);
    expect(callArgs.ciphertext).toEqual(expect.any(String));
    expect(callArgs.ciphertext.length).toBeGreaterThan(0);
    expect(callArgs.iv).toEqual(expect.any(String));
    expect(callArgs.iv.length).toBeGreaterThan(0);

    const fragment = (createParsed.data.url as string).split("#")[1];
    // Fragment format for passphrase-protected secrets: `${wrappedKey}.${salt}` with both halves non-empty.
    expect(fragment).toMatch(/^[^.]+\.[^.]+$/);

    return {
      url: createParsed.data.url as string,
      ciphertext: callArgs.ciphertext,
      iv: callArgs.iv,
    };
  }

  it("decrypts a passphrase-protected secret end-to-end with the correct passphrase", async () => {
    const plaintext = "round-trip-passphrase-secret";
    const passphrase = "correct horse battery staple";

    const { url, ciphertext, iv } = await createPassphraseSecretAndCaptureUrl(
      plaintext,
      passphrase,
    );

    const { retrieveSecret } = await import("./api-client.js");
    vi.mocked(retrieveSecret).mockResolvedValueOnce({
      ciphertext,
      iv,
      hasPassphrase: true,
      viewsRemaining: 1,
    });

    const viewResult = await client.callTool({
      name: "view_secret",
      arguments: { url, output_mode: "direct", passphrase },
    });
    const parsed = JSON.parse(
      (viewResult.content as Array<{ type: string; text: string }>)[0].text,
    );

    expect(parsed.success).toBe(true);
    expect(parsed.data.mode).toBe("direct");
    expect(parsed.data.content).toBe(plaintext);
  });

  it("returns PASSPHRASE_REQUIRED when the passphrase parameter is omitted", async () => {
    const { url, ciphertext, iv } = await createPassphraseSecretAndCaptureUrl(
      "needs-a-passphrase",
      "secret-pw",
    );

    const { retrieveSecret } = await import("./api-client.js");
    vi.mocked(retrieveSecret).mockResolvedValueOnce({
      ciphertext,
      iv,
      hasPassphrase: true,
      viewsRemaining: 1,
    });

    const viewResult = await client.callTool({
      name: "view_secret",
      arguments: { url, output_mode: "direct" },
    });
    const parsed = JSON.parse(
      (viewResult.content as Array<{ type: string; text: string }>)[0].text,
    );

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("PASSPHRASE_REQUIRED");
    expect(parsed.error.suggestion).toBe(
      "This secret is passphrase-protected. Provide the passphrase and try again.",
    );
    expect(viewResult.isError).toBe(true);
  });

  it("returns ENCRYPTION_FAILED when the wrong passphrase is provided", async () => {
    const { url, ciphertext, iv } = await createPassphraseSecretAndCaptureUrl(
      "guarded-payload",
      "the-real-passphrase",
    );

    const { retrieveSecret } = await import("./api-client.js");
    vi.mocked(retrieveSecret).mockResolvedValueOnce({
      ciphertext,
      iv,
      hasPassphrase: true,
      viewsRemaining: 1,
    });

    const viewResult = await client.callTool({
      name: "view_secret",
      arguments: { url, output_mode: "direct", passphrase: "definitely-wrong" },
    });
    const parsed = JSON.parse(
      (viewResult.content as Array<{ type: string; text: string }>)[0].text,
    );

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("ENCRYPTION_FAILED");
    expect(parsed.error.suggestion).toBe(
      "The passphrase may be incorrect. Try again or ask the sender.",
    );
    expect(viewResult.isError).toBe(true);
  });
});

describe("prompt registration", () => {
  let client: InstanceType<typeof Client>;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("lists share-secret with the expected description", async () => {
    const { prompts } = await client.listPrompts();
    const prompt = prompts.find((p) => p.name === "share-secret");
    expect(prompt).toBeDefined();
    expect(prompt?.description).toBe(
      "Share a secret securely via an encrypted, self-destructing link",
    );
  });

  it("share-secret takes no required arguments", async () => {
    const { prompts } = await client.listPrompts();
    const prompt = prompts.find((p) => p.name === "share-secret");
    const required = (prompt?.arguments ?? []).filter((a) => a.required);
    expect(required).toHaveLength(0);
  });

  it("getPrompt returns messages with non-empty text content", async () => {
    const result = await client.getPrompt({ name: "share-secret" });
    expect(result.messages.length).toBeGreaterThan(0);
    const first = result.messages[0];
    expect(first.role).toBe("user");
    expect(first.content.type).toBe("text");
    if (first.content.type === "text") {
      expect(first.content.text.length).toBeGreaterThan(0);
    }
  });

  // The MCP spec exposes two distinct descriptions for a prompt:
  //   - prompts/list → the registerPrompt config description ("Share a secret securely …")
  //   - prompts/get  → the GetPromptResult.description ("Step-by-step guide …")
  // They are intentionally different; pin both so a refactor can't silently collapse them.
  it("getPrompt round-trips the step-by-step description distinct from the list-level one", async () => {
    const result = await client.getPrompt({ name: "share-secret" });
    expect(result.description).toBe(
      "Step-by-step guide to creating a secure, self-destructing secret link",
    );

    const { prompts } = await client.listPrompts();
    const listed = prompts.find((p) => p.name === "share-secret");
    expect(listed?.description).not.toBe(result.description);
  });
});

describe("architectural boundary", () => {
  it("only imports @modelcontextprotocol/sdk at runtime in src/index.ts", async () => {
    const { readdir } = await import("node:fs/promises");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { readFile } = await import("node:fs/promises");

    const srcDir = resolve(dirname(fileURLToPath(import.meta.url)));
    const entries = await readdir(srcDir, { recursive: true });
    const tsFiles = entries.filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts",
    );

    expect(tsFiles).toContain("prompts/share-secret.ts");

    // Type-only imports are erased at compile time and carry no runtime dependency,
    // so they don't violate the boundary. Block runtime imports only.
    const runtimeSdkImport = /^\s*import\s+(?!type\s)[^;]*from\s+["']@modelcontextprotocol\/sdk/m;

    for (const file of tsFiles) {
      const content = await readFile(resolve(srcDir, file), "utf-8");
      expect(content).not.toMatch(runtimeSdkImport);
    }
  });

  it("only imports node:child_process from src/clipboard.ts", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const srcDir = resolve(dirname(fileURLToPath(import.meta.url)));
    const entries = await readdir(srcDir, { recursive: true });
    const tsFiles = entries.filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "clipboard.ts",
    );

    const childProcessImport = /^\s*import\s+[^;]*from\s+["']node:child_process/m;

    for (const file of tsFiles) {
      const content = await readFile(resolve(srcDir, file), "utf-8");
      expect(content).not.toMatch(childProcessImport);
    }
  });
});
