import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

const { copyToClipboard } = await import("./clipboard.js");

type FakeChild = ChildProcess & { _stdinChunks: string[] };

function makeFakeChild(): FakeChild {
  const chunks: string[] = [];
  const stdin = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  const emitter = new EventEmitter() as FakeChild;
  emitter.stdin = stdin;
  Object.defineProperty(emitter, "_stdinChunks", { value: chunks });
  return emitter;
}

function originalPlatform(): NodeJS.Platform {
  return process.platform;
}

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

describe("copyToClipboard — macOS", () => {
  const orig = originalPlatform();

  beforeEach(() => {
    mockExecFile.mockReset();
    setPlatform("darwin");
  });

  afterEach(() => {
    setPlatform(orig);
  });

  it("spawns pbcopy and pipes content to stdin", async () => {
    const child = makeFakeChild();
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(null));
        return child;
      },
    );

    await copyToClipboard("super-secret");

    expect(mockExecFile).toHaveBeenCalledOnce();
    expect(mockExecFile.mock.calls[0][0]).toBe("pbcopy");
    expect(mockExecFile.mock.calls[0][1]).toEqual([]);
    expect(child._stdinChunks.join("")).toBe("super-secret");
  });

  it("rejects when pbcopy fails", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(new Error("pbcopy not found")));
        return makeFakeChild();
      },
    );

    await expect(copyToClipboard("x")).rejects.toThrow(/clipboard/i);
  });
});

describe("copyToClipboard — Linux", () => {
  const orig = originalPlatform();

  beforeEach(() => {
    mockExecFile.mockReset();
    setPlatform("linux");
  });

  afterEach(() => {
    setPlatform(orig);
  });

  it("spawns xclip with -selection clipboard and pipes to stdin", async () => {
    const child = makeFakeChild();
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(null));
        return child;
      },
    );

    await copyToClipboard("hello");

    expect(mockExecFile.mock.calls[0][0]).toBe("xclip");
    expect(mockExecFile.mock.calls[0][1]).toEqual(["-selection", "clipboard"]);
    expect(child._stdinChunks.join("")).toBe("hello");
  });

  it("falls back to xsel when xclip fails", async () => {
    const xclipChild = makeFakeChild();
    const xselChild = makeFakeChild();

    mockExecFile
      .mockImplementationOnce((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(new Error("xclip: not found")));
        return xclipChild;
      })
      .mockImplementationOnce((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(null));
        return xselChild;
      });

    await copyToClipboard("fallback");

    expect(mockExecFile).toHaveBeenCalledTimes(2);
    expect(mockExecFile.mock.calls[1][0]).toBe("xsel");
    expect(mockExecFile.mock.calls[1][1]).toEqual(["--clipboard", "--input"]);
    expect(xselChild._stdinChunks.join("")).toBe("fallback");
  });

  it("rejects when neither xclip nor xsel works, preserving both reasons", async () => {
    mockExecFile
      .mockImplementationOnce((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(new Error("DISPLAY not set")));
        return makeFakeChild();
      })
      .mockImplementationOnce((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(new Error("xsel: command not found")));
        return makeFakeChild();
      });

    try {
      await copyToClipboard("x");
      expect.fail("should have thrown");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("xclip");
      expect(message).toContain("xsel");
      expect(message).toContain("DISPLAY not set");
      expect(message).toContain("command not found");
    }
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });
});

describe("copyToClipboard — Windows", () => {
  const orig = originalPlatform();

  beforeEach(() => {
    mockExecFile.mockReset();
    setPlatform("win32");
  });

  afterEach(() => {
    setPlatform(orig);
  });

  it("spawns powershell.exe with Set-Clipboard -Value $input and pipes to stdin", async () => {
    const child = makeFakeChild();
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(null));
        return child;
      },
    );

    await copyToClipboard("win-secret");

    expect(mockExecFile.mock.calls[0][0]).toBe("powershell.exe");
    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toEqual(["-noprofile", "-command", "Set-Clipboard -Value $input"]);
    expect(child._stdinChunks.join("")).toBe("win-secret");
  });
});

describe("copyToClipboard — NFR10 (no stdout/stderr writes)", () => {
  const orig = originalPlatform();

  beforeEach(() => {
    mockExecFile.mockReset();
    setPlatform("darwin");
  });

  afterEach(() => {
    setPlatform(orig);
  });

  it("never writes the secret to stdout or stderr during a successful copy", async () => {
    const secret = "🔐-nfr10-stdout-stderr-leak-check";
    const child = makeFakeChild();
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(null));
        return child;
      },
    );

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await copyToClipboard(secret);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    const stdoutBytes = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const stderrBytes = stderrSpy.mock.calls.map((c) => String(c[0])).join("");

    expect(stdoutBytes).not.toContain(secret);
    expect(stderrBytes).not.toContain(secret);
  });

  it("never writes the secret to stdout or stderr even when the command fails", async () => {
    const secret = "🔐-nfr10-fail-path";
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(new Error("pbcopy not found")));
        return makeFakeChild();
      },
    );

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await copyToClipboard(secret).catch(() => undefined);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    const stdoutBytes = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const stderrBytes = stderrSpy.mock.calls.map((c) => String(c[0])).join("");

    expect(stdoutBytes).not.toContain(secret);
    expect(stderrBytes).not.toContain(secret);
  });
});

describe("copyToClipboard — security: stdin not CLI args", () => {
  const orig = originalPlatform();

  beforeEach(() => {
    mockExecFile.mockReset();
    setPlatform("darwin");
  });

  afterEach(() => {
    setPlatform(orig);
  });

  it("never includes the secret in CLI arguments (not visible in ps)", async () => {
    const secret = "🔑-super-secret-token-xyz";
    const child = makeFakeChild();
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(null));
        return child;
      },
    );

    await copyToClipboard(secret);

    const args = mockExecFile.mock.calls[0][1] as string[];
    for (const a of args) {
      expect(a).not.toContain(secret);
    }
    expect(child._stdinChunks.join("")).toBe(secret);
  });
});

describe("copyToClipboard — unsupported platform", () => {
  const orig = originalPlatform();

  beforeEach(() => {
    mockExecFile.mockReset();
    setPlatform("aix");
  });

  afterEach(() => {
    setPlatform(orig);
  });

  it("rejects with a clear error for unsupported platforms", async () => {
    await expect(copyToClipboard("x")).rejects.toThrow(/unsupported|platform/i);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
