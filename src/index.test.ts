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

vi.mock("./api-client.js", () => ({
  createSecret: vi.fn().mockResolvedValue({ id: "test-id", statusToken: "test-token" }),
  retrieveSecret: vi.fn(),
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

const mockOpen = vi.hoisted(() => vi.fn());
vi.mock("open", () => ({ default: mockOpen }));

vi.mock("@vaulted/crypto", async () => {
  const actual = await vi.importActual<typeof import("@vaulted/crypto")>("@vaulted/crypto");
  return actual;
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

  it("registers exactly 3 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(3);
  });

  it("registers create_secret, view_secret, and check_status", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["check_status", "create_secret", "view_secret"]);
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

describe("placeholder handlers", () => {
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

  it("check_status returns 'not implemented yet'", async () => {
    const result = await client.callTool({
      name: "check_status",
      arguments: {},
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toEqual({ success: false, error: "not implemented yet" });
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
