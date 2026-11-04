import { mkdtemp, writeFile, rm, realpath, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importKey, decrypt } from "@vaulted/crypto";

const mockConfig = vi.hoisted(() => ({
  baseUrl: "https://vaulted.fyi",
  allowedDirs: [] as string[],
  allowCommandInputs: false,
}));
vi.mock("../config.js", () => ({ config: mockConfig }));

vi.mock("../history.js", () => ({
  appendHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../api-client.js", () => ({
  createSecret: vi.fn().mockResolvedValue({ id: "test-id-123", statusToken: "test-token-456" }),
  ApiError: class ApiError extends Error {},
}));

const { handleCreateSecret } = await import("./create-secret.js");
const { createSecret } = await import("../api-client.js");
const { appendHistory } = await import("../history.js");

type ToolResult = Awaited<ReturnType<typeof handleCreateSecret>>;

function parse(result: ToolResult) {
  return JSON.parse(result.content[0].text);
}

async function decryptSharedValue(result: ToolResult): Promise<string> {
  const fragment = parse(result).data.url.split("#")[1];
  const key = await importKey(fragment);
  const { ciphertext, iv } = vi.mocked(createSecret).mock.calls[0][0];
  return decrypt(ciphertext, iv, key);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const SECRET = "sk_live_51HxTOPSECRETvalue";

describe("handleCreateSecret input sources", () => {
  let cwd: string;
  let outside: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );

  function expectValueNeverSurfaced(result: ToolResult, value: string) {
    expect(JSON.stringify(result)).not.toContain(value);
    expect(JSON.stringify(vi.mocked(appendHistory).mock.calls)).not.toContain(value);
    for (const spy of consoleSpies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(value);
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    cwd = await realpath(await mkdtemp(join(tmpdir(), "vaulted-cs-cwd-")));
    outside = await realpath(await mkdtemp(join(tmpdir(), "vaulted-cs-out-")));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd);
    mockConfig.allowedDirs = [];
    mockConfig.allowCommandInputs = false;
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    delete process.env.VAULTED_TEST_SECRET;
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  afterAll(() => {
    for (const spy of consoleSpies) spy.mockRestore();
  });

  describe("env:", () => {
    it("encrypts the environment variable's value, not the literal reference", async () => {
      process.env.VAULTED_TEST_SECRET = SECRET;

      const result = await handleCreateSecret({
        content: "env:VAULTED_TEST_SECRET",
        label: "stripe-key",
      });

      expect(parse(result).success).toBe(true);
      expect(await decryptSharedValue(result)).toBe(SECRET);
    });

    it("never echoes the resolved value in the result, history or logs", async () => {
      process.env.VAULTED_TEST_SECRET = SECRET;

      const result = await handleCreateSecret({
        content: "env:VAULTED_TEST_SECRET",
        label: "stripe-key",
      });

      expectValueNeverSurfaced(result, SECRET);
    });

    it("stores only the user-supplied label in history, never the reference or value", async () => {
      process.env.VAULTED_TEST_SECRET = SECRET;

      await handleCreateSecret({ content: "env:VAULTED_TEST_SECRET", label: "stripe-key" });

      const entry = vi.mocked(appendHistory).mock.calls[0][0];
      expect(entry.label).toBe("stripe-key");
      expect(Object.keys(entry)).not.toContain("content");
      expect(JSON.stringify(entry)).not.toContain("VAULTED_TEST_SECRET");
    });

    it("returns ENV_VAR_NOT_FOUND and does not call the API when the variable is unset", async () => {
      const result = await handleCreateSecret({ content: "env:VAULTED_TEST_SECRET" });

      expect(result.isError).toBe(true);
      expect(parse(result).error.code).toBe("ENV_VAR_NOT_FOUND");
      expect(createSecret).not.toHaveBeenCalled();
    });

    it("rejects an empty resolved value", async () => {
      process.env.VAULTED_TEST_SECRET = "";

      const result = await handleCreateSecret({ content: "env:VAULTED_TEST_SECRET" });

      expect(result.isError).toBe(true);
      expect(parse(result).error.code).toBe("INVALID_INPUT");
      expect(createSecret).not.toHaveBeenCalled();
    });

    it("rejects a resolved value over 1000 characters without echoing it", async () => {
      const longValue = "x".repeat(990) + "TAIL-SECRET-MARKER";
      process.env.VAULTED_TEST_SECRET = longValue;

      const result = await handleCreateSecret({ content: "env:VAULTED_TEST_SECRET" });

      expect(result.isError).toBe(true);
      expect(parse(result).error.code).toBe("INVALID_INPUT");
      expect(parse(result).error.message).toContain("1000");
      expect(createSecret).not.toHaveBeenCalled();
      expectValueNeverSurfaced(result, "TAIL-SECRET-MARKER");
    });

    it("accepts a resolved value of exactly 1000 characters", async () => {
      process.env.VAULTED_TEST_SECRET = "y".repeat(1000);

      const result = await handleCreateSecret({ content: "env:VAULTED_TEST_SECRET" });

      expect(parse(result).success).toBe(true);
      expect(await decryptSharedValue(result)).toBe("y".repeat(1000));
    });
  });

  describe("file:", () => {
    it("encrypts the contents of a file inside the working directory", async () => {
      await writeFile(join(cwd, "secret.txt"), SECRET);

      const result = await handleCreateSecret({ content: "file:secret.txt" });

      expect(parse(result).success).toBe(true);
      expect(await decryptSharedValue(result)).toBe(SECRET);
      expectValueNeverSurfaced(result, SECRET);
    });

    it("rejects a file outside the allowed directories with PATH_TRAVERSAL_BLOCKED", async () => {
      const outsideFile = join(outside, "secret.txt");
      await writeFile(outsideFile, SECRET);

      const result = await handleCreateSecret({ content: `file:${outsideFile}` });

      expect(result.isError).toBe(true);
      expect(parse(result).error.code).toBe("PATH_TRAVERSAL_BLOCKED");
      expect(createSecret).not.toHaveBeenCalled();
      expectValueNeverSurfaced(result, SECRET);
    });

    it("rejects relative traversal out of the working directory", async () => {
      const result = await handleCreateSecret({ content: "file:../../../etc/passwd" });

      expect(parse(result).error.code).toBe("PATH_TRAVERSAL_BLOCKED");
      expect(createSecret).not.toHaveBeenCalled();
    });
  });

  describe("dotenv:", () => {
    it("encrypts only the requested key from a .env file", async () => {
      await writeFile(join(cwd, ".env.local"), `OTHER=not-this-one\nDATABASE_URL="${SECRET}"\n`);

      const result = await handleCreateSecret({ content: "dotenv:.env.local:DATABASE_URL" });

      expect(parse(result).success).toBe(true);
      expect(await decryptSharedValue(result)).toBe(SECRET);
      expectValueNeverSurfaced(result, SECRET);
      expectValueNeverSurfaced(result, "not-this-one");
    });

    it("returns DOTENV_KEY_NOT_FOUND for a missing key", async () => {
      await writeFile(join(cwd, ".env"), "OTHER=1\n");

      const result = await handleCreateSecret({ content: "dotenv:.env:MISSING" });

      expect(parse(result).error.code).toBe("DOTENV_KEY_NOT_FOUND");
      expect(createSecret).not.toHaveBeenCalled();
    });
  });

  describe("process-executing sources (cmd:, op:, keychain:)", () => {
    it("rejects cmd: by default and never runs the command", async () => {
      const marker = join(cwd, "pwned");

      const result = await handleCreateSecret({ content: `cmd:touch ${marker} && echo hi` });

      expect(result.isError).toBe(true);
      expect(parse(result).error.code).toBe("COMMAND_INPUTS_DISABLED");
      expect(await exists(marker)).toBe(false);
      expect(createSecret).not.toHaveBeenCalled();
    });

    it.each(["op:Private/Stripe", "keychain:MyService"])(
      "rejects %s by default",
      async (content) => {
        const result = await handleCreateSecret({ content });

        expect(result.isError).toBe(true);
        expect(parse(result).error.code).toBe("COMMAND_INPUTS_DISABLED");
        expect(createSecret).not.toHaveBeenCalled();
      },
    );

    it("does not tell the agent how to enable command inputs itself", async () => {
      const result = await handleCreateSecret({ content: "cmd:echo hi" });

      expect(parse(result).error.suggestion).not.toMatch(/--allow-command-inputs/);
    });

    it("runs cmd: and encrypts its stdout when the server was started with the flag", async () => {
      mockConfig.allowCommandInputs = true;

      const result = await handleCreateSecret({ content: `cmd:printf '%s' '${SECRET}'` });

      expect(parse(result).success).toBe(true);
      expect(await decryptSharedValue(result)).toBe(SECRET);
      expectValueNeverSurfaced(result, SECRET);
    });
  });

  it("still encrypts plain text content verbatim", async () => {
    const result = await handleCreateSecret({ content: "just-a-literal" });

    expect(await decryptSharedValue(result)).toBe("just-a-literal");
  });
});
