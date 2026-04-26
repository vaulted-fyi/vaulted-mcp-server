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

  it("swallows errors from unlink (best-effort cleanup)", async () => {
    mockUnlink.mockRejectedValueOnce(new Error("ENOENT: file already gone"));

    expect(() => {
      scheduleFileDeletion("/tmp/missing.txt", 60);
      vi.advanceTimersByTime(60_000);
    }).not.toThrow();

    await vi.runAllTimersAsync();
    expect(mockUnlink).toHaveBeenCalledWith("/tmp/missing.txt");
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
