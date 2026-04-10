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

  it("create_secret returns 'not implemented yet'", async () => {
    const result = await client.callTool({
      name: "create_secret",
      arguments: { content: "test" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toEqual({ success: false, error: "not implemented yet" });
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

    for (const file of tsFiles) {
      const content = await readFile(resolve(srcDir, file), "utf-8");
      expect(content).not.toContain("@modelcontextprotocol/sdk");
    }
  });
});
