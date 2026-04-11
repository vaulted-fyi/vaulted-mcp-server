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

  it("view_secret returns 'not implemented yet'", async () => {
    const result = await client.callTool({
      name: "view_secret",
      arguments: {},
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toEqual({ success: false, error: "not implemented yet" });
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
});

describe("architectural boundary", () => {
  it("only imports @modelcontextprotocol/sdk in src/index.ts", async () => {
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

    for (const file of tsFiles) {
      const content = await readFile(resolve(srcDir, file), "utf-8");
      expect(content).not.toContain("@modelcontextprotocol/sdk");
    }
  });
});
