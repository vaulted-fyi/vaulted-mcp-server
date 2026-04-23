import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockConfig = vi.hoisted(() => ({ allowedDirs: [] as string[] }));
vi.mock("./config.js", () => ({
  config: mockConfig,
}));

vi.mock("./command-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./command-runner.js")>();
  return { runCommand: vi.fn(actual.runCommand) };
});

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

    it("returns FILE_READ_ERROR when path exists but cannot be read as a file", async () => {
      const result = await resolveInput(`file:${tempDir}`);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("FILE_READ_ERROR");
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

    it("splits dotenv ref at the last colon so file paths can contain colons", async () => {
      const envPathWithColon = join(tempDir, "config:local.env");
      await writeFile(envPathWithColon, "API_KEY=abc123\n");
      const result = await resolveInput(`dotenv:${envPathWithColon}:API_KEY`);
      expect(result).toEqual({ success: true, value: "abc123" });
    });

    it("returns FILE_READ_ERROR when dotenv path exists but is not a readable file", async () => {
      const result = await resolveInput(`dotenv:${tempDir}:DATABASE_URL`);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("FILE_READ_ERROR");
      }
    });
  });

  describe("cmd: prefix", () => {
    it("resolves cmd:echo hello to 'hello'", async () => {
      const result = await resolveInput("cmd:echo hello");
      expect(result).toEqual({ success: true, value: "hello" });
    });

    it("returns INVALID_INPUT for cmd: with empty command", async () => {
      const result = await resolveInput("cmd:");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("INVALID_INPUT");
      }
    });

    it("returns COMMAND_FAILED for a failing command", async () => {
      const result = await resolveInput("cmd:exit 1");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("COMMAND_FAILED");
      }
    });

    it("does not include stdout in COMMAND_FAILED error", async () => {
      process.env.VAULTED_CMD_TEST_SECRET = "runtime-secret-xk7q2p";
      try {
        const result = await resolveInput("cmd:echo $VAULTED_CMD_TEST_SECRET && exit 1");
        expect(result.success).toBe(false);
        if (!result.success) {
          const serialized = JSON.stringify(result.error);
          expect(serialized).not.toContain("runtime-secret-xk7q2p");
        }
      } finally {
        delete process.env.VAULTED_CMD_TEST_SECRET;
      }
    });

    it("supports pipes with shell: true", async () => {
      const result = await resolveInput('cmd:echo "foo bar" | tr " " "-"');
      expect(result).toEqual({ success: true, value: "foo-bar" });
    });

    it("returns INVALID_INPUT for a command that produces no output", async () => {
      const result = await resolveInput("cmd:true");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("INVALID_INPUT");
        expect(parseError(result).message).toContain("no output");
      }
    });

    it("returns COMMAND_TIMEOUT when the command is killed", async () => {
      const { runCommand } = await import("./command-runner.js");
      vi.mocked(runCommand).mockRejectedValueOnce(
        Object.assign(new Error("Command timed out"), { killed: true, stderr: "", code: null }),
      );
      const result = await resolveInput("cmd:sleep 100");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(parseError(result).code).toBe("COMMAND_TIMEOUT");
      }
    });

    it("does not leak resolved value in any error state", async () => {
      const result = await resolveInput("cmd:exit 1");
      expect(result.success).toBe(false);
      if (!result.success) {
        const serialized = JSON.stringify(result.error);
        expect(serialized).not.toMatch(/"success"\s*:\s*true/);
        expect(serialized).not.toContain('"value"');
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
