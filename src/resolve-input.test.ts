import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockConfig = vi.hoisted(() => ({ allowedDirs: [] as string[] }));
vi.mock("./config.js", () => ({
  config: mockConfig,
}));

const { resolveInput, parseDotenv } = await import("./resolve-input.js");

function parseError(result: { success: false; error: { content: Array<{ text: string }> } }): {
  code: string;
  message: string;
  suggestion: string;
} {
  return JSON.parse(result.error.content[0].text).error;
}

describe("resolveInput", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), "vaulted-ri-")));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    mockConfig.allowedDirs = [];
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("env: prefix", () => {
    it("resolves env:VAR_NAME from process.env", async () => {
      process.env.VAULTED_TEST_ENV = "secret-value";
      try {
        const result = await resolveInput("env:VAULTED_TEST_ENV");
        expect(result).toEqual({ success: true, value: "secret-value" });
      } finally {
        delete process.env.VAULTED_TEST_ENV;
      }
    });

    it("returns ENV_VAR_NOT_FOUND for a missing env var", async () => {
      delete process.env.VAULTED_NOT_DEFINED;
      const result = await resolveInput("env:VAULTED_NOT_DEFINED");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("ENV_VAR_NOT_FOUND");
      }
    });

    it("handles an empty env var name gracefully with INVALID_INPUT", async () => {
      const result = await resolveInput("env:");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("INVALID_INPUT");
      }
    });
  });

  describe("file: prefix", () => {
    it("reads and returns file contents for a path within CWD", async () => {
      const filePath = join(tempDir, "secret.txt");
      await writeFile(filePath, "my-secret-content");
      const result = await resolveInput(`file:${filePath}`);
      expect(result).toEqual({ success: true, value: "my-secret-content" });
    });

    it("returns PATH_TRAVERSAL_BLOCKED for ../ escaping CWD", async () => {
      const result = await resolveInput("file:../../etc/passwd");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("PATH_TRAVERSAL_BLOCKED");
      }
    });

    it("returns FILE_NOT_FOUND for a missing file within CWD", async () => {
      const missing = join(tempDir, "nope.txt");
      const result = await resolveInput(`file:${missing}`);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("FILE_NOT_FOUND");
      }
    });
  });

  describe("dotenv: prefix", () => {
    it("parses a .env file and returns the value for the requested key", async () => {
      const envPath = join(tempDir, ".env.local");
      await writeFile(envPath, "DATABASE_URL=postgres://localhost/test\nAPI_KEY=abc123\n");
      const result = await resolveInput(`dotenv:${envPath}:DATABASE_URL`);
      expect(result).toEqual({ success: true, value: "postgres://localhost/test" });
    });

    it("returns DOTENV_KEY_NOT_FOUND when the key is not present", async () => {
      const envPath = join(tempDir, ".env.local");
      await writeFile(envPath, "DATABASE_URL=x\n");
      const result = await resolveInput(`dotenv:${envPath}:MISSING_KEY`);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("DOTENV_KEY_NOT_FOUND");
      }
    });

    it("returns PATH_TRAVERSAL_BLOCKED when dotenv path escapes CWD", async () => {
      const result = await resolveInput("dotenv:../../.env:SECRET");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("PATH_TRAVERSAL_BLOCKED");
      }
    });

    it("returns INVALID_INPUT for a malformed dotenv reference", async () => {
      const result = await resolveInput("dotenv:.env.local");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("INVALID_INPUT");
      }
    });
  });

  describe("plaintext fallthrough", () => {
    it("returns content as-is when no recognized prefix matches", async () => {
      const result = await resolveInput("some plain secret value");
      expect(result).toEqual({ success: true, value: "some plain secret value" });
    });
  });

  describe("agent-blind contract", () => {
    it("never includes a resolved value in error responses", async () => {
      process.env.VAULTED_AGENT_BLIND_PRESENT = "super-secret-value";
      try {
        const filePath = join(tempDir, "cleartext.txt");
        await writeFile(filePath, "super-secret-file-content");

        const envError = await resolveInput("env:VAULTED_AGENT_BLIND_MISSING");
        expect(envError.success).toBe(false);
        if (!envError.success) {
          const serialized = envError.error.content[0].text;
          expect(serialized).not.toContain("super-secret-value");
        }

        const missingFile = join(tempDir, "nope.txt");
        const fileError = await resolveInput(`file:${missingFile}`);
        expect(fileError.success).toBe(false);
        if (!fileError.success) {
          const serialized = fileError.error.content[0].text;
          expect(serialized).not.toContain("super-secret-file-content");
        }
      } finally {
        delete process.env.VAULTED_AGENT_BLIND_PRESENT;
      }
    });

    it("exposes only success and value on a successful result (no leaking fields)", async () => {
      const result = await resolveInput("plaintext");
      expect(Object.keys(result).sort()).toEqual(["success", "value"]);
    });
  });
});

describe("parseDotenv", () => {
  it("parses basic key=value pairs", () => {
    const result = parseDotenv("KEY=value\nOTHER=thing");
    expect(result).toEqual({ KEY: "value", OTHER: "thing" });
  });

  it("strips surrounding double quotes", () => {
    const result = parseDotenv('KEY="quoted value"');
    expect(result.KEY).toBe("quoted value");
  });

  it("strips surrounding single quotes", () => {
    const result = parseDotenv("KEY='quoted value'");
    expect(result.KEY).toBe("quoted value");
  });

  it("ignores comments and blank lines", () => {
    const result = parseDotenv("# this is a comment\n\nKEY=value\n# another\n");
    expect(result).toEqual({ KEY: "value" });
  });

  it("preserves = signs in values by splitting only on the first =", () => {
    const result = parseDotenv("KEY=a=b=c");
    expect(result.KEY).toBe("a=b=c");
  });

  it("trims whitespace from keys and values", () => {
    const result = parseDotenv("  KEY  =  value  ");
    expect(result.KEY).toBe("value");
  });

  it("returns an empty object for empty content", () => {
    expect(parseDotenv("")).toEqual({});
  });
});
