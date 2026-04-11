import { mkdtemp, writeFile, symlink, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockConfig = vi.hoisted(() => ({ allowedDirs: [] as string[] }));
vi.mock("./config.js", () => ({
  config: mockConfig,
}));

const { validatePath } = await import("./path-validator.js");

function parseErrorCode(result: {
  valid: false;
  error: { content: Array<{ text: string }> };
}): string {
  return JSON.parse(result.error.content[0].text).error.code;
}

describe("validatePath", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), "vaulted-pv-")));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    mockConfig.allowedDirs = [];
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("allows a path within CWD", async () => {
    const filePath = join(tempDir, "secret.txt");
    await writeFile(filePath, "content");

    const result = await validatePath(filePath);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.resolvedPath).toBe(filePath);
    }
  });

  it("rejects a relative path with ../ escaping CWD", async () => {
    const result = await validatePath("../../etc/passwd");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(parseErrorCode(result)).toBe("PATH_TRAVERSAL_BLOCKED");
    }
  });

  it("rejects an absolute path outside CWD", async () => {
    const result = await validatePath("/etc/passwd");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(parseErrorCode(result)).toBe("PATH_TRAVERSAL_BLOCKED");
    }
  });

  it("allows a path within config.allowedDirs even if outside CWD", async () => {
    const otherDir = await realpath(await mkdtemp(join(tmpdir(), "vaulted-pv-other-")));
    try {
      mockConfig.allowedDirs = [otherDir];
      const filePath = join(otherDir, "config.txt");
      await writeFile(filePath, "x");

      const result = await validatePath(filePath);
      expect(result.valid).toBe(true);
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });

  it("rejects a symlink pointing outside CWD", async () => {
    const outsideDir = await realpath(await mkdtemp(join(tmpdir(), "vaulted-pv-outside-")));
    try {
      const outsideFile = join(outsideDir, "target.txt");
      await writeFile(outsideFile, "secret");
      const linkPath = join(tempDir, "link.txt");
      await symlink(outsideFile, linkPath);

      const result = await validatePath(linkPath);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(parseErrorCode(result)).toBe("PATH_TRAVERSAL_BLOCKED");
      }
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("allows a symlink pointing inside CWD", async () => {
    const targetPath = join(tempDir, "target.txt");
    await writeFile(targetPath, "content");
    const linkPath = join(tempDir, "link.txt");
    await symlink(targetPath, linkPath);

    const result = await validatePath(linkPath);
    expect(result.valid).toBe(true);
  });

  it("rejects a non-existent path outside CWD (realpath ENOENT fallback still enforces containment)", async () => {
    const result = await validatePath("/tmp/definitely-not-a-real-file-xyz-12345.txt");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(parseErrorCode(result)).toBe("PATH_TRAVERSAL_BLOCKED");
    }
  });

  it("allows a non-existent path within CWD (caller handles ENOENT)", async () => {
    const missingPath = join(tempDir, "not-yet-created.txt");
    const result = await validatePath(missingPath);
    expect(result.valid).toBe(true);
  });

  it("enforces CWD-only mode when allowedDirs is empty", async () => {
    mockConfig.allowedDirs = [];
    const outside = await realpath(await mkdtemp(join(tmpdir(), "vaulted-pv-cwd-only-")));
    try {
      const filePath = join(outside, "x.txt");
      await writeFile(filePath, "y");
      const result = await validatePath(filePath);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(parseErrorCode(result)).toBe("PATH_TRAVERSAL_BLOCKED");
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a sibling directory that shares a prefix with CWD (prefix-collision guard)", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "vaulted-pv-prefix-")));
    try {
      const cwdDir = join(parent, "project");
      const siblingDir = join(parent, "projectevil");
      await Promise.all([writeFile(join(parent, "marker"), "").catch(() => undefined)]);
      await import("node:fs/promises").then(({ mkdir }) =>
        Promise.all([mkdir(cwdDir), mkdir(siblingDir)]),
      );
      const siblingFile = join(siblingDir, "secret.txt");
      await writeFile(siblingFile, "leak");

      cwdSpy.mockReturnValue(cwdDir);
      const result = await validatePath(siblingFile);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(parseErrorCode(result)).toBe("PATH_TRAVERSAL_BLOCKED");
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
