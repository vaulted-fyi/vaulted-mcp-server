const { mockUnlink } = vi.hoisted(() => ({
  mockUnlink: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  unlink: mockUnlink,
}));

const { scheduleFileDeletion } = await import("./file-ttl.js");

describe("scheduleFileDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUnlink.mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call unlink before TTL expires", () => {
    scheduleFileDeletion("/tmp/secret.txt", 300);
    vi.advanceTimersByTime(299_000);
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("calls unlink with the correct path when TTL expires", () => {
    scheduleFileDeletion("/tmp/secret.txt", 300);
    vi.advanceTimersByTime(300_000);
    expect(mockUnlink).toHaveBeenCalledWith("/tmp/secret.txt");
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });

  it("swallows unlink rejection without producing an unhandled rejection", async () => {
    // Use real timers so process.on("unhandledRejection") fires naturally —
    // fake timers also fake setImmediate/queueMicrotask, blocking the rejection-flush tick.
    vi.useRealTimers();
    mockUnlink.mockRejectedValueOnce(new Error("ENOENT: file already gone"));
    const handler = vi.fn();
    process.on("unhandledRejection", handler);

    try {
      scheduleFileDeletion("/tmp/missing.txt", 0.001);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockUnlink).toHaveBeenCalledWith("/tmp/missing.txt");
      expect(handler).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", handler);
    }
  });

  it("schedules independent timers for multiple calls", () => {
    scheduleFileDeletion("/tmp/a.txt", 60);
    scheduleFileDeletion("/tmp/b.txt", 120);

    vi.advanceTimersByTime(60_000);
    expect(mockUnlink).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledWith("/tmp/a.txt");

    vi.advanceTimersByTime(60_000);
    expect(mockUnlink).toHaveBeenCalledTimes(2);
    expect(mockUnlink).toHaveBeenLastCalledWith("/tmp/b.txt");
  });

  it("returns void (fire-and-forget — no handle exposed)", () => {
    const result = scheduleFileDeletion("/tmp/x.txt", 10);
    expect(result).toBeUndefined();
  });
});

describe("scheduleFileDeletion — process lifecycle (unref)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUnlink.mockResolvedValue(undefined);
  });

  it("calls unref() on the timer so a pending deletion does not hold the event loop open", () => {
    const unrefSpy = vi.fn();
    const fakeTimer = { unref: unrefSpy } as unknown as NodeJS.Timeout;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockReturnValueOnce(fakeTimer);

    try {
      scheduleFileDeletion("/tmp/x.txt", 10);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(unrefSpy).toHaveBeenCalledTimes(1);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
